# History Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import their most-visited URLs from browser history as shortcuts, via a modal accessible from the settings panel.

**Architecture:** Single new module `src/history-import.ts` handles all logic — batched history fetching, grouping/ranking, hostname extraction, modal rendering, and add-to-shortcuts handling. A new `<dialog>` in `index.html` provides the UI. Browser history API types are added to `browser.d.ts` and `"history"` permission to the manifest.

**Tech Stack:** Vanilla TypeScript, browser history API (callback-based), Tailwind CSS v4 utility classes.

**Spec:** `docs/superpowers/specs/2026-03-23-history-import-design.md`

---

### Task 1: Type Declarations and Manifest Permission

**Files:**
- Modify: `src/browser.d.ts`
- Modify: `manifest.json`

- [ ] **Step 1: Add history API types to `src/browser.d.ts`**

Add these interfaces before the closing `}` isn't applicable here since the interfaces are at the global level. Add after the existing `BrowserIdentity` interface and before `BrowserAPI`:

```ts
interface HistoryItem {
  id: string
  url?: string
  title?: string
  lastVisitTime?: number
  visitCount?: number
  typedCount?: number
}

interface VisitItem {
  id: string
  visitId: string
  visitTime?: number
  referringVisitId: string
  transition: string
}

interface BrowserHistory {
  search(
    query: { text: string; startTime?: number; endTime?: number; maxResults?: number },
    callback: (results: HistoryItem[]) => void
  ): void
  getVisits(
    details: { url: string },
    callback: (results: VisitItem[]) => void
  ): void
}
```

- [ ] **Step 2: Add `history` to `BrowserAPI` interface**

In the `BrowserAPI` interface in `src/browser.d.ts`, add `history: BrowserHistory` alongside the existing `storage` and `identity` fields:

```ts
interface BrowserAPI {
  storage: BrowserStorage
  identity: BrowserIdentity
  history: BrowserHistory
}
```

- [ ] **Step 3: Add `"history"` permission to `manifest.json`**

Change the permissions array from:
```json
"permissions": ["storage", "geolocation", "identity"]
```
to:
```json
"permissions": ["storage", "geolocation", "identity", "history"]
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new errors (existing code doesn't use history types yet).

- [ ] **Step 5: Commit**

```bash
git add src/browser.d.ts manifest.json
git commit -m "feat(history): add history API types and manifest permission"
```

---

### Task 2: HTML Markup — Trigger Button and Dialog

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add the import-from-history button in the Shortcuts fieldset**

In `src/index.html`, inside the Shortcuts fieldset (after the `#sc-controls` div at line 64, before the `#sc-list` div at line 65), add a standalone button row:

```html
        <button id="sc-import-history" type="button" class="text-xs px-2 py-1 rounded bg-purple-500 text-white hover:bg-purple-600 self-start mb-1" hidden>Import from History</button>
```

This goes between the closing `</div>` of `#sc-controls` and the opening `<div id="sc-list"...>`.

- [ ] **Step 2: Add the history import dialog**

After the existing `</dialog>` for `#todo-prompt-dialog` (line 208) and before the `<script>` tag (line 210), add:

```html
  <dialog id="history-import-dialog" class="rounded-xl p-0 backdrop:bg-black/50">
    <div class="p-6 min-w-[340px] max-w-[480px]">
      <h3 class="text-sm font-semibold mb-3">Import from History</h3>
      <div id="history-import-loading" class="text-sm text-gray-500">Loading history...</div>
      <div id="history-import-list" class="flex flex-col gap-1 max-h-[400px] overflow-y-auto" hidden></div>
      <div id="history-import-empty" class="text-sm text-gray-500" hidden>No new sites found in your history.</div>
      <div id="history-import-error" class="text-sm text-red-500" hidden>Could not load history.</div>
      <button id="history-import-close" type="button" class="mt-4 px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors text-sm">Close</button>
    </div>
  </dialog>
```

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(history): add import button and dialog markup"
```

---

### Task 3: Toggle Import Button Visibility in `shortcut-settings.ts`

**Files:**
- Modify: `src/shortcut-settings.ts`

- [ ] **Step 1: Add the button reference and visibility toggle in `renderList()`**

In `src/shortcut-settings.ts`, inside the `renderList()` function, after the existing `const backBtn` line (around line 110), add:

```ts
  const importHistoryBtn = document.getElementById(
    "sc-import-history"
  ) as HTMLButtonElement
```

Then in the early return when `!tab` (around line 121-126), add `importHistoryBtn.hidden = true` alongside the other hidden assignments:

```ts
  if (!tab) {
    addShortcutBtn.hidden = true
    addFolderBtn.hidden = true
    deleteTabBtn.hidden = true
    backBtn.hidden = true
    importHistoryBtn.hidden = true
    return
  }
```

And after `addFolderBtn.hidden = inFolder` (around line 145), add:

```ts
  importHistoryBtn.hidden = inFolder
```

This hides the import button when viewing inside a folder (same as Add Folder), and shows it at the top-level tab view.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-settings.ts
git commit -m "feat(history): toggle import button visibility in shortcut settings"
```

---

### Task 4: Implement `history-import.ts` — API Wrappers and Batched Fetch

**Files:**
- Create: `src/history-import.ts`

- [ ] **Step 1: Create the file with constants, API ref, and callback wrappers**

Create `src/history-import.ts` with the following content:

```ts
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
```

- [ ] **Step 2: Add the batched fetch function**

Append to `src/history-import.ts`:

```ts
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
```

- [ ] **Step 3: Commit**

```bash
git add src/history-import.ts
git commit -m "feat(history): add API wrappers and batched history fetch"
```

---

### Task 5: Implement `history-import.ts` — Filtering, Ranking, and Hostname Extraction

**Files:**
- Modify: `src/history-import.ts`

- [ ] **Step 1: Add helper functions**

Append to `src/history-import.ts`:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/history-import.ts
git commit -m "feat(history): add filtering, ranking, and hostname extraction"
```

---

### Task 6: Implement `history-import.ts` — Modal UI Rendering and Event Handling

**Files:**
- Modify: `src/history-import.ts`

- [ ] **Step 1: Add the modal rendering and interaction logic**

Append to `src/history-import.ts`:

```ts
function getSelectedTabId(): string | null {
  const select = document.getElementById("sc-tab-select") as HTMLSelectElement | null
  return select?.value || null
}

function prependShortcut(url: string, name: string): void {
  const tabId = getSelectedTabId()
  if (!tabId) return
  const tabs: Tab[] = store.local.get("shortcuts")
  const updated = tabs.map((t) => {
    if (t.id !== tabId || t.items.length >= MAX_ITEMS_PER_TAB) return t
    const sc: Shortcut = { type: "shortcut", id: crypto.randomUUID(), name, url }
    return { ...t, items: [sc, ...t.items] }
  })
  store.local.set("shortcuts", updated)
}

function renderResults(
  entries: HistoryEntry[],
  list: HTMLElement
): void {
  list.innerHTML = ""
  for (const entry of entries) {
    const row = document.createElement("div")
    row.className = "flex items-center gap-2 px-2 py-1.5 bg-gray-100 rounded text-sm"

    const info = document.createElement("div")
    info.className = "flex-1 min-w-0"

    const title = document.createElement("div")
    title.className = "font-medium truncate"
    title.textContent = extractHostname(entry.url)
    info.appendChild(title)

    const urlText = document.createElement("div")
    urlText.className = "text-xs text-gray-400 truncate"
    urlText.textContent = entry.url
    info.appendChild(urlText)

    row.appendChild(info)

    const count = document.createElement("span")
    count.className = "text-xs text-gray-400 shrink-0"
    count.textContent = String(entry.visitCount)
    row.appendChild(count)

    const addBtn = document.createElement("button")
    addBtn.className = "text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 shrink-0"
    addBtn.textContent = "Add"

    const tabId = getSelectedTabId()
    if (tabId) {
      const tabs: Tab[] = store.local.get("shortcuts")
      const tab = tabs.find((t) => t.id === tabId)
      if (tab && tab.items.length >= MAX_ITEMS_PER_TAB) addBtn.disabled = true
    }

    addBtn.addEventListener("click", () => {
      prependShortcut(entry.url, extractHostname(entry.url))
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

  importBtn.addEventListener("click", () => openImportDialog())
  closeBtn.addEventListener("click", () => dialog.close())
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/history-import.ts
git commit -m "feat(history): add modal UI rendering and event handling"
```

---

### Task 7: Integration — Wire `initHistoryImport` into App Entrypoint

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import and call `initHistoryImport`**

In `src/index.ts`, add the import at the top with the other imports:

```ts
import { initHistoryImport } from "./history-import"
```

Add the call inside the `DOMContentLoaded` handler, after `initShortcutSettings()`:

```ts
  initShortcutSettings()
  initHistoryImport()
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(history): wire initHistoryImport into app entrypoint"
```

---

### Task 8: Build and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run the full build**

Run: `./build.sh`
Expected: Clean build, `dist/` directory updated with no errors.

- [ ] **Step 2: Verify output files**

Check that `dist/index.js` contains the history import code:

Run: `grep -l "history-import\|historySearch\|Import from History" dist/index.js`
Expected: Match found, confirming the module was bundled.

- [ ] **Step 3: Verify manifest includes history permission**

Run: `grep "history" dist/manifest.json`
Expected: `"history"` appears in the permissions array.
