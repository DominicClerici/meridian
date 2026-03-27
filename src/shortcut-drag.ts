import type { Tab, TabItem, Folder, Shortcut } from "./shortcuts"
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
    onSave: (name: string) => void,
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
let indicator: HTMLElement
let tabIndicator: HTMLElement

const DRAG_THRESHOLD = 3
const HOVER_DELAY = 300
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

  indicator = document.createElement("div")
  indicator.className = "fixed h-0.5 bg-accent rounded-full pointer-events-none z-[9999]"
  indicator.style.display = "none"
  document.body.appendChild(indicator)

  tabIndicator = document.createElement("div")
  tabIndicator.className = "fixed w-0.5 bg-accent rounded-full pointer-events-none z-[9999]"
  tabIndicator.style.display = "none"
  document.body.appendChild(tabIndicator)

  itemListEl.addEventListener("pointerdown", onItemPointerDown)
  tabBarEl.addEventListener("pointerdown", onTabPointerDown)
}

function onItemPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const handle = (e.target as HTMLElement).closest("[data-drag-handle]") as HTMLElement | null
  if (!handle) return
  const row = handle.closest("[data-id]") as HTMLElement | null
  if (!row) return

  const itemId = row.dataset.id!
  const itemType = row.dataset.type as "shortcut" | "folder"
  const selectedTabId = cb.getSelectedTabId()
  if (!selectedTabId) return

  if (cb.getViewingFolderId() === itemId) return

  const isSelection = cb.getSelectionMode()
  if (isSelection && !cb.getSelectedIds().has(itemId)) return

  const zone = row.closest("[data-zone]") as HTMLElement | null
  const folderId = zone?.dataset.zone === "folder" ? (zone.dataset.folderId ?? null) : null

  const tabs = cb.getTabs()
  const draggedIds = isSelection ? Array.from(cb.getSelectedIds()) : [itemId]
  const selectionHasFolders = isSelection && draggedIds.some((id) => {
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
    mergeReady: false,
  }

  state = "pending"
  pendingStart = { x: e.clientX, y: e.clientY }

  e.preventDefault()
  document.addEventListener("pointermove", onPointerMove)
  document.addEventListener("pointerup", onPointerUp)
}

function onTabPointerDown(e: PointerEvent): void {
  // Placeholder — will be fully implemented later
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
    if (ctx.mode === "item" && ctx.hoverTimer !== null) {
      clearTimeout(ctx.hoverTimer)
    }
    ctx.clone?.remove()
  }
  ctx = null
  state = "idle"
  pendingStart = null
  indicator.style.display = "none"
  tabIndicator.style.display = "none"
  clearVisualFeedback()
  document.removeEventListener("pointermove", onPointerMove)
  document.removeEventListener("pointerup", onPointerUp)
  document.removeEventListener("keydown", onKeyDown)
}

function clearVisualFeedback(): void {
  itemListEl.querySelectorAll("[data-id]").forEach((el) => {
    el.classList.remove("bg-accent/20", "bg-accent/10", "bg-warning/20", "bg-danger/30", "opacity-50")
  })
  tabBarEl.querySelectorAll("[data-tab-id]").forEach((el) => {
    el.classList.remove("ring-2", "ring-accent/50")
  })
}

function positionClone(clone: HTMLElement, clientX: number, clientY: number, offsetX: number, offsetY: number): void {
  clone.style.left = `${clientX - offsetX}px`
  clone.style.top = `${clientY - offsetY}px`
}

function autoScroll(clientY: number): void {
  const rect = itemListEl.getBoundingClientRect()
  if (clientY - rect.top < AUTO_SCROLL_THRESHOLD && itemListEl.scrollTop > 0) {
    itemListEl.scrollBy(0, -AUTO_SCROLL_SPEED)
  } else if (rect.bottom - clientY < AUTO_SCROLL_THRESHOLD) {
    itemListEl.scrollBy(0, AUTO_SCROLL_SPEED)
  }
}

function createClone(sourceEl: HTMLElement, isSelection: boolean, count: number): HTMLElement {
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
    badge.className = "absolute -top-2 -right-2 bg-accent text-accent-foreground text-xs font-medium rounded-full px-1.5 py-0.5 leading-none"
    badge.textContent = `+${count - 1}`
    clone.appendChild(badge)
  }

  document.body.appendChild(clone)
  return clone
}

function startDrag(e: PointerEvent): void {
  if (!ctx) return

  if (ctx.mode === "item") {
    const row = itemListEl.querySelector(`[data-id="${ctx.sourceItemId}"]`) as HTMLElement | null
    if (!row) { cleanup(); return }
    ctx.clone = createClone(row, ctx.isSelectionDrag, ctx.draggedIds.length)
    positionClone(ctx.clone, e.clientX, e.clientY, ctx.offsetX, ctx.offsetY)

    if (ctx.isSelectionDrag) {
      ctx.draggedIds.forEach((id) => {
        itemListEl.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.add("opacity-50"))
      })
    } else {
      row.classList.add("opacity-50")
    }
  } else if (ctx.mode === "tab") {
    const pill = tabBarEl.querySelector(`[data-tab-id="${ctx.sourceTabId}"]`) as HTMLElement | null
    if (!pill) { cleanup(); return }
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
  return { type: "none" }
}

function updateHoverTimer(zone: DropZone): void {}

function applyVisualFeedback(zone: DropZone): void {}

function updateTabDrag(e: PointerEvent): void {}

function processDrop(e: PointerEvent): void {}
