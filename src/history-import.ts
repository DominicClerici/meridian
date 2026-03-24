import { store } from "./store"
import { MAX_ITEMS_PER_TAB } from "./shortcuts"
import type { Tab, Shortcut } from "./shortcuts"

const USE_VISIT_COUNT = true

const BATCH_SIZE = 150
const MAX_RESULTS = 50
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000
const MAX_HOSTNAME_LENGTH = 64

const api = globalThis.browser ?? globalThis.chrome

type HistoryEntry = { url: string; visitCount: number }

function historySearch(query: {
  text: string
  startTime?: number
  endTime?: number
  maxResults?: number
}): Promise<HistoryItem[]> {
  return new Promise((resolve, reject) => {
    if (!api) return reject(new Error("Browser API unavailable"))
    api.history.search(query, (results) => {
      const err = (chrome as any)?.runtime?.lastError
      if (err) reject(new Error(err.message))
      else resolve(results)
    })
  })
}

function historyGetVisits(details: { url: string }): Promise<VisitItem[]> {
  return new Promise((resolve, reject) => {
    if (!api) return reject(new Error("Browser API unavailable"))
    api.history.getVisits(details, (results) => {
      const err = (chrome as any)?.runtime?.lastError
      if (err) reject(new Error(err.message))
      else resolve(results)
    })
  })
}

async function fetchHistory(): Promise<HistoryEntry[]> {
  const now = Date.now()
  const startTime = now - THREE_MONTHS_MS
  let endTime = now
  const map = new Map<string, HistoryEntry>()

  while (endTime > startTime) {
    const results = await historySearch({
      text: "",
      startTime,
      endTime,
      maxResults: BATCH_SIZE,
    })

    for (const item of results) {
      if (!item.url) continue
      const existing = map.get(item.url)
      const count = item.visitCount ?? 0
      if (!existing || count > existing.visitCount) {
        map.set(item.url, { url: item.url, visitCount: count })
      }
    }

    if (results.length < BATCH_SIZE) break

    const last = results[results.length - 1]
    endTime = last.lastVisitTime ?? endTime - 1
  }

  if (!USE_VISIT_COUNT) {
    const threeMonthsAgo = now - THREE_MONTHS_MS
    for (const [url, entry] of map) {
      const visits = await historyGetVisits({ url })
      entry.visitCount = visits.filter(
        (v) => v.visitTime !== undefined && v.visitTime >= threeMonthsAgo
      ).length
    }
  }

  return Array.from(map.values())
}

function getAllShortcutUrls(): Set<string> {
  const tabs: Tab[] = store.local.get("shortcuts")
  const urls = new Set<string>()
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.type === "shortcut") urls.add(item.url)
      else if (item.type === "folder") {
        for (const child of item.children) urls.add(child.url)
      }
    }
  }
  return urls
}

function getTopEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const existing = getAllShortcutUrls()
  return entries
    .filter((e) => !existing.has(e.url))
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, MAX_RESULTS)
}

function extractHostname(url: string): string {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return url
  }
  if (hostname.startsWith("www.")) hostname = hostname.slice(4)
  if (hostname.length > MAX_HOSTNAME_LENGTH)
    hostname = hostname.slice(0, MAX_HOSTNAME_LENGTH - 3) + "..."
  return hostname
}
