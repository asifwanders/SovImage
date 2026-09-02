//! `stable-diffusion.cpp` process supervision and event translation.

#![cfg_attr(feature = "stub_runtime", allow(dead_code))]

pub mod dim;

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread;
use std::time::Duration;

use os_pipe::PipeReader;
use serde::Serialize;
use serde_json::json;
use shared_child::SharedChild;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{Receiver, Sender};
use tokio_util::sync::CancellationToken;
use tracing::warn;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::downloader::registry::ModelProfile;
use crate::state::AppState;

const MAX_LOG_BUFFER: usize = 64 * 1024;

fn wait_error_delay(failures: u32) -> Duration {
    let exponent = failures.saturating_sub(1).min(6);
    Duration::from_millis((100u64 << exponent).min(5_000))
}

fn report_wait_error(failures: u32) -> bool {
    failures == 1 || failures.is_power_of_two()
}

#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub diffusion: PathBuf,
    pub vae: PathBuf,
    pub llm: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerationMode {
    Txt2Img,
    Edit,
}

impl GenerationMode {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Txt2Img => "txt2img",
            Self::Edit => "edit",
        }
    }
}

#[derive(Debug, Clone)]
pub struct GenerateRequest {
    pub message_id: String,
    pub profile: &'static ModelProfile,
    pub model_paths: ModelPaths,
    pub mode: GenerationMode,
    pub prompt_file: PathBuf,
    pub init_image: Option<PathBuf>,
    pub width: u32,
    pub height: u32,
    pub seed: i64,
    /// Sidecar-owned temporary path. It is never exposed to the frontend.
    pub work_png: PathBuf,
    /// Stable path published only after full decode validation.
    pub output_png: PathBuf,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationMeta {
    pub model: String,
    pub mode: &'static str,
    pub steps: u32,
    pub cfg: f32,
    pub guidance: f32,
    pub sampler: &'static str,
    pub seed: i64,
    pub width: u32,
    pub height: u32,
}

impl GenerateRequest {
    fn meta(&self) -> GenerationMeta {
        GenerationMeta {
            model: self.profile.id.into(),
            mode: self.mode.label(),
            steps: self.profile.steps,
            cfg: self.profile.cfg,
            guidance: self.profile.guidance,
            sampler: self.profile.sampler,
            seed: self.seed,
            width: self.width,
            height: self.height,
        }
    }
}

/// Pure argv builder: the registry profile owns sampling and memory choices.
pub fn build_argv(request: &GenerateRequest) -> Vec<String> {
    let mut argv = vec![
        "--diffusion-model".into(),
        request.model_paths.diffusion.display().to_string(),
        "--vae".into(),
        request.model_paths.vae.display().to_string(),
        "--llm".into(),
        request.model_paths.llm.display().to_string(),
        "--sampling-method".into(),
        request.profile.sampler.into(),
        "--cfg-scale".into(),
        request.profile.cfg.to_string(),
        "--guidance".into(),
        request.profile.guidance.to_string(),
        "--steps".into(),
        request.profile.steps.to_string(),
        "-W".into(),
        request.width.to_string(),
        "-H".into(),
        request.height.to_string(),
        "-s".into(),
        request.seed.to_string(),
        "--prompt-file".into(),
        request.prompt_file.display().to_string(),
        "-o".into(),
        request.work_png.display().to_string(),
        "--backend".into(),
        request.backend.clone(),
        // Keep 2 GiB free for the OS, WebView, graph buffers, and display.
        "--max-vram".into(),
        "-2".into(),
        "--diffusion-fa".into(),
        "--disable-image-metadata".into(),
        "-v".into(),
    ];
    if request.profile.vae_tiling {
        argv.push("--vae-tiling".into());
    }
    if let Some(reference) = &request.init_image {
        argv.push("-r".into());
        argv.push(reference.display().to_string());
    }
    argv
}

/// Parse progress emitted by the pinned sd.cpp CLI, including its current
/// carriage-return format: `| ... | N/M - 1.23s/it`.
pub fn parse_step(line: &str) -> Option<(u32, u32)> {
    if let Some(rest) = line.split_once("[step ").map(|(_, rest)| rest) {
        if let Some(fraction) = rest.split_once(']').map(|(fraction, _)| fraction) {
            if let Some(progress) = parse_fraction(fraction) {
                return Some(progress);
            }
        }
    }
    if let Some(rest) = line.split_once("sample step ").map(|(_, rest)| rest) {
        if let Some(progress) = rest.split_whitespace().find_map(parse_fraction) {
            return Some(progress);
        }
    }
    if line.contains('|') && (line.contains(" - ") || line.contains('%')) {
        return line.split_whitespace().find_map(parse_fraction);
    }
    None
}

fn parse_fraction(token: &str) -> Option<(u32, u32)> {
    let token =
        token.trim_matches(|character: char| !character.is_ascii_digit() && character != '/');
    let (current, total) = token.split_once('/')?;
    let current = current.parse().ok()?;
    let total = total.parse().ok()?;
    (total > 0 && current <= total).then_some((current, total))
}

fn push_log_chunk(buffer: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    buffer.extend_from_slice(chunk);
    let mut lines = Vec::new();
    while let Some(end) = buffer
        .iter()
        .position(|byte| *byte == b'\n' || *byte == b'\r')
    {
        let bytes: Vec<u8> = buffer.drain(..=end).collect();
        let line = String::from_utf8_lossy(&bytes[..bytes.len() - 1])
            .trim()
            .to_owned();
        if !line.is_empty() {
            lines.push(line);
        }
    }
    if buffer.len() > MAX_LOG_BUFFER {
        buffer.drain(..buffer.len() - MAX_LOG_BUFFER);
    }
    lines
}

fn flush_log_buffer(buffer: &mut Vec<u8>) -> Vec<String> {
    if buffer.is_empty() {
        return Vec::new();
    }
    let line = String::from_utf8_lossy(buffer).trim().to_owned();
    buffer.clear();
    (!line.is_empty()).then_some(line).into_iter().collect()
}

fn process_log_lines(
    app: &AppHandle,
    channel: &str,
    lines: Vec<String>,
    last_error: &mut Option<String>,
) {
    for line in lines {
        if let Some((step, total)) = parse_step(&line) {
            let _ = app.emit(
                channel,
                json!({ "event": "step", "step": step, "total": total }),
            );
            continue;
        }
        let lowercase = line.to_ascii_lowercase();
        if lowercase.contains("error")
            || lowercase.contains("failed")
            || lowercase.contains("not support")
            || lowercase.contains("out of memory")
        {
            *last_error = Some(line);
        }
    }
}

enum RunFailure {
    Cancelled,
    Error(String),
}

enum ProcessEvent {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
    Error(String),
    Terminated(Option<i32>),
}

#[derive(Clone, Copy)]
enum PipeKind {
    Stdout,
    Stderr,
}

fn bundled_sidecar_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| "current executable has no parent directory".to_string())?;
    let base = if executable_dir.ends_with("deps") {
        executable_dir.parent().unwrap_or(executable_dir)
    } else {
        executable_dir
    };
    #[cfg(not(windows))]
    let path = base.join("sd");
    #[cfg(windows)]
    let mut path = base.join("sd");
    #[cfg(windows)]
    path.as_mut_os_string().push(".exe");
    Ok(path)
}

fn spawn_pipe_reader(
    mut reader: PipeReader,
    sender: Sender<ProcessEvent>,
    kind: PipeKind,
) -> io::Result<thread::JoinHandle<()>> {
    let name = match kind {
        PipeKind::Stdout => "sovimage-sd-stdout",
        PipeKind::Stderr => "sovimage-sd-stderr",
    };
    thread::Builder::new().name(name.into()).spawn(move || {
        let mut buffer = vec![0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let bytes = buffer[..read].to_vec();
                    let event = match kind {
                        PipeKind::Stdout => ProcessEvent::Stdout(bytes),
                        PipeKind::Stderr => ProcessEvent::Stderr(bytes),
                    };
                    if sender.blocking_send(event).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    let _ = sender.blocking_send(ProcessEvent::Error(error.to_string()));
                    break;
                }
            }
        }
    })
}

fn handoff_failed_sidecar(
    app: &AppHandle,
    pid: u32,
    child: &Arc<SharedChild>,
    readers: Vec<thread::JoinHandle<()>>,
    cause: impl std::fmt::Display,
) -> String {
    let kill_error = child.kill().err();
    let mut message = format!("sidecar supervisor could not start: {cause}");
    if let Some(error) = kill_error {
        message.push_str(&format!("; kill failed: {error}"));
    }
    let reaper_child = Arc::clone(child);
    let reaper_app = app.clone();
    if let Err(error) = thread::Builder::new()
        .name("sovimage-sd-reaper".into())
        .spawn(move || {
            let mut failures = 0u32;
            loop {
                match reaper_child.wait() {
                    Ok(_) => break,
                    Err(error) => {
                        failures = failures.saturating_add(1);
                        if report_wait_error(failures) {
                            tracing::error!(
                                pid,
                                failures,
                                %error,
                                "failed to reap sidecar after startup failure"
                            );
                        }
                        thread::sleep(wait_error_delay(failures));
                    }
                }
            }
            for reader in readers {
                if reader.join().is_err() {
                    tracing::error!(
                        pid,
                        "sidecar output reader panicked during startup rollback"
                    );
                }
            }
            if let Some(state) = reaper_app.try_state::<AppState>() {
                state.untrack_sidecar(pid, &reaper_child);
            }
        })
    {
        message.push_str(&format!(
            "; cleanup thread unavailable: {error}; restart SovImage before retrying"
        ));
    }
    message
}

fn spawn_sidecar(
    app: &AppHandle,
    args: impl IntoIterator<Item = String>,
) -> Result<(u32, Receiver<ProcessEvent>), String> {
    let (stdout_reader, stdout_writer) = os_pipe::pipe().map_err(|error| error.to_string())?;
    let (stderr_reader, stderr_writer) = os_pipe::pipe().map_err(|error| error.to_string())?;
    let mut command = Command::new(bundled_sidecar_path()?);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_writer))
        .stderr(Stdio::from(stderr_writer));
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);

    let state = app.state::<AppState>();
    state.reserve_sidecar()?;
    let child = match SharedChild::spawn(&mut command) {
        Ok(child) => Arc::new(child),
        Err(error) => {
            state.release_unspawned_sidecar();
            return Err(error.to_string());
        }
    };
    let pid = state.track_sidecar(child.clone());
    let (sender, receiver) = tokio::sync::mpsc::channel(64);
    let stdout_thread = match spawn_pipe_reader(stdout_reader, sender.clone(), PipeKind::Stdout) {
        Ok(thread) => thread,
        Err(error) => {
            drop(receiver);
            return Err(handoff_failed_sidecar(app, pid, &child, Vec::new(), error));
        }
    };
    let stderr_thread = match spawn_pipe_reader(stderr_reader, sender.clone(), PipeKind::Stderr) {
        Ok(thread) => thread,
        Err(error) => {
            drop(receiver);
            return Err(handoff_failed_sidecar(
                app,
                pid,
                &child,
                vec![stdout_thread],
                error,
            ));
        }
    };
    let readers = Arc::new(StdMutex::new(Some(vec![stdout_thread, stderr_thread])));
    let wait_readers = Arc::clone(&readers);
    let wait_child = Arc::clone(&child);
    let wait_sender = sender.clone();
    let wait_app = app.clone();
    let wait_thread = thread::Builder::new()
        .name("sovimage-sd-wait".into())
        .spawn(move || {
            let mut failures = 0u32;
            let status = loop {
                match wait_child.wait() {
                    Ok(status) => break status,
                    Err(error) => {
                        failures = failures.saturating_add(1);
                        if report_wait_error(failures) {
                            let _ =
                                wait_sender.blocking_send(ProcessEvent::Error(error.to_string()));
                        }
                        thread::sleep(wait_error_delay(failures));
                    }
                }
            };
            let reader_threads = wait_readers
                .lock()
                .map(|mut readers| readers.take().unwrap_or_default())
                .unwrap_or_default();
            let mut reader_panicked = false;
            for reader in reader_threads {
                if reader.join().is_err() {
                    reader_panicked = true;
                }
            }
            if reader_panicked {
                let _ = wait_sender
                    .blocking_send(ProcessEvent::Error("sidecar output reader panicked".into()));
            }
            if let Some(state) = wait_app.try_state::<AppState>() {
                state.untrack_sidecar(pid, &wait_child);
            }
            let _ = wait_sender.blocking_send(ProcessEvent::Terminated(status.code()));
        });
    if let Err(error) = wait_thread {
        drop(receiver);
        let reader_threads = readers
            .lock()
            .map(|mut readers| readers.take().unwrap_or_default())
            .unwrap_or_default();
        return Err(handoff_failed_sidecar(
            app,
            pid,
            &child,
            reader_threads,
            error,
        ));
    }
    Ok((pid, receiver))
}

async fn kill_and_reap(
    app: &AppHandle,
    pid: u32,
    events: &mut Receiver<ProcessEvent>,
) -> Result<(), String> {
    let kill_error = app.state::<AppState>().kill_sidecar(pid).err();
    let reaped = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(event) = events.recv().await {
            if matches!(event, ProcessEvent::Terminated(_)) {
                return true;
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    if reaped {
        Ok(())
    } else {
        Err(match kill_error {
            Some(error) => format!("could not kill or reap sd sidecar: {error}"),
            None => "sd sidecar did not terminate after kill".into(),
        })
    }
}

fn poison_generation_queue(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.generation_slot.close();
    }
}

pub(crate) async fn publish_output(work: &Path, output: &Path) -> Result<(), String> {
    match tokio::fs::symlink_metadata(output).await {
        Ok(_) => return Err("generation output already exists; refusing to overwrite it".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let metadata = tokio::fs::symlink_metadata(work)
        .await
        .map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("generation work path is not a regular file".into());
    }
    // Same-directory hard-link publication is atomic and refuses to replace an
    // existing UUID on both APFS and NTFS.
    tokio::fs::hard_link(work, output)
        .await
        .map_err(|error| format!("publish generation output: {error}"))?;
    let _ = tokio::fs::remove_file(work).await;
    Ok(())
}

fn backend_is_listed(devices: &str, backend: &str) -> bool {
    devices.lines().any(|line| {
        let name = line.split('\t').next().unwrap_or_default();
        if backend.eq_ignore_ascii_case("metal") {
            name.to_ascii_lowercase().starts_with("mtl")
        } else {
            name.eq_ignore_ascii_case(backend)
        }
    })
}

/// Prove the packaged helper launches and exposes the hardware probe's exact
/// backend before a user commits gigabytes of disk space.
pub async fn probe_backend(app: &AppHandle, backend: &str) -> Result<(), String> {
    enum ProbeOutcome {
        Exited(Result<(), String>),
        Failed(String),
    }

    if app.state::<AppState>().is_exiting() {
        return Err("SovImage is shutting down".into());
    }
    let (pid, mut events) = spawn_sidecar(app, ["--list-devices".into()])
        .map_err(|error| format!("sidecar spawn failed: {error}"))?;
    let mut stdout = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(event) = events.recv().await {
            match event {
                ProcessEvent::Stdout(bytes) => stdout.extend_from_slice(&bytes),
                ProcessEvent::Terminated(code) => {
                    return ProbeOutcome::Exited(if code == Some(0) {
                        Ok(())
                    } else {
                        Err(format!(
                            "sd device probe exited with code {}",
                            code.unwrap_or(-1)
                        ))
                    });
                }
                ProcessEvent::Error(error) => return ProbeOutcome::Failed(error),
                ProcessEvent::Stderr(_) => {}
            }
        }
        ProbeOutcome::Failed("sd device probe channel closed unexpectedly".into())
    })
    .await;
    match result {
        Ok(ProbeOutcome::Exited(Ok(()))) => {
            let devices = String::from_utf8_lossy(&stdout);
            backend_is_listed(&devices, backend)
                .then_some(())
                .ok_or_else(|| format!("sd sidecar does not expose backend {backend}"))
        }
        Ok(ProbeOutcome::Exited(Err(error))) => Err(error),
        Ok(ProbeOutcome::Failed(error)) => {
            let _ = kill_and_reap(app, pid, &mut events).await;
            Err(error)
        }
        Err(_) => {
            let detail = kill_and_reap(app, pid, &mut events)
                .await
                .err()
                .map(|error| format!(": {error}"))
                .unwrap_or_default();
            Err(format!("sd device probe timed out{detail}"))
        }
    }
}

pub async fn run(
    app: AppHandle,
    request: GenerateRequest,
    cancel: Arc<CancellationToken>,
) -> Result<PathBuf, String> {
    let channel = format!("generation://{}", request.message_id);
    let result = match run_inner(&app, &channel, &request, cancel).await {
        Ok(()) => publish_output(&request.work_png, &request.output_png)
            .await
            .map(|()| request.output_png.clone())
            .map_err(RunFailure::Error),
        Err(error) => Err(error),
    };
    let _ = tokio::fs::remove_file(&request.prompt_file).await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&request.work_png).await;
    }

    match result {
        Ok(path) => {
            let _ = app.emit(
                &channel,
                json!({
                    "event": "done",
                    "imagePath": path.display().to_string(),
                    "meta": request.meta(),
                }),
            );
            Ok(path)
        }
        Err(RunFailure::Cancelled) => {
            let _ = app.emit(&channel, json!({ "event": "cancelled" }));
            Err("cancelled".into())
        }
        Err(RunFailure::Error(message)) => {
            warn!(%message, "generation failed");
            let _ = app.emit(&channel, json!({ "event": "error", "message": message }));
            Err(message)
        }
    }
}

async fn run_inner(
    app: &AppHandle,
    channel: &str,
    request: &GenerateRequest,
    cancel: Arc<CancellationToken>,
) -> Result<(), RunFailure> {
    if app.state::<AppState>().is_exiting() {
        return Err(RunFailure::Error("SovImage is shutting down".into()));
    }
    let (pid, mut events) = spawn_sidecar(app, build_argv(request))
        .map_err(|error| RunFailure::Error(format!("sidecar spawn failed: {error}")))?;
    let _ = app.emit(channel, json!({ "event": "started" }));

    let mut last_error = None;
    let mut stdout_buffer = Vec::new();
    let mut stderr_buffer = Vec::new();
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return match kill_and_reap(app, pid, &mut events).await {
                    Ok(()) => Err(RunFailure::Cancelled),
                    Err(error) => {
                        poison_generation_queue(app);
                        Err(RunFailure::Error(error))
                    }
                };
            }
            event = events.recv() => {
                let Some(event) = event else {
                    let detail = kill_and_reap(app, pid, &mut events)
                        .await
                        .err()
                        .map(|error| format!(": {error}"))
                        .unwrap_or_default();
                    poison_generation_queue(app);
                    return Err(RunFailure::Error(format!(
                        "sidecar event channel closed unexpectedly{detail}"
                    )));
                };
                match event {
                    ProcessEvent::Stdout(bytes) => {
                        process_log_lines(
                            app,
                            channel,
                            push_log_chunk(&mut stdout_buffer, &bytes),
                            &mut last_error,
                        );
                    }
                    ProcessEvent::Stderr(bytes) => {
                        process_log_lines(
                            app,
                            channel,
                            push_log_chunk(&mut stderr_buffer, &bytes),
                            &mut last_error,
                        );
                    }
                    ProcessEvent::Terminated(code) => {
                        process_log_lines(
                            app,
                            channel,
                            flush_log_buffer(&mut stdout_buffer),
                            &mut last_error,
                        );
                        process_log_lines(
                            app,
                            channel,
                            flush_log_buffer(&mut stderr_buffer),
                            &mut last_error,
                        );
                        let code = code.unwrap_or(-1);
                        if code != 0 {
                            return Err(RunFailure::Error(last_error.unwrap_or_else(|| {
                                format!("sd sidecar exited with code {code}")
                            })));
                        }
                        dim::validate_output_png(
                            &request.work_png,
                            request.width,
                            request.height,
                        )
                        .map_err(RunFailure::Error)?;
                        return Ok(());
                    }
                    ProcessEvent::Error(error) => {
                        return match kill_and_reap(app, pid, &mut events).await {
                            Ok(()) => Err(RunFailure::Error(error)),
                            Err(reap_error) => {
                                poison_generation_queue(app);
                                Err(RunFailure::Error(format!("{error}; {reap_error}")))
                            }
                        };
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloader::registry;
    use crate::hardware::Tier;

    fn request(tier: Tier) -> GenerateRequest {
        GenerateRequest {
            message_id: "message".into(),
            profile: registry::profile(tier),
            model_paths: ModelPaths {
                diffusion: "/models/diffusion.gguf".into(),
                vae: "/models/vae.safetensors".into(),
                llm: "/models/llm.gguf".into(),
            },
            mode: GenerationMode::Txt2Img,
            prompt_file: "/private/prompt.txt".into(),
            init_image: None,
            width: 768,
            height: 768,
            seed: 42,
            work_png: "/private/output.part.png".into(),
            output_png: "/private/output.png".into(),
            backend: "metal".into(),
        }
    }

    #[test]
    fn argv_matches_pinned_klein_contract() {
        let argv = build_argv(&request(Tier::One));
        for expected in [
            "--diffusion-model",
            "--vae",
            "--llm",
            "--cfg-scale",
            "--guidance",
            "--steps",
            "--prompt-file",
            "--backend",
            "--max-vram",
            "--diffusion-fa",
            "--disable-image-metadata",
            "--vae-tiling",
        ] {
            assert!(
                argv.iter().any(|argument| argument == expected),
                "missing {expected}"
            );
        }
        assert!(!argv.iter().any(|argument| argument == "--type"));
        assert!(!argv.iter().any(|argument| argument == "-p"));
        assert!(!argv.iter().any(|argument| argument == "-n"));
        assert!(argv.iter().any(|argument| argument == "3.5"));
        assert!(argv.iter().any(|argument| argument == "4"));
        let output = argv.iter().position(|argument| argument == "-o").unwrap();
        assert_eq!(argv[output + 1], "/private/output.part.png");
    }

    #[test]
    fn edit_uses_same_model_with_reference() {
        let mut request = request(Tier::Two);
        request.mode = GenerationMode::Edit;
        request.init_image = Some("/private/reference.png".into());
        let argv = build_argv(&request);
        let index = argv.iter().position(|argument| argument == "-r").unwrap();
        assert_eq!(argv[index + 1], "/private/reference.png");
    }

    #[test]
    fn parses_current_carriage_return_progress() {
        assert_eq!(parse_step("|████████ | 3/4 - 1.23s/it"), Some((3, 4)));
        assert_eq!(parse_step("[step 2/4]"), Some((2, 4)));
        assert_eq!(
            parse_step("25%|██ | 1/4 [00:01<00:03, 1.00s/it]"),
            Some((1, 4))
        );
        assert_eq!(parse_step("loaded weights | 1/2 tensors"), None);
    }

    #[test]
    fn buffers_split_progress_and_utf8_chunks() {
        let mut buffer = Vec::new();
        assert!(push_log_chunk(&mut buffer, "|██ | 3/".as_bytes()).is_empty());
        assert_eq!(
            push_log_chunk(&mut buffer, b"4 - 1.23s/it\r"),
            vec!["|██ | 3/4 - 1.23s/it"]
        );
        assert_eq!(parse_step("|██ | 3/4 - 1.23s/it"), Some((3, 4)));
    }

    #[test]
    fn device_probe_matches_engine_names() {
        let devices = "MTL0\tApple M1\nCPU\tApple M1\nCUDA1\tNVIDIA GPU\n";
        assert!(backend_is_listed(devices, "metal"));
        assert!(backend_is_listed(devices, "cuda1"));
        assert!(!backend_is_listed(devices, "cuda0"));
    }

    #[test]
    fn wait_failures_back_off_and_reports_are_rate_limited() {
        assert_eq!(wait_error_delay(1), Duration::from_millis(100));
        assert_eq!(wait_error_delay(2), Duration::from_millis(200));
        assert_eq!(wait_error_delay(20), Duration::from_secs(5));
        assert!(report_wait_error(1));
        assert!(report_wait_error(2));
        assert!(!report_wait_error(3));
        assert!(report_wait_error(4));
    }

    #[tokio::test]
    async fn publishing_never_overwrites_an_existing_output() {
        let directory = tempfile::tempdir().unwrap();
        let work = directory.path().join("work.png");
        let output = directory.path().join("output.png");
        tokio::fs::write(&work, b"new").await.unwrap();
        tokio::fs::write(&output, b"old").await.unwrap();
        assert!(publish_output(&work, &output).await.is_err());
        assert_eq!(tokio::fs::read(output).await.unwrap(), b"old");
    }

    #[test]
    #[cfg(unix)]
    fn owned_child_can_be_killed_while_waiting_and_then_reaped() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exec sleep 30"]);
        let child = Arc::new(SharedChild::spawn(&mut command).unwrap());
        let waiter = {
            let child = child.clone();
            thread::spawn(move || child.wait().unwrap())
        };
        child.kill().unwrap();
        assert!(!waiter.join().unwrap().success());
        assert!(child.try_wait().unwrap().is_some());
    }
}
