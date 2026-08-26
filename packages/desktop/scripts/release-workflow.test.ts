import { describe, expect, test } from "bun:test"

const root = new URL("../../..", import.meta.url).pathname
const workflow = await Bun.file(`${root}/.github/workflows/quantcode-desktop.yml`).text()
const action = await Bun.file(`${root}/.github/actions/build-quantcode-desktop/action.yml`).text()

describe("QuantCode desktop release workflow contract", () => {
  test("serializes and safely resumes publication by release tag", () => {
    expect(workflow).toContain("group: quantcode-release-${{ needs.version.outputs.tag }}")
    expect(workflow).toContain("already_published=true")
    expect(workflow).toContain("if: steps.stage.outputs.already_published != 'true'")
    expect(workflow).toContain('[[ "$draft" == "false" ]]')
  })

  test("supports signed artifact validation without forcing publication", () => {
    expect(workflow).toContain("sign:")
    expect(workflow).toContain("if: needs.version.outputs.sign == 'true'")
    expect(workflow).toContain('if [[ "$publish" == "true" ]]; then sign=true; fi')
    expect(workflow).toContain("needs.version.outputs.publish == 'true'")
  })

  test("attests finalized installer provenance in the public source repository", () => {
    expect(workflow).toContain("attestations: write")
    expect(workflow).toContain("id-token: write")
    expect(workflow).toContain("actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d")
    expect(workflow).toContain("release-assets/*")
    expect(workflow).toContain("release-finalized/*")
  })

  test("runs package-level smoke and content checks on every platform", () => {
    expect(action).toContain("hdiutil attach -nobrowse -readonly")
    expect(action).toContain('Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installRoot")')
    expect(action).toContain("--appimage-extract")
    expect(action).toContain("dpkg-deb --contents")
    expect(action).toContain("rpm -qlp")
  })

  test("rebuilds installers for changes anywhere in the workspace dependency graph", () => {
    expect(workflow).toContain('- "packages/**"')
    expect(workflow).toContain('- "script/sign-windows.ps1"')
  })
})
