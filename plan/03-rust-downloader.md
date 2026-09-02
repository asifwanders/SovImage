# 03 — Model Download and Integrity Contract

The current downloader is resumable but fail-closed. Its source of truth is
`frontend/src-tauri/src/downloader/registry.rs`.

Each `ModelSpec` contains an ID, local filename, HTTPS URL with an immutable
Hugging Face revision, lowercase SHA-256, exact byte length, and semantic role.
There are no `main` URLs and no missing-hash sentinel.

| Tier | Files | Total bytes |
|---|---|---:|
| 1 | Klein Q4, small decoder, Qwen3 Q4 | 5,207,178,964 |
| 2 | Klein Q4, small decoder, Qwen3 Q4 | 5,207,178,964 |
| 3 | Klein Q8, small decoder, Qwen3 Q8 | 8,830,554,324 |

The hardware policy rejects unsupported accelerators and any Apple unified
memory/NVIDIA VRAM below 12 GiB. Tier thresholds are 24 and 32 GiB. Pack size is
not used as a claim about peak runtime memory.

Download invariants:

1. Consent shows bytes still required before network transfer.
2. A partial file and state record support HTTP range resume.
3. Timeout, retryable HTTP status, range mismatch, and ETag drift are handled
   without promoting incomplete data.
4. The final byte length and SHA-256 must match the compiled spec.
5. Complete files are hashed on every app start; success is cached only in
   memory for that process. Legacy markers and stranded metadata temps are
   removed under the model-directory lock.
6. Rename to the final filename occurs only after verification.
7. Cancellation and restart preserve a valid resumable partial file.

Tests must cover complete-file reuse, stale metadata cleanup, 200 restart, valid 206,
416 reset, timeout/retry, cancellation, length mismatch, and hash mismatch.
