# 08 — Generation Lifecycle Contract

The frontend creates the message UUID and subscribes to
`generation://<message-id>` before invoking Rust. Rust validates the ID,
resolves the model profile and accelerator backend, writes a private prompt
file, and queues one generation at a time.

Every accepted job must emit exactly one terminal state: `done`, `error`, or
`cancelled`. Lookup, spawn, channel-close, nonzero-exit, missing output,
cancellation, and panic-adjacent task failures may not leave a pending row.
Startup reconciliation marks jobs interrupted by a prior process exit.

Progress parsing is pinned to captured output from the current engine and is
unit-tested. Exit code zero is insufficient success: Rust verifies the output
exists, is nonempty, and is a valid bounded PNG before publishing it.

Cancellation is checked before and after queue acquisition and kills/reaps the
child. Prompt temporary files are removed after every terminal path. User
prompts do not appear in the process list or output metadata.

The Tauri capability file intentionally contains no shell execute permission.
The backend launches the configured `externalBin` directly via Rust.
