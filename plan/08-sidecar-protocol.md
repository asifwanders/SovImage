# 08 — Refined sd.cpp Sidecar Protocol

Supersedes plan/04 with concrete invocation strategy.

## Strategy: per-prompt argv invocation (this sprint)

Upstream sd.cpp does **not** yet expose a persistent JSON-RPC server. So:

- Tauri spawns `sd` as a one-shot child per `generate_image` request.
- Build the argv from the tier flags in plan/06.
- Parse progress from stderr (sd.cpp writes step lines there).
- Output PNG path is known a priori — we pass `-o <uuid>.png`.

Model reload cost on each invocation: ~3–6 s on Apple Silicon for Flux
schnell. Acceptable for a single-user desktop app. A persistent-server mode
is tracked as a future optimization; the supervisor abstraction below makes
the swap trivial.

## Rust supervisor sketch

```rust
// src-tauri/src/sidecar/mod.rs
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

pub struct GenerateRequest {
    pub message_id: String,
    pub chat_id: String,
    pub tier: Tier,
    pub model_paths: ModelPaths,    // absolute paths resolved by supervisor
    pub prompt: String,
    pub negative: Option<String>,
    pub init_image: Option<PathBuf>,
    pub width: u32, pub height: u32,
    pub steps: u32, pub cfg: f32, pub seed: i64,
    pub output_png: PathBuf,
}

pub async fn run(app: &AppHandle, req: GenerateRequest) -> Result<()> {
    let argv = build_argv(&req);
    let (mut rx, mut child) = app.shell()
        .sidecar("sd")?
        .args(argv)
        .spawn()?;

    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stderr(line) => {
                if let Some((step, total)) = parse_step(&line) {
                    let _ = app.emit(
                        &format!("generation://{}", req.message_id),
                        json!({ "event":"step", "step": step, "total": total }),
                    );
                }
            }
            CommandEvent::Terminated(t) if t.code == Some(0) => {
                let _ = app.emit(
                    &format!("generation://{}", req.message_id),
                    json!({ "event":"done",
                            "imagePath": req.output_png.display().to_string() }),
                );
                return Ok(());
            }
            CommandEvent::Terminated(t) => {
                let _ = app.emit(
                    &format!("generation://{}", req.message_id),
                    json!({ "event":"error",
                            "message": format!("sd exited code {:?}", t.code) }),
                );
                return Err(...);
            }
            _ => {}
        }
    }
    Ok(())
}
```

## argv builder (per-tier table)

```rust
fn build_argv(req: &GenerateRequest) -> Vec<String> {
    let mut a = vec![
        "--diffusion-model".into(), req.model_paths.diffusion.display().to_string(),
        "--vae".into(),            req.model_paths.vae.display().to_string(),
        "--clip_l".into(),         req.model_paths.clip_l.display().to_string(),
        "--t5xxl".into(),          req.model_paths.t5xxl.display().to_string(),
        "--type".into(),           type_for(req.tier).into(),
        "--sampling-method".into(), "euler".into(),
        "--cfg-scale".into(),      req.cfg.to_string(),
        "--steps".into(),          req.steps.to_string(),
        "-W".into(),               req.width.to_string(),
        "-H".into(),               req.height.to_string(),
        "-s".into(),               req.seed.to_string(),
        "-p".into(),               req.prompt.clone(),
        "-o".into(),               req.output_png.display().to_string(),
        "--diffusion-fa".into(),
        "-v".into(),
    ];
    match req.tier {
        Tier::One => {
            a.extend(["--vae-tiling","--vae-on-cpu","--clip-on-cpu"]
                .iter().map(|s| s.to_string()));
        }
        Tier::Two => {
            a.extend(["--vae-tiling","--clip-on-cpu"]
                .iter().map(|s| s.to_string()));
        }
        Tier::Three => { /* no offload */ }
    }
    if let Some(neg) = &req.negative {
        a.push("-n".into()); a.push(neg.clone());
    }
    if let Some(init) = &req.init_image {
        a.push("--init-img".into()); a.push(init.display().to_string());
        a.push("--strength".into()); a.push("0.75".into());
    }
    a
}
```

## Progress parser

sd.cpp emits lines like:
```
  20%|████      | 1/5 [00:01<00:04,  1.23s/it]
[step 2/5]
sample step 3 / 5
```

Pragmatic regex that catches all three forms:
```rust
static RE: Lazy<Regex> = Lazy::new(|| Regex::new(
    r"(?:step\s+|^\s*\d+%[^\d]+)(\d+)\s*/\s*(\d+)"
).unwrap());
```
We pick the first capture group as `step`, second as `total`. Lines without
match are forwarded to `tracing::debug!` and dropped.

## Cancellation

`tokio::select!` between the `rx.recv()` loop and a per-message
`CancellationToken` stored in `AppState::generations: DashMap<msg_id, Token>`.
On cancel: `child.kill().await?;` — sd.cpp exits cleanly between denoise
steps within ~1 s.

## Concurrency

Single in-flight generation at a time. A `tokio::sync::Semaphore::new(1)`
guards the supervisor entry. Additional requests wait in queue; UI shows
the bubble's status as `queued` (already supported by the `MessageStatus`
union — add `"queued"` variant when implementing).

## Init-image safety

Before passing `--init-img <path>` to the sidecar, the supervisor verifies:
1. Path is under `<app_data>/attachments/`.
2. File exists, mime is `image/*`.
3. Path contains no `..` segments.

This is enforced even though the sidecar binary is trusted — defense in
depth against path-traversal bugs leaking shell-special characters into a
future server-mode protocol.

## Sidecar lifecycle vs setup phase

Tauri only allows `generate_image` when `setup_state.phase == "ready"`. The
frontend already gates this via `SplashGate`. The Rust supervisor adds a
belt: if invoked while `phase != "ready"`, return `AppError::NotReady`.

## Permissions

`src-tauri/capabilities/default.json` needs:
```json
"shell:allow-execute"
```
scoped to the `sd` sidecar only:
```json
{
  "identifier": "shell:allow-execute",
  "allow": [{ "name": "sd", "sidecar": true, "args": true }]
}
```

## Future: persistent-server protocol

When upstream adds it (or we fork), spawn one child at sidecar-init time,
write requests to stdin as JSONL, read events from stdout. The supervisor
interface stays identical (`run(req) -> stream`); only the transport changes.
