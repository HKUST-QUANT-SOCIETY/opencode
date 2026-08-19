# QuantCode Desktop

The QuantCode desktop app reuses the OpenCode Electron shell with QuantCode product identity, renderer, sidecar, and release controls.

See [QUANTCODE_RELEASE.md](./QUANTCODE_RELEASE.md) for macOS, Windows, and Linux packaging, signing, updater, and release requirements. The active Linux matrix builds x64 AppImage, `.deb`, and `.rpm` artifacts; ARM64 remains configured for a later hosted-runner validation.

## Development

From the repository root:

```bash
bun install
bun run dev:desktop
```

## Build

From `packages/desktop`, run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build
bun run package
```
