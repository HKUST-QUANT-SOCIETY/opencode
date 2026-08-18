#!/usr/bin/env bun

import { $ } from "bun"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "path"

const dir = process.env.LATEST_YML_DIR!
if (!dir) throw new Error("LATEST_YML_DIR is required")

const version = process.env.OPENCODE_VERSION
if (!version) throw new Error("OPENCODE_VERSION is required")

const releaseAssetDir = process.env.RELEASE_ASSET_DIR
const upload = process.env.UPLOAD_RELEASE_METADATA !== "false"

type FileEntry = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

type LatestYml = {
  version: string
  files: FileEntry[]
  releaseDate: string
}

function parse(content: string): LatestYml {
  const lines = content.split("\n")
  let version = ""
  let releaseDate = ""
  const files: FileEntry[] = []
  let current: Partial<FileEntry> | undefined

  const flush = () => {
    if (current?.url && current.sha512 && current.size) files.push(current as FileEntry)
    current = undefined
  }

  for (const line of lines) {
    const indented = line.startsWith("    ") || line.startsWith("  -")
    if (line.startsWith("version:")) version = line.slice("version:".length).trim()
    else if (line.startsWith("releaseDate:"))
      releaseDate = line.slice("releaseDate:".length).trim().replace(/^'|'$/g, "")
    else if (line.trim().startsWith("- url:")) {
      flush()
      current = { url: line.trim().slice("- url:".length).trim() }
    } else if (indented && current && line.trim().startsWith("sha512:"))
      current.sha512 = line.trim().slice("sha512:".length).trim()
    else if (indented && current && line.trim().startsWith("size:"))
      current.size = Number(line.trim().slice("size:".length).trim())
    else if (indented && current && line.trim().startsWith("blockMapSize:"))
      current.blockMapSize = Number(line.trim().slice("blockMapSize:".length).trim())
    else if (!indented && current) flush()
  }
  flush()

  return { version, files, releaseDate }
}

function serialize(data: LatestYml) {
  const lines = [`version: ${data.version}`, "files:"]
  for (const file of data.files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    lines.push(`    size: ${file.size}`)
    if (file.blockMapSize) lines.push(`    blockMapSize: ${file.blockMapSize}`)
  }
  lines.push(`releaseDate: '${data.releaseDate}'`)
  return lines.join("\n") + "\n"
}

async function read(subdir: string, filename: string): Promise<LatestYml | undefined> {
  const file = Bun.file(path.join(dir, subdir, filename))
  if (!(await file.exists())) return undefined
  return parse(await file.text())
}

type RequiredTarget = {
  metadata: string
  updaterSuffixes: string[]
  assetSuffixes: string[]
}

const requiredTargetSpecs: Record<string, RequiredTarget> = {
  "aarch64-apple-darwin": {
    metadata: "latest-mac.yml",
    updaterSuffixes: ["-mac-arm64.zip", "-mac-arm64.dmg"],
    assetSuffixes: ["-mac-arm64.zip", "-mac-arm64.zip.blockmap", "-mac-arm64.dmg", "-mac-arm64.dmg.blockmap"],
  },
  "x86_64-apple-darwin": {
    metadata: "latest-mac.yml",
    updaterSuffixes: ["-mac-x64.zip", "-mac-x64.dmg"],
    assetSuffixes: ["-mac-x64.zip", "-mac-x64.zip.blockmap", "-mac-x64.dmg", "-mac-x64.dmg.blockmap"],
  },
  "x86_64-pc-windows-msvc": {
    metadata: "latest.yml",
    updaterSuffixes: ["-win-x64.exe"],
    assetSuffixes: ["-win-x64.exe", "-win-x64.exe.blockmap"],
  },
}

const requiredTargets = (process.env.REQUIRED_TARGETS ?? "")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean)

const requiredMetadata = new Map<string, LatestYml>()

for (const target of requiredTargets) {
  const spec = requiredTargetSpecs[target]
  if (!spec) throw new Error(`Unknown required updater target: ${target}`)

  const metadata = await read(`latest-yml-${target}`, spec.metadata)
  if (!metadata) {
    throw new Error(`Missing updater metadata for ${target}: ${spec.metadata}`)
  }
  if (metadata.version !== version) {
    throw new Error(`Updater metadata version mismatch for ${target}: expected ${version}, got ${metadata.version}`)
  }

  for (const suffix of spec.updaterSuffixes) {
    const filename = `quantcode-${version}${suffix}`
    if (!metadata.files.some((file) => file.url === filename)) {
      throw new Error(`Updater metadata for ${target} is missing ${filename}`)
    }
  }

  requiredMetadata.set(target, metadata)
}

if (releaseAssetDir) await validateReleaseAssets(releaseAssetDir, requiredTargets, requiredMetadata)

const output: Record<string, string> = {}

// Windows: merge arm64 + x64 into single file
const winX64 = await read("latest-yml-x86_64-pc-windows-msvc", "latest.yml")
const winArm64 = await read("latest-yml-aarch64-pc-windows-msvc", "latest.yml")
if (winX64 || winArm64) {
  const base = winArm64 ?? winX64!
  output["latest.yml"] = serialize({
    version: base.version,
    files: [...(winArm64?.files ?? []), ...(winX64?.files ?? [])],
    releaseDate: base.releaseDate,
  })
}

// Linux x64: pass through
const linuxX64 = await read("latest-yml-x86_64-unknown-linux-gnu", "latest-linux.yml")
if (linuxX64) output["latest-linux.yml"] = serialize(linuxX64)

// Linux arm64: pass through
const linuxArm64 = await read("latest-yml-aarch64-unknown-linux-gnu", "latest-linux-arm64.yml")
if (linuxArm64) output["latest-linux-arm64.yml"] = serialize(linuxArm64)

// macOS: merge arm64 + x64 into single file
const macX64 = await read("latest-yml-x86_64-apple-darwin", "latest-mac.yml")
const macArm64 = await read("latest-yml-aarch64-apple-darwin", "latest-mac.yml")
if (macX64 || macArm64) {
  const base = macArm64 ?? macX64!
  output["latest-mac.yml"] = serialize({
    version: base.version,
    files: [...(macArm64?.files ?? []), ...(macX64?.files ?? [])],
    releaseDate: base.releaseDate,
  })
}

// Upload to release
// OpenCode's release tags use `v<version>`, while QuantCode uses
// `quantcode-v<version>`. Keep the existing default and let alternate
// channels provide their exact tag without duplicating this merger.
const tag = process.env.RELEASE_TAG || `v${version}`
const outputDir = process.env.FINALIZED_YML_DIR ?? process.env.RUNNER_TEMP ?? "/tmp"
await mkdir(outputDir, { recursive: true })

const generated: string[] = []

for (const [filename, content] of Object.entries(output)) {
  const filepath = path.join(outputDir, filename)
  await Bun.write(filepath, content)
  generated.push(filepath)
}

if (releaseAssetDir) {
  const files = [
    ...(await readdir(releaseAssetDir)).map((filename) => path.join(releaseAssetDir, filename)),
    ...generated,
  ]
  const checksums = await Promise.all(
    files
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
      .map(async (file) => `${await digest(file, "sha256", "hex")}  ${path.basename(file)}`),
  )
  const filepath = path.join(outputDir, "SHA256SUMS")
  await Bun.write(filepath, checksums.join("\n") + "\n")
  generated.push(filepath)
}

if (upload) {
  const repo = process.env.GH_REPO
  if (!repo) throw new Error("GH_REPO is required when UPLOAD_RELEASE_METADATA is enabled")
  for (const filepath of generated) {
    await $`gh release upload ${tag} ${filepath} --clobber --repo ${repo}`
    console.log(`uploaded ${path.basename(filepath)}`)
  }
}

console.log("finalized latest yml files")

async function validateReleaseAssets(assetDir: string, targets: string[], metadataByTarget: Map<string, LatestYml>) {
  const expected = targets
    .flatMap((target) => requiredTargetSpecs[target].assetSuffixes)
    .map((suffix) => `quantcode-${version}${suffix}`)
    .sort()
  const actual = (await readdir(assetDir)).sort()
  const missing = expected.filter((filename) => !actual.includes(filename))
  const unexpected = actual.filter((filename) => !expected.includes(filename))

  if (missing.length > 0) throw new Error(`Missing release assets: ${missing.join(", ")}`)
  if (unexpected.length > 0) throw new Error(`Unexpected release assets: ${unexpected.join(", ")}`)

  for (const target of targets) {
    const spec = requiredTargetSpecs[target]
    const metadata = metadataByTarget.get(target)!
    for (const suffix of spec.updaterSuffixes) {
      const filename = `quantcode-${version}${suffix}`
      const entry = metadata.files.find((file) => file.url === filename)!
      const filepath = path.join(assetDir, filename)
      const size = (await stat(filepath)).size
      if (entry.size !== size) {
        throw new Error(`Updater metadata size mismatch for ${filename}: expected ${size}, got ${entry.size}`)
      }

      const sha512 = await digest(filepath, "sha512", "base64")
      if (entry.sha512 !== sha512) throw new Error(`Updater metadata SHA-512 mismatch for ${filename}`)
    }
  }
}

async function digest(file: string, algorithm: "sha256" | "sha512", encoding: "hex" | "base64") {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}
