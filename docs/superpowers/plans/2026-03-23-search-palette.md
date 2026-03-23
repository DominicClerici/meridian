# Search Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered search palette with a provider-based architecture, supporting web search and shortcut matching, with configurable search engine and debounce settings.

**Architecture:** Provider registry pattern — `search.ts` owns the palette UI and queries registered `SearchProvider` objects. Two providers ship initially: search engine (always first, single result) and shortcuts (substring match, top 3). Debounce is managed by the palette layer based on a per-provider `debounced` flag and the `debounceSearch` user setting.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4, browser extension storage API via existing store.

**Spec:** `docs/superpowers/specs/2026-03-23-search-palette-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/defaults.ts` | Modify | Add `searchEngine` and `debounceSearch` to `SyncSettings` |
| `src/search.ts` | Create | Shared types (`SearchResult`, `SearchProvider`), provider registry, palette UI, keyboard/mouse navigation, debounce timer, `initSearch()` |
| `src/search-provider-engine.ts` | Create | Search engine provider — URL templates, query produces single "Search X for Y" result |
| `src/search-provider-shortcuts.ts` | Create | Shortcuts provider — flatten Tab[], substring match, return top 3 |
| `src/index.html` | Modify | Add search bar markup (centered wrapper, input, results div) and settings controls (engine select, debounce checkbox) |
| `src/settings.ts` | Modify | Wire engine select and debounce checkbox to store |
| `src/index.ts` | Modify | Import and call `initSearch()` |

---

### Task 1: Add new settings to defaults

**Files:**
- Modify: `src/defaults.ts`

- [ ] **Step 1: Add searchEngine and debounceSearch to SyncSettings**

```ts
export type SyncSettings = {
  bgColor: "red" | "green" | "blue";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
};
```

- [ ] **Step 2: Add default values**

```ts
export const syncDefaults: SyncSettings = {
  bgColor: "blue",
  searchEngine: "google",
  debounceSearch: false,
}
```

- [ ] **Step 3: Verify build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add searchEngine and debounceSearch settings"
```

---

### Task 2: Create palette UI with provider registry and shared types

**Files:**
- Create: `src/search.ts`

- [ ] **Step 1: Create search.ts with shared types, registry, and render logic**

This file owns:
- Shared types (`SearchResult`, `SearchProvider`) — exported for use by provider files
- Provider registry (`registerProvider` — exported for extensibility, internal `providers` array)
- Query orchestration (sort by order, concatenate results, debounce logic)
- DOM rendering (result list items into `#search-results`)
- Keyboard navigation (ArrowUp/Down, Enter, Escape)
- Mouse click on results
- Click-outside via `mousedown` on `document`
- `initSearch()` export that registers both providers and wires event listeners

Reference the spec sections: Provider Interface, Provider Registry, Palette UI (Keyboard Behavior, Mouse Behavior, Focus & Visibility, Active Item Styling, Result Rendering), and Debounce.

```ts
import { store } from "./store"
import { searchEngineProvider } from "./search-provider-engine"
import { shortcutsProvider } from "./search-provider-shortcuts"

export type SearchResult = {
  label: string
  description?: string
  action: () => void
  icon?: string
}

export type SearchProvider = {
  id: string
  order: number
  maxResults: number
  debounced?: boolean
  query(input: string): SearchResult[]
}

const providers: SearchProvider[] = []

export function registerProvider(provider: SearchProvider): void {
  providers.push(provider)
}

let activeIndex = 0
let currentResults: SearchResult[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function queryProviders(input: string, skipDebounced: boolean): SearchResult[] {
  const sorted = [...providers].sort((a, b) => a.order - b.order)
  const results: SearchResult[] = []
  for (const p of sorted) {
    if (skipDebounced && p.debounced) continue
    results.push(...p.query(input))
  }
  return results
}

function render(resultsEl: HTMLElement): void {
  resultsEl.innerHTML = ""
  for (let i = 0; i < currentResults.length; i++) {
    const r = currentResults[i]
    const div = document.createElement("div")
    div.className =
      "px-3 py-2 cursor-pointer text-white text-sm flex items-center gap-2" +
      (i === activeIndex ? " bg-white/20" : " hover:bg-white/10")
    div.dataset.index = String(i)

    const labelSpan = document.createElement("span")
    labelSpan.className = "truncate"
    labelSpan.textContent = r.label
    div.appendChild(labelSpan)

    if (r.description) {
      const descSpan = document.createElement("span")
      descSpan.className = "text-white/50 text-xs truncate ml-auto"
      descSpan.textContent = r.description
      div.appendChild(descSpan)
    }

    div.addEventListener("click", () => r.action())
    resultsEl.appendChild(div)
  }
}

function updateVisibility(
  input: HTMLInputElement,
  resultsEl: HTMLElement
): void {
  const show =
    document.activeElement === input && currentResults.length > 0
  resultsEl.hidden = !show
}

export function initSearch(): void {
  registerProvider(searchEngineProvider)
  registerProvider(shortcutsProvider)

  const input = document.getElementById("search-input") as HTMLInputElement
  const resultsEl = document.getElementById("search-results") as HTMLElement
  const wrapper = document.getElementById("search-wrapper") as HTMLElement

  function runQuery(): void {
    const value = input.value
    const useDebounce = store.sync.get("debounceSearch")
    const hasDebounced = providers.some((p) => p.debounced)

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    if (useDebounce && hasDebounced) {
      currentResults = queryProviders(value, true)
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)

      debounceTimer = setTimeout(() => {
        debounceTimer = null
        currentResults = queryProviders(value, false)
        activeIndex = 0
        render(resultsEl)
        updateVisibility(input, resultsEl)
      }, 400)
    } else {
      currentResults = queryProviders(value, false)
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)
    }
  }

  input.addEventListener("input", runQuery)

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (currentResults.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % currentResults.length
      render(resultsEl)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      activeIndex =
        (activeIndex - 1 + currentResults.length) % currentResults.length
      render(resultsEl)
    } else if (e.key === "Enter") {
      e.preventDefault()
      currentResults[activeIndex]?.action()
    } else if (e.key === "Escape") {
      input.value = ""
      currentResults = []
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)
    }
  })

  input.addEventListener("focus", () => {
    updateVisibility(input, resultsEl)
  })

  document.addEventListener("mousedown", (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node)) {
      resultsEl.hidden = true
    }
  })
}
```

- [ ] **Step 2: Verify build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search.ts
git commit -m "feat: add search palette UI with provider registry"
```

---

### Task 3: Create search engine provider

**Files:**
- Create: `src/search-provider-engine.ts`

- [ ] **Step 1: Create the provider file**

Reference `src/defaults.ts` for the `SyncSettings` type (to type the engine key). Reference the spec's URL Templates table for the engine URL map. Import shared types from `src/search.ts`.

```ts
import { store } from "./store"
import type { SyncSettings } from "./defaults"
import type { SearchProvider, SearchResult } from "./search"

type Engine = SyncSettings["searchEngine"]

const ENGINE_URLS: Record<Engine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  yahoo: "https://search.yahoo.com/search?p=",
  duckduckgo: "https://duckduckgo.com/?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  qwant: "https://www.qwant.com/?q=",
  startpage: "https://www.startpage.com/sp/search?query=",
}

const ENGINE_NAMES: Record<Engine, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  qwant: "Qwant",
  startpage: "Startpage",
}

export const searchEngineProvider: SearchProvider = {
  id: "search-engine",
  order: 0,
  maxResults: 1,
  query(input: string): SearchResult[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    const engine = store.sync.get("searchEngine")
    const url = ENGINE_URLS[engine]
    const name = ENGINE_NAMES[engine]
    return [{
      label: `Search ${name} for '${trimmed}'`,
      action: () => window.open(url + encodeURIComponent(trimmed), "_blank"),
    }]
  },
}
```

- [ ] **Step 2: Verify build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search-provider-engine.ts
git commit -m "feat: add search engine provider"
```

---

### Task 4: Create shortcuts provider

**Files:**
- Create: `src/search-provider-shortcuts.ts`

- [ ] **Step 1: Create the provider file**

Reference `src/shortcuts.ts` for the `Tab`, `Shortcut`, `Folder` types. Reference `src/store.ts` for `store.local.get("shortcuts")`. Import shared types from `src/search.ts`. The provider flattens all tabs into a flat list of shortcuts (top-level shortcuts + folder children), then does case-insensitive substring matching on `name` and `url`.

```ts
import { store } from "./store"
import type { Tab, Shortcut } from "./shortcuts"
import type { SearchProvider, SearchResult } from "./search"

function flattenShortcuts(tabs: Tab[]): Shortcut[] {
  const result: Shortcut[] = []
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.type === "shortcut") {
        result.push(item)
      } else {
        for (const child of item.children) {
          result.push(child)
        }
      }
    }
  }
  return result
}

export const shortcutsProvider: SearchProvider = {
  id: "shortcuts",
  order: 1,
  maxResults: 3,
  debounced: true,
  query(input: string): SearchResult[] {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed) return []
    const all = flattenShortcuts(store.local.get("shortcuts"))
    const matches: SearchResult[] = []
    for (const sc of all) {
      if (matches.length >= 3) break
      if (
        sc.name.toLowerCase().includes(trimmed) ||
        sc.url.toLowerCase().includes(trimmed)
      ) {
        const url = sc.url
        matches.push({
          label: sc.name,
          description: sc.url,
          action: () => window.open(url, "_blank"),
        })
      }
    }
    return matches
  },
}
```

- [ ] **Step 2: Verify build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search-provider-shortcuts.ts
git commit -m "feat: add shortcuts search provider"
```

---

### Task 5: Add HTML markup

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add search bar markup to the #app div**

Add the centered search wrapper inside `<div id="app">`, immediately before `<div id="dock"`. The resulting `#app` block should be:

```html
<div id="app">
  <button id="settings-open" class="fixed top-4 left-4 p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors" aria-label="Open settings">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  </button>
  <div id="search-wrapper" class="fixed inset-0 flex items-center justify-center pointer-events-none">
    <div class="w-full max-w-lg pointer-events-auto">
      <input id="search-input" type="text" placeholder="Search..."
        class="w-full px-4 py-3 rounded-xl bg-black/30 text-white placeholder-white/50 outline-none text-lg">
      <div id="search-results" class="mt-1 rounded-xl bg-black/30 overflow-hidden" hidden></div>
    </div>
  </div>
  <div id="dock" class="fixed bottom-0 left-0 right-0 flex items-center gap-2 p-2 bg-black/30" hidden>
    <div id="dock-tabs" class="flex gap-1 border-r border-white/20 pr-2 mr-2"></div>
    <div id="dock-items" class="flex gap-2 overflow-x-auto"></div>
  </div>
</div>
```

- [ ] **Step 2: Add settings controls markup**

In the settings dialog, add a new fieldset after the Shortcuts fieldset (after the closing `</fieldset>` for Shortcuts, before the close button):

```html
<fieldset class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Search</legend>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <label for="settings-search-engine" class="text-sm">Search Engine</label>
      <select id="settings-search-engine" class="text-sm rounded px-2 py-1 border border-gray-300">
        <option value="google">Google</option>
        <option value="bing">Bing</option>
        <option value="yahoo">Yahoo</option>
        <option value="duckduckgo">DuckDuckGo</option>
        <option value="ecosia">Ecosia</option>
        <option value="qwant">Qwant</option>
        <option value="startpage">Startpage</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-debounce-search" class="rounded">
      <label for="settings-debounce-search" class="text-sm">Debounce shortcut search</label>
    </div>
  </div>
</fieldset>
```

- [ ] **Step 3: Verify build**

Run: `./build.sh`
Expected: Clean build, `dist/index.html` contains the new markup.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat: add search bar and settings markup"
```

---

### Task 6: Wire settings controls

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add search engine select and debounce checkbox wiring**

At the end of `initSettings()`, after the existing color button subscriber, add:

```ts
const engineSelect = document.getElementById(
  "settings-search-engine"
) as HTMLSelectElement
const debounceCheckbox = document.getElementById(
  "settings-debounce-search"
) as HTMLInputElement

engineSelect.value = store.sync.get("searchEngine")
engineSelect.addEventListener("change", () => {
  store.sync.set(
    "searchEngine",
    engineSelect.value as SyncSettings["searchEngine"]
  )
})
store.sync.subscribe("searchEngine", (val) => {
  engineSelect.value = val
})

debounceCheckbox.checked = store.sync.get("debounceSearch")
debounceCheckbox.addEventListener("change", () => {
  store.sync.set("debounceSearch", debounceCheckbox.checked)
})
store.sync.subscribe("debounceSearch", (val) => {
  debounceCheckbox.checked = val
})
```

- [ ] **Step 2: Verify build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: wire search engine and debounce settings controls"
```

---

### Task 7: Wire initSearch into entrypoint

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import and call initSearch**

Add the import at the top of `src/index.ts`:

```ts
import { initSearch } from "./search"
```

Add `initSearch()` call after the existing init calls inside the `DOMContentLoaded` handler:

```ts
document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
})
```

- [ ] **Step 2: Full build and manual test**

Run: `./build.sh`
Expected: Clean build. Load the extension in a browser. Verify:
1. Search bar appears centered on the page
2. Typing shows the search engine result as first item
3. Arrow keys navigate results, Enter opens in new tab
4. Escape clears input and hides dropdown
5. Clicking a result opens it in new tab
6. Clicking outside hides dropdown
7. Changing search engine in settings changes the provider
8. Toggling debounce introduces a 400ms delay on shortcut results
9. Adding shortcuts and searching matches by name and URL

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire search palette into entrypoint"
```
