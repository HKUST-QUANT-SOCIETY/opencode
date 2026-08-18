import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const script = path.join(import.meta.dir, "finalize-latest-yml.ts")

const metadata = (url: string, sha512: string) =>
  `version: 1.2.3\nfiles:\n  - url: ${url}\n    sha512: ${sha512}\n    size: 123\nreleaseDate: '2026-08-19T00:00:00.000Z'\n`

test("merges macOS updater metadata and honors the release tag", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quantcode-latest-yml-"))
  const metadataRoot = path.join(root, "metadata")
  const runnerTemp = path.join(root, "runner-temp")
  const bin = path.join(root, "bin")
  const captureDir = path.join(root, "captured")
  const log = path.join(root, "gh.log")

  try {
    await Promise.all([
      mkdir(path.join(metadataRoot, "latest-yml-aarch64-apple-darwin"), { recursive: true }),
      mkdir(path.join(metadataRoot, "latest-yml-x86_64-apple-darwin"), { recursive: true }),
      mkdir(path.join(metadataRoot, "latest-yml-x86_64-pc-windows-msvc"), { recursive: true }),
      mkdir(runnerTemp, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(captureDir, { recursive: true }),
    ])

    await Bun.write(
      path.join(metadataRoot, "latest-yml-aarch64-apple-darwin", "latest-mac.yml"),
      metadata("quantcode-1.2.3-mac-arm64.dmg", "arm-sha"),
    )
    await Bun.write(
      path.join(metadataRoot, "latest-yml-x86_64-apple-darwin", "latest-mac.yml"),
      metadata("quantcode-1.2.3-mac-x64.dmg", "x64-sha"),
    )
    await Bun.write(
      path.join(metadataRoot, "latest-yml-x86_64-pc-windows-msvc", "latest.yml"),
      metadata("quantcode-1.2.3-win-x64.exe", "win-sha"),
    )

    const gh = path.join(bin, "gh")
    const ghScript = [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    *.yml) cp "$arg" "$GH_CAPTURE_DIR/$(basename "$arg")" ;;',
      "  esac",
      "done",
      'printf "%s\\n" "$*" >> "$GH_LOG"',
      "",
    ].join("\n")
    await Bun.write(gh, ghScript)
    await chmod(gh, 0o755)

    const child = Bun.spawn(["bun", script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        LATEST_YML_DIR: metadataRoot,
        GH_REPO: "HKUST-QUANT-SOCIETY/quantcode",
        OPENCODE_VERSION: "1.2.3",
        RELEASE_TAG: "quantcode-v1.2.3",
        REQUIRED_TARGETS: "aarch64-apple-darwin,x86_64-apple-darwin,x86_64-pc-windows-msvc",
        RUNNER_TEMP: runnerTemp,
        GH_CAPTURE_DIR: captureDir,
        GH_LOG: log,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("uploaded latest-mac.yml")

    const merged = await Bun.file(path.join(captureDir, "latest-mac.yml")).text()
    expect(merged).toContain("quantcode-1.2.3-mac-arm64.dmg")
    expect(merged).toContain("quantcode-1.2.3-mac-x64.dmg")
    expect(merged.indexOf("mac-arm64")).toBeLessThan(merged.indexOf("mac-x64"))

    const windows = await Bun.file(path.join(captureDir, "latest.yml")).text()
    expect(windows).toContain("quantcode-1.2.3-win-x64.exe")

    const ghArgs = await Bun.file(log).text()
    expect(ghArgs).toContain("quantcode-v1.2.3")
    expect(ghArgs).not.toContain(" v1.2.3 ")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("fails closed when a required target metadata file is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quantcode-latest-yml-missing-"))
  const metadataRoot = path.join(root, "metadata")

  try {
    await mkdir(path.join(metadataRoot, "latest-yml-aarch64-apple-darwin"), { recursive: true })
    await Bun.write(
      path.join(metadataRoot, "latest-yml-aarch64-apple-darwin", "latest-mac.yml"),
      metadata("quantcode-1.2.3-mac-arm64.dmg", "arm-sha"),
    )

    const child = Bun.spawn(["bun", script], {
      env: {
        ...process.env,
        LATEST_YML_DIR: metadataRoot,
        GH_REPO: "HKUST-QUANT-SOCIETY/quantcode",
        OPENCODE_VERSION: "1.2.3",
        REQUIRED_TARGETS: "aarch64-apple-darwin,x86_64-pc-windows-msvc",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("Missing updater metadata for x86_64-pc-windows-msvc")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
