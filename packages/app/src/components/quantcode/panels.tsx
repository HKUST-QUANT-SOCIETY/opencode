/**
 * QuantCode 业务面板 — Day 5
 *
 * 七个面板：Compose 视图 / 任务树 / HumanGate / Schema 卡片 / Memory 浏览器 / 会话 Resume / Blackboard
 *
 * 数据源：run_agent MCP tool 返回的 execution_trace 事件流。
 * 集成方式：在 session-side-panel.tsx 里加一个 "QuantCode" Tab，挂载本组件。
 *
 * 状态存储在 module-level signal，供同文件内的面板组件共享。
 * 调用方在 tool result 里解析到 execution_trace 时调用 `updateQuantCodeTrace(result)` 更新。
 */
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

// ---------------------------------------------------------------------------
// 共享类型
// ---------------------------------------------------------------------------

export type TraceEvent = {
  type: string
  thread_id?: string
  seq?: number
  iteration?: number | null
  group?: string
  flow_name?: string
  node?: string | null
  data?: Record<string, unknown>
}

export type RunAgentResult = {
  status: "completed" | "waiting_for_human" | "rejected" | "error" | string
  thread_id?: string
  timestamp?: number
  gate?: {
    kind?: string
    gate_id?: string
    message?: string
    reasons?: string[]
    risk_metrics?: Record<string, unknown>
    decision_schema?: { allowed: string[]; default: string }
    review_history?: { decision: string; timestamp: number }[]
  }
  execution_trace?: TraceEvent[]
  output_data?: Record<string, unknown>
  artifacts?: string[]
  risk_metrics?: Record<string, unknown>
  human_decision?: string
  human_review_history?: { decision: string; timestamp: number }[]
  error?: string
}

// ---------------------------------------------------------------------------
// 共享状态（模块级单例，跨面板共享）
// ---------------------------------------------------------------------------

const [_trace, setTrace] = createSignal<RunAgentResult | null>(null)
const [_group, setGroup] = createSignal<string>("factor")
const [_threadHistory, setThreadHistory] = createSignal<RunAgentResult[]>([])

// ★ Restore last trace from localStorage so panel data survives refresh, session restart,
//   and tab switch. Overwritten by the next run_agent call (updateQuantCodeTrace).
try {
  const raw = localStorage.getItem("quantcode:thread_cache")
  if (raw) {
    const items = JSON.parse(raw) as RunAgentResult[]
    if (items.length > 0 && items[0]) {
      setTrace(items[0])
      setThreadHistory(items)
    }
  }
} catch { /* localStorage not available */ }

/** 外部调用：当 run_agent 返回结果时更新面板状态 */
export function updateQuantCodeTrace(result: RunAgentResult) {
  const enriched: RunAgentResult = {
    ...result,
    timestamp: result.timestamp ?? Date.now(),
  }

  setThreadHistory((prev) => {
    const existingIdx = prev.findIndex((r) => enriched.thread_id && r.thread_id === enriched.thread_id)
    if (existingIdx >= 0) {
      // Merge: append new execution_trace events onto existing ones, dedupe by (iter, seq)
      const existing = prev[existingIdx]!
      const mergedEvents = mergeTraceEvents(existing.execution_trace ?? [], enriched.execution_trace ?? [])
      // Merge gate with review_history from human_decision and human_review_history
      const mergedGate = mergeGateWithDecision(existing.gate, enriched.gate, enriched.human_decision, enriched.human_review_history)
      const merged: RunAgentResult = {
        ...existing,
        ...enriched,
        status: enriched.status ?? existing.status,
        execution_trace: mergedEvents,
        gate: mergedGate,
        timestamp: enriched.timestamp ?? Date.now(),
      }
      const next = [...prev]
      next[existingIdx] = merged
      setTrace(merged)
      return next
    }
    setTrace(enriched)
    return [enriched, ...prev.slice(0, 19)]
  })

  // Persist to localStorage
  try {
    const key = "quantcode:thread_cache"
    const raw = localStorage.getItem(key)
    const existing: RunAgentResult[] = raw ? JSON.parse(raw) : []
    const existIdx = existing.findIndex((r: RunAgentResult) => enriched.thread_id && r.thread_id === enriched.thread_id)
    if (existIdx >= 0) {
      const prevEntry = existing[existIdx]!
      const mergedEvents = mergeTraceEvents(prevEntry.execution_trace ?? [], enriched.execution_trace ?? [])
      const mergedGate = mergeGateWithDecision(prevEntry.gate, enriched.gate, enriched.human_decision, enriched.human_review_history)
      existing[existIdx] = {
        ...prevEntry,
        ...enriched,
        status: enriched.status ?? prevEntry.status,
        execution_trace: mergedEvents,
        gate: mergedGate,
        timestamp: enriched.timestamp ?? Date.now(),
      }
      localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)))
    } else {
      const filtered = existing.filter((r) => enriched.thread_id && r.thread_id !== enriched.thread_id)
      localStorage.setItem(key, JSON.stringify([enriched, ...filtered].slice(0, 50)))
    }
  } catch { /* localStorage not available */ }
}

/** Merge two execution_trace arrays: dedupe by (iteration, seq) compound key, sort by iteration then seq. */
function mergeTraceEvents(existing: TraceEvent[], incoming: TraceEvent[]): TraceEvent[] {
  const seen = new Map<string, TraceEvent>()
  for (const e of existing) {
    const key = `${e.iteration ?? 0}:${e.seq ?? 0}`
    seen.set(key, e)
  }
  for (const e of incoming) {
    const key = `${e.iteration ?? 0}:${e.seq ?? 0}`
    seen.set(key, e)
  }
  return [...seen.values()].sort((a, b) =>
    ((a.iteration ?? 0) - (b.iteration ?? 0)) || ((a.seq ?? 0) - (b.seq ?? 0)),
  )
}

/** Merge gate objects: append human_decision and human_review_history entries to review_history. */
function mergeGateWithDecision(
  existingGate: RunAgentResult["gate"],
  incomingGate: RunAgentResult["gate"],
  humanDecision?: string,
  humanReviewHistory?: { decision: string; timestamp: number }[],
): RunAgentResult["gate"] {
  const base = incomingGate ?? existingGate
  const prevHistory = existingGate?.review_history ?? []

  // Merge human_review_history top-level entries from Python
  const reviewEntries: { decision: string; timestamp: number }[] = [...prevHistory]
  if (humanReviewHistory && humanReviewHistory.length > 0) {
    for (const entry of humanReviewHistory) {
      // Dedupe by timestamp so re-merging doesn't double-add
      if (!reviewEntries.some((e) => e.decision === entry.decision && e.timestamp === entry.timestamp)) {
        reviewEntries.push(entry)
      }
    }
  }
  // Append human_decision (single) if present and not auto
  if (humanDecision && humanDecision !== "auto") {
    const reviewEntry = { decision: humanDecision, timestamp: Date.now() }
    if (!reviewEntries.some((e) => e.decision === reviewEntry.decision && e.timestamp === reviewEntry.timestamp)) {
      reviewEntries.push(reviewEntry)
    }
  }

  return reviewEntries.length > 0
    ? { ...(base ?? {}), review_history: reviewEntries }
    : (base ?? undefined)
}

/** 外部调用：切换组时更新 */
export function setQuantCodeGroup(group: string) {
  setGroup(group)
}

// ---------------------------------------------------------------------------
// 事件类型 → 图标（emoji）
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<string, string> = {
  agent_start: "\u{1F680}",
  user_input: "\u{1F4DD}",
  llm_thought: "\u{1F4AD}",
  tool_call: "\u{1F527}",
  tool_result: "✅",
  risk_metrics: "\u{1F4CA}",
  human_gate: "⏸️",
  output_data: "\u{1F4E6}",
  artifact: "\u{1F4C4}",
  agent_end: "\u{1F3C1}",
  error: "❌",
  skill_loaded: "\u{1F4CB}",
  node_update: "\u{1F504}",
  loop_detected: "\u{1F501}",
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** Human-readable title for each event type. */
function eventTitle(type: string): string {
  switch (type) {
    case "agent_start": return "Agent start"
    case "skill_loaded": return "Skill loaded"
    case "node_update": return "Node update"
    case "llm_thought": return "Thought"
    case "tool_call": return "Tool call"
    case "tool_result": return "Tool result"
    case "risk_metrics": return "Risk metrics"
    case "output_data": return "Output data"
    case "artifact": return "Artifact"
    case "human_gate": return "Human gate"
    case "agent_end": return "Agent end"
    case "error": return "Error"
    case "loop_detected": return "Loop detected"
    default: return type
  }
}

/** Build a one-line summary for each event. */
function eventSummary(event: TraceEvent): string {
  const d = (event.data ?? {}) as Record<string, unknown>
  switch (event.type) {
    case "agent_start": return `Task: ${(d.task as string) ?? ""}`
    case "llm_thought": return (d.content as string)?.slice(0, 80) ?? ""
    case "tool_call": return `${d.tool_name ?? d.tool ?? ""}(${JSON.stringify(d.tool_input ?? d.args ?? {})})`
    case "tool_result": return `${d.tool_name ?? d.tool ?? ""} → ${JSON.stringify(d.result ?? d.output ?? "").slice(0, 80)}`
    case "artifact": return `${d.artifact_type ?? ""} @ ${(d.artifact_ref ?? d.path ?? "") as string}`
    case "output_data": return Object.keys(d.output_data ?? d ?? {}).join(", ")
    case "risk_metrics": {
      const m = (d.metrics ?? {}) as Record<string, unknown>
      return `VaR=${m.var_99 ?? "-"} | DD=${m.max_drawdown ?? "-"}`
    }
    case "human_gate": {
      const g = (d.gate ?? {}) as { gate_id?: string; reasons?: string[] }
      return `${g.gate_id ?? "pending"} : ${(g.reasons ?? []).join(", ")}`
    }
    case "agent_end": return `Status: ${(d.status as string) ?? "completed"}`
    case "error": return (d.error as string)?.slice(0, 80) ?? "Unknown error"
    default: return JSON.stringify(d).slice(0, 60)
  }
}

/** High-level summary for the entire run. */
function traceSummary(events: TraceEvent[]): string {
  const tools = events.filter((e) => e.type === "tool_call")
  const artifacts = events.filter((e) => e.type === "artifact")
  const endIdx = [...events].reverse().findIndex((e) => e.type !== "skill_loaded" && e.type !== "node_update")
  const final = endIdx >= 0 ? events[events.length - 1 - endIdx] : events[events.length - 1]
  const eventStatus = ((final?.data as Record<string, unknown>)?.status as string) ?? final?.type ?? "unknown"
  const status = eventStatus === "completed" ? "Done" : eventStatus === "waiting_for_human" ? "⏸️ Waiting" : "Running"
  const toolNames = [...new Set(tools.map((t) => ((t.data as Record<string, unknown>)?.tool_name ?? (t.data as Record<string, unknown>)?.tool ?? "") as string))]
  return `${status} · ${toolNames.length} tool(s): ${toolNames.join(" → ")} · ${artifacts.length} artifact(s)`
}

/** Join union types from schema field definitions. */
function fieldType(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" | ")
  if (typeof value === "string") return value
  return "unknown"
}

/** Resume a HumanGate checkpoint. */
function resumeGate(threadId: string, decision: "approve" | "reject") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("quantcode:humanGate:resume", { detail: { thread_id: threadId, decision } }),
    )
  }
}

// ---------------------------------------------------------------------------
// 子面板 1：Compose 视图（可折叠事件列表）
// ---------------------------------------------------------------------------

function ComposeViewPanel(): JSX.Element {
  const trace = _trace
  const sorted = createMemo(() => {
    const events = trace()?.execution_trace ?? []
    return [...events].sort((a, b) =>
      ((a.iteration ?? 0) - (b.iteration ?? 0)) || ((a.seq ?? 0) - (b.seq ?? 0)),
    )
  })
  const summary = createMemo(() => traceSummary(sorted()))
  const [expanded, setExpanded] = createStore<Record<number, boolean>>({})
  const [copied, setCopied] = createSignal(false)
  const toggle = (seq: number) => setExpanded(seq, (v) => !v)
  const copyThreadId = () => {
    const tid = trace()?.thread_id
    if (tid) {
      navigator.clipboard?.writeText(tid).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }).catch(() => {})
    }
  }

  return (
    <div class="p-3 text-sm flex flex-col gap-2">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted">
        Compose 视图
      </div>
      <Show when={trace() !== null} fallback={
        <div class="text-muted text-xs">
          等待 run_agent 执行…
          <br />
          <span class="opacity-60">输入 /compose &lt;任务&gt; 开始</span>
        </div>
      }>
        <Show when={trace()!.thread_id}>
          {(tid) => (
            <div class="rounded border border-border bg-background-dark px-2 py-1.5 flex items-center gap-2 text-[11px] text-muted">
              <span>thread_id:</span>
              <code class="rounded bg-black/10 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground">{tid()}</code>
              <button type="button" class="text-[10px] text-muted hover:text-foreground shrink-0" onClick={copyThreadId} title="Copy">
                {copied() ? "✓" : "📋"}
              </button>
            </div>
          )}
        </Show>
        <Show when={sorted().length > 0} fallback={
          <div class="rounded border border-dashed border-border px-4 py-4 text-xs text-muted text-center">
            暂无 trace 事件。等待 run_agent 执行完成。
          </div>
        }>
          <div class="rounded border border-border bg-background-dark px-2 py-1.5 text-xs font-medium">
            {summary()}
          </div>
          <div class="flex flex-col gap-0.5">
            <For each={sorted()}>
              {(event) => {
                const isOpen = () => !!expanded[event.seq ?? 0]
                const icon = EVENT_ICONS[event.type] ?? "•"
                return (
                  <div class="rounded border border-border bg-background-dark px-2 py-1">
                    <button type="button" class="w-full flex items-center gap-1.5 text-left hover:opacity-80" onClick={() => toggle(event.seq ?? 0)}>
                      <span class="text-[10px] text-muted shrink-0" style={{ transform: isOpen() ? "rotate(90deg)" : "rotate(0deg)" }}>{"▶"}</span>
                      <span class="shrink-0 text-xs">{icon}</span>
                      <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
                        <div class="min-w-0 truncate">
                          <span class="text-[11px] font-medium">{eventTitle(event.type)}</span>
                          <span class="text-[10px] text-muted ml-2 hidden sm:inline">{eventSummary(event)}</span>
                        </div>
                        <span class="text-[10px] text-muted shrink-0">seq {event.seq ?? "-"} · iter {event.iteration ?? "-"}</span>
                      </div>
                    </button>
                    <Show when={isOpen()}>
                      <div class="mt-1.5 pl-6">
                        <div class="text-[10px] text-muted mb-1 sm:hidden">{eventSummary(event)}</div>
                        <pre class="overflow-x-auto rounded bg-black/10 dark:bg-white/5 px-2 py-1.5 text-[10px] leading-5 whitespace-pre-wrap break-all max-h-48">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
          <div class="text-xs font-medium">
            <span class={
              trace()!.status === "completed" ? "text-green-600"
              : trace()!.status === "waiting_for_human" ? "text-yellow-600"
              : trace()!.status === "error" ? "text-red-600"
              : "text-muted"
            }>
              {trace()!.status}
            </span>
          </div>
        </Show>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 2：任务树（全部有意义的事件类型）
// ---------------------------------------------------------------------------

function TaskTreePanel(): JSX.Element {
  const events = createMemo(() => {
    const t = _trace()
    if (!t) return []
    return t.execution_trace ?? []
  })
  const steps = createMemo(() => {
    const evs = events()
    const meaningful = evs.filter(e => e.type !== "node_update" && e.type !== "skill_loaded")
    return meaningful.length > 0 ? meaningful : evs
  })
  /** Group events by iteration, sorted by iteration number; events within each group sorted by seq. */
  const iterationGroups = createMemo(() => {
    const evs = steps()
    const groups = new Map<number, TraceEvent[]>()
    for (const e of evs) {
      const iter = e.iteration ?? 0
      if (!groups.has(iter)) groups.set(iter, [])
      groups.get(iter)!.push(e)
    }
    const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0])
    return sorted.map(([iter, items]) => ({
      iteration: iter,
      events: [...items].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    }))
  })
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">任务树</div>
      <Show when={steps().length > 0} fallback={
        <div class="text-muted text-xs">{_trace() === null ? "等待 run_agent 执行…" : "等待工具调用…"}</div>
      }>
        <div class="space-y-1">
          <For each={iterationGroups()}>
            {(group) => (
              <div class="rounded border border-border bg-background-dark px-2 py-1.5">
                <div class="flex items-center gap-2 text-[11px] font-medium text-muted mb-1">
                  <span class="w-5 h-5 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center text-[9px] shrink-0">
                    {group.iteration}
                  </span>
                  Iteration {group.iteration}
                </div>
                <div class="space-y-0.5 pl-6">
                  <For each={group.events}>
                    {(ev, i) => (
                      <div class="flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5">
                        <span class="text-[10px] text-muted shrink-0 w-8">{`T${group.iteration}.${i() + 1}`}</span>
                        <span class="shrink-0">{EVENT_ICONS[ev.type] ?? "•"}</span>
                        <span class="font-medium min-w-0 truncate">{eventTitle(ev.type)}</span>
                        <span class="text-[10px] text-muted truncate hidden sm:inline">{eventSummary(ev).slice(0, 60)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 3：HumanGate（安全版 — 使用 _trace() 可选链，永不 crash）
// ---------------------------------------------------------------------------

function HumanGatePanel(): JSX.Element {
  const trace = () => _trace()
  const status = () => trace()?.status
  const isWaiting = () => status() === "waiting_for_human" && trace()?.gate != null
  const isCompletedWithGate = () => (status() === "completed" || status() === "stopped") && trace()?.gate != null
  const gatePresent = () => isWaiting() || isCompletedWithGate()
  const gateResume = (decision: "approve" | "reject") => {
    const tid = trace()?.thread_id
    if (tid) resumeGate(tid, decision)
  }
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">HumanGate</div>
      <Switch>
        <Match when={gatePresent()}>
          <div class="rounded border border-yellow-400/40 bg-yellow-50/5 dark:bg-yellow-50/[0.02] p-3 space-y-3">
            <div class="flex items-center gap-2 font-medium text-xs"
              classList={{
                "text-yellow-600 dark:text-yellow-400": isWaiting(),
                "text-green-600": isCompletedWithGate(),
              }}
            >
              {isWaiting() ? "⏸️ 等待人工审批" : "✅ HumanGate 已完成"}
            </div>
            <Show when={isWaiting() && trace()?.gate?.message}>{(msg) => <div class="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5 text-xs">{msg()}</div>}</Show>
            <div class="grid grid-cols-1 gap-1.5 text-[11px] text-muted sm:grid-cols-2">
              <div><div class="text-[10px] opacity-60">thread_id</div><code class="text-[10px]">{trace()?.thread_id}</code></div>
              <div><div class="text-[10px] opacity-60">gate_id</div><code class="text-[10px]">{trace()?.gate?.gate_id ?? "pending"}</code></div>
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="text-xs font-medium">Reasons</div>
              <Show when={(trace()?.gate?.reasons?.length ?? 0) > 0} fallback={<div class="text-[11px] text-muted">等待 risk demo 冻结字段。</div>}>
                <ul class="list-disc pl-5 text-xs space-y-0.5"><For each={trace()?.gate?.reasons ?? []}>{(r) => <li>{r}</li>}</For></ul>
              </Show>
            </div>
            <Show when={(trace()?.gate?.review_history?.length ?? 0) > 0}>
              <div class="flex flex-col gap-1.5">
                <div class="text-xs font-medium">Review history</div>
                <div class="space-y-1">
                  <For each={trace()?.gate?.review_history ?? []}>
                    {(entry) => (
                      <div class="flex items-center gap-2 rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-[11px]">
                        <span class={entry.decision === "approve" ? "text-green-600" : "text-red-600"}>
                          {entry.decision === "approve" ? "✓" : "✗"} {entry.decision}
                        </span>
                        <span class="text-[10px] text-muted">{new Date(entry.timestamp).toLocaleString()}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <div class="flex flex-col gap-1.5">
              <div class="text-xs font-medium">Risk metrics</div>
              <pre class="overflow-x-auto rounded bg-black/5 dark:bg-white/5 px-2 py-1.5 text-[10px] leading-5 whitespace-pre-wrap break-all max-h-40">
                {JSON.stringify(trace()?.gate?.risk_metrics ?? {}, null, 2)}
              </pre>
            </div>
            <Show when={isWaiting()}>
              <div class="flex items-center gap-2">
                <button type="button" disabled={!isWaiting()} class="bg-primary/15 border border-primary/30 rounded px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/25"
                  onClick={() => gateResume("approve")}>approve</button>
                <button type="button" disabled={!isWaiting()} class="border border-border rounded px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => gateResume("reject")}>reject</button>
              </div>
            </Show>
          </div>
        </Match>
        <Match when={!gatePresent()}>
          <div class="text-muted text-xs">
            {trace() === null
              ? "暂无进行中的 HumanGate"
              : status() === "completed"
                ? "流已完成（未经过 HumanGate）"
                : status() === "error"
                  ? `上次状态：${status()} — 执行出错`
                  : `上次状态：${status()}`}
          </div>
        </Match>
      </Switch>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 4：Schema 卡片（接受多种 output_data 形状）
// ---------------------------------------------------------------------------

type JsonSchemaField = { type?: string | string[]; description?: string; enum?: unknown[]; items?: unknown; [key: string]: unknown }
type JsonSchema = { title?: string; type?: string; required?: string[]; properties?: Record<string, JsonSchemaField>; [key: string]: unknown }

function SchemaCardPanel(): JSX.Element {
  const schema = createMemo<JsonSchema | null>(() => {
    const od = _trace()?.output_data as Record<string, unknown> | undefined
    if (!od) return null
    if ((od as any).__schema__ === true && od.type === "object" && od.properties) return od as unknown as JsonSchema
    if (od.type === "object" && (od.properties != null || od.required != null || od.title != null))
      return od as unknown as JsonSchema
    if (Object.keys(od).length > 0) {
      return {
        title: "RunAgent output_data",
        type: "object",
        properties: Object.fromEntries(
          Object.entries(od).map(([k, v]) => [k, {
            type: typeof v === "string" ? "string" : typeof v === "number" ? "number" : Array.isArray(v) ? "array" : "object",
            description: typeof v === "string" ? v.slice(0, 120) : JSON.stringify(v).slice(0, 120),
          }]),
        ),
      }
    }
    return null
  })

  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">Schema 卡片</div>
      <Show when={schema() != null} fallback={
        <div class="text-muted text-xs">
          {_trace() === null ? "等待产出…" : "output_data 不可用，等待 run_agent 完成"}
          <Show when={_trace()?.output_data != null && (schema() == null)}>
            <pre class="mt-2 rounded border border-border bg-background-dark p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all overflow-auto max-h-64">
              {JSON.stringify(_trace()!.output_data, null, 2)}
            </pre>
          </Show>
        </div>
      }>
        <div class="rounded border border-border bg-background-dark p-3 flex flex-col gap-3">
          <div class="text-xs font-medium">{schema()!.title ?? "JSON Schema"}</div>
          <Show when={schema()!.properties && Object.keys(schema()!.properties!).length > 0}
            fallback={<pre class="text-[10px] leading-relaxed whitespace-pre-wrap break-all overflow-auto max-h-64">{JSON.stringify(schema(), null, 2)}</pre>}
          >
            <For each={Object.entries(schema()!.properties ?? {})}>
              {([name, field]: [string, JsonSchemaField]) => (
                <div class="rounded border border-border px-2 py-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-medium">{name}</div>
                    <span class="rounded bg-black/5 dark:bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">{fieldType(field.type)}</span>
                  </div>
                  <Show when={field.description}>{(desc) => <div class="mt-1 text-[11px] text-muted">{desc()}</div>}</Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <Show when={(_trace()!.artifacts ?? []).length > 0}>
          <div class="mt-2 space-y-1">
            <div class="text-[10px] text-muted uppercase tracking-wide">Artifacts</div>
            <For each={_trace()!.artifacts ?? []}>{(path) => <div class="text-xs font-mono truncate text-green-600">📄 {path}</div>}</For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 5：Memory 浏览器（静态提示，Week 2 接真实 API）
// ---------------------------------------------------------------------------

function MemoryBrowserPanel(): JSX.Element {
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">Memory 浏览器</div>
      <div class="text-muted text-xs space-y-1">
        <p>Memory 只读 MCP 入口计划 Week 2 补充。</p>
        <p>当前可直接查看 SQLite：<br /><code class="bg-black/10 px-1 rounded text-[10px]">.quantcode/memory.db</code></p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 6：会话 Resume（checkpoint 列表）
// ---------------------------------------------------------------------------

function SessionResumePanel(): JSX.Element {
  const history = _threadHistory
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">会话 Resume</div>
      <Show when={history().length > 0} fallback={<div class="text-muted text-xs">暂无历史 thread。</div>}>
        <div class="space-y-1 max-h-64 overflow-auto">
          <For each={history()}>
            {(result) => (
              <div class="rounded border border-border p-2 text-xs">
                <div class="font-mono truncate text-[10px]">{result.thread_id}</div>
                <div class={result.status === "completed" ? "text-green-600" : result.status === "waiting_for_human" ? "text-yellow-600" : "text-muted"}>
                  {result.status}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板 7：Blackboard（demo 数据）
// ---------------------------------------------------------------------------

function BlackboardPanel(): JSX.Element {
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">Blackboard</div>
      <div class="text-muted text-xs">Blackboard 只读视图 — Week 2 接真实 MCP tool。</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ★ TEST BUTTON — 点击即可注入测试 trace，用于验证面板渲染
// ---------------------------------------------------------------------------

function injectTestTrace() {
  updateQuantCodeTrace({
    status: "waiting_for_human",
    thread_id: "test-" + Date.now(),
    timestamp: Date.now(),
    gate: {
      kind: "human_gate",
      gate_id: "hg_test_001",
      message: "⏸️ HumanGate: 测试数据 — VaR99 超标 (0.085 > 0.05)",
      reasons: ["tail_risk_var_99", "max_drawdown", "position_limit"],
      risk_metrics: {
        strategy_id: "pb_roe_ranker",
        max_drawdown: 0.22,
        position_limit: 0.92,
        tail_risk_var_99: 0.085,
        correlation_with_existing: 0.70,
      },
      decision_schema: { allowed: ["approve", "reject"], default: "reject" },
    },
    execution_trace: [
      { type: "agent_start", seq: 1, thread_id: "test", group: "risk", flow_name: "test",
        node: null, iteration: 0, data: { task: "run risk_stub high_risk" } },
      { type: "risk_metrics", seq: 2, thread_id: "test", group: "risk", flow_name: "test",
        node: "run_tool_pipeline", iteration: 0, data: { metrics: { max_drawdown: 0.22, var_99: 0.085 } } },
      { type: "human_gate", seq: 3, thread_id: "test", group: "risk", flow_name: "test",
        node: "human_review", iteration: 0, data: { status: "waiting_for_human" } },
    ],
    output_data: {
      __schema__: true,
      type: "object",
      title: "RiskProfile (test)",
      properties: {
        status: { type: "string", description: "completed" },
        max_drawdown: { type: "number", description: "0.22" },
        tail_risk_var_99: { type: "number", description: "0.085" },
        position_limit: { type: "number", description: "0.92" },
        correlation_with_existing: { type: "number", description: "0.7" },
      },
    },
    artifacts: ["artifacts/risk/pb_roe_ranker-profile.json"],
  })
}

// ---------------------------------------------------------------------------
// 主面板：Tab 切换七个子面板
// ---------------------------------------------------------------------------

type TabId = "compose" | "tasks" | "gate" | "schema" | "memory" | "resume" | "blackboard"

const TABS: { id: TabId; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "tasks", label: "任务树" },
  { id: "gate", label: "HumanGate" },
  { id: "schema", label: "Schema" },
  { id: "memory", label: "Memory" },
  { id: "resume", label: "Resume" },
  { id: "blackboard", label: "Blackboard" },
]

export function QuantCodePanel(): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("compose")
  const [showTest, setShowTest] = createSignal(false)

  return (
    <div class="flex flex-col h-full text-sm">
      {/* Tab bar */}
      <div class="flex gap-1 px-2 pt-2 pb-1 border-b border-border overflow-x-auto shrink-0">
        <For each={TABS}>
          {(tab) => (
            <button
              class={[
                "px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors",
                activeTab() === tab.id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted hover:text-foreground",
              ].join(" ")}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      {/* Group badge + test button */}
      <div class="px-3 py-1 text-[10px] text-muted border-b border-border shrink-0 flex items-center justify-between">
        <div>
          组：<span class="font-mono font-medium">{_group()}</span>
          <Show when={_trace()?.thread_id}>
            {" "}·{" "}
            <span class="font-mono truncate max-w-[120px] inline-block align-bottom">
              {_trace()!.thread_id}
            </span>
          </Show>
        </div>
        {/* ★ TEST BUTTON — inject mock data to verify panel rendering */}
        <button
          type="button"
          class="border border-border rounded px-2 py-0.5 text-[10px] text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
          onClick={() => { injectTestTrace(); setShowTest(true) }}
          title="Inject test trace to verify panel rendering"
        >
          🧪 测试数据
        </button>
      </div>
      <Show when={showTest()}>
        <div class="px-3 py-0.5 text-[10px] text-green-600 dark:text-green-400 border-b border-border shrink-0">
          ✅ 测试数据已注入 — 请切换标签页查看 Compose / 任务树 / HumanGate / Schema
        </div>
      </Show>

      {/* Panel content */}
      <div class="flex-1 overflow-auto">
        <Switch>
          <Match when={activeTab() === "compose"}>
            <ComposeViewPanel />
          </Match>
          <Match when={activeTab() === "tasks"}>
            <TaskTreePanel />
          </Match>
          <Match when={activeTab() === "gate"}>
            <HumanGatePanel />
          </Match>
          <Match when={activeTab() === "schema"}>
            <SchemaCardPanel />
          </Match>
          <Match when={activeTab() === "memory"}>
            <MemoryBrowserPanel />
          </Match>
          <Match when={activeTab() === "resume"}>
            <SessionResumePanel />
          </Match>
          <Match when={activeTab() === "blackboard"}>
            <BlackboardPanel />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
