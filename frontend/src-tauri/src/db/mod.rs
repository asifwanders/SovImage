//! SQLite migration registration for tauri-plugin-sql.
//!
//! The Rust code only owns migrations; all CRUD happens from the frontend
//! via `Database.load("sqlite:sovimage.db")` + bound queries. This keeps the
//! IPC surface narrow (no Rust command per query) and lets the frontend
//! evolve UI-driven queries without round-tripping through Rust.

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection URL used by tauri-plugin-sql. The frontend MUST load the DB with
/// exactly this URL (`@tauri-apps/plugin-sql` Database.load()). SQLx enables
/// foreign keys per pooled SQLite connection; the frontend sets persistent WAL
/// mode after loading.
pub const DB_URL: &str = "sqlite:sovimage.db";

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description:
                "initial schema (chats, messages, attachments, settings, setup_state, FTS5)",
            sql: include_str!("../../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "atomic data clearing and automatic chat timestamps",
            sql: include_str!("../../migrations/0002_data_consistency.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
