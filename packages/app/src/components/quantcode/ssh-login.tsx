/**
 * F-05 SSH 登录界面：完整登录流四态（表单 → 连接 → 已连接 / 失败）。
 * 纯 DOM 构建（沿 settings-supplier / notifications 模式，bun test 兼容），
 * 状态切换由内部 render() 重绘；panels.tsx settings 分支挂载。
 *
 * 安全约束：私钥仅存在于密码型 input 的内存值里，连接尝试结束后随表单重绘丢弃；
 * 不写入 localStorage / 任何 store，也不回显。
 */

export type SshLoginStatus = "form" | "connecting" | "connected" | "error"

export type SshConnectInput = {
  host: string
  user: string
  /** 仅经表单内存传给后端（W3 ssh_status 元工具），UI 层绝不持久化 */
  privateKey: string
  /** 连接过程中逐行追加日志 */
  log: (line: string) => void
}

export type SshConnectResult =
  | { status: "connected"; fingerprint: string; groups?: string[] }
  | { status: "error"; reason: string }

export type SshConnectFn = (input: SshConnectInput) => Promise<SshConnectResult>

/**
 * Isolated consumers keep a deterministic unavailable fallback. The production
 * QuantCode panel injects the server-backed implementation from api.ts.
 */
export const stubSshConnect: SshConnectFn = async ({ log }) => {
  log("waiting for ssh_status (W3) …")
  return { status: "error", reason: "unavailable" }
}

/** 已知失败原因 → i18n key；未知原因原样展示（后端可下发更具体文案）。 */
const REASON_KEYS: Record<string, string> = {
  key_rejected: "quantcode.ssh.reason.key_rejected",
  host_unreachable: "quantcode.ssh.reason.host_unreachable",
  unavailable: "quantcode.ssh.reason.unavailable",
}

export type SshLoginProps = {
  /** i18n：panels 传 language.t（key 见 quantcode.ssh.*，18 locale 均已补齐） */
  t: (key: string) => string
  /** 可注入的连接实现；默认 stub（见上） */
  connect?: SshConnectFn
}

export function SshLoginView(props: SshLoginProps): HTMLElement {
  const t = props.t
  const connect = props.connect ?? stubSshConnect
  const root = document.createElement("div")
  root.className = "qc-ssh"
  root.style.cssText = "display:grid;gap:10px;justify-items:start;"

  let status: SshLoginStatus = "form"
  let host = ""
  let user = ""
  let fingerprint = ""
  let groups: string[] = []
  let reason = ""
  let logs: string[] = []
  let logEl: HTMLPreElement | undefined

  const appendLog = (line: string) => {
    logs.push(line)
    if (logEl) logEl.textContent = logs.join("\n")
  }

  // ponytail: 复用 qc-select-wide（select 样式）当输入框样式、qc-gate-actions 排按钮，免动 panels.css
  const field = (id: string, labelKey: string, type?: string) => {
    const label = document.createElement("label")
    label.className = "qc-field-label"
    label.htmlFor = id
    label.textContent = t(labelKey)
    const input = document.createElement("input")
    input.id = id
    input.className = "qc-select-wide"
    input.autocomplete = "off"
    input.spellcheck = false
    if (type) input.type = type
    return { label, input }
  }

  const renderForm = () => {
    const { label: hostLabel, input: hostInput } = field("qc-ssh-host", "quantcode.ssh.host")
    hostInput.value = host
    const { label: userLabel, input: userInput } = field("qc-ssh-user", "quantcode.ssh.user")
    userInput.value = user
    const { label: keyLabel, input: keyInput } = field("qc-ssh-key", "quantcode.ssh.privateKey", "password")

    const hint = document.createElement("p")
    hint.className = "qc-ssh-hint"
    hint.style.cssText = "margin:0;color:var(--qc-muted);font-size:10px;"
    hint.textContent = t("quantcode.ssh.privateKeyHint")

    const submit = document.createElement("button")
    submit.type = "button"
    submit.className = "qc-button qc-button-primary"
    submit.textContent = t("quantcode.ssh.connect")
    const syncDisabled = () => {
      submit.disabled = !(hostInput.value.trim() && userInput.value.trim() && keyInput.value.trim())
    }
    syncDisabled()
    for (const input of [hostInput, userInput, keyInput]) input.addEventListener("input", syncDisabled)

    submit.addEventListener("click", () => {
      host = hostInput.value.trim()
      user = userInput.value.trim()
      const privateKey = keyInput.value
      status = "connecting"
      logs = [`ssh ${user}@${host}`, t("quantcode.ssh.logWaiting")]
      render()
      void attempt(privateKey)
    })

    const actions = document.createElement("div")
    actions.className = "qc-gate-actions"
    actions.append(submit)
    root.replaceChildren(hostLabel, hostInput, userLabel, userInput, keyLabel, keyInput, hint, actions)
  }

  const attempt = async (privateKey: string) => {
    // privateKey 只在本函数作用域内存活，resolve 后即被丢弃
    const result = await connect({ host, user, privateKey, log: appendLog }).catch(
      (): SshConnectResult => {
        // 合同外异常（注入实现 throw）按网络不可达处理
        return { status: "error", reason: "host_unreachable" }
      },
    )
    if (result.status === "connected") {
      status = "connected"
      fingerprint = result.fingerprint
      groups = result.groups ?? []
    } else {
      status = "error"
      reason = result.reason
    }
    render()
  }

  const renderConnecting = () => {
    const pill = document.createElement("span")
    pill.className = "qc-connection-pill"
    const dot = document.createElement("i")
    dot.className = "qc-ssh-spinner"
    // ponytail: 全局 pulse-opacity keyframes（@opencode-ai/ui animations.css）做单点 spinner，免动 panels.css
    dot.style.animation = "pulse-opacity 1.2s ease-in-out infinite"
    pill.append(dot, document.createTextNode(t("quantcode.ssh.connecting")))

    logEl = document.createElement("pre")
    logEl.className = "qc-code-block qc-ssh-log"
    logEl.textContent = logs.join("\n")
    root.replaceChildren(pill, logEl)
  }

  const renderConnected = () => {
    const pill = document.createElement("span")
    pill.className = "qc-connection-pill"
    pill.append(document.createElement("i"), document.createTextNode(t("quantcode.ssh.connected")))

    const fpLabel = document.createElement("span")
    fpLabel.className = "qc-section-label"
    fpLabel.textContent = t("quantcode.ssh.fingerprint")
    const fp = document.createElement("code")
    fp.className = "qc-artifact qc-ssh-fingerprint"
    fp.textContent = fingerprint

    root.replaceChildren(pill, fpLabel, fp)

    if (groups.length > 0) {
      const groupLabel = document.createElement("span")
      groupLabel.className = "qc-section-label"
      groupLabel.textContent = t("quantcode.ssh.groups")
      const badgeRow = document.createElement("div")
      badgeRow.className = "qc-ssh-badges"
      badgeRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;"
      for (const group of groups) {
        const badge = document.createElement("span")
        badge.className = "qc-connection-pill qc-ssh-badge"
        badge.textContent = `${group} ${t("quantcode.ssh.groupSuffix")}`
        badgeRow.append(badge)
      }
      root.append(groupLabel, badgeRow)
    }

    const disconnect = document.createElement("button")
    disconnect.type = "button"
    disconnect.className = "qc-button qc-button-secondary"
    disconnect.textContent = t("quantcode.ssh.disconnect")
    disconnect.addEventListener("click", () => {
      status = "form"
      render()
    })
    const actions = document.createElement("div")
    actions.className = "qc-gate-actions"
    actions.append(disconnect)
    root.append(actions)
  }

  const renderFailed = () => {
    const chip = document.createElement("span")
    chip.className = "qc-status qc-status-error"
    chip.textContent = t("quantcode.ssh.failed")

    const detail = document.createElement("p")
    detail.className = "qc-ssh-reason"
    detail.style.cssText = "margin:0;font-size:11px;"
    detail.textContent = REASON_KEYS[reason] ? t(REASON_KEYS[reason]) : reason

    const retry = document.createElement("button")
    retry.type = "button"
    retry.className = "qc-button qc-button-primary"
    retry.textContent = t("quantcode.ssh.retry")
    // host/user 保留重填，私钥已随上次尝试丢弃，需重新输入
    retry.addEventListener("click", () => {
      status = "form"
      render()
    })
    const actions = document.createElement("div")
    actions.className = "qc-gate-actions"
    actions.append(retry)
    root.replaceChildren(chip, detail, actions)
  }

  const render = () => {
    logEl = undefined
    if (status === "form") renderForm()
    else if (status === "connecting") renderConnecting()
    else if (status === "connected") renderConnected()
    else renderFailed()
  }

  render()
  return root
}
