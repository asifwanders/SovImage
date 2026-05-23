# Security Policy

## Supported versions

SovImage is pre-alpha. The `main` branch is the only supported revision.
Pre-1.0 we may break things between commits.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Email: `security@<repo-owner-domain>` (or open a GitHub Security Advisory
draft at <https://github.com/asifwanders/SovImage/security/advisories/new>).

Include:
- A clear description of the issue
- Steps to reproduce
- The commit SHA you tested against
- Your OS / arch (macOS arm64, Windows x64)
- Any proof-of-concept code or files (small, please)

We aim to acknowledge within 72 hours and ship a fix or mitigation within 14
days for critical issues. Coordinated disclosure preferred.

## Threat model

SovImage runs entirely on-device. There is no SovImage-controlled server,
account system, or cloud backend. The relevant attack surface is:

1. **Downloader** — pulls GGUF + safetensors blobs from HuggingFace. We
   pin URLs in `src-tauri/src/downloader/registry.rs`, never construct
   them from user input, and verify SHA256 against compile-time
   constants. A compromised upstream mirror would be caught by the hash
   check; a hash-collision attack is treated as out-of-scope.

2. **Sidecar (`sd.cpp`)** — runs as a child process with prompt text
   passed as a single argv element (auto-escaped by Tauri). No shell
   interpolation. Init-image paths are canonicalized and required to live
   under `<app_data>/attachments/` (defense in depth — see
   `commands::generation::generate_image`).

3. **SQLite** — local file at `<app_data>/sovimage.db`. Schema is owned
   by signed migrations in the binary; no raw SQL crosses the IPC
   boundary. All queries from JS use parameter binding via
   `@tauri-apps/plugin-sql`.

4. **Tauri IPC** — only commands listed in
   `src-tauri/src/lib.rs::invoke_handler!` are reachable. Sidecar
   execution is gated by `shell:allow-execute` scoped to the `binaries/sd`
   sidecar in `capabilities/default.json`.

## Out of scope

- Local privilege escalation on a compromised user account
- Side-channel inference attacks against generated content
- Bugs in upstream dependencies (`stable-diffusion.cpp`, Tauri, Next.js,
  Flux model weights) — please report upstream

## Disclosure history

None yet. This file will list resolved CVEs once any exist.
