/**
 * 会话内通知中心 v0：铃铛 + 待审批通知面板。
 * 与 metric-cards 相同的 bun test 兼容策略：纯 DOM 构建、无 Solid 响应式、无 JSX；
 * 数据源由 panels.tsx 在响应式 JSX 子表达式中传入（_threadHistory / _trace 既有 signal）。
 */
import type { RunAgentResult } from "./result-contract"

export type QcNotification = {
  thread_id: string
  task: string
  time: string
  status: string
}

const BADGE_STYLE =
  "position:absolute;top:5px;right:7px;min-width:15px;height:15px;padding:0 4px;display:grid;place-items:center;" +
  "background:#ff654f;color:#fff;border:1px solid #111;border-radius:999px;font-size:8px;font-weight:700;" +
  'font-family:"SFMono-Regular",Consolas,monospace;line-height:1;box-sizing:border-box;'
const PANEL_STYLE =
  "position:fixed;left:68px;top:70px;width:340px;max-height:60vh;overflow:auto;z-index:60;display:flex;" +
  "flex-direction:column;gap:4px;padding:14px;background:rgba(248,247,243,0.98);color:#121212;font-size:12px;" +
  'text-align:left;border:1px solid rgba(18,18,18,0.2);border-radius:14px;box-shadow:0 24px 80px rgba(18,18,18,0.22);'
const ROW_STYLE =
  "display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px;padding:10px 8px;" +
  "background:transparent;border:0;border-bottom:1px solid rgba(18,18,18,0.09);cursor:pointer;text-align:left;"
const BELL_PATH =
  '<path d="M10 3.1a4.9 4.9 0 0 0-4.9 4.9v2.9L3.5 13.9h13l-1.6-3V8A4.9 4.9 0 0 0 10 3.1Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>' +
  '<path d="M8.3 16.2a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>'

// ponytail: 与 panels.tsx 的 taskFromRun/formatTime 小段重复；等通知与 history 面板共源后再抽公共 util
function taskLabel(run: RunAgentResult) {
  const event = run.execution_trace?.find((item) => item.type === "agent_start")
  const task = event?.data?.task
  return typeof task === "string" && task.trim() ? task : `研究任务 ${run.thread_id?.slice(0, 8) ?? "untitled"}`
}

function relativeTime(timestamp?: number) {
  if (!timestamp) return "刚刚"
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" })
}

/** 未读集合 = 历史中 waiting_for_human（排除当前 trace 线程）+ 当前 trace 的 gate 等待。 */
export function pendingNotifications(history: RunAgentResult[], trace: RunAgentResult | null): QcNotification[] {
  const current = trace?.thread_id
  const pending = history.filter((run) => run.status === "waiting_for_human" && run.thread_id && run.thread_id !== current)
  if (trace?.status === "waiting_for_human" && trace.thread_id) pending.push(trace)
  return pending.map((run) => ({
    thread_id: run.thread_id!,
    task: taskLabel(run),
    time: relativeTime(run.timestamp),
    status: "待审批",
  }))
}

export function NotificationsBell(props: { count: number; onClick: () => void }): HTMLElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "qc-rail-button"
  button.title = "研究通知"
  button.setAttribute("aria-haspopup", "dialog")
  button.setAttribute("aria-label", props.count > 0 ? `研究通知（${props.count} 条待审批）` : "研究通知")
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("width", "18")
  svg.setAttribute("height", "18")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = BELL_PATH
  button.append(svg)
  if (props.count > 0) {
    const badge = document.createElement("span")
    badge.className = "qc-rail-notif-badge"
    badge.setAttribute("style", BADGE_STYLE)
    badge.textContent = String(props.count)
    button.append(badge)
  }
  button.addEventListener("click", props.onClick)
  return button
}

export function NotificationsPanel(props: {
  items: QcNotification[]
  onClose: () => void
  onApprove: (threadId: string) => void
}): HTMLElement {
  const panel = document.createElement("div")
  panel.className = "qc-notif-panel"
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-label", "研究通知中心")
  panel.setAttribute("style", PANEL_STYLE)
  const head = document.createElement("div")
  head.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;")
  const label = document.createElement("span")
  label.className = "qc-section-label"
  label.textContent = props.items.length ? `通知 · ${props.items.length} 条待审批` : "通知"
  const close = document.createElement("button")
  close.type = "button"
  close.className = "qc-text-button"
  close.setAttribute("aria-label", "关闭通知")
  close.textContent = "关闭"
  close.addEventListener("click", props.onClose)
  head.append(label, close)
  panel.append(head)
  if (!props.items.length) {
    const empty = document.createElement("p")
    empty.setAttribute("style", "margin:6px 0 0;color:#8b8984;font-size:11px;")
    empty.textContent = "没有待处理的审批，研究推进正常。"
    panel.append(empty)
    return panel
  }
  for (const item of props.items) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "qc-notif-item"
    row.setAttribute("style", ROW_STYLE)
    const task = document.createElement("strong")
    task.setAttribute("style", "overflow:hidden;font-size:11px;font-weight:600;text-overflow:ellipsis;white-space:nowrap;")
    task.textContent = item.task
    const status = document.createElement("span")
    status.className = "qc-status qc-status-waiting_for_human"
    status.textContent = item.status
    const meta = document.createElement("small")
    meta.setAttribute("style", "overflow:hidden;color:#8b8984;font-size:9px;text-overflow:ellipsis;white-space:nowrap;")
    meta.textContent = `${item.thread_id.slice(0, 8)} · ${item.time}`
    const go = document.createElement("span")
    go.className = "qc-text-button"
    go.textContent = "去审批"
    row.append(task, status, meta, go)
    row.addEventListener("click", () => props.onApprove(item.thread_id))
    panel.append(row)
  }
  return panel
}