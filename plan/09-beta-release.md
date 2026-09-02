# 09 — Release History and 0.2 Gate

The 0.1.0 beta scaffold shipped an unsigned proof of concept. Its model,
security, and distribution assumptions are obsolete and must not be reused as
release evidence.

Version 0.2.0 requires:

- FLUX.2 Klein/Qwen3 immutable licensed model packs and verified downloads.
- Pinned engine `6b3edaaf` with exact CLI and real generation/edit smoke tests.
- Terminal job behavior, safe attachments/outputs, persisted reproducibility,
  and truthful settings/reset behavior.
- Strict CSP and least-privilege Tauri capability review.
- Green frontend, real/stub Rust, engine, package, and clean-machine gates.
- Signed/notarized direct artifacts or a validated sandboxed App Store package.
- Current privacy, security, model-license, and third-party disclosures.

Publishing is a separate decision after those checks. A compiled app, uploaded
artifact, App Store validation, TestFlight processing, and App Review approval
are distinct states and must be reported as such.
