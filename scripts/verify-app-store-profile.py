#!/usr/bin/env python3

import datetime
import plistlib
import re
import sys
from pathlib import Path


def verify_profile(profile, requested, team_id, bundle_id, now=None):
    if not isinstance(profile, dict) or not isinstance(requested, dict):
        raise ValueError("profile and requested entitlements must be dictionaries")
    if not re.fullmatch(r"[A-Z0-9]{10}", team_id):
        raise ValueError("invalid Apple Team ID")
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle_id):
        raise ValueError("invalid bundle identifier")
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime.datetime):
        raise ValueError("provisioning profile has no expiration date")
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=datetime.timezone.utc)
    if expires <= now:
        raise ValueError("provisioning profile is expired")

    allowed = profile.get("Entitlements")
    if not isinstance(allowed, dict):
        raise ValueError("provisioning profile has no entitlements")
    app_id = f"{team_id}.{bundle_id}"
    required = {
        "com.apple.application-identifier": app_id,
        "com.apple.developer.team-identifier": team_id,
    }
    for key, value in required.items():
        if allowed.get(key) != value or requested.get(key) != value:
            raise ValueError(f"application and profile disagree on {key}")
    if allowed.get("com.apple.security.get-task-allow") is not False:
        raise ValueError("provisioning profile is not a distribution profile")
    if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
        raise ValueError("development, ad-hoc, or enterprise profile is not allowed")
    if "OSX" not in profile.get("Platform", []):
        raise ValueError("provisioning profile is not for macOS")

    # Apple may omit non-profile-controlled sandbox capabilities. If a
    # requested capability is represented, however, its value must match.
    # Restricted developer/application identifiers may never be omitted.
    for key, value in requested.items():
        if key in allowed and allowed[key] != value:
            raise ValueError(f"provisioning profile rejects requested entitlement {key}")
        if (
            key.startswith("com.apple.developer.")
            or key == "com.apple.application-identifier"
        ) and key not in allowed:
            raise ValueError(f"restricted entitlement is absent from profile: {key}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: verify-app-store-profile.py <profile.plist> "
            "<requested-entitlements.plist> <team-id> <bundle-id>"
        )
    with Path(sys.argv[1]).open("rb") as stream:
        profile = plistlib.load(stream)
    with Path(sys.argv[2]).open("rb") as stream:
        requested = plistlib.load(stream)
    try:
        verify_profile(profile, requested, sys.argv[3], sys.argv[4])
    except ValueError as error:
        raise SystemExit(f"error: {error}") from error
    print("App Store provisioning profile verified")
