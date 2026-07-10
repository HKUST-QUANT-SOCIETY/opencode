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

## 俞高磊需要完成的部分

### 必做（接 6 面板进 OpenCode）

**Step 1 — 在 session-side-panel.tsx 加 "QuantCode" Tab**

找到 `packages/app/src/pages/session/session-side-panel.tsx` 里的 `<Tabs>` 渲染部分，
在现有 tabs 数组里加一项：

```tsx
import { QuantCodePanel } from "@/components/quantcode/panels"

// 在 Tabs 渲染里加：
{ id: "quantcode", label: "QuantCode", content: () => <QuantCodePanel /> }
```

**Step 2 — 监听 run_agent tool result，调用 updateQuantCodeTrace**

在 sync context 或 message-part.tsx 里，监听 tool result：
```tsx
import { updateQuantCodeTrace } from "@/components/quantcode/panels"

// 当 tool result 的 tool_name === "run_agent" 时：
const resultData = JSON.parse(toolResult.content)
if (typeof resultData === "object" && resultData.execution_trace) {
  updateQuantCodeTrace(resultData)
}
```

**Step 3 — 切组时更新面板（可选）**

如果有组切换逻辑（SSH key 绑定或手动切换），调用：
```tsx
import { setQuantCodeGroup } from "@/components/quantcode/panels"
setQuantCodeGroup("risk") // 或从 QUANTCODE_GROUP 环境变量读
```

### 可选（P1，Week 2）

- **Memory 浏览器真实化**：在 `quantcode/mcp_server.py` 加 `search_memory` 只读 tool，
  前端面板从 MCP 调它，替换现在的静态提示
- **Checkpoint 列表**：从 `.quantcode/checkpoints.db` 读 thread 列表（或加 MCP tool）
- **HumanGate approve/reject UI**：在 HumanGate 面板加按钮直接调 run_agent(resume)，
  无需手动输入

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
- [ ] session-side-panel.tsx 加 QuantCode Tab（俞高磊）
- [ ] run_agent tool result 监听（俞高磊）
