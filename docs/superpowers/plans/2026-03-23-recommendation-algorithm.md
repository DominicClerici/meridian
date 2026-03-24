# Recommendation Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a time-aware recommendation system that analyzes browsing history to surface 0-2 smart shortcut suggestions in the dock based on day-of-week and time-of-day patterns.

**Architecture:** Single file `src/recommendations.ts` handles history analysis (sliding-window batches), heatmap storage, Gaussian-weighted scoring, and exports two functions consumed by the dock and init flow. Settings stored across `store.sync` (enabled toggle) and `store.local` (heatmap data). Dock rendering in `src/dock.ts` appends recommendations after a divider. Settings UI wired in `src/settings.ts` with HTML in `src/index.html`.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4 utilities, chrome.history API

**Spec:** `docs/superpowers/specs/2026-03-23-recommendation-algorithm-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/defaults.ts` | Modify | Add `recommendationsEnabled` to `SyncSettings`, add `recommendationData` to `LocalSettings` |
| `src/recommendations.ts` | Create | History analysis, heatmap building, Gaussian scoring, `initRecommendations()` and `getRecommendations()` exports |
| `src/index.html` | Modify | Add Recommendations fieldset to settings dialog |
| `src/settings.ts` | Modify | Wire recommendations enable toggle |
| `src/dock.ts` | Modify | Import `getRecommendations`, append recommendation buttons after a divider |
| `src/index.ts` | Modify | Import and call `initRecommendations()` |

---

### Task 1: Add storage keys and types

**Files:**
- Modify: `src/defaults.ts:4-20` (SyncSettings type), `src/defaults.ts:22-30` (LocalSettings type), `src/defaults.ts:32-48` (syncDefaults), `src/defaults.ts:50-58` (localDefaults)

- [ ] **Step 1: Add `recommendationsEnabled` to `SyncSettings` and its default**

In `src/defaults.ts`, add to the `SyncSettings` type (after `spotifyEnabled: boolean;` on line 19):

```ts
  recommendationsEnabled: boolean;
```

Add to `syncDefaults` (after `spotifyEnabled: true,` on line 47):

```ts
  recommendationsEnabled: false,
```

- [ ] **Step 2: Add `RecommendationData` type and `recommendationData` to `LocalSettings`**

In `src/defaults.ts`, add the type before `SyncSettings` (after the existing imports, before line 4):

```ts
export type DomainHeatmap = {
  [domain: string]: number[][]
}

export type RecommendationData = {
  heatmap: DomainHeatmap
  builtAt: number
}
```

Add to the `LocalSettings` type (after `spotifyTokenExpiry: number | null` on line 29):

```ts
  recommendationData: RecommendationData | null
```

Add to `localDefaults` (after `spotifyTokenExpiry: null,` on line 57):

```ts
  recommendationData: null,
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/defaults.ts
git commit -m "feat(recommendations): add storage keys and types"
```

---

### Task 2: Create recommendations module — history analysis

**Files:**
- Create: `src/recommendations.ts`

- [ ] **Step 1: Create `src/recommendations.ts` with constants, types, and the `historySearch` wrapper**

```ts
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
```

- [ ] **Step 2: Add the `buildHeatmap` function**

Append to `src/recommendations.ts`:

```ts
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
    store.local.set("recommendationData", { heatmap: pruned, builtAt: Date.now() })
    updateCachedRecommendations()
  } catch {
    // History API unavailable or failed — silently skip
  } finally {
    analyzing = false
  }
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
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Errors about missing `updateCachedRecommendations` and exported functions (expected — added in next task)

- [ ] **Step 4: Commit**

```bash
git add src/recommendations.ts
git commit -m "feat(recommendations): add history analysis and heatmap building"
```

---

### Task 3: Add Gaussian scoring and exports

**Files:**
- Modify: `src/recommendations.ts`

- [ ] **Step 1: Add the scoring function**

Append to `src/recommendations.ts`:

```ts
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
```

- [ ] **Step 2: Add `updateCachedRecommendations` and `getRecommendations`**

Append to `src/recommendations.ts`:

```ts
function updateCachedRecommendations(): void {
  const data: RecommendationData | null = store.local.get("recommendationData")
  if (!data) {
    cachedRecommendations = []
    return
  }

  const now = new Date()
  const day = now.getDay()
  const hour = now.getHours() + now.getMinutes() / 60

  const scored: { domain: string; score: number }[] = []
  for (const [domain, grid] of Object.entries(data.heatmap)) {
    const score = scoreDomain(grid, day, hour)
    if (score >= MIN_SCORE) scored.push({ domain, score })
  }

  scored.sort((a, b) => b.score - a.score)
  cachedRecommendations = scored.slice(0, 2).map((s) => ({
    name: s.domain,
    url: `https://${s.domain}`,
  }))
}

export function getRecommendations(
  excludeDomains: Set<string>
): { name: string; url: string }[] {
  if (!store.sync.get("recommendationsEnabled")) return []
  return cachedRecommendations.filter((r) => !excludeDomains.has(r.name)).slice(0, 2)
}
```

- [ ] **Step 3: Add `initRecommendations`**

Append to `src/recommendations.ts`:

```ts
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
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors (or only unrelated pre-existing errors)

- [ ] **Step 5: Commit**

```bash
git add src/recommendations.ts
git commit -m "feat(recommendations): add Gaussian scoring and public API"
```

---

### Task 4: Integrate recommendations into the dock

**Files:**
- Modify: `src/dock.ts:1-2` (imports), `src/dock.ts:84-124` (render function)

- [ ] **Step 1: Add imports and domain extraction helper to `dock.ts`**

In `src/dock.ts`, add to the imports (after line 2):

```ts
import { getRecommendations } from "./recommendations"
```

Add a helper function after `getTabs()` (after line 9):

```ts
function getActiveTabDomains(tab: Tab): Set<string> {
  const domains = new Set<string>()
  for (const item of tab.items) {
    if (item.type === "shortcut") {
      try {
        let h = new URL(item.url).hostname
        if (h.startsWith("www.")) h = h.slice(4)
        if (h) domains.add(h)
      } catch { /* skip invalid URLs */ }
    } else if (item.type === "folder") {
      for (const child of item.children) {
        try {
          let h = new URL(child.url).hostname
          if (h.startsWith("www.")) h = h.slice(4)
          if (h) domains.add(h)
        } catch { /* skip invalid URLs */ }
      }
    }
  }
  return domains
}
```

- [ ] **Step 2: Append recommendations in the `render()` function**

In `src/dock.ts`, after the loop that appends dock items (after line 123, which is `}`), add before the closing `}` of `render()`:

```ts
  const recs = getRecommendations(getActiveTabDomains(activeTab))
  if (recs.length > 0) {
    const divider = document.createElement("div")
    divider.className = "border-l border-white/20 self-stretch ml-1 mr-1"
    itemsContainer.appendChild(divider)

    for (const rec of recs) {
      const btn = document.createElement("button")
      btn.className =
        "px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-sm whitespace-nowrap"
      btn.textContent = "\u2726 " + rec.name
      btn.addEventListener("click", () => {
        window.open(rec.url, "_blank")
      })
      itemsContainer.appendChild(btn)
    }
  }
```

- [ ] **Step 3: Subscribe to `recommendationsEnabled` changes in `initDock`**

In `src/dock.ts`, in the `initDock()` function (after line 128), add:

```ts
  store.sync.subscribe("recommendationsEnabled", render)
  store.local.subscribe("recommendationData", () => {
    updateCachedRecommendations()
    render()
  })
```

Wait — `updateCachedRecommendations` is internal to `recommendations.ts`. Instead, the dock should just re-render when `recommendationData` changes, and `getRecommendations` will read fresh data. But `cachedRecommendations` is a module-level cache that only updates via `updateCachedRecommendations`. The spec says recommendations are recomputed after analysis.

The solution: `recommendations.ts` already calls `updateCachedRecommendations()` inside `buildHeatmap()` after saving. The dock needs to re-render when `recommendationData` changes. Add this subscription:

```ts
  store.sync.subscribe("recommendationsEnabled", render)
  store.local.subscribe("recommendationData", render)
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/dock.ts
git commit -m "feat(recommendations): render recommendations in dock with divider"
```

---

### Task 5: Add settings UI

**Files:**
- Modify: `src/index.html:67` (after Shortcuts fieldset closing tag)
- Modify: `src/settings.ts:119` (after clock subscriptions, before todo section)

- [ ] **Step 1: Add recommendations fieldset to `index.html`**

In `src/index.html`, after the Shortcuts fieldset closing `</fieldset>` on line 67, add:

```html
      <fieldset class="border-0 p-0 m-0 mt-4">
        <legend class="text-sm font-medium mb-2">Recommendations</legend>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <input type="checkbox" id="settings-recommendations-enabled" class="rounded">
            <label for="settings-recommendations-enabled" class="text-sm">Show smart suggestions in dock</label>
          </div>
        </div>
      </fieldset>
```

- [ ] **Step 2: Wire the toggle in `settings.ts`**

In `src/settings.ts`, add the recommendations wiring after the clock subscriptions block (after line 118, before the `const todoEnabled` line):

```ts
  const recsEnabled = document.getElementById("settings-recommendations-enabled") as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () => store.sync.set("recommendationsEnabled", recsEnabled.checked))
  store.sync.subscribe("recommendationsEnabled", (v) => { recsEnabled.checked = v })
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.html src/settings.ts
git commit -m "feat(recommendations): add settings toggle"
```

---

### Task 6: Wire init and final integration

**Files:**
- Modify: `src/index.ts:1-10` (imports), `src/index.ts:15-26` (DOMContentLoaded handler)

- [ ] **Step 1: Import `initRecommendations` in `index.ts`**

In `src/index.ts`, add after the `initHistoryImport` import (after line 10):

```ts
import { initRecommendations } from "./recommendations"
```

- [ ] **Step 2: Call `initRecommendations` in the DOMContentLoaded handler**

In `src/index.ts`, add after `initSpotify()` (after line 25):

```ts
  initRecommendations()
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Build the project**

Run: `./build.sh`
Expected: Successful build with output in `dist/`

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(recommendations): wire init into app entrypoint"
```

---

### Task 7: Manual testing checklist

No code changes — verify the feature works end-to-end in the browser.

- [ ] **Step 1: Load the extension in Chrome**

Go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `dist/` folder.

- [ ] **Step 2: Verify default state**

Open a new tab. The dock should show no recommendations (feature defaults to off). Open Settings and verify the "Recommendations" section appears with the checkbox unchecked.

- [ ] **Step 3: Enable recommendations**

Check the "Show smart suggestions in dock" checkbox. Open a new tab. If there is browsing history, after a moment the dock should show 0-2 recommendations after a vertical divider, each prefixed with `✦`.

- [ ] **Step 4: Verify recommendation behavior**

Click a recommendation — it should open in a new tab. The recommendations should not include any domains already in the active dock tab.

- [ ] **Step 5: Verify toggle off**

Uncheck the setting. Open a new tab. No recommendations should appear.

- [ ] **Step 6: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix(recommendations): address issues found during manual testing"
```
