use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    pub phase: String,
    pub tier: Option<u8>,
    pub model_id: Option<String>,
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
    pub eta_secs: u64,
    pub error: Option<String>,
    /// Whether the detected host can actually run generation. `None` until
    /// `hardware::detect()` has run.
    pub supported: Option<bool>,
    /// Best-effort device label surfaced on the splash for the unsupported
    /// hardware panel. `None` until probed.
    pub device: Option<String>,
}

impl Default for SetupState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            tier: None,
            model_id: None,
            downloaded: 0,
            total: 0,
            bytes_per_sec: 0,
            eta_secs: 0,
            error: None,
            supported: None,
            device: None,
        }
    }
}

/// Process-wide mutable state shared across Tauri commands.
pub struct AppState {
    pub setup: Mutex<SetupState>,
    pub setup_cancel: Mutex<Option<Arc<CancellationToken>>>,
    /// Handle to the currently-running setup task. Held so a Resume after
    /// Pause can `.await` the old task before spawning a new one — prevents
    /// two tasks writing to the same `*.part` file concurrently.
    pub setup_task: Mutex<Option<JoinHandle<()>>>,
    /// Held for the entire duration of `commands::setup::spawn_runtime` to
    /// make the cancel-prior + spawn-new sequence atomic. Without this, two
    /// rapid Resume clicks race: A takes the prior handle and starts awaiting
    /// it, B sees None and immediately spawns a fresh task. Both end up
    /// writing to the same `*.part` file.
    pub spawn_guard: Mutex<()>,
    /// Resolved on-disk paths to the four GGUF/safetensors files the current
    /// tier needs. Populated when the downloader finishes successfully.
    pub model_paths: Mutex<Option<ResolvedModelPaths>>,
    /// Per-message cancellation tokens for in-flight generations.
    pub generations: Mutex<HashMap<String, Arc<CancellationToken>>>,
    /// At most one sd.cpp generation runs at a time (the model is loaded
    /// once per spawn; concurrent loads would thrash unified memory).
    pub generation_slot: Arc<Semaphore>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            setup: Mutex::new(SetupState::default()),
            setup_cancel: Mutex::new(None),
            setup_task: Mutex::new(None),
            spawn_guard: Mutex::new(()),
            model_paths: Mutex::new(None),
            generations: Mutex::new(HashMap::new()),
            generation_slot: Arc::new(Semaphore::new(1)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedModelPaths {
    pub diffusion: PathBuf,
    pub vae: PathBuf,
    pub clip_l: PathBuf,
    pub t5xxl: PathBuf,
}
