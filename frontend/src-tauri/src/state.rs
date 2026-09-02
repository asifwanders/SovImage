#![cfg_attr(feature = "stub_runtime", allow(dead_code))]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
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
    /// Resolved on-disk paths to the three GGUF/safetensors files the current
    /// tier needs. Populated when the downloader finishes successfully.
    pub model_paths: Mutex<Option<ResolvedModelPaths>>,
    /// Exact sd.cpp backend selected by the hardware probe (metal or cudaN).
    pub runtime_backend: Mutex<Option<String>>,
    /// Per-message cancellation tokens for in-flight generations.
    pub generations: Mutex<HashMap<String, Arc<CancellationToken>>>,
    /// At most one sd.cpp generation runs at a time (the model is loaded
    /// once per spawn; concurrent loads would thrash unified memory).
    pub generation_slot: Arc<Semaphore>,
    /// Rust-spawned helpers are not part of the shell plugin's JavaScript child
    /// store, so the app must retain kill-capable handles for process exit.
    pub sidecars: StdMutex<HashMap<u32, Arc<SharedChild>>>,
    /// Reserved before spawning the OS process and released only after a
    /// definitive reap. This prevents retry from creating a second GPU owner.
    sidecar_reserved: AtomicBool,
    /// Exclusive app-lifetime lock; populated during Tauri setup.
    pub instance_lock: StdMutex<Option<crate::downloader::InstanceLock>>,
    pub exiting: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            setup: Mutex::new(SetupState::default()),
            setup_cancel: Mutex::new(None),
            setup_task: Mutex::new(None),
            spawn_guard: Mutex::new(()),
            model_paths: Mutex::new(None),
            runtime_backend: Mutex::new(None),
            generations: Mutex::new(HashMap::new()),
            generation_slot: Arc::new(Semaphore::new(1)),
            sidecars: StdMutex::new(HashMap::new()),
            sidecar_reserved: AtomicBool::new(false),
            instance_lock: StdMutex::new(None),
            exiting: AtomicBool::new(false),
        }
    }

    pub fn reserve_sidecar(&self) -> Result<(), String> {
        if self.is_exiting() {
            return Err("SovImage is shutting down".into());
        }
        self.sidecar_reserved
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "another sd sidecar has not been reaped yet".to_string())?;
        if self.is_exiting() {
            self.sidecar_reserved.store(false, Ordering::Release);
            return Err("SovImage is shutting down".into());
        }
        Ok(())
    }

    pub fn release_unspawned_sidecar(&self) {
        debug_assert!(
            self.sidecars
                .lock()
                .map(|sidecars| sidecars.is_empty())
                .unwrap_or(false)
        );
        self.sidecar_reserved.store(false, Ordering::Release);
    }

    pub fn track_sidecar(&self, child: Arc<SharedChild>) -> u32 {
        let pid = child.id();
        debug_assert!(self.sidecar_reserved.load(Ordering::Acquire));
        let mut sidecars = self
            .sidecars
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        debug_assert!(sidecars.is_empty());
        sidecars.insert(pid, child);
        drop(sidecars);
        if self.exiting.load(Ordering::Acquire) {
            let _ = self.kill_sidecar(pid);
        }
        pid
    }

    pub fn untrack_sidecar(&self, pid: u32, child: &Arc<SharedChild>) {
        let mut sidecars = self
            .sidecars
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let removed = sidecars
            .get(&pid)
            .is_some_and(|tracked| Arc::ptr_eq(tracked, child));
        if removed {
            sidecars.remove(&pid);
        }
        if removed && sidecars.is_empty() {
            self.sidecar_reserved.store(false, Ordering::Release);
        }
    }

    pub fn kill_sidecar(&self, pid: u32) -> Result<(), String> {
        let child = self
            .sidecars
            .lock()
            .map_err(|_| "sidecar tracker is poisoned".to_string())?
            .get(&pid)
            .cloned()
            .ok_or_else(|| format!("sidecar {pid} is no longer tracked"))?;
        child.kill().map_err(|error| error.to_string())
    }

    pub fn kill_tracked_sidecars(&self) {
        let children = self
            .sidecars
            .lock()
            .map(|sidecars| sidecars.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for child in children {
            let pid = child.id();
            match child.kill() {
                Ok(()) => {
                    if let Err(error) = child.wait() {
                        tracing::error!(pid, %error, "failed to reap tracked sidecar during exit");
                    }
                }
                Err(error) => {
                    tracing::error!(pid, %error, "failed to terminate tracked sidecar during exit");
                }
            }
        }
    }

    pub fn begin_exit(&self) {
        self.exiting.store(true, Ordering::Release);
    }

    pub fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
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
    pub llm: PathBuf,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn kill_keeps_owned_child_tracked_until_explicit_reap_confirmation() {
        let state = AppState::new();
        state.reserve_sidecar().unwrap();
        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", "exec sleep 30"]);
        let child = Arc::new(SharedChild::spawn(&mut command).unwrap());
        let pid = state.track_sidecar(child.clone());
        state.kill_sidecar(pid).unwrap();
        assert!(state.sidecars.lock().unwrap().contains_key(&pid));
        assert!(!child.wait().unwrap().success());
        state.untrack_sidecar(pid, &child);
        assert!(!state.sidecars.lock().unwrap().contains_key(&pid));
    }

    #[test]
    #[cfg(unix)]
    fn reservation_prevents_spawning_a_second_sidecar() {
        let state = AppState::new();
        state.reserve_sidecar().unwrap();
        let mut first_command = std::process::Command::new("/bin/sh");
        first_command.args(["-c", "exec sleep 30"]);
        let first = Arc::new(SharedChild::spawn(&mut first_command).unwrap());
        let first_pid = state.track_sidecar(first.clone());
        assert!(state.reserve_sidecar().is_err());

        first.kill().unwrap();
        first.wait().unwrap();
        state.untrack_sidecar(first_pid, &first);
        state.reserve_sidecar().unwrap();
        state.release_unspawned_sidecar();
    }
}
