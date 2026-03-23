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
  query(input: string): SearchResult[]
}
```

Providers are registered once at init time. The palette queries all providers sorted by `order`, concatenates results, and renders the dropdown.

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

- `id: "shortcuts"`, `order: 1`, `maxResults: 3`
- Reads shortcuts from `store.local.get("shortcuts")`
- Flattens all `Tab[]` into a flat list of `Shortcut` objects (including children inside folders — folders themselves are not matchable)
- Case-insensitive substring match against `name` and `url`
- Returns top 3 matches
- Each result: `label` = shortcut name, `description` = URL, `action` = open URL in new tab

### Debounce

When `store.sync.get("debounceSearch")` is `true`, the palette waits 400ms after the last keystroke before querying this provider. The search engine provider is always queried immediately — debounce only applies to the shortcuts provider.

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

### Keyboard Behavior

- Typing updates the query; providers are called and results render
- Arrow Down / Arrow Up moves the active selection through the results list
- The first item (search engine result) is selected by default
- Selection wraps: Down from last goes to first, Up from first goes to last
- Enter opens the selected result's `action()`
- Escape clears the input and closes the dropdown

### Focus Behavior

- Dropdown shows when the input has text and is focused
- Clicking outside the input and dropdown hides the dropdown
- The search input is not auto-focused on page load

### Active Item Styling

The selected item gets a distinct background (e.g. `bg-white/20`), fitting the existing Tailwind patterns.

## Settings UI Additions

Two new controls in the settings dialog, in a new fieldset after the Shortcuts fieldset:

1. **Search Engine selector:** A `<select>` with the 7 engine options. Reads/writes `store.sync` key `searchEngine`. Subscribes to changes for cross-tab sync.
2. **Debounce toggle:** A checkbox labeled "Debounce shortcut search". Reads/writes `store.sync` key `debounceSearch`. Subscribes to changes.

Both are wired in `src/settings.ts`.

## File Structure

### New Files

- `src/search.ts` — Palette UI, keyboard navigation, provider registry, `initSearch()` export
- `src/search-provider-engine.ts` — Search engine provider
- `src/search-provider-shortcuts.ts` — Shortcuts provider with debounce support

### Modified Files

- `src/defaults.ts` — Add `searchEngine` and `debounceSearch` to `SyncSettings` with defaults
- `src/settings.ts` — Wire search engine select and debounce toggle
- `src/index.html` — Add search bar markup centered in viewport; add settings controls markup
- `src/index.ts` — Import and call `initSearch()` on DOMContentLoaded

### Init Flow

```ts
document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
})
```

`initSearch()` creates the two providers, registers them, and wires up the input/keyboard listeners.
