import {
  findTab,
  folderCapacity,
  itemCapacity,
  locate,
  moveItems,
  reorderTabs,
  type Tab,
  type TabItem,
} from "./shortcuts"

/**
 * Pointer-driven drag for the shortcuts grid.
 *
 * Not HTML5 drag-and-drop: that can't animate a live insertion point or carry
 * a custom drag image that isn't a screenshot.
 *
 * This replaces the row-based engine, whose FLIP animation translated rows by
 * a single `stride` — an assumption a wrapping grid breaks. It also drops the
 * two timed gestures that engine had (hover-a-folder-for-1s to drill in, and
 * hold-on-a-shortcut to merge), because neither announced itself. Filing into
 * a folder is now just dropping onto it, and making a folder from several
 * items is an explicit action in the selection bar.
 */

export type DragHost = {
  gridEl: HTMLElement
  railEl: HTMLElement
  scrollEl: HTMLElement
  getTabs(): Tab[]
  save(tabs: Tab[]): void
  getState(): { tabId: string | null; folderId: string | null; selection: Set<string> }
  setLocation(tabId: string, folderId: string | null): void
  clearSelection(): void
  notify(message: string): void
  refresh(): void
}

const THRESHOLD = 4
const AUTOSCROLL_EDGE = 48
const AUTOSCROLL_STEP = 10

type TileSnap = {
  id: string
  type: string
  index: number
  left: number
  top: number
  width: number
  height: number
}

type DropTarget =
  | { kind: "reorder"; index: number }
  | { kind: "into-folder"; folderId: string; blocked: boolean }
  | { kind: "tab"; tabId: string; blocked: boolean }
  | { kind: "none" }

type ItemDrag = {
  mode: "item"
  ids: string[]
  sourceTabId: string
  sourceFolderId: string | null
  clone: HTMLElement
  offsetX: number
  offsetY: number
  snaps: TileSnap[]
  target: DropTarget
}

type TabDrag = {
  mode: "tab"
  tabId: string
  fromIndex: number
  clone: HTMLElement
  offsetX: number
  offsetY: number
  toIndex: number
}

let host: DragHost
let state: "idle" | "pending" | "dragging" = "idle"
let ctx: ItemDrag | TabDrag | null = null
let pending: { x: number; y: number; el: HTMLElement; kind: "item" | "tab" } | null = null

let caret: HTMLElement | null = null
let railCaret: HTMLElement | null = null

// --------------------------------------------------------------- geometry

/** The dialog is in the top layer, so a fixed clone must be parented to it. */
function overlayHost(): HTMLElement {
  return (host.gridEl.closest("dialog") as HTMLElement | null) ?? document.body
}

function overlayOffset(): { x: number; y: number } {
  const dialog = host.gridEl.closest("dialog")
  if (!dialog) return { x: 0, y: 0 }
  const rect = dialog.getBoundingClientRect()
  return { x: rect.left, y: rect.top }
}

/**
 * Tile positions relative to the grid's own box. Both the tiles and the grid
 * move together as the list scrolls, so these stay valid without re-measuring.
 */
function snapshot(): TileSnap[] {
  const gridRect = host.gridEl.getBoundingClientRect()
  const snaps: TileSnap[] = []

  for (const el of host.gridEl.querySelectorAll<HTMLElement>("[data-id]")) {
    const rect = el.getBoundingClientRect()
    snaps.push({
      id: el.dataset.id!,
      type: el.dataset.type ?? "shortcut",
      index: Number(el.dataset.index ?? 0),
      left: rect.left - gridRect.left,
      top: rect.top - gridRect.top,
      width: rect.width,
      height: rect.height,
    })
  }
  return snaps
}

/**
 * Nearest insertion slot in a wrapping grid: every tile contributes the slot
 * before it and the slot after it, and the closest one wins. This is what
 * replaces the old single-`stride` arithmetic, which only held for one column.
 */
function nearestSlot(snaps: TileSnap[], x: number, y: number): number {
  let best = snaps.length
  let bestDistance = Infinity

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]
    const midY = snap.top + snap.height / 2

    const before = Math.hypot(x - snap.left, y - midY)
    if (before < bestDistance) {
      bestDistance = before
      best = i
    }

    const after = Math.hypot(x - (snap.left + snap.width), y - midY)
    if (after < bestDistance) {
      bestDistance = after
      best = i + 1
    }
  }
  return best
}

// ----------------------------------------------------------- drop targets

function resolveTarget(clientX: number, clientY: number): DropTarget {
  if (!ctx || ctx.mode !== "item") return { kind: "none" }
  const drag = ctx
  const { tabId, folderId } = host.getState()

  // Rail first: a tab pill overlaps nothing else, and dropping on one is the
  // only cross-tab move.
  const railRect = host.railEl.getBoundingClientRect()
  if (contains(railRect, clientX, clientY)) {
    const el = document.elementFromPoint(clientX, clientY)
    const pill = el?.closest<HTMLElement>("[data-tab-id]")
    if (!pill) return { kind: "none" }
    const targetTab = pill.dataset.tabId!
    if (targetTab === tabId && !folderId) return { kind: "none" }
    const tabs = host.getTabs()
    const blocked =
      !findTab(tabs, targetTab) || itemCapacity(tabs, targetTab).free < drag.ids.length
    return { kind: "tab", tabId: targetTab, blocked }
  }

  const gridRect = host.gridEl.getBoundingClientRect()
  const scrollRect = host.scrollEl.getBoundingClientRect()
  if (!contains(scrollRect, clientX, clientY)) return { kind: "none" }

  const x = clientX - gridRect.left
  const y = clientY - gridRect.top

  // A folder tile is a container, but only from the top level and only for
  // shortcuts — folders can't nest.
  if (!folderId) {
    const over = ctx.snaps.find(
      (s) =>
        s.type === "folder" &&
        !drag.ids.includes(s.id) &&
        x >= s.left + s.width * 0.2 &&
        x <= s.left + s.width * 0.8 &&
        y >= s.top + s.height * 0.15 &&
        y <= s.top + s.height * 0.85
    )
    if (over) {
      const tabs = host.getTabs()
      const dragging = drag.ids.map((id) => locate(tabs, id)?.item).filter(Boolean) as TabItem[]
      const shortcuts = dragging.filter((i) => i.type === "shortcut")
      const room = tabId ? folderCapacity(tabs, tabId, over.id).free : 0
      return {
        kind: "into-folder",
        folderId: over.id,
        blocked: shortcuts.length === 0 || room < shortcuts.length,
      }
    }
  }

  return { kind: "reorder", index: nearestSlot(drag.snaps, x, y) }
}

function contains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

// -------------------------------------------------------------- feedback

function clearFeedback(): void {
  for (const el of host.gridEl.querySelectorAll(".sc-drop-into, .sc-drop-blocked")) {
    el.classList.remove("sc-drop-into", "sc-drop-blocked")
  }
  for (const el of host.railEl.querySelectorAll(".sc-drop-tab, .sc-drop-blocked")) {
    el.classList.remove("sc-drop-tab", "sc-drop-blocked")
  }
  if (caret) caret.hidden = true
}

function paintFeedback(): void {
  if (!ctx || ctx.mode !== "item") return
  clearFeedback()

  const target = ctx.target
  ctx.clone.classList.toggle("sc-drag-clone-into", target.kind === "into-folder")

  if (target.kind === "into-folder") {
    const tile = host.gridEl.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(target.folderId)}"]`
    )
    tile?.classList.add(target.blocked ? "sc-drop-blocked" : "sc-drop-into")
    return
  }

  if (target.kind === "tab") {
    const pill = host.railEl.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(target.tabId)}"]`
    )
    pill?.classList.add(target.blocked ? "sc-drop-blocked" : "sc-drop-tab")
    return
  }

  if (target.kind !== "reorder") return

  if (!caret) {
    caret = document.createElement("div")
    caret.className = "sc-drop-caret"
    host.gridEl.appendChild(caret)
  }

  const snaps = ctx.snaps
  const index = target.index
  const anchor = index >= snaps.length ? snaps[snaps.length - 1] : snaps[index]
  if (!anchor) {
    caret.hidden = true
    return
  }

  const atEnd = index >= snaps.length
  caret.hidden = false
  caret.style.left = `${atEnd ? anchor.left + anchor.width : anchor.left}px`
  caret.style.top = `${anchor.top + anchor.height * 0.12}px`
  caret.style.height = `${anchor.height * 0.76}px`
}

// ------------------------------------------------------------------ clone

function makeClone(source: HTMLElement, extra: number): HTMLElement {
  const rect = source.getBoundingClientRect()
  const clone = source.cloneNode(true) as HTMLElement
  clone.removeAttribute("data-id")
  clone.removeAttribute("id")
  clone.classList.add("sc-drag-clone")
  clone.style.width = `${rect.width}px`
  clone.style.height = `${rect.height}px`

  if (extra > 0) {
    const badge = document.createElement("span")
    badge.className = "sc-drag-count"
    badge.textContent = `+${extra}`
    clone.appendChild(badge)
  }

  overlayHost().appendChild(clone)
  return clone
}

function positionClone(clone: HTMLElement, x: number, y: number, offX: number, offY: number): void {
  const offset = overlayOffset()
  clone.style.left = `${x - offX - offset.x}px`
  clone.style.top = `${y - offY - offset.y}px`
}

// ------------------------------------------------------------- pointer flow

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || state !== "idle") return
  const target = e.target as HTMLElement

  if (target.closest(".sc-tile-menu") || target.closest("input, textarea, select")) return

  const tile = target.closest<HTMLElement>("[data-id]")
  if (tile && host.gridEl.contains(tile)) {
    pending = { x: e.clientX, y: e.clientY, el: tile, kind: "item" }
    state = "pending"
    attach()
    return
  }

  const pill = target.closest<HTMLElement>("[data-tab-id]")
  if (pill && host.railEl.contains(pill)) {
    pending = { x: e.clientX, y: e.clientY, el: pill, kind: "tab" }
    state = "pending"
    attach()
  }
}

function onPointerMove(e: PointerEvent): void {
  if (state === "pending" && pending) {
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < THRESHOLD) return
    startDrag(e)
    return
  }
  if (state !== "dragging" || !ctx) return

  e.preventDefault()

  if (ctx.mode === "item") {
    positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)
    autoScroll(e.clientY)
    ctx.target = resolveTarget(e.clientX, e.clientY)
    paintFeedback()
    return
  }

  positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)
  paintTabDrag(e.clientY)
}

function startDrag(e: PointerEvent): void {
  if (!pending) return
  const { el, kind } = pending
  const rect = el.getBoundingClientRect()

  if (kind === "tab") {
    const tabs = host.getTabs()
    const tabId = el.dataset.tabId!
    ctx = {
      mode: "tab",
      tabId,
      fromIndex: tabs.findIndex((t) => t.id === tabId),
      clone: makeClone(el, 0),
      offsetX: pending.x - rect.left,
      offsetY: pending.y - rect.top,
      toIndex: tabs.findIndex((t) => t.id === tabId),
    }
    el.classList.add("sc-dragging-source")
  } else {
    const { tabId, folderId, selection } = host.getState()
    const id = el.dataset.id!
    // Dragging an unselected tile drags just that tile, and leaves the
    // selection alone — grabbing one thing shouldn't silently take others.
    const ids = selection.has(id) ? orderedSelection(selection) : [id]

    ctx = {
      mode: "item",
      ids,
      sourceTabId: tabId!,
      sourceFolderId: folderId,
      clone: makeClone(el, ids.length - 1),
      offsetX: pending.x - rect.left,
      offsetY: pending.y - rect.top,
      snaps: snapshot(),
      target: { kind: "none" },
    }

    for (const dragged of ids) {
      host.gridEl
        .querySelector(`[data-id="${CSS.escape(dragged)}"]`)
        ?.classList.add("sc-dragging-source")
    }
  }

  state = "dragging"
  document.body.classList.add("sc-dragging")
  positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)
  pending = null
}

/** Selection in visual order, so a multi-drag lands in the order it looked. */
function orderedSelection(selection: Set<string>): string[] {
  const ids: string[] = []
  for (const el of host.gridEl.querySelectorAll<HTMLElement>("[data-id]")) {
    const id = el.dataset.id!
    if (selection.has(id)) ids.push(id)
  }
  for (const id of selection) if (!ids.includes(id)) ids.push(id)
  return ids
}

function autoScroll(clientY: number): void {
  const rect = host.scrollEl.getBoundingClientRect()
  if (clientY < rect.top + AUTOSCROLL_EDGE) {
    host.scrollEl.scrollTop -= AUTOSCROLL_STEP
  } else if (clientY > rect.bottom - AUTOSCROLL_EDGE) {
    host.scrollEl.scrollTop += AUTOSCROLL_STEP
  }
}

function paintTabDrag(clientY: number): void {
  if (!ctx || ctx.mode !== "tab") return

  const pills = [...host.railEl.querySelectorAll<HTMLElement>("[data-tab-id]")]
  let index = pills.length
  for (let i = 0; i < pills.length; i++) {
    const rect = pills[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) {
      index = i
      break
    }
  }
  ctx.toIndex = index

  if (!railCaret) {
    railCaret = document.createElement("div")
    railCaret.className = "sc-rail-caret"
    host.railEl.appendChild(railCaret)
  }

  const railRect = host.railEl.getBoundingClientRect()
  const anchorEl = pills[Math.min(index, pills.length - 1)]
  if (!anchorEl) return
  const anchorRect = anchorEl.getBoundingClientRect()
  const top =
    index >= pills.length
      ? anchorRect.bottom - railRect.top + host.railEl.scrollTop
      : anchorRect.top - railRect.top + host.railEl.scrollTop

  railCaret.hidden = false
  railCaret.style.top = `${top - 1}px`
}

function onPointerUp(): void {
  if (state === "pending") {
    cleanup()
    return
  }
  if (state !== "dragging" || !ctx) {
    cleanup()
    return
  }

  if (ctx.mode === "tab") commitTabDrop()
  else commitItemDrop()

  cleanup()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || state === "idle") return
  e.preventDefault()
  e.stopPropagation()
  cleanup()
}

// ------------------------------------------------------------------ commit

function commitItemDrop(): void {
  if (!ctx || ctx.mode !== "item") return
  const drag = ctx
  const target = drag.target
  if (target.kind === "none") return

  const { tabId, folderId } = host.getState()
  if (!tabId) return

  if (target.kind === "into-folder") {
    if (target.blocked) {
      host.notify("That folder is full, or those items can't go in one.")
      return
    }
    const result = moveItems(host.getTabs(), drag.ids, { tabId, folderId: target.folderId })
    finish(result)
    return
  }

  if (target.kind === "tab") {
    if (target.blocked) {
      host.notify("That tab is full.")
      return
    }
    const result = moveItems(host.getTabs(), drag.ids, {
      tabId: target.tabId,
      folderId: null,
    })
    finish(result)
    return
  }

  // Reorder. The slot index was measured against the list as it looks now, so
  // it has to be pulled back by however many dragged items sit before it.
  const tabs = host.getTabs()
  const container = folderId
    ? findTab(tabs, tabId)?.items.find((i) => i.id === folderId && i.type === "folder")
    : findTab(tabs, tabId)
  const list: { id: string }[] =
    container && "children" in container ? container.children : (container as Tab | undefined)?.items ?? []

  const removedBefore = drag.ids.filter((id) => {
    const index = list.findIndex((i) => i.id === id)
    return index !== -1 && index < target.index
  }).length

  const index = target.index - removedBefore
  const unchanged =
    drag.ids.length === 1 && list.findIndex((i) => i.id === drag.ids[0]) === index
  if (unchanged) return

  finish(moveItems(tabs, drag.ids, { tabId, folderId, index }))
}

function finish(result: { tabs: Tab[]; ok: boolean; reason?: string }): void {
  if (result.reason) host.notify(result.reason)
  if (!result.ok) return
  host.clearSelection()
  host.save(result.tabs)
}

function commitTabDrop(): void {
  if (!ctx || ctx.mode !== "tab") return
  const { fromIndex } = ctx
  const to = ctx.toIndex > fromIndex ? ctx.toIndex - 1 : ctx.toIndex
  if (to === fromIndex || fromIndex === -1) return
  host.save(reorderTabs(host.getTabs(), fromIndex, to))
}

// ----------------------------------------------------------------- cleanup

function cleanup(): void {
  clearFeedback()
  if (railCaret) railCaret.hidden = true

  if (ctx) ctx.clone.remove()
  ctx = null
  pending = null
  state = "idle"

  document.body.classList.remove("sc-dragging")
  for (const el of document.querySelectorAll(".sc-dragging-source")) {
    el.classList.remove("sc-dragging-source")
  }

  detach()
}

function attach(): void {
  document.addEventListener("pointermove", onPointerMove, { passive: false })
  document.addEventListener("pointerup", onPointerUp)
  document.addEventListener("pointercancel", onPointerUp)
  document.addEventListener("keydown", onKeyDown, true)
}

function detach(): void {
  document.removeEventListener("pointermove", onPointerMove)
  document.removeEventListener("pointerup", onPointerUp)
  document.removeEventListener("pointercancel", onPointerUp)
  document.removeEventListener("keydown", onKeyDown, true)
}

export function initGridDrag(dragHost: DragHost): void {
  host = dragHost
  host.gridEl.addEventListener("pointerdown", onPointerDown)
  host.railEl.addEventListener("pointerdown", onPointerDown)
}
