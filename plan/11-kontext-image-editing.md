# 11 — Kontext Plan Retired

Status: retired before release.

No FLUX.1-Kontext file, URL, hash sentinel, model role, or runtime branch belongs
in 0.2.0. Reference-image editing uses the same Apache-2.0 FLUX.2 Klein pack as
text generation. Authoritative model files, immutable revisions, lengths, and
hashes live only in `downloader/registry.rs`; authoritative CLI behavior lives
in `sidecar/mod.rs` and `plan/06-sdcpp-execution.md`.
