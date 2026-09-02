# SovImage

![CI](https://github.com/asifwanders/SovImage/actions/workflows/ci.yml/badge.svg) ![License: MIT](https://img.shields.io/badge/code-MIT-yellow.svg) ![Release](https://img.shields.io/github/v/release/asifwanders/SovImage?include_prereleases)

SovImage is a local desktop app for AI image generation and reference-image
editing. Prompts, source images, and generated images stay on the device. The
app has no account, telemetry service, or cloud inference backend.

## Current status

Version 0.2.0 is a release-candidate overhaul, not a claim that an App Store
build is already published. The code now has distinct lanes for direct desktop
distribution and the Mac App Store; both remain gated on product-name and
bundle-ID clearance, final privacy/license review, real signing accounts,
certificates, validation, and device testing.

Supported release targets:

- Apple Silicon Mac with macOS 12 or later and at least 12 GiB unified memory.
- Windows 10/11 x64 with a supported NVIDIA GPU and at least 12 GiB VRAM.

Multi-GPU Windows systems must expose exactly one device with its full
`CUDA_VISIBLE_DEVICES=GPU-...` UUID. Ambiguous numeric or multi-device mappings
fail closed so SovImage never tiers one GPU and runs on another.

Intel Macs, Linux, Windows CPU-only systems, and AMD/Intel Windows GPUs are not
currently release targets.

## Stack

- Tauri 2 and Rust for the native shell, downloads, hardware checks, and process supervision.
- Next.js 16, React 19, and Tailwind CSS 4 as a static frontend—there is no production Node server.
- SQLite via `tauri-plugin-sql` for local chats and settings.
- `stable-diffusion.cpp` pinned at `6b3edaaf32cc19e5bb2d819c788bd557eddc8eba` (`master-841-6b3edaa`).
- FLUX.2 Klein 4B with Qwen3-4B and the FLUX.2 small decoder. The selected model repositories use Apache-2.0 terms; model terms are separate from SovImage's MIT code license.

## Model packs

The hardware probe selects a conservative pack. File sizes do not equal peak
runtime memory.

| Tier | Detected memory | Pack | Download | Default output |
|---|---:|---|---:|---:|
| 1 | 12–23 GiB | FLUX.2 Klein Q4 + Qwen3 Q4 | 4.85 GiB | 768×768 |
| 2 | 24–31 GiB | FLUX.2 Klein Q4 + Qwen3 Q4 | 4.85 GiB | 1024×1024 |
| 3 | 32+ GiB | FLUX.2 Klein Q8 + Qwen3 Q8 | 8.22 GiB | 1024×1024 |

Every model URL is pinned to an immutable Hugging Face revision. SovImage
requires the expected byte length and SHA-256 before activating a file.

## Development

```bash
git clone --recurse-submodules https://github.com/asifwanders/SovImage.git
cd SovImage/frontend
npm ci
npm run dev
```

Browser development uses the mock runtime. A real Tauri run also needs the
target-specific engine:

```bash
# From the repository root, on Apple Silicon:
scripts/build-sdcpp-mac.sh

cd frontend
npm run tauri:dev
```

Windows developers use `pwsh scripts/build-sdcpp-win.ps1`. See
[BUILDING.md](BUILDING.md) for exact toolchains, tests, signed release lanes,
and troubleshooting.

## Privacy and licenses

- [Privacy policy](PRIVACY.md)
- [Third-party and model notices](THIRD_PARTY_NOTICES.md)
- [Locked direct dependency notices](DEPENDENCY_NOTICES.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

SovImage's source code is MIT-licensed. That does not relicense models or
third-party dependencies.
