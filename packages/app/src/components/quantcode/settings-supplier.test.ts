import { describe, expect, test } from "bun:test"
import { SupplierView } from "./settings-supplier"

describe("SupplierView", () => {
  test("renders default provider/model/baseURL when props omitted", () => {
    const el = SupplierView({})
    const values = [...el.querySelectorAll(".qc-supplier-row strong")].map((n) => n.textContent)
    expect(values).toEqual(["deepseek", "deepseek-chat", "https://api.deepseek.com/v1"])
    el.remove()
  })

  test("renders custom values when props provided", () => {
    const el = SupplierView({ provider: "moonshot", model: "kimi-k2", baseUrl: "https://api.moonshot.cn/v1" })
    const values = [...el.querySelectorAll(".qc-supplier-row strong")].map((n) => n.textContent)
    expect(values).toEqual(["moonshot", "kimi-k2", "https://api.moonshot.cn/v1"])
    el.remove()
  })

  test("labels rows with env config names and shows env hint", () => {
    const el = SupplierView({})
    const names = [...el.querySelectorAll(".qc-supplier-row code")].map((n) => n.textContent)
    expect(names).toEqual([
      "QUANTCODE_MODEL_PROVIDER",
      "QUANTCODE_MODEL_NAME",
      "QUANTCODE_MODEL_BASE_URL",
    ])
    expect(el.querySelector(".qc-supplier-hint")?.textContent).toContain("mcp.environment")
    el.remove()
  })

  test("shows algorithms empty state for empty list", () => {
    const el = SupplierView({})
    expect(el.querySelector(".qc-section-label")?.textContent).toBe("ALGORITHMS")
    expect(el.querySelector(".qc-supplier-empty")?.textContent).toContain("list_algorithms")
    el.remove()
  })
})