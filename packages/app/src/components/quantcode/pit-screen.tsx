/**
 * PIT 估值视图（v5 PPT slide20 屏3）：纯 DOM 构建，无 Solid 响应式，
 * 与 factor-screen 相同的 bun test 兼容策略；panels.tsx 中作为 JSX 子节点插入。
 *
 * 左侧：证据时间线（output_data.documents，published_at > as_of_date → 红色契约告警）。
 * 右侧：DCF 估值卡（fair_value_per_share 大数字 + wacc/growth/terminal_growth
 * 滑条重算 + 乐观/悲观 ±20% 区间条），公式与 tools/fundamental/dcf_valuation.py 同式。
 */
import { QcBigNumber } from "./metric-cards"
import type { RunAgentResult } from "./result-contract"

type PitDoc = {
  title: string
  publishedAt: string
  source: string
  score: number
  url: string
  /** published_at 晚于估值时点 → 契约告警（正常不应出现） */
  late: boolean
}

/** 防御式提取 PIT 文档：published_at > as_of_date 标记 late。导出给测试。 */
export function pitDocuments(run: RunAgentResult | null): PitDoc[] {
  const asOf = typeof run?.output_data?.as_of_date === "string" ? run.output_data.as_of_date : ""
  const raw = run?.output_data?.documents
  if (!Array.isArray(raw)) return []
  const docs: PitDoc[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const doc = item as Record<string, unknown>
    const publishedAt = typeof doc.published_at === "string" ? doc.published_at.slice(0, 10) : ""
    if (!publishedAt) continue
    docs.push({
      title: typeof doc.title === "string" ? doc.title : "未命名证据",
      publishedAt,
      source: typeof doc.source === "string" ? doc.source : "unknown",
      score: typeof doc.score === "number" && Number.isFinite(doc.score) ? doc.score : 0,
      url: typeof doc.url === "string" ? doc.url : "",
      late: !!asOf && publishedAt > asOf,
    })
  }
  return docs.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : b.score - a.score))
}

/** Gordon DCF 重算（与 dcf_valuation.py 同式），返回每股公允价值。 */
export function dcfRecompute(fcf: number, growth: number, wacc: number, terminal: number, years = 5, shares = 800) {
  if (!Number.isFinite(fcf) || fcf <= 0 || wacc <= terminal || wacc <= 0) return 0
  let value = fcf
  let pv = 0
  for (let t = 1; t <= years; t++) {
    value *= 1 + growth
    pv += value / (1 + wacc) ** t
  }
  return (pv + (value * (1 + terminal)) / (wacc - terminal) / (1 + wacc) ** years) / shares
}

const PARAMS = [
  { key: "wacc", label: "WACC", min: 0.02, max: 0.3, step: 0.005, value: 0.1 },
  { key: "growth_rate", label: "增长率", min: -0.05, max: 0.3, step: 0.005, value: 0.08 },
  { key: "terminal_growth", label: "永续增长", min: -0.02, max: 0.06, step: 0.002, value: 0.03 },
] as const

function emptyNote(text: string) {
  const note = document.createElement("p")
  note.className = "qc-metrics-empty"
  note.textContent = text
  return note
}

export function PitValuationView(props: { run: RunAgentResult | null }): HTMLElement {
  const root = document.createElement("div")
  root.className = "qc-pit-view"

  // --- 左侧：证据时间线 ---
  const timeline = document.createElement("div")
  timeline.className = "qc-pit-timeline"
  const timelineLabel = document.createElement("span")
  timelineLabel.className = "qc-section-label"
  timelineLabel.textContent = "证据时间线"
  timeline.append(timelineLabel)
  const docs = pitDocuments(props.run)
  if (!docs.length) {
    timeline.append(emptyNote("暂无 PIT 证据，运行 pit_rag_search 后按发布日期排列于此。"))
  } else {
    for (const doc of docs) {
      const row = document.createElement("div")
      row.className = "qc-pit-doc"
      const date = document.createElement("time")
      date.textContent = doc.publishedAt
      const card = document.createElement("div")
      if (doc.late) card.className = "qc-pit-card is-late"
      else card.className = "qc-pit-card"
      const head = document.createElement("strong")
      head.textContent = doc.title
      const meta = document.createElement("small")
      meta.textContent = `${doc.source} · score ${doc.score.toFixed(2)}`
      card.append(head, meta)
      if (doc.late) {
        const warn = document.createElement("b")
        warn.className = "qc-pit-late"
        warn.textContent = "晚于估值时点"
        card.append(warn)
      }
      row.append(date, card)
      timeline.append(row)
    }
  }

  // --- 右侧：DCF 估值卡 ---
  const dcf = document.createElement("div")
  dcf.className = "qc-pit-valuation"
  const dcfLabel = document.createElement("span")
  dcfLabel.className = "qc-section-label"
  dcfLabel.textContent = "DCF 估值"
  dcf.append(dcfLabel)
  const output = props.run?.output_data ?? {}
  const fcf = typeof output.fcf_ttm === "number" ? output.fcf_ttm : 0
  const base = typeof output.fair_value_per_share === "number" ? output.fair_value_per_share : 0
  const cardGrid = document.createElement("div")
  cardGrid.className = "qc-metrics-body"
  cardGrid.append(QcBigNumber({ label: "每股公允价值", value: base ? base.toFixed(2) : "—", tone: "ink" }))
  dcf.append(cardGrid)
  const range = document.createElement("div")
  range.className = "qc-pit-range"
  const rangeBar = document.createElement("div")
  rangeBar.className = "qc-pit-range-bar"
  const fill = document.createElement("i")
  fill.style.left = "40%"
  fill.style.width = "20%"
  rangeBar.append(fill)
  const rangeText = document.createElement("code")
  const paint = (fv: number) => {
    const low = fv * 0.8
    const high = fv * 1.2
    rangeText.textContent = `悲观 ${low.toFixed(2)} — 乐观 ${high.toFixed(2)}`
    const span = Math.max(high, fv * 1.201) || 1
    fill.style.left = `${(low / span) * 100}%`
    fill.style.width = `${((high - low) / span) * 100}%`
  }
  range.append(rangeBar, rangeText)
  dcf.append(range)

  const params = PARAMS.map((p) => ({ ...p, value: typeof output[p.key] === "number" ? (output[p.key] as number) : p.value }))
  const compute = () =>
    dcfRecompute(fcf, params[1]!.value, params[0]!.value, params[2]!.value)
  const live = document.createElement("code")
  live.className = "qc-pit-live"
  if (!fcf) {
    dcf.append(emptyNote("缺少 fcf_ttm，滑条重算不可用。"))
  } else {
    live.textContent = `重算 ${compute().toFixed(2)}`
    dcf.append(live)
    const fcfLabel = document.createElement("small")
    fcfLabel.textContent = `FCF TTM ${fcf.toFixed(1)}`
    dcf.append(fcfLabel)
    for (const param of params) {
      const field = document.createElement("label")
      field.className = "qc-pit-param"
      const name = document.createElement("span")
      name.textContent = `${param.label} ${(param.value * 100).toFixed(1)}%`
      const input = document.createElement("input")
      input.type = "range"
      input.min = String(param.min)
      input.max = String(param.max)
      input.step = String(param.step)
      input.value = String(param.value)
      input.addEventListener("input", () => {
        param.value = Number(input.value)
        name.textContent = `${param.label} ${(param.value * 100).toFixed(1)}%`
        const fv = compute()
        live.textContent = `重算 ${fv.toFixed(2)}`
        paint(fv)
      })
      field.append(name, input)
      dcf.append(field)
    }
    paint(compute())
  }

  if (props.run?.artifacts?.length) {
    const artifact = document.createElement("code")
    artifact.className = "qc-artifact"
    artifact.textContent = props.run.artifacts.join("\n")
    dcf.append(artifact)
  }

  root.append(timeline, dcf)
  return root
}