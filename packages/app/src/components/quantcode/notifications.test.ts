import { describe, expect, test } from "bun:test"
import { NotificationsBell, NotificationsPanel, pendingNotifications } from "./notifications"
import type { RunAgentResult } from "./result-contract"

function waiting(threadId: string, timestamp = 1725148800): RunAgentResult {
  return {
    status: "waiting_for_human",
    thread_id: threadId,
    timestamp,
    gate: { kind: "risk", reasons: ["max_drawdown_breach"] },
    execution_trace: [{ type: "agent_start", seq: 0, data: { task: `研究任务 ${threadId.slice(0, 8)}` } }],
  }
}

describe("pendingNotifications", () => {
  test("no waiting_for_human runs → empty list (bell shows zero badge)", () => {
    expect(pendingNotifications([{ status: "completed", thread_id: "t1", timestamp: 1725148800 }], null)).toEqual([])
    const bell = NotificationsBell({ count: 0, onClick: () => {} })
    expect(bell.querySelector(".qc-rail-notif-badge")).toBeNull()
    bell.remove()
  })

  test("counts waiting_for_human runs from history except current trace thread, and adds the current trace gate itself", () => {
    const history = [waiting("t-old"), waiting("t-current"), { status: "completed", thread_id: "t-done" }]
    const trace = waiting("t-current")
    const items = pendingNotifications(history, trace)
    expect(items.length).toBe(2)
    expect(items.map((item) => item.thread_id)).toEqual(["t-old", "t-current"])
    const bell = NotificationsBell({ count: items.length, onClick: () => {} })
    expect(bell.querySelector(".qc-rail-notif-badge")?.textContent).toBe("2")
    bell.remove()
  })

  test("items carry task summary, human-readable time and waiting status", () => {
    const items = pendingNotifications([waiting("abcdefgh12", 1725148800)], null)
    expect(items[0]!.task).toBe("研究任务 abcdefgh")
    expect(items[0]!.status).toBe("待审批")
    expect(items[0]!.time).not.toBe("")
    expect(typeof items[0]!.time).toBe("string")
  })

  test("NotificationsPanel lists items with 去审批 action, empty state when cleared", () => {
    const panel = NotificationsPanel({ items: pendingNotifications([waiting("abcdefgh12")], null), onClose: () => {}, onApprove: () => {} })
    expect(panel.getAttribute("role")).toBe("dialog")
    expect(panel.querySelectorAll(".qc-notif-item").length).toBe(1)
    expect(panel.textContent).toContain("去审批")
    panel.remove()
    const empty = NotificationsPanel({ items: [], onClose: () => {}, onApprove: () => {} })
    expect(empty.querySelectorAll(".qc-notif-item").length).toBe(0)
    expect(empty.textContent).toContain("没有待处理")
    empty.remove()
  })

  test("clicking 去审批 fires onApprove with the thread id", () => {
    let approved = ""
    const panel = NotificationsPanel({ items: pendingNotifications([waiting("t-approve-me")], null), onClose: () => {}, onApprove: (id) => (approved = id) })
    ;(panel.querySelector(".qc-notif-item") as HTMLElement).click()
    expect(approved).toBe("t-approve-me")
    panel.remove()
  })
})