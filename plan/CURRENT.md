# Current Implementation Status

Last reconciled with the 0.2.0 working tree: 2 September 2026.

## Implemented in code/config

| Area | Current state |
|---|---|
| Model family | FLUX.2 Klein 4B + small decoder + Qwen3; Apache-2.0 repositories |
| Model integrity | immutable revisions, exact lengths, mandatory SHA-256 |
| Engine | sd.cpp `6b3edaaf`; FLUX.2 prompt-file/backend/VRAM contract |
| Hardware | Apple unified memory or one unambiguous NVIDIA GPU; 12 GiB minimum |
| Storage | local SQLite plus APPLOCAL attachments/images/models/prompts and fail-closed legacy migration |
| Security | strict CSP, no `$HOME` scope, no frontend process execution, pre-spawn sidecar reservation |
| CI | locked frontend/Rust builds; exact engine/provenance; release assets |
| Direct release | ad-hoc dry run; Developer ID/notarized and Authenticode public lane |
| Mac App Store | sandbox/profile/helper/pkg/validation workflow; explicit upload |
| Disclosure | privacy policy/manifest, security policy, bundled direct dependency/model notices |

## Still requires external or device evidence

- Apple and Windows signing credentials are not stored in the repository.
- App Store Connect registration, metadata, agreements, screenshots, privacy
  answers, TestFlight processing, device matrix, and App Review remain human/external gates.
- Provider-policy review must settle the App Store privacy label; the complete
  transitive/NVIDIA license inventory and locked-advisory review remain
  publication gates.
- Product-name clearance and publisher ownership of the final reverse-DNS bundle
  identifier remain pre-registration and publication gates.
- Real FLUX.2 generation and reference editing must pass on representative
  12/16/24/32 GiB Macs and 12/16/24 GiB NVIDIA systems before publication.
- Windows CUDA runtime closure must pass on a clean NVIDIA machine, not merely a
  build runner.
- Multi-GPU Windows testing must cover the documented full-UUID single-device
  selection; numeric, abbreviated, multiple, and MIG selectors currently fail closed.
- Exact model peak memory, latency, thermals, and quality need recorded benchmarks.
- A public privacy/support URL must remain reachable at submission time.

Plans describe contracts, but passing current code/tests/artifact inspection is
the evidence. Do not mark a release deployed or App Store-ready from source
configuration alone.
