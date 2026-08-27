export const QUANTCODE_GROUPS = ["fundamental", "factor", "model", "risk", "strategy", "options"] as const
export type QuantCodeGroup = (typeof QUANTCODE_GROUPS)[number]

export function buildResearchInstruction(input: { task: string; group: string; skillLabel: string }) {
  return (
    "You MUST call the quantcode_run_agent MCP tool NOW. Do NOT chat. Do NOT acknowledge. " +
    `Invoke it with task: ${JSON.stringify(input.task)}, group: ${JSON.stringify(input.group)}. ` +
    `Use the ${input.skillLabel} skill when applicable.`
  )
}

export function buildResumeInstruction(threadId: string, decision: "approve" | "reject") {
  return (
    "You MUST call the quantcode_run_agent MCP tool NOW. Do NOT chat. Do NOT acknowledge. " +
    `Resume the existing HumanGate with thread_id: ${JSON.stringify(threadId)}, decision: ${JSON.stringify(decision)}. ` +
    "Do not start a new research task."
  )
}

export function buildComposePrefix(group: QuantCodeGroup) {
  return (
    "You MUST call the quantcode_run_agent MCP tool NOW. Do NOT chat. Do NOT acknowledge. Invoke the tool immediately.\n\n" +
    `Parameters:\n- task: (the task the user describes below)\n- group: ${JSON.stringify(group)}\n\n` +
    "The user's task follows. Translate it into the task parameter; do not reply in text.\n\n" +
    "=== USER TASK ===\n"
  )
}
