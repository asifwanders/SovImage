# 02 — SQLite Schema (tauri-plugin-sql)

DB file: `<app_data_dir>/sovimage.db` (created on first launch). WAL mode.
Foreign keys on. UTC ISO-8601 timestamps as TEXT.

## Migrations (Rust `Migration` list, version-ordered)

### v1 — initial schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE chats (
  id            TEXT PRIMARY KEY,          -- uuid v4
  title         TEXT NOT NULL DEFAULT 'New chat',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,          -- uuid v4
  chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  kind          TEXT NOT NULL CHECK(kind IN ('text','image','error')),
  content       TEXT,                      -- prompt text or error msg
  image_path    TEXT,                      -- relative to app_data_dir/images
  meta_json     TEXT,                      -- {model, steps, seed, cfg, w, h}
  parent_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'done'
                CHECK(status IN ('pending','done','error','cancelled')),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,             -- relative to app_data_dir
  mime          TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  created_at    TEXT NOT NULL
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE setup_state (
  id            INTEGER PRIMARY KEY CHECK(id = 1),
  tier          INTEGER,                   -- 1|2|3
  model_id      TEXT,                      -- e.g. flux1-schnell-q4_0
  download_done INTEGER NOT NULL DEFAULT 0,
  sha256_ok     INTEGER NOT NULL DEFAULT 0,
  sidecar_ok    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
INSERT INTO setup_state (id, updated_at) VALUES (1, datetime('now'));

-- FTS5 for chat search
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  chat_id UNINDEXED,
  message_id UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages
WHEN new.content IS NOT NULL BEGIN
  INSERT INTO messages_fts(rowid, content, chat_id, message_id)
  VALUES (new.rowid, new.content, new.chat_id, new.id);
END;

CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
  UPDATE messages_fts SET content = new.content WHERE rowid = old.rowid;
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
```

## Default settings rows (seeded v1)

| key                   | default              |
|-----------------------|----------------------|
| theme                 | `system`             |
| sidebar.collapsed     | `false`              |
| output.directory      | `app_data/images`    |
| generation.steps      | `4` (schnell) / `28` (dev) |
| generation.cfg        | `1.0` (schnell) / `3.5` (dev) |
| telemetry.enabled     | `false`              |
| model.override        | `null` (auto-tier)   |

## Query patterns

- **Chat list**: `SELECT id,title,updated_at FROM chats WHERE archived=0 ORDER BY pinned DESC, updated_at DESC`
- **Chat detail**: `SELECT * FROM messages WHERE chat_id=? ORDER BY created_at`
- **Search**: `SELECT message_id, chat_id, snippet(messages_fts, 0, '<b>','</b>','…',16) FROM messages_fts WHERE messages_fts MATCH ? LIMIT 50`
- **Rename**: `UPDATE chats SET title=?, updated_at=? WHERE id=?`
- **Delete**: `DELETE FROM chats WHERE id=?` (cascades messages + attachments
  rows; image files cleaned by a Rust GC pass).

## IPC surface

```ts
// frontend/src/lib/ipc.ts
invoke<Chat[]>('db_chats_list')
invoke<Chat>('db_chats_create', { title })
invoke<void>('db_chats_rename', { id, title })
invoke<void>('db_chats_delete', { id })
invoke<Message[]>('db_messages_list', { chatId })
invoke<Message>('db_messages_append', { chatId, role, kind, content, metaJson, parentId })
invoke<void>('db_messages_update_status', { id, status, imagePath })
invoke<SearchHit[]>('db_search', { query })
invoke<Setting>('settings_get', { key })
invoke<void>('settings_set', { key, value })
invoke<SetupState>('setup_state_get')
```

## Migration policy

- Every schema change → new file `migrations/NNNN_description.sql` + entry
  in the Rust `Migration` vec. Never edit a shipped migration.
- Add backfill UPDATE statements at the bottom of each migration when needed.
