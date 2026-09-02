# 00 — Current Architecture

SovImage is a local-only Tauri desktop app. The production frontend is a
static Next export; Rust owns hardware detection, model download/integrity,
generation lifecycle, and the bundled `stable-diffusion.cpp` child process.

```text
React UI
  ├─ Tauri events and narrow commands
  ├─ tauri-plugin-sql → local SQLite
  └─ dialog-scoped/app-data filesystem access
            │
Rust runtime│
  ├─ conservative Apple unified-memory / unambiguous NVIDIA UUID probe
  ├─ immutable-revision downloader + length/SHA-256 verification
  ├─ one-generation queue, pre-spawn reservation, cancellation, terminal events
  └─ bundled sd helper → Metal or CUDA → app-data PNG
```

The 0.2.0 model contract is one Apache-2.0 family for generation and reference
editing: FLUX.2 Klein 4B, FLUX.2 small decoder, and Qwen3-4B. Text-only and
reference-image requests share the same pack; editing adds `--ref-image`.

Security boundaries:

- The webview cannot execute the sidecar. Rust resolves and launches it.
- CSP permits packaged assets, local asset-protocol reads, and Tauri IPC only.
- File access is app-data plus paths selected through the OS dialog.
- Prompts use private temporary files, not process arguments.
- Model URLs, exact lengths, and hashes are compiled into Rust.

Distribution has two separate macOS contracts: Developer ID/notarized DMG for
direct download, and sandboxed Apple Distribution `.app` plus Installer-signed
`.pkg` for the Mac App Store. The App Store helper inherits the parent sandbox.
Windows uses NSIS, Authenticode, and a bundled CUDA/cuBLAS runtime closure.

See `CURRENT.md` for authoritative status and `BUILDING.md` for runnable gates.
