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

The heatmap is stored in `store.local` because it is device-specific (each machine has different browsing history) and can be large. Even with 200 tracked domains, the JSON is ~50-80KB — well within the ~5MB local storage limit. The toggle is in `store.sync` so the user's preference follows them across devices.

## Analysis — Building the Heatmap

### When it runs

On every new tab open, if `recommendationsEnabled` is true and `builtAt` is either null or older than 24 hours, the analysis runs asynchronously in the background.

### Process

1. Fetch the last 45 days of history using `chrome.history.search` in batches (same pattern as `history-import.ts`).
2. For each URL returned, call `chrome.history.getVisits` to get individual visit timestamps.
3. For each visit, extract the day-of-week and hour, normalize the URL to its domain, and increment `heatmap[domain][day][hour]`.
4. Save the result via `store.local.set("recommendationData", { heatmap, builtAt: Date.now() })`.

### Key behaviors

- URLs are normalized to domains (e.g., `https://www.youtube.com/watch?v=abc` → `youtube.com`) using the same hostname extraction logic as history-import.
- Blocked schemes are filtered out (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `moz-extension:`, `brave:`).
- The analysis runs in a `setTimeout(async () => { ... }, 0)` to yield to rendering first.
- A module-level flag prevents double execution if the user opens two tabs rapidly.
- `getVisits` calls are processed in small batches with microtask yields (`await new Promise(r => setTimeout(r, 0))` every N items) to avoid blocking the main thread.

## Scoring — Gaussian-Weighted Query

### When it runs

On every new tab open, synchronously read `recommendationData` from the store cache and compute scores. No async needed — the data is already in the in-memory cache.

### Algorithm

Given the current `day` (0-6) and `hour` (0-23, can be fractional using minutes), for each domain in the heatmap:

1. **Score the current day** using a Gaussian centered on the current hour, summing contributions from all 24 hour slots:
   ```
   score += count[day][h] * exp(-((h - currentHour)² / (2 * σ²)))
   ```
   with `σ = 2` (slots within ~2 hours contribute meaningfully, beyond ~4 hours the contribution is negligible).

2. **Add adjacent day-of-week contributions** at reduced weight (0.3). For example, if it's Wednesday, Tuesday and Thursday counts contribute at 30% weight using the same Gaussian over hours. This captures weekday vs weekend patterns without hard cutoffs.

3. The final score is the weighted sum across day contributions.

### Thresholding

A domain must score above a minimum threshold (equivalent to ~5 visits in the relevant time window) to be recommended. This controls the 0/1/2 behavior — only domains with sufficient confidence are shown.

### Filtering & ranking

- Exclude domains already present in the **active dock tab** (other tabs are fine).
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

- Recommendations are computed once on init and cached in a module-level variable.
- The dock's `render()` function reads the cached recommendations and appends them.
- Subscribing to `recommendationsEnabled` triggers a dock re-render when the toggle changes.
- When the active tab changes, recommendations are re-filtered against the now-active tab's URLs.

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
- `getRecommendations(excludeUrls: Set<string>): { name: string, url: string }[]` — returns 0-2 recommendations, filtering out the provided URLs. Called by the dock's `render()` function.

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
