# Search Bar Improvements Design

## Overview

Improve the search bar dropdown UI with design system integration, visual grouping of results, icons for each result type, a new "open in new tab" setting, and a debounce explainer.

## 1. New Setting: `searchOpenInNewTab`

- **Type:** `boolean`
- **Default:** `false` (same tab)
- **Store key:** `searchOpenInNewTab` in `SyncSettings`
- **Behavior:** When `true`, both engine search results and shortcut results open via `window.open(url, "_blank")`. When `false`, they navigate via `location.href = url`.
- **Settings UI:** Checkbox labeled "Open results in new tab" in the Search accordion in the Widgets tab.

## 2. Search Result Icons

### Engine Results

Each of the 7 supported engines (Google, Bing, Yahoo, DuckDuckGo, Ecosia, Qwant, Startpage) gets an inline SVG logo bundled in `search-provider-engine.ts`.

The `SearchResult.icon` field type changes from `string | undefined` to `HTMLElement | undefined`. The engine provider creates a `<span>` containing the engine's SVG logo and passes it as the result's icon.

### Shortcut Results

The shortcuts provider reads each matched shortcut's `icon` field and produces an `HTMLElement`:

- `{ type: "favicon" }` — an `<img>` element loading the favicon from the shortcut's URL domain
- `{ type: "color", color }` — a small colored circle `<span>` matching the shortcut's color
- No icon set — a generic globe/link SVG as fallback

## 3. Render Changes

### Design System Integration

Replace the current raw `bg-page-overlay/30` styling on the search results dropdown with design system tokens:

- Container: `bg-panel`, `rounded-theme`, `border border-input-border/20`
- Result rows: `text-foreground`, hover state using `bg-surface`
- Description text: `text-muted`

The search input itself stays as-is (it uses `bg-page-overlay/30` and `text-page-foreground` intentionally to blend with the background image).

### Result Row Layout

Each result row: **icon (left, fixed width) | label (flex grow) | description (right, truncated, muted)**

Icons are sized consistently (16x16 or similar) and vertically centered.

### Visual Divider

A thin `<hr>` using `border-input-border` is inserted between the engine result group and the shortcut result group. The divider only appears when both groups have results.

### Grouping

The `render()` function receives results tagged with a provider ID. It groups results by provider (engine first, shortcuts second) and renders each group sequentially, inserting the divider between groups.

To support this, `SearchResult` gains an optional `group` field (string) set by each provider. The render function groups by this field in the order results appear.

## 4. Debounce Explainer

Below the "Debounce shortcut search" checkbox in the Search accordion, add a `<span>` with classes for small muted text (e.g., `text-muted text-xs`) containing: "Enable this if the search lags when you type"

## 5. Files Changed

| File | Change |
|------|--------|
| `src/defaults.ts` | Add `searchOpenInNewTab: boolean` to `SyncSettings` type, add default `false` to `syncDefaults` |
| `src/search.ts` | Update `SearchResult` type (`icon: HTMLElement \| undefined`, add `group: string`), update `render()` for grouped layout with icons and divider, apply design system classes to dropdown |
| `src/search-provider-engine.ts` | Bundle 7 engine SVG logos, return icon elements in results, read `searchOpenInNewTab` to decide navigation behavior |
| `src/search-provider-shortcuts.ts` | Build shortcut icon elements from shortcut data, return them in results, read `searchOpenInNewTab` to decide navigation behavior |
| `src/settings.ts` | Add "Open results in new tab" checkbox, add debounce explainer text below debounce checkbox |
| `src/index.html` | Update `#search-results` container classes to use design system tokens (`bg-panel rounded-theme` etc.) |

## 6. Keyboard Navigation

No changes to keyboard navigation logic. The flat list of result `<div>` children still works the same way. The `<hr>` divider is skipped during arrow key navigation by checking `tagName !== "HR"` (or by only selecting result elements via a data attribute/class).
