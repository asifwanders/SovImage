# Implementation Status

> Plan ≠ code, always. This file maps what's actually implemented vs what's
> still aspirational in `plan/00-08`.

Last updated: 2026-05-24.

## Implemented

| Plan area                       | Status      | Notes |
|---------------------------------|-------------|-------|
| `plan/00` architecture          | matches     | repo layout, layered diagram both live |
| `plan/01` frontend layout       | matches     | all routes, components, stores, design tokens |
| `plan/02` SQLite schema         | matches     | v1 migration; FTS5; triggers all live |
| `plan/03` Rust downloader       | matches     | Range, SHA256, state.json, backoff, cancel — all live |
| `plan/04` sidecar (old draft)   | superseded  | see plan/08 |
| `plan/05` design system         | matches     | tokens replicated from SovLens |
| `plan/06` sd.cpp execution      | matches     | argv builder w/ per-tier flags |
| `plan/07` CI/CD pipeline        | matches     | release.yml + ci.yml; matrix split into build-sdcpp + build-app |
| `plan/08` sidecar protocol      | matches     | run() supervisor, parse_step, tokio::select cancel |

## Diverges from plan

1. **DB IPC surface (plan/02)** — the plan listed `db_chats_list`, etc. as
   Rust commands. In practice the frontend talks to `tauri-plugin-sql`
   directly via `lib/db.ts`. Rust does NOT proxy DB queries. `Message`
   struct still lives in `commands/db.rs` only as a shared serde shape for
   `generate_image`'s return value.

2. **Stub vs real runtime** — the Cargo feature `stub_runtime` is ON by
   default. This was not in the original plan but became necessary to keep
   `cargo tauri dev` + frontend CI passing without GGUF files present.
   Real runtime is `--no-default-features`. Documented in BUILDING.md.

3. **Generation message id ownership** — plan/04 implied Rust would mint
   the message id and return it. In practice the **frontend** mints the
   UUID (when inserting the SQLite placeholder row) and passes it through
   to Rust's `generate_image(message_id, ...)`. Required so the frontend
   can subscribe to `generation://<id>` events BEFORE the sidecar starts
   emitting them. Rust validates the id shape.

4. **DropOverlay** — plan/01 said the overlay would pass dropped files
   directly to the Composer. In practice we introduced a tiny
   `useAttachment` Zustand store as the shared channel, plus a
   `lib/attachments.ts` helper that writes the dropped file to
   `<app_data>/attachments/<uuid>.<ext>` and returns the absolute path.

## Deferred

| Item                                             | Where  | Why |
|--------------------------------------------------|--------|-----|
| Negative prompt UI (tier 3 only)                 | UI     | Flux-dev only; UI work pending |
| Persistent sd.cpp server protocol                | sidecar| upstream not landed; per-prompt argv works |
| FTS5 search UI (input + result list)             | UI     | backend live; UI form not yet wired |
| Output directory picker in Settings              | UI     | wire `tauri-plugin-dialog::open` later |
| `nightly.yml` for upstream sd.cpp drift          | CI     | needs HF token + storage; deferred |
| Code signing (macOS Developer ID, Windows EV)    | CI     | secrets not yet provisioned |
| Telemetry off-by-default crash counter           | both   | listed in settings; no transport implemented |
| Cross-platform .deb / .AppImage for Linux        | CI     | not in current sprint scope |

## Constraints / known limitations

- Tier 1 8 GB Apple Silicon may swap heavily even with all flags on.
  Documented in plan/06; splash should warn (UI not yet wired).
- Windows on non-NVIDIA GPUs: profiler returns `supported = false`;
  splash should render an "Unsupported hardware" panel (UI not yet wired).
- sd.cpp sidecar is spawned per-prompt; model reload cost ~3–6 s on
  Apple Silicon. Persistent-server mode (plan/08 future section) will
  remove this when upstream supports it.

## Pin reminders

When updating:
- `vendor/stable-diffusion.cpp` → bump `.gitmodules` comment + retest
  argv compatibility against any sd.cpp CLI changes.
- Frontend Next.js / React major versions → re-run full audit; the
  static-export + `useSearchParams` Suspense pattern is fragile.
- Tauri 2 minor → check `shell:allow-execute` capability shape; the
  v2 docs are inconsistent re: bare-name vs externalBin-path.
