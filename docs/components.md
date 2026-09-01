# Components

The UI kit. **File:** `src/components.ts` (952 lines).

Ten factory functions that build DOM elements imperatively. No templates, no framework, no base class — each returns a detached element (or a small handle object) that the caller appends. All of them style with the design tokens from [design-system.md](design-system.md).

Use these instead of hand-rolling markup. If a control here doesn't fit, extend it rather than writing a one-off — the popover stack and focus management in particular are not worth reimplementing.

## Tones

```ts
type Tone = "default" | "popover"
```

`createButton`, `createInput`, `createSelect` and `createCheckbox` all take `tone`. It answers a specific problem: `--popover` is **dark in both light and dark mode**, and `.widget-card` reuses that palette, so a control built from the page tokens (`bg-input`, `text-foreground`) renders as a white box with near-black text on a dark glass surface. `tone: "popover"` swaps in `popover-foreground` alphas instead:

```ts
createInput({ placeholder: "Title", tone: "popover" })
createButton("Cancel", "ghost", { tone: "popover" })
```

Use it for anything inside a popover or a widget card; leave it off in the settings dialog and elsewhere on the page. It also sets `color-scheme: dark` on `date`/`time` inputs, whose picker chrome the browser paints itself.

Before it existed, `todo.ts` overwrote `createInput`'s and `createButton`'s class lists with hard-coded `bg-white/[0.06]` strings — that is the thing tones are here to stop.

### A warning about `className`

Both `className` and Tailwind's own base classes end up in the same `class` attribute, and **the winner is decided by stylesheet order, not by the order in the string**. `px-3` from `createButton`'s base beats a `p-0` you append. For anything that overrides a base utility — padding, size, font size — set an inline style or build the element by hand; `todo.ts` does both (`compact()` and `iconButton()`).

## createButton

```ts
createButton(
  label: string,
  variant: "primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override",
  opts?: { icon?: string | HTMLElement; onClick?: () => void; className?: string; tone?: Tone }
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
  tone?: Tone            // see Tones
  className?: string     // appended, not replaced
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
  variant?: "input" | "ghost"   // defaults to "input"
  tone?: Tone                   // see Tones
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
- **Variant.** `input` is the settings-form look: bordered, filled, full-width, chevron pushed to the far right. `ghost` is for a control that sits inside content rather than in a form — no border or fill, `currentColor` at 60% opacity until hovered, sized to its text with the chevron beside it, and a detached rounded list. The weather widget's metric selector uses it as its own heading.
- **Open/close.** In the `input` variant the trigger's corners square off at the bottom and the list's at the top, so the two read as one shape while open; the `ghost` variant keeps both rounded and floats the list 4px clear.
- **Mouse.** `mousedown` on the trigger opens the list and starts a drag; releasing over an option selects it. Click-to-open then click-to-select also works.
- **Keyboard.** Arrow keys move the highlight (opening the list if closed), Home/End jump, Enter/Space select, Escape closes and returns focus, Tab closes.
- **Outside click** closes it, via a `mousedown` listener registered on the next tick so the opening click doesn't immediately close it.

## createCheckbox

```ts
createCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  opts?: { tone?: Tone; className?: string; size?: number }   // size defaults to 18
): HTMLLabelElement
```

A visually-hidden `<input type="checkbox" class="sr-only peer">` plus a styled box — real focus and keyboard behavior, custom appearance. The checkmark is an inline SVG that scales and fades between states.

**`className` is appended, never assigned.** The box is a `<span>` sized with width/height, so it only has a size while the wrapper is `inline-flex`; a call site that replaced the wrapper's class list (`checkbox.className = "shrink-0"`) collapsed every todo checkbox to a 0px-wide vertical line. `size` scales the box and its checkmark together.

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

## The command palette

Not a `components.ts` export — it lives in `search/overlay.ts` — but it is the
second native-`<dialog>` surface in the app, and it solves the same problems a
different way. Worth reading alongside `createDialog` before building a third.

| | `createDialog` | `#palette` |
|---|---|---|
| Surface | `.dialog-surface` | `.palette-frame`, same `--dialog*` tokens |
| Element | `<dialog>` sized to content | `<dialog>` filling the viewport, with an absolutely-positioned frame inside |
| Close animation | `.closing` class + `animationend`, 150ms timeout fallback | WAAPI on the frame, driven to completion by a `setTimeout` |
| Escape | `cancel` → `preventDefault` → `close()` | `cancel` → `preventDefault`; a `keydown` listener on the dialog owns the staged behaviour |

The viewport-filling dialog is what makes the open animation possible: the frame
can be positioned and transformed freely inside it, and a click that lands on the
dialog rather than the frame is unambiguously a backdrop click.

Neither surface uses `createPopover` internally, and the palette **cannot** — a
popover is appended to `<body>` with a z-index, and the top layer is above every
z-index there is, so a popover raised from inside the palette would render behind
it. That is why the row action menu is an inline mode of the list rather than a
floating menu. See [search.md](search.md#keyboard).

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

The title element carries `.widget-card-title` so `layout.ts` can rewrite it on a refresh — the weather tile's header is its current city, not a fixed string.

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
    padding?: "default" | "none"                // "none" → p-1, for menus
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

## createMenu

```ts
type MenuItem =
  | "separator"
  | { label: string; icon?: HTMLElement; onClick: () => void
      danger?: boolean; disabled?: boolean; hint?: string; trailing?: HTMLElement }

createMenu(anchor: HTMLElement, items: MenuItem[], opts?: { onClose?: () => void }): { close: () => void }
```

A dropdown of actions built on `createPopover` with `padding: "none"`, so it inherits the stack, the focus trap and the outside-click dismissal. Picking an item closes the menu and *then* runs `onClick`. `danger` tints an item with the danger token; `disabled` dims it and drops its listener, and `hint` becomes the `title` explaining why (the todo row's Pin item uses it at the three-pin limit).

`trailing` pins an element to the right edge and gives the label the slack (`flex-1 min-w-0 truncate`), which is what turns a list of choices into a list of choices *with numbers on them* — the mail widget's inbox picker carries each inbox's unread count that way. An item with a `trailing` and no `icon` sits flush left, so a menu that mixes the two should give every item both, even if one of them is a spacer.

The popover is created **after** the items are in place — it measures itself when it mounts, so building it first would position an empty box.

Callers: the todo row's ⋮ button, the notepad menu, Linear's status picker, and Mail's inbox picker.

## createTooltip

```ts
createTooltip(anchor: HTMLElement, text: string, opts?: { delay?: number }): HTMLSpanElement
```

Appends a `.tooltip-below` span **into the anchor** and sets `anchor.style.position = "relative"`. Shows on `mouseenter` after `delay` (default 300ms), hides on `mouseleave`.

Because it's a child of the anchor, it inherits the anchor's overflow and stacking context — inside a clipped container it will be clipped. `settings.ts` needed a differently-positioned variant for the nav rail and hand-rolled it with `.settings-tooltip` rather than extending this.

## showToast

```ts
showToast(message: string, opts?: {
  action?: { label: string; onClick: () => void }
  duration?: number      // default 6s with an action, 4s without
  variant?: "default" | "danger"
}): { dismiss: () => void }
```

Transient feedback with an optional action, stacked bottom-centre. It is the undo path for destructive actions in the shortcuts panel: delete acts immediately and offers a way back, rather than asking first ([shortcuts.md](shortcuts.md#destructive-actions)).

Two details matter:

- **It parents to the topmost open `<dialog>`, not to `document.body`.** A dialog renders in the top layer, so a toast fixed to the body would sit *behind* it — the same trick the drag engine uses for its clone. Because `.dialog-surface` carries a `backdrop-filter`, an open dialog is also the containing block for its fixed-position children, so `dialog .toast-host` is offset 64px from the dialog's bottom rather than 24px from the viewport's, clearing the settings footer.
- **Hovering pauses the timer.** Reading a message and reaching for Undo takes longer than the timer allows, so the countdown holds while the pointer is over the toast and resumes (with at least 1.2s left) when it leaves.

## Conventions

- **Factories return elements, not instances.** State lives in the closure; there's no component object, no lifecycle, no unmount.
- **Everything is imperative.** No templates or `innerHTML` for structure (except a few small SVG injections).
- **Store-backed controls follow one pattern:** initialize from `get()`, write on user change, and subscribe to write back into the control. The setters (`select.value`, `setChecked`) intentionally don't fire change callbacks so this can't loop.
- **Nothing here reads the store.** Components take values and callbacks; the caller owns persistence.

## Refactor candidates

- **Two different escape hatches for imperative updates.** `createSelect` returns a typed `SelectElement` with a `value` property; `createCheckbox` bolts an untyped `setChecked` onto an `HTMLLabelElement`, forcing `as any` at all nine call sites (all in `settings.ts`). Both should return the same shape — either a typed element or a `{ el, set }` handle.
- **`createButton` has no size or icon-only affordance.** Callers that need a square icon button append to `className` and re-specify layout by hand (`shortcut-settings.ts:733`, `settings.ts:1360`), or give up and build the button themselves (`iconButton()` in `todo.ts`) — appending can't reliably beat the base padding anyway. A `size` option, or an `iconOnly` variant, would remove all three.
- **`createMenu` has no keyboard navigation.** Arrow keys don't move between items; only Tab does, via the popover's trap.
- **`"override"` is a variant that means "not a variant".** It exists so callers can borrow the base layout classes and supply their own palette; that reads better as a separate `createButtonBase()` or an option than as a member of the variant union.
- **Popovers ignore Escape.** Every other dismissible surface in the app closes on Escape; popovers don't.
- **The two document-level popover listeners are hard to reason about.** Modal, nested, and anchor-toggle cases are all resolved inside two capture-phase handlers with interleaved conditions (`components.ts:653`–`678`). This is where dismissal bugs will come from.
- **`createTooltip` can't escape its anchor's clipping**, which is why a second tooltip implementation (`.settings-tooltip`) exists in `settings.ts`. One tooltip that positions in the viewport would replace both.
- **`createDialog` appends on creation.** A dialog that's built but never opened still sits in the DOM. Appending on first `open()` would be tidier.
- **Ad-hoc inline styles for one-off shadows** (`components.ts:119`) sidestep the token system.
