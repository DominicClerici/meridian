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
  if (e.button !== 0) return
  if (cb.getSelectionMode()) return

  const pill = (e.target as HTMLElement).closest("[data-tab-id]") as HTMLElement | null
  if (!pill) return

  if ((e.target as HTMLElement).closest("input") || (e.target as HTMLElement).closest("button")) return

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
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const el = document.elementFromPoint(x, y)
  if (!el) return { type: "none" }

  const pill = el.closest("[data-tab-id]") as HTMLElement | null
  if (pill && tabBarEl.contains(pill)) {
    return { type: "tab", tabId: pill.dataset.tabId! }
  }

  if (!itemListEl.contains(el)) return { type: "none" }

  const row = el.closest("[data-id]") as HTMLElement | null
  const zoneEl = el.closest("[data-zone]") as HTMLElement | null

  if (!row) {
    if (!zoneEl) return { type: "none" }
    const location = zoneEl.dataset.zone as "top-level" | "folder"
    if (ctx.sourceType === "folder" && location === "folder") return { type: "none" }
    const rows = zoneEl.querySelectorAll("[data-id]")
    return { type: "reorder", location, index: rows.length }
  }

  const targetId = row.dataset.id!
  const targetType = row.dataset.type as "shortcut" | "folder"
  const location = zoneEl?.dataset.zone as "top-level" | "folder" | undefined ?? "top-level"

  if (targetId === ctx.sourceItemId && !ctx.isSelectionDrag) return { type: "none" }
  if (ctx.isSelectionDrag && ctx.draggedIds.includes(targetId)) return { type: "none" }
  if (ctx.sourceType === "folder" && location === "folder") return { type: "none" }

  if (ctx.isSelectionDrag) {
    return resolveSelectionZone(row, targetId, targetType, location, x, y)
  }

  return resolveNormalZone(row, targetId, targetType, location, x, y)
}

function resolveNormalZone(
  row: HTMLElement,
  targetId: string,
  targetType: string,
  location: string,
  _x: number,
  y: number
): DropZone {
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const rect = row.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  const overCenter = Math.abs(y - midY) < rect.height * 0.25

  const isDraggingFolder = ctx.sourceType === "folder"
  const isInsideFolder = location === "folder"

  if (overCenter && !isDraggingFolder && !isInsideFolder) {
    if (targetType === "folder") {
      const tabs = cb.getTabs()
      const tab = tabs.find((t) => t.id === cb.getSelectedTabId())
      const folder = tab?.items.find((i) => i.id === targetId && i.type === "folder") as Folder | undefined
      const blocked = !folder || folder.children.length >= MAX_CHILDREN_PER_FOLDER
      return { type: "into-folder", folderId: targetId, blocked }
    }
    if (targetType === "shortcut") {
      if (ctx.mergeReady && ctx.hoverTarget?.id === targetId) {
        return { type: "merge-shortcut", targetId }
      }
      return { type: "into-folder", folderId: targetId, blocked: false }
    }
  }

  const index = Number(row.dataset.index)
  const insertIndex = y < rect.top + rect.height / 2 ? index : index + 1
  return { type: "reorder", location: location as "top-level" | "folder", index: insertIndex }
}

function resolveSelectionZone(
  row: HTMLElement,
  targetId: string,
  targetType: string,
  location: string,
  _x: number,
  y: number
): DropZone {
  if (!ctx || ctx.mode !== "item") return { type: "none" }

  const rect = row.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  const overCenter = Math.abs(y - midY) < rect.height * 0.25

  if (overCenter && targetType === "folder" && location !== "folder") {
    const blocked = ctx.selectionHasFolders
    if (!blocked) {
      const tabs = cb.getTabs()
      const tab = tabs.find((t) => t.id === cb.getSelectedTabId())
      const folder = tab?.items.find((i) => i.id === targetId && i.type === "folder") as Folder | undefined
      const capacityBlocked = !folder || folder.children.length + ctx.draggedIds.length > MAX_CHILDREN_PER_FOLDER
      return { type: "into-folder", folderId: targetId, blocked: capacityBlocked }
    }
    return { type: "into-folder", folderId: targetId, blocked: true }
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

  const same = ctx.hoverTarget?.type === newTarget?.type && ctx.hoverTarget?.id === newTarget?.id

  if (same) return

  if (ctx.hoverTimer !== null) {
    clearTimeout(ctx.hoverTimer)
    ctx.hoverTimer = null
  }
  ctx.hoverTarget = newTarget
  ctx.mergeReady = false

  if (!newTarget) return

  if (newTarget.type === "tab" && ctx.isSelectionDrag) return

  ctx.hoverTimer = window.setTimeout(() => {
    if (!ctx || ctx.mode !== "item") return
    ctx.hoverTimer = null
    onHoverTimerFire(newTarget!)
  }, HOVER_DELAY)
}

function onHoverTimerFire(target: NonNullable<ItemDragCtx["hoverTarget"]>): void {
  if (!ctx || ctx.mode !== "item") return

  switch (target.type) {
    case "tab":
      cb.setSelectedTabId(target.id)
      cb.setViewingFolderId(null)
      cb.render()
      if (ctx.isSelectionDrag) {
        ctx.draggedIds.forEach((id) => {
          itemListEl.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.add("opacity-50"))
        })
      } else {
        const row = itemListEl.querySelector(`[data-id="${ctx.sourceItemId}"]`)
        row?.classList.add("opacity-50")
      }
      break

    case "folder":
      cb.setViewingFolderId(target.id)
      cb.render()
      if (ctx.isSelectionDrag) {
        ctx.draggedIds.forEach((id) => {
          itemListEl.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.add("opacity-50"))
        })
      } else {
        const row = itemListEl.querySelector(`[data-id="${ctx.sourceItemId}"]`)
        row?.classList.add("opacity-50")
      }
      break

    case "shortcut":
      ctx.mergeReady = true
      break
  }
}

function applyVisualFeedback(zone: DropZone): void {
  clearVisualFeedback()
  indicator.style.display = "none"

  if (!ctx || ctx.mode !== "item") return

  const shrinkZone = zone.type === "into-folder" && !zone.blocked
  const shrinkTab = zone.type === "tab" && ctx.isSelectionDrag
  ctx.clone.style.transform = (shrinkZone || shrinkTab) ? "scale(0.9)" : "scale(0.97)"

  switch (zone.type) {
    case "reorder":
      showReorderIndicator(zone)
      break
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

function showReorderIndicator(zone: Extract<DropZone, { type: "reorder" }>): void {
  const zoneEl = itemListEl.querySelector(`[data-zone="${zone.location}"]`) as HTMLElement | null
  if (!zoneEl) return

  const rows = Array.from(zoneEl.querySelectorAll("[data-id]")) as HTMLElement[]
  let targetRow: HTMLElement | null = null

  if (zone.index < rows.length) {
    targetRow = rows[zone.index]
  }

  if (targetRow) {
    const rect = targetRow.getBoundingClientRect()
    indicator.style.display = ""
    indicator.style.top = `${rect.top - 1}px`
    indicator.style.left = `${rect.left}px`
    indicator.style.width = `${rect.width}px`
  } else if (rows.length > 0) {
    const lastRect = rows[rows.length - 1].getBoundingClientRect()
    indicator.style.display = ""
    indicator.style.top = `${lastRect.bottom - 1}px`
    indicator.style.left = `${lastRect.left}px`
    indicator.style.width = `${lastRect.width}px`
  }
}

function showFolderHighlight(zone: Extract<DropZone, { type: "into-folder" }>): void {
  const row = itemListEl.querySelector(`[data-id="${zone.folderId}"]`) as HTMLElement | null
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
  const row = itemListEl.querySelector(`[data-id="${targetId}"]`) as HTMLElement | null
  if (!row) return
  row.classList.add("bg-warning/20")
}

function showTabHighlight(tabId: string): void {
  const pill = tabBarEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null
  if (!pill) return
  pill.classList.add("ring-2", "ring-accent/50")
}

function updateTabDrag(e: PointerEvent): void {
  if (!ctx || ctx.mode !== "tab") return

  tabIndicator.style.display = "none"
  tabBarEl.querySelectorAll("[data-tab-id]").forEach((el) => el.classList.remove("opacity-50"))
  const sourcePill = tabBarEl.querySelector(`[data-tab-id="${ctx.sourceTabId}"]`)
  sourcePill?.classList.add("opacity-50")

  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el) return
  const pill = el.closest("[data-tab-id]") as HTMLElement | null
  if (!pill || !tabBarEl.contains(pill)) return
  if (pill.dataset.tabId === ctx.sourceTabId) return

  const rect = pill.getBoundingClientRect()
  const midX = rect.left + rect.width / 2
  const insertLeft = e.clientX < midX

  tabIndicator.style.display = ""
  tabIndicator.style.left = `${insertLeft ? rect.left - 1 : rect.right - 1}px`
  tabIndicator.style.top = `${rect.top}px`
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
          itemListEl.querySelector(`[data-id="${ctx.sourceItemId}"]`)?.getAttribute("data-index") ?? 0
        )
        if (zone.location === "folder") {
          const folderId = cb.getViewingFolderId()
          if (folderId) {
            tabs = reorderFolderChildren(tabs, ctx.sourceTabId, folderId, sourceIndex, zone.index)
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
            tabs = insertIntoFolder(tabs, currentTabId, folderId, item, zone.index)
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
      const anchor = itemListEl.querySelector(`[data-id="${zone.targetId}"]`) as HTMLElement
      if (!anchor) break
      const snapshot = ctx.snapshot
      const sourceId = ctx.sourceItemId
      const targetId = zone.targetId
      const tabId = currentTabId
      cb.openCreateFolderPopover(
        anchor,
        (name) => {
          const merged = mergeShortcutsIntoNewFolder(snapshot, tabId, targetId, sourceId, name)
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
      cb.save(tabs)
      cb.setSelectedTabId(zone.tabId)
      cb.setViewingFolderId(null)
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
        tabs = insertIntoFolder(tabs, currentTabId, zone.folderId, extracted[i], i)
      }
      cb.save(tabs)
      break
    }
  }

  cb.exitSelectionMode()
  cb.render()
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

  const updated = reorderTabs(tabs, ctx.sourceIndex, finalIndex > ctx.sourceIndex ? finalIndex - 1 : finalIndex)
  cb.save(updated)
}
