/**
 * F-04 Memory 查询视图：搜索框 + 结果列表（snippet 高亮 + 相对分数条）。
 *
 * 数据源：MemoryService FTS 在后端 runner/memory；本波后端只交付 admin_* 元工具，
 * 没有 lens 可直调的 memory_search 通道 → 组件暴露可注入 fetcher，默认空态 +
 * 占位提示（绝不造假数据）。后端 meta 工具就绪后在 panels.tsx 注入真实 fetcher。
 * 跨组读取被拒（MemoryPermissionError fail-closed）→ "无权限" 空态。
 * 纯 DOM 构建（沿 ssh-login 模式，bun test 兼容）。
 */

export type MemoryHit = {
  id?: string
  title?: string
  snippet?: string
  /** BM25 分数；UI 只做同批结果间的相对分数条，不做绝对刻度 */
  score?: number
  scope?: string
}

/** null = 通道未接通；denied = 跨组无权限（fail-closed） */
export type MemoryQueryResult = { hits: MemoryHit[] } | { denied: true } | null

export type MemoryQueryFetcher = (query: string) => Promise<MemoryQueryResult>

export type MemoryQueryProps = {
  /** i18n：panels 传 language.t（key 见 quantcode.memory.*） */
  t: (key: string) => string
  /** 可注入检索实现；默认无通道（占位空态） */
  fetcher?: MemoryQueryFetcher
}

/**
 * ponytail: 后端本波无 memory_search meta 工具（AG-D 只交付 admin_*）——
 * 默认 fetcher 恒返 null（占位空态）；工具就绪后替换为真实通道即可。
 */
export const stubMemoryFetcher: MemoryQueryFetcher = async () => null

/** snippet 高亮分段：query（大小写不敏感）命中的片段标 hit。 */
export function highlightSegments(snippet: string, query: string): { text: string; hit: boolean }[] {
  const trimmed = query.trim()
  if (!trimmed) return [{ text: snippet, hit: false }]
  const lowerSnippet = snippet.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()
  const segments: { text: string; hit: boolean }[] = []
  let cursor = 0
  while (cursor < snippet.length) {
    const index = lowerSnippet.indexOf(lowerQuery, cursor)
    if (index === -1) break
    if (index > cursor) segments.push({ text: snippet.slice(cursor, index), hit: false })
    segments.push({ text: snippet.slice(index, index + trimmed.length), hit: true })
    cursor = index + trimmed.length
  }
  if (cursor < snippet.length) segments.push({ text: snippet.slice(cursor), hit: false })
  return segments.length ? segments : [{ text: snippet, hit: false }]
}

export function MemoryQueryView(props: MemoryQueryProps): HTMLElement {
  const t = props.t
  const fetcher = props.fetcher ?? stubMemoryFetcher
  const root = document.createElement("div")
  root.className = "qc-memory-query"
  root.style.cssText = "display:grid;gap:12px;align-content:start;"

  let lastQuery = ""
  let searching = false

  const sectionLabel = (text: string) => {
    const span = document.createElement("span")
    span.className = "qc-section-label"
    span.textContent = text
    return span
  }

  const emptyState = (titleKey: string, errorTone?: boolean) => {
    const empty = document.createElement("div")
    empty.className = "qc-empty-state qc-memory-empty"
    const index = document.createElement("span")
    index.className = "qc-empty-index"
    index.textContent = "—"
    const title = document.createElement("h3")
    title.textContent = t(titleKey)
    if (errorTone) title.style.color = "#aa2e23"
    empty.append(index, title)
    return empty
  }

  const renderSnippet = (hit: MemoryHit) => {
    const wrap = document.createElement("div")
    wrap.className = "qc-memory-snippet"
    for (const segment of highlightSegments(hit.snippet ?? "", lastQuery)) {
      if (!segment.text) continue
      const part = document.createElement(segment.hit ? "mark" : "span")
      if (segment.hit) {
        part.style.cssText = "background:rgba(154,91,18,0.18);color:inherit;"
        part.className = "qc-memory-hit"
      }
      part.textContent = segment.text
      wrap.append(part)
    }
    return wrap
  }

  const renderHits = (hits: MemoryHit[]) => {
    if (hits.length === 0) {
      root.append(emptyState("quantcode.memory.noResults"))
      return
    }
    const maxScore = Math.max(0, ...hits.map((hit) => (typeof hit.score === "number" && Number.isFinite(hit.score) ? hit.score : 0)))
    const list = document.createElement("div")
    list.className = "qc-memory-hits"
    for (const hit of hits) {
      const row = document.createElement("div")
      row.className = "qc-memory-hit-row"
      row.style.cssText = "display:grid;gap:4px;padding:10px 0;border-bottom:1px solid var(--qc-line);"

      const head = document.createElement("div")
      head.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;"
      const title = document.createElement("strong")
      title.textContent = hit.title || hit.id || "Memory"
      head.append(title)
      if (hit.scope) {
        const scope = document.createElement("span")
        scope.className = "qc-status qc-memory-scope"
        scope.textContent = hit.scope
        head.append(scope)
      }
      row.append(head)

      row.append(renderSnippet(hit))

      if (typeof hit.score === "number" && Number.isFinite(hit.score) && maxScore > 0) {
        const barWrap = document.createElement("div")
        barWrap.style.cssText = "display:flex;align-items:center;gap:8px;"
        const scoreLabel = document.createElement("span")
        scoreLabel.style.cssText = "font-size:9px;color:var(--qc-muted);"
        scoreLabel.textContent = `${t("quantcode.memory.score")} ${hit.score.toFixed(2)}`
        const bar = document.createElement("div")
        bar.className = "qc-memory-score-bar"
        bar.style.cssText = `height:4px;width:${Math.max(2, Math.round((hit.score / maxScore) * 100))}%;background:var(--qc-ink);border-radius:2px;`
        barWrap.append(scoreLabel, bar)
        row.append(barWrap)
      }
      list.append(row)
    }
    root.append(list)
  }

  const renderResult = (result: MemoryQueryResult) => {
    if (result === null) {
      root.append(emptyState("quantcode.memory.unavailable"))
      return
    }
    if ("denied" in result) {
      root.append(emptyState("quantcode.memory.denied", true))
      return
    }
    renderHits(result.hits)
  }

  const runSearch = async () => {
    const query = lastQuery
    searching = true
    render()
    try {
      const result = await fetcher(query)
      if (query !== lastQuery) return // 已有更新的搜索接管渲染
      searching = false
      render()
      renderResult(result)
    } catch {
      if (query !== lastQuery) return
      searching = false
      render()
      root.append(emptyState("quantcode.memory.unavailable"))
    }
  }

  const render = () => {
    root.replaceChildren()

    const intro = document.createElement("div")
    intro.className = "qc-memory-intro"
    intro.append(
      sectionLabel("RESEARCH MEMORY"),
      (() => {
        const title = document.createElement("h3")
        title.textContent = t("quantcode.memory.title")
        return title
      })(),
      (() => {
        const desc = document.createElement("p")
        desc.style.cssText = "margin:0;font-size:11px;color:var(--qc-muted);"
        desc.textContent = t("quantcode.memory.intro")
        return desc
      })(),
    )
    root.append(intro)

    const form = document.createElement("div")
    form.className = "qc-memory-search"
    form.style.cssText = "display:flex;gap:8px;"
    const input = document.createElement("input")
    input.className = "qc-select-wide qc-memory-search-input"
    input.type = "search"
    input.placeholder = t("quantcode.memory.searchPlaceholder")
    input.autocomplete = "off"
    input.value = lastQuery
    input.addEventListener("input", () => {
      lastQuery = input.value
    })
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void runSearch()
    })
    const submit = document.createElement("button")
    submit.type = "button"
    submit.className = "qc-button qc-button-primary qc-memory-search-submit"
    submit.textContent = t("quantcode.memory.search")
    submit.disabled = searching
    submit.addEventListener("click", () => void runSearch())
    form.append(input, submit)
    root.append(form)

    const results = document.createElement("div")
    results.className = "qc-memory-results"
    root.append(results)

    if (!lastQuery.trim() && !searching) {
      root.append(emptyState("quantcode.memory.empty"))
    } else if (searching) {
      // ponytail: 文案沿用"…"（不加新 i18n key）；视觉复用 qc-connection-pill + pulse-opacity 圆点（同 ssh-login connecting）
      const pending = document.createElement("span")
      pending.className = "qc-connection-pill qc-memory-pending"
      const dot = document.createElement("i")
      pending.append(dot, document.createTextNode("…"))
      results.append(pending)
    }
    return results
  }

  // 首屏：空查询 → 空态提示
  render()
  return root
}
