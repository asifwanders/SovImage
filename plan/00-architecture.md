# 00 — Architecture Overview

## Product

SovImage: open-source, fully-local AI image generation desktop app. Powered
by Flux.1 GGUF models running under `stable-diffusion.cpp` as a Tauri sidecar.
Zero terminal, one-click install.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React 19 / Next.js 16 (static export)                          │
│  ─ Chat UI · Sidebar · Splash · Settings · About                │
│  ─ Tailwind 4 tokens · Framer Motion · lucide-react             │
└────────────────────────────┬────────────────────────────────────┘
                             │ Tauri IPC (invoke + event channel)
┌────────────────────────────▼────────────────────────────────────┐
│  Tauri 2 Rust core (tokio async runtime)                        │
│  ─ Hardware profiler        (sysctl / NVML)                     │
│  ─ Resilient downloader     (reqwest + HTTP Range + SHA256)     │
│  ─ Sidecar supervisor       (spawn sd.cpp, lifecycle)           │
│  ─ Generation orchestrator  (queue, cancel, progress events)    │
│  ─ tauri-plugin-sql         (SQLite WAL, migrations)            │
│  ─ tauri-plugin-fs/dialog   (drop-target, image save)           │
└────────────────────────────┬────────────────────────────────────┘
                             │ stdio JSON-RPC / argv
┌────────────────────────────▼────────────────────────────────────┐
│  sd.cpp sidecar (Metal arm64 · CUDA win-x64)                    │
│  ─ Loads Flux.1 GGUF                                            │
│  ─ Emits progress, returns PNG bytes                            │
└─────────────────────────────────────────────────────────────────┘
```

## Repository layout (target)

```
SovImage/
├── frontend/                 Next.js 16 app (static export)
│   ├── src/app/              App Router routes (/, /settings, /about)
│   ├── src/components/       Sidebar, ChatView, Splash, Bubble, …
│   ├── src/lib/              ipc.ts, db.ts, theme.ts, types.ts
│   ├── src-tauri/            Rust shell
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── commands/     ipc handlers
│   │   │   ├── downloader/   resilient HTTP Range
│   │   │   ├── hardware/     RAM/VRAM probe
│   │   │   ├── sidecar/      sd.cpp supervisor
│   │   │   └── db/           migrations
│   │   └── tauri.conf.json
│   ├── package.json
│   └── tailwind / postcss / tsconfig …
├── plan/                     This dir
├── docs/                     Public docs (no AI markers)
├── README.md
├── LICENSE                   MIT or Apache-2.0
└── .gitignore                Excludes CLAUDE.md and AI traces
```

## Current sprint scope

**Frontend + Tauri shell skeleton only.** Rust subsystems (downloader,
sidecar) get stubs that emit mocked progress events so UI is wirable now and
swappable later. Plans 03 & 04 specify final behavior.

## Tech decisions / trade-offs

- **Next.js static export** (`output: "export"`) over plain Vite: keeps the
  SovLens DX (App Router, fonts, RSC where useful) while producing a flat
  `out/` Tauri can bundle. No server runtime in production.
- **Tailwind 4 + CSS variables** match SovLens design system exactly.
- **Framer Motion** for splash + bubble enter animations only — not for
  layout. Avoids re-render storms on chat streams.
- **lucide-react** matches SovLens icon set.
- **tauri-plugin-sql** > raw rusqlite: gives JS-side typed API and built-in
  migration runner.
- **No state library yet.** Local component state + a few Zustand stores
  if needed. Avoid Redux.

## Cross-cutting invariants

- All Tauri commands are `async` and return `Result<T, AppError>` where
  `AppError` is a serializable enum. UI never sees a string panic.
- All file writes happen under `tauri::path::app_data_dir()` — never the
  bundle dir, never the user's home.
- All long-running ops emit progress on a typed channel
  (`tauri::Window::emit`). UI subscribes via `listen`.
- No remote URL is constructed from untrusted input. Model URLs are constants
  in `src-tauri/src/downloader/registry.rs`.
