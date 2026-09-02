# Mac App Store Release Checklist

The presence of a workflow is not App Store readiness. Complete every item
below for the exact 0.2.0 commit and retain the evidence.

## Apple setup

- [ ] Active Apple Developer Program membership and accepted agreements.
- [ ] After name/ownership clearance, App Store Connect macOS app registered
  with the final publisher-controlled bundle ID. Source currently uses
  `com.sovimage.app`; that is a candidate, not proof of ownership.
- [ ] Mac App Store Connect provisioning profile for the cleared final App ID.
- [ ] Apple Distribution and Mac Installer Distribution certificates.
- [ ] App Store Connect API key with permission to validate/upload builds.
- [ ] Protected GitHub environment named `app-store` with required reviewers.
- [ ] Unique positive `CFBundleVersion`; workflow run number is the default.
- [ ] Every action used by the secret-bearing workflow is pinned to a locally
  verified immutable commit SHA; Dependabot remains configured to propose updates.
- [ ] Protected-environment variables `SOVIMAGE_LEGAL_REVIEW_COMMIT`,
  `SOVIMAGE_ACTION_PINS_REVIEW_COMMIT`, `SOVIMAGE_DEPENDENCY_AUDIT_COMMIT`,
  `SOVIMAGE_PRIVACY_REVIEW_COMMIT`, and
  `SOVIMAGE_NAME_BUNDLE_ID_CLEARANCE_COMMIT` each equal the exact candidate commit.
  Package creation and validation remain available without these attestations;
  the upload job fails closed without them.

Secrets required by `.github/workflows/app-store.yml` (store them on the
protected `app-store` environment rather than as repository-wide secrets):

- `APPLE_MAS_APP_CERTIFICATE_P12_BASE64`
- `APPLE_MAS_APP_CERTIFICATE_PASSWORD`
- `APPLE_MAS_INSTALLER_CERTIFICATE_P12_BASE64`
- `APPLE_MAS_INSTALLER_CERTIFICATE_PASSWORD`
- `APPLE_MAS_PROVISION_PROFILE_BASE64`
- `APPLE_DISTRIBUTION_IDENTITY`
- `APPLE_INSTALLER_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_P8_BASE64`

These are placeholders by name only. Never place their values in source,
workflow inputs, logs, artifacts, issue text, or documentation.

## Automated package gates

- [ ] Apple Silicon app declares macOS 12.0 minimum.
- [ ] Main app has App Sandbox, outbound network, and user-selected read/write.
- [ ] `sd` helper has exactly App Sandbox and sandbox inheritance.
- [ ] Embedded profile application identifier and team match the signed app.
- [ ] Every requested entitlement represented by the provisioning profile has
  the same value. Apple may omit non-profile-controlled sandbox capabilities;
  omission is allowed, but an explicitly conflicting value fails the package.
- [ ] Every nested executable and the app pass strict `codesign` verification.
- [ ] `PrivacyInfo.xcprivacy` matches the final executable: disk-space checks
  declare `E174.1`, and container/user-selected file metadata declares
  `C617.1` and `3B52.1`; re-audit after dependency or platform changes.
- [ ] `.pkg` is signed by Mac Installer Distribution and passes `pkgutil`.
- [ ] `xcrun altool --validate-app` succeeds for the final package.
- [ ] The candidate package is retained before server validation, and its SHA-256
  is unchanged when the dependent upload job retrieves it.

The upload input enables a dependent job only after validation succeeds. It
sends that exact retained package to App Store Connect/TestFlight processing;
it does not select a build or submit an App Review request.

## Metadata and policy

- [ ] Privacy Policy URL points to the public [PRIVACY.md](PRIVACY.md).
- [ ] Public Support URL and Marketing URL are live, accurate, and entered in
  App Store Connect; neither points at a private or temporary page.
- [ ] Privacy-label selection is **pending provider-policy review** of Hugging
  Face/CDN connection metadata; packet capture, code, provider retention/use,
  `PRIVACY.md`, the privacy manifest, and the final label all agree.
- [ ] Encryption answer matches `ITSAppUsesNonExemptEncryption=false` and actual binary use.
- [ ] Architecture and compatibility metadata say Apple Silicon (`arm64`) and
  macOS 12.0 or later; Intel compatibility is not implied.
- [ ] Legal/name clearance resolves the existing Canadian media-production use
  of “Sovimage” and confirms the final product name before registration.
- [ ] The final reverse-DNS bundle identifier is demonstrably controlled by the
  publisher. `com.sovimage.app` must not be registered merely because it is in
  source; do not rename it silently, because changing identity also changes
  signing/App Store records and local data/container migration.
- [ ] Category, copyright, description, keywords, accessibility text, and
  screenshots for every required Mac display size are complete and match the
  submitted build.
- [ ] The age-rating/content-capability decision explicitly accounts for
  unrestricted local image generation and editing; App Review notes describe
  the absence or presence of content filtering without implying server moderation.
- [ ] Third-party/model rights are reviewed from [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
  and [DEPENDENCY_NOTICES.md](DEPENDENCY_NOTICES.md); every pending Windows,
  transitive, model, and NOTICE obligation is resolved for the Mac artifact.
- [ ] The exact lockfiles are scanned and every advisory is resolved or has a
  documented reachability/target decision before setting the dependency-audit
  attestation.
- [ ] Review notes disclose the consented first-run resource download: exactly
  5,207,178,964–8,830,554,324 bytes (about 5.21–8.83 decimal GB or
  4.85–8.22 GiB), local-only inference, no login, supported hardware, and how
  to reach edit mode. This is the prompted initial-resource flow permitted by
  App Store rule 4.2.3(ii), not an undisclosed post-install payload.
- [ ] Review notes give realistic download and first-generation time ranges on
  named test hardware and explain that a 12 GiB or larger Apple Silicon Mac is
  required.
- [ ] Reviewer can test without private credentials or an unavailable server.
- [ ] Decide and disclose channel migration before launch: Developer-ID and Mac
  App Store sandbox builds use separate containers, so direct-beta chats and
  models do not automatically appear in the App Store build. Until a
  user-selected import/export flow exists, describe them as separate installs
  and never instruct users to copy sandbox internals manually.

## TestFlight device matrix

- [ ] Clean macOS 12 Apple Silicon installation with no prior app data.
- [ ] At least one current macOS release.
- [ ] 12/16 GiB tier-1 device and 24/32+ GiB higher-tier device.
- [ ] Interrupted/resumed model download and corrupt-file rejection.
- [ ] Text generation, reference edit, cancel, restart recovery, export, copy,
  deletion/reset, offline relaunch after models are present, and low-disk failure.
- [ ] Real generation and reference editing pass measured benchmarks on every
  claimed 12/16/24/32+ GiB tier; source build and CLI parsing are not substitutes.
- [ ] Activity Monitor reports the app and helper as sandboxed.
- [ ] No unexpected outbound connection during prompt/generation/export.
- [ ] App Store receipt/TestFlight launch succeeds outside the build machine.

Do not submit until the final uploaded build finishes App Store processing with
no unresolved warnings and every item above has evidence.
