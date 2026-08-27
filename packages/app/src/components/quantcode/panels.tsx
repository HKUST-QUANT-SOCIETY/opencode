/**
 * QuantCode research workspace.
 *
 * The module-level trace store is intentionally preserved so MCP tool results,
 * HumanGate resumes, and the full-screen workspace share one source of truth.
 */
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { buildResearchInstruction, buildResumeInstruction, QUANTCODE_GROUPS, type QuantCodeGroup } from "./instructions"
import { isRunAgentResult, type RunAgentResult, type TraceEvent } from "./result-contract"
import { submitQuantCodeInstruction, type QuantCodeSubmissionHandler } from "./submission"
import "./panels.css"

const [_trace, setTrace] = createSignal<RunAgentResult | null>(null)
const [_group, setGroup] = createSignal("factor")
const [_threadHistory, setThreadHistory] = createSignal<RunAgentResult[]>([])

try {
  const raw = localStorage.getItem("quantcode:thread_cache")
  if (raw) {
    const parsed: unknown = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed.filter(isRunAgentResult) : []
    if (items[0]) {
      setTrace(items[0])
      setThreadHistory(items)
    }
  }
} catch {
  // Local storage is unavailable in SSR and hardened browser contexts.
}

function mergeTraceEvents(existing: TraceEvent[], incoming: TraceEvent[]) {
  const events = new Map<string, TraceEvent>()
  for (const event of existing) events.set(`${event.iteration ?? 0}:${event.seq ?? 0}`, event)
  for (const event of incoming) events.set(`${event.iteration ?? 0}:${event.seq ?? 0}`, event)
  return [...events.values()].sort((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
}

function mergeGate(
  current: RunAgentResult["gate"],
  incoming: RunAgentResult["gate"],
  decision?: string,
  history?: { decision: string; timestamp: number }[],
) {
  const entries = [...(current?.review_history ?? [])]
  for (const entry of history ?? []) {
    if (!entries.some((item) => item.decision === entry.decision && item.timestamp === entry.timestamp)) {
      entries.push(entry)
    }
  }
  if (decision && decision !== "auto" && !entries.some((item) => item.decision === decision)) {
    entries.push({ decision, timestamp: Date.now() })
  }
  const base = incoming ?? current
  return entries.length ? { ...base, review_history: entries } : base
}

export function updateQuantCodeTrace(result: RunAgentResult) {
  const enriched = { ...result, timestamp: result.timestamp ?? Date.now() }

  setThreadHistory((current) => {
    const index = current.findIndex((item) => enriched.thread_id && item.thread_id === enriched.thread_id)
    if (index === -1) {
      setTrace(enriched)
      return [enriched, ...current].slice(0, 50)
    }

    const previous = current[index]
    const merged = {
      ...previous,
      ...enriched,
      execution_trace: mergeTraceEvents(previous.execution_trace ?? [], enriched.execution_trace ?? []),
      gate: mergeGate(previous.gate, enriched.gate, enriched.human_decision, enriched.human_review_history),
    }
    const next = [...current]
    next[index] = merged
    setTrace(merged)
    return next
  })

  queueMicrotask(() => {
    try {
      localStorage.setItem("quantcode:thread_cache", JSON.stringify(_threadHistory().slice(0, 50)))
    } catch {
      // The workspace remains usable without persistence.
    }
  })
}

export function setQuantCodeGroup(group: string) {
  if (!QUANTCODE_GROUPS.includes(group as QuantCodeGroup)) return
  setGroup(group)
}

export function quantCodeGroup() {
  return _group() as QuantCodeGroup
}

const SKILLS = [
  { id: "auto-factor-evaluation", label: "Auto Factor Evaluation" },
  { id: "cross-section-research", label: "Cross-section Research" },
  { id: "risk-review", label: "Risk Review" },
  { id: "memory-recall", label: "Memory Recall" },
] as const

type DetailView = "compose" | "activity" | "gate" | "memory" | "settings"
type SubmitState = "idle" | "starting" | "submitted" | "error"

function readIdentity() {
  try {
    return localStorage.getItem("quantcode:ssh_identity") || "Quant Society Member"
  } catch {
    return "Quant Society Member"
  }
}

function taskFromRun(run: RunAgentResult) {
  const event = run.execution_trace?.find((item) => item.type === "agent_start")
  const task = event?.data?.task
  return typeof task === "string" && task.trim() ? task : `研究任务 ${run.thread_id?.slice(0, 8) ?? "untitled"}`
}

function formatTime(timestamp?: number) {
  if (!timestamp) return "刚刚"
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" })
}

function statusLabel(status: string) {
  if (status === "completed") return "已完成"
  if (status === "waiting_for_human") return "待审批"
  if (status === "error") return "异常"
  if (status === "rejected") return "已拒绝"
  return "运行中"
}

function eventTitle(type: string) {
  const titles: Record<string, string> = {
    agent_start: "研究已启动",
    skill_loaded: "Skill 已载入",
    node_update: "节点状态更新",
    llm_thought: "Agent 推理",
    tool_call: "工具调用",
    tool_result: "工具返回",
    risk_metrics: "风险指标",
    human_gate: "HumanGate",
    output_data: "结构化结果",
    artifact: "研究产物",
    agent_end: "研究完成",
    error: "执行异常",
  }
  return titles[type] ?? type
}

function eventSummary(event: TraceEvent) {
  const data = event.data ?? {}
  if (event.type === "agent_start" && typeof data.task === "string") return data.task
  if (event.type === "tool_call") return displayValue(data.tool_name ?? data.tool, "QuantCode tool")
  if (event.type === "artifact") return displayValue(data.artifact_ref ?? data.path, "Artifact")
  if (event.type === "error") return displayValue(data.error, "Unknown error")
  if (event.node) return event.node
  return event.flow_name ?? "QuantCode"
}

function displayValue(value: unknown, fallback: string) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return `${value}`
  return fallback
}

function eventIcon(type: string): IconProps["name"] {
  if (type === "agent_start") return "plus"
  if (type === "llm_thought") return "brain"
  if (type === "tool_call" || type === "tool_result") return "mcp"
  if (type === "risk_metrics" || type === "human_gate") return "review"
  if (type === "artifact") return "file-tree"
  if (type === "error") return "warning"
  if (type === "agent_end") return "check-small"
  return "code-lines"
}

function ActivityPanel(props: { onUseTask: (task: string) => void }): JSX.Element {
  const run = createMemo(() => _trace())
  const events = createMemo(() => run()?.execution_trace ?? [])

  return (
    <div class="qc-detail-body">
      <Show
        when={run()}
        fallback={
          <div class="qc-empty-state">
            <span class="qc-empty-index">00</span>
            <h3>还没有执行记录</h3>
            <p>发起一次研究后，Agent、工具调用和产物会按时间顺序出现在这里。</p>
          </div>
        }
      >
        {(item) => (
          <>
            <div class="qc-run-overview">
              <div>
                <span class={`qc-status qc-status-${item().status}`}>{statusLabel(item().status)}</span>
                <h3>{taskFromRun(item())}</h3>
              </div>
              <button type="button" class="qc-text-button" onClick={() => props.onUseTask(taskFromRun(item()))}>
                再次运行
                <Icon name="arrow-right" size="small" />
              </button>
            </div>
            <div class="qc-run-meta">
              <span>THREAD</span>
              <code>{item().thread_id ?? "pending"}</code>
              <span>{formatTime(item().timestamp)}</span>
            </div>
            <div class="qc-timeline">
              <For each={events()}>
                {(event, index) => (
                  <div class="qc-event-row">
                    <span class="qc-event-index">{String(index() + 1).padStart(2, "0")}</span>
                    <span class="qc-event-icon">
                      <Icon name={eventIcon(event.type)} size="small" />
                    </span>
                    <div>
                      <strong>{eventTitle(event.type)}</strong>
                      <p>{eventSummary(event)}</p>
                    </div>
                    <span class="qc-event-iteration">I{event.iteration ?? 0}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={(item().artifacts?.length ?? 0) > 0}>
              <div class="qc-detail-section">
                <span class="qc-section-label">ARTIFACTS</span>
                <For each={item().artifacts}>{(artifact) => <code class="qc-artifact">{artifact}</code>}</For>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function GatePanel(props: { onResume: (threadId: string, decision: "approve" | "reject") => void }): JSX.Element {
  const run = createMemo(() => _trace())
  const gate = createMemo(() => run()?.gate)
  const waiting = createMemo(() => run()?.status === "waiting_for_human" && !!gate())

  return (
    <div class="qc-detail-body">
      <Show
        when={gate()}
        fallback={
          <div class="qc-empty-state">
            <span class="qc-empty-index">OK</span>
            <h3>当前没有待处理的风险门</h3>
            <p>当研究触发仓位、回撤或尾部风险阈值时，审批请求会固定在这里。</p>
          </div>
        }
      >
        {(item) => (
          <>
            <span class={`qc-status ${waiting() ? "qc-status-waiting_for_human" : "qc-status-completed"}`}>
              {waiting() ? "等待人工判断" : "审批已记录"}
            </span>
            <h3 class="qc-gate-title">{item().message ?? "HumanGate risk review"}</h3>
            <div class="qc-detail-section">
              <span class="qc-section-label">REASONS</span>
              <For each={item().reasons ?? []}>
                {(reason, index) => (
                  <div class="qc-reason-row">
                    <span>{String(index() + 1).padStart(2, "0")}</span>
                    <p>{reason}</p>
                  </div>
                )}
              </For>
            </div>
            <div class="qc-detail-section">
              <span class="qc-section-label">RISK METRICS</span>
              <pre class="qc-code-block">{JSON.stringify(item().risk_metrics ?? {}, null, 2)}</pre>
            </div>
            <Show when={waiting() && run()?.thread_id}>
              <div class="qc-gate-actions">
                <button
                  type="button"
                  class="qc-button qc-button-primary"
                  onClick={() => props.onResume(run()!.thread_id!, "approve")}
                >
                  批准继续
                </button>
                <button
                  type="button"
                  class="qc-button qc-button-secondary"
                  onClick={() => props.onResume(run()!.thread_id!, "reject")}
                >
                  拒绝并停止
                </button>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function MemoryPanel(): JSX.Element {
  return (
    <div class="qc-detail-body">
      <div class="qc-memory-intro">
        <span class="qc-section-label">RESEARCH MEMORY</span>
        <h3>让下一次研究从团队已经知道的地方开始。</h3>
        <p>Memory 目前保持只读。可查看已沉淀的决策、产物索引与结构化输出，写入策略将在服务端契约稳定后开放。</p>
      </div>
      <div class="qc-memory-grid">
        <div>
          <span>01</span>
          <strong>研究结论</strong>
          <p>按因子、模型与策略组织的长期结论。</p>
        </div>
        <div>
          <span>02</span>
          <strong>决策记录</strong>
          <p>HumanGate 判断与审阅历史。</p>
        </div>
        <div>
          <span>03</span>
          <strong>产物索引</strong>
          <p>报告、指标和回测结果的可追溯入口。</p>
        </div>
      </div>
      <div class="qc-detail-section">
        <span class="qc-section-label">LOCAL STORE</span>
        <code class="qc-artifact">.quantcode/memory.db</code>
      </div>
      <Show when={_trace()?.output_data}>
        <div class="qc-detail-section">
          <span class="qc-section-label">LATEST STRUCTURED OUTPUT</span>
          <pre class="qc-code-block">{JSON.stringify(_trace()?.output_data, null, 2)}</pre>
        </div>
      </Show>
    </div>
  )
}

function SettingsPanel(props: {
  skill: string
  onSkillChange: (skill: string) => void
  serverName: string
  serverReady: boolean
  serverTransport: string
}): JSX.Element {
  return (
    <div class="qc-detail-body">
      <div class="qc-setting-row">
        <div>
          <span class="qc-section-label">SSH IDENTITY</span>
          <strong>{readIdentity()}</strong>
          <p>身份名称保存在本机；服务器认证由 OpenCode 连接配置管理。</p>
        </div>
        <span class="qc-connection-pill" classList={{ "is-disconnected": !props.serverReady }}>
          <i /> {props.serverReady ? "已连接" : "未连接"}
        </span>
      </div>
      <label class="qc-field-label" for="qc-settings-group">
        研究组
      </label>
      <select
        id="qc-settings-group"
        class="qc-select-wide"
        value={_group()}
        onChange={(event) => setQuantCodeGroup(event.currentTarget.value)}
      >
        <For each={QUANTCODE_GROUPS}>{(group) => <option value={group}>{group}</option>}</For>
      </select>
      <label class="qc-field-label" for="qc-settings-skill">
        默认 Skill
      </label>
      <select
        id="qc-settings-skill"
        class="qc-select-wide"
        value={props.skill}
        onChange={(event) => props.onSkillChange(event.currentTarget.value)}
      >
        <For each={SKILLS}>{(skill) => <option value={skill.id}>{skill.label}</option>}</For>
      </select>
      <div class="qc-detail-section">
        <span class="qc-section-label">EXECUTION TARGET</span>
        <div class="qc-server-line">
          <span>{props.serverName}</span>
          <code>{props.serverTransport}</code>
        </div>
      </div>
    </div>
  )
}

export type QuantCodePanelProps = {
  onClose?: () => void
  /**
   * Root-home entry point. Session panels keep the default prompt bridge;
   * the standalone home delegates submission to the draft/session router.
   */
  onSubmitInstruction?: QuantCodeSubmissionHandler
}

export function QuantCodePanel(props: QuantCodePanelProps = {}): JSX.Element {
  const prompt = props.onSubmitInstruction ? undefined : usePrompt()
  const server = useServer()
  const [state, setState] = createStore({
    view: "compose" as DetailView,
    task: "",
    skill: SKILLS[0].id as string,
    submit: "idle" as SubmitState,
    error: "",
  })
  let taskInput: HTMLTextAreaElement | undefined
  let shell: HTMLDivElement | undefined
  let stage: HTMLElement | undefined
  let fieldCanvas: HTMLCanvasElement | undefined
  let focusLens: HTMLDivElement | undefined
  let sharpBrand: HTMLDivElement | undefined

  const selectedSkill = createMemo(() => SKILLS.find((skill) => skill.id === state.skill) ?? SKILLS[0])
  const gateWaiting = createMemo(() => _trace()?.status === "waiting_for_human")
  const serverName = createMemo(() => server.name || "当前服务器")
  const serverReady = createMemo(() => server.ready())
  const serverTransport = createMemo(() => (server.isLocal() ? "本地 sidecar" : server.key))
  const recent = createMemo(() => {
    const history = _threadHistory().slice(0, 3)
    if (history.length) {
      return history.map((run) => ({
        id: run.thread_id ?? `${run.timestamp}`,
        title: taskFromRun(run),
        meta: `${run.execution_trace?.length ?? 0} steps · ${run.artifacts?.length ?? 0} artifacts`,
        status: statusLabel(run.status),
        time: formatTime(run.timestamp),
        template: false,
      }))
    }
    return [
      {
        id: "pb-roe",
        title: "PB–ROE 中性化因子扫描",
        meta: "Factor · Auto Factor Evaluation",
        status: "模板",
        time: "01",
        template: true,
      },
      {
        id: "liquidity",
        title: "短周期流动性因子复核",
        meta: "Risk · Cross-section Research",
        status: "模板",
        time: "02",
        template: true,
      },
      {
        id: "vol-surface",
        title: "期权波动率曲面异常",
        meta: "Options · Risk Review",
        status: "模板",
        time: "03",
        template: true,
      },
    ]
  })

  const instruction = () => {
    return buildResearchInstruction({
      task: state.task.trim(),
      group: _group(),
      skillLabel: selectedSkill().label,
    })
  }

  const submitInstruction = (content: string, nextView: DetailView = "compose") => {
    setState({ submit: "starting", error: "" })

    if (props.onSubmitInstruction) {
      void submitQuantCodeInstruction(props.onSubmitInstruction, content).then((result) => {
        if (result === "unavailable") {
          setState({ submit: "error", error: "请先连接研究服务器并选择一个项目。" })
          return
        }
        if (result === "failed") {
          setState({ submit: "error", error: "研究启动失败，请重试。" })
          return
        }
        setState({ view: nextView, submit: "submitted" })
      })
      return
    }

    if (!prompt) {
      setState({ submit: "error", error: "研究输入尚未就绪，请稍后重试。" })
      return
    }

    prompt.set([{ type: "text", content, start: 0, end: content.length }], content.length)

    requestAnimationFrame(() => {
      const form = document.querySelector<HTMLFormElement>(
        '[data-component="session-composer"], [data-component="session-new-composer"]',
      )
      if (!form) {
        setState({ view: "compose", submit: "error", error: "当前会话输入框尚未就绪，请稍后重试。" })
        return
      }
      form.requestSubmit()
      setState({ view: nextView, submit: "submitted" })
    })
  }

  const submitResearch = () => {
    if (!state.task.trim() || state.submit === "starting") return
    submitInstruction(instruction())
  }

  const resumeResearchGate = (threadId: string, decision: "approve" | "reject") => {
    if (state.submit === "starting") return
    submitInstruction(buildResumeInstruction(threadId, decision), "activity")
  }

  const focusComposer = (task?: string) => {
    if (task) setState("task", task)
    setState("view", "compose")
    requestAnimationFrame(() => taskInput?.focus())
  }

  onMount(() => {
    if (!shell || !stage || !fieldCanvas || !focusLens || !sharpBrand) return
    const elements = { shell, stage, fieldCanvas, focusLens, sharpBrand }
    const field = { disposed: false, dispose: () => {} }
    void import("./lens-field").then(async (module) => {
      const dispose = await module.createQuantCodeLensField({
        canvas: elements.fieldCanvas,
        stage: elements.stage,
        shell: elements.shell,
        lens: elements.focusLens,
        sharpBrand: elements.sharpBrand,
      })
      if (!field.disposed) {
        field.dispose = dispose
        return
      }
      dispose()
    })
    onCleanup(() => {
      field.disposed = true
      field.dispose()
    })
  })

  const navItems: { id: DetailView; label: string; icon: IconProps["name"] }[] = [
    { id: "compose", label: "新建研究", icon: "plus" },
    { id: "activity", label: "执行记录", icon: "checklist" },
    { id: "gate", label: "HumanGate", icon: "review" },
    { id: "memory", label: "Memory", icon: "brain" },
  ]

  return (
    <div ref={shell} class="qc-shell" data-quantcode-workspace="true">
      <a class="qc-skip-link" href="#qc-research-prompt">
        跳到研究输入
      </a>
      <aside class="qc-rail" aria-label="QuantCode 导航">
        <button type="button" class="qc-mark" aria-label="QuantCode 首页" onClick={() => setState("view", "compose")}>
          QC
        </button>
        <nav>
          <For each={navItems}>
            {(item) => (
              <button
                type="button"
                class="qc-rail-button"
                classList={{ "is-active": state.view === item.id }}
                aria-label={item.label}
                aria-pressed={state.view === item.id}
                title={item.label}
                onClick={() => setState("view", item.id)}
              >
                <Icon name={item.icon} size="normal" />
                <Show when={item.id === "gate" && gateWaiting()}>
                  <span class="qc-rail-alert" />
                </Show>
              </button>
            )}
          </For>
        </nav>
        <div class="qc-rail-footer">
          <button
            type="button"
            class="qc-rail-button"
            classList={{ "is-active": state.view === "settings" }}
            aria-label="QuantCode 设置"
            title="设置"
            onClick={() => setState("view", "settings")}
          >
            <Icon name="settings-gear" size="normal" />
          </button>
          <Show when={props.onClose}>
            <button
              type="button"
              class="qc-rail-button"
              aria-label="关闭 QuantCode 工作区"
              title="关闭 QuantCode 工作区"
              onClick={() => props.onClose?.()}
            >
              <Icon name="close" size="normal" />
            </button>
          </Show>
        </div>
      </aside>

      <main class="qc-main">
        <header class="qc-identity-bar">
          <div class="qc-identity">
            <span>{readIdentity()}</span>
            <i />
            <strong>{_group()}</strong>
          </div>
          <div class="qc-environment">
            <span>{serverName()}</span>
            <i />
            <span class="qc-connected" classList={{ "is-disconnected": !serverReady() }}>
              <b /> {serverReady() ? "已连接" : "未连接"}
            </span>
          </div>
        </header>

        <div class="qc-canvas">
          <section
            ref={stage}
            class="qc-stage"
            aria-labelledby="qc-lens-title"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) taskInput?.blur()
            }}
          >
            <div class="qc-brand qc-brand-blurred" aria-hidden="true">
              QUANTCODE
            </div>
            <div class="qc-brand qc-brand-dotted" aria-hidden="true">
              QUANTCODE
            </div>
            <div ref={sharpBrand} class="qc-brand qc-brand-sharp" aria-hidden="true">
              QUANTCODE
            </div>
            <canvas ref={fieldCanvas} class="qc-particle-field" aria-hidden="true" />
            <div ref={focusLens} class="qc-focus-lens" aria-hidden="true" />
            <div class="qc-lens-action">
              <button type="button" class="qc-lens-title-button" onClick={() => focusComposer()}>
                <h1 id="qc-lens-title">新建多智能体研究</h1>
              </button>
              <button type="button" class="qc-lens-meta-row" onClick={() => setState("view", "settings")}>
                <span>组:</span>
                <strong>{_group()}</strong>
                <small>· {selectedSkill().label}</small>
                <Icon name="chevron-down" size="small" />
              </button>
              <button type="button" class="qc-lens-meta-row" onClick={() => setState("view", "settings")}>
                <span>SSH:</span>
                <strong>{serverName()}</strong>
                <small>{serverReady() ? "已连接" : "未连接"}</small>
                <Icon name="chevron-down" size="small" />
              </button>
            </div>
          </section>

          <section class="qc-compose-zone" id="qc-research-prompt" aria-label="研究任务">
            <div class="qc-compose-heading">
              <span>RESEARCH PROMPT</span>
              <span>
                {_group().toUpperCase()} / {serverName().toUpperCase()}
              </span>
            </div>
            <div class="qc-composer" classList={{ "has-error": state.submit === "error" }}>
              <label for="qc-task">今天研究什么？</label>
              <textarea
                id="qc-task"
                ref={taskInput}
                value={state.task}
                rows={2}
                placeholder="描述任务，或输入 / 调用 Skill."
                onInput={(event) => {
                  setState({ task: event.currentTarget.value, submit: "idle", error: "" })
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitResearch()
                }}
              />
              <div class="qc-composer-actions">
                <label class="qc-skill-select">
                  <Icon name="brain" size="small" />
                  <span class="sr-only">选择 Skill</span>
                  <select value={state.skill} onChange={(event) => setState("skill", event.currentTarget.value)}>
                    <For each={SKILLS}>{(skill) => <option value={skill.id}>{skill.label}</option>}</For>
                  </select>
                </label>
                <div class="qc-submit-cluster">
                  <span>⌘ ENTER</span>
                  <button
                    type="button"
                    disabled={!state.task.trim() || state.submit === "starting"}
                    onClick={submitResearch}
                  >
                    <Show
                      when={state.submit === "starting"}
                      fallback={
                        <>
                          开始研究 <Icon name="arrow-right" size="small" />
                        </>
                      }
                    >
                      正在启动
                    </Show>
                  </button>
                </div>
              </div>
            </div>
            <div class="qc-submit-state" aria-live="polite">
              <Switch>
                <Match when={state.submit === "submitted"}>
                  <span class="is-success">研究已提交到 {_group()} Multi-Agent 流。</span>
                </Match>
                <Match when={state.submit === "error"}>
                  <span class="is-error">{state.error}</span>
                </Match>
                <Match when={state.submit === "starting"}>
                  <span>正在建立任务上下文…</span>
                </Match>
              </Switch>
            </div>
          </section>

          <section class="qc-recents" aria-labelledby="qc-recents-title">
            <div class="qc-recents-heading">
              <h2 id="qc-recents-title">{_threadHistory().length ? "最近研究" : "研究模板"}</h2>
              <button type="button" onClick={() => setState("view", "activity")}>
                查看全部 <Icon name="arrow-right" size="small" />
              </button>
            </div>
            <div class="qc-recent-list">
              <For each={recent()}>
                {(item, index) => (
                  <button
                    type="button"
                    class="qc-recent-row"
                    onClick={() => (item.template ? focusComposer(item.title) : setState("view", "activity"))}
                  >
                    <span class="qc-recent-index">{String(index() + 1).padStart(2, "0")}</span>
                    <span class="qc-recent-copy">
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </span>
                    <span class="qc-recent-status">{item.status}</span>
                    <time>{item.time}</time>
                    <Icon name="arrow-right" size="small" />
                  </button>
                )}
              </For>
            </div>
          </section>

          <Show when={state.view !== "compose"}>
            <section class="qc-detail-panel" aria-label="QuantCode 详情">
              <div class="qc-detail-header">
                <div>
                  <span>QUANTCODE / {state.view.toUpperCase()}</span>
                  <h2>
                    {state.view === "activity"
                      ? "执行记录"
                      : state.view === "gate"
                        ? "HumanGate"
                        : state.view === "memory"
                          ? "Memory"
                          : "工作区设置"}
                  </h2>
                </div>
                <button type="button" aria-label="关闭详情" onClick={() => setState("view", "compose")}>
                  <Icon name="close" size="normal" />
                </button>
              </div>
              <Switch>
                <Match when={state.view === "activity"}>
                  <ActivityPanel onUseTask={focusComposer} />
                </Match>
                <Match when={state.view === "gate"}>
                  <GatePanel onResume={resumeResearchGate} />
                </Match>
                <Match when={state.view === "memory"}>
                  <MemoryPanel />
                </Match>
                <Match when={state.view === "settings"}>
                  <SettingsPanel
                    skill={state.skill}
                    onSkillChange={(skill) => setState("skill", skill)}
                    serverName={serverName()}
                    serverReady={serverReady()}
                    serverTransport={serverTransport()}
                  />
                </Match>
              </Switch>
            </section>
          </Show>
        </div>
      </main>
    </div>
  )
}
