# 04 — Sidecar Draft Superseded

The original long-lived JSONL-server design was never the shipped contract.
SovImage currently launches one `sd` CLI child per queued request, guarded by a
single-generation semaphore. This costs model reload time but avoids owning a
custom server protocol and remains compatible with the pinned upstream CLI.

Current lifecycle, prompt-file security, progress, cancellation, output
validation, and terminal-event requirements are authoritative in
`08-sidecar-protocol.md`. Exact model arguments are in
`06-sdcpp-execution.md`.

A persistent server should be reconsidered only after measurement shows reload
cost dominates and the upstream API provides equivalent cancellation,
prompt-file privacy, backend selection, output validation, and App Sandbox
behavior.
