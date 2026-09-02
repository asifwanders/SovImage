#!/usr/bin/env bash

set -euo pipefail

{
  printf 'runner=%s\n' "${RUNNER_OS:-local}"
  printf 'image_os=%s\n' "${ImageOS:-local}"
  printf 'image_version=%s\n' "${ImageVersion:-local}"
  cmake --version | sed -n '1p'
  if command -v xcodebuild >/dev/null 2>&1; then
    xcodebuild -version
  fi
  if command -v clang >/dev/null 2>&1; then
    clang --version | sed -n '1p'
  fi
} | git hash-object --stdin
