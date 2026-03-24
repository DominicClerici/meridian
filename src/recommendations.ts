import { store } from "./store"
import type { DomainHeatmap, RecommendationData } from "./defaults"

const BATCH_SIZE = 150
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000
const MAX_DOMAINS = 300
const MIN_SCORE = 5.0
const SIGMA = 2
const ADJACENT_DAY_WEIGHT = 0.3
const BLOCKED_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "moz-extension:", "brave:"]

const api = globalThis.browser ?? globalThis.chrome

let analyzing = false
let cachedRecommendations: { name: string; url: string }[] = []

function historySearch(query: {
  text: string
  startTime?: number
  endTime?: number
  maxResults?: number
}): Promise<HistoryItem[]> {
  return new Promise((resolve, reject) => {
    if (!api?.history) return reject(new Error("History API unavailable"))
    api.history.search(query, (results) => {
      const err = (chrome as any)?.runtime?.lastError
      if (err) reject(new Error(err.message))
      else resolve(results)
    })
  })
}

function extractDomain(url: string): string | null {
  if (BLOCKED_SCHEMES.some((s) => url.startsWith(s))) return null
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return null
  }
  if (hostname.startsWith("www.")) hostname = hostname.slice(4)
  return hostname || null
}

function pruneDomains(heatmap: DomainHeatmap): DomainHeatmap {
  const entries = Object.entries(heatmap)
  if (entries.length <= MAX_DOMAINS) return heatmap

  const totals = entries.map(([domain, grid]) => {
    let total = 0
    for (const row of grid) for (const count of row) total += count
    return { domain, total }
  })
  totals.sort((a, b) => b.total - a.total)

  const kept = new Set(totals.slice(0, MAX_DOMAINS).map((t) => t.domain))
  const pruned: DomainHeatmap = {}
  for (const [domain, grid] of entries) {
    if (kept.has(domain)) pruned[domain] = grid
  }
  return pruned
}

function scoreDomain(grid: number[][], day: number, hour: number): number {
  let score = 0
  const days = [
    { d: day, weight: 1.0 },
    { d: (day - 1 + 7) % 7, weight: ADJACENT_DAY_WEIGHT },
    { d: (day + 1) % 7, weight: ADJACENT_DAY_WEIGHT },
  ]

  for (const { d, weight } of days) {
    for (let h = 0; h < 24; h++) {
      const count = grid[d][h]
      if (count === 0) continue
      const diff = Math.abs(h - hour)
      const dist = Math.min(diff, 24 - diff)
      score += weight * count * Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA))
    }
  }

  return score
}

function computeRecommendations(data: RecommendationData): { name: string; url: string }[] {
  const now = new Date()
  const day = now.getDay()
  const hour = now.getHours() + now.getMinutes() / 60

  const scored: { domain: string; score: number }[] = []
  for (const [domain, grid] of Object.entries(data.heatmap)) {
    const score = scoreDomain(grid, day, hour)
    if (score >= MIN_SCORE) scored.push({ domain, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 2).map((s) => ({
    name: s.domain,
    url: `https://${s.domain}`,
  }))
}

function updateCachedRecommendations(data?: RecommendationData | null): void {
  if (data === undefined) data = store.local.get("recommendationData")
  if (!data) {
    cachedRecommendations = []
    return
  }
  cachedRecommendations = computeRecommendations(data)
}

async function buildHeatmap(): Promise<void> {
  if (analyzing) return
  analyzing = true

  try {
    const now = Date.now()
    const startTime = now - FORTY_FIVE_DAYS_MS
    let endTime = now
    const heatmap: DomainHeatmap = {}
    let batchCount = 0

    while (endTime > startTime) {
      const results = await historySearch({
        text: "",
        startTime,
        endTime,
        maxResults: BATCH_SIZE,
      })

      for (const item of results) {
        if (!item.url || !item.lastVisitTime) continue
        const domain = extractDomain(item.url)
        if (!domain) continue
        const date = new Date(item.lastVisitTime)
        const day = date.getDay()
        const hour = date.getHours()
        if (!heatmap[domain]) {
          heatmap[domain] = Array.from({ length: 7 }, () => new Array(24).fill(0))
        }
        heatmap[domain][day][hour]++
      }

      if (results.length < BATCH_SIZE) break
      const last = results[results.length - 1]
      endTime = last.lastVisitTime ?? endTime - 1

      batchCount++
      if (batchCount % 5 === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }

    const pruned = pruneDomains(heatmap)
    const data: RecommendationData = { heatmap: pruned, builtAt: Date.now() }
    updateCachedRecommendations(data)
    store.local.set("recommendationData", data)
  } catch {
    // History API unavailable or failed — silently skip
  } finally {
    analyzing = false
  }
}

export function getRecommendations(
  excludeDomains: Set<string>
): { name: string; url: string }[] {
  if (!store.sync.get("recommendationsEnabled")) return []
  return cachedRecommendations.filter((r) => !excludeDomains.has(r.name)).slice(0, 2)
}

export function initRecommendations(): void {
  if (!store.sync.get("recommendationsEnabled")) return

  updateCachedRecommendations()

  const data: RecommendationData | null = store.local.get("recommendationData")
  const stale = !data || Date.now() - data.builtAt > 24 * 60 * 60 * 1000

  if (stale) {
    setTimeout(() => buildHeatmap(), 0)
  }
}

store.sync.subscribe("recommendationsEnabled", (enabled) => {
  if (enabled) {
    updateCachedRecommendations()
    const data: RecommendationData | null = store.local.get("recommendationData")
    const stale = !data || Date.now() - data.builtAt > 24 * 60 * 60 * 1000
    if (stale) setTimeout(() => buildHeatmap(), 0)
  } else {
    cachedRecommendations = []
  }
})
