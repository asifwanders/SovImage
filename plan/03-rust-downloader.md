# 03 — Rust Resilient Downloader

Async, restartable, SHA256-verified GGUF downloader. Crate deps: `tokio`,
`reqwest` (rustls), `tokio-util`, `sha2`, `serde`, `thiserror`, `tracing`.

## Tiered model selection

```rust
// src-tauri/src/hardware/profile.rs
pub fn detect_tier() -> Tier {
    let bytes = total_addressable_memory(); // unified mem on mac, VRAM-or-RAM on win
    match bytes / (1024 * 1024 * 1024) {
        0..=11   => Tier::One,
        12..=16  => Tier::Two,
        _        => Tier::Three,
    }
}
```

- **macOS arm64**: `sysctl hw.memsize` for unified memory.
- **Windows x64 + NVIDIA**: `nvml-wrapper` for VRAM. Fallback to
  `GlobalMemoryStatusEx` system RAM if NVML init fails (still NVIDIA-only
  target — surface clear error on non-NVIDIA, see fallback policy below).

## Model registry (compile-time constants)

```rust
// src-tauri/src/downloader/registry.rs
pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,          // local filename
    pub url:  &'static str,          // canonical https url
    pub sha256: &'static str,        // expected lowercase hex
    pub bytes: u64,
}

pub const MODELS: &[(Tier, ModelSpec)] = &[
    (Tier::One,   ModelSpec { id: "flux1-schnell-q4_0", ... }),
    (Tier::Two,   ModelSpec { id: "flux1-schnell-q8_0", ... }),
    (Tier::Three, ModelSpec { id: "flux1-dev-q8_0",     ... }),
];
```

URLs + checksums populated after the model-source decision is made (deferred
this sprint). Stub values + a `feature = "stub_downloader"` flag let the
frontend test the splash flow end-to-end.

## Storage

Per-file state next to the partial download:

```
<app_data>/models/
  flux1-schnell-q4_0.gguf.part        ← partial bytes
  flux1-schnell-q4_0.gguf.part.json   ← state
  flux1-schnell-q4_0.gguf             ← final, only after sha256 ok
```

`download_state.json`:

```json
{
  "url": "https://...",
  "total": 6500000000,
  "downloaded": 1234567890,
  "sha256_expected": "abc…",
  "etag": "\"…\"",
  "last_modified": "Mon, 22 Apr 2025 …"
}
```

## Algorithm

```rust
pub async fn download(spec: &ModelSpec, win: &Window) -> Result<PathBuf, DlError> {
    let dir = app_data_dir()?.join("models");
    fs::create_dir_all(&dir).await?;

    let part = dir.join(format!("{}.part", spec.file));
    let final_ = dir.join(spec.file);
    let state_path = part.with_extension("part.json");

    // Short-circuit if final exists and verifies.
    if final_.exists() && verify_sha256(&final_, spec.sha256).await? {
        return Ok(final_);
    }

    let mut state = State::load_or_init(&state_path, spec).await?;
    let client = build_client()?;

    let mut backoff = ExpBackoff::new(Duration::from_secs(1), Duration::from_secs(60));

    loop {
        match stream_chunks(&client, &mut state, &part, win).await {
            Ok(()) => break,
            Err(DlError::Net(_)) if !cancel_requested() => {
                tokio::time::sleep(backoff.next()).await;
                continue;
            }
            Err(e) => return Err(e),
        }
    }

    // Verify, atomically rename.
    if !verify_sha256(&part, spec.sha256).await? {
        fs::remove_file(&part).await.ok();
        fs::remove_file(&state_path).await.ok();
        return Err(DlError::ChecksumMismatch);
    }
    fs::rename(&part, &final_).await?;
    fs::remove_file(&state_path).await.ok();
    Ok(final_)
}
```

`stream_chunks` opens the partial in append mode, sends
`Range: bytes=<downloaded>-`, reads the response body in 256 KiB chunks,
writes, advances `state.downloaded`, persists state every 5 MiB or every
500 ms (whichever first), and emits

```rust
win.emit("download://progress", Progress {
    model_id, downloaded, total, bytes_per_sec, eta_secs,
})?;
```

## Cancellation / pause

- Cancellation token (`tokio_util::sync::CancellationToken`) wired to a
  Tauri command `download_cancel`.
- Pause → drop the in-flight response; partial + state remain on disk; the
  loop exits at the next chunk boundary. Resume = re-invoke `download`.

## Integrity

- SHA256 streamed (`sha2::Sha256`) over the **final file**, not chunks (cheap
  to recompute, robust against state-file corruption).
- ETag/Last-Modified persisted in state. On resume, if the server returns
  `200` (not `206`) or a different ETag, the file changed upstream → wipe
  partial + restart from 0.

## Failure modes

| Failure                             | Action                                         |
|-------------------------------------|------------------------------------------------|
| Network drop                        | Exponential backoff + retry, keep partial      |
| Disk full                           | Surface `DlError::Disk`, UI shows actionable msg |
| Checksum mismatch                   | Delete partial + state, restart from 0         |
| Server 416 (range not satisfiable)  | Truncate partial to 0, restart                 |
| Server 200 with full body           | Wipe partial, accept stream                    |
| User cancel                         | Stop loop, leave partial for resume            |

## Fallback policy (non-NVIDIA on Windows)

In sprint targets we support **Apple Silicon + Windows NVIDIA only**. If the
profiler detects Windows without a usable NVIDIA GPU, splash shows an
"Unsupported hardware" panel with a link to the issue tracker — no model is
downloaded. (Future tier-0 CPU fallback tracked but out-of-scope.)

## Tauri commands exposed

```rust
#[tauri::command] async fn setup_profile(...) -> Result<Tier, AppError>;
#[tauri::command] async fn setup_start_download(...) -> Result<(), AppError>;
#[tauri::command] async fn setup_pause(...) -> Result<(), AppError>;
#[tauri::command] async fn setup_resume(...) -> Result<(), AppError>;
#[tauri::command] async fn setup_state(...) -> Result<SetupState, AppError>;
```

## Sprint stub

While Rust impl is deferred, ship:

- `setup_state` returning a hardcoded `{ tier: 3, download_done: false }`.
- `setup_start_download` spawning a fake task that emits
  `download://progress` events at 50 MB/s ramping to 100 % over ~10 s, then
  a `verify` event, then `done`. Frontend renders the splash exactly as it
  will in production.
