# SovImage — Implementation Plan

| #   | File                         | Topic                                      |
|-----|------------------------------|--------------------------------------------|
| 00  | [00-architecture.md](00-architecture.md) | Layered architecture + repo layout     |
| 01  | [01-frontend-layout.md](01-frontend-layout.md) | React/Next/Tailwind/Framer layout |
| 02  | [02-sqlite-schema.md](02-sqlite-schema.md) | SQLite schema + FTS5 + migrations      |
| 03  | [03-rust-downloader.md](03-rust-downloader.md) | Resilient HTTP Range downloader  |
| 04  | [04-sidecar-orchestration.md](04-sidecar-orchestration.md) | sd.cpp sidecar protocol |
| 05  | [05-design-system.md](05-design-system.md) | Tokens, components, accessibility    |
| 06  | [06-sdcpp-execution.md](06-sdcpp-execution.md) | sd.cpp CLI flags + tier matrix + 8 GB M1 survival |
| 07  | [07-cicd-pipeline.md](07-cicd-pipeline.md) | GitHub Actions release matrix + sd.cpp build jobs |
| 08  | [08-sidecar-protocol.md](08-sidecar-protocol.md) | Rust supervisor, argv builder, progress parser |
| —   | [CURRENT.md](CURRENT.md)               | Plan ↔ code drift; what's implemented vs deferred |

## Sprint scope (superseded)

Original sprint was frontend + shell skeleton only. As of 2026-05-24 the
real Rust runtime (downloader, sidecar, hardware probe) is wired and
tested. See [CURRENT.md](CURRENT.md) for the live status matrix.

## Targets

- macOS arm64 (Apple Silicon) — Metal sd.cpp build
- Windows x64 — CUDA sd.cpp build (NVIDIA GPUs only)
