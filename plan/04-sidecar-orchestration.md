# 04 — sd.cpp Sidecar Orchestration

`stable-diffusion.cpp` runs as a Tauri sidecar. One long-lived child per app
session; we spawn lazily on first generation request and reuse for
subsequent prompts to avoid model reload cost.

## Build / bundling

- **macOS arm64**: build sd.cpp with `-DSD_METAL=ON` in CI (GitHub Actions
  `macos-14`), strip, sign + notarize, drop in `src-tauri/binaries/sd-aarch64-apple-darwin`.
- **Windows x64 NVIDIA**: CUDA build (`-DSD_CUDA=ON`) in CI
  (`windows-2022` + CUDA toolkit), drop in
  `src-tauri/binaries/sd-x86_64-pc-windows-msvc.exe`.
- Tauri `externalBin` config:
  ```json
  "externalBin": ["binaries/sd"]
  ```
  Tauri's per-target suffix resolution picks the right file.

## Process lifecycle

```rust
struct SidecarHandle {
    child: tauri::api::process::CommandChild,
    stdin: tokio::sync::Mutex<ChildStdin>,
    events: broadcast::Receiver<SdEvent>,
}
```

- Spawn on first `generate_image` call with args:
  `--model <path> --threads <n> --jsonl-stdin --jsonl-stdout`.
- Cooperative shutdown on app exit: send `{"op":"quit"}` then wait 2 s, then
  `child.kill()`.
- Crash handling: if exit code ≠ 0, surface `SidecarCrashed` to UI, mark the
  in-flight message as `error`, allow user retry (re-spawn).

## Wire protocol (newline-delimited JSON over stdio)

**App → sidecar**:
```json
{ "op": "generate", "id": "msg-uuid", "prompt": "...", "negative": "",
  "width": 1024, "height": 1024, "steps": 4, "cfg": 1.0, "seed": -1,
  "init_image": null }
```

**Sidecar → app**:
```json
{ "id": "msg-uuid", "event": "step", "step": 2, "total": 4 }
{ "id": "msg-uuid", "event": "done", "image_path": "/tmp/sov-XXXX.png" }
{ "id": "msg-uuid", "event": "error", "message": "OOM" }
```

The app re-emits these on the Tauri event channel
`generation://<msgId>` so only the relevant Bubble re-renders.

## Concurrency

- Single generation at a time (sd.cpp loads the model once; concurrent
  prompts would thrash). A `tokio::sync::Mutex` gates the stdin write.
- Queue depth visible to UI as `queued` status on the bubble.
- Cancel mid-generation: send `{"op":"cancel","id":"…"}`. sd.cpp aborts at
  the next denoise step.

## Security

- Sidecar binary path resolved from Tauri's resource dir — never user input.
- Prompt text sent as JSON value (auto-escaped), never shell-interpolated.
- Init-image path validated to live under `<app_data>/attachments/` before
  being passed to the sidecar.

## Sprint stub

This sprint we do not spawn sd.cpp. Provide a mocked `generate_image`
Tauri command that:

1. Marks the assistant message `pending`.
2. After 1500 ms, copies a placeholder PNG from app resources to a unique
   path and emits a `done` event.
3. UI flips the bubble to `success` and renders the image.

This proves the full IPC + event + DB write loop end-to-end without sd.cpp.
