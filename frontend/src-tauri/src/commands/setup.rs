use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(feature = "stub_runtime")]
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
#[cfg(feature = "real_runtime")]
use tracing::{error, info};

use crate::downloader;
use crate::downloader::registry;
use crate::error::{AppError, AppResult};
#[cfg(feature = "real_runtime")]
use crate::hardware;
use crate::hardware::Tier;
#[cfg(feature = "real_runtime")]
use crate::sidecar;
#[cfg(feature = "real_runtime")]
use crate::state::ResolvedModelPaths;
use crate::state::{AppState, SetupState};

#[tauri::command]
pub async fn setup_state(state: State<'_, AppState>) -> AppResult<SetupState> {
    Ok(state.setup.lock().await.clone())
}

#[tauri::command]
pub async fn setup_start_download(app: AppHandle) -> AppResult<()> {
    let phase = app.state::<AppState>().setup.lock().await.phase.clone();
    if phase != "idle" {
        return Err(AppError::Other(format!(
            "setup cannot start while phase is {phase}"
        )));
    }
    spawn_runtime(app).await
}

#[tauri::command]
pub async fn setup_estimate_size(tier: u8) -> AppResult<u64> {
    Ok(registry::total_bytes(parse_tier(tier)?))
}

#[tauri::command]
pub async fn setup_confirm_download(app: AppHandle) -> AppResult<()> {
    let phase = app.state::<AppState>().setup.lock().await.phase.clone();
    if phase != "awaiting_confirm" {
        return Err(AppError::Other(format!(
            "download confirmation is not valid while phase is {phase}"
        )));
    }
    update_setup(&app, |setup| {
        setup.phase = "downloading".into();
        setup.error = None;
    })
    .await;
    spawn_runtime(app).await
}

#[tauri::command]
pub async fn setup_pause(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if state.setup.lock().await.phase != "downloading" {
        return Err(AppError::Other(
            "only an active download can be paused".into(),
        ));
    }
    update_setup(&app, |setup| {
        setup.phase = "paused".into();
        setup.bytes_per_sec = 0;
        setup.eta_secs = 0;
    })
    .await;
    if let Some(cancel) = state.setup_cancel.lock().await.as_ref() {
        cancel.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn setup_resume(app: AppHandle) -> AppResult<()> {
    let phase = app.state::<AppState>().setup.lock().await.phase.clone();
    if phase != "paused" {
        return Err(AppError::Other(
            "only a paused download can be resumed".into(),
        ));
    }
    update_setup(&app, |setup| {
        setup.phase = "downloading".into();
        setup.error = None;
    })
    .await;
    spawn_runtime(app).await
}

#[tauri::command]
pub async fn setup_retry(app: AppHandle) -> AppResult<()> {
    if app.state::<AppState>().setup.lock().await.phase != "error" {
        return Err(AppError::Other("only a failed setup can be retried".into()));
    }

    let state = app.state::<AppState>();
    let guard = state.spawn_guard.lock().await;
    if let Some(cancel) = state.setup_cancel.lock().await.take() {
        cancel.cancel();
    }
    if let Some(task) = state.setup_task.lock().await.take() {
        let _ = task.await;
    }
    *state.model_paths.lock().await = None;
    *state.runtime_backend.lock().await = None;
    drop(guard);

    update_setup(&app, |setup| *setup = SetupState::default()).await;
    // Retry profiles again and returns to awaiting_confirm when bytes remain;
    // clicking Retry is never treated as download consent.
    spawn_runtime(app).await
}

fn parse_tier(tier: u8) -> AppResult<Tier> {
    match tier {
        1 => Ok(Tier::One),
        2 => Ok(Tier::Two),
        3 => Ok(Tier::Three),
        _ => Err(AppError::Other(format!("invalid tier {tier}"))),
    }
}

async fn update_setup(app: &AppHandle, update: impl FnOnce(&mut SetupState)) -> SetupState {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut setup = state.setup.lock().await;
        update(&mut setup);
        setup.clone()
    };
    let _ = app.emit("setup://state", snapshot.clone());
    let _ = app.emit("setup://phase", snapshot.phase.clone());
    snapshot
}

#[cfg(feature = "real_runtime")]
async fn fail_setup(app: &AppHandle, message: String) {
    update_setup(app, |setup| {
        setup.phase = "error".into();
        setup.error = Some(message);
        setup.bytes_per_sec = 0;
        setup.eta_secs = 0;
    })
    .await;
}

async fn spawn_runtime(app: AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let guard = state.spawn_guard.lock().await;
    if let Some(cancel) = state.setup_cancel.lock().await.take() {
        cancel.cancel();
    }
    if let Some(task) = state.setup_task.lock().await.take() {
        let _ = task.await;
    }

    let task_app = app.clone();
    #[cfg(feature = "real_runtime")]
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = real_runtime(task_app.clone()).await {
            error!(%error, "setup runtime failed");
            fail_setup(&task_app, error.to_string()).await;
        }
    });
    #[cfg(feature = "stub_runtime")]
    let task = tauri::async_runtime::spawn(async move {
        stub_runtime(task_app).await;
    });

    *state.setup_task.lock().await = Some(task);
    drop(guard);
    Ok(())
}

#[cfg(feature = "real_runtime")]
async fn real_runtime(app: AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let cancel = Arc::new(CancellationToken::new());
    *state.setup_cancel.lock().await = Some(cancel.clone());

    let entry_phase = state.setup.lock().await.phase.clone();
    let tier = if entry_phase == "idle" {
        update_setup(&app, |setup| {
            setup.phase = "profiling".into();
            setup.error = None;
        })
        .await;

        let hardware = hardware::detect();
        let tier = hardware.tier;
        let profile = registry::profile(tier);
        *state.runtime_backend.lock().await = hardware.backend.clone();

        update_setup(&app, |setup| {
            setup.tier = Some(tier as u8);
            setup.model_id = Some(profile.id.into());
            setup.total = registry::total_bytes(tier);
            setup.supported = Some(hardware.supported);
            setup.device = Some(hardware.device.clone());
        })
        .await;

        if !hardware.supported {
            let reason = hardware
                .unsupported_reason
                .unwrap_or_else(|| "This accelerator is not supported by SovImage.".into());
            fail_setup(&app, reason).await;
            return Ok(());
        }
        let backend = hardware
            .backend
            .as_deref()
            .ok_or_else(|| AppError::Other("accelerator backend is missing".into()))?;
        update_setup(&app, |setup| setup.phase = "starting_sidecar".into()).await;
        sidecar::probe_backend(&app, backend)
            .await
            .map_err(|error| AppError::Other(format!("Engine probe failed: {error}")))?;
        tier
    } else if entry_phase == "downloading" {
        parse_tier(
            state
                .setup
                .lock()
                .await
                .tier
                .ok_or_else(|| AppError::Other("hardware tier is missing".into()))?,
        )?
    } else if entry_phase == "awaiting_confirm" || entry_phase == "ready" {
        return Ok(());
    } else {
        return Err(AppError::Other(format!(
            "setup runtime cannot run while phase is {entry_phase}"
        )));
    };

    let profile = registry::profile(tier);
    let manifest = registry::manifest(tier);
    let total = registry::total_bytes(tier);
    let models_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Other(format!("app_local_data_dir: {error}")))?
        .join("models");
    tokio::fs::create_dir_all(&models_dir).await?;
    let _model_lock = downloader::ModelDirLock::try_acquire(&models_dir)
        .map_err(|error| AppError::Other(error.to_string()))?;
    downloader::cleanup_stale_metadata(&models_dir, registry::all_models())
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;

    if entry_phase != "idle" {
        downloader::prepare_download_artifacts(&models_dir, manifest)
            .await
            .map_err(|error| AppError::Other(error.to_string()))?;
    }

    let remaining = downloader::remaining_bytes(&models_dir, manifest)
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    let completed = downloader::downloaded_prefix(&models_dir, manifest)
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    update_setup(&app, |setup| {
        setup.model_id = Some(profile.id.into());
        setup.total = total;
        setup.downloaded = completed;
    })
    .await;

    if entry_phase == "idle" && remaining > 0 {
        update_setup(&app, |setup| setup.phase = "awaiting_confirm".into()).await;
        return Ok(());
    }

    if remaining > 0 {
        downloader::ensure_disk_space(&models_dir, remaining)
            .map_err(|error| AppError::Other(error.to_string()))?;
    }
    update_setup(&app, |setup| {
        setup.phase = "downloading".into();
        setup.error = None;
    })
    .await;

    let mut cumulative = 0u64;
    let mut resolved = ResolvedModelPaths {
        diffusion: Default::default(),
        vae: Default::default(),
        llm: Default::default(),
    };

    for spec in manifest {
        let path = match downloader::download(
            app.clone(),
            spec,
            &models_dir,
            cancel.clone(),
            cumulative,
            total,
        )
        .await
        {
            Ok(path) => path,
            Err(downloader::DlError::Cancelled) => {
                info!("setup download paused");
                return Ok(());
            }
            Err(error) => {
                return Err(AppError::Other(format!(
                    "Download failed for {}: {error}",
                    spec.id
                )))
            }
        };
        cumulative = cumulative.saturating_add(spec.bytes);
        match spec.role {
            registry::ModelRole::Diffusion => resolved.diffusion = path,
            registry::ModelRole::Vae => resolved.vae = path,
            registry::ModelRole::Llm => resolved.llm = path,
        }
    }

    update_setup(&app, |setup| setup.phase = "verifying".into()).await;
    if resolved.diffusion.as_os_str().is_empty()
        || resolved.vae.as_os_str().is_empty()
        || resolved.llm.as_os_str().is_empty()
    {
        return Err(AppError::Other("model pack is incomplete".into()));
    }
    *state.model_paths.lock().await = Some(resolved);

    update_setup(&app, |setup| {
        setup.phase = "ready".into();
        setup.model_id = Some(profile.id.into());
        setup.downloaded = total;
        setup.bytes_per_sec = 0;
        setup.eta_secs = 0;
    })
    .await;
    info!(tier = tier as u8, model = profile.id, "setup complete");
    Ok(())
}

#[cfg(feature = "stub_runtime")]
async fn stub_runtime(app: AppHandle) {
    let phase = app.state::<AppState>().setup.lock().await.phase.clone();
    let profile = registry::profile(Tier::Two);
    let total = registry::total_bytes(Tier::Two);
    if phase == "idle" {
        update_setup(&app, |setup| {
            setup.phase = "awaiting_confirm".into();
            setup.tier = Some(Tier::Two as u8);
            setup.model_id = Some(profile.id.into());
            setup.total = total;
            setup.supported = Some(true);
            setup.device = Some("Stub runtime".into());
        })
        .await;
        return;
    }

    let cancel = Arc::new(CancellationToken::new());
    *app.state::<AppState>().setup_cancel.lock().await = Some(cancel.clone());
    let chunk = total / 40;
    let mut downloaded = app.state::<AppState>().setup.lock().await.downloaded;
    while downloaded < total {
        if cancel.is_cancelled() {
            return;
        }
        downloaded = (downloaded + chunk).min(total);
        update_setup(&app, |setup| {
            setup.phase = "downloading".into();
            setup.downloaded = downloaded;
            setup.bytes_per_sec = chunk * 10;
            setup.eta_secs = (total - downloaded) / setup.bytes_per_sec.max(1);
        })
        .await;
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    update_setup(&app, |setup| {
        setup.phase = "ready".into();
        setup.downloaded = total;
        setup.bytes_per_sec = 0;
        setup.eta_secs = 0;
    })
    .await;
}

const OBSOLETE_MODEL_FILES: &[&str] = &[
    "flux1-schnell-Q2_K.gguf",
    "flux1-schnell-Q4_0.gguf",
    "flux1-schnell-Q8_0.gguf",
    "flux1-dev-Q8_0.gguf",
    "flux1-kontext-dev-Q2_K.gguf",
    "flux1-kontext-dev-Q4_K_M.gguf",
    "flux1-kontext-dev-Q8_0.gguf",
    "ae.safetensors",
    "ae.sft",
    "clip_l.safetensors",
    "t5xxl_fp16.safetensors",
    "t5xxl_q4_k.gguf",
    "t5-v1_1-xxl-encoder-Q4_K_M.gguf",
    "Qwen3-4B-Q2_K.gguf",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsoleteModelInventory {
    pub bytes: u64,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigration {
    pub old_root: String,
    pub new_root: String,
    pub local_media_files: Vec<String>,
    pub moved_bytes: u64,
}

struct MoveCandidate {
    source: PathBuf,
    destination: PathBuf,
    bytes: u64,
}

#[tauri::command]
pub async fn migrate_local_storage(app: AppHandle) -> AppResult<StorageMigration> {
    let old_root = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Other(format!("app_data_dir: {error}")))?;
    let new_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Other(format!("app_local_data_dir: {error}")))?;
    tokio::fs::create_dir_all(&new_root).await?;
    ensure_directory_not_symlink(&new_root, "local storage").await?;

    let mut moved_bytes = 0u64;
    if old_root != new_root {
        let _model_lock = downloader::ModelDirLock::try_acquire(&new_root.join("models"))
            .map_err(|error| AppError::Other(error.to_string()))?;
        let candidates = collect_legacy_moves(&old_root, &new_root).await?;
        for candidate in candidates {
            if let Some(parent) = candidate.destination.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            move_regular_file(&candidate.source, &candidate.destination, candidate.bytes).await?;
            moved_bytes = moved_bytes.saturating_add(candidate.bytes);
        }
    }

    crate::commands::generation::cleanup_stale_generation_files(app.clone()).await;

    Ok(StorageMigration {
        old_root: old_root.display().to_string(),
        new_root: new_root.display().to_string(),
        local_media_files: scan_local_media(&new_root).await?,
        moved_bytes,
    })
}

async fn move_regular_file(source: &Path, destination: &Path, bytes: u64) -> AppResult<()> {
    match tokio::fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(rename_error) => copy_then_remove(source, destination, bytes)
            .await
            .map_err(|copy_error| {
                AppError::Other(format!(
                    "move {} to local storage failed ({rename_error}); copy fallback failed: {copy_error}",
                    source.display()
                ))
            }),
    }
}

async fn copy_then_remove(source: &Path, destination: &Path, bytes: u64) -> AppResult<()> {
    let mut source_file = tokio::fs::File::open(source).await?;
    let mut destination_file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await?;
    let result = async move {
        let copied = tokio::io::copy(&mut source_file, &mut destination_file).await?;
        destination_file.flush().await?;
        destination_file.sync_all().await?;
        drop(destination_file);
        if copied != bytes || tokio::fs::metadata(destination).await?.len() != bytes {
            return Err(AppError::Other(format!(
                "copied byte length changed (expected {bytes}, copied {copied})"
            )));
        }
        let (source_hash, destination_hash) =
            tokio::try_join!(hash_file(source), hash_file(destination),)?;
        if source_hash != destination_hash {
            return Err(AppError::Other("copied file checksum mismatch".into()));
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(destination).await;
        return Err(error);
    }
    if let Err(error) = tokio::fs::remove_file(source).await {
        let _ = tokio::fs::remove_file(destination).await;
        return Err(error.into());
    }
    Ok(())
}

async fn hash_file(path: &Path) -> AppResult<[u8; 32]> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash.finalize().into())
}

async fn collect_legacy_moves(old_root: &Path, new_root: &Path) -> AppResult<Vec<MoveCandidate>> {
    let mut candidates = Vec::new();
    for directory in ["images", "attachments"] {
        let source_dir = old_root.join(directory);
        if !ensure_directory_not_symlink(&source_dir, "legacy media").await? {
            continue;
        }
        ensure_directory_not_symlink(&new_root.join(directory), "local media").await?;
        let mut entries = tokio::fs::read_dir(&source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let Some(name) = allowed_media_name(&entry.file_name()) else {
                continue;
            };
            let relative = format!("{directory}/{name}");
            push_move_candidate(&mut candidates, entry.path(), new_root.join(&relative)).await?;
        }
    }

    ensure_directory_not_symlink(&old_root.join("models"), "legacy models").await?;
    ensure_directory_not_symlink(&new_root.join("models"), "local models").await?;
    for spec in registry::all_models() {
        for suffix in ["", ".verified", ".part", ".part.json"] {
            let name = format!("{}{suffix}", spec.file);
            push_move_candidate(
                &mut candidates,
                old_root.join("models").join(&name),
                new_root.join("models").join(name),
            )
            .await?;
        }
    }
    Ok(candidates)
}

async fn ensure_directory_not_symlink(path: &Path, label: &str) -> AppResult<bool> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(AppError::Other(format!(
            "{label} directory is a symlink: {}",
            path.display()
        ))),
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(AppError::Other(format!(
            "{label} path is not a directory: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn push_move_candidate(
    candidates: &mut Vec<MoveCandidate>,
    source: PathBuf,
    destination: PathBuf,
) -> AppResult<()> {
    let metadata = match tokio::fs::symlink_metadata(&source).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::Other(format!(
            "legacy storage entry is not a regular file: {}",
            source.display()
        )));
    }
    match tokio::fs::symlink_metadata(&destination).await {
        Ok(_) => {
            return Err(AppError::Other(format!(
                "local storage collision; preserved both paths: {} and {}",
                source.display(),
                destination.display()
            )))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    candidates.push(MoveCandidate {
        source,
        destination,
        bytes: metadata.len(),
    });
    Ok(())
}

fn allowed_media_name(name: &std::ffi::OsStr) -> Option<String> {
    let name = name.to_str()?;
    let path = Path::new(name);
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "gif", "bmp", "webp"].contains(&extension.as_str()) {
        return None;
    }
    uuid::Uuid::parse_str(path.file_stem()?.to_str()?).ok()?;
    Some(name.into())
}

async fn scan_local_media(root: &Path) -> AppResult<Vec<String>> {
    let mut files = BTreeSet::new();
    for directory in ["images", "attachments"] {
        let Ok(mut entries) = tokio::fs::read_dir(root.join(directory)).await else {
            continue;
        };
        while let Some(entry) = entries.next_entry().await? {
            if let Some(name) = allowed_media_name(&entry.file_name()) {
                if entry.file_type().await?.is_file() {
                    files.insert(format!("{directory}/{name}"));
                }
            }
        }
    }
    Ok(files.into_iter().collect())
}

fn model_roots(app: &AppHandle) -> AppResult<Vec<PathBuf>> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Other(format!("app_local_data_dir: {error}")))?
        .join("models");
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Other(format!("app_data_dir: {error}")))?
        .join("models");
    let mut roots = vec![local];
    if legacy != roots[0] {
        roots.push(legacy);
    }
    Ok(roots)
}

#[tauri::command]
pub async fn obsolete_model_inventory(app: AppHandle) -> AppResult<ObsoleteModelInventory> {
    let mut combined = ObsoleteModelInventory {
        bytes: 0,
        files: Vec::new(),
    };
    for models in model_roots(&app)? {
        let inventory = scan_obsolete_models(&models).await;
        combined.bytes = combined.bytes.saturating_add(inventory.bytes);
        for file in inventory.files {
            if !combined.files.contains(&file) {
                combined.files.push(file);
            }
        }
    }
    Ok(combined)
}

#[tauri::command]
pub async fn cleanup_obsolete_models(app: AppHandle) -> AppResult<ObsoleteModelInventory> {
    let phase = app.state::<AppState>().setup.lock().await.phase.clone();
    if !obsolete_cleanup_allowed(&phase) {
        return Err(AppError::Other(format!(
            "old models cannot be removed while setup phase is {phase}"
        )));
    }
    let inventory = obsolete_model_inventory(app.clone()).await?;
    for models in model_roots(&app)? {
        for file in &inventory.files {
            for suffix in ["", ".verified", ".part", ".part.json"] {
                let path = models.join(format!("{file}{suffix}"));
                match tokio::fs::remove_file(path).await {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
    }
    let _ = app.emit("models://cleanup", inventory.clone());
    Ok(inventory)
}

fn obsolete_cleanup_allowed(phase: &str) -> bool {
    matches!(
        phase,
        "idle" | "awaiting_confirm" | "paused" | "error" | "ready"
    )
}

async fn scan_obsolete_models(models: &std::path::Path) -> ObsoleteModelInventory {
    let mut inventory = ObsoleteModelInventory {
        bytes: 0,
        files: Vec::new(),
    };
    for file in OBSOLETE_MODEL_FILES {
        let mut found = false;
        for suffix in ["", ".verified", ".part", ".part.json"] {
            let path = models.join(format!("{file}{suffix}"));
            if let Ok(metadata) = tokio::fs::symlink_metadata(path).await {
                inventory.bytes = inventory.bytes.saturating_add(metadata.len());
                found = true;
            }
        }
        if found {
            inventory.files.push((*file).into());
        }
    }
    inventory
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn obsolete_inventory_is_exact_and_deterministic() {
        let directory = tempfile::tempdir().unwrap();
        tokio::fs::write(directory.path().join("flux1-dev-Q8_0.gguf"), [0u8; 3])
            .await
            .unwrap();
        tokio::fs::write(directory.path().join("flux1-dev-Q8_0.gguf.part"), [0u8; 2])
            .await
            .unwrap();
        tokio::fs::write(directory.path().join("unrelated.gguf"), [0u8; 99])
            .await
            .unwrap();
        let inventory = scan_obsolete_models(directory.path()).await;
        assert_eq!(inventory.bytes, 5);
        assert_eq!(inventory.files, ["flux1-dev-Q8_0.gguf"]);
    }

    #[test]
    fn obsolete_cleanup_is_blocked_during_active_setup() {
        for phase in ["profiling", "starting_sidecar", "downloading", "verifying"] {
            assert!(!obsolete_cleanup_allowed(phase), "{phase}");
        }
        for phase in ["idle", "awaiting_confirm", "paused", "error", "ready"] {
            assert!(obsolete_cleanup_allowed(phase), "{phase}");
        }
    }

    #[tokio::test]
    async fn storage_migration_preflights_exact_media_and_collisions() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        let name = "67e55044-10b1-426f-9247-bb680e5fe0c8.png";
        tokio::fs::create_dir_all(old.path().join("images"))
            .await
            .unwrap();
        tokio::fs::write(old.path().join("images").join(name), b"image")
            .await
            .unwrap();
        tokio::fs::write(old.path().join("images").join("unrelated.png"), b"keep")
            .await
            .unwrap();
        let candidates = collect_legacy_moves(old.path(), new.path()).await.unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].bytes, 5);

        tokio::fs::create_dir_all(new.path().join("images"))
            .await
            .unwrap();
        tokio::fs::write(new.path().join("images").join(name), b"collision")
            .await
            .unwrap();
        assert!(collect_legacy_moves(old.path(), new.path()).await.is_err());
        assert_eq!(
            tokio::fs::read(old.path().join("images").join(name))
                .await
                .unwrap(),
            b"image"
        );
    }

    #[tokio::test]
    async fn cross_device_copy_fallback_verifies_before_removing_source() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.bin");
        let destination = directory.path().join("destination.bin");
        tokio::fs::write(&source, b"verified bytes").await.unwrap();
        copy_then_remove(&source, &destination, 14).await.unwrap();
        assert!(!source.exists());
        assert_eq!(
            tokio::fs::read(&destination).await.unwrap(),
            b"verified bytes"
        );

        let source = directory.path().join("source-2.bin");
        tokio::fs::write(&source, b"source").await.unwrap();
        assert!(copy_then_remove(&source, &destination, 6).await.is_err());
        assert_eq!(tokio::fs::read(&source).await.unwrap(), b"source");
        assert_eq!(
            tokio::fs::read(&destination).await.unwrap(),
            b"verified bytes"
        );
    }
}
