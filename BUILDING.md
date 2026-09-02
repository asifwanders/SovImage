# Building SovImage

## Supported toolchains

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 24.14.1 | frontend and Tauri CLI |
| npm | 11.11.0 | lockfile install |
| Rust | 1.98.0 | native app |
| CMake | 3.21+ | inference engine |
| Xcode + CLI tools | current supported release | Apple Silicon build/signing |
| Visual Studio 2022 | current | Windows x64 build |
| CUDA Toolkit | 12.5.0 in CI | Windows NVIDIA engine |
| Git | 2.40+ | pinned recursive submodule |

GitHub ARM jobs use the explicit `macos-15` runner label; do not switch them to
`macos-latest`. This runner choice does not change the app's macOS 12.0
deployment target.

Use `npm ci`; `.node-version`, `packageManager`, and `package-lock.json` are
authoritative. Run `node scripts/verify-node-toolchain.mjs` from the repository
root before a release build.

## Checkout and frontend

```bash
git clone --recurse-submodules https://github.com/asifwanders/SovImage.git
cd SovImage/frontend
npm ci
npm run dev
```

`npm run dev` is browser-only and uses the in-memory mock runtime. Production
is a Next static export embedded in Tauri; no Next server ships.

## Native development

Build the pinned `stable-diffusion.cpp` sidecar first:

```bash
# Apple Silicon, from repository root
scripts/build-sdcpp-mac.sh

# Windows x64 from PowerShell
pwsh scripts/build-sdcpp-win.ps1
```

The macOS build targets arm64/macOS 12, uses Metal, and disables Accelerate
BLAS because the current upstream BLAS path calls APIs introduced in macOS
13.3. The Windows build statically links the MSVC runtime and copies the
non-system CUDA/cuBLAS DLL dependency closure beside the sidecar. Both scripts
verify the engine commit and every CLI option SovImage uses.

Run the real app:

```bash
cd frontend
npm run tauri:dev
```

Run the explicit stub runtime when changing UI without models:

```bash
cd frontend
npm run tauri:dev -- --no-default-features --features stub_runtime
```

On first real launch, the app probes hardware, shows the exact download size,
downloads the selected FLUX.2/Qwen3/VAE pack, verifies length and SHA-256, then
enables generation. Models live under the non-roaming platform app-local-data
directory in `models/`.

## Required checks

```bash
cd frontend
npm run lint
npm test
npx tsc --noEmit
npm run build

cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets --no-default-features --features real_runtime -- -D warnings
cargo test --locked --no-default-features --features real_runtime
cargo test --locked --no-default-features --features stub_runtime
cargo check --locked --release --no-default-features --features real_runtime
```

CI also builds the exact pinned engine and checks its live help output against
the Rust argv contract. The weekly drift workflow repeats that check against
upstream `master`; it does not move the pinned submodule. That untrusted build
job has read-only permissions and checkout credentials are not persisted. A
separate trusted reporter job receives only GitHub's sanitized job conclusions
before using `issues: write`; it closes the aggregate issue after recovery.

## Local unsigned/ad-hoc bundles

```bash
# macOS
scripts/build-sdcpp-mac.sh
cd frontend
APPLE_SIGNING_IDENTITY=- npm run tauri build -- \
  --target aarch64-apple-darwin --features real_runtime --bundles dmg -- \
  --no-default-features --locked
```

The equivalent Windows command uses target `x86_64-pc-windows-msvc`, bundle
`nsis`, and `RUSTFLAGS="-C target-feature=+crt-static"` to avoid an undeclared
Visual C++ runtime prerequisite. These are test artifacts, not public-release
evidence.

On a multi-GPU host, set `CUDA_VISIBLE_DEVICES` to one full NVML `GPU-...` UUID.
Numeric and multi-device lists are intentionally rejected until CUDA-runtime
UUID enumeration is part of the hardware probe.

## Distribution lanes

`.github/workflows/release.yml` builds direct installers. A dry run produces
an ad-hoc macOS DMG and unsigned Windows installer, uploads workflow artifacts,
and never creates a GitHub Release. A public run requires an existing release
tag whose version matches every manifest, the reusable CI workflow for that
exact commit, approval through the protected `desktop-release` GitHub
environment, plus:

- Developer ID Application certificate, App Store Connect notarization key,
  and signing identity for macOS.
- Authenticode PFX certificate for Windows.

Store those credentials on the protected `desktop-release` environment, not as
repository-wide secrets. Restrict that environment to approved release tags and
required reviewers.

The workflow verifies notarization/stapling, Authenticode signatures, engine
runtime closure after a clean NSIS install, checksums, and then creates a draft
GitHub Release. It never overwrites an existing release. Keep an unprotected
`desktop-dry-run` environment so dry runs do not gain release secrets.

`.github/workflows/app-store.yml` is independent and manual. It requires the
protected `app-store` GitHub environment, Apple Distribution and Mac Installer
Distribution certificates, a matching Mac App Store Connect provisioning
profile, and an App Store Connect API key. It builds a sandboxed `.app`, signs
the `sd` helper separately with only sandbox inheritance, produces a signed
`.pkg`, retains it, and asks Apple to validate it. Upload occurs only when the
workflow's dependent upload job is explicitly enabled and the retained package
hash still matches. See [APP_STORE.md](APP_STORE.md).

Before either public lane is authorized:

- Review every workflow action's pinned full commit SHA. Dependabot's GitHub
  Actions updates must remain enabled; mutable tags are rejected by the local
  release validator.
- Resolve or explicitly accept every locked dependency advisory for the exact
  candidate after checking reachability and supported targets.
- Complete the transitive license inventory in `DEPENDENCY_NOTICES.md` and the
  NVIDIA CUDA redistribution review for Windows.
- Run real generation and reference editing on each claimed hardware tier. A
  successful engine source build and CLI contract check do not prove inference.
- Treat direct and Mac App Store channels as separate installs until a
  user-selected import/export migration exists. They do not share app-data
  containers even with the same bundle ID; never direct users to copy sandbox
  internals manually.

The protected `desktop-release` environment must set
`SOVIMAGE_LEGAL_REVIEW_COMMIT`, `SOVIMAGE_ACTION_PINS_REVIEW_COMMIT`,
`SOVIMAGE_DEPENDENCY_AUDIT_COMMIT`,
`SOVIMAGE_WINDOWS_REDISTRIBUTION_REVIEW_COMMIT`, and
`SOVIMAGE_NAME_BUNDLE_ID_CLEARANCE_COMMIT` to the exact candidate SHA.
Signed candidates may be built without these values, but the GitHub Release job
fails closed until all attestations match.

The name/bundle-ID attestation is a real legal and ownership gate. A preliminary
search found an established Canadian media-production company using “Sovimage”
and `sovimage.com`; the current `com.sovimage.app` identifier therefore cannot
be treated as publisher-controlled. Do not rename the app or identifier without
an explicit pre-registration decision and a data/signing migration plan.

Never commit certificate, key, password, or provisioning-profile material.

## Provenance

Every official build runs `scripts/write-build-provenance.mjs`. The bundled
`build-provenance.json` records the source commit/ref, dirty state, Node/npm, build
channel/number, and actual engine submodule commit. Release cache keys use the
submodule SHA rather than `.gitmodules` or a mutable source file.

## Updating the engine

```bash
scripts/update-sdcpp.sh <reviewed-tag-or-commit>
scripts/build-sdcpp-mac.sh
```

Review the submodule diff, run both platform builds, the CLI contract, Rust
tests, and at least one real generation/edit on each supported hardware class.
Never point a release at upstream `master`.
