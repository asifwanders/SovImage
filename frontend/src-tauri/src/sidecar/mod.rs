//! sd.cpp sidecar supervisor.
//!
//! Builds argv per hardware tier (see plan/06 + plan/08), spawns the `sd`
//! sidecar binary via tauri-plugin-shell, parses stderr for step progress,
//! and re-emits progress / done / error events on the per-message channel
//! `generation://<message_id>` that the frontend listens on.
//!
//! In `stub_runtime` mode (default this sprint) the supervisor is *not*
//! invoked; `commands::generation` returns a mocked pending message and
//! the frontend mock loop drives completion. Real spawning lands when the
//! downloader (plan/03) provisions models.

#![allow(dead_code)] // wired into commands::generation when stub_runtime is off

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio_util::sync::CancellationToken;
use tracing::warn;

#[derive(Debug, Clone, Copy)]
pub enum Tier {
    One,
    Two,
    Three,
}

#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub diffusion: PathBuf,
    pub vae: PathBuf,
    pub clip_l: PathBuf,
    pub t5xxl: PathBuf,
}

#[derive(Debug, Clone)]
pub struct GenerateRequest {
    pub message_id: String,
    pub chat_id: String,
    pub tier: Tier,
    pub model_paths: ModelPaths,
    pub prompt: String,
    pub negative: Option<String>,
    pub init_image: Option<PathBuf>,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg: f32,
    pub seed: i64,
    pub output_png: PathBuf,
}

/// Builds the argv passed to the `sd` sidecar. Pure — easy to unit test.
pub fn build_argv(req: &GenerateRequest) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "--diffusion-model".into(),
        req.model_paths.diffusion.display().to_string(),
        "--vae".into(),
        req.model_paths.vae.display().to_string(),
        "--clip_l".into(),
        req.model_paths.clip_l.display().to_string(),
        "--t5xxl".into(),
        req.model_paths.t5xxl.display().to_string(),
        "--type".into(),
        type_for(req.tier).into(),
        "--sampling-method".into(),
        "euler".into(),
        "--cfg-scale".into(),
        format!("{:.2}", req.cfg),
        "--steps".into(),
        req.steps.to_string(),
        "-W".into(),
        req.width.to_string(),
        "-H".into(),
        req.height.to_string(),
        "-s".into(),
        req.seed.to_string(),
        "-p".into(),
        req.prompt.clone(),
        "-o".into(),
        req.output_png.display().to_string(),
        "--diffusion-fa".into(),
        "-v".into(),
    ];

    match req.tier {
        Tier::One => {
            a.push("--vae-tiling".into());
            a.push("--vae-on-cpu".into());
            a.push("--clip-on-cpu".into());
        }
        Tier::Two => {
            a.push("--vae-tiling".into());
            a.push("--clip-on-cpu".into());
        }
        Tier::Three => { /* no offload */ }
    }

    if let Some(neg) = &req.negative {
        a.push("-n".into());
        a.push(neg.clone());
    }
    if let Some(init) = &req.init_image {
        a.push("--init-img".into());
        a.push(init.display().to_string());
        a.push("--strength".into());
        a.push("0.75".into());
    }
    a
}

fn type_for(t: Tier) -> &'static str {
    match t {
        Tier::One => "q4_0",
        Tier::Two | Tier::Three => "q8_0",
    }
}

/// Parses a step-progress line emitted by sd.cpp on stderr. Accepts the three
/// common formats sd.cpp produces across versions.
pub fn parse_step(line: &str) -> Option<(u32, u32)> {
    // 1) "[step N/M]"
    if let Some(rest) = line.split_once("[step ").map(|(_, r)| r) {
        if let Some(inner) = rest.split_once(']').map(|(l, _)| l) {
            if let Some((n, d)) = inner.split_once('/') {
                if let (Ok(a), Ok(b)) = (n.trim().parse(), d.trim().parse()) {
                    return Some((a, b));
                }
            }
        }
    }
    // 2) "sample step N / M"
    if let Some(rest) = line.split_once("sample step ").map(|(_, r)| r) {
        let s: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '/' || c.is_whitespace())
            .collect();
        if let Some((n, d)) = s.split_once('/') {
            if let (Ok(a), Ok(b)) = (n.trim().parse(), d.trim().parse()) {
                return Some((a, b));
            }
        }
    }
    // 3) tqdm-style "20%|####      | 1/5 [00:01<00:04,  1.23s/it]"
    //    Anchor on both `%` (progress sigil) and `[` (timing bracket) to
    //    avoid false positives on incidental log lines containing `| N/M`.
    if line.contains('%') && line.contains('[') {
        if let Some(pipe_end) = line.rfind('|') {
            let tail = line[pipe_end + 1..].trim_start();
            if let Some(end) = tail.find(|c: char| c == ' ' || c == '[') {
                let frac = &tail[..end];
                if let Some((n, d)) = frac.split_once('/') {
                    if let (Ok(a), Ok(b)) = (n.trim().parse(), d.trim().parse()) {
                        return Some((a, b));
                    }
                }
            }
        }
    }
    None
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GenerationEvent {
    pub event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Spawn the `sd` sidecar with argv derived from `req`, parse stderr for
/// step progress, and re-emit events on `generation://<msg_id>`. Honors the
/// shared `cancel` token: on cancellation the child is killed and `Err` is
/// returned without emitting a `done` event.
pub async fn run(
    app: AppHandle,
    req: GenerateRequest,
    cancel: Arc<CancellationToken>,
) -> Result<PathBuf, String> {
    let channel = format!("generation://{}", req.message_id);
    let argv = build_argv(&req);

    // Sidecar name MUST match the `externalBin` entry in tauri.conf.json
    // AND the `shell:allow-execute` capability `name` in
    // `capabilities/default.json`. All three are pinned to "binaries/sd".
    let cmd = app
        .shell()
        .sidecar("binaries/sd")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args(argv);

    let (mut rx, mut child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                let _ = child.kill();
                // Drain the event channel until the OS reaps the child
                // (`Terminated` arrives). Returning early would drop the
                // OwnedSemaphorePermit while the killed process is still
                // mmap'd into unified memory — the next generation could
                // then spawn a second `sd` that races for VRAM and OOMs.
                while let Some(ev) = rx.recv().await {
                    if matches!(ev, CommandEvent::Terminated(_)) {
                        break;
                    }
                }
                let _ = app.emit(&channel, json!({ "event": "cancelled" }));
                return Err("cancelled".into());
            }
            ev = rx.recv() => {
                let Some(ev) = ev else { break };
                match ev {
                    CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                        let s = String::from_utf8_lossy(&line);
                        for chunk in s.split('\n') {
                            if let Some((step, total)) = parse_step(chunk) {
                                let _ = app.emit(
                                    &channel,
                                    json!({ "event": "step", "step": step, "total": total }),
                                );
                            }
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        let code = payload.code.unwrap_or(-1);
                        if code == 0 {
                            let _ = app.emit(
                                &channel,
                                json!({
                                    "event": "done",
                                    "imagePath": req.output_png.display().to_string(),
                                }),
                            );
                            return Ok(req.output_png);
                        } else {
                            let msg = format!("sd sidecar exited with code {code}");
                            warn!("{msg}");
                            let _ = app.emit(
                                &channel,
                                json!({ "event": "error", "message": msg }),
                            );
                            return Err(msg);
                        }
                    }
                    CommandEvent::Error(e) => {
                        let _ = app.emit(
                            &channel,
                            json!({ "event": "error", "message": e.clone() }),
                        );
                        return Err(e);
                    }
                    _ => {}
                }
            }
        }
    }
    Err("sidecar event channel closed unexpectedly".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(tier: Tier) -> GenerateRequest {
        GenerateRequest {
            message_id: "m".into(),
            chat_id: "c".into(),
            tier,
            model_paths: ModelPaths {
                diffusion: PathBuf::from("/d.gguf"),
                vae: PathBuf::from("/ae.sft"),
                clip_l: PathBuf::from("/clip.safetensors"),
                t5xxl: PathBuf::from("/t5.gguf"),
            },
            prompt: "hi".into(),
            negative: None,
            init_image: None,
            width: 512,
            height: 512,
            steps: 4,
            cfg: 1.0,
            seed: -1,
            output_png: PathBuf::from("/out.png"),
        }
    }

    #[test]
    fn tier1_has_all_offloads() {
        let a = build_argv(&req(Tier::One));
        assert!(a.iter().any(|s| s == "--vae-tiling"));
        assert!(a.iter().any(|s| s == "--vae-on-cpu"));
        assert!(a.iter().any(|s| s == "--clip-on-cpu"));
        assert!(a.iter().any(|s| s == "q4_0"));
    }

    #[test]
    fn tier3_has_no_offloads() {
        let a = build_argv(&req(Tier::Three));
        assert!(!a.iter().any(|s| s == "--vae-on-cpu"));
        assert!(!a.iter().any(|s| s == "--clip-on-cpu"));
        assert!(a.iter().any(|s| s == "q8_0"));
    }

    #[test]
    fn parses_step_bracket() {
        assert_eq!(parse_step("[step 3/28]"), Some((3, 28)));
    }
    #[test]
    fn parses_sample_step() {
        assert_eq!(parse_step("sample step 5 / 20"), Some((5, 20)));
    }
    #[test]
    fn parses_tqdm_style() {
        assert_eq!(
            parse_step("  20%|####      | 1/5 [00:01<00:04,  1.23s/it]"),
            Some((1, 5))
        );
    }
    #[test]
    fn ignores_garbage() {
        assert_eq!(parse_step("loading model..."), None);
    }
    #[test]
    fn ignores_pipe_fraction_without_progress_sigil() {
        // Regression: a benign log line with `|` and `N/M` must NOT match.
        assert_eq!(parse_step("loaded weights | 1/2 tensors"), None);
    }
}
