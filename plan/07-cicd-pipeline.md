# 07 — CI and Distribution Pipeline

## Pull-request CI

`ci.yml` uses the exact Node/npm pair declared by `.node-version` and
`frontend/package.json`, and the configured GitHub actions:

- JSON/plist/icon/script/release invariant validation.
- ESLint, frontend tests, TypeScript, and static export.
- Exact pinned Metal engine build/help/provenance contract.
- macOS real/stub Rust tests plus Windows cfg compilation and runtime-contract tests.
- Rust format, clippy, real-runtime tests, stub-runtime tests, and release check.

Apple Silicon jobs use explicit `macos-15`, while application and helper
deployment targets remain macOS 12.0. `macos-latest` is intentionally avoided.

Engine cache identity includes the actual submodule SHA plus build/contract
scripts. A source filename or `.gitmodules` hash is not sufficient provenance.
Every external action is pinned to a full reviewed commit SHA, and the local
release validator rejects mutable action references. Dependabot proposes pin
updates; the protected exact-commit attestation still requires human review
before public distribution.

## Upstream drift

`nightly.yml` checks upstream `master` without changing the pinned gitlink. It
builds Metal and CUDA, checks SovImage's CLI contract, and creates or updates
an aggregate issue for failed targets. The untrusted upstream build has no
write permission and checkout does not persist a token; a separate reporter
job gets `issues: write` and filters GitHub job names to the two known targets.
It closes the aggregate drift issue when both targets recover. GitHub may
disable scheduled workflows after repository inactivity; a
maintainer must re-enable it in Actions when that happens.

## Direct desktop release

`release.yml` has a real dry-run boundary:

- Dry run: ad-hoc macOS and unsigned Windows workflow artifacts only; no GitHub Release.
- Public: an existing version tag at the same commit, Developer ID + Apple
  notarization, Windows Authenticode, protected `desktop-release` environment,
  signature/staple/runtime-install checks, SHA-256 files, then a new draft
  GitHub Release.
- Existing releases are never overwritten by automation.

## Mac App Store

`app-store.yml` is manual and uses a protected environment. It verifies a
matching provisioning profile, builds a sandboxed arm64 app, re-signs the
helper with exactly sandbox+inherit, signs and retains a `.pkg`, and runs Apple
server-side validation. The separate upload job runs only for the boolean input
and rechecks that exact package's SHA-256; it still does not submit an App Review
request.

Credential names and human/App Store gates live in `APP_STORE.md`. No workflow
contains a credential value or placeholder certificate.
