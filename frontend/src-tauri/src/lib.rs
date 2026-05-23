mod commands;
mod db;
#[cfg(not(feature = "stub_runtime"))]
mod downloader;
mod error;
#[cfg(not(feature = "stub_runtime"))]
mod hardware;
mod sidecar;
mod state;

use tracing_subscriber::{fmt, EnvFilter};

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
            // Kick off setup runtime on app launch so the splash screen has
            // something to render against. In stub mode this is the mocked
            // progress loop; in real mode it probes hardware + downloads.
            #[cfg(feature = "stub_runtime")]
            commands::setup::spawn_stub_runtime_pub(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::setup::setup_state,
            commands::setup::setup_start_download,
            commands::setup::setup_pause,
            commands::setup::setup_resume,
            commands::setup::setup_retry,
            // Chat/message/settings CRUD lives in the frontend via
            // `@tauri-apps/plugin-sql` directly — see frontend/src/lib/db.ts.
            // Rust does not proxy DB queries.
            commands::generation::generate_image,
            commands::generation::cancel_generation,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running SovImage");
}
