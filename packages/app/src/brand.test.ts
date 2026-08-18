import { describe, expect, test } from "bun:test"
import { resolveBrand } from "./brand"

describe("QuantCode brand", () => {
  test("uses QuantCode identity and GitHub feedback", () => {
    expect(resolveBrand("quantcode")).toEqual({
      isQuantCode: true,
      name: "QuantCode",
      icon: "/quantcode-icon.png",
      feedbackUrl: "https://github.com/HKUST-QUANT-SOCIETY/quantcode/issues",
      feedbackLabel: "在 GitHub 上",
      feedbackIcon: "github",
    })
  })

  test("rewrites document branding for the QuantCode channel", async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = "quantcode"
    const plugins = (await import("../vite.js" + "?quantcode-brand-test")).default as unknown[]
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    if (previous !== undefined) process.env.OPENCODE_CHANNEL = previous

    const plugin = plugins.find(
      (item) => item && typeof item === "object" && "name" in item && item.name === "opencode-desktop:theme-preload",
    )
    if (
      !plugin ||
      typeof plugin !== "object" ||
      !("transformIndexHtml" in plugin) ||
      typeof plugin.transformIndexHtml !== "function"
    ) {
      throw new Error("QuantCode title transform is missing")
    }

    const html = plugin.transformIndexHtml(`
      <html>
        <head>
          <title>OpenCode</title>
          <link rel="icon" type="image/png" href="/favicon-96x96-v3.png" sizes="96x96" />
          <link rel="icon" type="image/svg+xml" href="/favicon-v3.svg" />
          <link rel="shortcut icon" href="/favicon-v3.ico" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v3.png" />
          <script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>
        </head>
      </html>
    `)
    expect(html).toContain("<title>QuantCode</title>")
    expect(html).toContain('href="/quantcode-icon.png"')
    expect(html).not.toContain("favicon-v3")
    expect(html).not.toContain("apple-touch-icon-v3")
  })
})
