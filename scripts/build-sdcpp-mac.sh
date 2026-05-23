#!/usr/bin/env bash
# Build stable-diffusion.cpp for Apple Silicon (Metal).
# Outputs a binary at frontend/src-tauri/binaries/sd-aarch64-apple-darwin
# suitable for use as a Tauri sidecar (externalBin convention).
#
# Usage (local or CI):
#   scripts/build-sdcpp-mac.sh
#
# Requires: cmake, clang/clang++ (Xcode CLI tools), git submodule checked out.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/vendor/stable-diffusion.cpp"
BUILD="$REPO_ROOT/vendor/sdcpp-build-mac"
OUT_DIR="$REPO_ROOT/frontend/src-tauri/binaries"
OUT_BIN="$OUT_DIR/sd-aarch64-apple-darwin"

if [[ ! -d "$SRC" ]]; then
  echo "error: $SRC missing. Run: git submodule update --init --recursive" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -rf "$BUILD"

cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DSD_METAL=ON \
  -DSD_BUILD_EXAMPLES=ON \
  -DSD_BUILD_SHARED_LIBS=OFF \
  -DSD_WEBP=OFF \
  -DSD_WEBM=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0

# Build only the CLI target; skip examples/tests/utility binaries to keep CI
# wall-time tight and the cache footprint small.
cmake --build "$BUILD" --config Release --target sd-cli -j "$(sysctl -n hw.ncpu)" \
  || cmake --build "$BUILD" --config Release -j "$(sysctl -n hw.ncpu)"

# Newer sd.cpp ships `sd-cli`; older builds ship `sd`. Accept either.
CANDIDATE=""
for name in sd-cli sd; do
  if [[ -x "$BUILD/bin/$name" ]]; then CANDIDATE="$BUILD/bin/$name"; break; fi
done
if [[ -z "$CANDIDATE" ]]; then
  echo "error: built sd binary not found under $BUILD/bin" >&2
  ls -la "$BUILD/bin" >&2 || true
  exit 1
fi

cp "$CANDIDATE" "$OUT_BIN"
chmod +x "$OUT_BIN"
strip "$OUT_BIN" || true

# Ad-hoc codesign so macOS Gatekeeper loads the inner binary even though the
# outer .app is unsigned in this sprint. No Developer ID required.
codesign --force --sign - "$OUT_BIN"

echo "built: $OUT_BIN"
file "$OUT_BIN"
"$OUT_BIN" --help | head -3 || true
