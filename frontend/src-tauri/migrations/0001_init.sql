-- v1 initial schema. See plan/02-sqlite-schema.md.
-- tauri-plugin-sql runs this exactly once and records it in the
-- _sqlx_migrations table; subsequent edits to this file MUST NOT happen —
-- add a new numbered migration instead.
--
-- NOTE on PRAGMAs: `journal_mode` cannot be set inside a transaction (sqlx
-- wraps migrations in one), and `foreign_keys` is connection-scoped. Both
-- are configured per-connection via the URL passed to Database.load() on
-- the frontend side: `sqlite:sovimage.db?journal_mode=WAL&foreign_keys=ON`.

CREATE TABLE IF NOT EXISTS chats (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT 'New chat',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  kind          TEXT NOT NULL CHECK(kind IN ('text','image','error')),
  content       TEXT,
  image_path    TEXT,
  meta_json     TEXT,
  parent_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'done'
                CHECK(status IN ('pending','done','error','cancelled','queued')),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  mime          TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setup_state (
  id            INTEGER PRIMARY KEY CHECK(id = 1),
  tier          INTEGER,
  model_id      TEXT,
  download_done INTEGER NOT NULL DEFAULT 0,
  sha256_ok     INTEGER NOT NULL DEFAULT 0,
  sidecar_ok    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
INSERT OR IGNORE INTO setup_state (id, updated_at) VALUES (1, datetime('now'));

-- FTS5 for chat search (plan/02).
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  chat_id UNINDEXED,
  message_id UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages
WHEN new.content IS NOT NULL BEGIN
  INSERT INTO messages_fts(rowid, content, chat_id, message_id)
  VALUES (new.rowid, new.content, new.chat_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
  UPDATE messages_fts SET content = new.content WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
