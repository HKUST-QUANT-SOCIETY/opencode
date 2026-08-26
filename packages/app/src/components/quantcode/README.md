# QuantCode IDE 集成说明（给俞高磊）

> 本文件说明 QuantCode Day5 UI 改动的集成方法，以及俞高磊需要完成的剩余 TS 工作。

---

## 已完成部分（Lead 交付）

### 1. `/compose` slash 命令

文件：`packages/app/src/pages/session/use-session-commands.tsx`

- 在 `composeCmds()` 里注册了 `slash: "compose"`，选中后会预填 prompt：`"请用 run_agent 完成以下任务："` 并聚焦输入框。
- OpenCode 内置 MCP client 在 `opencode.jsonc` 里已配 6 个 `quantcode-<group>` server，**`/compose` 选完用户填任务，agent 就会自动调 `run_agent` MCP tool**——触发链本身不需要额外代码。

### 2. QuantCode 六面板组件

文件：`packages/app/src/components/quantcode/panels.tsx`

完整的 SolidJS 组件，Tab 切换六个面板：

- **Compose 视图**：渲染 `execution_trace` 事件流（图标 + 类型 + 摘要）
- **任务树**：按 tool_call 事件线性列出步骤
- **HumanGate**：`waiting_for_human` 状态时显示暂停提示 + reasons + thread_id
- **Schema 卡片**：渲染 `output_data`（JSON）+ artifacts 路径列表
- **Memory 浏览器**：静态提示（Week 2 补只读 MCP tool）
- **会话 Resume**：最近 20 个 thread 的状态历史

导出接口：

```ts
import { QuantCodePanel, updateQuantCodeTrace, setQuantCodeGroup } from "@/components/quantcode/panels"
```

**关键函数**：

- `updateQuantCodeTrace(result: RunAgentResult)` — 当 run_agent 返回 execution_trace 时调用，更新所有面板
- `setQuantCodeGroup(group: string)` — 切组时调用，更新组标识显示

### 3. Python bridge（demo 降级路径）

文件：`../QUANTcode/runner/demo_bridge.py`

```bash
# demo 当天 fallback：直接跑 Python，不依赖 TS 前端
python -m runner.demo_bridge --group risk --skill risk-gate \
  --task "run risk_stub high_risk" --auto-approve
# JSONL 模式（供 OpenCode spawn 消费）：
python -m runner.demo_bridge --group factor --task "测 PB-ROE 因子" --jsonl
```

---

## 当前集成状态

本仓库的 `.opencode/opencode.jsonc` 将 QuantCode MCP 保持为默认禁用，避免公开 OpenCode fork 在没有 Python 后端时启动失败。开发者需要设置 `QUANTCODE_ROOT` 指向 QuantCode Python 仓库，并在个人/项目配置中启用 `mcp.quantcode`。桌面安装包不会嵌入成员私钥、GitHub PAT 或 Python 仓库路径；正式 Server B 连接由 OpenCode 的服务器配置和成员本机凭据管理。

### 已完成（接入 OpenCode 桌面会话）

**Step 1 — session-side-panel.tsx 的 QuantCode 工作区**

`packages/app/src/pages/session/session-side-panel.tsx` 已接入全屏 QuantCode 工作区，并仅在 QuantCode channel 暴露入口。

**Step 2 — 校验并消费 run_agent tool result**

`packages/app/src/pages/session.tsx` 监听完成的 tool result，先通过 `result-contract.ts` 校验嵌套结构，再调用 `updateQuantCodeTrace`。畸形或双重包装失败的 MCP 输出不会进入面板状态。

```tsx
import { updateQuantCodeTrace } from "@/components/quantcode/panels"
import { parseRunAgentOutput } from "@/components/quantcode/result-contract"

const result = parseRunAgentOutput(toolResult.content)
if (result) updateQuantCodeTrace(result)
```

**Step 3 — 切组与 HumanGate resume**

组选择器与面板共用 `QUANTCODE_GROUPS` 契约；HumanGate 的批准/拒绝按钮会提交精确的 `thread_id + decision` resume 指令，而不是广播无人消费的 UI 事件。

```tsx
import { buildResumeInstruction } from "@/components/quantcode/instructions"
const prompt = buildResumeInstruction(threadID, "approve")
```

### 可选（P1，Week 2）

- **Memory 浏览器真实化**：在 `quantcode/mcp_server.py` 加 `search_memory` 只读 tool，
  前端面板从 MCP 调它，替换现在的静态提示
- **Checkpoint 列表**：从 `.quantcode/checkpoints.db` 读 thread 列表（或加 MCP tool）

---

## Python 侧接口契约（完整版见 `docs/IDE_Python_Interface_Contract.md`）

运行格式：

```json
// start
{ "name": "run_agent", "arguments": { "task": "...", "group": "risk" } }
// resume
{ "name": "run_agent", "arguments": { "thread_id": "...", "decision": "approve" } }
```

返回：包含 `status` / `thread_id` / `gate` / `execution_trace` / `output_data` / `artifacts`

execution_trace 的 10 种事件类型：
`agent_start` / `user_input` / `llm_thought` / `tool_call` / `tool_result` /
`risk_metrics` / `human_gate` / `output_data` / `artifact` / `agent_end`

---

## 验收确认（Day5 §2）

- [x] `/compose` slash 命令已注册
- [x] 六面板组件已实现（Compose/任务树/HumanGate/Schema/Memory/Resume）
- [x] Python bridge 可独立运行（demo 兜底）
- [x] session-side-panel.tsx 接入 QuantCode 工作区并按 channel 隔离
- [x] run_agent tool result 监听、结构校验与 HumanGate resume
