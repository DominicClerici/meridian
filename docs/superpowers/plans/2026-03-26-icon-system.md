# Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a theme-reactive icon system where `icon("name")` returns a self-managing DOM element that swaps its SVG when the theme changes.

**Architecture:** A central registry (`src/icons/registry.ts`) exports an `icon()` factory that reads the active theme from the store, injects the matching SVG into a `<span>`, and subscribes to theme changes for automatic swaps. Each theme's icons live in a separate module (`src/icons/modern.ts`). A `getIconSvg()` helper is also exported for innerHTML-based patterns in components.

**Tech Stack:** Vanilla TypeScript, reactive store subscriptions, MutationObserver for cleanup.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/icons/registry.ts` | Create | Types, `icon()` factory, `getIconSvg()` helper, MutationObserver cleanup |
| `src/icons/modern.ts` | Create | Modern theme icon map (~28 SVG strings) |
| `src/components.ts` | Modify | `createButton` accepts `HTMLElement` icons, `createSelect` arrow uses `icon()`, `createAccordion` chevron uses `icon()` |
| `src/settings.ts` | Modify | Replace all inline SVG strings with `icon()` calls |
| `src/index.html` | Modify | Remove inline SVGs from settings button and todo button |
| `src/index.ts` | Modify | Populate icon containers on init |
| `src/todo.ts` | Modify | Replace inline SVGs with `icon()` calls |
| `src/spotify.ts` | Modify | Replace inline SVGs with `icon()` / `getIconSvg()` calls |
| `src/calendar.ts` | Modify | Replace inline SVGs with `icon()` calls |
| `src/weather.ts` | Modify | Replace inline SVGs with `icon()` calls |

---

### Task 1: Create icon registry

**Files:**
- Create: `src/icons/registry.ts`

- [ ] **Step 1: Create `src/icons/registry.ts`**

```ts
import { store } from "../store"
import type { SyncSettings } from "../defaults"

export type IconOptions = {
  size?: number
  class?: string
}

export type AnimatedIconFactory = (
  span: HTMLSpanElement,
  opts?: IconOptions
) => void

export type IconThemeMap = Record<string, string | AnimatedIconFactory>

type ThemeName = SyncSettings["theme"]

const themes: Record<ThemeName, IconThemeMap> = {} as any

export function registerTheme(name: ThemeName, map: IconThemeMap): void {
  themes[name] = map
}

const cleanupMap = new WeakMap<HTMLElement, () => void>()
let observer: MutationObserver | null = null

function ensureObserver(): void {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.removedNodes) {
        if (node instanceof HTMLElement) unsubRemoved(node)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function unsubRemoved(el: HTMLElement): void {
  const unsub = cleanupMap.get(el)
  if (unsub) {
    unsub()
    cleanupMap.delete(el)
  }
  for (const child of el.querySelectorAll("[data-icon]")) {
    const u = cleanupMap.get(child as HTMLElement)
    if (u) {
      u()
      cleanupMap.delete(child as HTMLElement)
    }
  }
}

function applySize(span: HTMLSpanElement, size: number): void {
  const svg = span.querySelector("svg")
  if (svg) {
    svg.setAttribute("width", String(size))
    svg.setAttribute("height", String(size))
  }
}

export function icon(name: string, opts?: IconOptions): HTMLSpanElement {
  ensureObserver()

  const span = document.createElement("span")
  span.setAttribute("data-icon", name)
  span.className = `inline-flex items-center justify-center shrink-0${opts?.class ? ` ${opts.class}` : ""}`

  function render(themeName: string): void {
    const entry = themes[themeName as ThemeName]?.[name]
    if (!entry) return
    span.innerHTML = ""
    if (typeof entry === "function") {
      entry(span, opts)
    } else {
      span.innerHTML = entry
    }
    if (opts?.size) applySize(span, opts.size)
  }

  render(store.sync.get("theme"))

  const unsub = store.sync.subscribe("theme", render)
  cleanupMap.set(span, unsub)

  return span
}

export function getIconSvg(name: string): string {
  const theme = store.sync.get("theme")
  const entry = themes[theme]?.[name]
  if (typeof entry === "string") return entry
  return ""
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors (the file compiles standalone)

- [ ] **Step 3: Commit**

```bash
git add src/icons/registry.ts
git commit -m "feat: add icon registry with theme-reactive factory"
```

---

### Task 2: Create modern theme icon map

**Files:**
- Create: `src/icons/modern.ts`

- [ ] **Step 1: Create `src/icons/modern.ts` with all icon SVGs**

Extract every inline SVG from the codebase and consolidate them here. Each SVG keeps its original attributes (fill, stroke, stroke-width, etc.) and gets a standardized `viewBox="0 0 24 24"` plus a default width/height for its most common usage.

```ts
import { registerTheme } from "./registry"

const icons = {
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,

  close: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,

  tabGeneral: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3"/><circle cx="4" cy="14" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="20" cy="16" r="2"/></svg>`,

  tabShortcuts: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`,

  tabAppearance: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,

  tabWidgets: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,

  tabAdvanced: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,

  modeLight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,

  modeDark: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,

  modeAuto: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,

  check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,

  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,

  swatchCheck: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,

  todoList: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 18H3"/><path d="M11 12H3"/><path d="M11 6H3"/><path d="m15 9 3 3-3 3"/></svg>`,

  todoEmpty: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>`,

  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,

  edit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,

  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,

  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,

  dragHandle: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="19" r="2"/><circle cx="15" cy="19" r="2"/></svg>`,

  play: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,

  pause: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>`,

  skipBack: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>`,

  skipForward: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`,

  spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,

  calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,

  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,

  locationOff: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
}

registerTheme("modern", icons)
```

- [ ] **Step 2: Import modern theme in `src/index.ts`**

Add at the top of `src/index.ts`, before any icon usage:

```ts
import "./icons/modern"
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile and build. No runtime changes yet — icons aren't consumed.

- [ ] **Step 4: Commit**

```bash
git add src/icons/modern.ts src/index.ts
git commit -m "feat: add modern theme icon map with all SVG assets"
```

---

### Task 3: Migrate components.ts

**Files:**
- Modify: `src/components.ts`

This task updates `createButton` to accept `HTMLElement` icons, replaces the `CHECK_SVG`/`CHEVRON_SVG` constants with `getIconSvg()`, and replaces the accordion's unicode chevron with `icon()`.

- [ ] **Step 1: Update `createButton` to accept HTMLElement icons**

Change the `icon` option type and the icon rendering logic:

```ts
// Change the opts type at line 15
opts?: { icon?: string | HTMLElement; onClick?: () => void; className?: string }
```

Replace the icon rendering block (lines 20-25):

```ts
  if (opts?.icon) {
    if (opts.icon instanceof HTMLElement) {
      opts.icon.classList.add("shrink-0")
      btn.appendChild(opts.icon)
    } else {
      const iconSpan = document.createElement("span")
      iconSpan.className = "shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"
      iconSpan.innerHTML = opts.icon
      btn.appendChild(iconSpan)
    }
  }
```

- [ ] **Step 2: Replace CHECK_SVG and CHEVRON_SVG with getIconSvg**

Add import at the top of `components.ts`:

```ts
import { icon, getIconSvg } from "./icons/registry"
```

Remove the two constants (lines 71-73):

```ts
// DELETE these lines:
// const CHECK_SVG = `<svg ...>`
// const CHEVRON_SVG = `<svg ...>`
```

Replace all `CHECK_SVG` references with `getIconSvg("check")` (3 occurrences — in `buildItems`, `selectOption`, and the `value` setter):

```ts
check.innerHTML = isSelected ? getIconSvg("check") : ""
```

Replace the `CHEVRON_SVG` usage in `createSelect` (line 104) with an `icon()` element:

```ts
  const arrow = document.createElement("span")
  arrow.className = "select__arrow shrink-0 text-muted"
  arrow.appendChild(icon("chevronDown"))
```

- [ ] **Step 3: Replace accordion unicode chevron with icon()**

In `createAccordion` (around line 450-454), replace the unicode chevron:

```ts
  // Replace:
  // const chevron = document.createElement("span")
  // chevron.textContent = "\u25BC"
  // chevron.className = isSettings
  //   ? "text-[11px] transition-transform opacity-40"
  //   : "text-[10px] transition-transform opacity-50"

  // With:
  const chevron = icon("chevronDown", { size: isSettings ? 11 : 10 })
  chevron.classList.add("transition-transform")
  chevron.style.opacity = isSettings ? "0.4" : "0.5"
```

The rotation transforms (`chevron.style.transform = "rotate(-90deg)"` and `chevron.style.transform = ""`) continue to work as-is on the icon span.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Visually verify in browser that selects, buttons, and accordions render correctly.

- [ ] **Step 5: Commit**

```bash
git add src/components.ts
git commit -m "refactor: migrate component icons to icon registry"
```

---

### Task 4: Migrate settings.ts

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add icon import**

At the top of `src/settings.ts`, add:

```ts
import { icon, getIconSvg } from "./icons/registry"
```

- [ ] **Step 2: Replace TABS icon strings with icon() calls**

Replace the `TABS` array (lines 7-33). Each `icon` property changes from an SVG string to a function that returns an icon element, called at tab build time. The simplest approach: change the `icon` field to store the icon name as a string, then call `icon()` when building the tab.

```ts
const TABS = [
  { id: "general", label: "General", iconName: "tabGeneral" },
  { id: "shortcuts", label: "Shortcuts", iconName: "tabShortcuts" },
  { id: "appearance", label: "Appearance", iconName: "tabAppearance" },
  { id: "widgets", label: "Widgets", iconName: "tabWidgets" },
  { id: "advanced", label: "Advanced", iconName: "tabAdvanced" },
]
```

Then update `buildNav()` (around line 522) which sets `btn.innerHTML = tab.icon`. Replace with:

```ts
    btn.appendChild(icon(tab.iconName, { size: 18 }))
```

The SVGs use `[&>svg]` sizing from the parent button's flex layout, so the icon element integrates naturally.

- [ ] **Step 3: Replace MODE_ICONS with icon() calls**

Remove the `MODE_ICONS` constant (lines 186-190).

In `buildModeSelector()` (line 199-210), replace the `createButton` call that passes `MODE_ICONS[mode]`:

```ts
  for (const mode of modes) {
    const modeIconName = mode === "light" ? "modeLight" : mode === "dark" ? "modeDark" : "modeAuto"
    const btn = createButton(mode.charAt(0).toUpperCase() + mode.slice(1), "override", {
      icon: icon(modeIconName),
    })
    // ... rest unchanged
  }
```

- [ ] **Step 4: Replace SWATCH_CHECK with getIconSvg**

Remove the `SWATCH_CHECK` constant (line 125).

In `buildSwatchGroup()`, replace `SWATCH_CHECK` with `getIconSvg("swatchCheck")` (line 166):

```ts
btn.innerHTML = getIconSvg("swatchCheck")
```

- [ ] **Step 5: Replace close button and advanced placeholder SVGs**

Find the close button SVG (around line 733) and replace:

```ts
// Replace: closeBtn.innerHTML = `<svg ...>...</svg>`
// With:
closeBtn.appendChild(icon("close"))
```

Find the advanced tab placeholder (around line 698) and replace:

```ts
// Replace the innerHTML that includes the wrench SVG
// With:
const wrenchIcon = icon("tabAdvanced", { size: 32, class: "text-muted/30" })
center.appendChild(wrenchIcon)
const msg = document.createElement("p")
msg.className = "text-sm text-muted/40"
msg.textContent = "No advanced settings yet"
center.appendChild(msg)
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Settings dialog opens with all icons visible.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts
git commit -m "refactor: migrate settings icons to icon registry"
```

---

### Task 5: Migrate index.html and index.ts

**Files:**
- Modify: `src/index.html`
- Modify: `src/index.ts`

- [ ] **Step 1: Remove inline SVGs from index.html**

In `src/index.html`, remove the settings gear SVG (lines 22-37) from inside the `#settings-open` button, leaving the button empty:

```html
      <button
        id="settings-open"
        class="fixed top-4 left-4 p-2 rounded-lg bg-page-foreground/20 hover:bg-page-foreground/30 transition-colors"
        aria-label="Open settings"
      >
      </button>
```

Remove the todo trigger SVG (lines 56-71) from inside `#todo-trigger`, keeping the badge spans:

```html
        <button
          id="todo-trigger"
          class="relative flex items-center gap-1 p-2 rounded-lg bg-page-foreground/20 hover:bg-page-foreground/30 transition-colors text-page-foreground"
          aria-label="Todos"
          hidden
        >
          <span
            id="todo-badge-count"
            class="absolute -top-1 -right-1 text-[10px] bg-page-foreground/90 text-page-overlay rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-semibold"
            hidden
          ></span>
          <span
            id="todo-badge-overdue"
            class="absolute -top-1 -left-1 text-[10px] bg-danger text-danger-foreground rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-semibold"
            hidden
          ></span>
        </button>
```

- [ ] **Step 2: Populate icons from index.ts**

In `src/index.ts`, add an import for the icon factory:

```ts
import { icon } from "./icons/registry"
```

After `applyTheme()` and `subscribeTheme()` (line 16), add synchronous icon population:

```ts
applyTheme()
subscribeTheme()

document.getElementById("settings-open")!.prepend(icon("settings"))
document.getElementById("todo-trigger")!.prepend(icon("todoList"))
```

Using `prepend` ensures the icon goes before the badge spans in the todo trigger.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Settings gear and todo icons render on the page.

- [ ] **Step 4: Commit**

```bash
git add src/index.html src/index.ts
git commit -m "refactor: migrate index.html icons to icon registry"
```

---

### Task 6: Migrate todo.ts

**Files:**
- Modify: `src/todo.ts`

- [ ] **Step 1: Add icon import and replace all inline SVGs**

Add at the top of `src/todo.ts`:

```ts
import { icon } from "./icons/registry"
```

Find each inline SVG and replace. There are 6 locations:

1. **External link icon** (around line 210) — in a `createButton` call:
```ts
// Replace: icon: `<svg ...externalLink...</svg>`
// With:
icon: icon("externalLink")
```

2. **Edit icon** (around line 219) — in a `createButton` call:
```ts
// Replace: icon: `<svg ...edit...</svg>`
// With:
icon: icon("edit")
```

3. **Trash icon** (around line 237) — in a `createButton` call:
```ts
// Replace: icon: `<svg ...trash...</svg>`
// With:
icon: icon("trash")
```

4. **Drag handle** (around line 267):
```ts
// Replace: handle.innerHTML = `<svg ...dragHandle...</svg>`
// With:
handle.appendChild(icon("dragHandle"))
```

5. **Plus icon** (around line 342) — in a `createButton` call:
```ts
// Replace: icon: `<svg ...plus...</svg>`
// With:
icon: icon("plus")
```

6. **Empty state icon** (around line 372):
```ts
// Replace: emptyIcon.innerHTML = `<svg ...todoEmpty...</svg>`
// With:
emptyIcon.appendChild(icon("todoEmpty"))
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Todo widget icons render correctly.

- [ ] **Step 3: Commit**

```bash
git add src/todo.ts
git commit -m "refactor: migrate todo icons to icon registry"
```

---

### Task 7: Migrate spotify.ts

**Files:**
- Modify: `src/spotify.ts`

Spotify's `getPlaybackIcon` function dynamically returns different SVG strings based on state. This is best handled with `getIconSvg()` since the icons are set via innerHTML and change frequently.

- [ ] **Step 1: Add import and replace SVG constants and inline SVGs**

Add at the top of `src/spotify.ts`:

```ts
import { getIconSvg } from "./icons/registry"
```

Remove the `SPINNER_SVG` constant (around line 315).

Replace the `getPlaybackIcon` function (around line 322-333). The function returns different SVG strings based on action and state:

```ts
function getPlaybackIcon(action: string): string {
  if (loadingAction === action) return getIconSvg("spinner")
  switch (action) {
    case "prev":
      return getIconSvg("skipBack")
    case "next":
      return getIconSvg("skipForward")
    case "toggle":
      return isPlaying ? getIconSvg("pause") : getIconSvg("play")
    default:
      return ""
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Spotify controls render correctly.

- [ ] **Step 3: Commit**

```bash
git add src/spotify.ts
git commit -m "refactor: migrate spotify icons to icon registry"
```

---

### Task 8: Migrate calendar.ts and weather.ts

**Files:**
- Modify: `src/calendar.ts`
- Modify: `src/weather.ts`

- [ ] **Step 1: Migrate calendar.ts**

Add import at the top of `src/calendar.ts`:

```ts
import { icon, getIconSvg } from "./icons/registry"
```

Remove the `CALENDAR_ICON` constant (around line 222).

The `renderTrigger()` function (around line 224) uses `CALENDAR_ICON` in innerHTML concatenation. Replace the three trigger content patterns:

**Loading state** (around line 242):
```ts
// Replace: trigger.innerHTML = `${CALENDAR_ICON} <span class="text-xs">Loading...</span>`
// With:
trigger.innerHTML = ""
trigger.appendChild(icon("calendar"))
const loadLabel = document.createElement("span")
loadLabel.className = "text-xs"
loadLabel.textContent = "Loading..."
trigger.appendChild(loadLabel)
```

**Error state / refresh** (around line 247):
```ts
// Replace: trigger.innerHTML = `<svg ...refresh...</svg>`
// With:
trigger.innerHTML = ""
trigger.appendChild(icon("refresh"))
```

**Events state** (around line 253):
```ts
// Replace: trigger.innerHTML = `${CALENDAR_ICON} <span class="text-sm">${label}</span>`
// With:
trigger.innerHTML = ""
trigger.appendChild(icon("calendar"))
const evtLabel = document.createElement("span")
evtLabel.className = "text-sm"
evtLabel.textContent = label
trigger.appendChild(evtLabel)
```

- [ ] **Step 2: Migrate weather.ts**

Add import at the top of `src/weather.ts`:

```ts
import { icon } from "./icons/registry"
```

Find the location-off icon (around line 177) where `trigger.innerHTML` is set:

```ts
// Replace: trigger.innerHTML = `<svg ...locationOff...</svg> <span class="text-xs">Enable location</span>`
// With:
trigger.innerHTML = ""
trigger.appendChild(icon("locationOff"))
const locLabel = document.createElement("span")
locLabel.className = "text-xs"
locLabel.textContent = "Enable location"
trigger.appendChild(locLabel)
```

Find the refresh icon (around line 187):

```ts
// Replace: trigger.innerHTML = `<svg ...refresh...</svg>`
// With:
trigger.innerHTML = ""
trigger.appendChild(icon("refresh"))
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile. Calendar and weather widgets render correctly.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts src/weather.ts
git commit -m "refactor: migrate calendar and weather icons to icon registry"
```

---

### Task 9: Final cleanup and build verification

**Files:**
- Delete: `src/icons/feather/` (unused directory with 287 SVG files)
- Delete: `src/icons/custom/` (empty directory)

- [ ] **Step 1: Remove unused icon directories**

```bash
rm -rf src/icons/feather src/icons/custom
```

- [ ] **Step 2: Full build and verify**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Clean compile and build.

- [ ] **Step 3: Manual verification checklist**

Load the extension in the browser and verify:
- Settings gear icon renders on the page
- Todo trigger icon renders
- Settings dialog opens — all tab icons visible
- Mode selector icons (sun, moon, monitor) render
- Accent/background color swatches show check on selected
- Close button X icon renders
- Advanced tab shows wrench placeholder
- Todo widget — plus, edit, trash, external link, drag handle, empty state icons
- Spotify controls — play, pause, skip icons
- Calendar and weather trigger icons

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove unused feather and custom icon directories"
```
