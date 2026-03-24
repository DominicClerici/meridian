# History Import Design

Import shortcuts from browser history via a modal dialog accessible from the settings panel.

## Overview

A new modal dialog allows users to import their most-visited URLs as shortcuts. The modal is opened from a button in the Shortcuts fieldset of settings. It fetches the user's browsing history from the last 3 months in batches, groups by exact URL, ranks by visit count, filters out existing shortcuts, and presents the top 50 results. Each result has an "Add" button that prepends it to the currently selected tab's shortcuts.

## Browser API Access

```ts
const api = typeof browser !== "undefined" ? browser : chrome
```

All history API calls use callbacks (not promises) for Chrome compatibility. Each callback-based call is wrapped in a Promise for ergonomic async/await usage:

```ts
function historySearch(query: HistoryQuery): Promise<HistoryItem[]> {
  return new Promise((resolve) => {
    api.history.search(query, (results) => resolve(results))
  })
}

function historyGetVisits(details: { url: string }): Promise<VisitItem[]> {
  return new Promise((resolve) => {
    api.history.getVisits(details, (results) => resolve(results))
  })
}
```

## Batched History Fetching

History is fetched in chunks to avoid freezing the browser.

1. Start with `endTime = Date.now()` and `startTime = Date.now() - 90 days` (90 * 24 * 60 * 60 * 1000)
2. Call `history.search({ text: '', startTime, endTime, maxResults: 150 })`
3. Collect results into a `Map<string, { url: string, visitCount: number }>` keyed by exact URL. Skip items where `url` is missing/empty. Default `visitCount` to `0` when undefined.
4. If batch returned 150 results, set `endTime = lastItem.lastVisitTime`. If `lastVisitTime` is undefined, subtract 1ms from the current `endTime` to avoid an infinite loop. Repeat from step 2.
5. If batch returned < 150, history in the range is exhausted — stop

## Visit Counting

Controlled by a `USE_VISIT_COUNT` constant at the top of `history-import.ts`, defaulting to `true`.

- **`true` (default):** Use `visitCount` from each `HistoryItem` directly. This is the all-time visit count — fast, no extra API calls.
- **`false`:** After collecting all URLs from `history.search()`, call `history.getVisits()` sequentially for each URL (one at a time to avoid overwhelming the API), then count only visits where `visitTime >= threeMonthsAgo`. Accurate to the 3-month window but requires N additional API calls.

## Grouping & Ranking

`history.search()` returns unique URLs (one `HistoryItem` per URL). Duplicates across batches should not occur, but the Map keyed by exact URL acts as a safety net — if a URL appears again, the higher visitCount is kept.

After collection:
1. Filter out URLs that already exist as shortcuts (exact URL match across all tabs, including inside folders)
2. Sort by visitCount descending
3. Take top 50

## Hostname Extraction

The shortcut name is derived from the URL's hostname:

```ts
new URL(url).hostname
  → strip leading "www."
  → if length > 64, truncate to 61 chars + "..."
```

Example: `https://www.examplewebsite.com/route/another?param=1` → `examplewebsite.com`

## Modal UI

### Trigger

A standalone button in its own row between `#sc-controls` and `#sc-list` in the Shortcuts fieldset:

```html
<button id="sc-import-history" ...>Import from History</button>
```

The button is hidden when no tab is selected (same pattern as `#sc-add-shortcut`).

### Dialog

A new `<dialog id="history-import-dialog">` in `index.html`, styled consistently with existing dialogs (`rounded-xl p-0 backdrop:bg-black/50`).

### States

1. **Loading** — shown while batching history. Displays "Loading history..." text.
2. **Results** — scrollable list of up to 50 items. Each row shows:
   - Hostname-derived title
   - Full URL in smaller muted text
   - Visit count
   - "Add" button (disabled if the selected tab has reached `MAX_ITEMS_PER_TAB`)
3. **Empty** — "No new sites found in your history."
4. **Error** — "Could not load history." Shown if the history API is unavailable or calls fail. The Promise wrappers should check `chrome.runtime.lastError` and reject on failure.

### Adding a Shortcut

When "Add" is clicked on a result row:
1. Read the currently selected tab ID from `#sc-tab-select.value` in the DOM
2. Create a shortcut: `{ type: "shortcut", id: randomUUID(), name: hostname, url: fullUrl }`
3. Prepend to that tab's `items` array (direct prepend, not `addShortcut()` which appends). Skip if the tab has reached `MAX_ITEMS_PER_TAB`.
4. Save to store via `store.local.set("shortcuts", ...)`
5. Remove the row from the modal list to prevent double-adding
6. The shortcut settings list updates reactively via the existing `store.local.subscribe("shortcuts", ...)` subscription

### Closing

A "Close" button at the bottom. Closing discards modal state. Reopening re-fetches fresh.

## Type Declarations

Add to `src/browser.d.ts`:

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
  search(query: { text: string; startTime?: number; endTime?: number; maxResults?: number }, callback: (results: HistoryItem[]) => void): void
  getVisits(details: { url: string }, callback: (results: VisitItem[]) => void): void
}
```

Add `history: BrowserHistory` to the existing `BrowserAPI` interface.

## Manifest Changes

Add `"history"` to the `permissions` array in `manifest.json`.

## Integration

`history-import.ts` exports `initHistoryImport()`, called from `settings.ts` or `index.ts` alongside other settings init functions.

## File Changes

| File | Change |
|------|--------|
| `src/history-import.ts` | New. Exports `initHistoryImport()`. Contains `USE_VISIT_COUNT` constant, callback wrappers, batched fetch, grouping/ranking, hostname extraction, modal rendering, add-shortcut handler. |
| `src/index.html` | Add import-from-history button in Shortcuts fieldset. Add `<dialog id="history-import-dialog">`. |
| `src/browser.d.ts` | Add `HistoryItem`, `VisitItem`, `BrowserHistory` interfaces. Add `history` to `BrowserAPI`. |
| `manifest.json` | Add `"history"` to permissions. |
| `src/settings.ts` or `src/index.ts` | Call `initHistoryImport()`. |

No changes to: `defaults.ts`, `store.ts`, `shortcuts.ts`, `dock.ts`.

Note: `shortcut-settings.ts` needs a minor update — `renderList()` must toggle visibility of the `#sc-import-history` button alongside the existing `#sc-add-shortcut` button (hidden when no tab is selected).
