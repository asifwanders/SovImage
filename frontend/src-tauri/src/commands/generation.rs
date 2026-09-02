#[cfg(feature = "real_runtime")]
use std::io::Write;
#[cfg(feature = "real_runtime")]
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
#[cfg(feature = "real_runtime")]
use tracing::{error, info};
use uuid::Uuid;

use crate::downloader::registry;
use crate::error::{AppError, AppResult};
use crate::hardware::Tier;
use crate::sidecar;
#[cfg(feature = "stub_runtime")]
use crate::sidecar::dim;
#[cfg(feature = "real_runtime")]
use crate::sidecar::{dim, GenerateRequest, GenerationMode, ModelPaths};
use crate::state::AppState;

const MAX_PROMPT_BYTES: usize = 16 * 1024;
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_GENERATION_JOBS: usize = 4;

fn generation_queue_has_capacity(active: usize) -> bool {
    active < MAX_GENERATION_JOBS
}

fn emit_failure(app: &AppHandle, message_id: &str, message: &str) {
    let _ = app.emit(
        &format!("generation://{message_id}"),
        json!({ "event": "error", "message": message }),
    );
}

fn emit_cancelled(app: &AppHandle, message_id: &str) {
    let _ = app.emit(
        &format!("generation://{message_id}"),
        json!({ "event": "cancelled" }),
    );
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn generate_image(
    app: AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    prompt: String,
    init_image_path: Option<String>,
    meta: Option<Value>,
) -> AppResult<()> {
    let uuid = Uuid::parse_str(&message_id)
        .map_err(|_| AppError::Other("message_id must be a UUID".into()))?;
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.len() > MAX_PROMPT_BYTES || prompt.contains('\0') {
        let error = format!("prompt must contain 1 to {MAX_PROMPT_BYTES} UTF-8 bytes");
        emit_failure(&app, &message_id, &error);
        return Err(AppError::Other(error));
    }

    // Reserve the ID before touching its prompt/output paths. A duplicate
    // request must not truncate files owned by the already-running job.
    let cancel = Arc::new(CancellationToken::new());
    {
        let mut generations = state.generations.lock().await;
        if generations.contains_key(&message_id) {
            return Err(AppError::Other(
                "generation already exists for message_id".into(),
            ));
        }
        if !generation_queue_has_capacity(generations.len()) {
            let error =
                format!("generation queue is full ({MAX_GENERATION_JOBS} running or queued jobs)");
            emit_failure(&app, &message_id, &error);
            return Err(AppError::Other(error));
        }
        generations.insert(message_id.clone(), cancel.clone());
    }

    #[cfg(feature = "stub_runtime")]
    {
        let _ = prompt;
        if let Err(error) = spawn_stub_generation(
            app.clone(),
            message_id.clone(),
            uuid,
            init_image_path.is_some(),
            meta.as_ref(),
            cancel,
        )
        .await
        {
            state.generations.lock().await.remove(&message_id);
            emit_failure(&app, &message_id, &error.to_string());
            return Err(error);
        }
        Ok(())
    }

    #[cfg(feature = "real_runtime")]
    {
        let prepared = prepare_generation(
            &app,
            &state,
            &message_id,
            uuid,
            prompt,
            init_image_path,
            meta.as_ref(),
        )
        .await;
        let request = match prepared {
            Ok(request) => request,
            Err(error) => {
                state.generations.lock().await.remove(&message_id);
                emit_failure(&app, &message_id, &error.to_string());
                return Err(error);
            }
        };

        let _ = app.emit(
            &format!("generation://{message_id}"),
            json!({ "event": "queued" }),
        );
        let slot = state.generation_slot.clone();
        let task_app = app.clone();
        let task_id = message_id.clone();
        tauri::async_runtime::spawn(async move {
            let permit = tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = tokio::fs::remove_file(&request.prompt_file).await;
                    emit_cancelled(&task_app, &task_id);
                    remove_generation(&task_app, &task_id).await;
                    return;
                }
                permit = slot.acquire_owned() => permit,
            };
            let _permit = match permit {
                Ok(permit) => permit,
                Err(_) => {
                    let _ = tokio::fs::remove_file(&request.prompt_file).await;
                    emit_failure(&task_app, &task_id, "generation queue is unavailable");
                    remove_generation(&task_app, &task_id).await;
                    return;
                }
            };
            if cancel.is_cancelled() {
                let _ = tokio::fs::remove_file(&request.prompt_file).await;
                emit_cancelled(&task_app, &task_id);
                remove_generation(&task_app, &task_id).await;
                return;
            }
            if let Err(error) = sidecar::run(task_app.clone(), request, cancel).await {
                error!(message_id = %task_id, %error, "generation task ended with failure");
            }
            remove_generation(&task_app, &task_id).await;
        });
        Ok(())
    }
}

#[cfg(feature = "stub_runtime")]
async fn spawn_stub_generation(
    app: AppHandle,
    message_id: String,
    uuid: Uuid,
    editing: bool,
    meta: Option<&Value>,
    cancel: Arc<CancellationToken>,
) -> AppResult<()> {
    if app.state::<AppState>().setup.lock().await.phase != "ready" {
        return Err(AppError::Other("stub models are not ready".into()));
    }
    let seed = requested_seed(meta)?.unwrap_or_else(|| {
        let raw = u64::from_be_bytes(uuid.as_bytes()[..8].try_into().expect("UUID is 16 bytes"));
        (raw & MAX_SAFE_JS_INTEGER) as i64
    });
    let profile = registry::profile(Tier::Two);
    let images_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Other(format!("app_local_data_dir: {error}")))?
        .join("images");
    tokio::fs::create_dir_all(&images_dir).await?;
    let output = images_dir.join(format!("{message_id}.png"));
    let work = images_dir.join(format!("{message_id}.part.png"));
    ensure_absent(&output, "generation output").await?;
    ensure_absent(&work, "generation work file").await?;
    let channel = format!("generation://{message_id}");
    let _ = app.emit(&channel, json!({ "event": "queued" }));
    tauri::async_runtime::spawn(async move {
        let _ = app.emit(&channel, json!({ "event": "started" }));
        for step in 1..=profile.steps {
            tokio::select! {
                _ = cancel.cancelled() => {
                    emit_cancelled(&app, &message_id);
                    remove_generation(&app, &message_id).await;
                    return;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(30)) => {}
            }
            let _ = app.emit(
                &channel,
                json!({ "event": "step", "step": step, "total": profile.steps }),
            );
        }
        if cancel.is_cancelled() {
            emit_cancelled(&app, &message_id);
            remove_generation(&app, &message_id).await;
            return;
        }
        let result = async {
            tokio::fs::write(&work, include_bytes!("../../icons/32x32.png")).await?;
            dim::validate_output_png(&work, 32, 32).map_err(AppError::Other)?;
            sidecar::publish_output(&work, &output)
                .await
                .map_err(AppError::Other)?;
            AppResult::Ok(())
        }
        .await;
        match result {
            Ok(()) => {
                let mode = if editing { "edit" } else { "txt2img" };
                let _ = app.emit(
                    &channel,
                    json!({
                        "event": "done",
                        "imagePath": output.display().to_string(),
                        "meta": {
                            "model": profile.id,
                            "mode": mode,
                            "steps": profile.steps,
                            "cfg": profile.cfg,
                            "guidance": profile.guidance,
                            "sampler": profile.sampler,
                            "seed": seed,
                            "width": 32,
                            "height": 32,
                        }
                    }),
                );
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&work).await;
                emit_failure(&app, &message_id, &error.to_string());
            }
        }
        remove_generation(&app, &message_id).await;
    });
    Ok(())
}

#[cfg(feature = "real_runtime")]
async fn prepare_generation(
    app: &AppHandle,
    state: &State<'_, AppState>,
    message_id: &str,
    uuid: Uuid,
    prompt: &str,
    init_image_path: Option<String>,
    meta: Option<&Value>,
) -> AppResult<GenerateRequest> {
    let setup = state.setup.lock().await.clone();
    if setup.phase != "ready" {
        return Err(AppError::Other("models are not ready".into()));
    }
    let tier = match setup.tier {
        Some(1) => Tier::One,
        Some(2) => Tier::Two,
        Some(3) => Tier::Three,
        _ => return Err(AppError::Other("hardware tier is missing".into())),
    };
    let profile = registry::profile(tier);
    let paths = state
        .model_paths
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Other("model paths are missing".into()))?;
    let backend = state
        .runtime_backend
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Other("runtime backend is missing".into()))?;

    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Other(format!("app_local_data_dir: {error}")))?;
    let images_dir = data_dir.join("images");
    let prompts_dir = data_dir.join("prompts");
    tokio::fs::create_dir_all(&images_dir).await?;
    tokio::fs::create_dir_all(&prompts_dir).await?;

    let init_image = validate_reference(&data_dir.join("attachments"), init_image_path).await?;
    let mode = if init_image.is_some() {
        GenerationMode::Edit
    } else {
        GenerationMode::Txt2Img
    };
    let (width, height) = match requested_dimensions(meta, profile.width, profile.height)? {
        Some(dimensions) => dimensions,
        None => match &init_image {
            Some((_, info)) => {
                fitted_reference_dimensions(info.width, info.height, profile.width, profile.height)?
            }
            None => (profile.width, profile.height),
        },
    };
    let init_image = init_image.map(|(path, _)| path);
    let seed = requested_seed(meta)?.unwrap_or_else(|| {
        let raw = u64::from_be_bytes(uuid.as_bytes()[..8].try_into().expect("UUID is 16 bytes"));
        (raw & MAX_SAFE_JS_INTEGER) as i64
    });

    let output_png = images_dir.join(format!("{message_id}.png"));
    let work_png = images_dir.join(format!("{message_id}.part.png"));
    ensure_absent(&output_png, "generation output").await?;
    ensure_absent(&work_png, "generation work file").await?;
    let prompt_file = prompts_dir.join(format!("{message_id}.txt"));
    write_private_prompt(&prompt_file, prompt)?;

    info!(
        model = profile.id,
        mode = mode.label(),
        width,
        height,
        seed,
        %backend,
        "queued generation"
    );
    Ok(GenerateRequest {
        message_id: message_id.into(),
        profile,
        model_paths: ModelPaths {
            diffusion: paths.diffusion,
            vae: paths.vae,
            llm: paths.llm,
        },
        mode,
        prompt_file,
        init_image,
        width,
        height,
        seed,
        work_png,
        output_png,
        backend,
    })
}

async fn ensure_absent(path: &std::path::Path, label: &str) -> AppResult<()> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(_) => Err(AppError::Other(format!("{label} already exists"))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(feature = "real_runtime")]
fn write_private_prompt(path: &Path, prompt: &str) -> AppResult<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(prompt.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

#[cfg(feature = "real_runtime")]
async fn validate_reference(
    attachments_dir: &Path,
    raw_path: Option<String>,
) -> AppResult<Option<(PathBuf, dim::ImageInfo)>> {
    let Some(raw_path) = raw_path else {
        return Ok(None);
    };
    let root = tokio::fs::canonicalize(attachments_dir)
        .await
        .map_err(|_| AppError::Other("attachments directory is unavailable".into()))?;
    let path = tokio::fs::canonicalize(raw_path)
        .await
        .map_err(|_| AppError::Other("reference image does not exist".into()))?;
    if !path.starts_with(&root) {
        return Err(AppError::Other(
            "reference image must be inside app_local_data/attachments".into(),
        ));
    }
    let info = dim::validate_input(&path).map_err(AppError::Other)?;
    Ok(Some((path, info)))
}

fn requested_seed(meta: Option<&Value>) -> AppResult<Option<i64>> {
    let Some(value) = meta.and_then(|meta| meta.get("seed")) else {
        return Ok(None);
    };
    let seed = value
        .as_u64()
        .filter(|seed| *seed <= MAX_SAFE_JS_INTEGER)
        .ok_or_else(|| AppError::Other("seed must be a non-negative safe integer".into()))?;
    Ok(Some(seed as i64))
}

#[cfg(feature = "real_runtime")]
fn requested_dimensions(
    meta: Option<&Value>,
    max_width: u32,
    max_height: u32,
) -> AppResult<Option<(u32, u32)>> {
    let Some(meta) = meta else {
        return Ok(None);
    };
    let width_value = meta.get("width");
    let height_value = meta.get("height");
    if width_value.is_none() && height_value.is_none() {
        return Ok(None);
    }
    let width = width_value.and_then(Value::as_u64);
    let height = height_value.and_then(Value::as_u64);
    match (width, height) {
        (Some(width), Some(height))
            if (256..=u64::from(max_width)).contains(&width)
                && (256..=u64::from(max_height)).contains(&height)
                && width % 16 == 0
                && height % 16 == 0 =>
        {
            Ok(Some((width as u32, height as u32)))
        }
        _ => Err(AppError::Other(format!(
            "width and height must both be multiples of 16 from 256 through {max_width}x{max_height}"
        ))),
    }
}

#[cfg(feature = "real_runtime")]
fn fitted_reference_dimensions(
    width: u32,
    height: u32,
    max_width: u32,
    max_height: u32,
) -> AppResult<(u32, u32)> {
    let dimensions = dim::fit_to_max(width, height, max_width, max_height, 16);
    if dimensions.0 < 256 || dimensions.1 < 256 {
        return Err(AppError::Other(
            "reference image aspect ratio would create a canvas side below 256 pixels".into(),
        ));
    }
    Ok(dimensions)
}

async fn remove_generation(app: &AppHandle, message_id: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        state.generations.lock().await.remove(message_id);
    }
}

#[tauri::command]
pub async fn cancel_generation(state: State<'_, AppState>, message_id: String) -> AppResult<()> {
    if let Some(cancel) = state.generations.lock().await.get(&message_id) {
        cancel.cancel();
    }
    Ok(())
}

pub async fn cleanup_stale_generation_files(app: AppHandle) {
    let Ok(local) = app.path().app_local_data_dir() else {
        return;
    };
    let Ok(legacy) = app.path().app_data_dir() else {
        return;
    };
    let mut roots = vec![local];
    if legacy != roots[0] {
        roots.push(legacy);
    }
    for root in roots {
        for directory in ["prompts", "images"] {
            let Ok(mut entries) = tokio::fs::read_dir(root.join(directory)).await else {
                continue;
            };
            while let Ok(Some(entry)) = entries.next_entry().await {
                if is_stale_private_file(directory, &entry.file_name()) {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }
    }
}

fn is_stale_private_file(directory: &str, name: &std::ffi::OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    let id = match directory {
        "prompts" => name.strip_suffix(".txt"),
        "images" => name.strip_suffix(".part.png"),
        _ => None,
    };
    id.is_some_and(|id| Uuid::parse_str(id).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_reproducible_safe_seed() {
        let id = Uuid::parse_str("67e55044-10b1-426f-9247-bb680e5fe0c8").unwrap();
        let raw = u64::from_be_bytes(id.as_bytes()[..8].try_into().unwrap());
        let first = (raw & MAX_SAFE_JS_INTEGER) as i64;
        let second = (raw & MAX_SAFE_JS_INTEGER) as i64;
        assert_eq!(first, second);
        assert!(first >= 0 && first as u64 <= MAX_SAFE_JS_INTEGER);
    }

    #[test]
    fn generation_queue_has_a_hard_bound() {
        assert!(generation_queue_has_capacity(MAX_GENERATION_JOBS - 1));
        assert!(!generation_queue_has_capacity(MAX_GENERATION_JOBS));
        assert!(!generation_queue_has_capacity(MAX_GENERATION_JOBS + 1));
    }

    #[test]
    fn stale_cleanup_accepts_only_exact_private_uuid_files() {
        assert!(is_stale_private_file(
            "prompts",
            std::ffi::OsStr::new("67e55044-10b1-426f-9247-bb680e5fe0c8.txt")
        ));
        assert!(is_stale_private_file(
            "images",
            std::ffi::OsStr::new("67e55044-10b1-426f-9247-bb680e5fe0c8.part.png")
        ));
        assert!(!is_stale_private_file(
            "prompts",
            std::ffi::OsStr::new("notes.txt")
        ));
        assert!(!is_stale_private_file(
            "images",
            std::ffi::OsStr::new("67e55044-10b1-426f-9247-bb680e5fe0c8.png")
        ));
    }

    #[test]
    #[cfg(feature = "real_runtime")]
    fn validates_optional_generation_controls() {
        let meta = json!({ "seed": 42, "width": 768, "height": 512 });
        assert_eq!(requested_seed(Some(&meta)).unwrap(), Some(42));
        assert_eq!(
            requested_dimensions(Some(&meta), 1024, 1024).unwrap(),
            Some((768, 512))
        );
        assert!(
            requested_dimensions(Some(&json!({ "width": 777, "height": 512 })), 1024, 1024)
                .is_err()
        );
        assert!(requested_dimensions(
            Some(&json!({ "width": "768", "height": "512" })),
            1024,
            1024
        )
        .is_err());
        assert!(fitted_reference_dimensions(8192, 1, 768, 768).is_err());
        assert_eq!(
            fitted_reference_dimensions(1920, 1080, 1024, 1024).unwrap(),
            (1024, 576)
        );
    }

    #[test]
    #[cfg(all(feature = "real_runtime", unix))]
    fn prompt_file_is_private_and_never_replaced() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("prompt.txt");
        write_private_prompt(&path, "private").unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(write_private_prompt(&path, "replacement").is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "private");
    }

    #[test]
    #[cfg(feature = "stub_runtime")]
    fn bundled_stub_png_matches_its_event_dimensions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("stub.png");
        std::fs::write(&path, include_bytes!("../../icons/32x32.png")).unwrap();
        let info = dim::validate_output_png(&path, 32, 32).unwrap();
        assert_eq!((info.width, info.height), (32, 32));
    }
}
