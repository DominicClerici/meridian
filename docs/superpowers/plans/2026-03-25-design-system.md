# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a configurable design system with theme/accent/bg/mode controls, starting with a "Modern" theme applied to the todo widget.

**Architecture:** Four `data-*` attributes on `<html>` drive CSS custom properties via compound selectors. Component helper functions consume these variables via Tailwind classes. Settings stored as short strings in sync storage.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4, HTML, browser.storage API. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-03-25-design-system-design.md`

**Verification commands:**
- Type-check: `npx tsc --noEmit`
- Build: `./build.sh`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/defaults.ts` | Modify | Add `theme`, `accentColor`, `mode` types + defaults |
| `src/styles.css` | Modify | Migrate CSS vars to `[data-theme][data-mode]` selectors, add structural tokens, accent/bg combos |
| `src/theme.ts` | Create | Theme boot logic: apply data attributes, mode resolution, media query listener |
| `src/components.ts` | Create | `createButton`, `createPopover`, `createAccordion`, `createCheckbox`, `createInput` |
| `src/index.ts` | Modify | Replace `applyBgColor` with theme boot, import `applyTheme` |
| `src/settings.ts` | Modify | Remove `applyBgColor`/`BG_CLASSES`, add theme/accent/mode controls, rewire bgColor |
| `src/index.html` | Modify | Add settings controls, rename bgColor button attrs, remove `#todo-prompt-dialog` |
| `src/todo.ts` | Modify | Refactor to use component helpers, replace dialog with nested popover |

---

### Task 1: Add new settings to defaults.ts

**Files:**
- Modify: `src/defaults.ts`

- [ ] **Step 1: Add types to SyncSettings**

Add `theme`, `accentColor`, and `mode` to the `SyncSettings` type:

```ts
export type SyncSettings = {
  theme: "modern";
  accentColor: "red" | "green" | "blue";
  bgColor: "red" | "green" | "blue";
  mode: "light" | "dark" | "auto";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  // ... rest unchanged
};
```

- [ ] **Step 2: Add defaults to syncDefaults**

```ts
export const syncDefaults: SyncSettings = {
  theme: "modern",
  accentColor: "blue",
  bgColor: "blue",
  mode: "auto",
  searchEngine: "google",
  // ... rest unchanged
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add theme, accentColor, mode settings to SyncSettings"
```

---

### Task 2: Migrate CSS to data-attribute selectors

**Files:**
- Modify: `src/styles.css`

This is the largest single change. The existing `:root` and `@media (prefers-color-scheme: dark)` blocks get migrated into compound `[data-theme][data-mode]` selectors. The `:root` block stays as a fallback.

- [ ] **Step 1: Add structural tokens for [data-theme="modern"]**

Add after the existing `@theme inline` block (before `:root`):

```css
[data-theme="modern"] {
  --radius: 0.75rem;
  --panel-blur: 12px;
  --panel-opacity: 0.8;
  --font-body: "Gilroy", sans-serif;
  --font-mono: "Red Hat Mono", monospace;
  --spacing-panel: 1rem;
  --border-width: 1px;
  --transition-speed: 150ms;
}
```

- [ ] **Step 2: Convert :root light-mode block to [data-theme="modern"][data-mode="light"]**

Copy the entire `:root` block contents into a new `[data-theme="modern"][data-mode="light"]` selector. The existing `:root` block stays as-is (fallback). Place the new selector after the structural tokens block.

```css
[data-theme="modern"][data-mode="light"] {
  --panel: #ffffff;
  --popover: #1f2937;
  --popover-foreground: #ffffff;
  --foreground: #111827;
  --muted: #6b7280;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --accent-foreground: #ffffff;
  --danger: #ef4444;
  --danger-hover: #dc2626;
  --danger-foreground: #ffffff;
  --success: #22c55e;
  --success-hover: #16a34a;
  --success-foreground: #ffffff;
  --warning: #eab308;
  --warning-hover: #ca8a04;
  --warning-foreground: #ffffff;
  --neutral: #6b7280;
  --neutral-hover: #4b5563;
  --neutral-foreground: #ffffff;
  --special: #a855f7;
  --special-hover: #9333ea;
  --special-foreground: #ffffff;
  --secondary: #e5e7eb;
  --secondary-hover: #d1d5db;
  --secondary-foreground: #374151;
  --input: #ffffff;
  --input-border: #d1d5db;
  --surface: #f3f4f6;
  --page-foreground: #ffffff;
  --page-overlay: #000000;
}
```

- [ ] **Step 3: Convert dark media query to [data-theme="modern"][data-mode="dark"]**

Copy the `@media (prefers-color-scheme: dark) { :root { ... } }` contents into a new `[data-theme="modern"][data-mode="dark"]` selector. Then **remove** the `@media (prefers-color-scheme: dark)` block entirely (dark mode is now controlled by `data-mode`, not the media query).

```css
[data-theme="modern"][data-mode="dark"] {
  --panel: #111827;
  --popover: #1f2937;
  --popover-foreground: #f9fafb;
  --foreground: #f9fafb;
  --muted: #9ca3af;
  --accent: #60a5fa;
  --accent-hover: #3b82f6;
  --accent-foreground: #ffffff;
  --danger: #f87171;
  --danger-hover: #ef4444;
  --danger-foreground: #ffffff;
  --success: #4ade80;
  --success-hover: #22c55e;
  --success-foreground: #ffffff;
  --warning: #facc15;
  --warning-hover: #eab308;
  --warning-foreground: #000000;
  --neutral: #9ca3af;
  --neutral-hover: #6b7280;
  --neutral-foreground: #ffffff;
  --special: #c084fc;
  --special-hover: #a855f7;
  --special-foreground: #ffffff;
  --secondary: #374151;
  --secondary-hover: #4b5563;
  --secondary-foreground: #f9fafb;
  --input: #1f2937;
  --input-border: #4b5563;
  --surface: #1f2937;
  --page-foreground: #ffffff;
  --page-overlay: #000000;
}
```

- [ ] **Step 4: Add accent color selectors**

6 selectors: 3 colors × 2 modes. These override only `--accent`, `--accent-hover`, `--accent-foreground` from the chromatic blocks.

```css
[data-theme="modern"][data-mode="light"][data-accent="red"] {
  --accent: #ef4444;
  --accent-hover: #dc2626;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="light"][data-accent="green"] {
  --accent: #22c55e;
  --accent-hover: #16a34a;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="light"][data-accent="blue"] {
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="dark"][data-accent="red"] {
  --accent: #f87171;
  --accent-hover: #ef4444;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="dark"][data-accent="green"] {
  --accent: #4ade80;
  --accent-hover: #22c55e;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="dark"][data-accent="blue"] {
  --accent: #60a5fa;
  --accent-hover: #3b82f6;
  --accent-foreground: #ffffff;
}
```

- [ ] **Step 5: Add page background color selectors**

6 selectors: 3 colors × 2 modes. These set only `--page-bg`.

```css
[data-theme="modern"][data-mode="light"][data-bg="red"] {
  --page-bg: #ef4444;
}
[data-theme="modern"][data-mode="light"][data-bg="green"] {
  --page-bg: #22c55e;
}
[data-theme="modern"][data-mode="light"][data-bg="blue"] {
  --page-bg: #3b82f6;
}
[data-theme="modern"][data-mode="dark"][data-bg="red"] {
  --page-bg: #991b1b;
}
[data-theme="modern"][data-mode="dark"][data-bg="green"] {
  --page-bg: #166534;
}
[data-theme="modern"][data-mode="dark"][data-bg="blue"] {
  --page-bg: #1e3a5f;
}
```

- [ ] **Step 6: Add --page-bg to :root fallback**

Add `--page-bg: #3b82f6;` to the existing `:root` block (blue light mode default).

- [ ] **Step 7: Extend @theme inline with new tokens**

Add these to the existing `@theme inline` block:

```css
  --color-page-bg: var(--page-bg);
  --radius-theme: var(--radius);
  --blur-panel: var(--panel-blur);
  --spacing-panel: var(--spacing-panel);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);
```

- [ ] **Step 8: Update body rule**

Change:
```css
body {
  font-family: "Gilroy", sans-serif;
  transition: background-color 0.2s ease;
}
```

To:
```css
html {
  background-color: var(--page-bg);
  transition: background-color var(--transition-speed, 0.15s) ease;
}

body {
  font-family: var(--font-body, "Gilroy", sans-serif);
}
```

- [ ] **Step 9: Verify build**

Run: `./build.sh`
Expected: Build completes without errors.

- [ ] **Step 10: Commit**

```bash
git add src/styles.css
git commit -m "feat: migrate CSS vars to data-attribute compound selectors for theme system"
```

---

### Task 3: Create theme boot module

**Files:**
- Create: `src/theme.ts`
- Modify: `src/index.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Create src/theme.ts**

This module handles applying data attributes to `<html>` and managing the mode media query listener.

```ts
import { store } from "./store"
import type { SyncSettings } from "./defaults"

const root = document.documentElement

const ATTR_MAP: Record<string, string> = {
  theme: "data-theme",
  accentColor: "data-accent",
  bgColor: "data-bg",
}

let mql: MediaQueryList | null = null
let mqlHandler: (() => void) | null = null

function resolveMode(mode: SyncSettings["mode"]): "light" | "dark" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return mode
}

function applyMode(mode: SyncSettings["mode"]): void {
  root.setAttribute("data-mode", resolveMode(mode))

  if (mqlHandler && mql) {
    mql.removeEventListener("change", mqlHandler)
    mqlHandler = null
    mql = null
  }

  if (mode === "auto") {
    mql = window.matchMedia("(prefers-color-scheme: dark)")
    mqlHandler = () => root.setAttribute("data-mode", resolveMode("auto"))
    mql.addEventListener("change", mqlHandler)
  }
}

export function applyTheme(): void {
  for (const [storeKey, attr] of Object.entries(ATTR_MAP)) {
    root.setAttribute(attr, store.sync.get(storeKey as keyof SyncSettings) as string)
  }
  applyMode(store.sync.get("mode"))
}

export function subscribeTheme(): void {
  for (const [storeKey, attr] of Object.entries(ATTR_MAP)) {
    store.sync.subscribe(storeKey as keyof SyncSettings, (val) => {
      root.setAttribute(attr, val as string)
    })
  }
  store.sync.subscribe("mode", applyMode)
}
```

- [ ] **Step 2: Update src/index.ts**

Replace the current `applyBgColor` import and usage with the new theme module:

```ts
import { store } from "./store"
import { applyTheme, subscribeTheme } from "./theme"
import { initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search"
import { initClock } from "./clock"
import { initTodo } from "./todo"
import { initWeather } from "./weather"
import { initSpotify } from "./spotify"
import { initHistoryImport } from "./history-import"
import { initRecommendations } from "./recommendations"
import { initCalendar } from "./calendar"

applyTheme()
subscribeTheme()

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initHistoryImport()
  initSearch()
  initClock()
  initTodo()
  initWeather()
  initSpotify()
  initRecommendations()
  initCalendar()
})
```

- [ ] **Step 3: Remove applyBgColor and BG_CLASSES from settings.ts**

Remove the `BG_CLASSES` const and `applyBgColor` export function from `src/settings.ts` (lines 6-17). Remove the `import type { SyncSettings } from "./defaults"` if it becomes unused (it's still used elsewhere in the file, so it stays).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme.ts src/index.ts src/settings.ts
git commit -m "feat: add theme boot module, apply data-* attributes synchronously before paint"
```

---

### Task 4: Create component helpers

**Files:**
- Create: `src/components.ts`

- [ ] **Step 1: Create src/components.ts with createButton**

```ts
type ButtonVariant = "primary" | "outline" | "ghost"

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-accent text-accent bg-transparent hover:bg-accent/10",
  ghost: "text-foreground bg-transparent hover:bg-surface",
}

export function createButton(
  label: string,
  variant: ButtonVariant,
  opts?: { icon?: string; onClick?: () => void }
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${BUTTON_CLASSES[variant]}`

  if (opts?.icon) {
    const iconSpan = document.createElement("span")
    iconSpan.className = "shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"
    iconSpan.innerHTML = opts.icon
    btn.appendChild(iconSpan)
  }

  if (label) {
    const labelSpan = document.createElement("span")
    labelSpan.textContent = label
    btn.appendChild(labelSpan)
  }

  if (opts?.onClick) {
    btn.addEventListener("click", opts.onClick)
  }

  return btn
}
```

- [ ] **Step 2: Add createInput**

```ts
export function createInput(opts: {
  type?: string
  placeholder?: string
  value?: string
  name?: string
  multiline?: boolean
  rows?: number
}): HTMLInputElement | HTMLTextAreaElement {
  const classes = "w-full text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors"

  if (opts.multiline) {
    const el = document.createElement("textarea")
    el.className = `${classes} resize-y`
    el.rows = opts.rows ?? 3
    if (opts.placeholder) el.placeholder = opts.placeholder
    if (opts.value) el.value = opts.value
    if (opts.name) el.name = opts.name
    return el
  }

  const el = document.createElement("input")
  el.type = opts.type ?? "text"
  el.className = classes
  if (opts.placeholder) el.placeholder = opts.placeholder
  if (opts.value) el.value = opts.value
  if (opts.name) el.name = opts.name
  return el
}
```

- [ ] **Step 3: Add createCheckbox**

```ts
export function createCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLLabelElement {
  const wrapper = document.createElement("label")
  wrapper.className = "inline-flex items-center gap-2 cursor-pointer"

  const input = document.createElement("input")
  input.type = "checkbox"
  input.checked = checked
  input.className = "rounded accent-accent shrink-0"
  input.addEventListener("change", () => onChange(input.checked))

  wrapper.appendChild(input)

  if (label) {
    const span = document.createElement("span")
    span.className = "text-sm text-foreground"
    span.textContent = label
    wrapper.appendChild(span)
  }

  return wrapper
}
```

- [ ] **Step 4: Add createAccordion**

```ts
export function createAccordion(
  label: string,
  opts?: { defaultOpen?: boolean; labelClass?: string }
): { container: HTMLElement; content: HTMLElement; toggle: () => void } {
  const container = document.createElement("div")
  const trigger = document.createElement("button")
  trigger.className = `w-full text-left text-sm font-semibold px-2 py-1 flex items-center gap-1 text-foreground ${opts?.labelClass ?? ""}`

  const chevron = document.createElement("span")
  chevron.textContent = "\u25BC"
  chevron.className = "text-xs transition-transform"
  trigger.appendChild(chevron)

  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = "flex flex-col gap-1 px-1"

  let expanded = opts?.defaultOpen !== false

  if (!expanded) {
    content.hidden = true
    chevron.style.transform = "rotate(-90deg)"
  }

  function toggle() {
    expanded = !expanded
    content.hidden = !expanded
    chevron.style.transform = expanded ? "" : "rotate(-90deg)"
  }

  trigger.addEventListener("click", toggle)

  container.appendChild(trigger)
  container.appendChild(content)
  return { container, content, toggle }
}
```

- [ ] **Step 5: Add createPopover**

```ts
let popoverZIndex = 100

export function createPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  opts?: { onClose?: () => void; parentPopover?: HTMLElement }
): { el: HTMLDivElement; close: () => void } {
  const popover = document.createElement("div")
  popover.className = "fixed bg-popover text-popover-foreground rounded-theme shadow-lg p-3 flex flex-col gap-2 backdrop-blur-sm border border-input-border/20"
  popover.style.zIndex = String(popoverZIndex++)
  popover.appendChild(content)

  document.body.appendChild(popover)

  const rect = anchor.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()

  let top = rect.bottom + 4
  let left = rect.right - popoverRect.width

  if (left < 8) left = 8
  if (left + popoverRect.width > window.innerWidth - 8) left = window.innerWidth - popoverRect.width - 8
  if (top + popoverRect.height > window.innerHeight - 8) {
    top = rect.top - popoverRect.height - 4
  }

  popover.style.top = `${top}px`
  popover.style.left = `${left}px`

  let closed = false

  function close() {
    if (closed) return
    closed = true
    popover.remove()
    document.removeEventListener("click", onClickOutside)
    opts?.onClose?.()
  }

  function onClickOutside(e: MouseEvent) {
    const target = e.target as Node
    if (popover.contains(target)) return
    if (anchor.contains(target) || target === anchor) return
    if (opts?.parentPopover?.contains(target)) return
    close()
  }

  setTimeout(() => document.addEventListener("click", onClickOutside), 0)

  return { el: popover, close }
}

```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Both pass.

- [ ] **Step 7: Commit**

```bash
git add src/components.ts
git commit -m "feat: add component helpers (button, input, checkbox, accordion, popover)"
```

---

### Task 5: Update settings HTML and wiring

**Files:**
- Modify: `src/index.html`
- Modify: `src/settings.ts`

- [ ] **Step 1: Add theme/accent/mode controls to settings dialog HTML**

In `src/index.html`, add these three fieldsets immediately after the opening `<h2>Settings</h2>` line (before the existing Background Color fieldset):

```html
        <fieldset class="border-0 p-0 m-0">
          <legend class="text-sm font-medium mb-2">Theme</legend>
          <select
            id="settings-theme"
            class="text-sm rounded px-2 py-1 border border-input-border bg-input"
          >
            <option value="modern">Modern</option>
          </select>
        </fieldset>
        <fieldset class="border-0 p-0 m-0 mt-4">
          <legend class="text-sm font-medium mb-2">Accent Color</legend>
          <div class="flex gap-2">
            <button
              data-setting="accent"
              data-value="red"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-red-500 text-white hover:opacity-80 transition-opacity"
            >
              Red
            </button>
            <button
              data-setting="accent"
              data-value="green"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-green-500 text-white hover:opacity-80 transition-opacity"
            >
              Green
            </button>
            <button
              data-setting="accent"
              data-value="blue"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:opacity-80 transition-opacity"
            >
              Blue
            </button>
          </div>
        </fieldset>
        <fieldset class="border-0 p-0 m-0 mt-4">
          <legend class="text-sm font-medium mb-2">Mode</legend>
          <div class="flex gap-2">
            <button
              data-setting="mode"
              data-value="light"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary-hover transition-colors text-sm"
            >
              Light
            </button>
            <button
              data-setting="mode"
              data-value="dark"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary-hover transition-colors text-sm"
            >
              Dark
            </button>
            <button
              data-setting="mode"
              data-value="auto"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary-hover transition-colors text-sm"
            >
              Auto
            </button>
          </div>
        </fieldset>
```

- [ ] **Step 2: Rename existing bgColor button attributes**

Change the 3 existing background color buttons from `data-color="red"` to `data-setting="bg" data-value="red"` (etc.):

```html
            <button
              data-setting="bg"
              data-value="red"
              aria-pressed="false"
              class="px-4 py-2 rounded-lg bg-red-500 text-white hover:opacity-80 transition-opacity"
            >
```

Same for green and blue.

- [ ] **Step 3: Remove #todo-prompt-dialog**

Delete the entire `<dialog id="todo-prompt-dialog">...</dialog>` block from `index.html` (lines 510-556).

- [ ] **Step 4: Rewire bgColor buttons in settings.ts**

In `src/settings.ts`, add a generic button group wiring function at **module scope** (before `initSettings`), then replace the old `data-color` button wiring inside `initSettings`:

```ts
function wireButtonGroup(
  dialog: HTMLElement,
  settingAttr: string,
  storeKey: keyof SyncSettings
): void {
  const btns = dialog.querySelectorAll<HTMLButtonElement>(`[data-setting="${settingAttr}"]`)

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      store.sync.set(storeKey, btn.dataset.value as any)
    })
  })

  function updateActive(val: string): void {
    btns.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.value === val))
    })
  }

  updateActive(store.sync.get(storeKey) as string)
  store.sync.subscribe(storeKey, (val) => updateActive(val as string))
}
```

Then in `initSettings()`, replace the old `colorBtns` code with:

```ts
wireButtonGroup(dialog, "bg", "bgColor")
wireButtonGroup(dialog, "accent", "accentColor")
wireButtonGroup(dialog, "mode", "mode")
```

- [ ] **Step 5: Wire theme select in settings.ts**

Add to `initSettings()`:

```ts
const themeSelect = document.getElementById("settings-theme") as HTMLSelectElement
themeSelect.value = store.sync.get("theme")
themeSelect.addEventListener("change", () => {
  store.sync.set("theme", themeSelect.value as SyncSettings["theme"])
})
store.sync.subscribe("theme", (val) => { themeSelect.value = val })
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Both pass.

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/settings.ts
git commit -m "feat: add theme/accent/mode settings controls, rewire bgColor buttons"
```

---

### Task 6: Refactor todo widget

**Files:**
- Modify: `src/todo.ts`

This is the largest refactor. The todo widget gets updated to use component helpers, and the `todoPrompt` dialog is replaced with a nested popover.

- [ ] **Step 1: Update imports**

Replace the current imports at the top of `src/todo.ts`:

```ts
import { store } from "./store"
import type { Todo } from "./todos"
import {
  addTodo, editTodo, deleteTodo, toggleTodo,
  reorderTodos, getOverdue, getActive, getCompleted, purgeStale,
} from "./todos"
import {
  createButton, createPopover, createAccordion,
  createCheckbox, createInput,
} from "./components"
```

- [ ] **Step 2: Replace todoPrompt with nested popover form**

Remove the entire `todoPrompt` function (lines 42-103). Replace with:

```ts
function todoFormPopover(
  anchor: HTMLElement,
  parentPopover: HTMLElement,
  title: string,
  prefill?: { title?: string; description?: string | null; url?: string | null; dueDate?: string | null }
): Promise<{ title: string; description: string | null; url: string | null; dueDate: string | null } | null> {
  return new Promise((resolve) => {
    let resolved = false

    const form = document.createElement("div")
    form.className = "flex flex-col gap-2 min-w-[260px]"

    const heading = document.createElement("h3")
    heading.className = "text-sm font-semibold text-foreground"
    heading.textContent = title
    form.appendChild(heading)

    const titleInput = createInput({ placeholder: "Title", value: prefill?.title ?? "" })
    form.appendChild(titleInput)

    const descInput = createInput({ placeholder: "Description (optional)", value: prefill?.description ?? "", multiline: true, rows: 2 })
    form.appendChild(descInput)

    const urlInput = createInput({ type: "url", placeholder: "URL (optional)", value: prefill?.url ?? "" })
    form.appendChild(urlInput)

    const dueInput = createInput({ type: "date", value: prefill?.dueDate ?? "" })
    form.appendChild(dueInput)

    const btnRow = document.createElement("div")
    btnRow.className = "flex gap-2 justify-end"

    const cancelBtn = createButton("Cancel", "ghost", {
      onClick: () => {
        resolved = true
        popover.close()
        resolve(null)
      },
    })
    const saveBtn = createButton("Save", "primary", {
      onClick: () => {
        const t = (titleInput as HTMLInputElement).value.trim()
        if (!t) return
        resolved = true
        popover.close()
        resolve({
          title: t,
          description: (descInput as HTMLTextAreaElement).value.trim() || null,
          url: (urlInput as HTMLInputElement).value.trim() || null,
          dueDate: (dueInput as HTMLInputElement).value || null,
        })
      },
    })

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(saveBtn)
    form.appendChild(btnRow)

    const popover = createPopover(anchor, form, {
      parentPopover,
      onClose: () => { if (!resolved) resolve(null) },
    })

    ;(titleInput as HTMLInputElement).focus()
  })
}
```

- [ ] **Step 3: Replace createAccordion with component helper**

Remove the local `createAccordion` function (lines 113-138). The calls to it already match the new component API pattern. Update call sites:

Old: `createAccordion("Overdue (3)", true)` → `acc.wrapper` / `acc.content`
New: `createAccordion("Overdue (3)", { labelClass: "text-danger" })` → `acc.container` / `acc.content`

In `showPopover`'s `rebuildContent`, update all three accordion calls:

```ts
// Overdue
const acc = createAccordion(`Overdue (${overdue.length})`, { labelClass: "text-danger" })
// ... use acc.container instead of acc.wrapper

// Active
const todoAcc = createAccordion(`Todo (${active.length})`)
// ... use todoAcc.container instead of todoAcc.wrapper

// Completed
const compAcc = createAccordion(`Completed (${completed.length})`)
// ... use compAcc.container instead of compAcc.wrapper
```

- [ ] **Step 4: Replace renderTodoItem checkbox with createCheckbox**

In `renderTodoItem`, replace the manual checkbox creation (lines 153-167) with:

```ts
const checkboxLabel = createCheckbox("", todo.completed, (checked) => {
  const todos = toggleTodo(getTodos(), todo.id)
  save(todos)
  if (checked) {
    titleSpan.classList.add("line-through", "opacity-40")
  } else {
    titleSpan.classList.remove("line-through", "opacity-40")
  }
})
checkboxLabel.className = "shrink-0"
row.appendChild(checkboxLabel)
```

- [ ] **Step 5: Replace action buttons with createButton**

In `renderTodoItem`, replace the edit/delete/url button creation with `createButton` using the ghost variant:

For the URL button:
```ts
if (todo.url) {
  const urlBtn = createButton("", "ghost", {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    onClick: () => window.open(todo.url!, "_blank"),
  })
  urlBtn.className = "text-muted hover:text-foreground shrink-0 p-0.5"
  row.appendChild(urlBtn)
}
```

For the edit button:
```ts
const editBtn = createButton("", "ghost", {
  icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
  onClick: async () => {
    const result = await todoFormPopover(editBtn, openPopover!, "Edit Todo", {
      title: todo.title,
      description: todo.description,
      url: todo.url,
      dueDate: todo.dueDate,
    })
    if (!result) return
    save(editTodo(getTodos(), todo.id, result))
    onUpdate()
  },
})
editBtn.className = "text-muted hover:text-foreground shrink-0 p-0.5"
row.appendChild(editBtn)
```

For the delete button:
```ts
const delBtn = createButton("", "ghost", {
  icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  onClick: () => {
    save(deleteTodo(getTodos(), todo.id))
    onUpdate()
  },
})
delBtn.className = "text-danger/70 hover:text-danger shrink-0 p-0.5"
row.appendChild(delBtn)
```

- [ ] **Step 6: Update showPopover to use createPopover**

Replace the manual popover creation in `showPopover` with `createPopover`. The function should build the content element first, then pass it to `createPopover`:

```ts
function showPopover(anchor: HTMLElement): void {
  closePopover()
  let todos = purgeStale(getTodos())
  save(todos)

  const content = document.createElement("div")
  content.className = "flex flex-col gap-2 min-w-[300px] max-w-[400px] max-h-[500px] overflow-y-auto"

  const addBtn = createButton("Add todo", "primary", {
    onClick: async () => {
      const result = await todoFormPopover(addBtn, openPopover!, "Add Todo")
      if (!result) return
      save(addTodo(getTodos(), result))
      rebuildContent()
    },
  })
  content.appendChild(addBtn)

  function rebuildContent() {
    while (content.children.length > 1) {
      content.removeChild(content.lastChild!)
    }
    // ... rest of rebuildContent stays the same but uses
    // acc.container instead of acc.wrapper, and
    // appends to content instead of popover
  }

  rebuildContent()

  const { el: popoverEl } = createPopover(anchor, content, {
    onClose: () => {
      openPopover = null
      updateBadges()
    },
  })
  openPopover = popoverEl
}
```

Update `closePopover` to handle the new approach:

```ts
function closePopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
  updateBadges()
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && ./build.sh`
Expected: Both pass.

- [ ] **Step 8: Commit**

```bash
git add src/todo.ts
git commit -m "feat: refactor todo widget to use component helpers and nested popover"
```

---

### Task 7: Final verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Build**

Run: `./build.sh`
Expected: "Build complete. Output in dist/"

- [ ] **Step 3: Verify HTML has no stale references**

Check that `index.html` doesn't reference the removed `#todo-prompt-dialog` elements. Check that no `.ts` file references `todoPrompt`, `applyBgColor`, or `BG_CLASSES`.

Run: `grep -r "todo-prompt-dialog\|applyBgColor\|BG_CLASSES\|data-color=" src/`
Expected: No matches.

- [ ] **Step 4: Commit any cleanup**

If any stale references found, fix and commit.
