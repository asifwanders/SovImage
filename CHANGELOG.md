# Changelog

SovImage follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0 releases may contain breaking storage or model changes.

## [Unreleased]

## [0.2.0] - 2026-09-02

### Changed

- Set the application version to 0.2.0.
- Replaced the FLUX.1-dev/Kontext model set with one commercially usable,
  Apache-2.0 FLUX.2 Klein 4B generation-and-editing pipeline.
- Pinned all model URLs to immutable revisions and made expected SHA-256 and
  byte length mandatory.
- Updated `stable-diffusion.cpp` to `master-841-6b3edaa`
  (`6b3edaaf32cc19e5bb2d819c788bd557eddc8eba`).
- Raised supported hardware to a conservative 12 GiB minimum and separated
  Apple unified-memory from NVIDIA VRAM selection.
- Removed model-type overrides and process-argument prompts; generation now
  uses the pinned engine's FLUX.2 guidance, backend, VRAM-budget, prompt-file,
  and metadata-disable controls.
- Updated CI to Node 24, Rust 1.98, and reviewed immutable action SHAs; added
  real/stub Rust tests, clippy, exact engine CLI/provenance checks,
  release-resource checks, and upstream drift detection.
- Pinned Node 24.14.1/npm 11.11.0, fingerprinted native engine caches, and
  added Windows-only Rust checks to pull-request CI.
- Limited Tailwind source discovery to `frontend/src`, eliminating repository-
  wide production-build scans.

### Security

- Replaced the disabled CSP with a local-only policy and reduced Tauri
  capabilities to the UI's actual operations.
- Removed `$HOME/**` and frontend sidecar-execution permission.
- Escaped search results rather than rendering stored prompt HTML.
- Added bounded PNG/JPEG attachment validation and terminal generation-state
  reconciliation.
- Added full browser decode before attachment persistence, structured hardware
  rejection reasons, bounded sidecar wait retries, and exact stale-metadata cleanup.
- Added retained sidecar ownership/reaping, an app-instance GPU lock,
  APPLOCAL media/model migration, atomic generated-image publication, and
  bounded setup/generation queues.

### Distribution

- Added a fail-closed direct release lane: ad-hoc/unsigned dry runs, Developer
  ID signing and notarization, Windows Authenticode, checksums, and draft-only
  GitHub Releases.
- Added an independent Mac App Store lane with App Sandbox, outbound network
  and user-selected-file entitlements, a separately signed inherited helper,
  provisioning-profile validation, signed `.pkg`, App Store Connect validation,
  and explicit opt-in upload.
- Added build provenance, a privacy manifest/policy, third-party notices, an
  App Store checklist, macOS 12 deployment enforcement, and a seven-resolution
  Windows icon.
- App Store packaging now compares every bundled legal/privacy/provenance
  resource with source and verifies the non-exempt-encryption declaration.
- Added fail-closed Windows CUDA/cuBLAS runtime-closure construction and
  installer verification; a clean NVIDIA Windows run remains a release gate.
- Reworked the app icon/wordmark presentation, accessible contrast, sizing,
  focus, reduced-motion behavior, and setup/download disclosure.

## [0.1.0-beta.1] - 2026-05-24

Initial Tauri/Next scaffold and unsigned beta workflow. This build is retained
for history and should not be submitted to an app store.
