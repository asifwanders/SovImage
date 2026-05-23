use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

use crate::error::{AppError, AppResult};
use crate::state::{AppState, ResolvedModelPaths, SetupState};

#[cfg(not(feature = "stub_runtime"))]
use crate::downloader::{self, registry};
#[cfg(not(feature = "stub_runtime"))]
use crate::hardware;

#[tauri::command]
pub async fn setup_state(state: State<'_, AppState>) -> AppResult<SetupState> {
    Ok(state.setup.lock().await.clone())
}

#[tauri::command]
pub async fn setup_start_download(app: AppHandle) -> AppResult<()> {
    spawn_runtime(app).await;
    Ok(())
}

#[tauri::command]
pub async fn setup_pause(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if let Some(tok) = state.setup_cancel.lock().await.as_ref() {
        tok.cancel();
    }
    {
        let mut s = state.setup.lock().await;
        if s.phase == "downloading" {
            s.phase = "paused".into();
        }
    }
    // Push phase change so the splash flips immediately rather than waiting
    // for the next 200 ms poll tick.
    let _ = app.emit("setup://phase", "paused");
    Ok(())
}

#[tauri::command]
pub async fn setup_resume(app: AppHandle) -> AppResult<()> {
    spawn_runtime(app).await;
    Ok(())
}

#[tauri::command]
pub async fn setup_retry(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    // Cancel + await the prior task BEFORE resetting SetupState. Without
    // this, a late callback from the old task can overwrite `phase` or
    // `error` after we've cleared it, polluting the fresh run's UI.
    let prior = state.setup_task.lock().await.take();
    let prior_cancel = state.setup_cancel.lock().await.clone();
    if let Some(tok) = prior_cancel {
        tok.cancel();
    }
    if let Some(h) = prior {
        let _ = h.await;
    }
    {
        let mut s = state.setup.lock().await;
        *s = SetupState::default();
    }
    spawn_runtime(app).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Runtime dispatch — stub vs real, gated by the `stub_runtime` feature.
// ---------------------------------------------------------------------------

async fn spawn_runtime(app: AppHandle) {
    // Serialize the entire cancel-prior + spawn-new sequence. Without this,
    // two rapid Resume clicks could see `setup_task = None` simultaneously
    // and both spawn a fresh task, racing on the same *.part file.
    let _spawn = app.state::<AppState>().inner().spawn_guard.lock().await;

    // If a prior setup task is still alive, signal cancel + await it to
    // completion before launching a new one.
    let prior = {
        let state = app.state::<AppState>();
        let mut guard = state.setup_task.lock().await;
        guard.take()
    };
    if let Some(handle) = prior {
        let cancel = app
            .state::<AppState>()
            .inner()
            .setup_cancel
            .lock()
            .await
            .clone();
        if let Some(tok) = cancel {
            tok.cancel();
        }
        let _ = handle.await;
    }

    let app_for_task = app.clone();
    #[cfg(feature = "stub_runtime")]
    let handle = tauri::async_runtime::spawn(async move {
        spawn_stub_runtime_inner(app_for_task).await;
    });
    #[cfg(not(feature = "stub_runtime"))]
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = real_runtime(app_for_task).await {
            error!(error = %e, "setup runtime failed");
        }
    });

    let state = app.state::<AppState>();
    *state.setup_task.lock().await = Some(handle);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressMirror {
    model_id: String,
    downloaded: u64,
    total: u64,
    bytes_per_sec: u64,
    eta_secs: u64,
}

// ---------------------------------------------------------------------------
// Real runtime: probe hardware → download manifest → mark ready.
// ---------------------------------------------------------------------------

#[cfg(not(feature = "stub_runtime"))]
async fn real_runtime(app: AppHandle) -> AppResult<()> {
    use std::path::PathBuf;

    let state = app.state::<AppState>();
    let cancel = Arc::new(CancellationToken::new());
    *state.setup_cancel.lock().await = Some(cancel.clone());

    // Phase: profiling
    {
        let mut s = state.setup.lock().await;
        s.phase = "profiling".into();
    }
    let profile = hardware::detect();
    let tier = profile.tier;
    let tier_num = tier as u8;
    let manifest = registry::manifest(tier);
    let grand_total = registry::total_bytes(tier);

    // Surface hw probe results to the splash regardless of supported-ness so
    // the frontend can render the "Unsupported hardware" panel with a device
    // label.
    {
        let mut s = state.setup.lock().await;
        s.supported = Some(profile.supported);
        s.device = Some(profile.device.clone());
    }

    if !profile.supported {
        let mut s = state.setup.lock().await;
        s.phase = "error".into();
        s.error = Some(format!(
            "Unsupported hardware: {}. SovImage requires Apple Silicon or an NVIDIA GPU.",
            profile.device
        ));
        return Ok(());
    }

    {
        let mut s = state.setup.lock().await;
        s.tier = Some(tier_num);
        s.model_id = Some(manifest[0].id.into());
        s.total = grand_total;
        s.phase = "downloading".into();
    }

    let models_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?
        .join("models");

    let mut cumulative: u64 = 0;
    let mut resolved = ResolvedModelPaths {
        diffusion: PathBuf::new(),
        vae: PathBuf::new(),
        clip_l: PathBuf::new(),
        t5xxl: PathBuf::new(),
    };

    for spec in manifest {
        let path = downloader::download(
            app.clone(),
            spec,
            &models_dir,
            cancel.clone(),
            cumulative,
            grand_total,
        )
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

        cumulative += spec.bytes;

        match spec.role {
            registry::ModelRole::Diffusion => resolved.diffusion = path,
            registry::ModelRole::Vae => resolved.vae = path,
            registry::ModelRole::ClipL => resolved.clip_l = path,
            registry::ModelRole::T5xxl => resolved.t5xxl = path,
        }
    }

    {
        let mut s = state.setup.lock().await;
        s.phase = "verifying".into();
    }
    // (Per-file verify already happened inside `downloader::download`.)
    tokio::time::sleep(Duration::from_millis(150)).await;

    {
        let mut s = state.setup.lock().await;
        s.phase = "starting_sidecar".into();
    }
    // Sidecar is spawned lazily on first generate_image call. We only
    // signal readiness here; bootstrapping a no-op spawn now would force a
    // model load before the user even opens a chat.
    tokio::time::sleep(Duration::from_millis(100)).await;

    *state.model_paths.lock().await = Some(resolved);

    {
        let mut s = state.setup.lock().await;
        s.phase = "ready".into();
        s.downloaded = s.total;
    }
    let _ = app.emit("setup://phase", "ready");
    info!("setup complete, tier {tier_num}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Stub runtime: emits realistic progress without any network or sd.cpp.
// Kept compiled by default (Cargo `default = ["stub_runtime"]`) so the
// frontend remains testable from `cargo tauri dev` without GGUF files.
// ---------------------------------------------------------------------------

#[cfg(feature = "stub_runtime")]
async fn spawn_stub_runtime_inner(app: AppHandle) {
    {
        let total: u64 = 6_500_000_000;
        let model_id = "flux1-dev-q8_0".to_string();
        let st = app.state::<AppState>();

        {
            let mut s = st.setup.lock().await;
            s.phase = "profiling".into();
            s.tier = Some(3);
            s.model_id = Some(model_id.clone());
            s.total = total;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;

        {
            let mut s = st.setup.lock().await;
            s.phase = "downloading".into();
        }
        let mut downloaded: u64 = 0;
        let chunk: u64 = total / 80;
        while downloaded < total {
            downloaded = (downloaded + chunk).min(total);
            let bps = chunk * 10;
            let eta = (total - downloaded) / bps.max(1);
            {
                let mut s = st.setup.lock().await;
                s.downloaded = downloaded;
                s.bytes_per_sec = bps;
                s.eta_secs = eta;
            }
            let _ = app.emit(
                "download://progress",
                ProgressMirror {
                    model_id: model_id.clone(),
                    downloaded,
                    total,
                    bytes_per_sec: bps,
                    eta_secs: eta,
                },
            );
            tokio::time::sleep(Duration::from_millis(80)).await;
        }

        {
            let mut s = st.setup.lock().await;
            s.phase = "verifying".into();
        }
        tokio::time::sleep(Duration::from_millis(600)).await;

        {
            let mut s = st.setup.lock().await;
            s.phase = "starting_sidecar".into();
        }
        tokio::time::sleep(Duration::from_millis(400)).await;

        {
            let mut s = st.setup.lock().await;
            s.phase = "ready".into();
        }
    }
}

// Public entry kept so lib.rs setup hook in stub mode compiles.
#[cfg(feature = "stub_runtime")]
pub fn spawn_stub_runtime_pub(app: AppHandle) {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        spawn_runtime(app2).await;
    });
}
