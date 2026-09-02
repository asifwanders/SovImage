#!/usr/bin/env python3

import copy
import datetime
import hashlib
import importlib.util
import json
import plistlib
import re
import struct
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI = ROOT / "frontend/src-tauri"

assert hashlib.sha256((TAURI / "migrations/0001_init.sql").read_bytes()).hexdigest() == (
    "61b5debecd14bda1f5f73901c7b374570fe8e4aaf7bbdb4d226c6191613de698"
)

for path in [
    TAURI / "tauri.conf.json",
    TAURI / "tauri.macos.conf.json",
    TAURI / "tauri.windows.conf.json",
    TAURI / "tauri.appstore.conf.json",
    TAURI / "capabilities/default.json",
    TAURI / "resources/build-provenance.json",
]:
    json.loads(path.read_text())

for path in [
    TAURI / "Info.plist",
    TAURI / "Entitlements.appstore.plist.in",
    TAURI / "Entitlements.helper.plist",
    TAURI / "resources/PrivacyInfo.xcprivacy",
]:
    with path.open("rb") as stream:
        plistlib.load(stream)

config = json.loads((TAURI / "tauri.conf.json").read_text())
csp = config["app"]["security"]["csp"]
dev_csp = config["app"]["security"]["devCsp"]
assert csp and "unsafe-eval" not in csp and "object-src 'none'" in csp
assert "asset:" in csp and "http://asset.localhost" in csp
assert "ws://localhost:3000" in dev_csp and "unsafe-eval" in dev_csp
assert " wss:" not in dev_csp and "https:" not in dev_csp
package = json.loads((ROOT / "frontend/package.json").read_text())
node_version = (ROOT / ".node-version").read_text().strip()
assert node_version == "24.14.1"
assert package["engines"] == {"node": node_version, "npm": "11.11.0"}
assert package["packageManager"] == "npm@11.11.0"
with (TAURI / "Cargo.toml").open("rb") as stream:
    cargo = tomllib.load(stream)
assert config["version"] == package["version"] == cargo["package"]["version"] == "0.2.0"
assert config["bundle"]["createUpdaterArtifacts"] is False
for name in ["LICENSE", "APACHE-2.0.txt", "DEPENDENCY_NOTICES.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"]:
    assert (ROOT / name).is_file()
    assert f'"../../{name}"' in json.dumps(config["bundle"]["resources"])

capability = json.loads((TAURI / "capabilities/default.json").read_text())
capability_text = json.dumps(capability)
assert "$HOME" not in capability_text
assert "shell:allow-execute" not in capability_text
assert '"core:default"' not in capability_text
assert "$RESOURCE/build-provenance.json" in capability_text
permissions = capability["permissions"]
resource_read = next(p for p in permissions if isinstance(p, dict) and p["identifier"] == "fs:allow-read-text-file")
assert resource_read["allow"] == [{"path": "$RESOURCE/build-provenance.json"}]
global_scope = next(p for p in permissions if isinstance(p, dict) and p["identifier"] == "fs:scope")
assert all("$RESOURCE" not in entry["path"] for entry in global_scope["allow"])

for name in ["tauri.macos.conf.json", "tauri.appstore.conf.json"]:
    platform = json.loads((TAURI / name).read_text())
    assert platform["bundle"]["macOS"]["minimumSystemVersion"] == "12.0"
assert json.loads((TAURI / "tauri.appstore.conf.json").read_text())["bundle"]["createUpdaterArtifacts"] is False
windows = json.loads((TAURI / "tauri.windows.conf.json").read_text())
assert windows["bundle"]["resources"]["binaries/*.dll"] == ""
assert windows["bundle"]["resources"]["binaries/sdcpp-runtime-manifest.json"] == "sdcpp-runtime-manifest.json"

with (TAURI / "Entitlements.helper.plist").open("rb") as stream:
    helper_entitlements = plistlib.load(stream)
assert set(helper_entitlements) == {
    "com.apple.security.app-sandbox",
    "com.apple.security.inherit",
}
entitlements_template = (TAURI / "Entitlements.appstore.plist.in").read_text()
assert "__APPLE_TEAM_ID__.__BUNDLE_ID__" in entitlements_template
for script in [ROOT / "scripts/render-app-store-files.sh", ROOT / "scripts/package-app-store.sh"]:
    text = script.read_text()
    assert 'tauri.conf.json' in text and 'bundle_id=' in text
    assert "com.sovimage.app" not in text
profile_verifier_path = ROOT / "scripts/verify-app-store-profile.py"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("profile_verifier", profile_verifier_path)
assert spec and spec.loader
profile_verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile_verifier)
team = "ABCDEFGHIJ"
bundle = "com.example.app"
requested = {
    "com.apple.security.app-sandbox": True,
    "com.apple.security.network.client": True,
    "com.apple.security.files.user-selected.read-write": True,
    "com.apple.application-identifier": f"{team}.{bundle}",
    "com.apple.developer.team-identifier": team,
}
profile = {
    "ExpirationDate": datetime.datetime(2030, 1, 1, tzinfo=datetime.timezone.utc),
    "Platform": ["OSX"],
    "Entitlements": {
        "com.apple.application-identifier": f"{team}.{bundle}",
        "com.apple.developer.team-identifier": team,
        "com.apple.security.get-task-allow": False,
    },
}
now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
profile_verifier.verify_profile(profile, requested, team, bundle, now)
represented = copy.deepcopy(profile)
represented["Entitlements"]["com.apple.security.app-sandbox"] = True
profile_verifier.verify_profile(represented, requested, team, bundle, now)
for key in ["com.apple.security.app-sandbox", "com.apple.security.network.client"]:
    rejected = copy.deepcopy(profile)
    rejected["Entitlements"][key] = False
    try:
        profile_verifier.verify_profile(rejected, requested, team, bundle, now)
    except ValueError:
        pass
    else:
        raise AssertionError(f"profile conflict was accepted for {key}")

with (TAURI / "resources/PrivacyInfo.xcprivacy").open("rb") as stream:
    privacy = plistlib.load(stream)
assert privacy["NSPrivacyTracking"] is False
assert privacy["NSPrivacyCollectedDataTypes"] == []
assert privacy["NSPrivacyAccessedAPITypes"] == [
    {
        "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",
        "NSPrivacyAccessedAPITypeReasons": ["E174.1"],
    },
    {
        "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
        "NSPrivacyAccessedAPITypeReasons": ["C617.1", "3B52.1"],
    },
]

privacy_policy = (ROOT / "PRIVACY.md").read_text()
app_store = (ROOT / "APP_STORE.md").read_text()
assert "pending provider-policy review" in privacy_policy
assert "pending provider-policy review" in app_store

registry = (TAURI / "src/downloader/registry.rs").read_text()
pack_sizes = {
    tier: int(value.replace("_", ""))
    for tier, value in re.findall(
        r"assert_eq!\(total_bytes\(Tier::(One|Two|Three)\), ([0-9_]+)\);", registry
    )
}
assert pack_sizes == {"One": 5_207_178_964, "Two": 5_207_178_964, "Three": 8_830_554_324}
assert "5,207,178,964–8,830,554,324" in app_store
readme = (ROOT / "README.md").read_text()
assert "FLUX.2 Klein Q4 + Qwen3 Q4 | 4.85 GiB" in readme

notices = (ROOT / "DEPENDENCY_NOTICES.md").read_text()
package_lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
assert package_lock["packages"][""]["engines"] == package["engines"]
for name in package["dependencies"]:
    version = package_lock["packages"][f"node_modules/{name}"]["version"]
    assert name in notices and version in notices
with (TAURI / "Cargo.lock").open("rb") as stream:
    cargo_lock = tomllib.load(stream)
locked = {}
for entry in cargo_lock["package"]:
    locked.setdefault(entry["name"], []).append(entry["version"])
root_package = next(entry for entry in cargo_lock["package"] if entry["name"] == "sovimage")
manifest_dependencies = set(cargo.get("dependencies", {}))
manifest_dependencies.update(cargo.get("build-dependencies", {}))
manifest_dependencies.update(cargo.get("dev-dependencies", {}))
for target in cargo.get("target", {}).values():
    manifest_dependencies.update(target.get("dependencies", {}))
locked_root_dependencies = {dependency.split()[0] for dependency in root_package["dependencies"]}
assert manifest_dependencies == locked_root_dependencies
for dependency in root_package["dependencies"]:
    name, _, explicit = dependency.rpartition(" ")
    if not explicit[:1].isdigit():
        name, explicit = dependency, ""
    if name in {"tauri-build", "tempfile"}:
        continue
    versions = [explicit] if explicit else locked[name]
    assert name in notices and any(version in notices for version in versions)

release_workflow = (ROOT / ".github/workflows/release.yml").read_text()
app_store_workflow = (ROOT / ".github/workflows/app-store.yml").read_text()
building = (ROOT / "BUILDING.md").read_text()
ci_workflow = (ROOT / ".github/workflows/ci.yml").read_text()
nightly_workflow = (ROOT / ".github/workflows/nightly.yml").read_text()
for workflow_path in sorted((ROOT / ".github/workflows").glob("*.yml")):
    for action in re.findall(
        r"^\s*(?:-\s*)?uses:\s*([^\s#]+)",
        workflow_path.read_text(),
        re.MULTILINE,
    ):
        if action.startswith("./"):
            continue
        if not re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", action):
            raise AssertionError(f"mutable action reference in {workflow_path}: {action}")
for workflow in [ci_workflow, release_workflow, app_store_workflow, nightly_workflow]:
    assert "macos-15" in workflow and "macos-14" not in workflow and "macos-latest" not in workflow
    assert "native-toolchain-fingerprint.sh" in workflow
for workflow in [ci_workflow, release_workflow, app_store_workflow]:
    assert "node-version-file: .node-version" in workflow
    assert "verify-node-toolchain.mjs" in workflow
    assert "NODE_VERSION" not in workflow
assert "persist-credentials: false" in nightly_workflow
assert nightly_workflow.index("issues: write") > nightly_workflow.index("\n  report:")
assert "report sanitized upstream drift" in nightly_workflow
assert "uses: ./.github/workflows/ci.yml" in release_workflow
assert "uses: ./.github/workflows/ci.yml" in app_store_workflow
assert "verify-sdcpp-runtime.ps1" in release_workflow
assert "rust-windows:" in ci_workflow
assert "Check Windows-only runtime code" in ci_workflow
assert "--no-default-features --locked" in release_workflow
assert "--no-default-features --locked" in app_store_workflow
for command in ["cargo clippy", "cargo test", "cargo check"]:
    assert all("--locked" in line for line in ci_workflow.splitlines() if command in line)
assert "SOVIMAGE_SOURCE_REF" in release_workflow
assert "SOVIMAGE_SOURCE_REF" in (ROOT / "scripts/write-build-provenance.mjs").read_text()
assert "--verify" in (ROOT / "scripts/write-build-provenance.mjs").read_text()
assert "Verify build provenance" in release_workflow
assert "Verify source and bundled provenance" in app_store_workflow
provenance = json.loads((TAURI / "resources/build-provenance.json").read_text())
assert provenance["schema"] == 2
assert provenance["nodeVersion"] == node_version
assert provenance["npmVersion"] == "11.11.0"
package_script = (ROOT / "scripts/package-app-store.sh").read_text()
for resource in [
    "build-provenance.json",
    "PrivacyInfo.xcprivacy",
    "LICENSE",
    "APACHE-2.0.txt",
    "DEPENDENCY_NOTICES.md",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
]:
    assert resource in package_script
assert "ITSAppUsesNonExemptEncryption" in package_script
assert "'desktop-release'" in release_workflow and "protected `desktop-release`" in building
for variable in [
    "SOVIMAGE_LEGAL_REVIEW_COMMIT",
    "SOVIMAGE_ACTION_PINS_REVIEW_COMMIT",
    "SOVIMAGE_DEPENDENCY_AUDIT_COMMIT",
    "SOVIMAGE_WINDOWS_REDISTRIBUTION_REVIEW_COMMIT",
    "SOVIMAGE_NAME_BUNDLE_ID_CLEARANCE_COMMIT",
]:
    assert variable in release_workflow and variable in building
assert "upload exact validated package" in app_store_workflow
assert app_store_workflow.index("actions/upload-artifact") < app_store_workflow.index("Validate with App Store Connect")
assert app_store_workflow.count("--p8-file-path") == 2
assert "API_PRIVATE_KEYS_DIR" not in app_store_workflow
for variable in [
    "SOVIMAGE_LEGAL_REVIEW_COMMIT",
    "SOVIMAGE_ACTION_PINS_REVIEW_COMMIT",
    "SOVIMAGE_DEPENDENCY_AUDIT_COMMIT",
    "SOVIMAGE_PRIVACY_REVIEW_COMMIT",
    "SOVIMAGE_NAME_BUNDLE_ID_CLEARANCE_COMMIT",
]:
    assert variable in app_store_workflow and variable in app_store
assert "pinned full commit SHA" in building

ico = (TAURI / "icons/icon.ico").read_bytes()
reserved, image_type, count = struct.unpack_from("<HHH", ico)
assert (reserved, image_type) == (0, 1)
sizes = set()
for index in range(count):
    width, height = struct.unpack_from("BB", ico, 6 + index * 16)
    sizes.add((width or 256, height or 256))
assert {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)} <= sizes

print("release assets verified")
