#!/usr/bin/env bash

set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tauri_dir="$repo_root/frontend/src-tauri"
team_id="${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
profile_b64="${APPLE_MAS_PROVISION_PROFILE_BASE64:?APPLE_MAS_PROVISION_PROFILE_BASE64 is required}"
bundle_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identifier"])' "$tauri_dir/tauri.conf.json")"

if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "error: APPLE_TEAM_ID must be a 10-character Apple Team ID" >&2
  exit 1
fi
if [[ ! "$bundle_id" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "error: invalid bundle identifier in tauri.conf.json" >&2
  exit 1
fi

sed -e "s/__APPLE_TEAM_ID__/$team_id/g" -e "s/__BUNDLE_ID__/$bundle_id/g" \
  "$tauri_dir/Entitlements.appstore.plist.in" \
  > "$tauri_dir/Entitlements.appstore.plist"
printf '%s' "$profile_b64" | base64 --decode > "$tauri_dir/embedded.provisionprofile"

plutil -lint "$tauri_dir/Entitlements.appstore.plist" >/dev/null
profile_plist="$(mktemp)"
trap 'rm -f "$profile_plist"' EXIT
security cms -D -i "$tauri_dir/embedded.provisionprofile" > "$profile_plist"

python3 "$repo_root/scripts/verify-app-store-profile.py" \
  "$profile_plist" "$tauri_dir/Entitlements.appstore.plist" "$team_id" "$bundle_id"

echo "rendered App Store entitlements and verified provisioning profile"
