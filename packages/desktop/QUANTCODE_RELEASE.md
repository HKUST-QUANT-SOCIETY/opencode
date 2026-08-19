# QuantCode desktop release

The `QuantCode desktop installers` workflow currently produces the supported
macOS and Windows release targets:

- macOS Intel: DMG and ZIP
- macOS Apple Silicon: DMG and ZIP
- Windows x64: NSIS installer

Linux packaging is intentionally deferred. The electron-builder and metadata
code keeps the Linux targets available for a later release, but the active
workflow does not spend a Linux runner or publish Linux assets. The current
release set is eight macOS files and two Windows files, plus updater metadata
and verification manifests.

The desktop source lives in the `HKUST-QUANT-SOCIETY/opencode` fork, while
release assets target `HKUST-QUANT-SOCIETY/quantcode`. The workflow must be
merged into the source repository's default `dev` branch before
`workflow_dispatch` is available. A pull request runs unsigned packaging and
the packaged-launch smoke test; a tag named `quantcode-vX.Y.Z`, or a manual
dispatch from `dev` with `publish=true`, runs the signed release path.

The target repository is currently private. Browser or GitHub CLI login is not
inherited by an installed Electron app, so the current anonymous
`electron-updater` GitHub feed cannot read its releases. Do not call automatic
updates production-ready until either the release repository/assets are public
or a controlled update service/user-authenticated token flow is implemented.
Never embed a long-lived repository PAT in the desktop bundle.

The build embeds the tracked
`packages/opencode/test/tool/fixtures/models-api.json` snapshot through
`MODELS_DEV_API_JSON`. This keeps all three active targets reproducible when
`models.dev` is unavailable. Refresh that snapshot deliberately when the
supported provider catalog changes, review the diff, and commit it with the
release workflow change.

## Release signing

Unsigned installers are used only for pull-request and artifact-only QA runs.
Publishing fails closed unless all required signing and release credentials are
present. Protect the `quantcode-release` GitHub environment with required
reviewers before enabling `publish`.

### macOS

The two macOS jobs use these environment secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_CONTENT`: contents of the App Store Connect `.p8` key
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The workflow imports the certificate, signs with hardened runtime, notarizes,
and verifies `codesign`, Gatekeeper assessment, and the stapled notarization
ticket before uploading the artifacts.

### Windows

The Windows job uses these environment secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

`AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` must be the complete certificate
Subject DN returned by
`(Get-AuthenticodeSignature .\\QuantCode.exe).SignerCertificate.Subject`.
The workflow authenticates to Azure Trusted Signing with `id-token: write`,
signs the NSIS executable with SHA-256, and verifies the installer and unpacked
application signatures. The macOS jobs do not receive Azure credentials or
OIDC write permission.

QuantCode stores updater downloads under `quantcode-updater` and uses a
separate `quantcode.updater` preference store, so an OpenCode installation
cannot reuse or overwrite its update state. Signed macOS/Windows builds verify
their platform signatures and disallow downgrade. Unsigned mode is only for
local or artifact-only testing and must never be published.

QuantCode currently disables automatic installation of the upstream OpenCode
CLI inside WSL. Re-enable that control only after a versioned
QuantCode-compatible WSL backend is published.

## Release process

`Finalize release bundle` runs after either the unsigned PR matrix or all three
signed targets. It validates the exact active installer set, verifies updater
metadata against local file names, sizes, and SHA-512 values, merges the two
macOS feeds, and writes:

- `latest-mac.yml` (both macOS architectures)
- `latest.yml` (Windows x64)
- `release-manifest.json` (source commit, workflow run, release tag, sizes, and SHA-256)
- `SHA256SUMS` (packages and generated metadata)

For a published run, a separate release job creates or reuses a draft release,
uploads only the finalized assets, compares remote names, sizes, and GitHub
SHA-256 digests, and publishes only after verification. It refuses to replace
an already published release.

## Packaged launch smoke test

Each active target launches its unpacked QuantCode application after
electron-builder. The test sets `OPENCODE_TEST_ONBOARDING=1` and passes
Chromium's remote debugging address and a newly allocated loopback port as
command-line arguments. `packages/desktop/scripts/verify-packaged-launch.ts`
then polls `/json/list` with bounded timeouts and verifies:

- an Electron `oc://renderer/` page titled `QuantCode`;
- `document.readyState === "complete"` and a mounted `#root`;
- the stable `data-product="quantcode"` renderer marker;
- at least one interactive control and a healthy local sidecar;
- a two-second stable state before passing.

The smoke process receives its PID so cleanup can terminate the complete
process tree (`kill` on macOS and `taskkill /T /F` on Windows). The debug port
is loopback-only, random per run, and never enabled by a normal packaged
launch. There is no `QUANTCODE_PACKAGED_SMOKE` product flag.

Run an artifact-only build from the default branch with:

```bash
gh workflow run quantcode-desktop.yml -R HKUST-QUANT-SOCIETY/opencode -f version=0.1.0 -f publish=false
```

For pull requests, inspect `Finalize release bundle` and its
`release-metadata` artifact in addition to the three target jobs. A green
packaging job without finalization is not release evidence.

Before a signed publish, verify the environment approval and every secret
above. After download, verify the checksum manifest on macOS with
`shasum -a 256 -c SHA256SUMS`; on Windows use
`Get-FileHash -Algorithm SHA256` and compare the result with `SHA256SUMS`.

## Local macOS package

From `packages/desktop`:

```bash
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true MODELS_DEV_API_JSON=../opencode/test/tool/fixtures/models-api.json bun run build
OPENCODE_CHANNEL=quantcode QUANTCODE_UNSIGNED_BUILD=true MODELS_DEV_API_JSON=../opencode/test/tool/fixtures/models-api.json CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --publish never --config electron-builder.config.ts
```

The unsigned package is for QA only and may show macOS trust warnings. A
production package requires the Apple signing and notarization secrets in CI.

## Local Windows package

From `packages/desktop` on Windows PowerShell:

```powershell
$env:OPENCODE_CHANNEL = "quantcode"
$env:QUANTCODE_UNSIGNED_BUILD = "true"
$env:MODELS_DEV_API_JSON = "../opencode/test/tool/fixtures/models-api.json"
bun run build
bun run package:win
```

The installer is written to `dist/quantcode-<version>-win-x64.exe`; the
unpacked application used by CI is under `dist/*-unpacked/QuantCode.exe`. A
local unsigned package is for QA only and may trigger SmartScreen.

## Linux status

Linux is not part of the current release target. Its electron-builder targets,
updater merger, and tests remain in the repository so a later change can
enable Linux deliberately after runner capacity and desktop smoke coverage are
validated. Do not advertise or publish the Linux outputs from this workflow.
