import { describe, expect, test } from "bun:test"
import { buildComposePrefix, buildResearchInstruction, buildResumeInstruction } from "./instructions"

describe("QuantCode run_agent instructions", () => {
  test("quotes user task and group as JSON values", () => {
    const instruction = buildResearchInstruction({
      task: 'compare "alpha"\nthen review',
      group: "risk",
      skillLabel: "Risk Review",
    })
    expect(instruction).toContain('task: "compare \\"alpha\\"\\nthen review"')
    expect(instruction).toContain('group: "risk"')
    expect(instruction).toContain("quantcode_run_agent")
  })

  test("resumes an existing HumanGate instead of starting a new task", () => {
    const instruction = buildResumeInstruction("thread-123", "approve")
    expect(instruction).toContain('thread_id: "thread-123"')
    expect(instruction).toContain('decision: "approve"')
    expect(instruction).toContain("Do not start a new research task")
  })

  test("builds the slash-command prefix from the shared group contract", () => {
    const prefix = buildComposePrefix("factor")
    expect(prefix).toContain('group: "factor"')
    expect(prefix).toEndWith("=== USER TASK ===\n")
  })
})
