import { describe, expect, test } from "bun:test"
import { isAdminRole, resolveRole } from "./roles"

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

  test("admin / 管理员 / root identities map to admin (F-09 admin console visibility)", () => {
    expect(resolveRole("admin-zhang")).toBe("admin")
    expect(resolveRole("管理员")).toBe("admin")
    expect(resolveRole("root")).toBe("admin")
    expect(isAdminRole("admin-zhang")).toBe(true)
  })

  test("approver and analyst identities are not admin", () => {
    expect(isAdminRole("risk-wang")).toBe(false)
    expect(isAdminRole("researcher-chen")).toBe(false)
    expect(isAdminRole("")).toBe(false)
  })
})