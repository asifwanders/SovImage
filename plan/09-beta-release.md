# 09 — Path to First Beta Release

Goal: produce **signed-where-possible installers** for `macos-aarch64` and
`windows-x64-nvidia`, published as a GitHub draft Release, that beta testers
can download and run on their own machine. End-to-end zero-terminal for
the tester.

## Definition of "beta-ready"

- [x] Real Rust runtime: profiler + downloader + sidecar
- [x] All 3 review rounds applied; no known correctness bugs
- [ ] sd.cpp build script verified locally (catches CMake/Metal mismatch
      before CI burns minutes)
- [ ] Init-launch GC of orphan PNG files (`<app_data>/images/`)
- [ ] Downloader test coverage: state-mismatch URL, 200-restart truncate,
      416 reset, cancel mid-loop (4 new tests)
- [ ] Unsupported-hardware splash panel (Win non-NVIDIA)
- [ ] Tier 1 swap warning toast (8 GB Apple Silicon)
- [ ] FTS5 search input wired in sidebar
- [ ] Negative prompt field (tier 3 only)
- [ ] Output directory picker in Settings
- [ ] nightly.yml drift workflow
- [ ] dependabot.yml weekly bump
- [ ] PR/issue templates + CODE_OF_CONDUCT
- [ ] README badges (build status, license, version)
- [ ] Repo on GitHub at `github.com/asifwanders/SovImage`
      + submodule + initial commit + push
- [ ] First tag `v0.1.0-beta.1` → CI builds → maintainer publishes draft

## Wave layout (executed in this session)

### Wave 0 — this doc
Write the beta-release plan.

### Wave 1 — Hardening (parallel)
- **Agent A** — Downloader unit tests (4 cases above) against an in-process
  HTTP server (`tokio` + a 50-line stub). Isolated to
  `src-tauri/src/downloader/mod.rs` + `Cargo.toml` dev-deps.
- **Agent B** — OSS polish: `CODE_OF_CONDUCT.md`,
  `.github/ISSUE_TEMPLATE/{bug,feature}.md`,
  `.github/PULL_REQUEST_TEMPLATE.md`, README badges (status, license, ver).
- **Direct** — Init-launch GC sweep:
  on boot, delete `<app_data>/images/*.png` not referenced by any DB
  message row (`SELECT image_path FROM messages WHERE image_path IS NOT NULL`).
  Lives in `src-tauri/src/commands/gc.rs`, invoked from `setup()`.

### Wave 2 — UI gaps (parallel)
- **Agent C** — Unsupported-HW splash panel + tier 1 warning toast.
  Reads `useSetup` `tier` + new field `supported` (already in Rust
  HardwareProfile). Adds toast component.
- **Direct** — FTS5 search input in sidebar: when query length ≥ 2,
  call `db.search(query)` and render hit snippets below chat list w/
  click-to-jump.
- **Direct** — Negative prompt field in Composer: visible only when
  `tier === 3`; passed to `generate()` as new arg.
- **Direct** — Output directory picker: `tauri-plugin-dialog` `open({ directory: true })`,
  store under `settings.output.directory`.

### Wave 3 — CI additions (direct)
- `.github/workflows/nightly.yml` — Mon 04:00 UTC, builds sd.cpp HEAD on
  both targets, runs `--help` smoke test. Opens an issue on regression.
- `.github/dependabot.yml` — weekly: npm in `frontend/`, cargo in
  `src-tauri/`, github-actions root.
- `.github/labeler.yml` + `.github/workflows/labels.yml` — auto-label by
  path. PRs touching `frontend/` get `area:frontend`, etc.

### Wave 4 — Local validation
- **Run in background**: `scripts/build-sdcpp-mac.sh` (10–15 min). Output
  validates the pinned commit + CMake flags + binary name.
- Final `cargo test --lib --no-default-features` + `tsc` + `next build`.

### Wave 5 — Repo init
- `git init` (clean tree, .gitignore already in place)
- `git submodule add` pinned to `645e6e9089c78bd61368f3a667644fee39e463b6`
- Initial commit (zero AI traces per project policy)
- `gh repo create` only if user repo not yet present; else `git remote add`
- `git push -u origin main`

### Wave 6 — Tag + first release
- `git tag v0.1.0-beta.1 -m "first beta"`
- `git push --tags`
- `gh run watch` the release workflow
- Hand draft release URL to user; user clicks Publish → beta testers
  download

## Tester distribution

- macOS testers: download the `.dmg`, drag to /Applications, right-click →
  Open the first time (Gatekeeper warning, unsigned).
- Windows testers: download the `.msi`, double-click. SmartScreen warning
  on first launch (unsigned).
- Both: first launch shows splash → downloads ~7–22 GB of GGUF on the
  user's network → flips to chat UI when done.

## Signing slot (followup, post-beta-1)

- macOS: provision Apple Developer ID, add `APPLE_*` secrets to repo,
  enable in `release.yml`.
- Windows: provision EV code-signing cert, add `WINDOWS_*` secrets,
  enable in `release.yml`.

## Rollback

If beta-1 ships a critical bug:
- Tag `v0.1.0-beta.2` from a fix branch.
- Update the draft release notes to point at the new tag; delete the bad
  binaries from the GitHub Release.

## Out of scope for beta-1

- Linux installers
- Mobile
- Intel macOS
- AMD/Intel Windows GPUs
- Multi-user accounts / sync
- Telemetry transport
