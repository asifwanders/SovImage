# Dependency Notices

This notice was reviewed from the repository's locked manifests and locally
available package license files on 2 September 2026. Versions below are the
direct runtime versions fixed by `frontend/package-lock.json` and
`frontend/src-tauri/Cargo.lock`; build-only and test-only packages are not
represented as shipped application components.

## Frontend runtime

| Component | Version | License | Copyright notice from local package |
|---|---:|---|---|
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT | Tauri Apps Contributors |
| `@tauri-apps/plugin-dialog` | 2.7.3 | MIT OR Apache-2.0 | 2019–2022 The Tauri Programme |
| `@tauri-apps/plugin-fs` | 2.5.2 | MIT OR Apache-2.0 | 2019–2022 The Tauri Programme |
| `@tauri-apps/plugin-os` | 2.3.2 | MIT OR Apache-2.0 | 2019–2022 The Tauri Programme |
| `@tauri-apps/plugin-shell` | 2.3.6 | MIT OR Apache-2.0 | 2019–2022 The Tauri Programme |
| `@tauri-apps/plugin-sql` | 2.4.1 | MIT OR Apache-2.0 | 2019–2022 The Tauri Programme |
| `framer-motion` | 12.43.0 | MIT | 2018 Framer B.V. |
| `lucide-react` | 1.39.0 | ISC | 2026 Lucide Icons and Contributors |
| `next` | 16.3.4 | MIT | 2025 Vercel, Inc. |
| `react`, `react-dom` | 19.2.8 | MIT | Meta Platforms, Inc. and affiliates |
| `zustand` | 5.0.15 | MIT | 2019 Paul Henschel |

## Native direct runtime

| Component | Version | License recorded by the exact local crate |
|---|---:|---|
| `futures-util` | 0.3.32 | MIT OR Apache-2.0 |
| `libc` | 0.2.186 | MIT OR Apache-2.0 |
| `os_pipe` | 1.2.3 | MIT |
| `png` | 0.18.1 | MIT OR Apache-2.0 |
| `reqwest` | 0.12.28 | MIT OR Apache-2.0 |
| `serde`, `serde_json` | 1.0.228, 1.0.150 | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 |
| `shared_child` | 1.1.1 | MIT |
| `tauri` | 2.11.2 | Apache-2.0 OR MIT |
| `tauri-plugin-dialog` | 2.7.1 | Apache-2.0 OR MIT |
| `tauri-plugin-fs` | 2.5.1 | Apache-2.0 OR MIT |
| `tauri-plugin-os` | 2.3.2 | Apache-2.0 OR MIT |
| `tauri-plugin-shell` | 2.3.5 | Apache-2.0 OR MIT |
| `tauri-plugin-sql` | 2.4.0 | Apache-2.0 OR MIT |
| `thiserror` | 1.0.69 | MIT OR Apache-2.0 |
| `tokio`, `tokio-util` | 1.52.3, 0.7.18 | MIT |
| `tracing`, `tracing-subscriber` | 0.1.44, 0.3.23 | MIT |
| `uuid` | 1.23.1 | Apache-2.0 OR MIT |

The Windows build additionally links `nvml-wrapper` 0.10.0 and `windows-sys`
0.60.2 and redistributes the CUDA/cuBLAS DLL closure named in
`sdcpp-runtime-manifest.json`. Their exact source archives and the installed
CUDA redistribution notice were not available in this offline review. Public
Windows distribution remains blocked until those exact notices and NVIDIA's
redistribution requirements are reviewed and added; this file does not claim
that gate is complete. The publication workflow requires the protected
environment's `SOVIMAGE_WINDOWS_REDISTRIBUTION_REVIEW_COMMIT` attestation.

The full transitive Rust and JavaScript graphs remain fixed by the two
lockfiles. Before either store or direct publication, the final artifact's
transitive inventory must be regenerated from those exact locks and checked
for package-specific NOTICE, attribution, source-offer, or copyleft duties.
Publication requires `SOVIMAGE_LEGAL_REVIEW_COMMIT` to attest that review for
the exact candidate.

## Common license grants

Apache-2.0 components use the complete text bundled as `APACHE-2.0.txt`.
SovImage's own MIT grant is bundled as `LICENSE`. The following grant applies
to the MIT components and copyright holders identified above and in their
package metadata:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the “Software”), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright
> notice and this permission notice shall be included in all copies or
> substantial portions of the Software. THE SOFTWARE IS PROVIDED “AS IS”,
> WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
> TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
> LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Lucide's ISC grant is:

> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the copyright
> notice and this permission notice appear in all copies. THE SOFTWARE IS
> PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
> IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
> CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
> DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
> TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
> OF THIS SOFTWARE.
