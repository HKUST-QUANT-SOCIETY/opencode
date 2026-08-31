import { describe, expect, test } from "bun:test"
import { resolveRole } from "./roles"

describe("QuantCode roles", () => {
  test("risk / 风控 / lead identities map to approver", () => {
    expect(resolveRole("risk-wang")).toBe("approver")
    expect(resolveRole("风控负责人")).toBe("approver")
    expect(resolveRole("Lead Zhang")).toBe("approver")
  })

  test("ordinary identities map to analyst", () => {
    expect(resolveRole("Quant Society Member")).toBe("analyst")
    expect(resolveRole("researcher-chen")).toBe("analyst")
  })

  test("empty identity falls back to analyst", () => {
    expect(resolveRole("")).toBe("analyst")
  })
})