# Search Palette Design

## Overview

A centered search bar that doubles as a command palette. Queries a registry of providers and displays results in a dropdown. The first provider is a search engine (configurable); the second matches user shortcuts by name/URL. The system is extensible — new providers can be added later.

## Provider Interface

```ts
type SearchResult = {
  label: string
  description?: string
  action: () => void
  icon?: string
}

type SearchProvider = {
  id: string
  order: number
  maxResults: number
  debounced?: boolean
  query(input: string): SearchResult[]
}
```

The `query()` method is synchronous. All current providers read from the in-memory store cache, which is always synchronous. If a future provider needs async querying, the interface will need to be extended at that point.

Each provider is responsible for returning at most `maxResults` items from `query()`. The registry does not trim results.

The `debounced` flag marks a provider as subject to debounce when the user has enabled `debounceSearch`. See the Debounce section for details.

### Provider Registry

`src/search.ts` exports a `registerProvider(provider: SearchProvider)` function. Providers are stored in an internal array, sorted by `order` on each query pass. The palette loops through registered providers, concatenates their results, and renders the dropdown. Duplicate `id` values are not guarded against — callers are responsible for registering each provider once.

```ts
const providers: SearchProvider[] = []

function registerProvider(provider: SearchProvider): void {
  providers.push(provider)
}
```

## Search Engine Provider

- `id: "search-engine"`, `order: 0`, `maxResults: 1`
- Produces a single result: "Search [engine] for '[query]'"
- Reads engine from `store.sync.get("searchEngine")`
- Returns no results when input is empty
- Action: `window.open(url + encodeURIComponent(query), "_blank")`

### URL Templates

| Engine      | URL                                          |
|-------------|----------------------------------------------|
| google      | `https://www.google.com/search?q=`           |
| bing        | `https://www.bing.com/search?q=`             |
| yahoo       | `https://search.yahoo.com/search?p=`         |
| duckduckgo  | `https://duckduckgo.com/?q=`                 |
| ecosia      | `https://www.ecosia.org/search?q=`           |
| qwant       | `https://www.qwant.com/?q=`                  |
| startpage   | `https://www.startpage.com/sp/search?query=` |

## Shortcuts Provider

- `id: "shortcuts"`, `order: 1`, `maxResults: 3`, `debounced: true`
- Reads shortcuts from `store.local.get("shortcuts")` at query time (always fresh from the in-memory cache)
- Case-insensitive substring match against `name` and `url`
- Returns top 3 matches
- Each result: `label` = shortcut name, `description` = URL, `action` = `window.open(url, "_blank")`

### Flattening Algorithm

The `Tab[]` structure has two levels of shortcuts: top-level `TabItem[]` (which are `Shortcut | Folder`) and `Folder.children: Shortcut[]`. The provider flattens both levels:

```
for each tab in Tab[]:
  for each item in tab.items:
    if item.type === "shortcut" → include in flat list
    if item.type === "folder"  → include each child in item.children
```

Folders themselves are not matchable — only `Shortcut` objects.

### Debounce

When `store.sync.get("debounceSearch")` is `true`, the palette applies a 400ms debounce to any provider with `debounced: true`. The palette manages the debounce timer — on each input change:

1. Providers without `debounced` (or `debounced: false`) are called immediately via `query()`
2. For providers with `debounced: true`, the palette starts/resets a 400ms timer. During the window, these providers are not queried — they contribute zero results. When the timer fires, all providers (debounced and non-debounced) are re-queried and the full result list is rebuilt from scratch.

This means during the debounce window, the dropdown shows only the search engine result. When the timer fires, shortcut results appear. The active selection resets to index 0 whenever the result list is re-rendered.

The palette reads `store.sync.get("debounceSearch")` on each input event (cheap — synchronous cache read). This ensures runtime changes from the settings dialog take effect immediately without requiring a subscription or page reload.

When `debounceSearch` is `false`, all providers are queried immediately regardless of the `debounced` flag.

## New Settings

Added to `SyncSettings` in `src/defaults.ts`:

```ts
searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage"
debounceSearch: boolean
```

Defaults: `searchEngine: "google"`, `debounceSearch: false`

## Palette UI

### Layout

The search bar is vertically and horizontally centered in the viewport. It contains an `<input>` and a dropdown `<div>` for results.

```
┌──────────────────────────────────┐
│  [ Search input               ]  │
│  ┌────────────────────────────┐  │
│  │ Search Google for 'x'     │  │  ← search engine (always first)
│  │ GitHub  github.com         │  │  ← shortcut match
│  │ Gmail   mail.google.com    │  │  ← shortcut match
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### Element IDs

| Element | ID | Purpose |
|---------|----|---------|
| Search input | `search-input` | Text input for queries |
| Results dropdown | `search-results` | Container for result items |
| Wrapper | `search-wrapper` | Centered container holding input + dropdown |
| Settings engine select | `settings-search-engine` | `<select>` for engine choice |
| Settings debounce checkbox | `settings-debounce-search` | `<input type="checkbox">` for debounce toggle |

### Keyboard Behavior

- Typing updates the query; providers are called and results render
- Arrow Down / Arrow Up moves the active selection through the results list
- When results exist, the first item is selected by default
- Selection wraps: Down from last goes to first, Up from first goes to last
- Enter opens the selected result's `action()`
- Escape clears the input and closes the dropdown

### Mouse Behavior

Clicking a result item calls its `action()` directly (no need to select first then press Enter).

### Focus & Visibility

- The dropdown is visible when the input is focused and the result list is non-empty
- When the result list is empty (input is empty, or no providers returned results), the dropdown hides
- Clicking outside the input and dropdown hides the dropdown. Use a `mousedown` listener on `document` — do not use `focusout`, which fires before `click` and would prevent result item clicks from reaching their handler.
- The search input is not auto-focused on page load

### Active Item Styling

The selected item gets a distinct background (e.g. `bg-white/20`), fitting the existing Tailwind patterns.

### Result Rendering

Each result item shows the `label`. If `description` is present, it is shown as secondary text (smaller, muted) to the right of or below the label. If `description` is absent (e.g. the search engine result), only the label is shown.

## Settings UI Additions

Two new controls in the settings dialog, in a new fieldset after the Shortcuts fieldset:

1. **Search Engine selector:** A `<select>` with the 7 engine options. Initialize the selected value from `store.sync.get("searchEngine")`, then subscribe for cross-tab sync.
2. **Debounce toggle:** A checkbox labeled "Debounce shortcut search". Initialize the checked state from `store.sync.get("debounceSearch")`, then subscribe for cross-tab sync.

Both are wired in `src/settings.ts`, following the same read-then-subscribe pattern used for the color buttons.

## File Structure

### New Files

- `src/search.ts` — Palette UI, keyboard navigation, provider registry (`registerProvider`), `initSearch()` export
- `src/search-provider-engine.ts` — Search engine provider
- `src/search-provider-shortcuts.ts` — Shortcuts provider with debounce support

### Modified Files

- `src/defaults.ts` — Add `searchEngine` and `debounceSearch` to `SyncSettings` with defaults
- `src/settings.ts` — Wire search engine select and debounce toggle
- `src/index.html` — Add search bar markup centered in viewport; add settings controls markup
- `src/index.ts` — Add `import { initSearch } from "./search"` and call `initSearch()` after `await store.init()` and the existing init calls, inside the `DOMContentLoaded` handler
