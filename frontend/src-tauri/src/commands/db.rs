//! Shared serde shapes used by the IPC layer. All actual chat/message/
//! settings CRUD happens in the frontend via `@tauri-apps/plugin-sql` —
//! see `frontend/src/lib/db.ts`. Rust does not proxy DB queries.
//!
//! Only the `Message` struct survives here because `commands::generation`
//! returns it as the placeholder shape the frontend already knows.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub kind: String,
    pub content: Option<String>,
    pub image_path: Option<String>,
    pub meta: Option<serde_json::Value>,
    pub parent_id: Option<String>,
    pub status: String,
    pub created_at: String,
}
