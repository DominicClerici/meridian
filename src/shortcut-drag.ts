import type { Tab, TabItem, Folder, Shortcut, FolderIcon } from "./shortcuts"
import {
  reorderTabs,
  reorderItems,
  reorderFolderChildren,
  extractItem,
  insertItem,
  insertIntoFolder,
  mergeShortcutsIntoNewFolder,
  MAX_CHILDREN_PER_FOLDER,
} from "./shortcuts"

export interface DragCallbacks {
  getTabs: () => Tab[]
  save: (tabs: Tab[]) => void
  render: () => void
  getSelectedTabId: () => string | null
  getViewingFolderId: () => string | null
  getSelectionMode: () => boolean
  getSelectedIds: () => Set<string>
  setSelectedTabId: (id: string | null) => void
  setViewingFolderId: (id: string | null) => void
  exitSelectionMode: () => void
  openCreateFolderPopover: (
    anchor: HTMLElement,
    onSave: (name: string, icon?: FolderIcon) => void,
    onCancel?: () => void
  ) => void
}

type DropZone =
  | { type: "reorder"; location: "top-level" | "folder"; index: number }
  | { type: "into-folder"; folderId: string; blocked: boolean }
  | { type: "merge-shortcut"; targetId: string }
  | { type: "tab"; tabId: string }
  | { type: "none" }

interface ItemDragCtx {
  mode: "item"
  sourceTabId: string
  sourceItemId: string
  sourceType: "shortcut" | "folder"
  sourceFolderId: string | null
  isSelectionDrag: boolean
  draggedIds: string[]
  selectionHasFolders: boolean
  clone: HTMLElement
  offsetX: number
  offsetY: number
  snapshot: Tab[]
  hoverTimer: number | null
  hoverTarget: { type: "tab" | "folder" | "shortcut"; id: string } | null
  hoverPhase2Timer: number | null
  hoverAnimEl: HTMLElement | null
  mergeReady: boolean
}

interface TabDragCtx {
  mode: "tab"
  sourceTabId: string
  sourceIndex: number
  clone: HTMLElement
  offsetX: number
  offsetY: number
}

type DragCtx = ItemDragCtx | TabDragCtx
type DragState = "idle" | "pending" | "dragging"

let state: DragState = "idle"
let ctx: DragCtx | null = null
let pendingStart: { x: number; y: number } | null = null
let cb: DragCallbacks
let tabBarEl: HTMLElement
let itemListEl: HTMLElement
let dialogEl: HTMLElement
let preview: HTMLElement
let tabIndicator: HTMLElement

interface RowSnap {
  id: string
  type: "shortcut" | "folder"
  index: number
  contentTop: number
  height: number
  left: number
  width: number
}

interface ZoneSnap {
  location: "top-level" | "folder"
  folderId: string | null
  rows: RowSnap[]
  stride: number
  el: HTMLElement
}

let zoneSnaps: ZoneSnap[] = []

const DRAG_THRESHOLD = 3
const HOVER_DELAY = 1000
const AUTO_SCROLL_THRESHOLD = 40
const AUTO_SCROLL_SPEED = 8

export function initDrag(
  _tabBarEl: HTMLElement,
  _itemListEl: HTMLElement,
  callbacks: DragCallbacks
): void {
  tabBarEl = _tabBarEl
  itemListEl = _itemListEl
  cb = callbacks
  dialogEl = itemListEl.closest("dialog") ?? document.body

  preview = document.createElement("div")
  preview.className = "fixed rounded-theme pointer-events-none z-[9998]"
  preview.style.cssText =
    "display:none; outline: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent);"
  dialogEl.appendChild(preview)

  tabIndicator = document.createElement("div")
  tabIndicator.className =
    "fixed w-0.5 bg-accent rounded-full pointer-events-none z-[9999]"
  tabIndicator.style.display = "none"
  dialogEl.appendChild(tabIndicator)

  itemListEl.addEventListener("pointerdown", onItemPointerDown)
  tabBarEl.addEventListener("pointerdown", onTabPointerDown)
}

function onItemPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (
    target.closest("button") ||
    target.closest("input") ||
    target.closest("label")
  )
    return
  const row = target.closest("[data-id]") as HTMLElement | null
  if (!row) return

  const itemId = row.dataset.id!
  const itemType = row.dataset.type as "shortcut" | "folder"
  const selectedTabId = cb.getSelectedTabId()
  if (!selectedTabId) return

  if (cb.getViewingFolderId() === itemId) return

  const isSelection = cb.getSelectionMode()
  if (isSelection && !cb.getSelectedIds().has(itemId)) return

  const zone = row.closest("[data-zone]") as HTMLElement | null
  const folderId =
    zone?.dataset.zone === "folder" ? zone.dataset.folderId ?? null : null

  const tabs = cb.getTabs()
  const draggedIds = isSelection ? Array.from(cb.getSelectedIds()) : [itemId]
  const selectionHasFolders =
    isSelection &&
    draggedIds.some((id) => {
      const tab = tabs.find((t) => t.id === selectedTabId)
      return tab?.items.some((i) => i.id === id && i.type === "folder") ?? false
    })

  ctx = {
    mode: "item",
    sourceTabId: selectedTabId,
    sourceItemId: itemId,
    sourceType: itemType,
    sourceFolderId: folderId,
    isSelectionDrag: isSelection,
    draggedIds,
    selectionHasFolders,
    clone: null!,
    offsetX: e.clientX - row.getBoundingClientRect().left,
    offsetY: e.clientY - row.getBoundingClientRect().top,
    snapshot: tabs,
    hoverTimer: null,
    hoverTarget: null,
    hoverPhase2Timer: null,
    hoverAnimEl: null,
    mergeReady: false,
  }

  state = "pending"
  pendingStart = { x: e.clientX, y: e.clientY }

  e.preventDefault()
  document.addEventListener("pointermove", onPointerMove)
  document.addEventListener("pointerup", onPointerUp)
}

function onTabPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  if (cb.getSelectionMode()) return

  const pill = (e.target as HTMLElement).closest(
    "[data-tab-id]"
  ) as HTMLElement | null
  if (!pill) return

  if (
    (e.target as HTMLElement).closest("input") ||
    (e.target as HTMLElement).closest("button")
  )
    return

  const tabId = pill.dataset.tabId!
  const tabs = cb.getTabs()
  const index = tabs.findIndex((t) => t.id === tabId)
  if (index === -1) return

  ctx = {
    mode: "tab",
    sourceTabId: tabId,
    sourceIndex: index,
    clone: null!,
    offsetX: e.clientX - pill.getBoundingClientRect().left,
    offsetY: e.clientY - pill.getBoundingClientRect().top,
  }

  state = "pending"
  pendingStart = { x: e.clientX, y: e.clientY }

  e.preventDefault()
  document.addEventListener("pointermove", onPointerMove)
  document.addEventListener("pointerup", onPointerUp)
}

function onPointerMove(e: PointerEvent): void {
  if (state === "pending" && pendingStart) {
    const dx = e.clientX - pendingStart.x
    const dy = e.clientY - pendingStart.y
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

    state = "dragging"
    pendingStart = null
    startDrag(e)
  }

  if (state === "dragging" && ctx) {
    updateDrag(e)
  }
}

function onPointerUp(e: PointerEvent): void {
  if (state === "pending") {
    cleanup()
    return
  }
  if (state === "dragging" && ctx) {
    processDrop(e)
  }
  cleanup()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && state === "dragging" && ctx) {
    if (ctx.mode === "item") {
      cb.save(ctx.snapshot)
    }
    cleanup()
  }
}

function cleanup(): void {
  if (ctx) {
    if (ctx.mode === "item") {
      if (ctx.hoverTimer !== null) clearTimeout(ctx.hoverTimer)
      clearHoverAnimation()
    }
    ctx.clone?.remove()
  }
  ctx = null
  state = "idle"
  pendingStart = null
  preview.style.display = "none"
  tabIndicator.style.display = "none"
  clearVisualFeedback()
  zoneSnaps = []
  itemListEl.querySelectorAll("[data-id]").forEach((el) => {
    const h = el as HTMLElement
    h.style.transition = ""
    h.style.transform = ""
    h.style.opacity = ""
  })
  document.removeEventListener("pointermove", onPointerMove)
  document.removeEventListener("pointerup", onPointerUp)
  document.removeEventListener("keydown", onKeyDown)
}

function clearVisualFeedback(): void {
  itemListEl.querySelectorAll("[data-id]").forEach((el) => {
    el.classList.remove(
      "bg-accent/20",
      "bg-accent/10",
      "bg-warning/20",
      "bg-danger/30",
      "opacity-50"
    )
  })
  tabBarEl.querySelectorAll("[data-tab-id]").forEach((el) => {
    el.classList.remove("ring-2", "ring-accent/50", "bg-accent/10")
  })
  itemListEl.querySelectorAll("[data-zone]").forEach((el) => {
    el.classList.remove("ring-2", "ring-accent/50", "bg-accent/5")
  })
}

function dialogOffset(): { x: number; y: number } {
  const r = dialogEl.getBoundingClientRect()
  return { x: r.left, y: r.top }
}

function positionClone(
  clone: HTMLElement,
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number
): void {
  const d = dialogOffset()
  clone.style.left = `${clientX - offsetX - d.x}px`
  clone.style.top = `${clientY - offsetY - d.y}px`
}

function autoScroll(clientY: number): void {
  const rect = itemListEl.getBoundingClientRect()
  if (clientY - rect.top < AUTO_SCROLL_THRESHOLD && itemListEl.scrollTop > 0) {
    itemListEl.scrollBy(0, -AUTO_SCROLL_SPEED)
  } else if (rect.bottom - clientY < AUTO_SCROLL_THRESHOLD) {
    itemListEl.scrollBy(0, AUTO_SCROLL_SPEED)
  }
}

function snapshotZones(): void {
  zoneSnaps = []
  const zones = itemListEl.querySelectorAll(
    "[data-zone]"
  ) as NodeListOf<HTMLElement>
  for (const zoneEl of zones) {
    const location = zoneEl.dataset.zone as "top-level" | "folder"
    const folderId =
      location === "folder" ? zoneEl.dataset.folderId ?? null : null
    const rows = Array.from(
      zoneEl.querySelectorAll("[data-id]")
    ) as HTMLElement[]
    const zoneRect = zoneEl.getBoundingClientRect()
    const scrollTop = zoneEl.scrollTop

    const snaps: RowSnap[] = rows.map((row, i) => {
      const rect = row.getBoundingClientRect()
      return {
        id: row.dataset.id!,
        type: row.dataset.type as "shortcut" | "folder",
        index: i,
        contentTop: rect.top - zoneRect.top + scrollTop,
        height: rect.height,
        left: rect.left,
        width: rect.width,
      }
    })

    let stride = snaps.length > 0 ? snaps[0].height : 0
    if (snaps.length >= 2) stride = snaps[1].contentTop - snaps[0].contentTop

    zoneSnaps.push({ location, folderId, rows: snaps, stride, el: zoneEl })
  }
}

function createClone(
  sourceEl: HTMLElement,
  isSelection: boolean,
  count: number
): HTMLElement {
  const clone = sourceEl.cloneNode(true) as HTMLElement
  const rect = sourceEl.getBoundingClientRect()
  clone.style.cssText = `
    position: fixed;
    width: ${rect.width}px;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.9;
    transform: scale(0.97);
    transition: transform 150ms ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `
  clone.classList.remove("opacity-50")

  if (isSelection && count > 1) {
    const badge = document.createElement("span")
    badge.className =
      "absolute -top-2 -right-2 bg-accent text-accent-foreground text-xs font-medium rounded-full px-1.5 py-0.5 leading-none"
    badge.textContent = `+${count - 1}`
    clone.appendChild(badge)
  }

  dialogEl.appendChild(clone)
  return clone
}

function startDrag(e: PointerEvent): void {
  if (!ctx) return

  if (ctx.mode === "item") {
    const row = itemListEl.querySelector(
      `[data-id="${ctx.sourceItemId}"]`
    ) as HTMLElement | null
    if (!row) {
      cleanup()
      return
    }
    ctx.clone = createClone(row, ctx.isSelectionDrag, ctx.draggedIds.length)
    positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)

    if (ctx.isSelectionDrag) {
      ctx.draggedIds.forEach((id) => {
        itemListEl
          .querySelectorAll(`[data-id="${id}"]`)
          .forEach((el) => el.classList.add("opacity-50"))
      })
    } else {
      row.style.opacity = "0"
    }
    snapshotZones()
  } else if (ctx.mode === "tab") {
    const pill = tabBarEl.querySelector(
      `[data-tab-id="${ctx.sourceTabId}"]`
    ) as HTMLElement | null
    if (!pill) {
      cleanup()
      return
    }
    ctx.clone = createClone(pill, false, 1)
    positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)
    pill.classList.add("opacity-50")
  }

  document.addEventListener("keydown", onKeyDown)
}

function updateDrag(e: PointerEvent): void {
  if (!ctx) return
  positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)

  if (ctx.mode === "item") {
    autoScroll(e.clientY)
    const zone = resolveDropZone(e.clientX, e.clientY)
    updateHoverTimer(zone)
    applyVisualFeedback(zone)
  } else if (ctx.mode === "tab") {
    updateTabDrag(e)
  }
}

function resolveDropZone(x: number, y: number): DropZone {
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const el = document.elementFromPoint(x, y)
  if (el) {
    const pill = el.closest("[data-tab-id]") as HTMLElement | null
    if (pill && tabBarEl.contains(pill)) {
      return { type: "tab", tabId: pill.dataset.tabId! }
    }
  }

  const listRect = itemListEl.getBoundingClientRect()
  if (
    x < listRect.left ||
    x > listRect.right ||
    y < listRect.top ||
    y > listRect.bottom
  ) {
    return { type: "none" }
  }

  for (const snap of zoneSnaps) {
    const zoneRect = snap.el.getBoundingClientRect()
    if (
      x < zoneRect.left ||
      x > zoneRect.right ||
      y < zoneRect.top ||
      y > zoneRect.bottom
    )
      continue

    if (snap.rows.length === 0) {
      if (ctx.sourceType === "folder" && snap.location === "folder")
        return { type: "none" }
      return { type: "reorder", location: snap.location, index: 0 }
    }

    const contentY = y - zoneRect.top + snap.el.scrollTop

    let hitRow: RowSnap | null = null
    for (const row of snap.rows) {
      if (
        contentY >= row.contentTop &&
        contentY < row.contentTop + row.height
      ) {
        hitRow = row
        break
      }
    }

    if (!hitRow) {
      if (ctx.sourceType === "folder" && snap.location === "folder")
        return { type: "none" }
      return {
        type: "reorder",
        location: snap.location,
        index: snap.rows.length,
      }
    }

    if (hitRow.id === ctx.sourceItemId && !ctx.isSelectionDrag)
      return { type: "none" }
    if (ctx.isSelectionDrag && ctx.draggedIds.includes(hitRow.id))
      return { type: "none" }
    if (ctx.sourceType === "folder" && snap.location === "folder")
      return { type: "none" }

    if (ctx.isSelectionDrag) {
      return resolveSelectionSnap(hitRow, snap, contentY)
    }
    return resolveNormalSnap(hitRow, snap, contentY)
  }

  const fallback = zoneSnaps.find((s) => s.location === "top-level")
  if (fallback && fallback.rows.length > 0) {
    return {
      type: "reorder",
      location: "top-level",
      index: fallback.rows.length,
    }
  }
  return { type: "none" }
}

function resolveNormalSnap(
  hit: RowSnap,
  snap: ZoneSnap,
  contentY: number
): DropZone {
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const midY = hit.contentTop + hit.height / 2
  const overCenter = Math.abs(contentY - midY) < hit.height * 0.25
  const isDraggingFolder = ctx.sourceType === "folder"
  const isInsideFolder = snap.location === "folder"

  if (overCenter && !isDraggingFolder && !isInsideFolder) {
    if (hit.type === "folder") {
      const tabs = cb.getTabs()
      const tab = tabs.find((t) => t.id === cb.getSelectedTabId())
      const folder = tab?.items.find(
        (i) => i.id === hit.id && i.type === "folder"
      ) as Folder | undefined
      const blocked =
        !folder || folder.children.length >= MAX_CHILDREN_PER_FOLDER
      return { type: "into-folder", folderId: hit.id, blocked }
    }
    if (hit.type === "shortcut") {
      if (ctx.mergeReady && ctx.hoverTarget?.id === hit.id) {
        return { type: "merge-shortcut", targetId: hit.id }
      }
      return { type: "into-folder", folderId: hit.id, blocked: false }
    }
  }

  const insertIndex = contentY < midY ? hit.index : hit.index + 1
  return { type: "reorder", location: snap.location, index: insertIndex }
}

function resolveSelectionSnap(
  hit: RowSnap,
  snap: ZoneSnap,
  contentY: number
): DropZone {
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const midY = hit.contentTop + hit.height / 2
  const overCenter = Math.abs(contentY - midY) < hit.height * 0.25

  if (overCenter && hit.type === "folder" && snap.location !== "folder") {
    const blocked = ctx.selectionHasFolders
    if (!blocked) {
      const tabs = cb.getTabs()
      const tab = tabs.find((t) => t.id === cb.getSelectedTabId())
      const folder = tab?.items.find(
        (i) => i.id === hit.id && i.type === "folder"
      ) as Folder | undefined
      const capacityBlocked =
        !folder ||
        folder.children.length + ctx.draggedIds.length > MAX_CHILDREN_PER_FOLDER
      return { type: "into-folder", folderId: hit.id, blocked: capacityBlocked }
    }
    return { type: "into-folder", folderId: hit.id, blocked: true }
  }

  return { type: "none" }
}

function updateHoverTimer(zone: DropZone): void {
  if (!ctx || ctx.mode !== "item") return

  let newTarget: ItemDragCtx["hoverTarget"] = null

  if (zone.type === "tab") {
    newTarget = { type: "tab", id: zone.tabId }
  } else if (zone.type === "into-folder" && !zone.blocked) {
    const row = itemListEl.querySelector(`[data-id="${zone.folderId}"]`)
    const targetType = row?.getAttribute("data-type")
    if (targetType === "folder") {
      newTarget = { type: "folder", id: zone.folderId }
    } else if (targetType === "shortcut") {
      newTarget = { type: "shortcut", id: zone.folderId }
    }
  }

  const same =
    ctx.hoverTarget?.type === newTarget?.type &&
    ctx.hoverTarget?.id === newTarget?.id

  if (same) return

  if (ctx.hoverTimer !== null) {
    clearTimeout(ctx.hoverTimer)
    ctx.hoverTimer = null
  }
  clearHoverAnimation()
  ctx.hoverTarget = newTarget
  ctx.mergeReady = false

  if (!newTarget) return

  if (newTarget.type === "tab" && ctx.isSelectionDrag) return

  startHoverAnimation(newTarget)

  ctx.hoverTimer = window.setTimeout(() => {
    if (!ctx || ctx.mode !== "item") return
    ctx.hoverTimer = null
    onHoverTimerFire(newTarget!)
  }, HOVER_DELAY)
}

function clearHoverAnimation(): void {
  if (!ctx || ctx.mode !== "item") return
  if (ctx.hoverPhase2Timer !== null) {
    clearTimeout(ctx.hoverPhase2Timer)
    ctx.hoverPhase2Timer = null
  }
  if (ctx.hoverAnimEl) {
    ctx.hoverAnimEl.style.transition = ""
    ctx.hoverAnimEl.style.backgroundColor = ""
    ctx.hoverAnimEl.style.color = ""
    ctx.hoverAnimEl.style.boxShadow = ""
    const input = ctx.hoverAnimEl.querySelector("input") as HTMLElement | null
    if (input) {
      input.style.transition = ""
      input.style.color = ""
    }
    ctx.hoverAnimEl = null
  }
}

function startHoverAnimation(
  target: NonNullable<ItemDragCtx["hoverTarget"]>
): void {
  if (!ctx || ctx.mode !== "item") return

  if (target.type === "tab") {
    if (target.id === cb.getSelectedTabId()) return
    const pill = tabBarEl.querySelector(
      `[data-tab-id="${target.id}"]`
    ) as HTMLElement | null
    if (!pill) return
    ctx.hoverAnimEl = pill
    pill.style.backgroundColor =
      "color-mix(in srgb, var(--accent) 10%, transparent)"
    ctx.hoverPhase2Timer = window.setTimeout(() => {
      if (!ctx || ctx.mode !== "item") return
      pill.style.transition = "background-color 750ms ease, color 750ms ease"
      pill.style.backgroundColor = "var(--accent)"
      pill.style.color = "var(--accent-foreground)"
      const input = pill.querySelector("input") as HTMLElement | null
      if (input) {
        input.style.transition = "color 750ms ease"
        input.style.color = "var(--accent-foreground)"
      }
    }, 250)
  } else if (target.type === "folder") {
    const row = itemListEl.querySelector(
      `[data-id="${target.id}"]`
    ) as HTMLElement | null
    if (!row) return
    ctx.hoverAnimEl = row
    row.style.boxShadow = "0 0 0 0px var(--accent)"
    ctx.hoverPhase2Timer = window.setTimeout(() => {
      if (!ctx || ctx.mode !== "item") return
      row.style.transition = "box-shadow 750ms ease"
      row.style.boxShadow = "0 0 0 2px var(--accent)"
    }, 250)
  }
}

function onHoverTimerFire(
  target: NonNullable<ItemDragCtx["hoverTarget"]>
): void {
  if (!ctx || ctx.mode !== "item") return

  switch (target.type) {
    case "tab":
      cb.setSelectedTabId(target.id)
      cb.setViewingFolderId(null)
      cb.render()
      if (ctx.isSelectionDrag) {
        ctx.draggedIds.forEach((id) => {
          itemListEl
            .querySelectorAll(`[data-id="${id}"]`)
            .forEach((el) => el.classList.add("opacity-50"))
        })
      } else {
        const row = itemListEl.querySelector(
          `[data-id="${ctx.sourceItemId}"]`
        ) as HTMLElement | null
        if (row) row.style.opacity = "0"
      }
      snapshotZones()
      break

    case "folder":
      cb.setViewingFolderId(target.id)
      cb.render()
      if (ctx.isSelectionDrag) {
        ctx.draggedIds.forEach((id) => {
          itemListEl
            .querySelectorAll(`[data-id="${id}"]`)
            .forEach((el) => el.classList.add("opacity-50"))
        })
      } else {
        const row = itemListEl.querySelector(
          `[data-id="${ctx.sourceItemId}"]`
        ) as HTMLElement | null
        if (row) row.style.opacity = "0"
      }
      snapshotZones()
      break

    case "shortcut":
      ctx.mergeReady = true
      break
  }
}

function applyVisualFeedback(zone: DropZone): void {
  clearVisualFeedback()

  if (!ctx || ctx.mode !== "item") return

  if (zone.type === "reorder") {
    applyReorderTransforms(zone)
  } else {
    resetReorderTransforms()
  }

  const shrinkZone = zone.type === "into-folder" && !zone.blocked
  const shrinkTab = zone.type === "tab" && ctx.isSelectionDrag
  ctx.clone.style.transform =
    shrinkZone || shrinkTab ? "scale(0.9)" : "scale(0.97)"

  switch (zone.type) {
    case "reorder": {
      const zoneSelector =
        zone.location === "folder"
          ? "[data-zone='folder']"
          : "[data-zone='top-level']"
      const zoneEl = itemListEl.querySelector(zoneSelector)
      if (zoneEl && !zoneEl.querySelector("[data-id]")) {
        zoneEl.classList.add("ring-2", "ring-accent/50", "bg-accent/5")
      }
      break
    }
    case "into-folder":
      showFolderHighlight(zone)
      break
    case "merge-shortcut":
      showMergeHighlight(zone.targetId)
      break
    case "tab":
      showTabHighlight(zone.tabId)
      break
  }
}

function applyReorderTransforms(
  zone: Extract<DropZone, { type: "reorder" }>
): void {
  if (!ctx || ctx.mode !== "item") return

  const snap = zoneSnaps.find((s) => s.location === zone.location)
  if (!snap || snap.rows.length === 0) {
    preview.style.display = "none"
    return
  }

  const rows = Array.from(
    snap.el.querySelectorAll("[data-id]")
  ) as HTMLElement[]
  if (rows.length !== snap.rows.length) {
    preview.style.display = "none"
    return
  }

  const itemCtx = ctx as ItemDragCtx
  const S = snap.rows.findIndex((r) => r.id === itemCtx.sourceItemId)
  const D = zone.index
  const sameZone = S !== -1
  const noGap = sameZone && (D === S || D === S + 1)
  const stride = snap.stride

  for (let i = 0; i < rows.length; i++) {
    let ty = 0
    if (sameZone) {
      if (D < S && i >= D && i < S) ty = stride
      else if (D > S + 1 && i > S && i < D) ty = -stride
    } else {
      if (i >= D) ty = stride
    }
    rows[i].style.transition = "transform 200ms ease"
    rows[i].style.transform = ty ? `translateY(${ty}px)` : ""
  }

  if (noGap) {
    preview.style.display = "none"
    return
  }

  const gapIndex = sameZone ? (D <= S ? D : D - 1) : D
  let gapContentTop: number
  if (gapIndex < snap.rows.length) {
    gapContentTop = snap.rows[gapIndex].contentTop
  } else {
    gapContentTop = snap.rows[snap.rows.length - 1].contentTop + stride
  }

  const zoneRect = snap.el.getBoundingClientRect()
  const gapViewportTop = zoneRect.top + gapContentTop - snap.el.scrollTop
  const d = dialogOffset()
  preview.style.display = ""
  preview.style.top = `${gapViewportTop - d.y}px`
  preview.style.left = `${snap.rows[0].left - d.x}px`
  preview.style.width = `${snap.rows[0].width}px`
  preview.style.height = `${snap.rows[0].height}px`
}

function resetReorderTransforms(): void {
  itemListEl.querySelectorAll("[data-id]").forEach((el) => {
    ;(el as HTMLElement).style.transform = ""
  })
  preview.style.display = "none"
}

function showFolderHighlight(
  zone: Extract<DropZone, { type: "into-folder" }>
): void {
  const row = itemListEl.querySelector(
    `[data-id="${zone.folderId}"]`
  ) as HTMLElement | null
  if (!row) return
  const targetType = row.dataset.type
  if (zone.blocked) {
    row.classList.add("bg-danger/30")
  } else if (targetType === "shortcut") {
    row.classList.add("bg-accent/10")
  } else {
    row.classList.add("bg-accent/20")
  }
}

function showMergeHighlight(targetId: string): void {
  const row = itemListEl.querySelector(
    `[data-id="${targetId}"]`
  ) as HTMLElement | null
  if (!row) return
  row.classList.add("bg-warning/20")
}

function showTabHighlight(tabId: string): void {
  const pill = tabBarEl.querySelector(
    `[data-tab-id="${tabId}"]`
  ) as HTMLElement | null
  if (!pill) return
  pill.classList.add("ring-2", "ring-accent/50", "bg-accent/10")
}

function updateTabDrag(e: PointerEvent): void {
  if (!ctx || ctx.mode !== "tab") return

  tabIndicator.style.display = "none"
  tabBarEl
    .querySelectorAll("[data-tab-id]")
    .forEach((el) => el.classList.remove("opacity-50"))
  const sourcePill = tabBarEl.querySelector(
    `[data-tab-id="${ctx.sourceTabId}"]`
  )
  sourcePill?.classList.add("opacity-50")

  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el) return
  const pill = el.closest("[data-tab-id]") as HTMLElement | null
  if (!pill || !tabBarEl.contains(pill)) return
  if (pill.dataset.tabId === ctx.sourceTabId) return

  const rect = pill.getBoundingClientRect()
  const midX = rect.left + rect.width / 2
  const insertLeft = e.clientX < midX

  const d = dialogOffset()
  tabIndicator.style.display = ""
  tabIndicator.style.left = `${
    (insertLeft ? rect.left - 1 : rect.right - 1) - d.x
  }px`
  tabIndicator.style.top = `${rect.top - d.y}px`
  tabIndicator.style.height = `${rect.height}px`
}

function processDrop(e: PointerEvent): void {
  if (!ctx) return

  if (ctx.mode === "tab") {
    processTabDrop(e)
    return
  }

  const zone = resolveDropZone(e.clientX, e.clientY)

  if (ctx.isSelectionDrag) {
    processSelectionDrop(zone)
    return
  }

  processNormalDrop(zone)
}

function processNormalDrop(zone: DropZone): void {
  if (!ctx || ctx.mode !== "item") return
  const currentTabId = cb.getSelectedTabId()
  if (!currentTabId) return

  let tabs = ctx.snapshot

  switch (zone.type) {
    case "reorder": {
      const sameTab = currentTabId === ctx.sourceTabId
      const sameLocation =
        (zone.location === "folder" && ctx.sourceFolderId !== null) ||
        (zone.location === "top-level" && ctx.sourceFolderId === null)

      if (sameTab && sameLocation) {
        const sourceIndex = Number(
          itemListEl
            .querySelector(`[data-id="${ctx.sourceItemId}"]`)
            ?.getAttribute("data-index") ?? 0
        )
        if (zone.location === "folder") {
          const folderId = cb.getViewingFolderId()
          if (folderId) {
            tabs = reorderFolderChildren(
              tabs,
              ctx.sourceTabId,
              folderId,
              sourceIndex,
              zone.index
            )
          }
        } else {
          tabs = reorderItems(tabs, ctx.sourceTabId, sourceIndex, zone.index)
        }
      } else {
        let item: TabItem
        ;[tabs, item] = extractItem(tabs, ctx.sourceTabId, ctx.sourceItemId)
        if (zone.location === "folder") {
          const folderId = cb.getViewingFolderId()
          if (folderId && item.type === "shortcut") {
            tabs = insertIntoFolder(
              tabs,
              currentTabId,
              folderId,
              item,
              zone.index
            )
          }
        } else {
          tabs = insertItem(tabs, currentTabId, item, zone.index)
        }
      }
      cb.save(tabs)
      break
    }

    case "into-folder": {
      if (zone.blocked) break
      const row = itemListEl.querySelector(`[data-id="${zone.folderId}"]`)
      const targetType = row?.getAttribute("data-type")

      if (targetType === "folder") {
        let item: TabItem
        ;[tabs, item] = extractItem(tabs, ctx.sourceTabId, ctx.sourceItemId)
        if (item.type === "shortcut") {
          tabs = insertIntoFolder(tabs, currentTabId, zone.folderId, item, 0)
        }
        cb.save(tabs)
      }
      break
    }

    case "merge-shortcut": {
      const anchor = itemListEl.querySelector(
        `[data-id="${zone.targetId}"]`
      ) as HTMLElement
      if (!anchor) break
      const snapshot = ctx.snapshot
      const sourceId = ctx.sourceItemId
      const targetId = zone.targetId
      const tabId = currentTabId
      cb.openCreateFolderPopover(
        anchor,
        (name, folderIcon) => {
          const merged = mergeShortcutsIntoNewFolder(
            snapshot,
            tabId,
            targetId,
            sourceId,
            name,
            folderIcon
          )
          cb.save(merged)
        },
        () => {
          cb.save(snapshot)
        }
      )
      break
    }
  }
}

function processSelectionDrop(zone: DropZone): void {
  if (!ctx || ctx.mode !== "item") return
  const currentTabId = cb.getSelectedTabId()
  if (!currentTabId) return

  let tabs = ctx.snapshot
  const ids = [...ctx.draggedIds]

  switch (zone.type) {
    case "tab": {
      const extracted: TabItem[] = []
      for (const id of ids) {
        let item: TabItem
        ;[tabs, item] = extractItem(tabs, ctx.sourceTabId, id)
        extracted.push(item)
      }
      for (let i = 0; i < extracted.length; i++) {
        tabs = insertItem(tabs, zone.tabId, extracted[i], i)
      }
      cb.setSelectedTabId(zone.tabId)
      cb.setViewingFolderId(null)
      cb.exitSelectionMode()
      cb.save(tabs)
      break
    }

    case "into-folder": {
      if (zone.blocked) break
      const extracted: Shortcut[] = []
      for (const id of ids) {
        let item: TabItem
        ;[tabs, item] = extractItem(tabs, ctx.sourceTabId, id)
        if (item.type === "shortcut") extracted.push(item)
      }
      for (let i = 0; i < extracted.length; i++) {
        tabs = insertIntoFolder(
          tabs,
          currentTabId,
          zone.folderId,
          extracted[i],
          i
        )
      }
      cb.exitSelectionMode()
      cb.save(tabs)
      break
    }
  }
}

function processTabDrop(e: PointerEvent): void {
  if (!ctx || ctx.mode !== "tab") return

  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el) return
  const pill = el.closest("[data-tab-id]") as HTMLElement | null
  if (!pill || !tabBarEl.contains(pill)) return

  const targetTabId = pill.dataset.tabId!
  if (targetTabId === ctx.sourceTabId) return

  const tabs = cb.getTabs()
  const toIndex = tabs.findIndex((t) => t.id === targetTabId)
  if (toIndex === -1) return

  const rect = pill.getBoundingClientRect()
  const midX = rect.left + rect.width / 2
  const insertBefore = e.clientX < midX
  const finalIndex = insertBefore ? toIndex : toIndex + 1

  const updated = reorderTabs(
    tabs,
    ctx.sourceIndex,
    finalIndex > ctx.sourceIndex ? finalIndex - 1 : finalIndex
  )
  cb.save(updated)
}
