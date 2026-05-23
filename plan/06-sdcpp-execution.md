# 06 — sd.cpp Execution Parameters & Tiered Flags

`stable-diffusion.cpp` (sd.cpp) is the inference engine. Tauri spawns the
sidecar binary with carefully chosen CLI flags per hardware tier. No
Python ever ships to the user.

## Binary layout (post-CI)

```
src-tauri/binaries/
  sd-aarch64-apple-darwin           ← Metal build (mac arm64)
  sd-x86_64-pc-windows-msvc.exe     ← CUDA build (win NVIDIA)
```

Tauri's `externalBin` resolves the suffix automatically at bundle time. The
sidecar invocation in Rust uses just `"sd"` — see plan/04 / plan/08.

## Companion files (downloaded by resilient downloader, plan/03)

| File                      | Size  | Purpose                          | Source repo (default)            |
|---------------------------|-------|----------------------------------|----------------------------------|
| `flux1-schnell-q4_0.gguf` | ~6.5 GB | Diffusion model — tier 1       | city96/FLUX.1-schnell-gguf       |
| `flux1-schnell-q8_0.gguf` | ~12 GB  | Diffusion model — tier 2       | city96/FLUX.1-schnell-gguf       |
| `flux1-dev-q8_0.gguf`     | ~12 GB  | Diffusion model — tier 3       | city96/FLUX.1-dev-gguf           |
| `ae.sft`                  | 320 MB  | VAE                            | black-forest-labs/FLUX.1-schnell |
| `clip_l.safetensors`      | 235 MB  | CLIP-L text encoder            | comfyanonymous/flux_text_encoders|
| `t5xxl_fp16.safetensors`  | 9.3 GB  | T5-XXL text encoder (tier 2/3) | comfyanonymous/flux_text_encoders|
| `t5xxl_q4_k.gguf`         | ~2.9 GB | Quantized T5-XXL (tier 1)      | city96/t5_v1_1-xxl-encoder-gguf  |

> Final URLs + SHA256 live in `src-tauri/src/downloader/registry.rs`. Schema
> here, values resolved at PR time.

## Tier matrix — exact invocation

All paths below are relative to `<app_data>/models/`. The Rust supervisor
substitutes absolute paths at spawn time.

### Tier 1 — 8 GB Apple Silicon (M1 Air class)

Goal: prevent swap-thrash death. Trade speed for survival.

```
sd \
  --diffusion-model flux1-schnell-q4_0.gguf \
  --vae ae.sft \
  --clip_l clip_l.safetensors \
  --t5xxl t5xxl_q4_k.gguf \
  --type q4_0 \
  --vae-tiling \
  --vae-on-cpu \
  --clip-on-cpu \
  --diffusion-fa \
  --threads -1 \
  --cfg-scale 1.0 \
  --sampling-method euler \
  --steps 4 \
  -W 512 -H 512 \
  -s -1 \
  -p "<PROMPT>" \
  -o <OUT_PNG> \
  -v
```

Why each flag:
- `--type q4_0` — forces inference dtype to match the GGUF; avoids accidental
  upcast that re-balloons VRAM.
- `--vae-tiling` — VAE decode in tiles; cuts peak ~2 GB at 512×512.
- `--vae-on-cpu` + `--clip-on-cpu` — keep the two largest static tensors off
  Metal, leaving unified memory for the diffusion model.
- `--diffusion-fa` — flash-attention in the DiT; ~600 MB savings at 768×768,
  slightly less at 512×512 but still positive.
- `t5xxl_q4_k.gguf` — replaces the 9 GB fp16 T5 with a 2.9 GB quant. Single
  biggest win for 8 GB machines.
- 512×512 default — VAE peak scales quadratically with resolution.
- `--steps 4` — schnell is distilled; 4 steps == intended quality.
- `--cfg-scale 1.0` — schnell ignores CFG; 1.0 is fastest.

Realistic peak unified memory at 512×512: ~7–8 GB. macOS may still swap; UI
should warn user on first launch ("M1 8 GB detected — expect 60–90 s/image
and possible swap. Close other apps for best results.").

### Tier 2 — 12–16 GB Apple Silicon / 8 GB NVIDIA

```
sd \
  --diffusion-model flux1-schnell-q8_0.gguf \
  --vae ae.sft \
  --clip_l clip_l.safetensors \
  --t5xxl t5xxl_fp16.safetensors \
  --type q8_0 \
  --vae-tiling \
  --clip-on-cpu \
  --diffusion-fa \
  --threads -1 \
  --cfg-scale 1.0 \
  --sampling-method euler \
  --steps 4 \
  -W 1024 -H 1024 \
  -s -1 \
  -p "<PROMPT>" \
  -o <OUT_PNG> \
  -v
```

Notes:
- VAE stays on GPU; only CLIP offloaded.
- 1024×1024 default — tier 2 has headroom.
- fp16 T5 fits in 12 GB unified or 8 GB VRAM with diffusion model paged.

### Tier 3 — > 16 GB unified / 12 GB+ NVIDIA

```
sd \
  --diffusion-model flux1-dev-q8_0.gguf \
  --vae ae.sft \
  --clip_l clip_l.safetensors \
  --t5xxl t5xxl_fp16.safetensors \
  --type q8_0 \
  --diffusion-fa \
  --threads -1 \
  --cfg-scale 3.5 \
  --sampling-method euler \
  --steps 28 \
  -W 1024 -H 1024 \
  -s -1 \
  -p "<PROMPT>" \
  -o <OUT_PNG> \
  -v
```

Notes:
- No CPU offload — keep everything on Metal/CUDA for speed.
- `--steps 28`, `--cfg-scale 3.5` — Flux-dev defaults from upstream docs.

## Image-to-image (init image)

Append:
```
--init-img <INIT_PNG> --strength 0.75
```
`--strength` defaults to 0.75; UI exposes a slider 0.1–1.0.

## Output

`-o <path>` writes a single PNG. We pass a unique
`<app_data>/images/<msg_uuid>.png` per invocation. sd.cpp prints progress to
stderr; we parse `[step N/M]` lines (see plan/08) and re-emit as Tauri events.

## Negative prompt

Flux ignores classifier-free guidance in tier 1/2 (cfg-scale 1.0), so the
negative prompt is meaningless there. Tier 3 (Flux-dev, cfg 3.5) supports it:
```
-n "<NEG_PROMPT>"
```
UI hides the negative-prompt field in tier 1/2 to avoid user confusion.

## Threads

`--threads -1` = auto (sd.cpp uses all physical cores). Override surfaced in
Settings as "CPU threads (advanced)".

## Seed

`-s -1` = random. UI shows the realized seed in the bubble metadata so users
can reproduce.

## CLI compatibility note

Newer sd.cpp builds rename the binary to `sd-cli`. The CI build script
symlinks `sd-cli` → `sd` so our Rust supervisor can always exec `sd`. See
`scripts/build-sdcpp-mac.sh`.

## Future: persistent-model mode

Upstream is adding a JSON-over-stdio server mode that keeps the model loaded
between requests. When stable, swap the per-prompt argv invocation for a
single long-lived child — see plan/08.
