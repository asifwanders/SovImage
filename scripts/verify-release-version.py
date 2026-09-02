#!/usr/bin/env python3

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER_TAG = re.compile(
    r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

if len(sys.argv) != 2 or not SEMVER_TAG.fullmatch(sys.argv[1]):
    raise SystemExit("error: expected one strict SemVer tag such as v0.2.0")

tag = sys.argv[1]
version = tag[1:]
versions = {
    "frontend/package.json": json.loads((ROOT / "frontend/package.json").read_text())["version"],
    "frontend/package-lock.json": json.loads(
        (ROOT / "frontend/package-lock.json").read_text()
    )["packages"][""]["version"],
    "frontend/src-tauri/tauri.conf.json": json.loads(
        (ROOT / "frontend/src-tauri/tauri.conf.json").read_text()
    )["version"],
    "frontend/src-tauri/Cargo.toml": tomllib.loads(
        (ROOT / "frontend/src-tauri/Cargo.toml").read_text()
    )["package"]["version"],
}
with (ROOT / "frontend/src-tauri/Cargo.lock").open("rb") as stream:
    cargo_lock = tomllib.load(stream)
versions["frontend/src-tauri/Cargo.lock"] = next(
    package["version"]
    for package in cargo_lock["package"]
    if package["name"] == "sovimage"
)
mismatches = {path: value for path, value in versions.items() if value != version}
if mismatches:
    raise SystemExit(f"error: tag {tag} does not match manifests: {mismatches}")

changelog = (ROOT / "CHANGELOG.md").read_text()
if not re.search(rf"^## \[{re.escape(version)}\](?:\s+-\s+\d{{4}}-\d{{2}}-\d{{2}})?\s*$", changelog, re.MULTILINE):
    raise SystemExit(f"error: CHANGELOG.md has no section for {version}")

print(f"release version verified: {version}")
