# Changelog

All notable changes to SovImage will be documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); semver
applies post-1.0.

## [Unreleased]

### Added
- Initial scaffold: Tauri 2 + Next.js 16 + React 19 + Tailwind 4 frontend.
- Liquid-glass chat UI: sidebar w/ collapse + chat CRUD, splash screen
  with progress bar + pause/resume/retry, settings, about.
- Sidebar inherits SovLens design tokens (`#00b9a0` accent, dark/light
  themes, glass panels, Ubuntu @ 13 px base).
- Image bubbles: pending shimmer, success w/ hover actions, error state,
  cancel button while pending.
- Hardware profiler module: macOS unified memory via `sysctl hw.memsize`,
  Windows NVIDIA VRAM via NVML w/ `GlobalMemoryStatusEx` fallback.
- Tiered model selection (Tier 1 < 12 GB, Tier 2 12–16 GB, Tier 3 > 16 GB).
- Resilient downloader: HTTP Range resume, persistent `*.part.json` state,
  SHA256 verification, exponential backoff, ETag-aware re-validation.
- SQLite via `tauri-plugin-sql` w/ FTS5 search index; frontend talks to
  the DB directly through a thin Driver facade (`lib/db.ts`).
- sd.cpp sidecar supervisor: per-tier argv builder (`--vae-on-cpu`,
  `--clip-on-cpu`, `--vae-tiling`, etc. for tier 1), stderr step parser
  for 3 sd.cpp output formats, per-message cancellation via `tokio::select!`,
  generation semaphore (1 in-flight).
- GitHub Actions release workflow: matrix `macos-14` (aarch64 / Metal) +
  `windows-2022` (x86_64 / CUDA 12.5). Builds sd.cpp from pinned
  submodule, uploads sidecar artifact, runs `tauri-action` to produce
  `.dmg` + `.msi`/`.exe`. Signing slots wired but optional (unsigned
  builds for pre-alpha).
- Browser-dev mock layer in `lib/ipc.ts` + `lib/db.ts` (memory driver)
  so the UI runs under `next dev` without Tauri or sd.cpp.
- Model registry w/ real SHA256s for all 7 Flux files; ungated mirror
  used for the BFL-licensed VAE blob.

### Pinned
- `stable-diffusion.cpp` submodule at `master-645-645e6e9`
  (`645e6e9089c78bd61368f3a667644fee39e463b6`, 2026-05-22).

### Plans
- `plan/00-architecture.md` through `plan/08-sidecar-protocol.md`.
- BUILDING.md, CONTRIBUTING.md, SECURITY.md.

### Notes
- Unsigned installers on both platforms this release. macOS users will
  need to right-click → Open first launch; Windows users will see
  SmartScreen. Signing secrets land in 0.2.x.
- Tier 1 8 GB Apple Silicon: even with all memory-saving flags + Q2_K
  quantized T5, peak unified memory pushes 7–8 GB. Splash will warn.
