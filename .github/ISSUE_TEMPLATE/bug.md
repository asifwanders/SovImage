---
name: Bug report
about: Something broken? Open an issue with reproduction steps.
title: "bug: "
labels: ["bug"]
---

## Summary

A clear, one-paragraph description of the bug.

## Reproduce

1.
2.
3.

## Expected

What you expected to happen.

## Actual

What actually happened. Include screenshots/screen-recordings if relevant.

## Environment

- **OS + arch:** (e.g. macOS 14.4 arm64, Windows 11 x64)
- **App version:** (Settings → About, or `Get-Item` the bundle)
- **sd.cpp commit:** (run `git -C vendor/stable-diffusion.cpp rev-parse --short HEAD`)
- **GPU + VRAM:** (e.g. M2 Pro 16 GB unified, RTX 4070 12 GB)

## Logs

Run with `SOVIMAGE_LOG=debug` and paste relevant log output here.
