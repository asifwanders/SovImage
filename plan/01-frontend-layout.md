# 01 — Current Frontend Contract

The Next App Router exports three static routes: `/`, `/settings`, and `/about`.
`RootLayout` mounts theme bootstrap, the first-run setup gate, the shared shell,
sidebar, and toast host. There are no server actions or production Node server.

The chat surface owns:

- SQLite-backed chat/message CRUD and startup reconciliation of interrupted jobs.
- FTS search with text escaped into safe React nodes; stored prompts are never rendered as HTML.
- A composer accepting bounded PNG/JPEG references and showing edit-specific copy.
- One pending/queued/progress/terminal bubble per assistant generation.
- OS-dialog export, clipboard copy, regeneration with persisted generation metadata, and cancellation.

Setup presents hardware support, exact missing download bytes, consent,
resumable progress, hash verification, retry/cancel, and a conservative tier
warning. Model ID comes from the backend profile rather than frontend copies.

About reads the bundled build provenance resource. Settings exposes only
behavior implemented by the runtime; destructive actions cancel work and clear
the corresponding DB/files rather than changing labels alone.

The frontend's Tauri permissions are deliberately limited to events/path/close,
safe external URL opening, dialogs, app-data files plus dialog-selected paths,
platform/architecture, SQL, and read-only build provenance. It cannot launch
the inference helper.
