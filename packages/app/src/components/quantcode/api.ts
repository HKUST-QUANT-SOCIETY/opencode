import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { SshConnectFn } from "./ssh-login"

export type QuantCodeToolName = "list_skills" | "ssh_status" | "list_capabilities" | "list_algorithms"

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

export type QuantCodeSshStatus = {
  configured?: boolean
  servers?: { name?: string; host?: string; port?: number; user?: string }[]
  group_bindings_ready?: boolean
  group_bindings_count?: number
  error?: string
}

export async function readQuantCodeTool(
  client: OpencodeClient,
  tool: QuantCodeToolName,
  group?: string,
): Promise<unknown> {
  const response = await client.quantcode.tool.readOnly({
    tool,
    ...(group ? { group } : {}),
  })
  return response.data
}

export async function listQuantCodeSkills(client: OpencodeClient, group: string) {
  const result = (await readQuantCodeTool(client, "list_skills", group)) as QuantCodeSkillsResult | undefined
  if (result?.error) throw new Error(result.error)
  return result?.skills?.filter((skill) => typeof skill.id === "string" && skill.id.trim()) ?? []
}

export async function listQuantCodeAlgorithms(client: OpencodeClient) {
  const result = (await readQuantCodeTool(client, "list_algorithms")) as QuantCodeAlgorithmsResult | undefined
  if (result?.error) throw new Error(result.error)
  return result?.algorithms?.filter((algorithm) => typeof algorithm.id === "string" && algorithm.id.trim()) ?? []
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
