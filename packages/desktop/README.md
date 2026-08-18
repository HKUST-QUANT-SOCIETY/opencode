# QuantCode Desktop

The QuantCode desktop app reuses the OpenCode Electron shell with QuantCode product identity, renderer, sidecar, and release controls.

See [QUANTCODE_RELEASE.md](./QUANTCODE_RELEASE.md) for macOS and Windows packaging, signing, updater, and release requirements. Linux targets remain configured but are not in the active release matrix.

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
