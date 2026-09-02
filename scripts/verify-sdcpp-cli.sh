#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <sd-binary> [expected-commit]" >&2
  exit 2
fi

binary="$1"
expected_commit="${2:-}"
if [[ ! -f "$binary" ]]; then
  echo "error: sd.cpp binary not found: $binary" >&2
  exit 1
fi

help="$("$binary" -h 2>&1)"
grep -Fq -- "stable-diffusion.cpp version" <<<"$help"

for option in \
  --diffusion-model --vae --llm --sampling-method --cfg-scale --guidance \
  --steps --width --height --seed --prompt-file --output --ref-image \
  --backend --max-vram --vae-tiling --diffusion-fa --disable-image-metadata; do
  if ! grep -Fq -- "$option" <<<"$help"; then
    echo "error: pinned sd.cpp CLI does not expose required option $option" >&2
    exit 1
  fi
done

for signature in \
  '-o, --output' '-v, --verbose' '-H, --height' '-W, --width' \
  '-s, --seed' '-r, --ref-image'; do
  if ! grep -Fq -- "$signature" <<<"$help"; then
    echo "error: pinned sd.cpp CLI does not expose required runtime alias $signature" >&2
    exit 1
  fi
done

if [[ -n "$expected_commit" ]]; then
  short_commit="${expected_commit:0:7}"
  if ! grep -Fq -- "$short_commit" <<<"$help"; then
    echo "error: binary provenance does not contain expected commit $short_commit" >&2
    exit 1
  fi
fi

set +e
devices="$("$binary" --list-devices 2>&1)"
devices_status=$?
set -e
if [[ $devices_status -ne 0 ]] || ! grep -Eq $'^[^[:space:]]+\t.+' <<<"$devices"; then
  echo "error: sd.cpp --list-devices probe failed" >&2
  printf '%s\n' "$devices" >&2
  exit 1
fi
if grep -Eiq 'unknown (argument|option)|unrecogni[sz]ed (argument|option)|unexpected argument|invalid (argument|option|parameter)' <<<"$devices"; then
  echo "error: sd.cpp rejected --list-devices" >&2
  printf '%s\n' "$devices" >&2
  exit 1
fi

probe_dir="$(mktemp -d)"
trap 'rm -rf "$probe_dir"' EXIT
prompt_file="$probe_dir/prompt.txt"
output_file="$probe_dir/output.png"
printf 'release contract probe' > "$prompt_file"
set +e
probe_output="$("$binary" \
  --diffusion-model "$probe_dir/missing-diffusion.gguf" \
  --vae "$probe_dir/missing-vae.safetensors" \
  --llm "$probe_dir/missing-llm.gguf" \
  --sampling-method euler --cfg-scale 1 --guidance 3.5 --steps 4 \
  -W 64 -H 64 -s 1 --prompt-file "$prompt_file" -o "$output_file" \
  -r "$probe_dir/missing-reference.png" --backend cpu --max-vram -2 \
  --diffusion-fa --disable-image-metadata --vae-tiling -v \
  2>&1)"
probe_status=$?
set -e
if [[ $probe_status -eq 0 ]]; then
  echo "error: sd.cpp parser probe unexpectedly succeeded without model files" >&2
  exit 1
fi
if grep -Eiq 'unknown (argument|option)|unrecogni[sz]ed (argument|option)|unexpected argument|invalid (argument|option|parameter)|invalid weight format' <<<"$probe_output"; then
  echo "error: sd.cpp rejected SovImage's shared argv contract" >&2
  printf '%s\n' "$probe_output" >&2
  exit 1
fi

echo "sd.cpp CLI contract verified: $binary"
