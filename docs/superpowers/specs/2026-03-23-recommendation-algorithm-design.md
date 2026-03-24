# Recommendation Algorithm Design

## Overview

A dynamic recommendation system that analyzes the user's browsing history to surface 0-2 smart shortcut suggestions in the dock, tailored to the current time of day and day of week. The feature is opt-in via a settings toggle (default off).

## Data Structure & Storage

The core data structure is a heatmap mapping domains to a 7×24 grid of visit counts:

```ts
type DomainHeatmap = {
  [domain: string]: number[][]  // [dayOfWeek 0-6][hour 0-23] = visit count
}

type RecommendationData = {
  heatmap: DomainHeatmap
  builtAt: number  // timestamp of last analysis
}
```

**Storage keys:**

| Key | Namespace | Type | Default | Purpose |
|-----|-----------|------|---------|---------|
| `recommendationsEnabled` | sync | `boolean` | `false` | Toggle, syncs across devices |
| `recommendationData` | local | `RecommendationData \| null` | `null` | Heatmap, device-specific |

The heatmap is stored in `store.local` because it is device-specific (each machine has different browsing history) and can be large. The toggle is in `store.sync` so the user's preference follows them across devices.

**Storage budget:** The heatmap is capped at **300 domains** (kept by highest total visit count). At 300 domains × 7 days × 24 hours = 50,400 numbers, the JSON is ~100-150KB — well within both the `browser.storage.local` limit (10MB for MV3) and the `localStorage` mirror limit (~5MB shared with other local settings like shortcuts and todos).

## Analysis — Building the Heatmap

### When it runs

On every new tab open, if `recommendationsEnabled` is true and `builtAt` is either null or older than 24 hours, the analysis runs asynchronously in the background.

### Process

1. Fetch the last 45 days of history using `chrome.history.search` in batches (same sliding-window pattern as `history-import.ts`). Each batch returns `HistoryItem` objects that include `lastVisitTime`.
2. As the sliding `endTime` window moves backward, the same URL may appear in multiple batches at different `lastVisitTime` values. For each occurrence, normalize the URL to its domain, extract the day-of-week and hour from `lastVisitTime`, and increment `heatmap[domain][day][hour]`.
3. This approach avoids calling `getVisits` entirely — the batched search with a sliding window naturally surfaces multiple visit timestamps per URL without any per-URL IPC calls.
4. After processing all batches, prune the heatmap to the top 300 domains by total visit count.
5. Save the result via `store.local.set("recommendationData", { heatmap, builtAt: Date.now() })`.

**Why not `getVisits`:** Calling `getVisits` per-URL would require thousands of IPC calls to the browser's history database, taking tens of seconds. The sliding-window batch approach gives us per-visit temporal data for free, at the cost of slightly less granularity (we see one timestamp per URL per batch, not every visit). For recommendation purposes, this is more than sufficient.

### Key behaviors

- URLs are normalized to domains (e.g., `https://www.youtube.com/watch?v=abc` → `youtube.com`) using the same hostname extraction logic as history-import.
- Blocked schemes are filtered out (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `moz-extension:`, `brave:`).
- The analysis runs in a `setTimeout(async () => { ... }, 0)` to yield to rendering first.
- A module-level flag prevents double execution if the user opens two tabs rapidly.
- Batches yield to the event loop periodically (`await new Promise(r => setTimeout(r, 0))` every N batches) to avoid blocking the main thread.

## Scoring — Gaussian-Weighted Query

### When it runs

On every new tab open, synchronously read `recommendationData` from the store cache and compute scores. No async needed — the data is already in the in-memory cache.

### Algorithm

Given the current `day` (0-6) and fractional `hour` (`hours + minutes / 60`, e.g., 14:30 → 14.5), for each domain in the heatmap:

1. **Score the current day** using a Gaussian centered on the current hour, summing contributions from all 24 hour slots:
   ```
   d = min(abs(h - currentHour), 24 - abs(h - currentHour))  // circular distance
   score += count[day][h] * exp(-(d² / (2 * σ²)))
   ```
   with `σ = 2` (slots within ~2 hours contribute meaningfully, beyond ~4 hours the contribution is negligible). The circular distance handles midnight wrapping (hour 23 is 1 hour from hour 0, not 23).

2. **Add adjacent day-of-week contributions** at reduced weight (0.3). Adjacent days wrap at week boundaries: Sunday's neighbors are Saturday and Monday (`(day - 1 + 7) % 7` and `(day + 1) % 7`). The same Gaussian-over-hours scoring is applied to each adjacent day's row.

3. The final score is the weighted sum across day contributions.

### Thresholding

A domain must score above `MIN_SCORE = 5.0` to be recommended. This threshold corresponds to roughly 5 visits concentrated near the current time slot. This controls the 0/1/2 behavior — only domains with sufficient confidence are shown.

### Filtering & ranking

- Exclude domains already present in the **active dock tab** (other tabs are fine). Comparison is at the domain level — shortcut URLs are normalized to domains using the same `extractHostname` logic.
- Sort remaining domains by score descending.
- Take the top 2 (or fewer if insufficient qualify).

## Dock Rendering

### Placement

Recommendations are appended to the right end of the dock items, after a vertical divider. The divider matches the style of the existing tab/items divider (`border-r border-white/20 pr-2 mr-2`).

### Styling

Recommendation buttons use a subtly different style from regular shortcuts:
- Reduced opacity background: `bg-white/10` instead of `bg-white/20`
- Prefixed with a sparkle character: `✦`
- Same hover behavior as regular shortcuts

### Behavior

- Clicking a recommendation opens the URL in a new tab (same as regular shortcuts).
- No pin/save action — just navigation.

### Reactive updates

- Recommendations are computed on init and cached in a module-level variable.
- The dock's `render()` function reads the cached recommendations and appends them.
- Subscribing to `recommendationsEnabled` triggers a dock re-render when the toggle changes.
- When the active tab changes, recommendations are re-filtered against the now-active tab's domains.
- After a background analysis completes, the cached recommendations are recomputed and the dock is re-rendered so the current tab picks up fresh data immediately (rather than waiting for the next tab open).

### When recommendations are hidden

- `recommendationsEnabled` is false
- `recommendationData` is null (never analyzed)
- No domains cross the minimum score threshold
- The dock itself is hidden (no shortcuts configured)

### Example layout

```
[Tab1] [Tab2] | [YouTube] [Reddit] [Gmail] | ✦ Hacker News  ✦ Stack Overflow
               ^-- regular items --^         ^-- recommendations --^
```

## Module Structure

All recommendation logic lives in a single new file: `src/recommendations.ts`.

### Exports

- `initRecommendations(): void` — called from `index.ts` on DOMContentLoaded. Checks if enabled, triggers analysis if stale, computes initial recommendations.
- `getRecommendations(excludeDomains: Set<string>): { name: string, url: string }[]` — returns 0-2 recommendations, filtering out the provided domains. The caller extracts domains from the active tab's shortcut URLs using the shared hostname extraction logic. The returned `url` is `https://${domain}`. Called by the dock's `render()` function.

### Internal responsibilities

- Heatmap analysis (fetching history, building the data structure)
- Gaussian scoring
- Staleness check and rebuild trigger
- Analysis-in-progress guard flag

## Integration Points

| File | Change |
|------|--------|
| `src/defaults.ts` | Add `recommendationsEnabled: boolean` to `SyncSettings`, add `recommendationData: RecommendationData \| null` to `LocalSettings` |
| `src/index.ts` | Call `initRecommendations()` after `store.init()` |
| `src/dock.ts` | Import `getRecommendations`, call in `render()`, append results after a divider |
| `src/settings.ts` | Wire up the toggle checkbox |
| `src/index.html` | Add recommendations fieldset to settings dialog (after Shortcuts section) |
| `src/recommendations.ts` | New file — all analysis, scoring, and recommendation logic |

## Settings UI

A single checkbox in a new fieldset placed after the Shortcuts section in the settings dialog:

```html
<fieldset class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Recommendations</legend>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-recommendations-enabled" class="rounded">
      <label for="settings-recommendations-enabled" class="text-sm">
        Show smart suggestions in dock
      </label>
    </div>
  </div>
</fieldset>
```

Standard settings wiring: read initial value, update on change, subscribe for cross-tab sync.
