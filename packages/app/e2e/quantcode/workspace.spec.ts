import { expect, test, type Page } from "@playwright/test"

// Real branded app and HTTP server, deterministic MCP responses. These prove
// browser wiring and role presentation, not SSH or production authorization.
async function mockContext(page: Page, role?: "analyst" | "approver" | "admin") {
  await page.route("**/experimental/quantcode/tool?*", async (route) => {
    const tool = new URL(route.request().url()).searchParams.get("tool")
    const payload = tool === "session_context"
      ? role ? { group: "factor", role, actor_id: "browser-fixture", workspace_id: "audit" } : { error: "Authentication required" }
      : tool === "list_skills" ? { skills: [{ id: "factor-evaluation", name: "Factor Evaluation" }] }
      : tool === "list_algorithms" ? { algorithms: [] }
      : tool === "search_memory" ? { status: "EMPTY", hits: [] }
      : tool === "list_capabilities" ? { capabilities: [] }
      : { error: "Unavailable fixture service" }
    await route.fulfill({ json: payload })
  })
}

test("unbound identity cannot submit or claim an SSH connection", async ({ page }) => {
  await mockContext(page)
  await page.goto("/")
  await expect(page.getByRole("textbox", { name: "今天研究什么？" })).toBeVisible()
  await page.getByRole("textbox", { name: "今天研究什么？" }).fill("查询可见能力")
  await expect(page.getByRole("button", { name: "开始研究", exact: true })).toBeDisabled()
  await expect(page.locator(".qc-lens-meta-row").first()).toContainText("未认证")
  await expect(page.locator(".qc-lens-meta-row").first()).not.toContainText("factor")
  await expect(page.locator(".qc-lens-meta-row").last()).not.toContainText("SSH:")
  await page.getByRole("button", { name: "QuantCode 设置", exact: true }).click()
  await expect(page.locator(".qc-setting-row").first()).toContainText("未认证")
  await expect(page.locator('input[type="password"], textarea[name*="key"]')).toHaveCount(0)
})

for (const role of ["analyst", "approver", "admin"] as const) {
  test(`${role}: bound group, published skills and scoped navigation`, async ({ page }) => {
    await mockContext(page, role)
    await page.goto("/")
    await expect(page.locator(".qc-identity")).toContainText("browser-fixture")
    await expect(page.getByRole("combobox", { name: "选择 Skill" })).toHaveValue("factor-evaluation")
    await expect(page.getByRole("button", { name: "GitGraph", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Admin 中枢", exact: true })).toHaveCount(role === "admin" ? 1 : 0)
    await expect(page.locator('select[name="group"], #qc-group')).toHaveCount(0)
    await page.getByRole("button", { name: "Memory", exact: true }).click()
    await expect(page.locator(".qc-memory-search-input")).toBeVisible()
    await page.locator(".qc-memory-search-input").fill("evaluator")
    await page.locator(".qc-memory-search-input").press("Enter")
    await expect(page.locator(".qc-memory-results")).toHaveAttribute("aria-busy", "false")
    await expect(page.locator(".qc-memory-search-input")).toBeFocused()
    await expect(page.locator(".qc-memory-hit-row")).toHaveCount(0)
    await expect(page.locator(".qc-memory-empty")).toBeVisible()
    await page.screenshot({ path: `e2e/test-results/quantcode/${role}-memory.png` })
  })
}

test("HTTP failure in memory is unavailable, never an empty success", async ({ page }) => {
  await mockContext(page, "analyst")
  await page.route("**/experimental/quantcode/tool?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tool") !== "search_memory") return route.fallback()
    await route.fulfill({ status: 503, json: { error: "Service unavailable" } })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Memory", exact: true }).click()
  await page.locator(".qc-memory-search-input").fill("evaluator")
  await page.locator(".qc-memory-search-input").press("Enter")
  await expect(page.locator(".qc-memory-results")).toHaveAttribute("aria-busy", "false")
  await expect(page.locator(".qc-memory-empty")).toContainText(/未接通|not connected/)
  await expect(page.locator(".qc-memory-hit-row")).toHaveCount(0)
})

for (const viewport of [{ width: 900, height: 650 }, { width: 1440, height: 900 }]) {
  test(`long results scroll inside an inset panel at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockContext(page, "admin")
    await page.route("**/experimental/quantcode/tool?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("tool") !== "search_memory") return route.fallback()
      await route.fulfill({ json: { status: "CONNECTED", hits: Array.from({ length: 30 }, (_, i) => ({
        path: `fixture/knowledge-${i}.md`, scope: "groups", scope_id: "factor",
        snippet: "Verified evaluator contract fixture for browser scrolling tests", score: 30 - i,
      })) } })
    })
    await page.goto("/")
    await expect(page.locator(".qc-identity")).toContainText("browser-fixture")
    await expect(page.getByRole("button", { name: "QuantCode 设置", exact: true })).toBeInViewport()
    await page.getByRole("button", { name: "Memory", exact: true }).click()
    await page.locator(".qc-memory-search-input").fill("evaluator")
    await page.locator(".qc-memory-search-input").press("Enter")
    await expect(page.locator(".qc-memory-hit-row")).toHaveCount(30)
    const panel = await page.locator(".qc-detail-panel").boundingBox()
    const input = await page.locator(".qc-memory-search-input").boundingBox()
    expect(input!.x - panel!.x).toBeGreaterThanOrEqual(20)
    expect(await page.locator(".qc-memory-query").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await page.locator(".qc-memory-hit-row").last().scrollIntoViewIfNeeded()
    await expect(page.locator(".qc-memory-hit-row").last()).toBeInViewport()
    await expect(page.getByRole("button", { name: "关闭详情", exact: true })).toBeInViewport()
    await page.screenshot({ path: `e2e/test-results/quantcode/memory-${viewport.width}.png` })
  })
}
