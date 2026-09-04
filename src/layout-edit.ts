/**
 * Rearrange mode for the Default layout's card region.
 *
 * Entered from the Layout section of Appearance settings, which closes the
 * dialog first so the user is looking at the real page. While it is active the
 * settings button is gone, everything outside the card region is dimmed and
 * inert, and a fixed Save / Cancel pair sits in the top-right corner.
 *
 * The drag is Pointer Events, not HTML5 DnD, for the same reason
 * `shortcut-drag.ts` is: the drag image has to be a live element rather than a
 * screenshot, and the rest of the grid has to animate while it moves.
 *
 * Three things move at once during a drag:
 *   - a 25%-opacity clone of the card, pinned to the cursor
 *   - an outline in the grid marking the slot it would drop into, owned by
 *     `card-grid.ts` and transitioned as the slot changes
 *   - the other cards, sliding aside because the packer re-runs with the
 *     dragged card at its previewed index
 */

import { store } from "./store"
import { getPackedGrid, getLayout, saveCardLayout } from "./layout"
import type { CardDragSession, Columns } from "./card-grid"
import { createButton, closeAllPopovers } from "./components"
import { icon } from "./icons/registry"

const DRAG_THRESHOLD = 3
const DROP_MS = 280

/** Distance from a viewport edge at which a drag starts scrolling the page. */
const EDGE_BAND = 84
const EDGE_SPEED = 16

type Pending = { card: HTMLElement; x: number; y: number }

type Drag = {
  session: CardDragSession
  ghost: HTMLElement
  grabX: number
  grabY: number
  x: number
  y: number
  scroller: HTMLElement | null
  frame: number
}

let editing = false
let bar: HTMLElement | null = null
let snapshot: Columns = []
let snapshotCols = 0
let pending: Pending | null = null
let drag: Drag | null = null
/** Ends the drop animation early, so a second card can be picked up mid-flight. */
let settleDrop: (() => void) | null = null
let unsubLayout: (() => void) | null = null

export function isLayoutEditing(): boolean {
  return editing
}

/** Whether there is anything worth rearranging in the current layout. */
export function canEditLayout(): boolean {
  if (getLayout() !== "default") return false
  const grid = getPackedGrid()
  if (!grid) return false
  return grid.getLayout().reduce((n, col) => n + col.length, 0) > 1
}

export function startLayoutEdit(): void {
  if (editing || !canEditLayout()) return
  const grid = getPackedGrid()
  if (!grid) return

  closeAllPopovers()
  editing = true
  snapshot = grid.getLayout()
  snapshotCols = grid.getColumns()

  document.documentElement.setAttribute("data-editing", "layout")
  bar = buildBar()
  document.body.appendChild(bar)
  // Flush at the off-screen start state so the entrance actually transitions.
  void bar.offsetHeight
  bar.classList.add("is-in")

  document.addEventListener("pointerdown", onPointerDown, true)
  document.addEventListener("keydown", onKeyDown, true)
  // Another tab can switch the layout out from under us, taking the grid with it.
  unsubLayout = store.sync.subscribe("layout", () => exit(false))
}

function buildBar(): HTMLElement {
  const el = document.createElement("div")
  el.className = "layout-edit-bar"

  const hint = document.createElement("span")
  hint.className = "layout-edit-hint"
  hint.textContent = "Drag widgets to rearrange"
  el.appendChild(hint)

  el.appendChild(
    createButton("Cancel", "ghost", {
      icon: icon("close", { size: 16 }),
      onClick: () => exit(false),
      className: "layout-edit-action",
    })
  )
  el.appendChild(
    createButton("Save", "primary", {
      icon: icon("check", { size: 16 }),
      onClick: () => exit(true),
      className: "layout-edit-action",
    })
  )

  return el
}

function exit(save: boolean): void {
  if (!editing) return
  if (drag) endDrag(false)

  const grid = getPackedGrid()
  if (grid) {
    if (save) saveCardLayout(grid.getColumns(), grid.getLayout())
    // A window resized mid-edit has a different column count now; the snapshot
    // no longer describes it, so there is nothing sensible to put back.
    else if (grid.getColumns() === snapshotCols) grid.setLayout(snapshot)
  }

  editing = false
  pending = null
  settleDrop?.()
  unsubLayout?.()
  unsubLayout = null
  document.documentElement.removeAttribute("data-editing")
  document.removeEventListener("pointerdown", onPointerDown, true)
  document.removeEventListener("keydown", onKeyDown, true)

  const leaving = bar
  bar = null
  if (leaving) {
    leaving.classList.remove("is-in")
    setTimeout(() => leaving.remove(), 200)
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return
  e.preventDefault()
  e.stopPropagation()
  // Escape backs out one level: an in-flight drag first, then the mode itself.
  if (drag) endDrag(false)
  else exit(false)
}

function onPointerDown(e: PointerEvent): void {
  if (!editing || drag || e.button !== 0) return
  const target = e.target as Element | null
  if (target?.closest(".layout-edit-bar")) return

  settleDrop?.()

  const card = target?.closest<HTMLElement>("[data-card]")
  if (!card || !card.classList.contains("card-grid-item")) return

  e.preventDefault()
  e.stopPropagation()
  pending = { card, x: e.clientX, y: e.clientY }

  document.addEventListener("pointermove", onPointerMove, true)
  document.addEventListener("pointerup", onPointerUp, true)
  document.addEventListener("pointercancel", onPointerUp, true)
}

function onPointerMove(e: PointerEvent): void {
  e.preventDefault()

  if (pending) {
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD) return
    beginDrag(pending, e)
    pending = null
  }

  if (!drag) return
  drag.x = e.clientX
  drag.y = e.clientY
  moveGhost()
}

function onPointerUp(): void {
  document.removeEventListener("pointermove", onPointerMove, true)
  document.removeEventListener("pointerup", onPointerUp, true)
  document.removeEventListener("pointercancel", onPointerUp, true)
  pending = null
  if (drag) endDrag(true)
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = node.parentElement
  while (el) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === "auto" || overflow === "scroll") return el
    el = el.parentElement
  }
  return null
}

function beginDrag(from: Pending, e: PointerEvent): void {
  const grid = getPackedGrid()
  const id = from.card.dataset.card
  if (!grid || !id) return

  const session = grid.beginDrag(id)
  if (!session) return

  const { startRect } = session
  const ghost = from.card.cloneNode(true) as HTMLElement
  // A clone carries every descendant id with it; leaving them in place would
  // shadow the live widget for getElementById until the drop finishes.
  ghost.removeAttribute("id")
  for (const node of ghost.querySelectorAll("[id]")) node.removeAttribute("id")
  ghost.className = `${from.card.className} card-drag-ghost`
  ghost.classList.remove("card-grid-item", "card-grid-item-placed", "is-card-dragging")
  ghost.style.width = `${startRect.width}px`
  ghost.style.height = `${startRect.height}px`
  ghost.style.transform = `translate(${startRect.left}px, ${startRect.top}px)`
  document.body.appendChild(ghost)

  drag = {
    session,
    ghost,
    // Grab offsets come from the original pointerdown, so the card doesn't
    // jump under the cursor when the threshold is finally crossed.
    grabX: from.x - startRect.left,
    grabY: from.y - startRect.top,
    x: e.clientX,
    y: e.clientY,
    scroller: scrollParent(from.card),
    frame: 0,
  }

  document.documentElement.setAttribute("data-card-dragging", "true")
  moveGhost()
  drag.frame = requestAnimationFrame(edgeScroll)
}

function moveGhost(): void {
  if (!drag) return
  const left = drag.x - drag.grabX
  const top = drag.y - drag.grabY
  drag.ghost.style.transform = `translate(${left}px, ${top}px)`
  drag.session.hover(
    left + drag.ghost.offsetWidth / 2,
    top + drag.ghost.offsetHeight / 2
  )
}

/**
 * The grid lives in a scrolling frame, so a card can be dragged toward a slot
 * that is off-screen. Re-aiming after each scroll step keeps the outline
 * tracking the cursor even while the pointer is holding still at the edge.
 */
function edgeScroll(): void {
  if (!drag) return
  const scroller = drag.scroller
  if (scroller) {
    const rect = scroller.getBoundingClientRect()
    const fromTop = drag.y - rect.top
    const fromBottom = rect.bottom - drag.y
    let delta = 0
    if (fromTop < EDGE_BAND) delta = -EDGE_SPEED * (1 - Math.max(fromTop, 0) / EDGE_BAND)
    else if (fromBottom < EDGE_BAND)
      delta = EDGE_SPEED * (1 - Math.max(fromBottom, 0) / EDGE_BAND)

    if (delta) {
      const before = scroller.scrollTop
      scroller.scrollTop += delta
      if (scroller.scrollTop !== before) moveGhost()
    }
  }
  drag.frame = requestAnimationFrame(edgeScroll)
}

/**
 * Hands the card back to the grid. The floating clone flies to the slot the
 * outline was marking and fades up to full opacity as it lands, so the swap
 * back to the real card at the end of the flight is invisible.
 */
function endDrag(commit: boolean): void {
  const active = drag
  if (!active) return
  drag = null

  cancelAnimationFrame(active.frame)
  document.documentElement.removeAttribute("data-card-dragging")

  if (commit) active.session.drop()
  else active.session.cancel()

  const rect = active.session.targetRect()
  const ghost = active.ghost
  ghost.classList.add("is-dropping")
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`

  let done = false
  const settle = () => {
    if (done) return
    done = true
    settleDrop = null
    active.session.finish()
    ghost.remove()
  }
  settleDrop = settle
  ghost.addEventListener("transitionend", settle, { once: true })
  setTimeout(settle, DROP_MS + 60)
}
