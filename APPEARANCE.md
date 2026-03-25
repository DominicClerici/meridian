# Appearance System

The appearance system controls all visual styling through four user-configurable axes: **theme**, **accent color**, **background color**, and **color mode**. Changing any setting instantly updates the entire UI with zero page reload.

## How It Works

Four `data-*` attributes on `<html>` drive all styling:

```html
<html data-theme="modern" data-accent="blue" data-bg="blue" data-mode="dark">
```

CSS custom properties are defined in compound selectors that match these attributes. When a setting changes, JS updates the attribute and the browser resolves new variable values in a single style recalc.

### Boot Sequence

Theme is applied **synchronously before first paint** to prevent any flash:

1. `src/index.ts` calls `applyTheme()` at the top level (before DOMContentLoaded)
2. `applyTheme()` reads all 4 settings from the store cache (instant — seeded from localStorage)
3. Sets all 4 `data-*` attributes on `<html>`
4. For `mode: "auto"`, resolves via `matchMedia` and registers a listener

`subscribeTheme()` is called immediately after to handle live changes from settings or cross-tab sync.

### Store Keys

Only 4 short strings are stored in `browser.storage.sync`:

| Store Key | Type | Default | HTML Attribute |
|-----------|------|---------|----------------|
| `theme` | `"modern"` | `"modern"` | `data-theme` |
| `accentColor` | `"red" \| "green" \| "blue"` | `"blue"` | `data-accent` |
| `bgColor` | `"red" \| "green" \| "blue"` | `"blue"` | `data-bg` |
| `mode` | `"light" \| "dark" \| "auto"` | `"auto"` | `data-mode` |

Add new options by extending the union type in `src/defaults.ts` and adding corresponding CSS selectors.

## CSS Architecture

All theme values live in `src/styles.css`. The structure:

```
@theme inline { ... }          ← Tailwind token registration
[data-theme="modern"] { ... }  ← Structural tokens (radius, blur, fonts, spacing)
[data-theme="modern"][data-mode="light"] { ... }  ← Light chromatic tokens
[data-theme="modern"][data-mode="dark"] { ... }   ← Dark chromatic tokens
[data-theme="modern"][data-mode="..."][data-accent="..."] { ... }  ← Accent overrides
[data-theme="modern"][data-mode="..."][data-bg="..."] { ... }      ← Page bg overrides
:root { ... }                  ← Fallback defaults
```

### Token Categories

| Category | Selector Depends On | What It Controls |
|----------|-------------------|-----------------|
| **Structural** | theme only | `--radius`, `--panel-blur`, `--panel-opacity`, `--font-body`, `--font-mono`, `--spacing-panel`, `--border-width`, `--transition-speed` |
| **Chromatic** | theme + mode | `--panel`, `--popover`, `--foreground`, `--muted`, `--surface`, `--input`, `--input-border`, `--danger`, `--success`, `--warning`, `--neutral`, `--special`, `--secondary` (each with `-hover` and `-foreground` sub-variants), `--page-foreground`, `--page-overlay` |
| **Accent** | theme + mode + accent | `--accent`, `--accent-hover`, `--accent-foreground` |
| **Background** | theme + mode + bg | `--page-bg` |

### Tailwind Utilities

All tokens are registered in `@theme inline` and usable as Tailwind classes:

```
bg-panel          text-foreground       border-input-border
bg-popover        text-popover-foreground  bg-accent
bg-surface        text-muted            text-accent-foreground
bg-input          text-danger           rounded-theme
bg-page-bg        text-accent           blur-panel
```

## Component Helpers

`src/components.ts` provides factory functions that return styled DOM elements. All components consume theme tokens via Tailwind classes — they automatically respond to theme changes.

### createButton

```ts
import { createButton } from "./components"

// Three variants
const primary = createButton("Save", "primary")
const outline = createButton("Cancel", "outline")
const ghost   = createButton("", "ghost", { icon: svgString })

// With click handler
const btn = createButton("Delete", "primary", {
  onClick: () => handleDelete()
})
```

| Variant | Look |
|---------|------|
| `primary` | Solid accent background, white text |
| `outline` | Accent border, transparent background |
| `ghost` | No border/background, shows surface on hover |

The `icon` option accepts a raw SVG string rendered into a child `<span>`.

### createInput

```ts
import { createInput } from "./components"

const text = createInput({ placeholder: "Name" })
const date = createInput({ type: "date", value: "2026-03-25" })
const textarea = createInput({ multiline: true, rows: 3, placeholder: "Notes" })
```

Returns `HTMLInputElement` or `HTMLTextAreaElement` depending on `multiline`.

### createCheckbox

```ts
import { createCheckbox } from "./components"

const cb = createCheckbox("Enable feature", true, (checked) => {
  console.log("Now:", checked)
})

// Label-less checkbox (for inline use in rows)
const bare = createCheckbox("", false, onChange)
```

### createAccordion

```ts
import { createAccordion } from "./components"

const { container, content, toggle } = createAccordion("Section Title")

// With options
const overdue = createAccordion("Overdue (3)", {
  labelClass: "text-danger",  // custom label styling
  defaultOpen: false,          // collapsed initially (default: open)
})

// Append children to content, then add container to the DOM
content.appendChild(someElement)
document.body.appendChild(container)
```

### createPopover

```ts
import { createPopover } from "./components"

const content = document.createElement("div")
content.textContent = "Popover content"

const { el, close } = createPopover(anchorButton, content)

// Programmatic close
close()

// Nested popover (stays open when parent is clicked)
const nested = createPopover(childAnchor, childContent, {
  parentPopover: el,
  onClose: () => console.log("nested closed"),
})
```

Popovers auto-position below the anchor (or above if no space), right-aligned. Click outside dismisses. Nested popovers have higher z-index and scoped click-outside handling.

## Adding a New Theme

1. Add the theme name to the `SyncSettings` type in `src/defaults.ts`:

```ts
theme: "modern" | "terminal";
```

2. Add CSS selectors in `src/styles.css`:

```css
/* Structural tokens */
[data-theme="terminal"] {
  --radius: 0;
  --panel-blur: 0;
  --panel-opacity: 1;
  --font-body: "Red Hat Mono", monospace;
  --font-mono: "Red Hat Mono", monospace;
  --spacing-panel: 0.75rem;
  --border-width: 1px;
  --transition-speed: 0ms;
}

/* Chromatic tokens — one block per mode */
[data-theme="terminal"][data-mode="light"] {
  --panel: #f5f5f0;
  --foreground: #1a1a1a;
  /* ... all chromatic tokens */
}

[data-theme="terminal"][data-mode="dark"] {
  --panel: #0a0a0a;
  --foreground: #00ff00;
  /* ... */
}

/* Accent overrides — 3 colors × 2 modes = 6 blocks */
[data-theme="terminal"][data-mode="dark"][data-accent="green"] {
  --accent: #00ff00;
  --accent-hover: #00cc00;
  --accent-foreground: #000000;
}
/* ... repeat for all accent/mode combos */

/* Background overrides — 3 colors × 2 modes = 6 blocks */
[data-theme="terminal"][data-mode="dark"][data-bg="green"] {
  --page-bg: #001a00;
}
/* ... repeat for all bg/mode combos */
```

3. Add the option to the settings UI in `src/index.html`:

```html
<option value="terminal">Terminal</option>
```

No JS changes needed — the theme boot system reads the stored key and sets `data-theme`, and CSS handles the rest.

## Adding a New Accent or Background Color

1. Extend the type in `src/defaults.ts`:

```ts
accentColor: "red" | "green" | "blue" | "purple";
```

2. Add CSS selectors for each theme × mode combo:

```css
[data-theme="modern"][data-mode="light"][data-accent="purple"] {
  --accent: #a855f7;
  --accent-hover: #9333ea;
  --accent-foreground: #ffffff;
}
[data-theme="modern"][data-mode="dark"][data-accent="purple"] {
  --accent: #c084fc;
  --accent-hover: #a855f7;
  --accent-foreground: #ffffff;
}
```

3. Add a button to the settings dialog.

## Adding a New CSS Token

1. Define the variable in the appropriate theme selectors in `src/styles.css`
2. Register it in `@theme inline` to make it available as a Tailwind utility:

```css
@theme inline {
  --color-my-token: var(--my-token);
}
```

3. Use it in Tailwind classes: `bg-my-token`, `text-my-token`, `border-my-token`

## Integrating a New Widget

When building a new widget that should consume the design system:

1. **Use component helpers** from `src/components.ts` for standard UI elements (buttons, inputs, popovers, etc.)

2. **Use theme Tailwind classes** for custom elements:

```ts
const card = document.createElement("div")
card.className = "bg-panel text-foreground rounded-theme p-4 border border-input-border/20"
```

3. **Use semantic color tokens** — not raw hex values:

```
bg-panel            → widget backgrounds
bg-popover          → floating surfaces
text-foreground     → primary text
text-muted          → secondary text
bg-accent           → primary actions
bg-danger           → destructive actions
bg-surface          → hover/active states
border-input-border → borders
```

4. **Use structural tokens** for consistent spacing and shape:

```
rounded-theme       → border radius matching the theme
blur-panel          → backdrop blur matching the theme
font-body           → body text font
font-mono           → monospace/numbers font
```

## File Reference

| File | Role |
|------|------|
| `src/defaults.ts` | Setting types and default values |
| `src/styles.css` | All CSS variable definitions, Tailwind token registration |
| `src/theme.ts` | Applies data attributes to `<html>`, manages mode listener |
| `src/components.ts` | Reusable UI component factories |
| `src/settings.ts` | Settings dialog wiring for theme/accent/mode/bg controls |
| `src/index.ts` | Calls `applyTheme()` + `subscribeTheme()` before first paint |

## Fallback Behavior

The `:root` block in `styles.css` provides safe defaults (modern + light + blue). If data attributes fail to apply, the page still renders correctly. The compound selectors have higher specificity and override `:root` when present.
