/**
 * QuantCode 业务面板 — Day 5
 *
 * 六个面板：Compose 视图 / 任务树 / HumanGate / Schema 卡片 / Memory 浏览器 / 会话 Resume
 *
 * 数据源：run_agent MCP tool 返回的 execution_trace 事件流。
 * 集成方式：在 session-side-panel.tsx 里加一个 "QuantCode" Tab，挂载本组件。
 *
 * 状态存储在 module-level signal，供同文件内的面板组件共享。
 * 调用方在 tool result 里解析到 execution_trace 时调用 `updateQuantCodeTrace(result)` 更新。
 */
import { For, Match, Show, Switch, createSignal, type JSX } from "solid-js"

// ---------------------------------------------------------------------------
// 共享状态（模块级单例，跨面板共享）
// ---------------------------------------------------------------------------

export type TraceEvent = {
  type: string
  thread_id?: string
  data?: Record<string, unknown>
}

export type RunAgentResult = {
  status: "completed" | "waiting_for_human" | "rejected" | "error" | string
  thread_id?: string
  gate?: {
    kind?: string
    gate_id?: string
    reasons?: string[]
    risk_metrics?: Record<string, unknown>
    decision_schema?: { allowed: string[]; default: string }
  }
  execution_trace?: TraceEvent[]
  output_data?: Record<string, unknown>
  artifacts?: string[]
  risk_metrics?: Record<string, unknown>
  human_decision?: string
  error?: string
}

const [_trace, setTrace] = createSignal<RunAgentResult | null>(null)
const [_group, setGroup] = createSignal<string>("model")
const [_threadHistory, setThreadHistory] = createSignal<RunAgentResult[]>([])

/** 外部调用：当 run_agent 返回结果时更新面板状态 */
export function updateQuantCodeTrace(result: RunAgentResult) {
  setTrace(result)
  setThreadHistory((prev) => [result, ...prev.slice(0, 19)])
}

/** 外部调用：切换组时更新 */
export function setQuantCodeGroup(group: string) {
  setGroup(group)
}

// ---------------------------------------------------------------------------
// 事件类型 → 图标
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<string, string> = {
  agent_start: "🚀",
  user_input: "📝",
  llm_thought: "💭",
  tool_call: "🔧",
  tool_result: "✅",
  risk_metrics: "📊",
  human_gate: "⏸️",
  output_data: "📦",
  artifact: "📄",
  agent_end: "🏁",
  error: "❌",
}

// ---------------------------------------------------------------------------
// 子面板：Compose 视图（步骤进度）
// ---------------------------------------------------------------------------

function ComposeViewPanel(): JSX.Element {
  const trace = _trace
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        Compose 视图
      </div>
      <Show
        when={trace() !== null}
        fallback={
          <div class="text-muted text-xs">
            等待 run_agent 执行…
            <br />
            <span class="opacity-60">输入 /compose &lt;任务&gt; 开始</span>
          </div>
        }
      >
        <div class="space-y-1">
          <For each={trace()!.execution_trace ?? []}>
            {(ev) => {
              const icon = EVENT_ICONS[ev.type] ?? "•"
              const label =
                ev.type === "tool_call"
                  ? `调用：${(ev.data as { tool_name?: string } | undefined)?.tool_name ?? ""}`
                  : ev.type === "llm_thought"
                    ? `思考：${String((ev.data as { text?: string } | undefined)?.text ?? "").slice(0, 60)}`
                    : ev.type
              return (
                <div class="flex items-start gap-1.5 py-0.5">
                  <span class="shrink-0">{icon}</span>
                  <span class="text-xs leading-snug break-all">{label}</span>
                </div>
              )
            }}
          </For>
          <div class="mt-2 text-xs font-medium">
            <span
              class={
                trace()!.status === "completed"
                  ? "text-green-600"
                  : trace()!.status === "waiting_for_human"
                    ? "text-yellow-600"
                    : trace()!.status === "error"
                      ? "text-red-600"
                      : "text-muted"
              }
            >
              {trace()!.status}
            </span>
          </div>
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：HumanGate 暂停点
// ---------------------------------------------------------------------------

function HumanGatePanel(): JSX.Element {
  const trace = _trace
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        HumanGate
      </div>
      <Switch>
        <Match when={trace()?.status === "waiting_for_human"}>
          <div class="rounded border border-yellow-400/40 bg-yellow-50/5 p-3 space-y-2">
            <div class="flex items-center gap-2 text-yellow-500 font-medium text-xs">
              ⏸️ 等待人工审批
            </div>
            <div class="text-xs text-muted">Thread: {trace()!.thread_id}</div>
            <For each={trace()!.gate?.reasons ?? []}>
              {(reason) => (
                <div class="text-xs bg-yellow-500/10 rounded px-2 py-1">{reason}</div>
              )}
            </For>
            <div class="text-xs mt-2 text-muted">
              在输入框输入：
              <br />
              <code class="bg-black/10 px-1 rounded text-[10px]">
                approve / reject（配合 thread_id）
              </code>
            </div>
          </div>
        </Match>
        <Match when={trace()?.status !== "waiting_for_human"}>
          <div class="text-muted text-xs">
            {trace() === null
              ? "暂无进行中的 HumanGate"
              : `上次状态：${trace()!.status}`}
          </div>
        </Match>
      </Switch>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：Schema 卡片（output_data）
// ---------------------------------------------------------------------------

function SchemaCardPanel(): JSX.Element {
  const trace = _trace
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        Schema 卡片
      </div>
      <Show
        when={trace()?.output_data != null}
        fallback={<div class="text-muted text-xs">等待产出…</div>}
      >
        <div class="rounded border border-border bg-background-dark p-2">
          <pre class="text-[10px] leading-relaxed whitespace-pre-wrap break-all overflow-auto max-h-64">
            {JSON.stringify(trace()!.output_data, null, 2)}
          </pre>
        </div>
        <Show when={(trace()!.artifacts ?? []).length > 0}>
          <div class="mt-2 space-y-1">
            <div class="text-[11px] text-muted uppercase tracking-wide">Artifacts</div>
            <For each={trace()!.artifacts ?? []}>
              {(path) => (
                <div class="text-xs font-mono truncate text-green-600">📄 {path}</div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：任务树（简单版，从 execution_trace 的 tool_call 线性列）
// ---------------------------------------------------------------------------

function TaskTreePanel(): JSX.Element {
  const trace = _trace
  const toolCalls = () =>
    (trace()?.execution_trace ?? []).filter((ev) => ev.type === "tool_call")
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        任务树
      </div>
      <Show
        when={toolCalls().length > 0}
        fallback={<div class="text-muted text-xs">等待工具调用…</div>}
      >
        <ol class="space-y-1">
          <For each={toolCalls()}>
            {(ev, i) => (
              <li class="flex items-center gap-2 text-xs">
                <span class="w-4 h-4 rounded-full bg-border flex items-center justify-center text-[9px] shrink-0">
                  {i() + 1}
                </span>
                <span class="font-mono">
                  {(ev.data as { tool_name?: string } | undefined)?.tool_name}
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：Memory 浏览器（静态提示，Week 2 接真实 API）
// ---------------------------------------------------------------------------

function MemoryBrowserPanel(): JSX.Element {
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        Memory 浏览器
      </div>
      <div class="text-muted text-xs space-y-1">
        <p>Memory 只读 MCP 入口计划 Week 2 补充。</p>
        <p>
          当前可直接查看 SQLite：
          <br />
          <code class="bg-black/10 px-1 rounded text-[10px]">
            .quantcode/memory.db
          </code>
        </p>
        <p class="mt-2">或在终端运行 Dream 扫描：</p>
        <code class="block bg-black/10 px-2 py-1 rounded text-[10px] whitespace-pre">
          {`python -c "from dream.dream_prototype import run_dream
hits = run_dream()
for h in hits: print(h['snippet'][:80])"`}
        </code>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：会话 Resume（checkpoint 列表）
// ---------------------------------------------------------------------------

function SessionResumePanel(): JSX.Element {
  const history = _threadHistory
  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        会话 Resume
      </div>
      <Show
        when={history().length > 0}
        fallback={<div class="text-muted text-xs">暂无历史 thread。</div>}
      >
        <div class="space-y-1 max-h-64 overflow-auto">
          <For each={history()}>
            {(result) => (
              <div class="rounded border border-border p-2 text-xs">
                <div class="font-mono truncate text-[10px]">{result.thread_id}</div>
                <div
                  class={
                    result.status === "completed"
                      ? "text-green-600"
                      : result.status === "waiting_for_human"
                        ? "text-yellow-600"
                        : "text-muted"
                  }
                >
                  {result.status}
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="mt-2 text-[10px] text-muted">
          resume：发送 approve/reject + thread_id 给 Agent
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主面板：Tab 切换六个子面板
// ---------------------------------------------------------------------------

type TabId = "compose" | "tasks" | "gate" | "schema" | "memory" | "resume"

const TABS: { id: TabId; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "tasks", label: "任务树" },
  { id: "gate", label: "HumanGate" },
  { id: "schema", label: "Schema" },
  { id: "memory", label: "Memory" },
  { id: "resume", label: "Resume" },
]

export function QuantCodePanel(): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("compose")

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

      {/* Group badge */}
      <div class="px-3 py-1 text-[10px] text-muted border-b border-border">
        组：<span class="font-mono font-medium">{_group()}</span>
        <Show when={_trace()?.thread_id}>
          {" "}·{" "}
          <span class="font-mono truncate max-w-[120px] inline-block align-bottom">
            {_trace()!.thread_id}
          </span>
        </Show>
      </div>

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
        </Switch>
      </div>
    </div>
  )
}
