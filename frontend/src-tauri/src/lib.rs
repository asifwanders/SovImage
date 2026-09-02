mod commands;
mod db;
mod downloader;
mod error;
mod hardware;
mod sidecar;
mod state;

#[cfg(all(feature = "real_runtime", feature = "stub_runtime"))]
compile_error!("real_runtime and stub_runtime are mutually exclusive");
#[cfg(not(any(feature = "real_runtime", feature = "stub_runtime")))]
compile_error!("enable exactly one of real_runtime or stub_runtime");

use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

fn stop_background_work(state: &state::AppState) {
    state.begin_exit();
    if let Ok(setup_cancel) = state.setup_cancel.try_lock() {
        if let Some(cancel) = setup_cancel.as_ref() {
            cancel.cancel();
        }
    }
    if let Ok(generations) = state.generations.try_lock() {
        for cancel in generations.values() {
            cancel.cancel();
        }
    }
    state.kill_tracked_sidecars();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fmt()
        .with_env_filter(
            EnvFilter::try_from_env("SOVIMAGE_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .try_init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .manage(state::AppState::new())
        .setup(|app| {
            let local_data = app.path().app_local_data_dir()?;
            let instance_lock = downloader::InstanceLock::try_acquire(&local_data)?;
            *app.state::<state::AppState>()
                .instance_lock
                .lock()
                .map_err(|_| std::io::Error::other("instance lock state is poisoned"))? =
                Some(instance_lock);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::setup::setup_state,
            commands::setup::setup_start_download,
            commands::setup::setup_estimate_size,
            commands::setup::setup_confirm_download,
            commands::setup::setup_pause,
            commands::setup::setup_resume,
            commands::setup::setup_retry,
            commands::setup::migrate_local_storage,
            commands::setup::obsolete_model_inventory,
            commands::setup::cleanup_obsolete_models,
            // Chat/message/settings CRUD lives in the frontend via
            // `@tauri-apps/plugin-sql` directly — see frontend/src/lib/db.ts.
            // Rust does not proxy DB queries.
            commands::generation::generate_image,
            commands::generation::cancel_generation,
        ]);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            eprintln!("SovImage could not start: {error}");
            return;
        }
    };
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let state = app.state::<state::AppState>();
            stop_background_work(&state);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn exit_contract_cancels_setup_and_generation_before_shutdown() {
        let state = state::AppState::new();
        let setup = Arc::new(CancellationToken::new());
        let generation = Arc::new(CancellationToken::new());
        *state.setup_cancel.try_lock().unwrap() = Some(setup.clone());
        state
            .generations
            .try_lock()
            .unwrap()
            .insert("test".into(), generation.clone());
        stop_background_work(&state);
        assert!(state.is_exiting());
        assert!(setup.is_cancelled());
        assert!(generation.is_cancelled());
    }
}
