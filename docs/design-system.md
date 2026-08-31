# Design System

Design tokens, the theme cascade, color palettes, corner geometry, typography, and icons.

**Files:** `src/styles.css` (761 lines — the whole visual system), `src/theme.ts` (applies the cascade), `src/squircle.ts` (corner geometry), `src/icons/registry.ts`, `src/icons/modern.ts`, `src/fonts/`.

## How it fits together

```
theme.ts                      styles.css
────────                      ──────────
reads 4 store keys      →     [data-theme][data-mode][data-accent][data-bg]
stamps <html> attrs           selectors define raw CSS custom properties
                                        ↓
                              @theme inline maps them to Tailwind names
                                        ↓
                              utilities: bg-panel, text-foreground, rounded-theme…
                              used directly in index.html and in JS class strings
```

Tailwind v4 syntax throughout — `@import "tailwindcss"`, not v3's `@tailwind` directives. There is no `tailwind.config.js`; the `@theme inline` block at `styles.css:3` *is* the config.

## The theme cascade

Four independent axes, each an attribute on `<html>`, each from one store key:

| Attribute | Store key | Values |
|---|---|---|
| `data-theme` | `theme` | `modern` (the only one that exists) |
| `data-mode` | `mode` | `light` / `dark` — always resolved, never `auto` |
| `data-accent` | `accentColor` | one of the 10 colors — always resolved, never `random` |
| `data-bg` | `bgColor` | one of the 10 colors — always resolved, never `auto` |

`theme.ts` resolves the two indirect values before stamping, so CSS only ever sees concrete colors:

- **`mode: "auto"`** → `matchMedia("(prefers-color-scheme: dark)")` decides, and a `change` listener re-stamps when the OS flips (`theme.ts:20`). The listener is removed and rebuilt whenever `mode` changes, so switching away from `auto` detaches it.
- **`accentColor: "random"`** → one color per calendar day, memoized in `localStorage` under `sp:local:randomAccentDate` / `sp:local:randomAccentColor` (`theme.ts:36`). Same accent all day, new one tomorrow.
- **`bgColor: "auto"`** → follows the resolved accent (`theme.ts:55`). Subscribing to `accentColor` also re-stamps `data-bg` when `bgColor` is `auto`.

`applyTheme()` runs in the module body of `index.ts`, before the first paint. That's the entire anti-flash strategy, and it works because store reads are synchronous — see [storage.md](storage.md).

### Selector specificity

Rules stack from general to specific:

```css
[data-theme="modern"]                                  /* radii, blur, fonts, timing */
[data-theme="modern"][data-mode="light"]               /* the full light palette */
[data-theme="modern"][data-mode="dark"]                /* the full dark palette */
[data-theme="modern"][data-mode="light"][data-accent="teal"]   /* --accent override */
[data-theme="modern"][data-mode="dark"][data-bg="teal"]        /* --page-bg override */
```

`:root` at `styles.css:621` declares a complete fallback palette for when no `data-theme` is set at all. It duplicates the light palette. In practice `theme.ts` always stamps `data-theme`, so this only covers the window before the script runs — but every token it defines has to be kept in sync by hand.

## Tokens

`@theme inline` (`styles.css:3`) maps raw custom properties to Tailwind's namespaces. `inline` means Tailwind emits `var(--panel)` rather than a copy of its value, so the utilities follow the cascade live.

### Colors

Each family is a triplet: base, `-hover`, `-foreground`.

| Family | Utility examples | Meaning |
|---|---|---|
| `accent` | `bg-accent`, `text-accent`, `border-accent` | The user's chosen accent |
| `danger` | `bg-danger`, `text-danger` | Destructive actions, errors |
| `secondary` | `bg-secondary` | Muted button surface |
| `success`, `warning`, `neutral`, `special` | `bg-warning` | Semantic states |

Standalone surface and text tokens:

| Token | Utility | Role |
|---|---|---|
| `--panel` | `bg-panel` | Opaque panel background |
| `--popover` / `--popover-foreground` | `bg-popover` | Popover surface — dark and translucent in *both* modes |
| `--foreground` | `text-foreground` | Primary text |
| `--muted` | `text-muted` | Secondary text |
| `--surface` | `bg-surface` | Hover fills, subtle raised areas |
| `--input` / `--input-border` | `bg-input`, `border-input-border` | Form controls; the border token doubles as the generic hairline |
| `--border` | `border-border` | Applied to `*` in the base layer (`styles.css:751`) |
| `--page-foreground` | `text-page-foreground` | Text over the wallpaper — always white |
| `--page-overlay` | `bg-page-overlay` | Scrims over the wallpaper — always black |
| `--page-bg` | — | The page background color on `html`; also the seed for the mesh gradient |
| `--swatch-*` | `bg-swatch-teal` | The ten palette colors, for settings swatches |
| `--dialog` / `--dialog-border` / `--dialog-blur` | — | Consumed by `.dialog-surface`, not exposed as utilities |
| `--mode-light-*` / `--mode-dark-*` | — | Colors for the light/dark buttons in settings |

`--page-foreground` and `--page-overlay` are deliberately mode-independent: content sitting on top of a photo needs fixed contrast regardless of theme.

### Radii and the corner system

```css
--radius-xs   0.25rem × --corner-reach     → rounded-theme-xs
--radius-sm   0.375rem × --corner-reach    → rounded-theme-sm
--radius      0.5rem × --corner-reach      → rounded-theme
--radius-lg   0.625rem × --corner-reach    → rounded-theme-lg
--radius-xl   0.75rem × --corner-reach     → rounded-theme-xl
--radius-2xl  1rem × --corner-reach        (declared, not mapped)
```

Every radius is scaled by `--corner-reach`, which pairs with `--corner-shape`:

```css
:root                              { --corner-shape: round;    --corner-reach: 1; }
@supports (corner-shape: squircle) { --corner-shape: squircle; --corner-reach: 1.3; }
```

A squircle corner starts further back along the edge than a circular one, so to read as the same size it needs a larger nominal radius — that's the `1.3` multiplier. Browsers without `corner-shape` fall back to plain rounding at unmultiplied radii, and everything still looks right.

`corner-shape` is applied to `*, ::before, ::after` in the base layer. Two escapes:

- `.rounded-full` and `[data-corner="round"]` force `corner-shape: round` — a pill is all corner, and a superellipse just makes it lumpy.
- `@utility corner-squircle` / `@utility corner-round` opt an element in or out explicitly.

### Other tokens

| Token | Utility | Value |
|---|---|---|
| `--panel-blur` | `blur-panel` | `16px` |
| `--spacing-panel` | `p-panel` etc. | `1rem` |
| `--font-body` | `font-body` | Gilroy |
| `--font-mono` | `font-mono` | Red Hat Mono |

`--panel-opacity`, `--border-width`, and `--transition-speed` are declared at `styles.css:322`–`329` but nothing reads them.

## Palettes

Ten colors, each with a light and dark variant, used in three roles.

### Accent (`--accent` / `--accent-hover`)

| Color | Light | Dark |
|---|---|---|
| rose | `#e63e6d` | `#f06292` |
| coral | `#e2603a` | `#f08862` |
| amber | `#c88a14` | `#d4a030` |
| teal | `#0ea396` | `#20b8a6` |
| sky | `#3b82f6` | `#60a5fa` |
| violet | `#8b5cf6` | `#a78bfa` |
| slate | `#64748b` | `#8090a8` |
| stone | `#78716c` | `#908880` |
| zinc | `#71717a` | `#88888f` |
| graphite | `#555566` | `#70708a` |

`--accent-foreground` is `#ffffff` for all twenty combinations.

### Page background (`--page-bg`)

In **light** mode `--page-bg` is the saturated color itself (identical to the light accent). In **dark** mode it's a deep, desaturated tint of it — rose becomes `#2a1520`, sky becomes `#152a4a`. A saturated wallpaper in dark mode would fight everything sitting on it.

When `bgSource` is `color`, this token is no longer painted directly — it is the **seed** the mesh gradient derives its five stops from, and the flat fill that remains visible if WebGL is unavailable. Changing a `--page-bg` value changes the whole mesh. See [backgrounds.md](backgrounds.md#the-mesh-gradient).

### Swatches (`--swatch-*`)

The circles in the settings color pickers. Light-mode swatches match the light accents; dark-mode swatches are pushed brighter than the dark accents (teal is `#5eead4` as a swatch versus `#20b8a6` as an accent) so they stay legible as small dots on a dark panel.

## Component CSS

Most styling lives in Tailwind utility strings, but effects Tailwind can't express — backdrop blur stacks, layered shadows, keyframes — are hand-written classes in `styles.css`, all scoped under `[data-theme="modern"]`.

| Class | Used by | What it is |
|---|---|---|
| `.dock-surface` | `dock.ts` | The dock's glass slab: 20px blur, 180% saturate, layered shadow, inset highlight. Separate light-mode rule swaps to a white translucent fill. |
| `.dock-item`, `.dock-item-glyph`, `.dock-item-name`, `.dock-item-favicon`, `.dock-item-color`, `.dock-item-label` | `dock.ts` | 48px tiles, hover lift, active squash, fixed-position hover label. A `[data-layout="dashboard"]` block re-cuts the same markup into standing labelled circles with no surrounding pill — see [shortcuts.md](shortcuts.md#the-dock). |
| `.dock-suggestion` | `dock.ts` | Fainter fill marking recommendation tiles |
| `.dock-tab-btn` | `dock.ts` | Pill tab selector; forces `corner-shape: round` |
| `.dock-folder-grid`, `.dock-folder-item` | `dock.ts` | 3-column folder popover grid |
| `.widget-card`, `.widget-tile` | `layout.ts` via `createCard()` | The card surface, on the **popover** palette so a body lifted out of a popover needs no restyling. `.widget-tile` is its Dashboard top-row variant: fixed 118px height, intrinsic width. |
| `.card-grid-item` | `card-grid.ts` | Absolute placement plus the transform transition the packer animates |
| `.card-carousel*` | `card-carousel.ts` | The one-at-a-time side region — height-tracking viewport, directional crossfade, hover chevrons, dot indicators |
| `.dash-lower` | `layout.ts` | The Dashboard's two-column lower row, including the `:has()` rule that collapses it to one when the carousel is empty |
| `.settings-button`, `.settings-button-label` | `index.html`, `layout.ts` | Corner icon button everywhere but Dashboard, where it grows a label |
| `.glass-surface` | `components.ts` popovers | 16px blur + shadow + thin scrollbars |
| `.popover-enter` | `components.ts` | 150ms fade/slide-in |
| `.dialog-surface` | `components.ts` `createDialog()` | Dialog glass, plus in/out animations for the dialog and its `::backdrop` |
| `.settings-nav-indicator` | `settings.ts` | The accent bar that slides between nav tabs |
| `.settings-tooltip` | `settings.ts` | Tooltip to the right of a nav icon |
| `.tooltip-below` | `components.ts` `createTooltip()` | Tooltip below its anchor |

Keyframes: `popover-in`, `dialog-in`, `dialog-out`, `dialog-backdrop-in`, `dialog-backdrop-out`.

## Squircles

Two independent implementations, and only one is wired up.

**CSS `corner-shape` (in use).** Native superellipse corners on every element, as described above. Free, works on borders and shadows, no measurement needed.

**`squircle.ts` (not used by anything).** A precise geometric implementation of Apple's continuous corner — the piecewise-cubic Bézier fit from Figma's "Desperately seeking squircles". Not a superellipse: each corner is a Bézier ramping curvature up, a shortened circular arc through the apex, and a mirrored Bézier ramping back down. `smoothing` controls how much of the corner goes to the ramps; `APPLE_SMOOTHING` is `0.9`.

```ts
squirclePath({ width, height, radius, smoothing?, x?, y? }): string   // SVG path data
cornerReach(radius, smoothing?): number                              // (1 + smoothing) × radius
squircleDataUri(params & { fill? }): string                          // url("data:image/svg+xml,…")
applySquircle(el, { radius, smoothing? }): () => void                // clip-path, re-cut on resize
```

Reach for it only where CSS can't go — SVG, canvas, `mask-image`. `applySquircle()` sets `clip-path`, which halves any border it cuts through and clips the element's own shadow, so it suits pure-fill elements only. See the header comment at `squircle.ts:1` for the full derivation.

## Typography

| Family | Weights | Format | Loaded from |
|---|---|---|---|
| Gilroy | 300, 400, 500, 700, 900 | `.woff` | `src/fonts/gilroy/` |
| Red Hat Mono | 300, 400, 500, 600, 700 | `.ttf` | `src/fonts/red-hat-mono/` |

`@font-face` declarations at `styles.css:680`. `body` gets `font-family: var(--font-body)` in the base layer. Red Hat Mono is available as `font-mono` but barely used.

`index.html:10` *also* pulls Red Hat Mono from Google Fonts over the network — redundant with the bundled files, and a per-new-tab remote request. Drop it.

## Icons

A theme-keyed registry, so swapping `theme` swaps every icon on the page live.

```ts
import { icon, getIconSvg } from "./icons/registry"

const el = icon("settings", { size: 24 })    // → <span data-icon="settings">…</span>
const raw = getIconSvg("check")              // → the SVG source string
```

**`icon(name, opts?)`** returns a `<span data-icon="name">` containing the SVG, and subscribes it to the `theme` store key — when the theme changes, the span re-renders from the new theme's map. `opts.size` rewrites the SVG's `width`/`height`; `opts.class` appends classes to the span.

**`getIconSvg(name)`** returns the raw SVG string for the current theme, for cases where you're building `innerHTML` yourself. It returns `""` for animated (function-valued) entries.

**Lifecycle.** Each `icon()` span holds a store subscription. A single `MutationObserver` on `document.body` (`registry.ts:27`) watches for removed nodes and unsubscribes any `[data-icon]` element that leaves the DOM, itself or nested. That's what keeps a page full of rebuilt popovers from leaking subscriptions.

**Adding an icon.** Add the entry to the `icons` object in `icons/modern.ts` and it's immediately available by name. The value is either an SVG string, or an `AnimatedIconFactory` — `(span, opts) => void` — that populates the span itself for anything that needs to animate or hold state. No factories exist yet; every current entry is a static string.

**Adding a theme.** Call `registerTheme(name, map)` from a new module, import it for side effect in `index.ts`, and add the name to the `theme` union in `defaults.ts`. There's no fallback: if the active theme's map lacks a name, `icon()` renders an empty span silently (`registry.ts:71`).

The `modern` set has 61 icons: UI chrome (settings, close, check, chevrons, plus, edit, trash, alertTriangle), settings-nav tabs (`tab*`), mode toggles (`mode*`), media controls (play, pause, skip*), weather conditions (`wx*` — clear, clearNight, partly, partlyNight, cloudy, fog, drizzle, rain, sleet, snow, thunder, unknown), and feature icons (calendar, folder, globe, link, sparkle, spinner, locationOff, bgImage, bgUpload, todoList, todoEmpty, dragHandle, externalLink, refresh), plus the todo widget's
row of actions (moreVertical, pin, pinFilled, repeat, archive, archiveRestore,
checkCircle, subtasks, flag).

The `wx*` set is mapped from WMO weather codes in `weather.ts`; codes 0–2 have a night variant picked by the API's `is_day` flag.

## Refactor candidates

- **Four palettes maintained by hand.** Every color exists in the light block, the dark block, the `:root` fallback, and (for the ten) the accent/bg/swatch tables — around 90 lines of near-duplicate hex. Nothing checks that they agree. Generating the accent/bg/swatch rules from one source, or deriving dark from light programmatically, would remove a whole class of drift.
- **`--special`, `--neutral`, `--success` are dead.** All three triplets are declared in three places each and mapped into `@theme`, and no utility referencing them appears anywhere in `src/`. `warning` is used exactly twice (`shortcut-drag.ts`), `secondary` three times.
- **The `:root` fallback duplicates the light palette** with no mechanism keeping them in sync. Since `theme.ts` stamps `data-theme` before paint, it's arguably unnecessary — or it should be the single definition that `[data-mode="light"]` inherits from.
- **`--radius-2xl` is declared but never mapped into `@theme`**, so no `rounded-theme-2xl` utility exists. Either map it or drop it.
- **Three unread tokens:** `--panel-opacity`, `--border-width`, `--transition-speed`.
- **`.dock-item:hover` sets `background` twice** (`styles.css:147`) — a `var(--page-foreground, …)` line immediately overridden by a literal `rgba`. The first declaration does nothing.
- **`squircle.ts` has no call sites.** Decide whether the geometric path is needed anywhere; if not, delete it rather than leaving a second, divergent definition of the app's corner shape.
- **Icon sizing is imperative.** `opts.size` rewrites SVG attributes after render instead of the SVGs carrying `width="100%"` and taking their size from CSS, which is why every call site has to pass a pixel number.
