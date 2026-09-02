# 10 — Editing Model Decision (Superseded Research)

The earlier recommendation to add FLUX.1-Kontext-dev was rejected for 0.2.0.
Its non-commercial license was incompatible with an unrestricted public/App
Store distribution plan, it duplicated multi-gigabyte weights, and the earlier
8 GiB feasibility claim lacked measured peak-memory evidence.

The implemented decision is FLUX.2 Klein 4B under Apache-2.0. The same
diffusion/VAE/Qwen3 pack handles generation and instruction-based reference
editing through the pinned engine's `--ref-image` option. This removes the
second model family and keeps one integrity/license/runtime contract.

Future inpainting, ControlNet, LoRA marketplaces, or another backend require a
new measured product decision; they are not implied by this archived research.
