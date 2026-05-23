//! SQLite migration registration for tauri-plugin-sql.
//!
//! The Rust code only owns migrations; all CRUD happens from the frontend
//! via `Database.load("sqlite:sovimage.db")` + bound queries. This keeps the
//! IPC surface narrow (no Rust command per query) and lets the frontend
//! evolve UI-driven queries without round-tripping through Rust.

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection URL used by tauri-plugin-sql. Per-connection PRAGMAs that the
/// migration cannot set go in the query string. The frontend MUST load the
/// DB with exactly this URL (`@tauri-apps/plugin-sql` Database.load()).
pub const DB_URL: &str = "sqlite:sovimage.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema (chats, messages, attachments, settings, setup_state, FTS5)",
        sql: include_str!("../../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
}
