# QuantCode Desktop

The QuantCode desktop app reuses the OpenCode Electron shell with QuantCode product identity, renderer, sidecar, and release controls.

See [QUANTCODE_RELEASE.md](./QUANTCODE_RELEASE.md) for packaging, signing, updater, and release requirements. The active release targets are macOS arm64/x64 and Windows x64; Linux packaging is deferred. Pull requests run the unsigned matrix and packaged-launch smoke check, while only a signed, finalized release run may publish assets. Because the release repository is private, current installers ship with automatic updates disabled and are updated manually.

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

For a single platform, use `bun run package:mac` or `bun run package:win`. CI launches the unpacked result with a loopback-only, random DevTools port and verifies that the QuantCode renderer mounts before accepting the artifact. Normal launches never expose that debug endpoint.
