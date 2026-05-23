# 07 — CI/CD Pipeline Architecture (GitHub Actions)

Source of truth: `.github/workflows/release.yml`. Triggers on `v*.*.*` tag
push; opens a draft GitHub Release with cross-platform installers attached.

## Targets

| Runner             | Rust target                 | sd.cpp accel | Artifact                |
|--------------------|-----------------------------|--------------|-------------------------|
| `macos-14` (arm64) | `aarch64-apple-darwin`      | Metal        | `.dmg` + `.app.tar.gz`  |
| `windows-2022`     | `x86_64-pc-windows-msvc`    | CUDA 12.x    | `.msi` + `.exe` setup   |

Intel macOS + Linux deliberately deferred per sprint scope.

## Workflow graph

```
push tag v*.*.*
       │
       ▼
┌──────────────────────┐
│ build-sdcpp (matrix) │     ← compile sd.cpp once per target,
│  ├─ macos-14         │       upload binary as artifact
│  └─ windows-2022     │
└─────────┬────────────┘
          │ (artifacts)
          ▼
┌──────────────────────┐
│ build-app   (matrix) │
│  ├─ macos-14         │  ← downloads matching sd.cpp artifact,
│  └─ windows-2022     │    places it in src-tauri/binaries/,
│                      │    runs tauri-action which:
│                      │      - npm ci in frontend/
│                      │      - npm run build  (Next.js export)
│                      │      - cargo build --release
│                      │      - bundles installers
│                      │      - uploads to GitHub Release (draft)
└──────────────────────┘
```

Split into two jobs (not one) so:
1. sd.cpp build cache hits often — its source rarely changes between releases.
2. App build can re-run quickly without recompiling sd.cpp on every retry.

## `build-sdcpp` job

Steps:
1. `actions/checkout@v4` with `submodules: recursive` — sd.cpp is a git
   submodule pinned to a known-good commit at `vendor/stable-diffusion.cpp`.
2. **macos-14:**
   - System deps: `brew install cmake` (already present on hosted runner).
   - `cmake -S vendor/stable-diffusion.cpp -B build -DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release -DSD_BUILD_EXAMPLES=ON`
   - `cmake --build build --config Release -j`
   - Output: `build/bin/sd-cli` (newer) or `build/bin/sd` (older). Symlink
     `sd` → `sd-cli` if needed.
   - Strip + codesign-stub (`codesign --force --sign - ./sd`) to satisfy
     macOS Gatekeeper for the inner binary even though the outer .app is
     unsigned.
   - Upload as artifact `sd-aarch64-apple-darwin`.
3. **windows-2022:**
   - Install CUDA Toolkit 12.x via `Jimver/cuda-toolkit@v0.2.18`.
   - `cmake -S vendor\stable-diffusion.cpp -B build -DSD_CUDA=ON -DCMAKE_BUILD_TYPE=Release -DSD_BUILD_EXAMPLES=ON -A x64`
   - `cmake --build build --config Release -j`
   - Output: `build\bin\Release\sd-cli.exe`. Rename to `sd.exe`.
   - Upload as artifact `sd-x86_64-pc-windows-msvc`.
4. Cache key: `${{ runner.os }}-sdcpp-${{ hashFiles('vendor/stable-diffusion.cpp/**/CMakeLists.txt', '.gitmodules') }}`
   — submodule SHA is part of the tree hash via .gitmodules pin.

## `build-app` job

Per-matrix steps:
1. `actions/checkout@v4` (no submodules needed — sd.cpp comes from artifact).
2. `actions/setup-node@v4` with `cache: npm`, working-directory `frontend/`.
3. `dtolnay/rust-toolchain@stable` with `targets: ${{ matrix.target }}`.
4. `swatinem/rust-cache@v2` with `workspaces: 'frontend/src-tauri -> target'`.
5. `actions/download-artifact@v4` — pull `sd-${{ matrix.target }}`
   into `frontend/src-tauri/binaries/`.
6. Rename downloaded `sd[.exe]` → `sd-${{ matrix.target }}[.exe]` (Tauri's
   externalBin convention).
7. `chmod +x` on the binary (mac only).
8. `cd frontend && npm ci`.
9. `tauri-apps/tauri-action@v0` with:
   ```yaml
   projectPath: frontend
   tagName: ${{ github.ref_name }}
   releaseName: SovImage ${{ github.ref_name }}
   releaseDraft: true
   prerelease: false
   args: --target ${{ matrix.target }}
   ```
   `GITHUB_TOKEN` provided via env.

## Matrix definition

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: macos-14
        target: aarch64-apple-darwin
        sdcpp_artifact: sd-aarch64-apple-darwin
        sd_binary: sd
      - os: windows-2022
        target: x86_64-pc-windows-msvc
        sdcpp_artifact: sd-x86_64-pc-windows-msvc
        sd_binary: sd.exe
```

## Signing decision (this sprint)

- macOS: **unsigned**. First-launch UX = right-click → Open. Documented in
  README install section. When Developer ID is added later, swap to
  `tauri-action` env vars (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`).
- Windows: **unsigned**. SmartScreen warning. Add later via
  `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD`.

The workflow already wires these env vars but reads them as
optional/empty — adding the secrets later turns signing on without a code
change.

## Permissions / secrets

- `GITHUB_TOKEN` — issued automatically. Needs `contents: write` on the job
  to create the draft Release.
- No third-party secrets required this sprint.

## Auxiliary workflows (followup, not this sprint)

- `ci.yml` on push/PR: typecheck + next build + cargo check (no installer).
- `nightly.yml` cron: download Flux models, run a 1-image smoke test on each
  target to catch upstream sd.cpp breakage. Skipped now — needs HF API token
  for model pull and large runner storage.

## Failure handling

- `fail-fast: false` so one target's failure does not cancel the other.
- Each job uploads stdout/stderr logs via `actions/upload-artifact` on
  failure for post-mortem.
- Draft release: never auto-published. Maintainer reviews installers locally
  before clicking "Publish".

## Caches

| Cache              | Key                                                          |
|--------------------|--------------------------------------------------------------|
| sd.cpp build       | `${{ runner.os }}-sdcpp-${{ hashFiles('.gitmodules') }}`     |
| Rust target        | swatinem/rust-cache default                                  |
| npm                | setup-node `cache: npm`                                      |
| CUDA toolkit       | Jimver action provides its own cache                         |

## Local reproducibility

The workflow shells out to `scripts/build-sdcpp-mac.sh` and
`scripts/build-sdcpp-win.ps1`. A developer can run the same scripts on
their own machine to reproduce the CI binary; this also keeps the
`release.yml` thin and auditable.
