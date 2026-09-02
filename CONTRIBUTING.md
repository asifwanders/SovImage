# Contributing to SovImage

Read [BUILDING.md](BUILDING.md), then start from a recursive checkout and an
`npm ci` install. Do not replace lockfile installs with floating dependency
resolution.

## Pull requests

- One concern per pull request; explain the user-visible failure or need first.
- Branch from `main` and preserve the pinned engine submodule unless the pull
  request is specifically an engine update.
- Add the smallest regression test that proves non-trivial behavior.
- Do not weaken hashes, size checks, CSP, sandbox entitlements, path validation,
  signing gates, or release validation to make a build pass.
- Never commit models, generated sidecars, CUDA DLLs, credentials, profiles,
  API keys, prompts, or user images.

Run the checks in [BUILDING.md](BUILDING.md) before pushing. Changes to engine
arguments must also run `scripts/verify-sdcpp-cli.sh` against the built pinned
binary. Windows engine changes require a fresh runner/process test without the
CUDA Toolkit on `PATH`.

## Style

Rust uses default `rustfmt`, `thiserror` for recoverable boundaries, and no
`unwrap()` outside tests. TypeScript remains strict; React hooks stay at the top
level; Zustand consumers use field selectors. Prefer existing helpers, the
standard library, and native platform behavior over new dependencies.

Commit subjects use imperative mood and stay under 72 characters. Pull request
titles use `<area>: <imperative phrase>`.

## Ownership map

| Concern | Location |
|---|---|
| UI and state | `frontend/src/` |
| Native runtime | `frontend/src-tauri/src/` |
| Model manifest | `frontend/src-tauri/src/downloader/registry.rs` |
| Engine pin | `vendor/stable-diffusion.cpp` |
| Desktop capabilities/config | `frontend/src-tauri/capabilities/`, `tauri*.json` |
| CI and distribution | `.github/workflows/`, `scripts/` |
| Architecture/status | `plan/` |

## Releases

Contributors do not publish from pull requests. Maintainers first run the
desktop workflow in dry-run mode. Public desktop releases require a version tag
and all signing gates. Mac App Store uploads use the separate protected
workflow; an upload is not an App Review submission.

Contributions to SovImage code are accepted under [LICENSE](LICENSE). Models
and dependencies retain their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
