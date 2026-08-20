# Search Bar Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the search bar with design system integration, grouped/iconic results, a new-tab setting, and a debounce explainer.

**Architecture:** Extend the existing provider-based search system. Each provider returns an icon element and a group tag. The render function groups results, inserts a divider, and renders icons. A new `searchOpenInNewTab` setting controls navigation for all search results.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4, design system tokens from `src/styles.css`

---

### Task 1: Add `searchOpenInNewTab` setting to defaults

**Files:**
- Modify: `src/defaults.ts:25-51` (SyncSettings type)
- Modify: `src/defaults.ts:67-93` (syncDefaults)

- [ ] **Step 1: Add type and default**

In `src/defaults.ts`, add `searchOpenInNewTab` to the `SyncSettings` type and the `syncDefaults` object:

```ts
// In SyncSettings type, after debounceSearch:
searchOpenInNewTab: boolean;
```

```ts
// In syncDefaults, after debounceSearch:
searchOpenInNewTab: false,
```

- [ ] **Step 2: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add searchOpenInNewTab setting"
```

---

### Task 2: Add settings UI for new-tab toggle and debounce explainer

**Files:**
- Modify: `src/settings.ts:802-840` (buildWidgetsTab Search accordion)

- [ ] **Step 1: Add the "Open results in new tab" checkbox**

In `buildWidgetsTab()`, after the debounce checkbox block (after line 838), add:

```ts
const openNewTab = createCheckbox(
  "",
  store.sync.get("searchOpenInNewTab"),
  (v) => store.sync.set("searchOpenInNewTab", v)
)
searchAcc.content.appendChild(
  settingsRow("Open results in new tab", openNewTab)
)
store.sync.subscribe("searchOpenInNewTab", (v) => {
  ;(openNewTab as any).setChecked(v)
})
```

- [ ] **Step 2: Add debounce explainer text**

After the debounce `settingsRow` call (line 835) but before the store subscription for debounceSearch (line 836), insert a small explainer element:

```ts
const debounceHint = document.createElement("span")
debounceHint.className = "text-muted text-xs -mt-2 mb-1 block px-1"
debounceHint.textContent = "Enable this if the search lags when you type"
searchAcc.content.appendChild(debounceHint)
```

The final order of elements in the Search accordion should be:
1. Search Engine select row
2. Debounce shortcut search checkbox row
3. Debounce explainer text (small, muted)
4. Open results in new tab checkbox row

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add new-tab toggle and debounce explainer to search settings"
```

---

### Task 3: Update SearchResult type and engine provider with icons

**Files:**
- Modify: `src/search.ts:5-10` (SearchResult type)
- Modify: `src/search-provider-engine.ts` (add SVG logos, icon element, respect new-tab setting)

- [ ] **Step 1: Update SearchResult type**

In `src/search.ts`, update the `SearchResult` type:

```ts
export type SearchResult = {
  label: string
  description?: string
  action: () => void
  icon?: HTMLElement
  group?: string
}
```

Change `icon` from `string | undefined` to `HTMLElement | undefined` and add `group?: string`.

- [ ] **Step 2: Add engine SVG logos to search-provider-engine.ts**

Add a `ENGINE_SVGS` record at the top of `src/search-provider-engine.ts` mapping each engine to its brand SVG. Each SVG should be 16x16. Here are the 7 engine SVGs:

```ts
const ENGINE_SVGS: Record<Engine, string> = {
  google: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
  bing: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#008373" d="M5 3v16.5l4.5 2.5 7-4.5 1-2.5-5-2.5V3z"/><path fill="#00A68E" d="M9.5 8v11l7-4.5-5-2.5z"/><path fill="#00C9A7" d="M5 3l4.5 5v6L5 19.5z"/></svg>`,
  yahoo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#6001D2" d="M14.54 3H21l-5.41 8.82L21 21h-4.67l-3.87-5.7L8.57 21H2l6.48-9.18L2 3h6.49l3 4.76z"/></svg>`,
  duckduckgo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#DE5833" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle fill="#DE5833" cx="9" cy="10" r="1.5"/><circle fill="#DE5833" cx="15" cy="10" r="1.5"/><path fill="#DE5833" d="M12 16c-2.21 0-4-1.34-4-3h8c0 1.66-1.79 3-4 3z"/></svg>`,
  ecosia: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#36ACBF" cx="12" cy="12" r="10"/><path fill="#fff" d="M12 6a6 6 0 0 0-6 6c0 2.5 1.5 4.6 3.6 5.5L12 12l2.4 5.5A6 6 0 0 0 12 6z"/></svg>`,
  qwant: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#5C2D91" cx="12" cy="12" r="10"/><path fill="#fff" d="M15.5 16.5l-2-3.5h-3l-2 3.5M8.5 13h7M12 7.5V13"/></svg>`,
  startpage: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#6573FF" cx="12" cy="12" r="10"/><path fill="#fff" d="M10 8l6 4-6 4z"/></svg>`,
}
```

- [ ] **Step 3: Update engine provider to return icon and group, and respect new-tab setting**

Replace the `query` method in `searchEngineProvider`:

```ts
import { store } from "./store"
import type { SyncSettings } from "./defaults"
import type { SearchProvider, SearchResult } from "./search"

// ... ENGINE_URLS, ENGINE_NAMES, ENGINE_SVGS records ...

function engineIcon(engine: Engine): HTMLElement {
  const span = document.createElement("span")
  span.className = "shrink-0 flex items-center justify-center w-4 h-4"
  span.innerHTML = ENGINE_SVGS[engine]
  return span
}

export const searchEngineProvider: SearchProvider = {
  id: "search-engine",
  order: 0,
  maxResults: 1,
  query(input: string): SearchResult[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    const engine = store.sync.get("searchEngine")
    const url = ENGINE_URLS[engine] + encodeURIComponent(trimmed)
    const name = ENGINE_NAMES[engine]
    const newTab = store.sync.get("searchOpenInNewTab")
    return [{
      label: `Search ${name} for '${trimmed}'`,
      icon: engineIcon(engine),
      group: "search-engine",
      action: () => {
        if (newTab) window.open(url, "_blank")
        else location.href = url
      },
    }]
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add src/search.ts src/search-provider-engine.ts
git commit -m "feat: add engine SVG icons and new-tab support to search engine provider"
```

---

### Task 4: Update shortcuts provider with icons and new-tab support

**Files:**
- Modify: `src/search-provider-shortcuts.ts` (add icon rendering, group tag, respect new-tab setting)

- [ ] **Step 1: Add SWATCH_HEX and icon helpers**

At the top of `src/search-provider-shortcuts.ts`, add the swatch hex map (same as dock.ts uses) and a helper to create shortcut icon elements:

```ts
import { store } from "./store"
import { icon as makeIcon } from "./icons/registry"
import type { Tab, Shortcut } from "./shortcuts"
import type { SearchProvider, SearchResult } from "./search"

const SWATCH_HEX: Record<string, string> = {
  rose: "#f43f5e",
  coral: "#f97316",
  amber: "#f59e0b",
  teal: "#14b8a6",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  slate: "#64748b",
  stone: "#78716c",
  zinc: "#71717a",
  graphite: "#57534e",
}

function faviconUrl(url: string): string {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch {
    return ""
  }
}

function shortcutIcon(sc: Shortcut): HTMLElement {
  const ic = sc.icon
  if (ic?.type === "color") {
    const el = document.createElement("span")
    el.className = "shrink-0 w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
    el.style.background = SWATCH_HEX[ic.color] ?? ic.color
    el.textContent = sc.name.charAt(0)
    return el
  }
  const wrap = document.createElement("span")
  wrap.className = "shrink-0 flex items-center justify-center w-4 h-4"
  const img = document.createElement("img")
  img.className = "w-4 h-4 rounded-sm"
  img.src = faviconUrl(sc.url)
  img.alt = ""
  img.loading = "lazy"
  img.addEventListener("error", () => {
    const fallback = makeIcon("link", { size: 14 })
    fallback.classList.add("text-muted")
    wrap.replaceChildren(fallback)
  })
  wrap.appendChild(img)
  return wrap
}
```

- [ ] **Step 2: Update the query method to return icons, group, and respect new-tab**

Replace the `query` method in `shortcutsProvider`:

```ts
export const shortcutsProvider: SearchProvider = {
  id: "shortcuts",
  order: 1,
  maxResults: 3,
  debounced: true,
  query(input: string): SearchResult[] {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed) return []
    const all = flattenShortcuts(store.local.get("shortcuts"))
    const newTab = store.sync.get("searchOpenInNewTab")
    const matches: SearchResult[] = []
    for (const sc of all) {
      if (matches.length >= this.maxResults) break
      if (
        sc.name.toLowerCase().includes(trimmed) ||
        sc.url.toLowerCase().includes(trimmed)
      ) {
        const url = sc.url
        matches.push({
          label: sc.name,
          description: sc.url,
          icon: shortcutIcon(sc),
          group: "shortcuts",
          action: () => {
            if (newTab) window.open(url, "_blank")
            else location.href = url
          },
        })
      }
    }
    return matches
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add src/search-provider-shortcuts.ts
git commit -m "feat: add shortcut icons and new-tab support to shortcuts provider"
```

---

### Task 5: Refactor search results render with design system and grouped layout

**Files:**
- Modify: `src/search.ts:40-65` (render function)
- Modify: `src/index.html:67-71` (search-results container classes)

- [ ] **Step 1: Update search-results container in index.html**

Change the `#search-results` div classes from:

```html
class="mt-1 rounded-xl bg-page-overlay/30 overflow-hidden"
```

to:

```html
class="mt-1 rounded-theme bg-panel/90 backdrop-blur-md border border-input-border/20 overflow-hidden"
```

This applies the design system tokens: `rounded-theme` for theme-aware border radius, `bg-panel/90` for the panel background with slight transparency, `backdrop-blur-md` for frosted glass, and `border-input-border/20` for a subtle border.

- [ ] **Step 2: Rewrite the render function**

Replace the `render` function in `src/search.ts` with a version that groups results by `group` field, renders icons, and inserts a divider between groups:

```ts
function render(resultsEl: HTMLElement): void {
  resultsEl.innerHTML = ""

  const groups: { key: string; items: { result: SearchResult; index: number }[] }[] = []
  let currentGroup: (typeof groups)[number] | null = null

  for (let i = 0; i < currentResults.length; i++) {
    const r = currentResults[i]
    const key = r.group ?? ""
    if (!currentGroup || currentGroup.key !== key) {
      currentGroup = { key, items: [] }
      groups.push(currentGroup)
    }
    currentGroup.items.push({ result: r, index: i })
  }

  for (let g = 0; g < groups.length; g++) {
    if (g > 0) {
      const hr = document.createElement("hr")
      hr.className = "border-input-border/20 mx-2"
      resultsEl.appendChild(hr)
    }

    for (const { result: r, index: i } of groups[g].items) {
      const div = document.createElement("div")
      div.className =
        "px-3 py-2 cursor-pointer text-foreground text-sm flex items-center gap-2" +
        (i === activeIndex ? " bg-surface" : " hover:bg-surface/50")
      div.dataset.index = String(i)

      if (r.icon) {
        div.appendChild(r.icon)
      }

      const labelSpan = document.createElement("span")
      labelSpan.className = "truncate"
      labelSpan.textContent = r.label
      div.appendChild(labelSpan)

      if (r.description) {
        const descSpan = document.createElement("span")
        descSpan.className = "text-muted text-xs truncate ml-auto"
        descSpan.textContent = r.description
        div.appendChild(descSpan)
      }

      div.addEventListener("click", () => r.action())
      resultsEl.appendChild(div)
    }
  }
}
```

Key changes from the old render:
- Groups results by `group` field, inserts `<hr>` between groups
- Renders `r.icon` (HTMLElement) before the label
- Uses design system classes: `text-foreground` instead of `text-page-foreground`, `bg-surface` instead of `bg-page-foreground/20`, `text-muted` instead of `text-page-foreground/50`

- [ ] **Step 3: Commit**

```bash
git add src/search.ts src/index.html
git commit -m "feat: refactor search results with design system tokens and grouped layout"
```

---

### Task 6: Build, verify, and final commit

**Files:**
- All modified files

- [ ] **Step 1: Run the build**

```bash
./build.sh
```

Expected: Clean build with no errors in `dist/`.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Manual verification checklist**

Open the extension in Chrome and verify:
1. Search bar dropdown uses panel background with rounded corners and subtle border
2. Typing a query shows the engine result with the engine's SVG logo icon
3. Shortcut matches appear below a thin divider line
4. Each shortcut result shows its favicon, color swatch, or fallback link icon
5. The "Open results in new tab" checkbox appears in Settings > Widgets > Search
6. With the checkbox unchecked (default), clicking a result navigates in the same tab
7. With the checkbox checked, clicking a result opens a new tab
8. The debounce explainer text "Enable this if the search lags when you type" appears below the debounce checkbox in small muted text
9. Keyboard navigation (Arrow Up/Down, Enter, Escape) still works correctly
10. The `<hr>` divider is not selectable via keyboard — arrows skip it

- [ ] **Step 4: Fix any issues found during verification**

If keyboard navigation selects the `<hr>`, the arrow key logic in `initSearch` needs no change because it operates on `currentResults` array indices, not DOM children. The `<hr>` is never in `currentResults`, so it's naturally skipped. Verify this is the case.
