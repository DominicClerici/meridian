# Components

The UI kit. **File:** `src/components.ts` (776 lines).

Nine factory functions that build DOM elements imperatively. No templates, no framework, no base class — each returns a detached element (or a small handle object) that the caller appends. All of them style with the design tokens from [design-system.md](design-system.md).

Use these instead of hand-rolling markup. If a control here doesn't fit, extend it rather than writing a one-off — the popover stack and focus management in particular are not worth reimplementing.

## createButton

```ts
createButton(
  label: string,
  variant: "primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override",
  opts?: { icon?: string | HTMLElement; onClick?: () => void; className?: string }
): HTMLButtonElement
```

Base classes are always applied: `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors`. The variant appends its color classes on top.

| Variant | Look |
|---|---|
| `primary` | Filled accent |
| `outline` | Accent border + accent text, transparent fill |
| `ghost` | Text only, `bg-surface` on hover |
| `destructive` | Filled danger |
| `destructive-outline` | Danger border + danger text |
| `override` | No color classes at all — you're styling it yourself |

`opts.icon` takes either an `HTMLElement` (from `icon()`, appended as-is with `shrink-0`) or a raw SVG string (wrapped in a span forced to 3.5×3.5). Passing `""` as the label skips the label span entirely, giving an icon-only button.

Use `"override"` when you need a button that carries the base layout but none of the palette — `settings.ts` uses it for the mode selector and for square icon buttons that then get `btn.className +=` treatment.

## createInput

```ts
createInput(opts: {
  type?: string          // default "text"
  placeholder?: string
  value?: string
  name?: string
  multiline?: boolean    // → <textarea>
  rows?: number          // default 3, multiline only
}): HTMLInputElement | HTMLTextAreaElement
```

One styling string covers both branches: full width, `rounded-theme`, `bg-input`, `border-input-border`, accent border on focus. Multiline adds `resize-y`.

The return type is the union, so call sites that need `.value` typically cast: `(input as HTMLInputElement).value`.

## createSelect

```ts
createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string          // defaults to the first option
  name?: string
  width?: string          // e.g. "120px"
  onChange?: (value: string) => void
}): SelectElement          // HTMLDivElement & { value: string }
```

A custom listbox, not a native `<select>` — native selects can't be styled to match the theme. Returns a `<div role="combobox">` with a `value` property defined via `Object.defineProperty`, so it reads and writes like a native control:

```ts
const sel = createSelect({ options, value: store.sync.get("clockSize"), onChange: v => … })
sel.value = "large"                          // updates the trigger label and the checkmark
store.sync.subscribe("clockSize", v => { sel.value = v })   // the standard sync pattern
```

**Important:** assigning `.value` **does not** fire `onChange`. That's deliberate — it's what makes the subscribe-back pattern above safe from feedback loops. `onChange` fires only on user selection.

Behavior details:

- **Width.** Given `opts.width`, the container is fixed to it. Otherwise a hidden zero-height sizer containing every option label is appended, so the control is naturally as wide as its longest option and never reflows when the value changes.
- **Open/close.** The trigger's corners square off at the bottom and the list's at the top, so the two read as one shape while open.
- **Mouse.** `mousedown` on the trigger opens the list and starts a drag; releasing over an option selects it. Click-to-open then click-to-select also works.
- **Keyboard.** Arrow keys move the highlight (opening the list if closed), Home/End jump, Enter/Space select, Escape closes and returns focus, Tab closes.
- **Outside click** closes it, via a `mousedown` listener registered on the next tick so the opening click doesn't immediately close it.

## createCheckbox

```ts
createCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLLabelElement
```

A visually-hidden `<input type="checkbox" class="sr-only peer">` plus a styled box — real focus and keyboard behavior, custom appearance. The checkmark is an inline SVG that scales and fades between states.

The returned label carries an **untyped `setChecked(v: boolean)` method** attached at `components.ts:433`:

```ts
const cb = createCheckbox("", store.sync.get("todoEnabled"), v => store.sync.set("todoEnabled", v))
store.sync.subscribe("todoEnabled", v => { (cb as any).setChecked(v) })
```

Like `createSelect`'s `.value` setter, `setChecked()` updates the visual state without firing `onChange`. The `as any` at every call site is the price of hanging the method off an `HTMLLabelElement`; a returned handle object would fix it.

Passing `""` as the label gives a bare checkbox, which is what `settingsRow()` wants since it renders its own label.

## createAccordion

```ts
createAccordion(
  label: string,
  opts?: { defaultOpen?: boolean; labelClass?: string; variant?: "compact" | "settings" }
): { container: HTMLElement; content: HTMLElement; toggle: () => void }
```

Append your children to `content`; append `container` to the page.

| Variant | Trigger | Content |
|---|---|---|
| `"settings"` | `text-sm`, `px-6 py-3`, hover fill, bottom border on the container | `flex-col gap-3 px-6 pb-4` |
| `"compact"` (default) | `text-xs`, `px-1 py-1.5` | `flex-col gap-0.5` |

`defaultOpen` defaults to **true** — it's `opts?.defaultOpen !== false`, so omitting it leaves the accordion open.

Expand/collapse animates height and opacity via the Web Animations API (200ms out, 150ms in). Mid-flight toggles cancel the running animation and restart, and each `onfinish` checks it's still the current animation before cleaning up, so rapid clicking can't leave the element stuck at a fixed height.

## createDialog

```ts
createDialog(opts?: { className?: string }): {
  dialog: HTMLDialogElement
  body: HTMLDivElement
  open: () => void
  close: () => void
}
```

Creates a native `<dialog class="dialog-surface">`, **appends it to `document.body` immediately**, and returns handles. Put your content in `body`.

- `open()` calls `showModal()` — real top-layer modality and a `::backdrop`.
- `close()` adds `.closing`, waits for `animationend` (with a 150ms timeout fallback in case no animation runs), then calls `dialog.close()`.
- Clicking the backdrop closes it (target === dialog).
- Escape is intercepted (`cancel` → `preventDefault`) and routed through `close()`, so the exit animation plays instead of the dialog vanishing.

Styling lives in `.dialog-surface` — see [design-system.md](design-system.md#component-css).

## createCard

```ts
createCard(opts: {
  title: string
  icon?: HTMLElement | null
  actions?: HTMLElement | null
  body?: HTMLElement | null
}): { el: HTMLDivElement; header: HTMLDivElement; body: HTMLDivElement }
```

The surface the non-immersive layouts put widgets on: an uppercase title row with optional leading icon and trailing action, over a body container. Returns the body separately because `layout.ts` re-renders into it (`refreshCard`) without rebuilding the shell.

Styling is `.widget-card` in `styles.css`, which deliberately reuses the **popover** palette — `--popover` / `--popover-foreground` are dark in both light and dark mode, so a widget body extracted from a popover renders in a card with no restyling. See [layouts.md](layouts.md).

## createPopover

```ts
createPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  opts?: {
    onClose?: () => void
    modal?: boolean
    position?: "below-right" | "above-center"   // default "below-right"
  }
): { el: HTMLDivElement; close: () => void }
```

The most intricate thing in the file. A module-level **popover stack** (`components.ts:605`) coordinates every open popover in the app.

**Positioning.** `below-right` aligns the popover's right edge to the anchor's, 4px below; if it would overflow the bottom, it flips above. `above-center` centers it above; if it would overflow the top, it flips below. Horizontally it's clamped to an 8px margin. If the anchor is inside a `<dialog>`, the popover is appended to that dialog (so it renders in the top layer with it) and coordinates are converted to the dialog's local space; otherwise it goes on `document.body`.

**Stacking.** Each popover gets an incrementing `z-index` starting at 100. Popovers nest: opening one from inside another pushes onto the stack. Closing a popover closes everything above it first.

**Dismissal** is handled by two capture-phase document listeners:

- Clicking inside the top popover does nothing.
- Clicking a non-modal popover's own anchor closes it (so the trigger toggles).
- Clicking elsewhere closes the top popover; if it was modal, or the click didn't land in a parent popover, the event is also stopped so it doesn't activate whatever was underneath.
- `modal: true` additionally blocks outside `mousedown` entirely — the click can't reach anything else.

**Focus trap.** Only the top popover traps. Tab and Shift+Tab cycle through the anchor plus every visible focusable descendant; `focusin` outside the top popover is pulled back to its first focusable. The trap is torn down and reinstalled on every push and pop.

**Note:** there is no Escape handler. Escape does not close popovers.

**`closeAllPopovers()`** unwinds the whole stack from the top. `layout.ts` calls it before a layout switch, since the anchors are about to be reparented.

## createTooltip

```ts
createTooltip(anchor: HTMLElement, text: string, opts?: { delay?: number }): HTMLSpanElement
```

Appends a `.tooltip-below` span **into the anchor** and sets `anchor.style.position = "relative"`. Shows on `mouseenter` after `delay` (default 300ms), hides on `mouseleave`.

Because it's a child of the anchor, it inherits the anchor's overflow and stacking context — inside a clipped container it will be clipped. `settings.ts` needed a differently-positioned variant for the nav rail and hand-rolled it with `.settings-tooltip` rather than extending this.

## Conventions

- **Factories return elements, not instances.** State lives in the closure; there's no component object, no lifecycle, no unmount.
- **Everything is imperative.** No templates or `innerHTML` for structure (except a few small SVG injections).
- **Store-backed controls follow one pattern:** initialize from `get()`, write on user change, and subscribe to write back into the control. The setters (`select.value`, `setChecked`) intentionally don't fire change callbacks so this can't loop.
- **Nothing here reads the store.** Components take values and callbacks; the caller owns persistence.

## Refactor candidates

- **Two different escape hatches for imperative updates.** `createSelect` returns a typed `SelectElement` with a `value` property; `createCheckbox` bolts an untyped `setChecked` onto an `HTMLLabelElement`, forcing `as any` at all nine call sites (all in `settings.ts`). Both should return the same shape — either a typed element or a `{ el, set }` handle.
- **`createButton` has no size or icon-only affordance.** Callers that need a square icon button append to `className` and re-specify layout by hand (`shortcut-settings.ts:733`, `settings.ts:1360`). A `size` option, or an `iconOnly` variant, would remove that.
- **`"override"` is a variant that means "not a variant".** It exists so callers can borrow the base layout classes and supply their own palette; that reads better as a separate `createButtonBase()` or an option than as a member of the variant union.
- **Popovers ignore Escape.** Every other dismissible surface in the app closes on Escape; popovers don't.
- **The two document-level popover listeners are hard to reason about.** Modal, nested, and anchor-toggle cases are all resolved inside two capture-phase handlers with interleaved conditions (`components.ts:653`–`678`). This is where dismissal bugs will come from.
- **`createTooltip` can't escape its anchor's clipping**, which is why a second tooltip implementation (`.settings-tooltip`) exists in `settings.ts`. One tooltip that positions in the viewport would replace both.
- **`createDialog` appends on creation.** A dialog that's built but never opened still sits in the DOM. Appending on first `open()` would be tidier.
- **Ad-hoc inline styles for one-off shadows** (`components.ts:119`) sidestep the token system.
