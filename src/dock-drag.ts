/**
 * Direct manipulation on the dock itself: pick a tile up, slide it, drop it.
 *
 * This is deliberately not `shortcut-drag.ts`. That engine drags a *selection*
 * around the settings grid, knows about the tab rail and the breadcrumb, and
 * lives inside a dialog. The dock drags exactly one tile, has three possible
 * destinations, and has to keep a magnifying row honest while it does it.
 *
 * Geometry is snapshotted once, at pick-up. Every frame after that is pure
 * arithmetic over that snapshot — the tiles being shoved aside are moved with
 * transforms, so nothing reflows and the snapshot stays valid for the whole
 * drag.
 */

import { showToast } from "./components"
import { moveItems, reorderItems, findTab } from "./shortcuts"
import type { Tab, TabItem } from "./shortcuts"

const THRESHOLD = 5
const FLIGHT_MS = 240

export type DockDragHost = {
  itemsEl: HTMLElement
  tabsEl: HTMLElement
  getTabs(): Tab[]
  save(tabs: Tab[]): void
  getActiveTabId(): string | null
  setDragging(on: boolean): void
}

type Slot = { id: string; el: HTMLElement; rect: DOMRect }

type Target =
  | { kind: "reorder"; index: number }
  | { kind: "folder"; id: string; el: HTMLElement }
  | { kind: "tab"; id: string; el: HTMLElement }

type Ctx = {
  id: string
  item: TabItem
  fromIndex: number
  slots: Slot[]
  source: HTMLElement
  clone: HTMLElement
  offsetX: number
  offsetY: number
  target: Target
}

let host: DockDragHost
let pending: { x: number; y: number; el: HTMLElement; id: string } | null = null
let ctx: Ctx | null = null
let suppressClick = false

/** True for the click that ends a drag, so the tile doesn't also navigate. */
export function dockDragSuppressedClick(): boolean {
  return suppressClick
}

function activeItems(): TabItem[] {
  const tabs = host.getTabs()
  const tab = findTab(tabs, host.getActiveTabId() ?? "")
  return tab ? tab.items : []
}

function snapshot(): Slot[] {
  return Array.from(host.itemsEl.querySelectorAll<HTMLElement>("[data-dock-id]")).map(
    (el) => ({ id: el.dataset.dockId!, el, rect: el.getBoundingClientRect() })
  )
}

// ------------------------------------------------------------------ pick up

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || ctx) return
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-dock-id]")
  if (!el || !host.itemsEl.contains(el)) return
  pending = { x: e.clientX, y: e.clientY, el, id: el.dataset.dockId! }
}

function onPointerMove(e: PointerEvent): void {
  if (ctx) {
    drag(e)
    return
  }
  if (!pending) return
  if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < THRESHOLD) return
  start(e)
}

function start(e: PointerEvent): void {
  if (!pending) return
  const { el, id } = pending
  pending = null

  const items = activeItems()
  const fromIndex = items.findIndex((i) => i.id === id)
  if (fromIndex < 0) return

  const slots = snapshot()
  const rect = el.getBoundingClientRect()

  // The clone is a copy rather than the node itself so the original keeps its
  // grid slot — that slot is what every other tile's displacement is measured
  // against.
  const clone = el.cloneNode(true) as HTMLElement
  clone.classList.add("dock-drag-clone")
  clone.style.width = `${rect.width}px`
  clone.style.height = `${rect.height}px`
  clone.removeAttribute("data-dock-id")
  document.body.appendChild(clone)

  el.classList.add("is-dock-dragging")
  document.documentElement.classList.add("is-dock-dragging-active")
  host.setDragging(true)

  ctx = {
    id,
    item: items[fromIndex],
    fromIndex,
    slots,
    source: el,
    clone,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    target: { kind: "reorder", index: fromIndex },
  }

  drag(e)
}

// -------------------------------------------------------------------- drag

function place(clone: HTMLElement, x: number, y: number, ox: number, oy: number): void {
  clone.style.transform = `translate3d(${x - ox}px, ${y - oy}px, 0)`
}

function resolve(e: PointerEvent): Target {
  const c = ctx!

  // Hit-test the point rather than trusting `e.target`. The drag is not pointer
  // captured — it can't be, or every move would report the tile being dragged
  // and a drop onto a tab pill could never be seen — so the event's target is
  // whatever happens to be under the cursor, including the page behind the dock.
  const under = document.elementFromPoint(e.clientX, e.clientY)
  const pill = under?.closest<HTMLElement>("[data-dock-tab]")
  if (pill && host.tabsEl.contains(pill)) {
    const id = pill.dataset.dockTab!
    if (id !== host.getActiveTabId()) return { kind: "tab", id, el: pill }
  }

  // Folders only accept shortcuts — the model is one level deep, and
  // `moveItems` would silently drop a folder rather than nest it.
  if (c.item.type === "shortcut") {
    for (const slot of c.slots) {
      if (slot.id === c.id) continue
      if (slot.el.dataset.kind !== "folder") continue
      const r = slot.rect
      const insetX = r.width * 0.2
      const insetY = r.height * 0.2
      if (
        e.clientX > r.left + insetX &&
        e.clientX < r.right - insetX &&
        e.clientY > r.top + insetY &&
        e.clientY < r.bottom - insetY
      ) {
        return { kind: "folder", id: slot.id, el: slot.el }
      }
    }
  }

  let best = 0
  let bestD = Infinity
  const cx = e.clientX - c.offsetX + c.slots[0].rect.width / 2
  const cy = e.clientY - c.offsetY + c.slots[0].rect.height / 2
  for (let i = 0; i < c.slots.length; i++) {
    const r = c.slots[i].rect
    const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return { kind: "reorder", index: best }
}

function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "reorder" && b.kind === "reorder") return a.index === b.index
  if (a.kind !== "reorder" && b.kind !== "reorder") return a.id === b.id
  return false
}

function paint(): void {
  const c = ctx!
  for (const slot of c.slots) {
    slot.el.classList.toggle(
      "is-dock-drop",
      c.target.kind !== "reorder" && "id" in c.target && slot.id === c.target.id
    )
  }
  for (const pill of host.tabsEl.querySelectorAll<HTMLElement>("[data-dock-tab]")) {
    pill.classList.toggle(
      "is-dock-drop",
      c.target.kind === "tab" && pill.dataset.dockTab === c.target.id
    )
  }

  // Anything but a reorder takes the tile out of the row entirely, so the
  // others fall back to where they started.
  if (c.target.kind !== "reorder") {
    for (const slot of c.slots) if (slot.id !== c.id) slot.el.style.transform = ""
    return
  }

  const order = c.slots.map((s) => s.id).filter((id) => id !== c.id)
  order.splice(c.target.index, 0, c.id)

  for (let i = 0; i < c.slots.length; i++) {
    const slot = c.slots[i]
    if (slot.id === c.id) continue
    const to = c.slots[order.indexOf(slot.id)].rect
    const dx = to.left - slot.rect.left
    const dy = to.top - slot.rect.top
    slot.el.style.transform = dx || dy ? `translate3d(${dx}px, ${dy}px, 0)` : ""
  }
}

function drag(e: PointerEvent): void {
  const c = ctx!
  e.preventDefault()
  place(c.clone, e.clientX, e.clientY, c.offsetX, c.offsetY)

  const next = resolve(e)
  if (!sameTarget(next, c.target)) {
    c.target = next
    paint()
  }
}

// --------------------------------------------------------------------- drop

/** Flies the clone to `rect`, then hands the row back to the renderer. */
function land(rect: DOMRect, fade: boolean, done: () => void): void {
  const c = ctx!
  const clone = c.clone
  clone.classList.add("is-landing")
  clone.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`
  clone.style.width = `${rect.width}px`
  clone.style.height = `${rect.height}px`
  if (fade) clone.style.opacity = "0"

  window.setTimeout(() => {
    clone.remove()
    done()
  }, FLIGHT_MS)

  // The row is released now rather than after the flight: the real tile is
  // already in its final place by then, so the clone lands on top of it.
  cleanupRow()
  ctx = null
}

function targetRect(): { rect: DOMRect; fade: boolean } {
  const c = ctx!
  if (c.target.kind !== "reorder") {
    return { rect: c.target.el.getBoundingClientRect(), fade: true }
  }
  const order = c.slots.map((s) => s.id).filter((id) => id !== c.id)
  order.splice(c.target.index, 0, c.id)
  return { rect: c.slots[order.indexOf(c.id)].rect, fade: false }
}

function commit(): void {
  const c = ctx!
  const tabId = host.getActiveTabId()
  if (!tabId) return

  if (c.target.kind === "reorder") {
    if (c.target.index === c.fromIndex) return
    host.save(reorderItems(host.getTabs(), tabId, c.fromIndex, c.target.index))
    return
  }

  if (c.target.kind === "folder") {
    const res = moveItems(host.getTabs(), [c.id], { tabId, folderId: c.target.id })
    host.save(res.tabs)
    if (!res.ok && res.reason) showToast(res.reason, { variant: "danger" })
    return
  }

  const before = host.getTabs()
  const res = moveItems(before, [c.id], { tabId: c.target.id })
  host.save(res.tabs)
  if (!res.ok) {
    if (res.reason) showToast(res.reason, { variant: "danger" })
    return
  }
  const dest = findTab(res.tabs, c.target.id)
  showToast(`Moved to ${dest?.name ?? "tab"}`, {
    action: { label: "Undo", onClick: () => host.save(before) },
  })
}

function onPointerUp(): void {
  pending = null
  if (!ctx) return

  const moved = ctx.target.kind !== "reorder" || ctx.target.index !== ctx.fromIndex
  const { rect, fade } = targetRect()
  commit()
  land(rect, fade, () => {})

  if (moved) {
    suppressClick = true
    window.setTimeout(() => (suppressClick = false), 0)
  }
}

function cancel(): void {
  if (!ctx) return
  const c = ctx
  c.target = { kind: "reorder", index: c.fromIndex }
  paint()
  land(c.slots[c.fromIndex].rect, false, () => {})
  suppressClick = true
  window.setTimeout(() => (suppressClick = false), 0)
}

function cleanupRow(): void {
  const c = ctx
  if (!c) return
  for (const slot of c.slots) {
    slot.el.style.transform = ""
    slot.el.classList.remove("is-dock-drop")
  }
  c.source.classList.remove("is-dock-dragging")
  for (const pill of host.tabsEl.querySelectorAll<HTMLElement>("[data-dock-tab]")) {
    pill.classList.remove("is-dock-drop")
  }
  document.documentElement.classList.remove("is-dock-dragging-active")
  host.setDragging(false)
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && ctx) {
    e.preventDefault()
    e.stopPropagation()
    cancel()
  }
}

export function initDockDrag(dragHost: DockDragHost): void {
  host = dragHost
  host.itemsEl.addEventListener("pointerdown", onPointerDown)
  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", onPointerUp)
  window.addEventListener("pointercancel", onPointerUp)
  window.addEventListener("keydown", onKeyDown, true)
}
