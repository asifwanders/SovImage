# 06 — Pinned Engine Execution

Release engine: `stable-diffusion.cpp` `master-841-6b3edaa`
(`6b3edaaf32cc19e5bb2d819c788bd557eddc8eba`). It is a Git submodule, never a
floating release dependency.

The engine binaries follow Tauri's external-binary convention:

```text
frontend/src-tauri/binaries/sd-aarch64-apple-darwin
frontend/src-tauri/binaries/sd-x86_64-pc-windows-msvc.exe
```

The Rust argv builder uses this contract:

```text
--diffusion-model <Klein GGUF>
--vae <FLUX.2 full-encoder/small-decoder>
--llm <Qwen3 GGUF>
--sampling-method euler --cfg-scale 1 --guidance 3.5 --steps 4
-W <width> -H <height> -s <seed>
--prompt-file <private temporary file> -o <app-data PNG>
--backend <metal|cudaN> --max-vram -2
--diffusion-fa --disable-image-metadata -v
```

Tier 1/2 add `--vae-tiling`; an edit adds `-r <validated app-data image>`.
There is no inference `--type`, raw prompt argument, negative prompt, CLIP/T5
stack, or separate editing model.

`scripts/verify-sdcpp-cli.sh` checks the built binary's embedded engine commit
and every option above. Rust unit tests check exact argv ownership. Both are
required because a successful upstream CMake build does not prove CLI
compatibility.

macOS targets arm64 and 12.0, uses Metal, and disables GGML BLAS to avoid an
unguarded macOS 13.3 Accelerate dependency. Windows builds static application
code/MSVC runtime, discovers the remaining CUDA/cuBLAS DLL closure with
`dumpbin`, hashes it, and installs it beside the sidecar.
