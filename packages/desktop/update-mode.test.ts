import { describe, expect, test } from "bun:test"
import { resolveQuantCodeUpdateMode } from "./update-mode"

const empty = {}

describe("QuantCode updater trust mode", () => {
  test("requires an explicit opt-in for unsigned local updates", () => {
    expect(resolveQuantCodeUpdateMode(empty, "darwin")).toBe("disabled")
    expect(resolveQuantCodeUpdateMode({ QUANTCODE_UNSIGNED_BUILD: "true" }, "darwin")).toBe("unsigned")
  })

  test("selects signed mode from an explicit release flag", () => {
    expect(resolveQuantCodeUpdateMode({ QUANTCODE_SIGNED_RELEASE: "true" }, "win32")).toBe("signed")
  })

  test("selects signed mode from complete platform credentials", () => {
    expect(
      resolveQuantCodeUpdateMode(
        {
          APPLE_CERTIFICATE: "p12",
          APPLE_CERTIFICATE_PASSWORD: "password",
          APPLE_API_KEY_CONTENT: "p8",
          APPLE_API_KEY_ID: "key-id",
          APPLE_API_ISSUER: "issuer",
        },
        "darwin",
      ),
    ).toBe("signed")
    expect(
      resolveQuantCodeUpdateMode(
        {
          AZURE_CLIENT_ID: "client",
          AZURE_TENANT_ID: "tenant",
          AZURE_SUBSCRIPTION_ID: "subscription",
          AZURE_TRUSTED_SIGNING_ACCOUNT_NAME: "account",
          AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE: "profile",
          AZURE_TRUSTED_SIGNING_ENDPOINT: "https://example.test",
        },
        "win32",
      ),
    ).toBe("signed")
  })

  test("credentials take precedence over the unsigned fallback", () => {
    expect(
      resolveQuantCodeUpdateMode(
        {
          QUANTCODE_UNSIGNED_BUILD: "true",
          AZURE_CLIENT_ID: "client",
          AZURE_TENANT_ID: "tenant",
          AZURE_SUBSCRIPTION_ID: "subscription",
          AZURE_TRUSTED_SIGNING_ACCOUNT_NAME: "account",
          AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE: "profile",
          AZURE_TRUSTED_SIGNING_ENDPOINT: "https://example.test",
        },
        "win32",
      ),
    ).toBe("signed")
  })
})
