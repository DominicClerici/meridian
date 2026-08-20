# Design System — Configurable Theming Architecture

## Overview

A configurable design system for the startpage extension that allows users to customize theme, accent color, background color, and light/dark mode. Themes change the entire visual identity of the app — borders, radius, blur, fonts, spacing, transitions, etc. Colors vary per theme to match each theme's vibe.

The first iteration implements one theme ("Modern"), applies it to the todo widget via reusable component helpers, and adds settings controls for all four axes.

## Goals

- **Performance** — No flash on new tab load. Theme applied synchronously before first paint.
- **Flexibility** — Themes can change every visual aspect of every component.
- **Extensibility** — Adding a new theme = adding CSS blocks. Adding a new component = using existing CSS variables.
- **Minimal storage** — Only 4 short strings stored in sync storage.

## Non-Goals (This Iteration)

- Multiple themes (only "Modern" for now)
- Applying the design system to all widgets (only todo for now)
- Polished nested popover UX (functional only)
- Custom/user-defined colors beyond the 3 presets

---

## Architecture

### Storage

Three new keys added to `SyncSettings`, plus one existing key reused:

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `theme` | `"modern"` | `"modern"` | **New.** Extensible to `"terminal"`, etc. |
| `accentColor` | `"red" \| "green" \| "blue"` | `"blue"` | **New.** Highlight/action color. |
| `bgColor` | `"red" \| "green" \| "blue"` | `"blue"` | **Existing.** Already in `SyncSettings`. Semantics change: currently drives a Tailwind class on `<body>` via `applyBgColor()` + `BG_CLASSES` map — both are removed. Now drives `data-bg` on `<html>`, resolved via CSS variables. |
| `mode` | `"light" \| "dark" \| "auto"` | `"auto"` | **New.** Replaces Tailwind's `prefers-color-scheme` auto-detection. |

Stored via `store.sync` — syncs across devices, ~100 bytes total.

### Store Key → Data Attribute Mapping

| Store Key | HTML Attribute | Example |
|-----------|---------------|---------|
| `theme` | `data-theme` | `data-theme="modern"` |
| `accentColor` | `data-accent` | `data-accent="blue"` |
| `bgColor` | `data-bg` | `data-bg="blue"` |
| `mode` | `data-mode` | `data-mode="dark"` (resolved) |

### Data Attributes

Four `data-*` attributes on `<html>`:

```html
<html data-theme="modern" data-accent="blue" data-bg="blue" data-mode="dark">
```

For `mode: "auto"`, JS resolves to the concrete value via `matchMedia("(prefers-color-scheme: dark)")` and sets `data-mode` to the resolved `"light"` or `"dark"`. A media query listener updates it live.

### Boot Sequence

Synchronous, before first paint (in `src/index.ts`, top-level):

1. Read `theme`, `accentColor`, `bgColor`, `mode` from store cache (instant — seeded from localStorage)
2. Set all 4 `data-*` attributes on `document.documentElement` using the mapping above
3. For `mode: "auto"`, resolve via `matchMedia` and set resolved value
4. Register media query change listener for auto mode

**Mode change handling:** When the user changes `mode` via settings, the subscriber must: (a) if new value is `"auto"`, resolve via `matchMedia`, set resolved value on `data-mode`, and register the media query change listener; (b) if new value is `"light"` or `"dark"`, set that value directly on `data-mode` and unregister any existing media query listener. This prevents stale `data-mode` values.

**Migration:** The existing `applyBgColor()` function and `BG_CLASSES` map in `settings.ts` / `index.ts` are removed entirely. The new boot sequence replaces them. The existing `body { transition: background-color 0.2s ease }` rule is moved to target `html` and updated to use `transition: background-color var(--transition-speed) ease`.

This happens before DOMContentLoaded. CSS variables are resolved by the browser in one style recalc from the pre-defined `data-*` selectors.

### Fallback Behavior

The `:root` block retains safe defaults matching `modern` + light mode + `blue` accent + `blue` bg. This includes all existing variables plus the new `--page-bg` variable (defaulting to the light-blue value). If data attributes fail to apply (store corrupted, extension context unavailable), the page still renders with a sensible baseline. The `[data-theme]` compound selectors have higher specificity and override `:root` when present.

---

## CSS Theme Definitions

All theme values defined in `src/styles.css` via compound `data-*` selectors.

### Token Categories

| Category | Depends On | Examples |
|----------|-----------|---------|
| Structural | theme only | `--radius`, `--panel-blur`, `--panel-opacity`, `--font-body`, `--font-mono`, `--spacing-panel`, `--border-width`, `--transition-speed` |
| Chromatic | theme + mode | `--panel`, `--foreground`, `--muted`, `--surface`, `--input`, `--input-border`, `--popover`, `--popover-foreground`, `--danger`, `--success`, `--warning`, `--neutral`, `--special`, `--secondary`, `--page-foreground`, `--page-overlay` (plus `-hover` and `-foreground` sub-variants for each state color, e.g. `--danger-hover`, `--danger-foreground`) |
| Accent | theme + mode + accent | `--accent`, `--accent-hover`, `--accent-foreground` |
| Background | theme + mode + bg | `--page-bg` |

### CSS Variable Migration

**All** existing CSS variables currently defined in `:root` and `@media (prefers-color-scheme: dark) { :root { ... } }` are migrated into the `[data-theme="modern"][data-mode="light"]` and `[data-theme="modern"][data-mode="dark"]` selectors respectively. The existing light-mode `:root` values become the `[data-mode="light"]` values; the existing dark media query values become the `[data-mode="dark"]` values. No existing variables are dropped — the full set of ~24 variables per mode moves verbatim.

The `:root` block is kept as a fallback with the light-mode defaults (see Fallback Behavior above).

### Selector Structure

```css
/* Structural tokens — theme only */
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

/* Chromatic tokens — theme + mode */
/* All existing :root variables move here */
[data-theme="modern"][data-mode="light"] {
  --panel: rgba(255, 255, 255, 0.8);
  --foreground: #1a1a1a;
  --muted: #6b7280;
  --surface: ...;
  --input: ...;
  --input-border: ...;
  --popover: ...;
  --popover-foreground: ...;
  --danger: ...;
  --success: ...;
  --warning: ...;
  --neutral: ...;
  --special: ...;
  --secondary: ...;
  --page-foreground: ...;
  --page-overlay: ...;
  /* full set from existing :root */
}

/* All existing @media (prefers-color-scheme: dark) variables move here */
[data-theme="modern"][data-mode="dark"] {
  --panel: rgba(30, 30, 30, 0.8);
  --foreground: #f5f5f5;
  --muted: #9ca3af;
  /* full set from existing dark media query */
}

/* Accent tokens — theme + mode + accent */
[data-theme="modern"][data-mode="light"][data-accent="red"] {
  --accent: #ef4444;
  --accent-hover: #dc2626;
  --accent-foreground: #ffffff;
}

[data-theme="modern"][data-mode="dark"][data-accent="red"] {
  --accent: #f87171;
  --accent-hover: #ef4444;
  --accent-foreground: #1a1a1a;
}

/* Background tokens — theme + mode + bg */
[data-theme="modern"][data-mode="light"][data-bg="blue"] {
  --page-bg: #dbeafe;
}

[data-theme="modern"][data-mode="dark"][data-bg="blue"] {
  --page-bg: #1e3a5f;
}
```

### Tailwind Integration

The existing `@theme inline` block is preserved and extended. All existing variable registrations remain. New structural tokens are added:

```css
@theme inline {
  /* All existing @theme inline registrations are preserved verbatim.
     Only new additions are called out below. The full existing set includes
     hover/foreground sub-variants (e.g. --color-danger-hover, --color-danger-foreground)
     for all state colors. */
  --color-panel: var(--panel);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-foreground: var(--accent-foreground);
  --color-danger: var(--danger);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-neutral: var(--neutral);
  --color-special: var(--special);
  --color-secondary: var(--secondary);
  --color-input: var(--input);
  --color-input-border: var(--input-border);
  --color-surface: var(--surface);
  --color-page-foreground: var(--page-foreground);
  --color-page-overlay: var(--page-overlay);
  --color-page-bg: var(--page-bg);

  /* New structural tokens */
  --radius-theme: var(--radius);
  --blur-panel: var(--panel-blur);
  --spacing-panel: var(--spacing-panel);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);
}
```

Enables classes like `bg-panel`, `text-foreground`, `rounded-theme`, `text-accent`, `blur-panel`, `font-body`, `font-mono`.

### Adding a New Theme

Adding "Terminal" later means adding new CSS blocks:

```css
[data-theme="terminal"] {
  --radius: 0;
  --panel-blur: 0;
  --font-body: "Red Hat Mono", monospace;
  /* harsher, no-rounded, monospace aesthetic */
}
```

No JS changes needed.

---

## Component Helpers

**File: `src/components.ts`**

Stateless factory functions that return DOM elements styled with theme CSS variables via Tailwind classes.

### API

```ts
createButton(label: string, variant: "primary" | "outline" | "ghost", opts?: {
  icon?: string       // raw SVG/HTML string, set via innerHTML on a child span
  onClick?: () => void
}): HTMLButtonElement

createPopover(anchor: HTMLElement, content: HTMLElement, opts?: {
  onClose?: () => void
  parentPopover?: HTMLElement  // if set, outside-click won't dismiss the parent
}): { el: HTMLDivElement, close: () => void }

createAccordion(label: string, opts?: {
  defaultOpen?: boolean
  labelClass?: string   // e.g. "text-danger" for the overdue section's red label
}): { container: HTMLElement, content: HTMLElement, toggle: () => void }

createCheckbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement

createInput(opts: {
  type?: string          // "text" (default), "date", etc.
  placeholder?: string
  value?: string
  name?: string
  multiline?: boolean    // if true, creates a <textarea>
  rows?: number          // for textarea, defaults to 3
}): HTMLInputElement | HTMLTextAreaElement
```

### Popover Nesting

`createPopover` returns `{ el, close }` so callers can programmatically dismiss it (e.g., on form save/cancel). The `parentPopover` option scopes outside-click handling: clicks inside the parent popover don't dismiss the child, and clicks outside both dismiss both. The child popover has a higher z-index than the parent.

### Button Variants

| Variant | Styling |
|---------|---------|
| `primary` | `bg-accent text-accent-foreground rounded-theme` |
| `outline` | `border border-accent text-accent bg-transparent rounded-theme` |
| `ghost` | `text-foreground bg-transparent hover:bg-surface rounded-theme` |

### Icon Format

The `icon` option on `createButton` accepts a raw SVG string (matching the existing codebase pattern of inline SVGs). It's rendered into a child `<span>` via `innerHTML`.

### Component Styling

- **Popover:** `bg-popover text-popover-foreground backdrop-blur-[var(--panel-blur)] border rounded-theme shadow-lg`. Uses `--popover`/`--popover-foreground` tokens (not `--panel`) to allow distinct popover vs. panel backgrounds per theme. Manages outside-click dismissal and positioning relative to anchor.
- **Accordion:** Chevron trigger, toggles content visibility. Uses `--foreground`, `--muted` for text.
- **Checkbox:** Styled with `--accent` for checked state, `--input-border` for unchecked.
- **Input:** `bg-input border-input-border rounded-theme text-foreground`.

---

## Todo Widget Rework

### Changes

1. **Use component helpers** — Replace raw `createElement` calls with `createButton`, `createAccordion`, `createCheckbox`, `createPopover`, `createInput`.

2. **Nested popover for edit/create** — Click "Add" or "Edit" → second popover spawns anchored to that button via `createPopover(anchor, formContent, { parentPopover: todoPopover })`. Contains form fields via `createInput` (including `multiline: true` for description). Save/cancel buttons via `createButton`. On save, calls `close()` and resolves with form data. On cancel, calls `close()`.

3. **Remove `#todo-prompt-dialog`** — The `<dialog>` and `todoPrompt()` replaced by nested popover. Form logic moves to a function that creates the nested popover and returns a `Promise<data | null>` (resolved on save/cancel/close).

4. **Visual integration** — All todo elements use theme variables. Accordions, checkboxes, buttons all come from component helpers.

### What Stays the Same

- Data model (`src/todos.ts`) — no changes
- Drag-and-drop behavior
- Badge logic
- Accordion expand/collapse behavior
- Overall layout within the popover

---

## Settings Controls

Three new control groups in the existing `#settings-dialog`:

### Theme Selector
- `<select>` dropdown (only "Modern" for now)
- Wired to `store.sync.get/set("theme")`

### Accent Color
- 3 color buttons (red/green/blue) with `data-setting="accent"` and `data-value="red|green|blue"` attributes
- `aria-pressed` for active state
- Same visual pattern as existing bgColor buttons

### Light/Dark Mode
- 3-option button group: Light, Dark, Auto
- `aria-pressed` on active
- Updates `store.sync.set("mode", ...)`
- JS resolves `auto` → concrete value on `data-mode` attribute

### Existing bgColor Buttons
- Rewired: `data-color` attributes renamed to `data-setting="bg"` and `data-value="red|green|blue"` for consistency
- Instead of setting Tailwind classes on `<body>` via `BG_CLASSES`, now sets `data-bg` on `<html>`
- `applyBgColor()` and `BG_CLASSES` map removed
- CSS variables handle the actual page background

### Wiring (in `src/settings.ts`)
- Read initial values from store → set `aria-pressed`
- Click handlers → `store.sync.set()`
- Subscribe to store changes → update UI (cross-tab sync)
- Mode subscribe → re-evaluate resolved mode on `<html>`

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/defaults.ts` | Add `theme`, `accentColor`, `mode` to `SyncSettings` with defaults. `bgColor` already exists — no change needed there. |
| `src/styles.css` | Migrate all `:root` / `@media (prefers-color-scheme: dark)` variables into `[data-theme][data-mode]` compound selectors. Keep `:root` as fallback. Add structural tokens. Extend `@theme inline` with new tokens. |
| `src/components.ts` | **New file** — `createButton`, `createPopover`, `createAccordion`, `createCheckbox`, `createInput` factory functions. |
| `src/index.ts` | Replace `applyBgColor()` with new synchronous theme boot (set 4 data attributes). Add media query listener for auto mode. Subscribe to all 4 settings keys for live updates. |
| `src/todo.ts` | Refactor to use component helpers. Replace `todoPrompt()` dialog with nested popover form. |
| `src/settings.ts` | Add theme/accent/mode controls. Rewire bgColor buttons (remove `applyBgColor`, `BG_CLASSES`). Wire all new controls bidirectionally with store. |
| `src/index.html` | Add settings UI controls for theme, accent, mode. Rename bgColor button attributes. Remove `#todo-prompt-dialog`. |
