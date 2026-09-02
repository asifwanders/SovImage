# 02 — SQLite Storage Contract

Database URL: `sqlite:sovimage.db`. Rust registers numbered SQL migrations with
`tauri-plugin-sql`; the frontend loads the connection and sets persistent WAL.
SQLx enables foreign keys on its pooled SQLite connections, while migration 2
also installs explicit cleanup triggers.

`0001_init.sql` is byte-immutable because SQLx stores its checksum. Its original
URL comment is historical; current behavior is defined here and in `db.ts`.

Migration `0001_init.sql` creates:

- `chats`: UUID, title/timestamps, pinned and archived flags.
- `messages`: chat FK, role/kind, content, image path, generation metadata JSON,
  parent, and `pending|queued|done|error|cancelled` status.
- `attachments`: message FK and local file metadata.
- `settings`: string key/value.
- `setup_state`: selected tier/model and setup flags.
- `messages_fts`: FTS5 content index maintained by insert/update/delete triggers.

The frontend uses `tauri-plugin-sql` directly; Rust does not proxy chat SQL.
Queries bind user values. FTS snippets use non-HTML sentinel markers and the UI
constructs React nodes around matches.

On startup, `pending` and `queued` rows from a previous process are reconciled
to an interrupted error state. Generation metadata persists the actual model,
mode, seed, dimensions, steps, CFG, and guidance needed for reproduction.

Migration policy: never edit a migration included in a published build. Add the
next numbered file and register it in Rust. File deletion/GC is not a database
transaction; destructive UI flows must cancel jobs, update rows, and then make
best-effort app-data cleanup with truthful failure reporting.
