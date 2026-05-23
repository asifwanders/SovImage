# SovImage

![CI](https://github.com/asifwanders/SovImage/actions/workflows/ci.yml/badge.svg) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Release](https://img.shields.io/github/v/release/asifwanders/SovImage?include_prereleases)

Open-source, local AI image generation desktop app. Powered by Flux.1 GGUF
models running entirely on your device through `stable-diffusion.cpp`. No
servers. No telemetry. No cloud.

## Status

Pre-alpha. Frontend + Tauri shell skeleton.

## Architecture

- **Shell:** Tauri 2 (Rust)
- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, Framer Motion
- **Storage:** Embedded SQLite via `tauri-plugin-sql`
- **Engine:** `stable-diffusion.cpp` sidecar
  - macOS arm64 — Metal
  - Windows x64 — CUDA (NVIDIA only)

See [`plan/`](plan/) for the full design — architecture, frontend layout,
SQLite schema, resilient downloader, sidecar orchestration, and design tokens.

## Running

```bash
cd frontend
npm install
npm run dev       # browser-only, with mocked IPC
npm run tauri:dev # real Tauri shell
```

## Tiered model selection

| Tier | RAM/VRAM   | Model                       |
|------|------------|-----------------------------|
| 1    | < 12 GB    | Flux.1-schnell Q4_0 GGUF    |
| 2    | 12–16 GB   | Flux.1-schnell Q8_0 GGUF    |
| 3    | > 16 GB    | Flux.1-dev Q8_0 GGUF        |

Detected automatically on first launch. Override available in Settings.

## License

MIT.
