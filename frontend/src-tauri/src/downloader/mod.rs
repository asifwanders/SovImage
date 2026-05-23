//! Resilient model downloader.
//!
//! Per `plan/03`:
//! - HTTP Range resume on every chunk.
//! - SHA256 verification post-download (placeholder `"TODO"` in registry
//!   currently disables verify; downloader logs a warning instead of failing).
//! - Persistent per-file state.json so closing the app mid-download survives.
//! - Exponential backoff on transient network errors.
//! - Emits typed `download://progress` events on the Tauri window.
//!
//! Concurrency model: one file at a time, in registry order. Total progress
//! is computed by the caller using `registry::total_bytes(tier)` + a running
//! `cumulative_done` counter — keeps splash UI logic dead simple.

pub mod registry;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ETAG, IF_RANGE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use registry::ModelSpec;

#[derive(Debug, Error)]
pub enum DlError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("server returned status {0}")]
    Status(u16),
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

pub fn build_client() -> Result<reqwest::Client, DlError> {
    reqwest::Client::builder()
        .user_agent(concat!("SovImage/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .http2_keep_alive_interval(Duration::from_secs(20))
        .build()
        .map_err(DlError::from)
}

/// Download a single model with full resume / backoff / verify behavior.
///
/// `cumulative_done_before` lets the caller fold per-file progress into a
/// global splash bar without the downloader needing to know the manifest.
pub async fn download(
    app: AppHandle,
    spec: &ModelSpec,
    models_dir: &Path,
    cancel: Arc<CancellationToken>,
    cumulative_done_before: u64,
    grand_total: u64,
) -> Result<PathBuf, DlError> {
    fs::create_dir_all(models_dir).await?;

    let final_path = models_dir.join(spec.file);
    let part_path = models_dir.join(format!("{}.part", spec.file));
    let state_path = models_dir.join(format!("{}.part.json", spec.file));

    // Short-circuit if the final file exists and verifies (or verify is
    // disabled by the registry).
    if final_path.exists() {
        if verify_or_skip(&final_path, spec.sha256).await? {
            info!(file = %final_path.display(), "final file present + verified");
            return Ok(final_path);
        } else {
            warn!(file = %final_path.display(), "final file present but bad sha256, re-downloading");
            fs::remove_file(&final_path).await?;
        }
    }

    let mut state = load_or_init(&state_path, spec, &part_path).await?;
    let client = build_client()?;

    let mut backoff = ExpBackoff::new(Duration::from_secs(1), Duration::from_secs(60));

    loop {
        if cancel.is_cancelled() {
            return Err(DlError::Cancelled);
        }
        match stream_once(
            &client,
            &mut state,
            &part_path,
            &state_path,
            spec,
            &app,
            cancel.clone(),
            cumulative_done_before,
            grand_total,
        )
        .await
        {
            Ok(()) => break,
            Err(DlError::Cancelled) => return Err(DlError::Cancelled),
            Err(DlError::Http(e)) => {
                warn!(error = %e, "network error, backing off");
                // Cancel-aware sleep — Pause must not block for up to 60 s.
                let dur = backoff.next();
                tokio::select! {
                    _ = cancel.cancelled() => return Err(DlError::Cancelled),
                    _ = tokio::time::sleep(dur) => {}
                }
                continue;
            }
            Err(DlError::Status(416)) => {
                // Range not satisfiable — partial file is bogus.
                warn!("server returned 416; restarting from 0");
                reset_after_416(&part_path, &state_path, &mut state).await?;
                continue;
            }
            Err(e) => return Err(e),
        }
    }

    // Verify (or skip if registry has no sha256 yet).
    if !verify_or_skip(&part_path, spec.sha256).await? {
        let _ = fs::remove_file(&part_path).await;
        let _ = fs::remove_file(&state_path).await;
        return Err(DlError::ChecksumMismatch {
            expected: spec.sha256.into(),
            got: "(see logs)".into(),
        });
    }

    fs::rename(&part_path, &final_path).await?;
    let _ = fs::remove_file(&state_path).await;
    Ok(final_path)
}

async fn load_or_init(
    state_path: &Path,
    spec: &ModelSpec,
    part_path: &Path,
) -> Result<State, DlError> {
    if let Ok(buf) = fs::read(state_path).await {
        if let Ok(mut s) = serde_json::from_slice::<State>(&buf) {
            // Re-validate against the on-disk part file size. Two failure
            // modes to handle:
            //
            // a) on_disk < state.downloaded — state was saved after a write
            //    that the FS later truncated (OS kill mid-write). Trust the
            //    file; rewind state.
            // b) on_disk > state.downloaded — last writes flushed to disk but
            //    state.json never got the corresponding save. Truncate the
            //    file down to state.downloaded so the next Range request
            //    appends to a consistent boundary (no duplicated bytes).
            let on_disk = fs::metadata(part_path).await.map(|m| m.len()).unwrap_or(0);
            if on_disk < s.downloaded {
                s.downloaded = on_disk;
            } else if on_disk > s.downloaded {
                if let Ok(f) = OpenOptions::new().write(true).open(part_path).await {
                    let _ = f.set_len(s.downloaded).await;
                }
            }
            if s.url == spec.url {
                return Ok(s);
            }
        }
    }
    Ok(State {
        url: spec.url.into(),
        total: spec.bytes,
        downloaded: 0,
        sha256_expected: spec.sha256.into(),
        etag: None,
    })
}

async fn save_state(state_path: &Path, state: &State) -> Result<(), DlError> {
    let buf = serde_json::to_vec_pretty(state)
        .map_err(|e| DlError::Other(format!("serialize state: {e}")))?;
    fs::write(state_path, buf).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_once(
    client: &reqwest::Client,
    state: &mut State,
    part_path: &Path,
    state_path: &Path,
    spec: &ModelSpec,
    app: &AppHandle,
    cancel: Arc<CancellationToken>,
    cumulative_done_before: u64,
    grand_total: u64,
) -> Result<(), DlError> {
    let mut headers = HeaderMap::new();
    if state.downloaded > 0 {
        let v = format!("bytes={}-", state.downloaded);
        headers.insert(RANGE, HeaderValue::from_str(&v).unwrap());
        if let Some(etag) = &state.etag {
            if let Ok(h) = HeaderValue::from_str(etag) {
                headers.insert(IF_RANGE, h);
            }
        }
    }

    let resp = client.get(state.url.as_str()).headers(headers).send().await?;
    let status = resp.status();

    if status == reqwest::StatusCode::OK {
        // Server ignored our range or upstream changed — start over. Use
        // explicit truncate-open so any stale bytes are wiped even if
        // remove_file silently fails (Windows AV locks, ENOENT race).
        state.downloaded = 0;
        state.etag = resp
            .headers()
            .get(ETAG)
            .and_then(|v| v.to_str().ok().map(|s| s.to_string()));
        match fs::remove_file(part_path).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(DlError::Io(e)),
        }
        // Pre-truncate by opening with truncate(true); subsequent writes
        // below use append(true) which is well-defined on a freshly
        // truncated file (cursor starts at byte 0 == EOF).
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(part_path)
            .await?;
    } else if status == reqwest::StatusCode::PARTIAL_CONTENT {
        if state.etag.is_none() {
            state.etag = resp
                .headers()
                .get(ETAG)
                .and_then(|v| v.to_str().ok().map(|s| s.to_string()));
        }
    } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Err(DlError::Status(416));
    } else if !status.is_success() {
        return Err(DlError::Status(status.as_u16()));
    }

    // Prefer Content-Length to seed total if registry value was 0.
    if state.total == 0 {
        if let Some(len) = resp.content_length() {
            state.total = state.downloaded + len;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .await?;

    let mut stream = resp.bytes_stream();
    let mut since_save = 0u64;
    let mut last_emit = Instant::now();
    let mut window_bytes = 0u64;

    loop {
        // Race the next chunk against the cancel token. Without this, a
        // stuck connection would block here for the full request timeout
        // before Pause is honored.
        let next = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(DlError::Cancelled),
            c = stream.next() => c,
        };
        let Some(chunk) = next else { break };
        let bytes = chunk?;
        file.write_all(&bytes).await?;
        state.downloaded += bytes.len() as u64;
        since_save += bytes.len() as u64;
        window_bytes += bytes.len() as u64;

        // Persist state at 5 MiB or 500 ms cadence (whichever first).
        let elapsed = last_emit.elapsed();
        if since_save >= 5 * 1024 * 1024 || elapsed >= Duration::from_millis(500) {
            file.flush().await?;
            save_state(state_path, state).await?;

            let secs = elapsed.as_secs_f64().max(0.001);
            let bps = (window_bytes as f64 / secs) as u64;
            let cum = cumulative_done_before + state.downloaded;
            let total = grand_total.max(cum);
            // saturating_sub: server can overshoot the advertised registry
            // size (e.g. mirror serves a slightly larger blob). Underflow
            // would emit u64::MAX through to the UI as a years-long ETA.
            let eta = if bps > 0 {
                total.saturating_sub(cum) / bps
            } else {
                u64::MAX
            };
            let _ = app.emit(
                "download://progress",
                Progress {
                    model_id: spec.id.into(),
                    downloaded: cum,
                    total,
                    bytes_per_sec: bps,
                    eta_secs: eta.min(60 * 60 * 24),
                },
            );

            since_save = 0;
            window_bytes = 0;
            last_emit = Instant::now();
        }
    } // end loop

    file.flush().await?;
    save_state(state_path, state).await?;
    Ok(())
}

async fn verify_or_skip(path: &Path, expected: &str) -> Result<bool, DlError> {
    if expected.is_empty() || expected.eq_ignore_ascii_case("TODO") {
        warn!(
            file = %path.display(),
            "sha256 not pinned in registry; accepting file without verification"
        );
        return Ok(true);
    }
    let got = sha256_file(path).await?;
    Ok(got.eq_ignore_ascii_case(expected))
}

async fn sha256_file(path: &Path) -> Result<String, DlError> {
    let mut f = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{:02x}", b);
    }
    Ok(hex)
}

struct ExpBackoff {
    cur: Duration,
    max: Duration,
}
impl ExpBackoff {
    fn new(initial: Duration, max: Duration) -> Self {
        Self { cur: initial, max }
    }
    fn next(&mut self) -> Duration {
        let v = self.cur;
        self.cur = (self.cur * 2).min(self.max);
        v
    }
}

/// Reset persistent download state after a 416 Range Not Satisfiable
/// response. The partial file is bogus (server says our offset is past EOF
/// or the upstream blob shrank), so we remove it and rewind `downloaded` to
/// 0. The next `stream_once` call will issue a plain GET.
///
/// Extracted as a free function purely so unit tests can drive it without an
/// `AppHandle`. Behavior mirrors the inline branch in `download()`.
async fn reset_after_416(
    part_path: &Path,
    state_path: &Path,
    state: &mut State,
) -> Result<(), DlError> {
    let _ = fs::remove_file(part_path).await;
    state.downloaded = 0;
    save_state(state_path, state).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use registry::ModelRole;
    use tokio::io::AsyncWriteExt as _;
    use tokio::net::TcpListener;

    #[test]
    fn exp_backoff_caps() {
        let mut b = ExpBackoff::new(Duration::from_secs(1), Duration::from_secs(8));
        assert_eq!(b.next(), Duration::from_secs(1));
        assert_eq!(b.next(), Duration::from_secs(2));
        assert_eq!(b.next(), Duration::from_secs(4));
        assert_eq!(b.next(), Duration::from_secs(8));
        assert_eq!(b.next(), Duration::from_secs(8));
    }

    fn fake_spec(url: &'static str) -> ModelSpec {
        ModelSpec {
            id: "test-model",
            file: "test.bin",
            url,
            sha256: "TODO",
            bytes: 1024,
            role: ModelRole::Diffusion,
        }
    }

    async fn write_state(path: &Path, state: &State) {
        let buf = serde_json::to_vec_pretty(state).unwrap();
        fs::write(path, buf).await.unwrap();
    }

    #[tokio::test]
    async fn load_or_init_returns_fresh_state_on_url_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let state_path = dir.path().join("test.bin.part.json");
        let part_path = dir.path().join("test.bin.part");

        // Persisted state references an old URL.
        let persisted = State {
            url: "https://old.example.com/blob".into(),
            total: 9999,
            downloaded: 4444,
            sha256_expected: "deadbeef".into(),
            etag: Some("\"old-etag\"".into()),
        };
        write_state(&state_path, &persisted).await;
        // A stray part file shouldn't change the verdict — URL mismatch is
        // authoritative.
        fs::write(&part_path, vec![0u8; 200]).await.unwrap();

        let spec = fake_spec("https://new.example.com/blob");
        let got = load_or_init(&state_path, &spec, &part_path).await.unwrap();

        assert_eq!(got.url, "https://new.example.com/blob");
        assert_eq!(got.downloaded, 0);
        assert_eq!(got.total, spec.bytes);
        assert!(got.etag.is_none());
    }

    #[tokio::test]
    async fn load_or_init_rewinds_state_when_part_file_is_short() {
        let dir = tempfile::tempdir().unwrap();
        let state_path = dir.path().join("test.bin.part.json");
        let part_path = dir.path().join("test.bin.part");

        let url = "https://example.com/blob";
        let persisted = State {
            url: url.into(),
            total: 4096,
            downloaded: 1000,
            sha256_expected: "TODO".into(),
            etag: None,
        };
        write_state(&state_path, &persisted).await;
        // Part file is only 500 bytes on disk — OS truncated a buffered write.
        fs::write(&part_path, vec![0u8; 500]).await.unwrap();

        let spec = fake_spec(url);
        let got = load_or_init(&state_path, &spec, &part_path).await.unwrap();

        assert_eq!(got.downloaded, 500, "state should rewind to on-disk size");
        let on_disk = fs::metadata(&part_path).await.unwrap().len();
        assert_eq!(on_disk, 500, "part file untouched on rewind");
    }

    #[tokio::test]
    async fn load_or_init_truncates_part_when_file_overshoots_state() {
        let dir = tempfile::tempdir().unwrap();
        let state_path = dir.path().join("test.bin.part.json");
        let part_path = dir.path().join("test.bin.part");

        let url = "https://example.com/blob";
        let persisted = State {
            url: url.into(),
            total: 4096,
            downloaded: 500,
            sha256_expected: "TODO".into(),
            etag: None,
        };
        write_state(&state_path, &persisted).await;
        // Part file has more bytes than state recorded — a flush succeeded
        // after the last save. Next Range request would otherwise duplicate
        // bytes 500..1000.
        fs::write(&part_path, vec![0xAB; 1000]).await.unwrap();

        let spec = fake_spec(url);
        let got = load_or_init(&state_path, &spec, &part_path).await.unwrap();

        assert_eq!(got.downloaded, 500, "state.downloaded must not move up");
        let on_disk = fs::metadata(&part_path).await.unwrap().len();
        assert_eq!(on_disk, 500, "part file must be truncated to state size");
    }

    /// Minimal HTTP/1.1 server: accepts one connection, reads the request
    /// (until `\r\n\r\n`), serves `response` bytes verbatim, closes. Returns
    /// the bound port so the test can target 127.0.0.1:{port}.
    async fn one_shot_http(response: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                // Drain the request headers — we don't care about the body.
                let mut buf = [0u8; 1024];
                let mut total = 0usize;
                loop {
                    let n = match sock.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    total += n;
                    // Cheap header-terminator check across the rolling buf.
                    if total >= 4 && buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let _ = sock.write_all(response).await;
                let _ = sock.shutdown().await;
            }
        });
        port
    }

    #[tokio::test]
    async fn handles_416_by_resetting_state_and_removing_part() {
        // Spin up a server that always returns 416. Make a Range request
        // against it, confirm reqwest sees 416, then drive the same reset
        // helper `download()` invokes on that branch and assert post-state.
        let response: &'static [u8] =
            b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let port = one_shot_http(response).await;

        let dir = tempfile::tempdir().unwrap();
        let part_path = dir.path().join("test.bin.part");
        let state_path = dir.path().join("test.bin.part.json");

        // Seed: a stale part file + state that points at an out-of-range
        // offset — the situation `download()` finds itself in when the
        // upstream blob shrank between sessions.
        fs::write(&part_path, vec![0u8; 800]).await.unwrap();
        let mut state = State {
            url: format!("http://127.0.0.1:{port}/blob"),
            total: 1024,
            downloaded: 800,
            sha256_expected: "TODO".into(),
            etag: None,
        };
        write_state(&state_path, &state).await;

        // Real Range request — proves the server actually returns 416 and
        // that our status check matches the branch taken in `stream_once`.
        let client = build_client().unwrap();
        let resp = client
            .get(&state.url)
            .header(RANGE, format!("bytes={}-", state.downloaded))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 416);

        // Mirror the action `download()` takes on the 416 branch.
        reset_after_416(&part_path, &state_path, &mut state)
            .await
            .unwrap();

        assert_eq!(state.downloaded, 0);
        assert!(
            !part_path.exists(),
            "part file must be removed after 416 reset"
        );
        // State file should now reflect the reset.
        let on_disk: State =
            serde_json::from_slice(&fs::read(&state_path).await.unwrap()).unwrap();
        assert_eq!(on_disk.downloaded, 0);
    }
}
