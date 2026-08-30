/**
 * QuantCode 业务面板 — Day 5
 *
 * 六个面板：Compose 视图 / 任务树 / HumanGate / Schema 卡片 / Memory 浏览器 / 会话 Resume
 *
 * 数据源：run_agent MCP tool 返回的 execution_trace 事件流。
 * 集成方式：在 session-side-panel.tsx 里加一个 "QuantCode" Tab，挂载本组件。
 *
 * 状态存储在 module-level signal，供同文件内的面板组件共享。
 * 数据由 session-ui 的 run_agent 工具渲染经 quantcode-trace-bridge 桥接推送：
 * QuantCodePanel 挂载时注册 listener，卸载时注销。
 */
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { setQuantCodeTraceListener, type QuantCodeTracePayload } from "@opencode-ai/session-ui/message-part"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

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
/** run_agent 结果所属的 opencode session，gate 审批（resume）发 prompt 时用 */
const [_sessionId, setSessionId] = createSignal<string | undefined>(undefined)

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
// 桥接：接收 run_agent 工具渲染推送的 trace，处理跨会话重置（B19-03）
// ---------------------------------------------------------------------------

let lastSessionId: string | undefined
let lastResultJson: string | undefined

function resetQuantCodeState() {
  setTrace(null)
  setThreadHistory([])
}

function handleQuantCodeTracePayload(payload: QuantCodeTracePayload) {
  // 新会话信号：先清空上一会话的 trace/history，避免跨会话泄漏
  if (typeof payload.sessionId === "string" && payload.sessionId && payload.sessionId !== lastSessionId) {
    lastSessionId = payload.sessionId
    resetQuantCodeState()
  }
  // resume 指令需要的 sessionId：在去重 return 之前记录，保证 gate 面板随时可取
  if (typeof payload.sessionId === "string" && payload.sessionId) setSessionId(payload.sessionId)
  // 工具 part 重挂载会重复推送同一结果，去重避免 history 出现重复条目
  const json = JSON.stringify(payload.result)
  if (json === lastResultJson) return
  lastResultJson = json
  if (payload.result === null || typeof payload.result !== "object") return
  updateQuantCodeTrace(payload.result as RunAgentResult)
}

// ---------------------------------------------------------------------------
// HumanGate 审批：经 server SDK 向会话发送 resume 短指令（P0-4）
// ---------------------------------------------------------------------------

type GateDecision = "approve" | "reject"

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

/**
 * 事件字段读取：stream trace 把载荷包在 `data` 里，而消息历史后处理出的
 * 事件（user_input/tool_call/llm_thought/tool_result/risk_metrics）字段在
 * 顶层，两种形态都兼容。
 */
function evField(ev: TraceEvent, key: string): unknown {
  const data = ev.data as Record<string, unknown> | undefined
  if (data && key in data) return data[key]
  return (ev as unknown as Record<string, unknown>)[key]
}

function evText(ev: TraceEvent, key: string): string {
  const value = evField(ev, key)
  if (value === undefined || value === null) return ""
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

function evEntries(ev: TraceEvent, key: string): [string, unknown][] {
  const value = evField(ev, key)
  if (value !== null && typeof value === "object") return Object.entries(value as Record<string, unknown>)
  return []
}

/** 单行预览（折叠态用） */
function preview(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

// ---------------------------------------------------------------------------
// 子面板：Compose 视图（步骤进度）
// ---------------------------------------------------------------------------

function ComposeViewPanel(): JSX.Element {
  const trace = _trace
  const platform = usePlatform()
  const [expanded, setExpanded] = createSignal<Record<number, boolean>>({})
  const toggle = (index: number) => setExpanded((prev) => ({ ...prev, [index]: !prev[index] }))

  /** artifact 行的 open-link：桌面走 openPath ipc（shell.openPath），无 openPath 时保持纯文本 */
  const canOpenArtifact = () => typeof platform.openPath === "function"
  const openArtifact = (path: string) => {
    if (platform.openPath) void platform.openPath(path).catch(() => {})
  }

  const renderEvent = (ev: TraceEvent, index: number): JSX.Element => {
    const icon = EVENT_ICONS[ev.type] ?? "•"
    const open = () => expanded()[index] === true
    const openButtonClass =
      "flex w-full items-start gap-1.5 py-0.5 text-left cursor-pointer hover:bg-black/5 rounded"

    // 分节线：agent_start / agent_end
    if (ev.type === "agent_start" || ev.type === "agent_end") {
      const task = evText(ev, "task")
      const end = ev.type === "agent_end"
      return (
        <div class="flex items-center gap-1.5 py-1 text-[10px] uppercase tracking-wide text-muted">
          <span class="shrink-0">{icon}</span>
          <span class="whitespace-nowrap">{end ? "Agent 结束" : "Agent 开始"}</span>
          <Show when={task}>
            <span class="normal-case truncate">{preview(task, 40)}</span>
          </Show>
          <span class="flex-1 border-t border-border" />
        </div>
      )
    }

    // 用户任务文本
    if (ev.type === "user_input") {
      const content = evText(ev, "content")
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all">{content}</span>
        </div>
      )
    }

    // LLM 思考：默认单行预览，点击展开全文（不截断）
    if (ev.type === "llm_thought") {
      const content = evText(ev, "content")
      return (
        <button class={openButtonClass} onClick={() => toggle(index)}>
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all min-w-0">
            {open() ? content : preview(content)}
            <Show when={open() && content}>
              <span class="block text-[10px] text-muted mt-0.5">{`▲ 点击收起`}</span>
            </Show>
          </span>
        </button>
      )
    }

    // 工具调用：tool 名 + args 单行
    if (ev.type === "tool_call") {
      const tool = evText(ev, "tool") || evText(ev, "tool_name")
      const args = evField(ev, "args")
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all min-w-0 truncate">
            {`调用：${tool}`}
            <Show when={args !== undefined && args !== null && Object.keys(args as object).length > 0}>
              <span class="text-muted text-[10px] font-mono">{` ${JSON.stringify(args)}`}</span>
            </Show>
          </span>
        </div>
      )
    }

    // 工具结果：默认折叠摘要，展开显示完整结果
    if (ev.type === "tool_result") {
      const tool = evText(ev, "tool")
      const result = evText(ev, "result")
      const isError = evField(ev, "is_error") === true
      return (
        <button class={openButtonClass} onClick={() => toggle(index)}>
          <span class="shrink-0">{isError ? "❌" : icon}</span>
          <span class="text-xs leading-snug break-all min-w-0">
            {`${tool || "工具"}${result ? `：${preview(result)}` : ""}`}
            <Show when={open() && result}>
              <pre
                class={`mt-1 text-[10px] leading-relaxed rounded px-1.5 py-1 whitespace-pre-wrap break-all overflow-auto max-h-48 ${
                  isError ? "bg-red-500/10 text-red-600" : "bg-black/10"
                }`}
              >
                {result}
              </pre>
            </Show>
          </span>
        </button>
      )
    }

    // 风控指标：键值指标卡
    if (ev.type === "risk_metrics") {
      const entries = evEntries(ev, "metrics")
      const raw = evText(ev, "metrics")
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <Show
            when={entries.length > 0}
            fallback={<span class="text-xs leading-snug break-all">{raw}</span>}
          >
            <div class="grid grid-cols-2 gap-1 flex-1 min-w-0">
              <For each={entries}>
                {([key, value]) => (
                  <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px] min-w-0">
                    <span class="truncate text-muted">{key}</span>
                    <span class="font-mono">{String(value)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      )
    }

    // HumanGate 触发点：gate_id + reasons
    if (ev.type === "human_gate") {
      const gate = evField(ev, "gate") as { gate_id?: unknown; reasons?: unknown } | undefined
      const gateId = typeof gate?.gate_id === "string" ? gate.gate_id : ""
      const reasons = Array.isArray(gate?.reasons) ? (gate?.reasons as unknown[]).map(String) : []
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all min-w-0">
            <span class="text-yellow-600">{`等待人工审批${gateId ? `（${gateId}）` : ""}`}</span>
            <For each={reasons}>
              {(reason) => <span class="block text-[10px] text-muted">{reason}</span>}
            </For>
          </span>
        </div>
      )
    }

    // 结构化产出：默认折叠，展开显示 JSON
    if (ev.type === "output_data") {
      const output = evField(ev, "output_data")
      const json = output === undefined || output === null ? "" : JSON.stringify(output, null, 2)
      return (
        <button class={openButtonClass} onClick={() => toggle(index)}>
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all min-w-0">
            {"产出数据"}
            <Show when={open() && json}>
              <pre class="mt-1 text-[10px] leading-relaxed bg-black/10 rounded px-1.5 py-1 whitespace-pre-wrap break-all overflow-auto max-h-48">
                {json}
              </pre>
            </Show>
          </span>
        </button>
      )
    }

    // 产物：路径 + 桌面 openPath 打开
    if (ev.type === "artifact") {
      const path = evText(ev, "path")
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <Show
            when={canOpenArtifact() && path}
            fallback={<span class="text-xs font-mono break-all min-w-0">{path}</span>}
          >
            <button
              class="text-xs font-mono break-all min-w-0 text-left text-primary underline underline-offset-2 cursor-pointer"
              onClick={() => openArtifact(path)}
            >
              {path}
            </button>
          </Show>
        </div>
      )
    }

    // 错误事件：红色错误行
    if (ev.type === "error") {
      const message = evText(ev, "error")
      return (
        <div class="flex items-start gap-1.5 py-0.5">
          <span class="shrink-0">{icon}</span>
          <span class="text-xs leading-snug break-all text-red-600">{message || "未知错误"}</span>
        </div>
      )
    }

    // 其余事件类型（skill_loaded / node_update / 未知）：默认行
    return (
      <div class="flex items-start gap-1.5 py-0.5">
        <span class="shrink-0">{icon}</span>
        <span class="text-xs leading-snug break-all text-muted">{ev.type}</span>
      </div>
    )
  }

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
            {(ev, i) => renderEvent(ev, i())}
          </For>
          <Show when={trace()!.error}>
            <div class="mt-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-600 break-all">
              ❌ {trace()!.error}
            </div>
          </Show>
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
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [resuming, setResuming] = createSignal<GateDecision | null>(null)

  // 乐观状态：新结果到达（离开 waiting_for_human）或面板卸载时清除
  createEffect(() => {
    if (trace()?.status !== "waiting_for_human") setResuming(null)
  })
  onCleanup(() => setResuming(null))

  /**
   * 审批 → resume：向 run_agent 结果所属的 session 发一条结构化短指令，
   * 由 Agent 调 run_agent(resume) 工具恢复执行。用 promptAsync（立即返回，
   * 不阻塞等整轮 agent 回合完成）。
   */
  const sendDecision = async (decision: GateDecision) => {
    const sessionId = _sessionId()
    const threadId = trace()?.thread_id
    if (!sessionId || !threadId || resuming()) return
    setResuming(decision)
    try {
      await serverSDK().client.session.promptAsync({
        sessionID: sessionId,
        parts: [
          {
            type: "text",
            text: `调用 run_agent 工具恢复执行：thread_id=${threadId}，decision=${decision}，group=${_group()}。不要做其他事。`,
          },
        ],
      })
      showToast({ title: language.t("quantcode.gate.resumeSent"), variant: "success" })
    } catch {
      setResuming(null)
      showToast({ title: language.t("quantcode.gate.resumeFailed"), variant: "error" })
    }
  }

  const gate = () => trace()?.gate
  const gateRiskEntries = () => {
    const metrics = gate()?.risk_metrics
    return metrics && typeof metrics === "object" ? Object.entries(metrics) : []
  }
  const defaultDecision = () => gate()?.decision_schema?.default

  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        HumanGate
      </div>
      <Switch>
        <Match when={trace()?.status === "waiting_for_human"}>
          <div class="rounded border border-yellow-400/40 bg-yellow-50/5 p-3 space-y-2">
            <div class="flex items-center gap-2 text-yellow-500 font-medium text-xs">
              ⏸️ {language.t("quantcode.gate.waitingApproval")}
            </div>
            <Show when={gate()?.gate_id}>
              <div class="text-xs text-muted font-mono truncate">gate_id: {gate()!.gate_id}</div>
            </Show>
            <div class="text-xs text-muted">Thread: {trace()!.thread_id}</div>
            <For each={gate()?.reasons ?? []}>
              {(reason) => (
                <div class="text-xs bg-yellow-500/10 rounded px-2 py-1">{reason}</div>
              )}
            </For>
            <Show when={gateRiskEntries().length > 0}>
              <div class="text-[11px] text-muted uppercase tracking-wide">
                {language.t("quantcode.gate.riskMetrics")}
              </div>
              <div class="grid grid-cols-2 gap-1">
                <For each={gateRiskEntries()}>
                  {([key, value]) => (
                    <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px] min-w-0">
                      <span class="truncate text-muted">{key}</span>
                      <span class="font-mono">{String(value)}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={defaultDecision() === "reject"}>
              <div class="text-[10px] text-yellow-600">
                ⚠ {language.t("quantcode.gate.defaultRejectHint")}
              </div>
            </Show>
            <Show
              when={resuming() === null}
              fallback={
                <div class="text-xs text-primary pt-1">
                  ⏳ {language.t("quantcode.gate.resuming")}
                </div>
              }
            >
              <div class="flex gap-2 pt-1">
                <button
                  class="flex-1 rounded bg-green-600/90 hover:bg-green-600 px-2 py-1 text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-50"
                  disabled={!trace()!.thread_id || !_sessionId()}
                  onClick={() => void sendDecision("approve")}
                >
                  {language.t("quantcode.gate.approve")}
                </button>
                <button
                  class="flex-1 rounded bg-red-600/90 hover:bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-50"
                  disabled={!trace()!.thread_id || !_sessionId()}
                  onClick={() => void sendDecision("reject")}
                >
                  {language.t("quantcode.gate.reject")}
                </button>
              </div>
            </Show>
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
                  {evText(ev, "tool") || evText(ev, "tool_name")}
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
          resume：在 HumanGate 面板点 Approve / Reject
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子面板：Monitor（会话内 run 聚合 — ponytail 最小闭环）
//
// 数据源说明（诚实边界）：浏览器沙箱读不到 .quantcode/metrics.jsonl，面板
// 只聚合本会话内存里的 run_agent 结果（_threadHistory，AG-09 引入）。
// 跨会话 / 全量历史走 list_runs 只读 MCP 工具（对话中调用）。
// ---------------------------------------------------------------------------

type SessionRunStats = {
  runs: number
  success: number
  errors: number
  avgToolCalls: number
  entries: { threadId: string; status: string; toolCalls: number; error: string }[]
}

function computeSessionStats(history: RunAgentResult[]): SessionRunStats {
  const entries = history.map((r) => ({
    threadId: r.thread_id ?? "",
    status: r.status,
    toolCalls: (r.execution_trace ?? []).filter((ev) => ev.type === "tool_call").length,
    error: r.error ?? "",
  }))
  const total = entries.length
  const success = entries.filter((e) => e.status === "completed").length
  const errors = entries.filter((e) => e.status === "error" || e.status === "rejected").length
  const avgToolCalls = total > 0 ? entries.reduce((acc, e) => acc + e.toolCalls, 0) / total : 0
  return { runs: total, success, errors, avgToolCalls, entries }
}

function MonitorPanel(): JSX.Element {
  const history = _threadHistory
  const language = useLanguage()
  const stats = () => computeSessionStats(history())
  const pct = (n: number): string => (n * 100).toFixed(0)

  return (
    <div class="p-3 text-sm">
      <div class="font-medium text-[11px] uppercase tracking-wide text-muted mb-2">
        {language.t("quantcode.monitor.sessionAggregate")}
      </div>
      <Show
        when={stats().runs > 0}
        fallback={<div class="text-muted text-xs">{language.t("quantcode.monitor.empty")}</div>}
      >
        <div class="grid grid-cols-2 gap-1">
          <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">
            <span class="text-muted">{language.t("quantcode.monitor.runs")}</span>
            <span class="font-mono">{stats().runs}</span>
          </div>
          <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">
            <span class="text-muted">{language.t("quantcode.monitor.successRate")}</span>
            <span class="font-mono text-green-600">{`${pct(stats().success / stats().runs)}%`}</span>
          </div>
          <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">
            <span class="text-muted">{language.t("quantcode.monitor.avgToolCalls")}</span>
            <span class="font-mono">{stats().avgToolCalls.toFixed(1)}</span>
          </div>
          <div class="flex items-center justify-between gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">
            <span class="text-muted">{language.t("quantcode.monitor.errorRate")}</span>
            <span class={`font-mono ${stats().errors > 0 ? "text-red-600" : ""}`}>
              {`${pct(stats().errors / stats().runs)}%`}
            </span>
          </div>
        </div>
        <div class="mt-2 text-[11px] text-muted uppercase tracking-wide">
          {language.t("quantcode.monitor.recentRuns")}
        </div>
        <div class="mt-1 space-y-1 max-h-48 overflow-auto">
          <For each={stats().entries}>
            {(entry) => (
              <div class="rounded border border-border px-2 py-1 text-xs flex items-center gap-2 min-w-0">
                <span
                  class={`shrink-0 font-mono text-[10px] ${
                    entry.status === "completed"
                      ? "text-green-600"
                      : entry.status === "waiting_for_human"
                        ? "text-yellow-600"
                        : "text-red-600"
                  }`}
                >
                  {entry.status}
                </span>
                <span class="font-mono text-[10px] text-muted truncate">{entry.threadId}</span>
                <span class="ml-auto shrink-0 font-mono text-[10px] text-muted">
                  {`🔧${entry.toolCalls}`}
                </span>
                <Show when={entry.error}>
                  <span class="text-[10px] text-red-600 truncate max-w-[80px]">
                    {entry.error}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="mt-2 text-[10px] text-muted">
          {language.t("quantcode.monitor.crossSessionHint")}
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主面板：Tab 切换六个子面板
// ---------------------------------------------------------------------------

/** 组 → resume 指令上下文：当前组作为词带上（P1-12） */
const QUANTCODE_GROUPS = ["model", "risk", "factor", "fundamental", "strategy", "options"] as const

type TabId = "compose" | "tasks" | "gate" | "schema" | "memory" | "resume" | "monitor"

const TABS: { id: TabId; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "tasks", label: "任务树" },
  { id: "gate", label: "HumanGate" },
  { id: "schema", label: "Schema" },
  { id: "memory", label: "Memory" },
  { id: "resume", label: "Resume" },
  { id: "monitor", label: "Monitor" },
]

export function QuantCodePanel(): JSX.Element {
  const language = useLanguage()
  const [activeTab, setActiveTab] = createSignal<TabId>("compose")
  /** P1-12：标识一次组切换已经发生，只显示一次 hint */
  const [switched, setSwitched] = createSignal(false)

  onMount(() => setQuantCodeTraceListener(handleQuantCodeTracePayload))
  onCleanup(() => setQuantCodeTraceListener(null))

  const selectGroup = (group: string) => {
    if (_group() === group) return
    setQuantCodeGroup(group)
    setSwitched(true)
  }

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

      {/* Group selector + badge */}
      <div class="px-3 py-1 border-b border-border space-y-1">
        <div class="flex items-center gap-1 flex-wrap text-[10px] text-muted">
          <span class="shrink-0">{language.t("quantcode.group.label")}</span>
          <For each={QUANTCODE_GROUPS}>
            {(group) => (
              <button
                class={[
                  "px-1.5 py-0.5 rounded font-mono transition-colors cursor-pointer",
                  _group() === group
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
                onClick={() => selectGroup(group)}
                aria-pressed={_group() === group}
              >
                {group}
              </button>
            )}
          </For>
          <Show when={_trace()?.thread_id}>
            <span class="shrink-0">·</span>
            <span class="font-mono truncate max-w-[120px] inline-block align-bottom">
              {_trace()!.thread_id}
            </span>
          </Show>
        </div>
        <Show when={switched()}>
          <div class="text-[10px] text-muted leading-snug">
            {language.t("quantcode.group.switchHint")}
          </div>
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
          <Match when={activeTab() === "monitor"}>
            <MonitorPanel />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
