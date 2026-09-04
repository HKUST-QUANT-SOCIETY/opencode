import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { SshConnectFn } from "./ssh-login"
import type { CapabilityCard } from "./capability-catalog"

export type QuantCodeToolName =
  | "search_memory"
  | "list_capabilities"
  | "list_skills"
  | "ssh_status"
  | "list_algorithms"
  | "session_context"

export type QuantCodeSkill = {
  id: string
  name?: string
  description?: string
  pattern?: string
}

export type QuantCodeSkillsResult = {
  group?: string
  skills?: QuantCodeSkill[]
  error?: string
}

export type QuantCodeAlgorithm = { id: string; description?: string }

export type QuantCodeAlgorithmsResult = {
  algorithms?: QuantCodeAlgorithm[]
  error?: string
}

export type QuantCodeMemoryHit = {
  path?: string
  scope?: string
  scope_id?: string
  type?: string
  snippet?: string
  score?: number
}

export type QuantCodeMemoryResult = {
  status?: string
  hits?: QuantCodeMemoryHit[]
  error?: string
}

export type QuantCodeCapabilitiesResult = {
  status?: string
  capabilities?: CapabilityCard[]
  error?: string
}

export type QuantCodeSshStatus = {
  configured?: boolean
  servers?: { name?: string; host?: string; port?: number; user?: string }[]
  group_bindings_ready?: boolean
  group_bindings_count?: number
  error?: string
}

export type QuantCodeSessionContext = {
  session_id?: string
  group?: string
  role?: string
  actor_id?: string
  workspace_id?: string
  workspace_path?: string
  github_subject?: string
  resource_scopes?: string[]
  identity_source?: string
  error?: string
}

export async function readQuantCodeTool(
  client: OpencodeClient,
  tool: QuantCodeToolName,
  group?: string,
  params?: { query?: string; limit?: number },
): Promise<unknown> {
  const response = await client.quantcode.tool.readOnly({
    tool,
    ...(group ? { group } : {}),
    ...(params?.query ? { query: params.query } : {}),
    ...(params?.limit ? { limit: String(params.limit) } : {}),
  })
  return response.data
}

export async function listQuantCodeSkills(client: OpencodeClient, group: string) {
  const result = (await readQuantCodeTool(client, "list_skills", group)) as QuantCodeSkillsResult | undefined
  if (result?.error) throw new Error(result.error)
  return result?.skills?.filter((skill) => typeof skill.id === "string" && skill.id.trim()) ?? []
}

export async function searchQuantCodeMemory(client: OpencodeClient, query: string, limit = 10) {
  const result = (await readQuantCodeTool(client, "search_memory", undefined, { query, limit })) as
    | QuantCodeMemoryResult
    | undefined
  if (result?.error && result.status === "UNAVAILABLE") return null
  if (result?.error) throw new Error(result.error)
  return {
    hits: (result?.hits ?? []).map((hit) => ({
      id: hit.path,
      title: hit.path?.split("/").pop() ?? "Memory",
      snippet: hit.snippet,
      score: hit.score,
      scope: hit.scope_id ? `${hit.scope}/${hit.scope_id}` : hit.scope,
    })),
  }
}

export async function listQuantCodeAlgorithms(client: OpencodeClient) {
  const result = (await readQuantCodeTool(client, "list_algorithms")) as QuantCodeAlgorithmsResult | undefined
  if (result?.error) throw new Error(result.error)
  return result?.algorithms?.filter((algorithm) => typeof algorithm.id === "string" && algorithm.id.trim()) ?? []
}

export async function listQuantCodeCapabilities(client: OpencodeClient) {
  const result = (await readQuantCodeTool(client, "list_capabilities")) as QuantCodeCapabilitiesResult | undefined
  if (result?.error) throw new Error(result.error)
  return result?.capabilities ?? []
}

export async function getQuantCodeSessionContext(client: OpencodeClient) {
  const result = (await readQuantCodeTool(client, "session_context")) as QuantCodeSessionContext | undefined
  if (result?.error) throw new Error(result.error)
  if (!result?.group) throw new Error("QuantCode session context has no bound group")
  return result
}

/**
 * ssh_status is deliberately read-only: it reports configured identities but
 * does not claim that a network probe or private-key authentication happened.
 */
export function createSshStatusConnect(client: OpencodeClient): SshConnectFn {
  return async ({ log }) => {
    const result = (await readQuantCodeTool(client, "ssh_status")) as QuantCodeSshStatus | undefined
    const servers = result?.servers ?? []
    if (servers.length > 0) {
      log(`ssh_status: ${servers.length} configured server${servers.length === 1 ? "" : "s"}`)
    }
    log("ssh_status is read-only; network connection probing is not available")
    return {
      status: "error",
      reason: "unavailable",
    }
  }
}
