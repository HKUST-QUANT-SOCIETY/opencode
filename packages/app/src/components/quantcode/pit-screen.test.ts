import { describe, expect, test } from "bun:test"
import { PitValuationView, dcfRecompute, pitDocuments } from "./pit-screen"
import type { RunAgentResult } from "./result-contract"

function pitRun(overrides: Partial<RunAgentResult> = {}): RunAgentResult {
  return {
    status: "completed",
    output_data: {
      as_of_date: "2026-06-30",
      documents: [
        { id: "d1", title: "年报点评 A", source: "中金公司", published_at: "2026-05-20", score: 0.8, url: "https://a" },
        { id: "d2", title: "行业观察 B", source: "广发证券", published_at: "2026-06-28", score: 0.6, url: "https://b" },
      ],
      fcf_ttm: 100,
      wacc: 0.12,
      growth_rate: 0.1,
      terminal_growth: 0.03,
      fair_value_per_share: 1.9,
    },
    ...overrides,
  }
}

describe("PitValuationView", () => {
  test("runs render date timeline in desc order; published_at > as_of_date flags 晚于估值时点", () => {
    const run = pitRun({
      output_data: {
        ...pitRun().output_data!,
        documents: [
          { id: "late", title: "迟到的 C", source: "卖方", published_at: "2026-07-05", score: 0.9, url: "" },
          { id: "ok", title: "合规的 D", source: "买方", published_at: "2026-06-01", score: 0.5, url: "" },
        ],
      },
    })
    const el = PitValuationView({ run })
    expect(el.className).toBe("qc-pit-view")
    expect(el.querySelectorAll(".qc-pit-doc").length).toBe(2)
    expect(el.querySelectorAll(".qc-pit-card").length).toBe(2)
    const late = el.querySelector(".qc-pit-card.is-late")!
    expect(late.textContent).toContain("迟到的 C")
    expect(late.textContent).toContain("晚于估值时点")
    expect([...el.querySelectorAll(".qc-pit-card")].every((d) => d.classList.contains("is-late"))).toBe(false)
    expect(pitDocuments(run)[0]!.late).toBe(true)
    el.remove()
  })

  test("fair value card renders output_data.fair_value_per_share big number", () => {
    const el = PitValuationView({ run: pitRun() })
    const card = el.querySelector(".qc-metric")!
    expect(card.querySelector(".qc-metric-label")?.textContent).toBe("每股公允价值")
    expect(card.querySelector(".qc-metric-value")?.textContent).toBe("1.90")
    const range = el.querySelector(".qc-pit-range code")?.textContent ?? ""
    // 区间条跟随重算后的公允价值（1.90 ± 20%，与后端 fair_value_per_share 一致）
    expect(range).toContain("悲观 1.52")
    expect(range).toContain("乐观 2.28")
    el.remove()
  })

  test("sliders recompute fair value with the shared Gordon formula", () => {
    // 与 dcf_valuation.py 同式：5 年显式期 + 永续增长，equity/shares
    expect(dcfRecompute(100, 0.1, 0.12, 0.03)).toBeCloseTo(1.8996, 3)
    expect(dcfRecompute(0, 0.1, 0.12, 0.03)).toBe(0)
    expect(dcfRecompute(100, 0.1, 0.03, 0.03)).toBe(0) // wacc <= terminal_growth → 无效
    const el = PitValuationView({ run: pitRun() })
    const inputs = [...el.querySelectorAll<HTMLInputElement>(".qc-pit-param input")]
    expect(inputs.length).toBe(3)
    expect(inputs.map((i) => Number(i.value))).toEqual([0.12, 0.1, 0.03])
    // 滑条初始值取自 output_data，重算值与后端 gordon 公式一致
    expect(el.querySelector(".qc-pit-live")?.textContent).toBe(`重算 ${dcfRecompute(100, 0.1, 0.12, 0.03).toFixed(2)}`)
    el.remove()
  })

  test("empty run shows both empty notes and no params", () => {
    const el = PitValuationView({ run: null })
    expect(el.querySelectorAll(".qc-metrics-empty").length).toBe(2)
    expect(el.querySelectorAll(".qc-pit-param").length).toBe(0)
    expect(el.querySelector(".qc-metric-value")?.textContent).toBe("—")
    el.remove()
  })

  test("artifact refs render as code rows and gate runs stay intact", () => {
    const run = pitRun({
      artifacts: ["artifact://pit/valuation.json"],
      status: "waiting_for_human",
      gate: { message: "确认估值假设", reasons: ["drawdown_breach", "var_99"] },
    })
    const el = PitValuationView({ run })
    expect(el.textContent).toContain("artifact://pit/valuation.json")
    // gate reason 不崩
    expect(el.querySelectorAll(".qc-pit-card").length).toBe(2)
    expect(el.querySelectorAll(".qc-pit-param").length).toBe(3)
    expect(el.textContent).not.toContain("undefined")
    el.remove()
  })
})