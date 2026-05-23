# Building SovImage

This doc covers everything you need to build SovImage from source on macOS
arm64 or Windows x64 (NVIDIA).

## Prerequisites

| Tool        | Version    | Notes                                       |
|-------------|------------|---------------------------------------------|
| Node.js     | 20.x       | LTS                                         |
| npm         | 10.x       | ships with Node                             |
| Rust        | stable     | install via `rustup`                        |
| CMake       | 3.21+      | for `stable-diffusion.cpp`                  |
| Xcode CLI   | latest     | macOS only                                  |
| MSVC 2022   | latest     | Windows only                                |
| CUDA Toolkit| 12.x       | Windows + NVIDIA, for sd.cpp CUDA build     |
| Git         | 2.40+      | submodule support                           |

## One-time setup

```bash
git clone https://github.com/asifwanders/SovImage.git
cd SovImage

# Pull stable-diffusion.cpp submodule
git submodule update --init --recursive

# Frontend deps
cd frontend
npm install
cd ..
```

## Run the frontend in browser-dev mode

No Tauri, no sd.cpp, no models — just the React app against an in-memory
mock layer. Useful for UI iteration.

```bash
cd frontend
npm run dev
# open http://localhost:3000
```

A mocked splash screen drives a fake download then unlocks the chat UI.
"Generate" returns a placeholder SVG bubble.

## Run the full Tauri app (stub runtime)

Tauri shell + real React + Rust commands, but the Rust runtime is the **stub**
(no real download, no sd.cpp spawn). Lets you exercise SQLite, IPC, the
shell, and bundling without GGUF files.

```bash
cd frontend
npm run tauri:dev
```

## Run the full Tauri app (real runtime)

Real hardware probe → real downloader → real sd.cpp sidecar spawn. Requires
the sd.cpp binary to exist at the target-suffixed path.

```bash
# Build sd.cpp once
scripts/build-sdcpp-mac.sh           # macOS arm64
pwsh scripts/build-sdcpp-win.ps1     # Windows x64

# Run with the stub feature disabled
cd frontend
npm run tauri:dev -- -- --no-default-features
```

First launch will:
1. Detect hardware tier (1/2/3).
2. Download Flux GGUF + VAE + CLIP-L + T5 (4–22 GB depending on tier).
3. Verify SHA256 (skipped silently for any file whose registry entry still
   has `"TODO"` — see `frontend/src-tauri/src/downloader/registry.rs`).
4. Mark setup ready and load the chat UI.

Models land at `<app_data>/models/`. On macOS that's
`~/Library/Application Support/com.sovimage.app/models/`.

## Build release installers

CI does this for you on tag push (see `.github/workflows/release.yml`).
Locally:

```bash
scripts/build-sdcpp-mac.sh           # or -win.ps1
cd frontend
npm ci
npm run tauri:build -- --no-default-features
```

Output lands in `frontend/src-tauri/target/release/bundle/`.

## Toolchain notes

- The frontend ships as a Next.js **static export** (`output: "export"`).
  No server runtime exists in production. Tauri serves the `out/` directory
  from inside the bundle.
- The `stub_runtime` Cargo feature is **on by default** so `cargo check` /
  `cargo tauri dev` work without sd.cpp. Disable it for the real path with
  `--no-default-features`.
- The DB schema is owned by `frontend/src-tauri/migrations/0001_init.sql`.
  Bump via a new numbered migration; never edit a shipped one.
- The sd.cpp submodule is pinned to a vetted commit. Bump via
  `scripts/update-sdcpp.sh` after testing locally.

## Troubleshooting

**"resource path `binaries/sd-*` doesn't exist"** — run the appropriate
sd.cpp build script first. The dev stub placeholders in `binaries/` are
gitignored but a clean checkout has none; `npm run tauri:dev` will fail
until at least an empty placeholder exists. Quick fix:
```bash
mkdir -p frontend/src-tauri/binaries
touch frontend/src-tauri/binaries/sd-$(rustc -vV | grep host | awk '{print $2}')
chmod +x frontend/src-tauri/binaries/sd-*
```

**`SD_METAL=ON` build fails on macOS** — install Xcode CLI tools:
`xcode-select --install`. Verify with `clang --version`.

**`SD_CUDA=ON` build fails on Windows** — verify `nvcc --version` works and
`CUDA_PATH` is set. The CI workflow uses `Jimver/cuda-toolkit@v0.2.18` to
provision CUDA 12.5; mirror that locally if needed.

**"sd sidecar exited with code 127"** — the placeholder script in
`binaries/` is being run instead of a real sd.cpp build. Rebuild via the
script.

## Where things live

```
.github/workflows/      CI/CD (release.yml, ci.yml)
plan/                   Design docs (architecture, downloader, sidecar, CI)
scripts/                Build sd.cpp + bump submodule
vendor/                 sd.cpp submodule
frontend/               Next.js + Tauri app
  src/                  React 19 + TS 5 + Tailwind 4
  src-tauri/            Rust 2021 + tokio + reqwest
    binaries/           Built sd.cpp binaries land here (gitignored)
    migrations/         SQLite schema
    src/                Rust modules
```
