//! Resumable, fail-closed downloader for immutable model artifacts.

#![cfg_attr(feature = "stub_runtime", allow(dead_code, unused_imports))]

pub mod registry;

use std::collections::HashSet;
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE, ETAG, IF_RANGE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::state::AppState;
use registry::ModelSpec;

static VERIFIED_FILES: OnceLock<tokio::sync::Mutex<HashSet<PathBuf>>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum DlError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("server returned status {0}")]
    Status(u16),
    #[error("invalid model specification: {0}")]
    InvalidSpec(String),
    #[error("size mismatch (expected {expected} bytes, got {got})")]
    SizeMismatch { expected: u64, got: u64 },
    #[error("sha256 mismatch (expected {expected}, got {got})")]
    ChecksumMismatch { expected: String, got: String },
    #[error("cancelled by user")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct State {
    url: String,
    total: u64,
    downloaded: u64,
    sha256_expected: String,
    etag: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
    pub eta_secs: u64,
}

pub fn free_disk_space(dir: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let path = CString::new(dir.as_os_str().as_bytes()).ok()?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
            return None;
        }
        return Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64));
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let mut path: Vec<u16> = dir.as_os_str().encode_wide().collect();
        path.push(0);
        let mut free = 0u64;
        let mut total = 0u64;
        let mut total_free = 0u64;
        if unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut free, &mut total, &mut total_free) }
            == 0
        {
            return None;
        }
        return Some(free);
    }

    #[allow(unreachable_code)]
    {
        let _ = dir;
        None
    }
}

pub fn ensure_disk_space(dir: &Path, remaining_bytes: u64) -> Result<(), DlError> {
    let free = free_disk_space(dir).ok_or_else(|| {
        DlError::Other(format!(
            "Could not determine free disk space for {}",
            dir.display()
        ))
    })?;
    let need = remaining_bytes.saturating_add(remaining_bytes / 5);
    if free < need {
        let gib = |bytes: u64| bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        return Err(DlError::Other(format!(
            "Not enough disk space: need {:.1} GiB free, have {:.1} GiB",
            gib(need),
            gib(free)
        )));
    }
    Ok(())
}

pub fn build_client() -> Result<reqwest::Client, DlError> {
    reqwest::Client::builder()
        .user_agent(concat!("SovImage/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .http2_keep_alive_interval(Duration::from_secs(20))
        .build()
        .map_err(DlError::from)
}

/// Cross-process guard for the shared model directory. A second app instance
/// must fail cleanly instead of appending to the same partial model.
pub struct ModelDirLock {
    file: std::fs::File,
}

/// Held for the full app lifetime so two SovImage processes cannot load the
/// same GPU simultaneously.
pub struct InstanceLock {
    file: std::fs::File,
}

impl ModelDirLock {
    pub fn try_acquire(models_dir: &Path) -> Result<Self, DlError> {
        std::fs::create_dir_all(models_dir)?;
        if std::fs::symlink_metadata(models_dir)?
            .file_type()
            .is_symlink()
        {
            return Err(DlError::Other(format!(
                "refusing symlinked model directory {}",
                models_dir.display()
            )));
        }
        Ok(Self {
            file: try_lock_file(
                &models_dir.join(".sovimage-download.lock"),
                "another SovImage instance is managing model files",
            )?,
        })
    }
}

impl InstanceLock {
    pub fn try_acquire(local_data_dir: &Path) -> Result<Self, DlError> {
        std::fs::create_dir_all(local_data_dir)?;
        if std::fs::symlink_metadata(local_data_dir)?
            .file_type()
            .is_symlink()
        {
            return Err(DlError::Other(format!(
                "refusing symlinked local data directory {}",
                local_data_dir.display()
            )));
        }
        Ok(Self {
            file: try_lock_file(
                &local_data_dir.join(".sovimage-instance.lock"),
                "another SovImage instance is already running",
            )?,
        })
    }
}

fn try_lock_file(path: &Path, conflict: &str) -> Result<std::fs::File, DlError> {
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(DlError::Other(format!(
            "refusing symlinked lock {}",
            path.display()
        )));
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;

    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(DlError::Other(conflict.into()));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::LockFile;
        if unsafe { LockFile(file.as_raw_handle() as _, 0, 0, u32::MAX, u32::MAX) } == 0 {
            return Err(DlError::Other(conflict.into()));
        }
    }
    Ok(file)
}

fn unlock_file(file: &std::fs::File) {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::UnlockFile;
        let _ = unsafe { UnlockFile(file.as_raw_handle() as _, 0, 0, u32::MAX, u32::MAX) };
    }
}

impl Drop for ModelDirLock {
    fn drop(&mut self) {
        unlock_file(&self.file);
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        unlock_file(&self.file);
    }
}

async fn reject_symlink(path: &Path) -> Result<(), DlError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(DlError::Other(format!(
            "refusing symlinked model path {}",
            path.display()
        ))),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn await_response<F>(
    response: F,
    cancel: &CancellationToken,
    timeout: Duration,
) -> Result<reqwest::Response, DlError>
where
    F: Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(DlError::Cancelled),
        result = tokio::time::timeout(timeout, response) => match result {
            Ok(response) => response.map_err(DlError::from),
            Err(_) => Err(DlError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "model server did not send response headers within 30 seconds",
            ))),
        },
    }
}

pub async fn remaining_bytes(models_dir: &Path, manifest: &[&ModelSpec]) -> Result<u64, DlError> {
    let mut remaining = 0u64;
    for spec in manifest {
        validate_spec(spec)?;
        if trusted_final(models_dir, spec).await? {
            continue;
        }
        let present = resumable_bytes(models_dir, spec).await?;
        remaining = remaining.saturating_add(spec.bytes.saturating_sub(present));
    }
    Ok(remaining)
}

pub async fn downloaded_prefix(models_dir: &Path, manifest: &[&ModelSpec]) -> Result<u64, DlError> {
    let mut downloaded = 0u64;
    for spec in manifest {
        validate_spec(spec)?;
        if trusted_final(models_dir, spec).await? {
            downloaded = downloaded.saturating_add(spec.bytes);
            continue;
        }
        downloaded = downloaded.saturating_add(resumable_bytes(models_dir, spec).await?);
        break;
    }
    Ok(downloaded)
}

pub async fn cleanup_stale_metadata(
    models_dir: &Path,
    models: &[&ModelSpec],
) -> Result<u64, DlError> {
    let mut removed = 0u64;
    let mut entries = fs::read_dir(models_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !models.iter().any(|spec| stale_metadata_name(&name, spec)) {
            continue;
        }
        let file_type = entry.file_type().await?;
        if !file_type.is_file() && !file_type.is_symlink() {
            continue;
        }
        fs::remove_file(entry.path()).await?;
        removed += 1;
    }
    Ok(removed)
}

fn stale_metadata_name(name: &str, spec: &ModelSpec) -> bool {
    let legacy_marker = format!("{}.verified", spec.file);
    if name == legacy_marker {
        return true;
    }
    [format!("{}.part.json", spec.file), legacy_marker]
        .iter()
        .any(|base| {
            name.strip_prefix(&format!(".{base}."))
                .and_then(|rest| rest.strip_suffix(".tmp"))
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
        })
}

/// Reclaim only allowlisted artifacts that the downloader would replace
/// anyway. This runs after explicit download consent and before the free-space
/// gate, so corrupt finals or unusable partials cannot cause a false low-disk
/// failure.
pub async fn prepare_download_artifacts(
    models_dir: &Path,
    manifest: &[&ModelSpec],
) -> Result<(), DlError> {
    for spec in manifest {
        validate_spec(spec)?;
        if trusted_final(models_dir, spec).await? {
            continue;
        }

        let final_path = models_dir.join(spec.file);
        match fs::symlink_metadata(&final_path).await {
            Ok(_) => fs::remove_file(&final_path).await?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        load_or_init(
            &models_dir.join(format!("{}.part.json", spec.file)),
            spec,
            &models_dir.join(format!("{}.part", spec.file)),
        )
        .await?;
    }
    Ok(())
}

pub async fn download(
    app: AppHandle,
    spec: &ModelSpec,
    models_dir: &Path,
    cancel: Arc<CancellationToken>,
    cumulative_done_before: u64,
    grand_total: u64,
) -> Result<PathBuf, DlError> {
    validate_spec(spec)?;
    fs::create_dir_all(models_dir).await?;

    let final_path = models_dir.join(spec.file);
    let part_path = models_dir.join(format!("{}.part", spec.file));
    let state_path = models_dir.join(format!("{}.part.json", spec.file));
    for path in [&final_path, &part_path, &state_path] {
        reject_symlink(path).await?;
    }

    if trusted_final(models_dir, spec).await? {
        info!(file = %final_path.display(), "using verified model");
        return Ok(final_path);
    }

    if fs::metadata(&final_path).await.is_ok() {
        fs::remove_file(&final_path).await?;
    }

    let mut state = load_or_init(&state_path, spec, &part_path).await?;
    let client = build_client()?;
    let mut backoff = ExpBackoff::new(Duration::from_secs(1), Duration::from_secs(60));
    let mut retries = 0u8;
    let mut range_resets = 0u8;
    const MAX_RETRIES: u8 = 8;

    if state.downloaded < spec.bytes {
        loop {
            if cancel.is_cancelled() {
                return Err(DlError::Cancelled);
            }
            let attempt_offset = state.downloaded;
            match stream_once(
                &client,
                &mut state,
                &part_path,
                &state_path,
                spec,
                Some(&app),
                cancel.clone(),
                cumulative_done_before,
                grand_total,
            )
            .await
            {
                Ok(()) => break,
                Err(DlError::Cancelled) => return Err(DlError::Cancelled),
                Err(DlError::Status(416)) => {
                    range_resets += 1;
                    if range_resets > 1 {
                        return Err(DlError::Other(
                            "server repeatedly rejected a fresh model download range".into(),
                        ));
                    }
                    reset_partial(&part_path, &state_path, &mut state).await?;
                }
                Err(error) if retryable(&error) => {
                    reset_retry_after_progress(
                        attempt_offset,
                        state.downloaded,
                        &mut retries,
                        &mut backoff,
                    );
                    retries += 1;
                    if retries >= MAX_RETRIES {
                        return Err(DlError::Other(format!(
                            "model download failed after {MAX_RETRIES} attempts: {error}"
                        )));
                    }
                    warn!(%error, "transient model download failure; retrying");
                    tokio::select! {
                        _ = cancel.cancelled() => return Err(DlError::Cancelled),
                        _ = tokio::time::sleep(backoff.next()) => {}
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }

    let size = fs::metadata(&part_path).await?.len();
    if size != spec.bytes {
        return Err(DlError::SizeMismatch {
            expected: spec.bytes,
            got: size,
        });
    }
    let got = sha256_file(&part_path, Some(cancel.as_ref())).await?;
    if !got.eq_ignore_ascii_case(spec.sha256) {
        let _ = fs::remove_file(&part_path).await;
        let _ = fs::remove_file(&state_path).await;
        return Err(DlError::ChecksumMismatch {
            expected: spec.sha256.into(),
            got,
        });
    }

    reject_symlink(&part_path).await?;
    match fs::symlink_metadata(&final_path).await {
        Ok(_) => {
            return Err(DlError::Other(format!(
                "model destination appeared during download: {}",
                final_path.display()
            )))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    fs::hard_link(&part_path, &final_path).await?;
    fs::remove_file(&part_path).await?;
    let _ = fs::remove_file(&state_path).await;
    verified_files().lock().await.insert(final_path.clone());
    Ok(final_path)
}

fn validate_spec(spec: &ModelSpec) -> Result<(), DlError> {
    let hash_ok =
        spec.sha256.len() == 64 && spec.sha256.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !hash_ok || spec.bytes == 0 {
        return Err(DlError::InvalidSpec(spec.id.into()));
    }
    let revision = spec
        .url
        .strip_prefix("https://huggingface.co/")
        .and_then(|path| path.split_once("/resolve/"))
        .and_then(|(_, resolved)| resolved.split_once('/'))
        .map(|(revision, _)| revision);
    let immutable = revision.is_some_and(|revision| {
        revision.len() == 40 && revision.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    let mut components = Path::new(spec.file).components();
    let safe_file = matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none();
    if !immutable || !safe_file {
        return Err(DlError::InvalidSpec(format!(
            "{} does not use an immutable Hugging Face URL",
            spec.id
        )));
    }
    Ok(())
}

async fn trusted_final(models_dir: &Path, spec: &ModelSpec) -> Result<bool, DlError> {
    let final_path = models_dir.join(spec.file);
    reject_symlink(&final_path).await?;
    let metadata = match fs::metadata(&final_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() != spec.bytes {
        return Ok(false);
    }
    if verified_files().lock().await.contains(&final_path) {
        return Ok(true);
    }
    let matches = sha256_file(&final_path, None)
        .await?
        .eq_ignore_ascii_case(spec.sha256);
    if matches {
        verified_files().lock().await.insert(final_path);
    }
    Ok(matches)
}

fn verified_files() -> &'static tokio::sync::Mutex<HashSet<PathBuf>> {
    VERIFIED_FILES.get_or_init(|| tokio::sync::Mutex::new(HashSet::new()))
}

async fn resumable_bytes(models_dir: &Path, spec: &ModelSpec) -> Result<u64, DlError> {
    let state_path = models_dir.join(format!("{}.part.json", spec.file));
    let part_path = models_dir.join(format!("{}.part", spec.file));
    reject_symlink(&state_path).await?;
    reject_symlink(&part_path).await?;
    let Ok(bytes) = fs::read(state_path).await else {
        return Ok(0);
    };
    let Ok(state) = serde_json::from_slice::<State>(&bytes) else {
        return Ok(0);
    };
    if state.url != spec.url
        || state.total != spec.bytes
        || !state.sha256_expected.eq_ignore_ascii_case(spec.sha256)
    {
        return Ok(0);
    }
    let on_disk = fs::metadata(part_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(state.downloaded.min(on_disk).min(spec.bytes))
}

async fn load_or_init(
    state_path: &Path,
    spec: &ModelSpec,
    part_path: &Path,
) -> Result<State, DlError> {
    reject_symlink(state_path).await?;
    reject_symlink(part_path).await?;
    if let Ok(bytes) = fs::read(state_path).await {
        if let Ok(mut state) = serde_json::from_slice::<State>(&bytes) {
            if state.url == spec.url
                && state.total == spec.bytes
                && state.sha256_expected.eq_ignore_ascii_case(spec.sha256)
            {
                let on_disk = fs::metadata(part_path)
                    .await
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                state.downloaded = state.downloaded.min(on_disk).min(spec.bytes);
                if on_disk != state.downloaded {
                    OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(false)
                        .open(part_path)
                        .await?
                        .set_len(state.downloaded)
                        .await?;
                }
                return Ok(state);
            }
        }
    }

    if fs::metadata(part_path).await.is_ok() {
        OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(part_path)
            .await?;
    }
    let state = State {
        url: spec.url.into(),
        total: spec.bytes,
        downloaded: 0,
        sha256_expected: spec.sha256.into(),
        etag: None,
    };
    save_state(state_path, &state).await?;
    Ok(state)
}

async fn save_state(path: &Path, state: &State) -> Result<(), DlError> {
    let bytes = serde_json::to_vec(state)
        .map_err(|error| DlError::Other(format!("serialize download state: {error}")))?;
    atomic_write(path, &bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), DlError> {
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(DlError::Other(format!(
            "refusing symlinked model metadata {}",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .ok_or_else(|| DlError::Other("model metadata path has no parent".into()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| DlError::Other("model metadata filename is invalid".into()))?;
    let temporary = parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    if std::fs::symlink_metadata(&temporary).is_ok() {
        return Err(DlError::Other(format!(
            "model metadata temporary path already exists: {}",
            temporary.display()
        )));
    }

    let result = (|| -> Result<(), std::io::Error> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);

        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let mut from: Vec<u16> = temporary.as_os_str().encode_wide().collect();
            let mut to: Vec<u16> = path.as_os_str().encode_wide().collect();
            from.push(0);
            to.push(0);
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        #[cfg(not(windows))]
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(DlError::from)
}

#[allow(clippy::too_many_arguments)]
async fn stream_once(
    client: &reqwest::Client,
    state: &mut State,
    part_path: &Path,
    state_path: &Path,
    spec: &ModelSpec,
    app: Option<&AppHandle>,
    cancel: Arc<CancellationToken>,
    cumulative_done_before: u64,
    grand_total: u64,
) -> Result<(), DlError> {
    let requested_offset = state.downloaded;
    let mut headers = HeaderMap::new();
    if requested_offset > 0 {
        headers.insert(
            RANGE,
            HeaderValue::from_str(&format!("bytes={requested_offset}-"))
                .map_err(|error| DlError::Other(error.to_string()))?,
        );
        if let Some(etag) = &state.etag {
            if let Ok(value) = HeaderValue::from_str(etag) {
                headers.insert(IF_RANGE, value);
            }
        }
    }

    let response = await_response(
        client.get(&state.url).headers(headers).send(),
        cancel.as_ref(),
        Duration::from_secs(30),
    )
    .await?;
    let status = response.status();

    if status == reqwest::StatusCode::OK {
        if let Some(length) = response.content_length() {
            if length != spec.bytes {
                return Err(DlError::SizeMismatch {
                    expected: spec.bytes,
                    got: length,
                });
            }
        }
        state.downloaded = 0;
        state.etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        reject_symlink(part_path).await?;
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(part_path)
            .await?;
    } else if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let range_ok = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| content_range_starts_at(value, requested_offset));
        if !range_ok {
            return Err(DlError::Other("invalid Content-Range response".into()));
        }
        if let Some(length) = response.content_length() {
            let expected = spec.bytes.saturating_sub(requested_offset);
            if length != expected {
                return Err(DlError::SizeMismatch {
                    expected,
                    got: length,
                });
            }
        }
        if state.etag.is_none() {
            state.etag = response
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
        }
    } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Err(DlError::Status(416));
    } else {
        return Err(DlError::Status(status.as_u16()));
    }

    reject_symlink(part_path).await?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .await?;
    let mut stream = response.bytes_stream();
    let mut unsaved = 0u64;
    let mut window_bytes = 0u64;
    let mut last_emit = Instant::now();

    loop {
        let next = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(DlError::Cancelled),
            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                return Err(DlError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "no model bytes received for 30 seconds",
                )));
            }
            next = stream.next() => next,
        };
        let Some(chunk) = next else {
            break;
        };
        let bytes = chunk?;
        let next_total = state.downloaded.saturating_add(bytes.len() as u64);
        if next_total > spec.bytes {
            return Err(DlError::SizeMismatch {
                expected: spec.bytes,
                got: next_total,
            });
        }
        file.write_all(&bytes).await?;
        state.downloaded = next_total;
        unsaved += bytes.len() as u64;
        window_bytes += bytes.len() as u64;

        let elapsed = last_emit.elapsed();
        if unsaved >= 5 * 1024 * 1024 || elapsed >= Duration::from_millis(500) {
            file.flush().await?;
            save_state(state_path, state).await?;
            let bps = (window_bytes as f64 / elapsed.as_secs_f64().max(0.001)) as u64;
            if let Some(app) = app {
                emit_progress(
                    app,
                    spec,
                    cumulative_done_before + state.downloaded,
                    grand_total,
                    bps,
                )
                .await;
            }
            unsaved = 0;
            window_bytes = 0;
            last_emit = Instant::now();
        }
    }

    file.flush().await?;
    save_state(state_path, state).await?;
    if state.downloaded != spec.bytes {
        return Err(DlError::Io(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            format!(
                "model response ended at {} of {} bytes",
                state.downloaded, spec.bytes
            ),
        )));
    }
    if let Some(app) = app {
        emit_progress(
            app,
            spec,
            cumulative_done_before + state.downloaded,
            grand_total,
            0,
        )
        .await;
    }
    Ok(())
}

async fn emit_progress(
    app: &AppHandle,
    spec: &ModelSpec,
    downloaded: u64,
    total: u64,
    bytes_per_sec: u64,
) {
    let eta_secs = total
        .saturating_sub(downloaded)
        .checked_div(bytes_per_sec)
        .unwrap_or(0);
    let progress = Progress {
        model_id: spec.id.into(),
        downloaded,
        total,
        bytes_per_sec,
        eta_secs,
    };
    let _ = app.emit("download://progress", progress);

    if let Some(state) = app.try_state::<AppState>() {
        let snapshot = {
            let mut setup = state.setup.lock().await;
            apply_progress(&mut setup, spec, downloaded, total, bytes_per_sec, eta_secs);
            setup.clone()
        };
        let _ = app.emit("setup://state", snapshot);
    }
}

fn apply_progress(
    setup: &mut crate::state::SetupState,
    spec: &ModelSpec,
    downloaded: u64,
    total: u64,
    bytes_per_sec: u64,
    eta_secs: u64,
) {
    setup.model_id = Some(spec.id.into());
    setup.downloaded = downloaded;
    setup.total = total;
    setup.bytes_per_sec = bytes_per_sec;
    setup.eta_secs = eta_secs;
}

fn content_range_starts_at(value: &str, expected: u64) -> bool {
    value
        .strip_prefix("bytes ")
        .and_then(|rest| rest.split_once('-'))
        .and_then(|(start, _)| start.parse::<u64>().ok())
        == Some(expected)
}

fn retryable(error: &DlError) -> bool {
    match error {
        DlError::Http(_) => true,
        DlError::Status(429) => true,
        DlError::Status(status) => (500..=599).contains(status),
        DlError::Io(error) => matches!(
            error.kind(),
            std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::UnexpectedEof
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::Interrupted
        ),
        _ => false,
    }
}

fn reset_retry_after_progress(before: u64, after: u64, retries: &mut u8, backoff: &mut ExpBackoff) {
    if after > before {
        *retries = 0;
        backoff.reset();
    }
}

async fn sha256_file(path: &Path, cancel: Option<&CancellationToken>) -> Result<String, DlError> {
    reject_symlink(path).await?;
    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(DlError::Cancelled);
        }
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn reset_partial(
    part_path: &Path,
    state_path: &Path,
    state: &mut State,
) -> Result<(), DlError> {
    reject_symlink(part_path).await?;
    reject_symlink(state_path).await?;
    let _ = fs::remove_file(part_path).await;
    state.downloaded = 0;
    state.etag = None;
    save_state(state_path, state).await
}

struct ExpBackoff {
    initial: Duration,
    current: Duration,
    maximum: Duration,
}

impl ExpBackoff {
    fn new(current: Duration, maximum: Duration) -> Self {
        Self {
            initial: current,
            current,
            maximum,
        }
    }

    fn next(&mut self) -> Duration {
        let current = self.current;
        self.current = (self.current * 2).min(self.maximum);
        current
    }

    fn reset(&mut self) {
        self.current = self.initial;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use registry::ModelRole;
    use tokio::net::TcpListener;

    const HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const ZERO_100_HASH: &str = "cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3";

    fn spec() -> ModelSpec {
        ModelSpec {
            id: "test",
            file: "test.bin",
            url: "https://huggingface.co/example/model/resolve/0123456789012345678901234567890123456789/test.bin",
            sha256: HASH,
            bytes: 100,
            role: ModelRole::Diffusion,
        }
    }

    async fn serve_once(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let _ = socket.read(&mut request).await;
            socket.write_all(&response).await.unwrap();
            socket.shutdown().await.unwrap();
        });
        format!("http://{address}/model")
    }

    #[test]
    fn rejects_unpinned_or_unhashed_specs() {
        let mut invalid = spec();
        invalid.url = "https://huggingface.co/example/model/resolve/main/test.bin";
        assert!(validate_spec(&invalid).is_err());
        invalid.url = spec().url;
        invalid.sha256 = "TODO";
        assert!(validate_spec(&invalid).is_err());
        invalid = spec();
        invalid.url = "https://huggingface.co/example/model/resolve/dev/test.bin";
        assert!(validate_spec(&invalid).is_err());
    }

    #[test]
    fn retries_timeout_rate_limit_and_server_errors_only() {
        assert!(retryable(&DlError::Status(429)));
        assert!(retryable(&DlError::Status(503)));
        assert!(retryable(&DlError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "timeout"
        ))));
        assert!(!retryable(&DlError::Status(404)));
        assert!(!retryable(&DlError::ChecksumMismatch {
            expected: "a".into(),
            got: "b".into(),
        }));
    }

    #[tokio::test]
    async fn response_header_wait_is_bounded_and_cancellable() {
        let cancel = CancellationToken::new();
        let pending = std::future::pending::<Result<reqwest::Response, reqwest::Error>>();
        let error = await_response(pending, &cancel, Duration::from_millis(1))
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            DlError::Io(ref error) if error.kind() == std::io::ErrorKind::TimedOut
        ));

        cancel.cancel();
        let pending = std::future::pending::<Result<reqwest::Response, reqwest::Error>>();
        assert!(matches!(
            await_response(pending, &cancel, Duration::from_secs(60)).await,
            Err(DlError::Cancelled)
        ));
    }

    #[test]
    fn successful_progress_resets_retry_budget() {
        let mut retries = 7;
        let mut backoff = ExpBackoff::new(Duration::from_secs(1), Duration::from_secs(60));
        assert_eq!(backoff.next(), Duration::from_secs(1));
        reset_retry_after_progress(10, 20, &mut retries, &mut backoff);
        assert_eq!(retries, 0);
        assert_eq!(backoff.next(), Duration::from_secs(1));
    }

    #[test]
    fn late_progress_never_reactivates_a_paused_setup() {
        let model = spec();
        let mut setup = crate::state::SetupState {
            phase: "paused".into(),
            ..Default::default()
        };
        apply_progress(&mut setup, &model, 50, 100, 10, 5);
        assert_eq!(setup.phase, "paused");
        assert_eq!(setup.downloaded, 50);
    }

    #[test]
    fn content_range_must_match_requested_offset() {
        assert!(content_range_starts_at("bytes 50-99/100", 50));
        assert!(!content_range_starts_at("bytes 0-49/100", 50));
        assert!(!content_range_starts_at("garbage", 0));
    }

    #[tokio::test]
    async fn stream_restarts_on_200_and_resumes_on_valid_206() {
        let directory = tempfile::tempdir().unwrap();
        let part = directory.path().join("model.part");
        let state_path = directory.path().join("model.state");
        let mut model = spec();
        model.bytes = 4;
        let client = reqwest::Client::builder().build().unwrap();
        let cancel = Arc::new(CancellationToken::new());

        fs::write(&part, b"old").await.unwrap();
        let url = serve_once(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnew!".to_vec(),
        )
        .await;
        let mut state = State {
            url,
            total: 4,
            downloaded: 3,
            sha256_expected: HASH.into(),
            etag: Some("old".into()),
        };
        stream_once(
            &client,
            &mut state,
            &part,
            &state_path,
            &model,
            None,
            cancel.clone(),
            0,
            4,
        )
        .await
        .unwrap();
        assert_eq!(fs::read(&part).await.unwrap(), b"new!");

        fs::write(&part, b"ne").await.unwrap();
        state.url = serve_once(
            b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 2-3/4\r\nConnection: close\r\n\r\nw!"
                .to_vec(),
        )
        .await;
        state.downloaded = 2;
        state.etag = None;
        stream_once(
            &client,
            &mut state,
            &part,
            &state_path,
            &model,
            None,
            cancel,
            0,
            4,
        )
        .await
        .unwrap();
        assert_eq!(fs::read(part).await.unwrap(), b"new!");
    }

    #[tokio::test]
    async fn invalid_full_response_does_not_destroy_a_resumable_prefix() {
        let directory = tempfile::tempdir().unwrap();
        let part = directory.path().join("model.part");
        let state_path = directory.path().join("model.state");
        fs::write(&part, b"old").await.unwrap();
        let mut model = spec();
        model.bytes = 4;
        let mut state = State {
            url: serve_once(
                b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad"
                    .to_vec(),
            )
            .await,
            total: 4,
            downloaded: 3,
            sha256_expected: HASH.into(),
            etag: None,
        };
        let result = stream_once(
            &reqwest::Client::new(),
            &mut state,
            &part,
            &state_path,
            &model,
            None,
            Arc::new(CancellationToken::new()),
            0,
            4,
        )
        .await;
        assert!(matches!(result, Err(DlError::SizeMismatch { .. })));
        assert_eq!(fs::read(part).await.unwrap(), b"old");
        assert_eq!(state.downloaded, 3);
    }

    #[tokio::test]
    async fn stream_surfaces_416_for_a_single_safe_reset() {
        let directory = tempfile::tempdir().unwrap();
        let part = directory.path().join("model.part");
        let state_path = directory.path().join("model.state");
        fs::write(&part, b"old").await.unwrap();
        let mut model = spec();
        model.bytes = 4;
        let mut state = State {
            url: serve_once(
                b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_vec(),
            )
            .await,
            total: 4,
            downloaded: 3,
            sha256_expected: HASH.into(),
            etag: None,
        };
        let result = stream_once(
            &reqwest::Client::new(),
            &mut state,
            &part,
            &state_path,
            &model,
            None,
            Arc::new(CancellationToken::new()),
            0,
            4,
        )
        .await;
        assert!(matches!(result, Err(DlError::Status(416))));
    }

    #[tokio::test]
    async fn complete_file_is_always_hashed_before_reuse() {
        let directory = tempfile::tempdir().unwrap();
        let mut model = spec();
        fs::write(
            directory.path().join(model.file),
            vec![0u8; model.bytes as usize],
        )
        .await
        .unwrap();
        assert!(!trusted_final(directory.path(), &model).await.unwrap());
        model.sha256 = ZERO_100_HASH;
        assert!(trusted_final(directory.path(), &model).await.unwrap());
    }

    #[tokio::test]
    async fn stale_metadata_cleanup_is_exact_and_manifest_scoped() {
        let directory = tempfile::tempdir().unwrap();
        let model = spec();
        let stale = format!(".{}.part.json.{}.tmp", model.file, uuid::Uuid::new_v4());
        let legacy = format!("{}.verified", model.file);
        fs::write(directory.path().join(&stale), b"stale").await.unwrap();
        fs::write(directory.path().join(&legacy), b"legacy").await.unwrap();
        fs::write(directory.path().join("unrelated.tmp"), b"keep")
            .await
            .unwrap();

        assert_eq!(cleanup_stale_metadata(directory.path(), &[&model]).await.unwrap(), 2);
        assert!(!directory.path().join(stale).exists());
        assert!(!directory.path().join(legacy).exists());
        assert!(directory.path().join("unrelated.tmp").exists());
    }

    #[tokio::test]
    async fn remaining_bytes_counts_only_untrusted_content() {
        let directory = tempfile::tempdir().unwrap();
        let model = spec();
        fs::write(
            directory.path().join(format!("{}.part", model.file)),
            vec![0u8; 40],
        )
        .await
        .unwrap();
        assert_eq!(
            remaining_bytes(directory.path(), &[&model]).await.unwrap(),
            100,
            "a part without matching state must not reduce preflight"
        );
        let state = State {
            url: model.url.into(),
            total: model.bytes,
            downloaded: 40,
            sha256_expected: model.sha256.into(),
            etag: None,
        };
        save_state(
            &directory.path().join(format!("{}.part.json", model.file)),
            &state,
        )
        .await
        .unwrap();
        assert_eq!(
            remaining_bytes(directory.path(), &[&model]).await.unwrap(),
            60
        );
    }

    #[tokio::test]
    async fn state_mismatch_discards_unsafe_partial() {
        let directory = tempfile::tempdir().unwrap();
        let model = spec();
        let state_path = directory.path().join("test.bin.part.json");
        let part_path = directory.path().join("test.bin.part");
        fs::write(&part_path, vec![1u8; 50]).await.unwrap();
        let stale = State {
            url: model.url.into(),
            total: model.bytes,
            downloaded: 50,
            sha256_expected: "0".repeat(64),
            etag: None,
        };
        save_state(&state_path, &stale).await.unwrap();
        let loaded = load_or_init(&state_path, &model, &part_path).await.unwrap();
        assert_eq!(loaded.downloaded, 0);
        assert_eq!(fs::metadata(part_path).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn consented_preflight_reclaims_invalid_final_and_preserves_valid_partial() {
        let directory = tempfile::tempdir().unwrap();
        let model = spec();
        let final_path = directory.path().join(model.file);
        let part_path = directory.path().join(format!("{}.part", model.file));
        let state_path = directory.path().join(format!("{}.part.json", model.file));
        fs::write(&final_path, vec![1u8; model.bytes as usize])
            .await
            .unwrap();
        fs::write(&part_path, vec![0u8; 40]).await.unwrap();
        save_state(
            &state_path,
            &State {
                url: model.url.into(),
                total: model.bytes,
                downloaded: 40,
                sha256_expected: model.sha256.into(),
                etag: None,
            },
        )
        .await
        .unwrap();

        prepare_download_artifacts(directory.path(), &[&model])
            .await
            .unwrap();
        assert!(!final_path.exists());
        assert_eq!(fs::metadata(part_path).await.unwrap().len(), 40);
        assert_eq!(
            remaining_bytes(directory.path(), &[&model]).await.unwrap(),
            60
        );
    }

    #[tokio::test]
    async fn state_replace_is_complete_and_leaves_no_temp_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let mut state = State {
            url: "first".into(),
            total: 100,
            downloaded: 10,
            sha256_expected: HASH.into(),
            etag: None,
        };
        save_state(&path, &state).await.unwrap();
        state.downloaded = 90;
        save_state(&path, &state).await.unwrap();
        let loaded: State = serde_json::from_slice(&fs::read(path).await.unwrap()).unwrap();
        assert_eq!(loaded.downloaded, 90);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn model_directory_lock_rejects_a_second_writer() {
        let directory = tempfile::tempdir().unwrap();
        let first = ModelDirLock::try_acquire(directory.path()).unwrap();
        assert!(ModelDirLock::try_acquire(directory.path()).is_err());
        drop(first);
        assert!(ModelDirLock::try_acquire(directory.path()).is_ok());
    }

    #[test]
    fn instance_lock_prevents_two_gpu_owners() {
        let directory = tempfile::tempdir().unwrap();
        let first = InstanceLock::try_acquire(directory.path()).unwrap();
        assert!(InstanceLock::try_acquire(directory.path()).is_err());
        drop(first);
        assert!(InstanceLock::try_acquire(directory.path()).is_ok());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn model_paths_reject_symlinks_before_following_them() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");
        let link = directory.path().join("model.bin");
        std::fs::write(&target, b"do not touch").unwrap();
        symlink(&target, &link).unwrap();
        assert!(reject_symlink(&link).await.is_err());
        assert!(atomic_write(&link, b"replacement").is_err());
        assert_eq!(std::fs::read(target).unwrap(), b"do not touch");
    }
}
