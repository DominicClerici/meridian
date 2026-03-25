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

Four new keys in `SyncSettings`:

```ts
theme: "modern"                          // extensible to "terminal", etc.
accentColor: "red" | "green" | "blue"    // highlight/action color
bgColor: "red" | "green" | "blue"       // page background color
mode: "light" | "dark" | "auto"         // color mode
```

Stored via `store.sync` — syncs across devices, ~100 bytes total.

### Data Attributes

Four `data-*` attributes on `<html>`:

```html
<html data-theme="modern" data-accent="blue" data-bg="blue" data-mode="dark">
```

For `mode: "auto"`, JS resolves to the concrete value via `matchMedia("(prefers-color-scheme: dark)")` and sets `data-mode` to the resolved `"light"` or `"dark"`. A media query listener updates it live.

### Boot Sequence

Synchronous, before first paint (in `src/index.ts`, top-level):

1. Read `theme`, `accentColor`, `bgColor`, `mode` from store cache (instant — seeded from localStorage)
2. Set all 4 `data-*` attributes on `document.documentElement`
3. For `mode: "auto"`, resolve via `matchMedia` and set resolved value
4. Register media query change listener for auto mode

This happens before DOMContentLoaded. CSS variables are resolved by the browser in one style recalc from the pre-defined `data-*` selectors.

---

## CSS Theme Definitions

All theme values defined in `src/styles.css` via compound `data-*` selectors.

### Token Categories

| Category | Depends On | Examples |
|----------|-----------|---------|
| Structural | theme only | `--radius`, `--panel-blur`, `--panel-opacity`, `--font-body`, `--font-mono`, `--spacing-panel`, `--border-width`, `--transition-speed` |
| Chromatic | theme + mode | `--panel`, `--foreground`, `--muted`, `--surface`, `--input`, `--input-border` |
| Accent | theme + mode + accent | `--accent`, `--accent-hover`, `--accent-foreground` |
| Background | theme + mode + bg | `--page-bg` |

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
[data-theme="modern"][data-mode="light"] {
  --panel: rgba(255, 255, 255, 0.8);
  --foreground: #1a1a1a;
  --muted: #6b7280;
}

[data-theme="modern"][data-mode="dark"] {
  --panel: rgba(30, 30, 30, 0.8);
  --foreground: #f5f5f5;
  --muted: #9ca3af;
}

/* Accent tokens — theme + mode + accent */
[data-theme="modern"][data-mode="light"][data-accent="red"] {
  --accent: #ef4444;
  --accent-hover: #dc2626;
  --accent-foreground: #ffffff;
}

/* Background tokens — theme + mode + bg */
[data-theme="modern"][data-mode="dark"][data-bg="blue"] {
  --page-bg: #1e3a5f;
}
```

### Tailwind Integration

Register CSS variables in `@theme inline` so they're usable as Tailwind utilities:

```css
@theme inline {
  --color-panel: var(--panel);
  --color-foreground: var(--foreground);
  --color-accent: var(--accent);
  --radius-theme: var(--radius);
  /* etc. */
}
```

Enables classes like `bg-panel`, `text-foreground`, `rounded-theme`, `text-accent`.

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
  icon?: string
  onClick?: () => void
}): HTMLButtonElement

createPopover(anchor: HTMLElement, content: HTMLElement): HTMLDivElement

createAccordion(label: string, opts?: {
  defaultOpen?: boolean
  labelClass?: string
}): { container: HTMLElement, content: HTMLElement, toggle: () => void }

createCheckbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement

createInput(opts: {
  type?: string
  placeholder?: string
  value?: string
  name?: string
}): HTMLInputElement | HTMLTextAreaElement
```

### Button Variants

| Variant | Styling |
|---------|---------|
| `primary` | `bg-accent text-accent-foreground rounded-theme` |
| `outline` | `border border-accent text-accent bg-transparent rounded-theme` |
| `ghost` | `text-foreground bg-transparent hover:bg-surface rounded-theme` |

### Component Styling

- **Popover:** `bg-panel backdrop-blur-[var(--panel-blur)] border rounded-theme shadow-lg`. Manages outside-click dismissal and positioning relative to anchor.
- **Accordion:** Chevron trigger, toggles content visibility. Uses `--foreground`, `--muted` for text.
- **Checkbox:** Styled with `--accent` for checked state, `--input-border` for unchecked.
- **Input:** `bg-input border-input-border rounded-theme text-foreground`.

---

## Todo Widget Rework

### Changes

1. **Use component helpers** — Replace raw `createElement` calls with `createButton`, `createAccordion`, `createCheckbox`, `createPopover`, `createInput`.

2. **Nested popover for edit/create** — Click "Add" or "Edit" → second popover spawns anchored to that button. Contains form fields via `createInput`, save/cancel via `createButton`. Main todo popover stays open underneath.

3. **Remove `#todo-prompt-dialog`** — The `<dialog>` and `todoPrompt()` replaced by nested popover. Form logic (collect fields, return data or null) moves to a function managing the nested popover.

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
- 3 color buttons (red/green/blue) with `data-accent` attributes
- `aria-pressed` for active state
- Same pattern as existing bgColor buttons

### Light/Dark Mode
- 3-option button group: Light, Dark, Auto
- `aria-pressed` on active
- Updates `store.sync.set("mode", ...)`
- JS resolves `auto` → concrete value on `data-mode` attribute

### Existing bgColor Buttons
- Rewired: instead of setting Tailwind classes on `<body>`, sets `data-bg` on `<html>`
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
| `src/defaults.ts` | Add `theme`, `accentColor`, `bgColor` (rename from existing), `mode` to `SyncSettings` + defaults |
| `src/styles.css` | Add theme CSS variable definitions, Tailwind theme integration, remove hardcoded color scheme media queries |
| `src/components.ts` | **New file** — component factory functions |
| `src/index.ts` | Synchronous theme boot, media query listener for auto mode |
| `src/todo.ts` | Refactor to use component helpers, replace dialog with nested popover |
| `src/settings.ts` | Add theme/accent/mode controls, rewire bgColor |
| `src/index.html` | Add settings UI controls, remove `#todo-prompt-dialog` |
