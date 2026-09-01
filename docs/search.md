# Search

The search bar in the center of the page, and the provider registry behind it.

**Files:** `src/search.ts` (183 lines), `src/search-provider-engine.ts` (65), `src/search-provider-shortcuts.ts` (102), `src/url.ts` (22).

**DOM:** `#search-wrapper` → `#search-input` + `#search-results`, all static in `index.html`.

## The provider contract

```ts
type SearchResult = {
  label: string
  description?: string      // right-aligned, muted
  action: () => void        // what Enter or a click does
  icon?: HTMLElement
  group?: string            // consecutive results sharing a group render together
}

type SearchProvider = {
  id: string
  order: number             // ascending; determines result order
  maxResults: number
  debounced?: boolean       // if true, can be deferred when debounceSearch is on
  query(input: string): SearchResult[]
}
```

`query()` is **synchronous** — it returns results, it doesn't resolve them. Both current providers read from the store, which is a synchronous cache, so nothing needs to await. A provider that had to hit the network couldn't satisfy this interface as written.

Providers are registered with `registerProvider(provider)`. `initSearch()` registers the two built-ins itself (`search.ts:103`).

## Query flow

On every `input` event, `runQuery()`:

1. Cancels any pending debounce timer.
2. If `debounceSearch` is on **and** at least one provider is marked `debounced`, it renders the non-debounced providers immediately, then schedules a **400ms** timer that re-queries everything and re-renders.
3. Otherwise it queries every provider and renders once.

`queryProviders()` sorts providers by `order` and concatenates their results — there's no cross-provider ranking, interleaving, or dedup. `searchEngineProvider` is `order: 0` so "search the web for X" is always first; `shortcutsProvider` is `order: 1`.

The point of `debounceSearch` (off by default, exposed in Settings → Widgets → Search with the hint "enable this if the search lags when you type") is that the shortcuts provider walks every shortcut on every keystroke. With a large collection that's the expensive part, and deferring it keeps the search-engine row responsive.

## Rendering

`render()` (`search.ts:41`) rebuilds `#search-results` from scratch. Consecutive results with the same `group` are collected into a block, and an `<hr>` is drawn **between** blocks — so grouping is purely visual separation, with no headers. Each row is icon + label + optional right-aligned description, with the active row tinted `bg-surface`.

**Keyboard** (on the input):

| Key | Effect |
|---|---|
| ArrowDown / ArrowUp | Move `activeIndex`, wrapping at both ends |
| Enter | Run the active result's `action()` |
| Escape | Clear the input, the results, and any pending debounce |

**Visibility.** Results show only when the input has focus *and* there is at least one result. A document-level `mousedown` outside `#search-wrapper` hides them.

## Built-in providers

### Search engine (`order: 0`)

Emits exactly one result: `Search {Engine} for '{query}'`. The URL comes from `ENGINE_URLS` keyed by the `searchEngine` setting; the query is `encodeURIComponent`-encoded. `searchOpenInNewTab` decides `window.open(url, "_blank")` versus `location.href`.

| Engine | Endpoint |
|---|---|
| Google | `google.com/search?q=` |
| Bing | `bing.com/search?q=` |
| Yahoo | `search.yahoo.com/search?p=` |
| DuckDuckGo | `duckduckgo.com/?q=` |
| Ecosia | `ecosia.org/search?q=` |
| Qwant | `qwant.com/?q=` |
| Startpage | `startpage.com/sp/search?query=` |

Each engine also carries a hand-drawn inline SVG logo in `ENGINE_SVGS`. Google's is the real four-color mark; the rest are rough approximations.

### Shortcuts (`order: 1`, `debounced: true`, `maxResults: 3`)

Flattens every tab's items *and* every folder's children into one `Shortcut[]`, then returns the **first three** whose name or URL contains the query as a case-insensitive substring. Label is the shortcut name, description is `prettyUrl(url)`, icon is the shortcut's color tile or its Google favicon (falling back to the `link` glyph on load error). Opening honors `searchOpenInNewTab`.

Matching is substring-only and unranked — first three in traversal order win, so a shortcut named exactly the query can lose to three partial matches that happen to sit earlier in the list.

## prettyUrl

`url.ts` — shortens a URL for display:

- Adds `https://` if there's no scheme, and returns the input unchanged if it still won't parse.
- Strips a leading `www.`.
- Keeps a single path segment as-is; collapses two or more to `/.../lastSegment`.
- Appends the query string and hash verbatim.

```
https://www.github.com/anthropics/claude-code/issues  →  github.com/.../issues
https://example.com/about                             →  example.com/about
```

Used by the shortcuts search provider and by the shortcuts settings rows.

## Adding a provider

```ts
// src/search-provider-history.ts
import type { SearchProvider, SearchResult } from "./search"

export const historyProvider: SearchProvider = {
  id: "history",
  order: 2,
  maxResults: 5,
  debounced: true,
  query(input) {
    if (!input.trim()) return []
    return /* … */
  },
}
```

Then register it in `initSearch()`. Two things to know: `query()` must be synchronous, and **`maxResults` is not enforced by the engine** — cap the list yourself, the way `shortcutsProvider` does with `this.maxResults`.

## Refactor candidates

- **`maxResults` is a lie.** It's part of the `SearchProvider` type and nothing in `search.ts` reads it; only the shortcuts provider honors its own value. Either enforce it in `queryProviders()` or drop it from the interface.
- **A second copy of the favicon helper**, also byte-identical to `dock.ts`'s, with the same no-scheme failure.
- **No ranking.** Results are provider order then insertion order. An exact name match doesn't beat a substring match, and there's no scoring layer where one could go.
- **Synchronous `query()` blocks async providers.** History, bookmarks, and tab search all need to await. Making `query()` return `SearchResult[] | Promise<SearchResult[]>` and rendering incrementally is the change that unlocks the obvious next providers.
- **Full re-render per keystroke and per arrow key.** `render()` rebuilds every row from scratch, including re-creating every icon element, just to move the highlight.
- **Two navigation implementations.** Both providers inline their own `newTab ? window.open : location.href`, which is a third copy of `dock.ts`'s `navigate()` — and they read a *different* setting (`searchOpenInNewTab` vs `shortcutsOpenIn`), so opening the same shortcut from the dock and from search can behave differently.
- **`newTab` is captured at query time**, not at action time, so a result rendered before the setting changes still uses the old behavior.
- **Escape both clears the query and dismisses**, with no intermediate step, and there's no keyboard shortcut to focus the search bar in the first place.
- **Engine logos are approximations.** Five of the seven `ENGINE_SVGS` are hand-drawn stand-ins rather than the real marks.
- **Groups render as bare separators.** The `group` field only draws an `<hr>`; with more providers, labeled sections would be worth having.
