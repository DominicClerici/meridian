# Settings UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild settings dialog tabs (General, Appearance, Widgets) with new reusable components, animated accordion, color swatches, mode selector, and branded connect buttons — all integrated with the dynamic appearance/theming system.

**Architecture:** Components are vanilla TS factory functions in `src/components.ts`. Settings tabs are built programmatically in `src/settings.ts` using those factories, wired to the reactive store. CSS tokens in `src/styles.css` drive all theming, scoped under `[data-theme]` selectors.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4 (standalone CLI), no npm runtime dependencies. Build: `./build.sh`. Type check: `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-03-25-settings-ui-overhaul-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components.ts` | Modify | Add button variants, `createSelect`, accordion animation |
| `src/settings.ts` | Modify | Rebuild General/Appearance/Widgets programmatically, tab title animation |
| `src/index.html` | Modify | Empty rebuilt panels, move recommendations to shortcuts |
| `src/styles.css` | Modify | Add swatch tokens, mode-button tokens, swatch/mode CSS |

---

### Task 1: Add CSS Tokens for Swatches and Mode Buttons

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add swatch color custom properties**

Add to the existing `[data-theme="modern"][data-mode="light"]` block (after the existing properties around line 124):

```css
  --swatch-red: #ef4444;
  --swatch-green: #22c55e;
  --swatch-blue: #3b82f6;
```

Add to the existing `[data-theme="modern"][data-mode="dark"]` block (after the existing properties around line 158):

```css
  --swatch-red: #f87171;
  --swatch-green: #4ade80;
  --swatch-blue: #60a5fa;
```

- [ ] **Step 2: Add mode button identity custom properties**

Add to the same `[data-theme="modern"][data-mode="light"]` block:

```css
  --mode-light-bg: #fef3c7;
  --mode-light-fg: #92400e;
  --mode-dark-bg: #1e1b4b;
  --mode-dark-fg: #c7d2fe;
```

Add to the same `[data-theme="modern"][data-mode="dark"]` block:

```css
  --mode-light-bg: #451a03;
  --mode-light-fg: #fbbf24;
  --mode-dark-bg: #0f0a2e;
  --mode-dark-fg: #a5b4fc;
```

- [ ] **Step 3: Register swatch tokens in @theme inline**

Add to the `@theme inline` block (around line 41, after the existing entries):

```css
  --color-swatch-red: var(--swatch-red);
  --color-swatch-green: var(--swatch-green);
  --color-swatch-blue: var(--swatch-blue);
```

- [ ] **Step 4: Add swatch fallback values to :root**

Add to the `:root` block (around line 347):

```css
  --swatch-red: #ef4444;
  --swatch-green: #22c55e;
  --swatch-blue: #3b82f6;
  --mode-light-bg: #fef3c7;
  --mode-light-fg: #92400e;
  --mode-dark-bg: #1e1b4b;
  --mode-dark-fg: #c7d2fe;
```

- [ ] **Step 5: Verify build**

Run: `cd /c/Users/dcler/Desktop/Coding/startpage-final && ./build.sh`
Expected: Clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "feat: add swatch and mode-button CSS tokens for modern theme"
```

---

### Task 2: Add Button Variants and className Option

**Files:**
- Modify: `src/components.ts`

- [ ] **Step 1: Extend ButtonVariant type and BUTTON_CLASSES**

At the top of `src/components.ts`, replace the existing type and record (lines 1-7):

```ts
type ButtonVariant = "primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override"

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-accent text-accent bg-transparent hover:bg-accent/10",
  ghost: "text-foreground bg-transparent hover:bg-surface",
  destructive: "bg-danger text-danger-foreground hover:bg-danger-hover",
  "destructive-outline": "border border-danger text-danger bg-transparent hover:bg-danger/10",
  override: "",
}
```

- [ ] **Step 2: Add className to opts parameter**

Update the `createButton` function signature (line 9-13) to add `className`:

```ts
export function createButton(
  label: string,
  variant: ButtonVariant,
  opts?: { icon?: string; onClick?: () => void; className?: string }
): HTMLButtonElement {
```

Then in the function body, append className after the existing class assignment (after line 15):

Replace the line:
```ts
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${BUTTON_CLASSES[variant]}`
```

With:
```ts
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${BUTTON_CLASSES[variant]} ${opts?.className ?? ""}`.trim()
```

- [ ] **Step 3: Type check**

Run: `cd /c/Users/dcler/Desktop/Coding/startpage-final && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components.ts
git commit -m "feat: add destructive, destructive-outline, override button variants"
```

---

### Task 3: Add createSelect Component

**Files:**
- Modify: `src/components.ts`

- [ ] **Step 1: Add createSelect function**

Add after the `createInput` function (after line 64):

```ts
export function createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string
  name?: string
  onChange?: (value: string) => void
}): HTMLSelectElement {
  const el = document.createElement("select")
  el.className = "text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground outline-none focus:border-accent transition-colors"

  for (const opt of opts.options) {
    const option = document.createElement("option")
    option.value = opt.value
    option.textContent = opt.label
    el.appendChild(option)
  }

  if (opts.value) el.value = opts.value
  if (opts.name) el.name = opts.name
  if (opts.onChange) {
    el.addEventListener("change", () => opts.onChange!(el.value))
  }

  return el
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components.ts
git commit -m "feat: add createSelect component factory"
```

---

### Task 4: Animate Accordion Expand/Collapse

**Files:**
- Modify: `src/components.ts`

- [ ] **Step 1: Replace the accordion toggle function**

In `createAccordion` (starts at line 92), replace the entire function body from `let expanded` through the end of the return statement. The new implementation:

```ts
export function createAccordion(
  label: string,
  opts?: { defaultOpen?: boolean; labelClass?: string; variant?: "compact" | "settings" }
): { container: HTMLElement; content: HTMLElement; toggle: () => void } {
  const isSettings = opts?.variant === "settings"
  const container = document.createElement("div")
  if (isSettings) container.className = "border-b border-input-border/15 last:border-b-0"

  const trigger = document.createElement("button")
  trigger.className = isSettings
    ? `w-full text-left text-sm font-medium px-6 py-3 flex items-center gap-2 transition-colors hover:bg-surface/50 ${opts?.labelClass ?? ""}`
    : `w-full text-left text-xs font-medium px-1 py-1.5 flex items-center gap-1.5 transition-colors ${opts?.labelClass ?? ""}`

  const chevron = document.createElement("span")
  chevron.textContent = "\u25BC"
  chevron.className = isSettings
    ? "text-[11px] transition-transform opacity-40"
    : "text-[10px] transition-transform opacity-50"
  trigger.appendChild(chevron)

  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = isSettings
    ? "flex flex-col gap-3 px-6 py-4"
    : "flex flex-col gap-0.5"

  let expanded = opts?.defaultOpen !== false
  let currentAnim: Animation | null = null

  if (!expanded) {
    content.hidden = true
    chevron.style.transform = "rotate(-90deg)"
  }

  function toggle() {
    if (currentAnim) {
      currentAnim.cancel()
      currentAnim = null
    }

    expanded = !expanded
    chevron.style.transform = expanded ? "" : "rotate(-90deg)"

    if (expanded) {
      content.hidden = false
      content.style.overflow = "hidden"
      const h = content.scrollHeight
      content.style.height = "0px"
      content.style.opacity = "0"

      const anim = content.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${h}px`, opacity: 1 },
        ],
        { duration: 200, easing: "ease-out", fill: "forwards" }
      )
      currentAnim = anim

      anim.onfinish = () => {
        if (currentAnim !== anim) return
        currentAnim = null
        content.style.height = ""
        content.style.opacity = ""
        content.style.overflow = ""
        anim.cancel()
      }
    } else {
      content.style.overflow = "hidden"
      const h = content.offsetHeight

      const anim = content.animate(
        [
          { height: `${h}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: 150, easing: "ease-in", fill: "forwards" }
      )
      currentAnim = anim

      anim.onfinish = () => {
        if (currentAnim !== anim) return
        currentAnim = null
        content.hidden = true
        content.style.height = ""
        content.style.opacity = ""
        content.style.overflow = ""
        anim.cancel()
      }
    }
  }

  trigger.addEventListener("click", toggle)

  container.appendChild(trigger)
  container.appendChild(content)
  return { container, content, toggle }
}
```

Key changes from existing code:
- `content.className` for settings variant changes from `px-6 pb-4` to `px-6 py-4` (adds top padding)
- `toggle()` now uses `element.animate()` instead of `content.hidden` toggle
- Opening: 200ms ease-out, height 0→scrollHeight + opacity 0→1
- Closing: 150ms ease-in, height current→0 + opacity 1→0
- `currentAnim` guard prevents rapid-click glitches

- [ ] **Step 2: Type check and build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components.ts
git commit -m "feat: animate accordion expand/collapse with height + opacity"
```

---

### Task 5: Update HTML — Empty Panels, Move Recommendations

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Replace the general tab panel**

Replace the entire `data-settings-tab="general"` div (lines 163-295 in index.html) with:

```html
            <div data-settings-tab="general" class="settings-panel"></div>
```

Note: no `hidden` attribute since general is the default active tab.

- [ ] **Step 2: Replace the appearance tab panel**

Replace the entire `data-settings-tab="appearance"` div (currently the block with all the fieldsets for theme/accent/mode/bg) with:

```html
            <div
              data-settings-tab="appearance"
              class="settings-panel"
              hidden
            ></div>
```

- [ ] **Step 3: Replace the widgets tab panel**

Replace the entire `data-settings-tab="widgets"` div (the block with all the data-widget-section divs) with:

```html
            <div data-settings-tab="widgets" class="settings-panel" hidden></div>
```

- [ ] **Step 4: Add recommendations checkbox to shortcuts tab**

In the shortcuts tab panel (`data-settings-tab="shortcuts"`), add a recommendations toggle at the bottom, after the `sc-list` div (after line 357 area):

```html
              <div class="flex items-center gap-2 mt-4 pt-3 border-t border-input-border/15">
                <input
                  type="checkbox"
                  id="settings-recommendations-enabled"
                  class="rounded accent-accent shrink-0"
                />
                <label for="settings-recommendations-enabled" class="text-sm"
                  >Show smart suggestions in dock</label
                >
              </div>
```

- [ ] **Step 5: Build to verify HTML is valid**

Run: `./build.sh`
Expected: Clean build. The app will look broken (empty tabs) since the JS builders aren't wired yet — that's expected.

- [ ] **Step 6: Commit**

```bash
git add src/index.html
git commit -m "refactor: empty rebuilt settings panels, move recommendations to shortcuts"
```

---

### Task 6: Add Tab Title Crossfade Animation

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Replace synchronous title update with animated crossfade**

In the `switchTab` function inside `buildNav`, find this line (around line 129):

```ts
    title.textContent = TABS[index].label
```

Replace it with:

```ts
    const titleFadeOut = title.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 50, easing: "ease-in", fill: "forwards" }
    )

    setTimeout(() => {
      titleFadeOut.cancel()
      title.textContent = TABS[index].label
      const titleFadeIn = title.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 50, easing: "ease-out", fill: "forwards" }
      )
      titleFadeIn.onfinish = () => {
        titleFadeIn.cancel()
        title.style.opacity = ""
      }
    }, 25)
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add crossfade animation to settings tab title"
```

---

### Task 7: Build General Tab Programmatically

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Create a settings row helper function**

Add a helper at the top of `settings.ts` (after the imports, before the TABS array) to create label-left/control-right rows:

```ts
function settingsRow(
  label: string,
  control: HTMLElement,
  opts?: { hidden?: boolean }
): HTMLElement {
  const row = document.createElement("div")
  row.className = "flex items-center justify-between py-3 border-b border-input-border/10 last:border-b-0"
  if (opts?.hidden) row.hidden = true

  const labelEl = document.createElement("span")
  labelEl.className = "text-sm text-foreground"
  labelEl.textContent = label

  row.appendChild(labelEl)
  row.appendChild(control)
  return row
}
```

- [ ] **Step 2: Create the buildGeneralTab function**

Add a new function (after the helper, before `buildNav`):

```ts
function buildGeneralTab(): void {
  const panel = document.querySelector('[data-settings-tab="general"]')!
  panel.className = "settings-panel px-6 pb-6"

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const clockEnabled = createCheckbox("", store.sync.get("clockEnabled"), (v) => store.sync.set("clockEnabled", v))
  wrapper.appendChild(settingsRow("Show clock", clockEnabled))

  const clockSeconds = createCheckbox("", store.sync.get("clockShowSeconds"), (v) => store.sync.set("clockShowSeconds", v))
  wrapper.appendChild(settingsRow("Show seconds", clockSeconds))

  const clock24h = createCheckbox("", store.sync.get("clock24Hour"), (v) => {
    store.sync.set("clock24Hour", v)
    ampmRow.hidden = v
  })
  wrapper.appendChild(settingsRow("24-hour format", clock24h))

  const clockAmPm = createCheckbox("", store.sync.get("clockShowAmPm"), (v) => store.sync.set("clockShowAmPm", v))
  const ampmRow = settingsRow("Show AM/PM", clockAmPm, { hidden: store.sync.get("clock24Hour") })
  wrapper.appendChild(ampmRow)

  const clockDate = createCheckbox("", store.sync.get("clockShowDate"), (v) => {
    store.sync.set("clockShowDate", v)
    dateFormatRow.hidden = !v
  })
  wrapper.appendChild(settingsRow("Show date", clockDate))

  const clockDateFormat = createSelect({
    options: [
      { value: "long", label: "January 24th" },
      { value: "short", label: "Jan. 24th" },
      { value: "abbr", label: "Jan 24" },
      { value: "numeric", label: "01/24/2024" },
      { value: "numericShort", label: "01/24" },
    ],
    value: store.sync.get("clockDateFormat"),
    onChange: (v) => store.sync.set("clockDateFormat", v as SyncSettings["clockDateFormat"]),
  })
  const dateFormatRow = settingsRow("Date format", clockDateFormat, { hidden: !store.sync.get("clockShowDate") })
  wrapper.appendChild(dateFormatRow)

  const clockSize = createSelect({
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    value: store.sync.get("clockSize"),
    onChange: (v) => store.sync.set("clockSize", v as SyncSettings["clockSize"]),
  })
  wrapper.appendChild(settingsRow("Size", clockSize))

  panel.appendChild(wrapper)

  // Bidirectional sync — update controls when store changes externally
  const cb = (el: HTMLLabelElement) => el.querySelector("input") as HTMLInputElement
  store.sync.subscribe("clockEnabled", (v) => { cb(clockEnabled).checked = v })
  store.sync.subscribe("clockShowSeconds", (v) => { cb(clockSeconds).checked = v })
  store.sync.subscribe("clock24Hour", (v) => {
    cb(clock24h).checked = v
    ampmRow.hidden = v
  })
  store.sync.subscribe("clockShowAmPm", (v) => { cb(clockAmPm).checked = v })
  store.sync.subscribe("clockShowDate", (v) => {
    cb(clockDate).checked = v
    dateFormatRow.hidden = !v
  })
  store.sync.subscribe("clockDateFormat", (v) => { clockDateFormat.value = v })
  store.sync.subscribe("clockSize", (v) => { clockSize.value = v })
}
```

- [ ] **Step 3: Update imports**

Add `createCheckbox`, `createSelect` to the import from `"./components"` at the top of `settings.ts`. The import should become:

```ts
import { createAccordion, createCheckbox, createSelect } from "./components"
```

- [ ] **Step 4: Strip all old wiring from initSettings and wire buildGeneralTab**

Since Task 5 already emptied the HTML for General, Appearance, and Widgets panels, ALL old `getElementById`-based wiring for those tabs must be removed now to prevent null reference crashes. Remove everything in `initSettings()` EXCEPT the dialog/nav setup and recommendations wiring.

Specifically, remove:
- `wireButtonGroup` function (lines 35-56) and its 3 calls (lines 235-237)
- `buildWidgetAccordions` function (lines 172-186) and its call (line 232)
- Theme select wiring (lines 239-244)
- Search engine / debounce wiring (lines 246-270)
- ALL clock wiring (lines 272-318)
- Recommendations wiring (lines 320-323) — **keep this**, just move it below the builder calls
- ALL todo wiring (lines 325-341)
- ALL weather wiring (lines 343-377)
- ALL spotify wiring (lines 379-409)
- ALL calendar wiring (lines 411-441)

Replace with:

```ts
export function initSettings(): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement

  const nav = buildNav(dialog)
  setupDialogBehavior(dialog, nav)

  buildGeneralTab()

  // Recommendations (in shortcuts tab — still static HTML)
  const recsEnabled = document.getElementById("settings-recommendations-enabled") as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () => store.sync.set("recommendationsEnabled", recsEnabled.checked))
  store.sync.subscribe("recommendationsEnabled", (v) => { recsEnabled.checked = v })
}
```

The Appearance and Widgets builder calls will be added in Tasks 8 and 9 respectively.

- [ ] **Step 5: Type check and build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: No errors. The general tab should render clock settings with the new row layout.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "feat: build general tab (clock settings) programmatically"
```

---

### Task 8: Build Appearance Tab Programmatically

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Create the color swatch builder helper**

Add a helper function:

```ts
const SWATCH_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`

const SWATCH_COLORS = ["red", "green", "blue"] as const

function buildSwatchGroup(
  storeKey: "accentColor" | "bgColor"
): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-3 items-center"

  const buttons: HTMLButtonElement[] = []

  for (const color of SWATCH_COLORS) {
    const btn = document.createElement("button")
    btn.className = `w-6 h-6 rounded-full bg-swatch-${color} flex items-center justify-center cursor-pointer transition-all duration-150`
    btn.dataset.color = color

    btn.addEventListener("click", () => {
      store.sync.set(storeKey, color)
    })

    btn.addEventListener("mouseenter", () => {
      if (store.sync.get(storeKey) !== color) btn.style.transform = "scale(1.1)"
    })
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = ""
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (const btn of buttons) {
      const isSelected = btn.dataset.color === val
      if (isSelected) {
        btn.innerHTML = SWATCH_CHECK
        btn.style.outline = "2px solid"
        btn.style.outlineOffset = "2px"
        btn.style.outlineColor = `var(--swatch-${val})`
        btn.style.transform = ""
      } else {
        btn.innerHTML = ""
        btn.style.outline = ""
        btn.style.outlineOffset = ""
        btn.style.outlineColor = ""
      }
    }
  }

  updateSelected(store.sync.get(storeKey))
  store.sync.subscribe(storeKey, updateSelected)

  return container
}
```

- [ ] **Step 2: Create the mode selector builder**

Add SVG constants and the builder:

```ts
const MODE_ICONS = {
  light: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  dark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
  auto: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
} as const

function buildModeSelector(): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-2"

  const modes: SyncSettings["mode"][] = ["light", "dark", "auto"]
  const buttons: HTMLButtonElement[] = []

  for (const mode of modes) {
    const btn = createButton(mode.charAt(0).toUpperCase() + mode.slice(1), "override", {
      icon: MODE_ICONS[mode],
    })
    btn.className += " flex-1 justify-center py-2 border rounded-theme transition-colors"

    btn.addEventListener("click", () => {
      store.sync.set("mode", mode)
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (let i = 0; i < modes.length; i++) {
      const btn = buttons[i]
      const isSelected = modes[i] === val

      // Reset all inline styles
      btn.style.background = ""
      btn.style.color = ""
      btn.style.borderColor = ""

      if (isSelected) {
        if (modes[i] === "light") {
          btn.style.background = "var(--mode-light-bg)"
          btn.style.color = "var(--mode-light-fg)"
          btn.style.borderColor = "var(--mode-light-fg)"
        } else if (modes[i] === "dark") {
          btn.style.background = "var(--mode-dark-bg)"
          btn.style.color = "var(--mode-dark-fg)"
          btn.style.borderColor = "var(--mode-dark-fg)"
        } else {
          btn.style.background = "var(--accent)"
          btn.style.color = "var(--accent-foreground)"
          btn.style.borderColor = "var(--accent)"
        }
      } else {
        btn.style.borderColor = "var(--accent)"
        btn.style.color = "var(--accent)"
        btn.style.background = "transparent"
      }
    }
  }

  updateSelected(store.sync.get("mode"))
  store.sync.subscribe("mode", updateSelected)

  return container
}
```

- [ ] **Step 3: Create the buildAppearanceTab function**

```ts
function buildAppearanceTab(): void {
  const panel = document.querySelector('[data-settings-tab="appearance"]')!
  panel.className = "settings-panel p-6 flex flex-col gap-6"

  function section(labelText: string, child: HTMLElement): HTMLElement {
    const el = document.createElement("div")
    el.className = "flex flex-col gap-3"
    const lbl = document.createElement("span")
    lbl.className = "text-muted text-xs font-medium"
    lbl.textContent = labelText
    el.appendChild(lbl)
    el.appendChild(child)
    return el
  }

  // Theme
  const themeSelect = createSelect({
    options: [{ value: "modern", label: "Modern" }],
    value: store.sync.get("theme"),
    onChange: (v) => store.sync.set("theme", v as SyncSettings["theme"]),
  })
  store.sync.subscribe("theme", (v) => { themeSelect.value = v })

  const themeRow = document.createElement("div")
  themeRow.className = "flex items-center justify-between"
  const themeLbl = document.createElement("span")
  themeLbl.className = "text-sm text-foreground"
  themeLbl.textContent = "Theme"
  themeRow.appendChild(themeLbl)
  themeRow.appendChild(themeSelect)
  panel.appendChild(themeRow)

  // Accent Color
  panel.appendChild(section("Accent Color", buildSwatchGroup("accentColor")))

  // Background Color
  panel.appendChild(section("Background Color", buildSwatchGroup("bgColor")))

  // Mode
  panel.appendChild(section("Mode", buildModeSelector()))
}
```

- [ ] **Step 4: Wire buildAppearanceTab into initSettings**

In `initSettings()`, add `buildAppearanceTab()` after the `buildGeneralTab()` call. The old `wireButtonGroup` and theme wiring were already removed in Task 7.

- [ ] **Step 5: Update imports**

Make sure the import at the top includes `createButton`:

```ts
import { createAccordion, createButton, createCheckbox, createSelect } from "./components"
```

- [ ] **Step 6: Type check and build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts
git commit -m "feat: build appearance tab with swatches and mode selector"
```

---

### Task 9: Build Widgets Tab Programmatically

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Create branded button helper for Spotify**

Add helper function:

```ts
function createSpotifyButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors text-white"
  btn.style.background = "#1DB954"

  btn.addEventListener("mouseenter", () => { btn.style.background = "#1aa34a" })
  btn.addEventListener("mouseleave", () => { btn.style.background = "#1DB954" })

  const icon = document.createElement("div")
  icon.style.cssText = "width: 16px; height: 16px; background: #1ed760; border-radius: 2px; flex-shrink: 0;"
  btn.appendChild(icon)

  const label = document.createElement("span")
  label.textContent = "Connect Spotify"
  btn.appendChild(label)

  btn.addEventListener("click", onClick)
  return btn
}
```

- [ ] **Step 2: Create branded button helper for Google**

```ts
function createGoogleButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors"
  btn.style.cssText = "background: #ffffff; color: #3c4043; border: 1px solid #dadce0;"

  btn.addEventListener("mouseenter", () => { btn.style.background = "#f8f9fa" })
  btn.addEventListener("mouseleave", () => { btn.style.background = "#ffffff" })

  const icon = document.createElement("div")
  icon.style.cssText = "width: 16px; height: 16px; background: #4285F4; border-radius: 2px; flex-shrink: 0;"
  btn.appendChild(icon)

  const label = document.createElement("span")
  label.textContent = "Sign in with Google"
  btn.appendChild(label)

  btn.addEventListener("click", onClick)
  return btn
}
```

- [ ] **Step 3: Create the buildWidgetsTab function**

Replace the existing `buildWidgetAccordions` function with a new `buildWidgetsTab` function. This is the largest builder — it creates all 5 accordion sections:

```ts
function buildWidgetsTab(): void {
  const panel = document.querySelector('[data-settings-tab="widgets"]')!

  // --- Search ---
  const searchAcc = createAccordion("Search", { variant: "settings", defaultOpen: false })

  const searchEngine = createSelect({
    options: [
      { value: "google", label: "Google" },
      { value: "bing", label: "Bing" },
      { value: "yahoo", label: "Yahoo" },
      { value: "duckduckgo", label: "DuckDuckGo" },
      { value: "ecosia", label: "Ecosia" },
      { value: "qwant", label: "Qwant" },
      { value: "startpage", label: "Startpage" },
    ],
    value: store.sync.get("searchEngine"),
    onChange: (v) => store.sync.set("searchEngine", v as SyncSettings["searchEngine"]),
  })
  searchAcc.content.appendChild(settingsRow("Search Engine", searchEngine))
  store.sync.subscribe("searchEngine", (v) => { searchEngine.value = v })

  const debounce = createCheckbox("", store.sync.get("debounceSearch"), (v) => store.sync.set("debounceSearch", v))
  searchAcc.content.appendChild(settingsRow("Debounce shortcut search", debounce))
  store.sync.subscribe("debounceSearch", (v) => { (debounce.querySelector("input") as HTMLInputElement).checked = v })

  panel.appendChild(searchAcc.container)

  // --- Todo ---
  const todoAcc = createAccordion("Todo", { variant: "settings", defaultOpen: false })

  const todoEnabled = createCheckbox("", store.sync.get("todoEnabled"), (v) => store.sync.set("todoEnabled", v))
  todoAcc.content.appendChild(settingsRow("Enable todo widget", todoEnabled))
  store.sync.subscribe("todoEnabled", (v) => { (todoEnabled.querySelector("input") as HTMLInputElement).checked = v })

  const todoBadges = createCheckbox("", store.sync.get("todoShowBadges"), (v) => store.sync.set("todoShowBadges", v))
  todoAcc.content.appendChild(settingsRow("Show badges", todoBadges))
  store.sync.subscribe("todoShowBadges", (v) => { (todoBadges.querySelector("input") as HTMLInputElement).checked = v })

  const clearRow = document.createElement("div")
  clearRow.className = "flex justify-end"
  const clearBtn = createButton("Clear all todos", "destructive", {
    onClick: () => { if (confirm("Are you sure you want to clear all todos?")) store.local.set("todos", []) },
  })
  clearRow.appendChild(clearBtn)
  todoAcc.content.appendChild(clearRow)

  panel.appendChild(todoAcc.container)

  // --- Weather ---
  const weatherAcc = createAccordion("Weather", { variant: "settings", defaultOpen: false })

  const weatherEnabled = createCheckbox("", store.sync.get("weatherEnabled"), (v) => store.sync.set("weatherEnabled", v))
  weatherAcc.content.appendChild(settingsRow("Enable weather", weatherEnabled))
  store.sync.subscribe("weatherEnabled", (v) => { (weatherEnabled.querySelector("input") as HTMLInputElement).checked = v })

  const weatherUnit = createSelect({
    options: [
      { value: "f", label: "Fahrenheit" },
      { value: "c", label: "Celsius" },
    ],
    value: store.sync.get("weatherUnit"),
    onChange: (v) => store.sync.set("weatherUnit", v as SyncSettings["weatherUnit"]),
  })
  weatherAcc.content.appendChild(settingsRow("Temperature unit", weatherUnit))
  store.sync.subscribe("weatherUnit", (v) => { weatherUnit.value = v })

  const locationRow = document.createElement("div")
  const grantBtn = createButton("Grant location access", "primary", {
    onClick: () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          store.local.set("weatherLat", pos.coords.latitude)
          store.local.set("weatherLon", pos.coords.longitude)
          locationRow.hidden = true
        },
        () => { locationHelp.hidden = false },
        { timeout: 10000 }
      )
    },
  })
  locationRow.appendChild(grantBtn)

  const locationHelp = document.createElement("p")
  locationHelp.className = "text-xs text-muted mt-1"
  locationHelp.textContent = "Location access was denied. Please enable it in your browser settings for this extension."
  locationHelp.hidden = true
  locationRow.appendChild(locationHelp)

  locationRow.hidden = store.local.get("weatherLat") !== null
  store.local.subscribe("weatherLat", () => { locationRow.hidden = store.local.get("weatherLat") !== null })

  weatherAcc.content.appendChild(locationRow)
  panel.appendChild(weatherAcc.container)

  // --- Spotify ---
  const spotifyAcc = createAccordion("Spotify", { variant: "settings", defaultOpen: false })

  const spotifyEnabled = createCheckbox("", store.sync.get("spotifyEnabled"), (v) => store.sync.set("spotifyEnabled", v))
  spotifyAcc.content.appendChild(settingsRow("Enable Spotify widget", spotifyEnabled))
  store.sync.subscribe("spotifyEnabled", (v) => { (spotifyEnabled.querySelector("input") as HTMLInputElement).checked = v })

  const spotifyConnectRow = document.createElement("div")
  const spotifyBtn = createSpotifyButton(async () => {
    spotifyBtn.disabled = true
    spotifyBtn.querySelector("span")!.textContent = "Connecting..."
    const success = await spotifyAuthenticate()
    spotifyBtn.disabled = false
    spotifyBtn.querySelector("span")!.textContent = "Connect Spotify"
    if (success) updateSpotifyUI()
  })
  spotifyConnectRow.appendChild(spotifyBtn)

  const spotifyDisconnectRow = document.createElement("div")
  spotifyDisconnectRow.hidden = true
  const spotifyDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: () => { spotifyClearTokens(); updateSpotifyUI() },
  })
  spotifyDisconnectRow.appendChild(spotifyDisconnectBtn)

  function updateSpotifyUI(): void {
    const hasToken = store.local.get("spotifyAccessToken") !== null
    spotifyConnectRow.hidden = hasToken
    spotifyDisconnectRow.hidden = !hasToken
  }
  updateSpotifyUI()
  store.local.subscribe("spotifyAccessToken", () => updateSpotifyUI())

  spotifyAcc.content.appendChild(spotifyConnectRow)
  spotifyAcc.content.appendChild(spotifyDisconnectRow)
  panel.appendChild(spotifyAcc.container)

  // --- Google Calendar ---
  const calendarAcc = createAccordion("Google Calendar", { variant: "settings", defaultOpen: false })

  const calendarEnabled = createCheckbox("", store.sync.get("calendarEnabled"), (v) => store.sync.set("calendarEnabled", v))
  calendarAcc.content.appendChild(settingsRow("Enable Google Calendar", calendarEnabled))
  store.sync.subscribe("calendarEnabled", (v) => { (calendarEnabled.querySelector("input") as HTMLInputElement).checked = v })

  const calConnectRow = document.createElement("div")
  const calBtn = createGoogleButton(async () => {
    calBtn.disabled = true
    calBtn.querySelector("span")!.textContent = "Signing in..."
    const success = await calendarAuthenticate()
    calBtn.disabled = false
    calBtn.querySelector("span")!.textContent = "Sign in with Google"
    if (success) updateCalendarUI()
  })
  calConnectRow.appendChild(calBtn)

  const calDisconnectRow = document.createElement("div")
  calDisconnectRow.hidden = true
  const calDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: async () => { await calendarDisconnect(); updateCalendarUI() },
  })
  calDisconnectRow.appendChild(calDisconnectBtn)

  function updateCalendarUI(): void {
    const connected = store.local.get("calendarConnected")
    calConnectRow.hidden = connected
    calDisconnectRow.hidden = !connected
  }
  updateCalendarUI()
  store.local.subscribe("calendarConnected", () => updateCalendarUI())

  calendarAcc.content.appendChild(calConnectRow)
  calendarAcc.content.appendChild(calDisconnectRow)
  panel.appendChild(calendarAcc.container)
}
```

- [ ] **Step 4: Wire buildWidgetsTab into initSettings**

In `initSettings()`, add `buildWidgetsTab()` after the `buildAppearanceTab()` call. All old widget wiring was already removed in Task 7. The final `initSettings()` should now be:

```ts
export function initSettings(): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement

  const nav = buildNav(dialog)
  setupDialogBehavior(dialog, nav)

  buildGeneralTab()
  buildAppearanceTab()
  buildWidgetsTab()

  // Recommendations (in shortcuts tab — still static HTML)
  const recsEnabled = document.getElementById("settings-recommendations-enabled") as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () => store.sync.set("recommendationsEnabled", recsEnabled.checked))
  store.sync.subscribe("recommendationsEnabled", (v) => { recsEnabled.checked = v })
}
```

- [ ] **Step 5: Update imports**

Final import line at top of `settings.ts`:

```ts
import { createAccordion, createButton, createCheckbox, createSelect } from "./components"
```

Verify the existing imports for `spotifyAuthenticate`, `spotifyClearTokens`, `calendarAuthenticate`, `calendarDisconnect` are still present.

- [ ] **Step 6: Type check and build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts
git commit -m "feat: build widgets tab with all 5 accordion sections"
```

---

### Task 10: Remove Old button[aria-pressed] CSS Rule

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Remove the old aria-pressed rule**

The old appearance tab used `aria-pressed` on color buttons with a white outline ring. This is no longer used. Remove this block (around line 419):

```css
button[aria-pressed="true"] {
  outline: 3px solid white;
  outline-offset: 2px;
}
```

- [ ] **Step 2: Build**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "chore: remove unused aria-pressed button styling"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Full build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Manual verification checklist**

Open the extension in Chrome and verify:
- General tab: All 7 clock setting rows render, conditional hide/show works for AM/PM and date format
- Appearance tab: Theme select, 3 accent swatches, 3 bg swatches, 3 mode buttons render. Swatch selection shows ring + checkmark. Mode buttons show themed colors when selected.
- Widgets tab: All 5 accordions render and animate open/close (200ms open, 150ms close). Each accordion's settings work.
- Shortcuts tab: Recommendations checkbox appears at bottom
- Tab switching: Title crossfades in sync with panel transition
- All settings persist when changed and sync bidirectionally
