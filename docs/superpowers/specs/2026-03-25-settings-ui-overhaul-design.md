# Settings UI Overhaul — Design Spec

## Overview

Rebuild the settings dialog content for three tabs (General, Appearance, Widgets), add new reusable components, animate the accordion, and reorganize settings between tabs. All work must integrate with the dynamic appearance system so future themes can restyle everything via CSS tokens.

## Tab Reorganization

### Moves

- **Search settings** move from General tab into a new "Search" accordion on the Widgets tab
- **Recommendations settings** move from Widgets tab into the Shortcuts tab (recommendations is a shortcuts feature). Only the enable checkbox moves — the current HTML has just a single checkbox+label inside that accordion.

### Final tab contents

| Tab | Contents |
|-----|----------|
| General | Clock settings only |
| Shortcuts | Existing shortcut management + Recommendations toggle (unchanged scope — not being rebuilt) |
| Appearance | Theme select, accent color swatches, background color swatches, mode selector |
| Widgets | Accordions: Search, Todo, Weather, Spotify, Google Calendar |
| Advanced | Empty (unchanged) |

## New & Updated Components (src/components.ts)

### Button — new variants

Extend `ButtonVariant` union type to: `"primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override"`.

Add entries to the `BUTTON_CLASSES` record:

- **`destructive`** — `"bg-danger text-danger-foreground hover:bg-danger-hover"`
- **`destructive-outline`** — `"border border-danger text-danger bg-transparent hover:bg-danger/10"`
- **`override`** — `""` (empty string — no color/hover classes)

The `override` variant only gets the shared base classes (sizing, rounding, layout, font). Consumer applies all visual styling afterward by modifying `btn.className` or `btn.style` on the returned element.

Add an optional `className` property to the `opts` parameter of `createButton`. When provided, it is appended to the button's class list after the base + variant classes. This lets callers add custom styles without reaching into the element after creation.

### Select (`createSelect`)

New factory function:

```ts
createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string
  name?: string
  onChange?: (value: string) => void
}): HTMLSelectElement
```

Styling: `bg-input border-input-border rounded-theme text-sm text-foreground` — matches `createInput`. Returns a styled `<select>` with `<option>` children populated from the options array.

### Accordion animation

Replace the current `content.hidden` toggle with animated expand/collapse:

**Opening (200ms):**
1. Set `overflow: hidden`, remove `hidden` attribute
2. Measure `scrollHeight` of content
3. Animate `height` from `0` to `scrollHeight` using `ease-out`
4. Simultaneously animate content `opacity` from `0` to `1`
5. On finish: clear inline height, remove `overflow: hidden`

**Closing (150ms):**
1. Set `overflow: hidden`, capture current `offsetHeight`
2. Animate `height` from current to `0` using `ease-in`
3. Simultaneously animate content `opacity` from `1` to `0`
4. On finish: set `hidden` attribute, clear inline styles

**Padding fix:** Add top padding to accordion content matching the existing bottom padding (`pb-4` → `py-4` for settings variant, keeping `px-6`).

**Guard:** If an animation is already in progress, cancel it before starting a new one to prevent glitches from rapid clicking.

## Store Wiring Pattern

All programmatically built controls follow a bidirectional sync pattern (same as the existing `settings.ts` code):

1. **Read** initial value from store: `store.sync.get(key)`
2. **Write** on user interaction: control's onChange/change event calls `store.sync.set(key, value)`
3. **Subscribe** for external updates: `store.sync.subscribe(key, callback)` updates the control when the value changes from another tab or sync

Since all controls are now created programmatically, there are no `getElementById` calls for the rebuilt tabs. Instead, the builder functions hold direct references to the elements they create.

### Store key mappings for new controls

| Control | Store Key | Namespace |
|---------|-----------|-----------|
| Accent color swatches | `accentColor` | sync |
| Background color swatches | `bgColor` | sync |
| Mode selector buttons | `mode` | sync |
| Theme select | `theme` | sync |

All other controls (clock, search, widget toggles) retain their existing store keys as defined in `defaults.ts`.

## General Tab

### Layout

No section headers — the tab title "General" is sufficient since this only contains clock settings.

A vertical list of setting rows with ~12-16px gap. Each row uses **label-left, control-right** pattern: a flex row with `justify-between items-center`, label text on the left, control on the right.

Rows separated by subtle borders. Use `border-bottom: 1px solid` with `border-input-border/10` on each row except the last. When rows are conditionally hidden (AM/PM, date format), the border logic must account for this — apply borders via a CSS class and let the hidden attribute naturally skip the border. Alternatively, use a wrapper with `divide-y divide-input-border/10` and ensure hidden rows use `display: none` (which `hidden` attribute provides) so they don't produce extra dividers.

### Rows

| Label | Control | Notes |
|-------|---------|-------|
| Show clock | Checkbox | |
| Show seconds | Checkbox | |
| 24-hour format | Checkbox | |
| Show AM/PM | Checkbox | Hidden when 24h is on |
| Show date | Checkbox | |
| Date format | Select (long/short/abbr/numeric/numericShort) | Hidden when show date is off |
| Size | Select (small/medium/large) | |

All checkboxes use `createCheckbox` with an empty string `""` for the label parameter (label-less, since the row provides the label text). All selects use `createSelect`.

### Build approach

Remove the clock fieldset HTML from `index.html`. The `general` tab panel becomes an empty `<div>`. All rows are built programmatically in `settings.ts`.

## Appearance Tab

Three visually distinct sections, each with a small muted label (`text-muted text-xs font-medium`).

### Theme section

Label-left, select-right row. Single `createSelect` with "Modern" as the only option for now.

### Accent Color / Background Color sections

Each section shows a horizontal row of **24px circular swatch buttons**.

**Swatch color values:** Define new per-color CSS custom properties in `styles.css` for each theme/mode combo so swatches can reference them without hardcoding hex in JS:

```css
[data-theme="modern"][data-mode="light"] {
  --swatch-red: #ef4444;
  --swatch-green: #22c55e;
  --swatch-blue: #3b82f6;
}
[data-theme="modern"][data-mode="dark"] {
  --swatch-red: #f87171;
  --swatch-green: #4ade80;
  --swatch-blue: #60a5fa;
}
```

The exhaustive list of swatch colors is: **red, green, blue** — matching the current `accentColor` and `bgColor` types in `defaults.ts`. Both accent and background swatches use the same color set.

Register these in `@theme inline` as `--color-swatch-red: var(--swatch-red)` etc. so they're available as Tailwind utilities (`bg-swatch-red`).

**Swatch rendering:** Each swatch is a `<button>` element:
- `width: 24px`, `height: 24px`, `border-radius: 50%`
- Background set via Tailwind class using the swatch token (e.g., `bg-swatch-red`). These automatically respond to mode changes.
- Cursor pointer, `transition: box-shadow 150ms, transform 150ms`

**Selected state:**
- Ring using `outline`: `outline: 2px solid; outline-offset: 2px; outline-color` set to the swatch's own CSS variable. This creates a 2px ring with a 2px gap from the circle.
- Small white checkmark SVG (centered, ~12px) rendered inside:
  ```html
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
  ```

**Unselected state:**
- Just the filled circle, no outline, no checkmark
- Subtle scale on hover (`transform: scale(1.1)`)

### Mode section

Three equal-width buttons in a row using the **override** button variant. All three share a container with `display: flex; gap: 8px`.

**Each button contains:** An icon (SVG, ~16px) and a label ("Light", "Dark", "Auto").

**SVG icons:**

Sun (Light):
```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
```

Moon (Dark):
```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
```

Monitor (Auto):
```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
```

**Selected states:**

| Mode | Background | Text | Icon |
|------|-----------|------|------|
| Light | Warm cream/amber tint (e.g., `#fef3c7` light / `#451a03` dark) | Warm text (e.g., `#92400e` light / `#fbbf24` dark) | Sun SVG |
| Dark | Deep night (e.g., `#1e1b4b` light / `#0f0a2e` dark) | Cool light (e.g., `#c7d2fe` light / `#a5b4fc` dark) | Moon SVG |
| Auto | `bg-accent` | `text-accent-foreground` | Monitor SVG |

**Unselected state:** All three use outline styling — `border: 1px solid var(--accent)`, `color: var(--accent)`, `background: transparent`. Icon and label shown in accent color.

Selected mode colors are **hardcoded per-theme in CSS** as new custom properties since they represent each mode's identity, not the current theme state:

```css
[data-theme="modern"][data-mode="light"] {
  --mode-light-bg: #fef3c7;
  --mode-light-fg: #92400e;
  --mode-dark-bg: #1e1b4b;
  --mode-dark-fg: #c7d2fe;
}
[data-theme="modern"][data-mode="dark"] {
  --mode-light-bg: #451a03;
  --mode-light-fg: #fbbf24;
  --mode-dark-bg: #0f0a2e;
  --mode-dark-fg: #a5b4fc;
}
```

The Auto button uses `var(--accent)` / `var(--accent-foreground)` which are already theme-reactive.

### Build approach

Remove all appearance fieldset HTML from `index.html`. The panel becomes empty. Everything built in `settings.ts`.

## Widgets Tab

A vertical list of accordions using the `settings` variant with animated expand/collapse. All accordions start **collapsed** by default.

### Accordion order

1. Search
2. Todo
3. Weather
4. Spotify
5. Google Calendar

### Inside each accordion

Default layout is label-left/control-right rows (same as General tab), with pragmatic exceptions.

**Search:**
- "Search Engine" — label left, `createSelect` right (Google/Bing/Yahoo/DuckDuckGo/Ecosia/Qwant/Startpage)
- "Debounce shortcut search" — label left, checkbox right

**Todo:**
- "Enable todo widget" — label left, checkbox right
- "Show badges" — label left, checkbox right
- "Clear all todos" — `destructive` button, **right-aligned** (it's a destructive action)

**Weather:**
- "Enable weather" — label left, checkbox right
- "Temperature unit" — label left, `createSelect` right (Fahrenheit/Celsius)
- "Grant location access" — `primary` button, **left-aligned** (it's a setup action, not destructive)
- Location help text appears conditionally below the button

**Spotify:**
- "Enable Spotify widget" — label left, checkbox right
- Connect state: **Spotify branded button**, left-aligned. Built with raw DOM (not `createButton`) since it needs fully custom brand styling:
  - `<button>` with `inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors`
  - Background: `#1DB954`, hover: `#1aa34a`, text: white
  - Left side: `<div>` 16x16 with `background: #1ed760; border-radius: 2px` (icon placeholder)
  - Label span: "Connect Spotify"
- Connected state: `createButton("Disconnect", "destructive-outline")`

**Google Calendar:**
- "Enable Google Calendar" — label left, checkbox right
- Connect state: **Google branded button**, left-aligned. Built with raw DOM (same approach as Spotify):
  - `<button>` with `inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors`
  - Background: `#ffffff`, hover: `#f8f9fa`, text: `#3c4043`, border: `1px solid #dadce0`
  - Left side: `<div>` 16x16 with `background: #4285F4; border-radius: 2px` (icon placeholder)
  - Label span: "Sign in with Google"
- Connected state: `createButton("Disconnect", "destructive-outline")`

### Build approach

Remove all widget section HTML from `index.html`. The panel becomes empty. `buildWidgetAccordions()` is replaced — instead of reading `data-widget-section` attributes from HTML, it programmatically creates each accordion and populates its content.

## Tab Title Animation

The `#settings-title` element transitions with the same crossfade as the panel content in `switchTab`.

Replace the current synchronous `title.textContent = TABS[index].label` (line 129 in settings.ts) with an animated sequence that runs in parallel with the panel transition:

1. Fade out current title over **50ms** (`ease-in`) using `element.animate()`
2. After **25ms** (setTimeout), **cancel the fade-out animation**, update `textContent` to the new tab label, and start fade in over **50ms** (`ease-out`)
3. On finish of fade-in: cancel the fade-in animation, clear opacity

The cancel-then-update at 25ms ensures no visual jump — the old text is nearly invisible (~50% through fade-out) when the content swaps and the fade-in begins.

## HTML Changes Summary

The `index.html` settings panels for General, Appearance, and Widgets become empty containers. The builder functions add their own padding and layout classes to the content they create, so the panels only need the `settings-panel` class. The general panel does **not** have `hidden` since it's the default active tab:

```html
<div data-settings-tab="general" class="settings-panel"></div>
<div data-settings-tab="appearance" class="settings-panel" hidden></div>
<div data-settings-tab="widgets" class="settings-panel" hidden></div>
```

Shortcuts and Advanced tabs remain unchanged in HTML.

Recommendations checkbox is added to the shortcuts tab panel HTML as a simple checkbox+label row at the bottom, matching the existing shortcuts HTML style. It stays as static HTML since the shortcuts tab is not being rebuilt programmatically.

## CSS Changes Summary

### New custom properties (in styles.css)

Mode selector identity colors, scoped per theme and mode:

```
--mode-light-bg, --mode-light-fg
--mode-dark-bg, --mode-dark-fg
```

Defined in `[data-theme="modern"][data-mode="light"]` and `[data-theme="modern"][data-mode="dark"]` blocks.

### New styles

- Color swatch button base styles and selected ring/checkmark
- Mode selector button selected states

All new styles scoped under `[data-theme="modern"]` so future themes can override.

## Files Modified

| File | Changes |
|------|---------|
| `src/components.ts` | Add `destructive`, `destructive-outline`, `override` button variants. Add `createSelect`. Animate accordion expand/collapse. Fix accordion content top padding. |
| `src/settings.ts` | Rebuild General/Appearance/Widgets tab content programmatically. Move search wiring to widgets. Move recommendations to shortcuts. Add tab title crossfade (replace synchronous textContent update). Build mode selector, color swatches, branded buttons. Remove `wireButtonGroup` function (replaced by programmatic swatch/mode builders). |
| `src/index.html` | Empty out General/Appearance/Widgets panels. Move recommendations checkbox to shortcuts. Remove search fieldset from general. |
| `src/styles.css` | Add mode selector identity color tokens. Add swatch/mode-button styles scoped to modern theme. |
