#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <SovImage.app> <output.pkg> <build-number>" >&2
  exit 2
fi

app="$1"
package="$2"
build_number="$3"
app_identity="${APPLE_DISTRIBUTION_IDENTITY:?APPLE_DISTRIBUTION_IDENTITY is required}"
installer_identity="${APPLE_INSTALLER_IDENTITY:?APPLE_INSTALLER_IDENTITY is required}"
team_id="${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tauri_dir="$repo_root/frontend/src-tauri"
bundle_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identifier"])' "$tauri_dir/tauri.conf.json")"
helper="$app/Contents/MacOS/sd"
helper_id="$bundle_id.sd"
main_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
main="$app/Contents/MacOS/$main_name"

if [[ ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: build number must be a positive integer" >&2
  exit 1
fi
if [[ ! -d "$app" || ! -x "$main" || ! -x "$helper" ]]; then
  echo "error: expected app bundle/helper not found under $app" >&2
  exit 1
fi

resources="$app/Contents/Resources"
for mapping in \
  "$tauri_dir/resources/build-provenance.json:build-provenance.json" \
  "$tauri_dir/resources/PrivacyInfo.xcprivacy:PrivacyInfo.xcprivacy" \
  "$repo_root/LICENSE:LICENSE" \
  "$repo_root/APACHE-2.0.txt:APACHE-2.0.txt" \
  "$repo_root/DEPENDENCY_NOTICES.md:DEPENDENCY_NOTICES.md" \
  "$repo_root/PRIVACY.md:PRIVACY.md" \
  "$repo_root/THIRD_PARTY_NOTICES.md:THIRD_PARTY_NOTICES.md"; do
  source_file="${mapping%%:*}"
  bundled_name="${mapping##*:}"
  test -f "$resources/$bundled_name"
  cmp "$source_file" "$resources/$bundled_name"
done
test "$(plutil -extract ITSAppUsesNonExemptEncryption raw "$app/Contents/Info.plist")" = "false"

/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$app/Contents/Info.plist"

codesign --force --sign "$app_identity" --options runtime --timestamp \
  --identifier "$helper_id" \
  --entitlements "$tauri_dir/Entitlements.helper.plist" \
  "$helper"
codesign --force --sign "$app_identity" --options runtime --timestamp \
  --entitlements "$tauri_dir/Entitlements.appstore.plist" \
  "$app"

codesign --verify --deep --strict --verbose=2 "$app"
test "$(defaults read "$app/Contents/Info" CFBundleIdentifier)" = "$bundle_id"
test "$(defaults read "$app/Contents/Info" CFBundleVersion)" = "$build_number"
test "$(defaults read "$app/Contents/Info" LSMinimumSystemVersion)" = "12.0"
test "$(lipo -archs "$main")" = "arm64"
test "$(lipo -archs "$helper")" = "arm64"
test "$(vtool -show-build "$main" | awk '/minos/{print $2; exit}')" = "12.0"
test "$(vtool -show-build "$helper" | awk '/minos/{print $2; exit}')" = "12.0"
test -f "$app/Contents/embedded.provisionprofile"
cmp "$tauri_dir/embedded.provisionprofile" "$app/Contents/embedded.provisionprofile"
codesign -dv --verbose=4 "$app" 2>&1 | grep -F -- "Identifier=$bundle_id"
codesign -dv --verbose=4 "$app" 2>&1 | grep -F -- "TeamIdentifier=$team_id"
codesign -dv --verbose=4 "$app" 2>&1 | grep -F -- "Authority=$app_identity"
codesign -dv --verbose=4 "$app" 2>&1 | grep -F -- 'flags=0x10000(runtime)'
codesign -dv --verbose=4 "$helper" 2>&1 | grep -F -- "Identifier=$helper_id"
codesign -dv --verbose=4 "$helper" 2>&1 | grep -F -- "TeamIdentifier=$team_id"
codesign -dv --verbose=4 "$helper" 2>&1 | grep -F -- "Authority=$app_identity"
codesign -dv --verbose=4 "$helper" 2>&1 | grep -F -- 'flags=0x10000(runtime)'

app_entitlements="$(mktemp)"
helper_entitlements="$(mktemp)"
profile_plist="$(mktemp)"
trap 'rm -f "$app_entitlements" "$helper_entitlements" "$profile_plist"' EXIT
codesign -d --entitlements "$app_entitlements" "$app" 2>/dev/null
codesign -d --entitlements "$helper_entitlements" "$helper" 2>/dev/null
security cms -D -i "$app/Contents/embedded.provisionprofile" > "$profile_plist"

test "$(plutil -extract com.apple.security.app-sandbox raw "$app_entitlements")" = "true"
test "$(plutil -extract com.apple.security.network.client raw "$app_entitlements")" = "true"
test "$(plutil -extract com.apple.security.files.user-selected.read-write raw "$app_entitlements")" = "true"
test "$(plutil -extract com.apple.security.app-sandbox raw "$helper_entitlements")" = "true"
test "$(plutil -extract com.apple.security.inherit raw "$helper_entitlements")" = "true"
plutil -convert json -o - "$helper_entitlements" \
  | python3 -c 'import json,sys; assert len(json.load(sys.stdin)) == 2'
python3 - "$app_entitlements" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as stream:
    app = plistlib.load(stream)
expected = {
    "com.apple.security.app-sandbox",
    "com.apple.security.network.client",
    "com.apple.security.files.user-selected.read-write",
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
}
if set(app) != expected:
    raise SystemExit(f"error: unexpected app entitlements: {sorted(set(app) - expected)}")
PY
python3 "$repo_root/scripts/verify-app-store-profile.py" \
  "$profile_plist" "$app_entitlements" "$team_id" "$bundle_id"

xcrun productbuild --sign "$installer_identity" --component "$app" /Applications "$package"
pkgutil --check-signature "$package" | grep -F -- "$installer_identity"
echo "created signed App Store package: $package"
