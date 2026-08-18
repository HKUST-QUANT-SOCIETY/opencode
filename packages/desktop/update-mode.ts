export type QuantCodeUpdateMode = "signed" | "unsigned" | "disabled"

type Environment = Record<string, string | undefined>

const hasValues = (environment: Environment, keys: string[]) => keys.every((key) => Boolean(environment[key]))

/**
 * Resolve the update trust mode while packaging. The result is compiled into
 * the main process so an installed app never depends on the build host's env.
 * An unsigned update path must be explicitly requested for local testing.
 */
export function resolveQuantCodeUpdateMode(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): QuantCodeUpdateMode {
  if (environment.QUANTCODE_SIGNED_RELEASE === "true") return "signed"

  const appleSigning = hasValues(environment, [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_API_KEY_CONTENT",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
  ])
  const windowsSigning = hasValues(environment, [
    "AZURE_CLIENT_ID",
    "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
    "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE",
    "AZURE_TRUSTED_SIGNING_ENDPOINT",
    "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME",
  ])

  if ((platform === "darwin" && appleSigning) || (platform === "win32" && windowsSigning)) return "signed"
  if (environment.QUANTCODE_UNSIGNED_BUILD === "true") return "unsigned"
  // Linux packages use electron-updater's SHA-512 metadata rather than
  // platform code signing. Keep the updater available for signed releases;
  // AppImage/DEB/RPM publication still happens only through the release job.
  if (platform === "linux") return "signed"
  return "disabled"
}
