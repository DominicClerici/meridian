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

const BLOCKED_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "moz-extension:", "brave:"]

function getTopEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const existing = getAllShortcutUrls()
  return entries
    .filter((e) => !existing.has(e.url) && BLOCKED_SCHEMES.every((s) => !e.url.startsWith(s)))
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

function getSelectedTabId(): string | null {
  const select = document.getElementById("sc-tab-select") as HTMLSelectElement | null
  return select?.value || null
}

function prependShortcut(url: string, name: string): boolean {
  const tabId = getSelectedTabId()
  if (!tabId) return false
  const tabs: Tab[] = store.local.get("shortcuts")
  let added = false
  const updated = tabs.map((t) => {
    if (t.id !== tabId || t.items.length >= MAX_ITEMS_PER_TAB) return t
    added = true
    const sc: Shortcut = { type: "shortcut", id: crypto.randomUUID(), name, url }
    return { ...t, items: [sc, ...t.items] }
  })
  if (added) store.local.set("shortcuts", updated)
  return added
}

function renderResults(
  entries: HistoryEntry[],
  list: HTMLElement
): void {
  list.innerHTML = ""
  for (const entry of entries) {
    const row = document.createElement("div")
    row.className = "flex items-center gap-2 px-2 py-1.5 bg-surface rounded text-sm"

    const info = document.createElement("div")
    info.className = "flex-1 min-w-0"

    const title = document.createElement("div")
    title.className = "font-medium truncate"
    title.textContent = extractHostname(entry.url)
    info.appendChild(title)

    const urlText = document.createElement("div")
    urlText.className = "text-xs text-muted truncate"
    urlText.textContent = entry.url
    info.appendChild(urlText)

    row.appendChild(info)

    const count = document.createElement("span")
    count.className = "text-xs text-muted shrink-0"
    count.textContent = String(entry.visitCount)
    row.appendChild(count)

    const addBtn = document.createElement("button")
    addBtn.className = "text-xs px-2 py-1 rounded bg-accent text-accent-foreground hover:bg-accent-hover shrink-0"
    addBtn.textContent = "Add"

    const tabId = getSelectedTabId()
    if (tabId) {
      const tabs: Tab[] = store.local.get("shortcuts")
      const tab = tabs.find((t) => t.id === tabId)
      if (tab && tab.items.length >= MAX_ITEMS_PER_TAB) addBtn.disabled = true
    }

    addBtn.addEventListener("click", () => {
      if (!prependShortcut(entry.url, extractHostname(entry.url))) return
      row.remove()
      const currentTabId = getSelectedTabId()
      if (currentTabId) {
        const tabs: Tab[] = store.local.get("shortcuts")
        const tab = tabs.find((t) => t.id === currentTabId)
        if (tab && tab.items.length >= MAX_ITEMS_PER_TAB) {
          list.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
            if (btn.textContent === "Add") btn.disabled = true
          })
        }
      }
    })
    row.appendChild(addBtn)

    list.appendChild(row)
  }
}

async function openImportDialog(): Promise<void> {
  const dialog = document.getElementById("history-import-dialog") as HTMLDialogElement
  const loading = document.getElementById("history-import-loading") as HTMLElement
  const list = document.getElementById("history-import-list") as HTMLElement
  const empty = document.getElementById("history-import-empty") as HTMLElement
  const error = document.getElementById("history-import-error") as HTMLElement

  loading.hidden = false
  list.hidden = true
  empty.hidden = true
  error.hidden = true
  list.innerHTML = ""

  dialog.showModal()

  try {
    const entries = await fetchHistory()
    const top = getTopEntries(entries)

    loading.hidden = true

    if (top.length === 0) {
      empty.hidden = false
    } else {
      list.hidden = false
      renderResults(top, list)
    }
  } catch {
    loading.hidden = true
    error.hidden = false
  }
}

export function initHistoryImport(): void {
  const importBtn = document.getElementById("sc-import-history") as HTMLButtonElement
  const dialog = document.getElementById("history-import-dialog") as HTMLDialogElement
  const closeBtn = document.getElementById("history-import-close") as HTMLButtonElement

  if (!importBtn) return

  importBtn.addEventListener("click", () => openImportDialog())
  closeBtn.addEventListener("click", () => dialog.close())
}
