# Security Policy

## Supported versions

Until 0.2.0 is published, only the current `main` revision is supported. After
publication, the latest signed release and `main` are supported.

## Report privately

Do not file a public issue containing an exploit, private data, or a vulnerable
download URL. Open a private [GitHub Security Advisory draft](https://github.com/asifwanders/SovImage/security/advisories/new).

Include the tested source commit and build provenance, OS/hardware, exact steps,
impact, and a minimal proof of concept. Do not attach real prompts or images
unless they are necessary and safe to share.

## Current trust boundaries

### Models and network

The Rust downloader—not the webview—contacts HTTPS Hugging Face URLs compiled
into `downloader/registry.rs`. Each URL includes an immutable repository
revision. Activation requires the declared byte length and lowercase SHA-256;
missing hashes, length mismatches, redirects to an unexpected scheme, and
incomplete files fail closed. Complete files are hashed on every app start and
cached only in memory for that process. Downloads can resume via
range requests, so transport metadata is still exposed to Hugging Face and its
CDN as described in [PRIVACY.md](PRIVACY.md).

### Native inference helper

The helper path comes from Tauri's bundled `externalBin`, never user input.
SovImage passes prompts through a private app-data temporary file rather than a
process argument. Attachment paths are validated and copied into app data.
Generated output stays inside app data until the user selects an export path.
The Mac App Store helper is signed separately with exactly App Sandbox and
sandbox-inheritance entitlements.

### Webview and IPC

The production webview has a restrictive CSP and an asset protocol limited to
app-data roots. Capabilities expose only the core/window/path/event operations,
dialog-scoped user files, app-data file operations, OS platform/architecture,
local SQL, and safe external URL opening used by the UI. The frontend cannot
execute the inference sidecar.

The frontend does use `tauri-plugin-sql` directly. SQL statements are defined
in shipped JavaScript and parameter-bind user values; it is inaccurate to claim
that no SQL crosses IPC. Treat every `dangerouslySetInnerHTML`, file URL, plugin
permission, and new Tauri command as a trust-boundary change.

### Local data

SQLite, prompts, attachments, models, generated images, and temporary prompt
files are local user data. OS account compromise, arbitrary local process
access, and physical-device compromise are outside SovImage's isolation
guarantee. Temporary prompt files must be removed on success, failure, and
cancellation.

## Release integrity

Public direct builds require Developer ID/notarization or Authenticode and ship
SHA-256 checksum files. Secret-bearing direct jobs require approval through the
protected `desktop-release` environment. App Store packages require Apple
Distribution, a matching distribution profile, sandbox verification, Mac
Installer Distribution, server-side validation, and an unchanged package hash
between validation and upload. Mutable workflow action tags, unsigned/ad-hoc
dry-run artifacts, and unreviewed dependency notices are never release proof.
The scheduled upstream build runs fetched CMake code without write permissions
or persisted checkout credentials; issue reporting is isolated in a separate
job that consumes only sanitized GitHub job status.

Dependency or model vulnerabilities that affect SovImage's packaging or usage
should be reported here even when the root cause is upstream.

## Current dependency-audit gate

The offline 2 September 2026 scan found no npm vulnerabilities and no high or
critical Rust vulnerabilities. It did identify two fixed medium advisories in
the locked transitive graph:

- `serde_with` 3.20.0: `GHSA-7gcf-g7xr-8hxj` (fixed in 3.21.0). SovImage does
  not intentionally use the affected `KeyValueMap` serialization path, but the
  exact candidate still requires a reviewed update or reachability decision.
- `glib` 0.18.5: `GHSA-wrw7-89jp-8q8g` (fixed in 0.20.0). This crate is in the
  Linux-only graph; Linux is not a supported release target. It must be updated
  before any Linux release claim.

The fixed crate sources were not present in the local offline cache, so this
review did not fabricate an unbuildable lockfile change. Public workflows fail
closed until `SOVIMAGE_DEPENDENCY_AUDIT_COMMIT` matches the exact candidate.
