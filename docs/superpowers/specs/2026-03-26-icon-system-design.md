# Icon System Design

## Overview

A theme-reactive icon system for the startpage extension. Each call to `icon("name")` returns a self-managing DOM element that automatically swaps its SVG when the user changes themes. Supports both static SVG icons and fully custom animated icons through a unified API.

## Goals

- Zero-latency icon rendering on new tab page load (synchronous, no network requests)
- Automatic theme reactivity — icons swap themselves when the theme changes
- Unified API for static and animated icons
- Type-safe icon names enforced at compile time
- Automatic subscription cleanup when icons are removed from the DOM

## File Structure

```
src/
  icons/
    registry.ts          — icon() factory, theme subscription, types
    modern.ts            — modern theme icon map (~40 SVG strings + animated factories)
    animated/
      checkbox.ts        — animated checkbox (state transitions)
      accordion.ts       — animated chevron (rotation)
      ...                — other animated icons as needed
```

Future themes add a new file (e.g. `terminal.ts`) exporting the same icon keys with different SVGs. Future shortcut icon library (~200 icons) will be a separate dynamically-imported module.

## Types

```ts
type IconOptions = {
  size?: number
  class?: string
}

type AnimatedIconFactory = (opts?: IconOptions) => HTMLSpanElement

type IconThemeMap = Record<string, string | AnimatedIconFactory>

// Derived from the modern map's keys — the canonical icon set
type IconName = keyof typeof modern

// Enforces every theme exports every icon
type ThemeRegistry = {
  [T in ThemeName]: { [K in IconName]: string | AnimatedIconFactory }
}

// Attached to animated icon elements
interface AnimatedIcon extends HTMLSpanElement {
  setState?: (value: boolean) => void
  hover?: () => void
  idle?: () => void
}
```

`ThemeName` is sourced from the `theme` union in `defaults.ts`. Adding a theme without all icons, or adding an icon to one theme but not another, is a compile error.

Animated icon methods are optional since not every animated icon needs every method.

## API

### `icon(name, opts?)`

```ts
import { icon } from "./icons/registry"

const el = icon("settings")
const el = icon("settings", { size: 20 })
const el = icon("settings", { class: "text-muted" })
```

Returns an `HTMLSpanElement` with:
- `data-icon` attribute set to the icon name
- innerHTML set to the active theme's SVG for that name
- A store subscription that swaps innerHTML on theme change

For animated icons, the returned element has additional methods:

```ts
const el = icon("checkbox") as AnimatedIcon
el.setState(true)   // animate to checked
el.setState(false)  // animate to unchecked
```

Consumers don't need to know whether an icon is static or animated. The same `icon()` call works for both. Cast or check when animated methods are needed.

### Theme Icon Modules

Each theme module exports a flat map:

```ts
// icons/modern.ts
import { animatedCheckbox } from "./animated/checkbox"

export const modern = {
  settings: `<svg>...</svg>`,
  close: `<svg>...</svg>`,
  todo: `<svg>...</svg>`,
  check: `<svg>...</svg>`,
  chevron: `<svg>...</svg>`,
  // ~40 entries total
  checkbox: animatedCheckbox,
}
```

Static icons are raw SVG strings. Animated icons are factory functions. The registry distinguishes them by type at runtime.

The `modern` export uses `satisfies ThemeRegistry["modern"]` (or equivalent) so that `IconName` is inferred from its keys while still enforcing that all values are `string | AnimatedIconFactory`. Future theme modules are typed as `ThemeRegistry[ThemeName]` to enforce key parity at compile time.

## Subscription & Cleanup

### Theme Reactivity

Each icon element registers a subscription via `store.sync.subscribe("theme", callback)`. When the theme changes:
- Static icons: innerHTML is swapped to the new theme's SVG string
- Animated icons: the entire element's content is rebuilt by calling the new theme's factory

Theme switches are rare (user action), so rebuilding animated icons is acceptable.

### Automatic Cleanup

A single `MutationObserver` on `document.body` watches for `childList` removals with `subtree: true`. When a removed node (or descendant) has a `data-icon` attribute, the stored unsubscribe function is called.

Bookkeeping: a `WeakMap<HTMLElement, () => void>` maps icon elements to their unsubscribe functions.

Why not custom elements: custom elements require registration, add complexity, and `disconnectedCallback` fires on temporary reparenting. The MutationObserver approach is simpler and matches the project's vanilla DOM patterns.

## Animated Icons

Animated icon factories live in `icons/animated/` as individual modules. Each exports a function conforming to `AnimatedIconFactory`.

### Animation Techniques

- **stroke-dashoffset** for draw/erase effects (checkmarks, X marks)
- **CSS transforms** for rotation (chevron open/close) and scale (hover feedback)
- **CSS transitions** for all motion — JS toggles classes/attributes, CSS handles the animation. Zero JS per frame.
- **`will-change`** on animated properties for compositor-layer promotion

### Animated Icon Contract

- Factories must be synchronous (no async setup)
- Return an `HTMLSpanElement` with SVG content and methods attached directly to the element
- Methods are the animation triggers (`setState`, `hover`, `idle`)

### Priority

1. State transitions (checkbox check/uncheck, accordion open/close)
2. Interaction feedback (hover effects, click responses)
3. Ambient/decorative (future — looping animations)

## Integration with Existing Code

### Migration

All scattered inline SVGs are consolidated into theme modules:

| Current Location | Current Pattern | New Pattern |
|---|---|---|
| `index.html` inline SVGs | `<svg>` in markup | Empty container, populated by `icon()` in JS init |
| `settings.ts` SVG strings | Template literal constants | `icon("tabGeneral")`, `icon("modeDark")`, etc. |
| `components.ts` `CHECK_SVG`, `CHEVRON_SVG` | String constants | `icon("check")`, `icon("chevron")` |
| `components.ts` accordion chevron | Unicode `\u25BC` | `icon("chevron")` or animated chevron |

### `createButton` Change

The `icon` option changes from accepting a raw SVG string to accepting an `HTMLElement`:

```ts
// Before
createButton("Save", "primary", { icon: `<svg>...</svg>` })

// After
createButton("Save", "primary", { icon: icon("check") })
```

Implementation: `appendChild` instead of `innerHTML` for the icon slot.

### No Flash on Load

`applyTheme()` runs synchronously before first paint. `icon()` reads the theme synchronously. Icons are populated during the same synchronous init pass — no flash of missing icons.

## Bundle & Performance

### Core Icons (~40) — Eagerly Bundled

All theme modules are statically imported by `registry.ts`. esbuild inlines them into the single `index.js`.

Size estimate: ~500 bytes per SVG x 40 icons x 2 themes = ~40KB raw, ~8-10KB gzipped. Comparable to a small font file.

### Future Shortcut Library (~200) — Lazy Loaded

Not part of this implementation. The architecture supports it via dynamic import (`import("./icons/shortcut-library")`) code-split by esbuild, loaded only when the shortcut icon picker opens.

### Critical Render Path

1. Browser loads `index.js` (contains all core icon SVGs as strings)
2. `applyTheme()` sets `data-theme` on `<html>` — synchronous
3. `icon("settings")` reads theme, picks SVG string, creates `<span>`, sets innerHTML — synchronous
4. Element appended to DOM
5. Store subscriptions registered (40 lightweight function references)
6. MutationObserver started (single observer, can defer to idle)

No network requests for icons. No async. No layout shifts.

### Overhead vs Current Approach

Current inline SVGs are already in the HTML/JS bundle — same cost. The new system adds ~40 subscription function references and one MutationObserver. Both negligible.
