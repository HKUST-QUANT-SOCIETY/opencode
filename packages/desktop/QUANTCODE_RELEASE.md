# QuantCode desktop release

The `QuantCode desktop installers` workflow builds the desktop application from this repository for:

- macOS Intel: DMG and ZIP
- macOS Apple Silicon: DMG and ZIP
- Windows x64: NSIS installer
- Linux x64: AppImage, Debian package (`.deb`), and RPM package (`.rpm`)

Linux x64 is built on the hosted `ubuntu-24.04` runner. ARM64 Linux packaging remains configured in electron-builder and in the metadata verifier, but is intentionally opt-in for a later runner-capacity validation. Run the workflow manually to produce downloadable macOS/Windows/Linux GitHub Actions artifacts. Set `publish` to `true`, or push a tag named `quantcode-vX.Y.Z`, to publish the same verified files to a GitHub Release. Prerelease SemVer values such as `1.2.0-rc.1` create a GitHub prerelease and are not marked latest.

The desktop source lives in the `HKUST-QUANT-SOCIETY/opencode` fork, while release assets target `HKUST-QUANT-SOCIETY/quantcode`. Add a fine-grained `QUANTCODE_RELEASE_TOKEN` secret to the fork with `Contents: write` access to the QuantCode repository. Artifact-only runs do not need this token. The workflow must be merged into the source repository's default `dev` branch before `workflow_dispatch` is available.

The target repository is currently private. Browser or GitHub CLI login is not inherited by an installed Electron app, so the current anonymous `electron-updater` GitHub feed cannot read its releases. Do not call automatic updates production-ready until either the release repository/assets are public or a controlled update service/user-authenticated token flow is implemented. Never embed a long-lived repository PAT in the desktop bundle.

The release workflow embeds the tracked `packages/opencode/test/tool/fixtures/models-api.json` snapshot through `MODELS_DEV_API_JSON`. This keeps all three platform jobs reproducible when `models.dev` is unavailable. Refresh that snapshot deliberately when the supported provider catalog changes, review the resulting diff, and commit it with the release workflow change.

## Release signing

Unsigned installers are still produced when signing secrets are absent, which keeps development builds testable. Non-publishing artifact runs explicitly set `QUANTCODE_UNSIGNED_BUILD=true`; publishing runs require signed credentials and the workflow fails closed when any required repository secret is missing. Protect the `quantcode-release` GitHub environment with required reviewers before enabling `publish`, then configure these repository secrets:

### macOS

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_CONTENT`: contents of the App Store Connect `.p8` key
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The release workflow imports the certificate, requires code signing, signs the application with hardened runtime enabled, notarizes it, and verifies `codesign`, Gatekeeper assessment, and the stapled notarization ticket.

### Windows

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

`AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` must be the complete certificate Subject DN returned by `(Get-AuthenticodeSignature .\\QuantCode.exe).SignerCertificate.Subject`, for example `CN=HKUST Quant Society, O=HKUST, C=HK`. Electron Builder writes this value into the Windows update metadata so electron-updater accepts an installer only when its Authenticode signer matches the currently installed publisher.

When these values are present, the workflow authenticates to Azure Trusted Signing, signs the NSIS executable with SHA-256, and verifies its Authenticode status. The Windows package job intentionally does not receive Apple `CSC_*` or notarization variables; those values are scoped to the macOS package step.

Linux packages do not require platform code signing. The release job installs `fakeroot` and `rpm`, validates the AppImage, `.deb`, and `.rpm` names and non-empty contents, and includes all of them in `SHA256SUMS`. electron-builder embeds the AppImage block map in the AppImage and records its size in `latest-linux.yml`; there is no separate Linux blockmap file. `latest-linux.yml` carries the AppImage updater entry; `.deb` and `.rpm` are published as manual-install assets. Distribution repositories may add their own package signatures.

QuantCode stores updater downloads under `quantcode-updater` and uses a separate `quantcode.updater` preference store, so an OpenCode installation cannot reuse or overwrite its update state. Signed macOS/Windows builds verify their platform signatures and disallow downgrade. Linux AppImage updates use the SHA-512 values in `latest-linux.yml`; Debian/RPM packages are manual-install assets in this release flow. Unsigned mode is only for local or artifact-only testing and must never be published.

QuantCode currently disables automatic installation of the upstream OpenCode CLI inside WSL. Re-enable that control only after a versioned QuantCode-compatible WSL backend is published; otherwise a Windows installation could silently run the wrong backend.

## Release process

The release job validates the exact thirteen installer/package outputs before making any GitHub Release visible: eight macOS files, two Windows files, and three Linux files. It merges the two macOS `latest-mac.yml` files, passes through `latest-linux.yml`, verifies the updater entries (AppImage, ZIP, DMG, and EXE) against the local file size and SHA-512, separately validates the DEB/RPM assets, and creates `SHA256SUMS` covering every package. It then creates or reuses a draft release, uploads every asset, compares the remote names, sizes, and GitHub SHA-256 digests, and publishes the draft only after all checks pass. A rerun may replace assets in an existing draft, but it refuses to overwrite an already published release. The exact Linux filenames are `quantcode-<version>-linux-x86_64.AppImage`, `quantcode-<version>-linux-amd64.deb`, and `quantcode-<version>-linux-x86_64.rpm`; the AppImage block map is embedded.

Run an artifact-only build from the default branch with:

```bash
gh workflow run quantcode-desktop.yml -R HKUST-QUANT-SOCIETY/opencode -f version=0.1.0 -f publish=false
```

Before a signed publish, verify the `quantcode-release` environment approval and every secret above. After download, verify the checksum manifest on macOS/Linux with `sha256sum -c SHA256SUMS`; on Windows use `Get-FileHash -Algorithm SHA256` and compare the result with `SHA256SUMS`.

## Local macOS package

From `packages/desktop`:

```bash
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true MODELS_DEV_API_JSON=../opencode/test/tool/fixtures/models-api.json bun run build
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true MODELS_DEV_API_JSON=../opencode/test/tool/fixtures/models-api.json CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --publish never --config electron-builder.config.ts
```

`QUANTCODE_UNSIGNED_BUILD=true` is an explicit local-test mode: it permits the updater to accept unsigned packages and allows downgrade for test fixtures. Without a signed credential set or this flag, the app still packages but disables in-app updates. Release builds enable signature verification and disallow downgrade automatically when all platform signing variables are present.

## Local Linux package

On Ubuntu/Debian, install the host packaging tools before invoking electron-builder:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends fakeroot rpm
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true bun run build
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true bunx electron-builder --linux --x64 --publish never --config electron-builder.config.ts
```

The output directory contains an AppImage (plus its embedded blockmap), a Debian package, an RPM package, and `latest-linux.yml`. The x64 names use `linux-x86_64` for AppImage/RPM and `linux-amd64` for Debian.
