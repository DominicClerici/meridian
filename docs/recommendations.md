# Recommendations & History Import

Two features built on the `history` permission: a time-of-day model that suggests sites in the dock, and a bulk importer that turns frequently-visited sites into shortcuts.

**Files:** `src/recommendations.ts` · `src/history-api.ts` · `src/ext-call.ts`

Neither module calls `history` directly. Both go through `history-api.ts`, which
papers over the fact that Chrome's `history.search` is callback-first while
Firefox's is promise-only — see [browser-compat.md](browser-compat.md#the-history-api).

> **History import is currently unreachable.** `initHistoryImport()` looks up `#sc-import-history`, which no longer exists anywhere in the codebase, and early-returns. See [architecture.md](architecture.md#refactor-candidates).

## Recommendations

Off by default (`recommendationsEnabled`). When on, up to two suggested sites appear at the left of the dock, separated by a divider.

### The heatmap

`buildHeatmap()` scans **45 days** of history and builds, per domain, a **7×24 grid** of visit counts — day of week × hour of day.

- History is paged in batches of 150 by walking `endTime` backwards from now (the `history.search` API caps `maxResults`), yielding to the event loop every 5 batches so the scan doesn't jank the page.
- Extension and browser-internal schemes are skipped (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `moz-extension:`, `brave:`), and a leading `www.` is stripped.
- Only `lastVisitTime` is available per history item, so **each URL contributes exactly one data point** regardless of how many times it was visited.
- `pruneDomains()` keeps the top **300** domains by total visits.

The result is stored as `recommendationData = { heatmap, builtAt }` in `store.local` and rebuilt when it's more than **24 hours** old.

### Scoring

`scoreDomain(grid, day, hour)` sums, over today plus the two adjacent weekdays:

```
score = Σ weight × count × exp(−dist² / (2σ²))
```

- `weight` is 1.0 for today and `0.3` for yesterday and tomorrow — Tuesday behavior is a decent predictor of Wednesday behavior.
- `dist` is the circular distance in hours between the bucket and now, so 23:00 and 01:00 are two hours apart, not twenty-two.
- `σ = 2`, so a visit two hours off still contributes ~61% and four hours off ~14%.
- The current hour is fractional (`hours + minutes/60`), which makes the curve slide smoothly through the hour rather than jumping at the boundary.

Domains scoring below `MIN_SCORE = 5.0` are dropped; the rest are sorted and the top 10 kept as `{ name: domain, url: "https://" + domain }`.

`getRecommendations(excludeDomains)` (called by `dock.ts`) filters out domains already present in the active dock tab and returns the top **2**.

Scoring runs once per page load into `cachedRecommendations`, not on every dock render.

## History import

Intended as a bulk way to seed shortcuts from what you already visit.

The equivalent scan for the import dialog lives in `shortcut-import.ts`'s `fromHistory()` — **90 days** in batches of 150, deduped by URL, keeping the highest `visitCount`. See [shortcut-import.md](shortcut-import.md).

`getTopEntries()` drops URLs already saved as shortcuts and blocked schemes, sorts by visit count, and keeps the top **50**.

History is now one of five import sources in the shortcuts settings panel, with a pick step and a destination step rather than a per-row Add button. See [shortcut-import.md](shortcut-import.md).

Two DOM dependencies are the reason the feature is dead: `#sc-import-history` (the button that opens the dialog) and `#sc-tab-select` (the destination-tab picker that `getSelectedTabId()` reads). Neither exists. Restoring the feature means re-adding both to the shortcuts settings panel — see [shortcuts.md](shortcuts.md#the-settings-panel).

## Privacy

Both features read the full browsing history through the `history` permission. Everything is computed and stored locally — the heatmap in `store.local`, nothing sent anywhere. Worth stating plainly, since "reads your entire browsing history" is what the permission prompt says.

## Refactor candidates

- **History import is dead code.** 244 lines plus orphaned markup in `index.html` reachable by nothing. Restore the two missing controls or delete the feature.
- **The heatmap undercounts by design.** `history.search` returns one `lastVisitTime` per URL, so a site visited 200 times contributes a single point in one bucket. `history.getVisits` returns the real distribution, at a large cost in time. The scoring model deserves the real data.
- **Two near-identical history scanners.** Both files implement the same paged `historySearch` wrapper, the same batching loop, and the same `BLOCKED_SCHEMES` list, separately.
- **Recommended URLs are guessed.** A domain becomes `https://${domain}`, which misses sites that need a path or redirect from bare domain.
- **The domain is the label.** Suggestions show `mail.google.com`, not "Gmail" — the history item's `title` is available and unused.
- **`recommendations.ts` subscribes at module scope.** The `store.sync.subscribe` at `recommendations.ts:185` runs on import, outside `initRecommendations()` and before `store.init()`, unlike every other module in the app.
- **`initRecommendations()` returns early when disabled**, so enabling the setting relies entirely on that module-scope subscription to do the work — two code paths doing the same thing.
- **`RecommendationData` is unbounded in storage.** 300 domains × 7 × 24 integers as a single JSON value in `store.local`, rewritten wholesale on every rebuild.
- **The 45-day scan blocks nothing but is untracked.** It kicks off via `setTimeout(0)` with no progress, no cancellation, and silent failure.
- **`MIN_SCORE = 5.0` is an unexplained magic threshold** on an unnormalized score, so its meaning shifts with how heavily the browser is used.
