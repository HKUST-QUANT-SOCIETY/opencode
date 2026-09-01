import { describe, expect, test } from "bun:test"
import { SshLoginView, stubSshConnect, type SshConnectFn } from "./ssh-login"

/** 与 zh.ts 同文案的测试用 t（组件要求注入 i18n，见 quantcode.ssh.* keys）。 */
const ZH: Record<string, string> = {
  "quantcode.ssh.host": "主机",
  "quantcode.ssh.user": "用户名",
  "quantcode.ssh.privateKey": "私钥",
  "quantcode.ssh.privateKeyHint": "私钥仅在内存中传给后端，不会保存或回显。",
  "quantcode.ssh.connect": "连接",
  "quantcode.ssh.connecting": "正在连接…",
  "quantcode.ssh.logWaiting": "等待服务器响应…",
  "quantcode.ssh.connected": "已连接",
  "quantcode.ssh.fingerprint": "指纹",
  "quantcode.ssh.groups": "组绑定",
  "quantcode.ssh.groupSuffix": "组",
  "quantcode.ssh.disconnect": "断开",
  "quantcode.ssh.failed": "连接失败",
  "quantcode.ssh.retry": "重试",
  "quantcode.ssh.reason.key_rejected": "密钥被拒",
  "quantcode.ssh.reason.host_unreachable": "主机不可达",
  "quantcode.ssh.reason.unavailable": "SSH 连接服务尚未就绪",
}
const t = (key: string) => ZH[key] ?? key

const SECRET = "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-SECRET-DO-NOT-ECHO\n-----END OPENSSH PRIVATE KEY-----"

function mount(connect?: SshConnectFn) {
  const view = SshLoginView({ t, connect })
  document.body.append(view)
  return view
}

function fillForm(view: HTMLElement) {
  const host = view.querySelector<HTMLInputElement>("#qc-ssh-host")!
  const user = view.querySelector<HTMLInputElement>("#qc-ssh-user")!
  const key = view.querySelector<HTMLInputElement>("#qc-ssh-key")!
  host.value = "quant.internal"
  user.value = "analyst"
  key.value = SECRET
  for (const input of [host, user, key]) input.dispatchEvent(new Event("input"))
  return { host, user, key }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("SshLoginView", () => {
  test("form state: host/user/key inputs, private key is password-type and connect disabled until filled", () => {
    const view = mount()
    expect(view.querySelector<HTMLInputElement>("#qc-ssh-host")).toBeTruthy()
    expect(view.querySelector<HTMLInputElement>("#qc-ssh-user")).toBeTruthy()
    const key = view.querySelector<HTMLInputElement>("#qc-ssh-key")!
    expect(key.type).toBe("password")
    expect(key.autocomplete).toBe("off")

    const connect = view.querySelector<HTMLButtonElement>(".qc-button")!
    expect(connect.textContent).toBe("连接")
    expect(connect.disabled).toBe(true)
    fillForm(view)
    expect(connect.disabled).toBe(false)
    view.remove()
  })

  test("default stub: form → connecting (log) → failure state with retry, private key never echoed nor kept", async () => {
    expect(stubSshConnect).toBeTruthy()
    const view = mount()
    fillForm(view)
    view.querySelector<HTMLButtonElement>(".qc-button")!.click()

    // 连接态：spinner + 逐行日志
    expect(view.querySelector(".qc-ssh-spinner")).toBeTruthy()
    const log = view.querySelector(".qc-ssh-log")!
    expect(log.textContent).toContain("ssh analyst@quant.internal")
    expect(log.textContent).toContain("等待服务器响应…")

    await flush()

    // 失败态：stub 返回 unavailable → 具体原因 + 重试
    expect(view.querySelector(".qc-status-error")?.textContent).toBe("连接失败")
    expect(view.querySelector(".qc-ssh-reason")?.textContent).toBe("SSH 连接服务尚未就绪")
    const retry = view.querySelector<HTMLButtonElement>(".qc-button")!
    expect(retry.textContent).toBe("重试")

    // 私钥不回显、不保留：任何状态下 DOM 文本里都没有私钥；重试回表单后 key 输入框为空
    expect(view.textContent).not.toContain("TEST-SECRET-DO-NOT-ECHO")
    retry.click()
    expect(view.querySelector<HTMLInputElement>("#qc-ssh-host")!.value).toBe("quant.internal")
    expect(view.querySelector<HTMLInputElement>("#qc-ssh-user")!.value).toBe("analyst")
    expect(view.querySelector<HTMLInputElement>("#qc-ssh-key")!.value).toBe("")
    expect(view.textContent).not.toContain("TEST-SECRET-DO-NOT-ECHO")
    view.remove()
  })

  test("injected connect → connected state with fingerprint and group badges, disconnect returns to form", async () => {
    const view = mount(
      async () => ({ status: "connected", fingerprint: "SHA256:AbCd1234", groups: ["factor", "risk"] }),
    )
    fillForm(view)
    view.querySelector<HTMLButtonElement>(".qc-button")!.click()
    await flush()

    expect(view.querySelector(".qc-connection-pill")?.textContent).toContain("已连接")
    expect(view.querySelector(".qc-ssh-fingerprint")?.textContent).toBe("SHA256:AbCd1234")
    const badges = [...view.querySelectorAll(".qc-ssh-badge")].map((badge) => badge.textContent)
    expect(badges).toEqual(["factor 组", "risk 组"])

    view.querySelector<HTMLButtonElement>(".qc-button")!.click()
    expect(view.querySelector("#qc-ssh-host")).toBeTruthy()
    view.remove()
  })

  test("injected connect failure surfaces specific reason (key rejected / host unreachable / raw fallback)", async () => {
    for (const [reason, expected] of [
      ["key_rejected", "密钥被拒"],
      ["host_unreachable", "主机不可达"],
      ["quota_exceeded", "quota_exceeded"],
    ] as const) {
      const view = mount(async () => ({ status: "error", reason }))
      fillForm(view)
      view.querySelector<HTMLButtonElement>(".qc-button")!.click()
      await flush()
      expect(view.querySelector(".qc-status-error")?.textContent).toBe("连接失败")
      expect(view.querySelector(".qc-ssh-reason")?.textContent).toBe(expected)
      view.remove()
    }
  })

  test("injected connect that throws lands in failure state instead of hanging", async () => {
    const view = mount(async () => {
      throw new Error("socket exploded")
    })
    fillForm(view)
    view.querySelector<HTMLButtonElement>(".qc-button")!.click()
    await flush()
    expect(view.querySelector(".qc-ssh-reason")?.textContent).toBe("主机不可达")
    expect(view.textContent).not.toContain("TEST-SECRET-DO-NOT-ECHO")
    view.remove()
  })
})
