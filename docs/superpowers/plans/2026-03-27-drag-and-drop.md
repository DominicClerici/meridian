# Drag and Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-list native HTML DnD with a unified pointer-event-based drag system supporting cross-tab, cross-column, timer-based hover expansion, tab reordering, and bulk selection drag.

**Architecture:** A single `shortcut-drag.ts` module attaches pointer event listeners to stable container elements (`sc-tab-bar`, `sc-item-list`) via event delegation. All drag state lives in module-level variables. Circular imports are avoided by passing all state access as a callbacks object. Four new pure functions in `shortcuts.ts` (extract/insert pattern) handle cross-location moves.

**Tech Stack:** Vanilla TypeScript, Pointer Events API, no dependencies.

**Spec:** `docs/superpowers/specs/2026-03-27-drag-and-drop-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/shortcuts.ts` | Modify (append) | Add `reorderTabs`, `extractItem`, `insertItem`, `insertIntoFolder` |
| `src/shortcut-drag.ts` | Create | All drag logic — state machine, hit testing, visuals, timers, drop |
| `src/shortcut-settings.ts` | Modify | Expose state accessors, add `data-*` attributes, always render drag handle, remove old `initDragAndDrop`, wire `initDrag` |

---

### Task 1: Add pure data functions to shortcuts.ts

**Files:**
- Modify: `src/shortcuts.ts` (append after line 301)

- [ ] **Step 1: Add `reorderTabs`**

Append to end of `src/shortcuts.ts`:

```ts
export function reorderTabs(tabs: Tab[], fromIndex: number, toIndex: number): Tab[] {
  const result = [...tabs]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}
```

- [ ] **Step 2: Add `extractItem`**

Append below `reorderTabs`:

```ts
export function extractItem(tabs: Tab[], tabId: string, itemId: string): [Tab[], TabItem] {
  let extracted: TabItem | null = null
  const updated = tabs.map((t) => {
    if (t.id !== tabId) return t
    const topIdx = t.items.findIndex((i) => i.id === itemId)
    if (topIdx !== -1) {
      extracted = t.items[topIdx]
      return { ...t, items: t.items.filter((i) => i.id !== itemId) }
    }
    let found = false
    const items = t.items.map((i) => {
      if (i.type !== "folder" || found) return i
      const childIdx = i.children.findIndex((c) => c.id === itemId)
      if (childIdx === -1) return i
      extracted = i.children[childIdx]
      found = true
      return { ...i, children: i.children.filter((c) => c.id !== itemId) }
    })
    return found ? { ...t, items } : t
  })
  return [updated, extracted!]
}
```

- [ ] **Step 3: Add `insertItem`**

Append below `extractItem`:

```ts
export function insertItem(
  tabs: Tab[],
  tabId: string,
  item: TabItem,
  index: number
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId || t.items.length >= MAX_ITEMS_PER_TAB) return t
    const items = [...t.items]
    items.splice(Math.min(index, items.length), 0, item)
    return { ...t, items }
  })
}
```

- [ ] **Step 4: Add `insertIntoFolder`**

Append below `insertItem`:

```ts
export function insertIntoFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcut: Shortcut,
  index: number
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => {
        if (i.id !== folderId || i.type !== "folder" || i.children.length >= MAX_CHILDREN_PER_FOLDER) return i
        const children = [...i.children]
        children.splice(Math.min(index, children.length), 0, shortcut)
        return { ...i, children }
      }),
    }
  })
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/shortcuts.ts
git commit -m "feat: add extract/insert/reorderTabs pure functions for drag-and-drop"
```

---

### Task 2: Create shortcut-drag.ts — types and scaffold

**Files:**
- Create: `src/shortcut-drag.ts`

- [ ] **Step 1: Create the file with types and DragCallbacks interface**

```ts
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

function onItemPointerDown(e: PointerEvent): void {}
function onTabPointerDown(e: PointerEvent): void {}
function onPointerMove(e: PointerEvent): void {}
function onPointerUp(e: PointerEvent): void {}
function onKeyDown(e: KeyboardEvent): void {}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (empty handler bodies are valid).

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: scaffold shortcut-drag.ts with types and DragCallbacks"
```

---

### Task 3: Pointer event scaffolding — pointerdown and state machine

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Implement `onItemPointerDown`**

Replace the empty `onItemPointerDown`:

```ts
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
```

- [ ] **Step 2: Implement `onPointerMove` (pending threshold check only)**

Replace the empty `onPointerMove`:

```ts
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
```

- [ ] **Step 3: Add empty `startDrag`, `updateDrag`, and complete `onPointerUp` and `onKeyDown`**

```ts
function startDrag(e: PointerEvent): void {
  // Will be filled in Task 4
}

function updateDrag(e: PointerEvent): void {
  // Will be filled in Tasks 5-7
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

function processDrop(e: PointerEvent): void {
  // Will be filled in Task 8
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
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement pointer event scaffolding and state machine"
```

---

### Task 4: Clone creation and cursor tracking

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Implement `createClone`**

Add above `startDrag`:

```ts
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
```

- [ ] **Step 2: Fill in `startDrag`**

Replace the empty `startDrag`:

```ts
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
  }

  document.addEventListener("keydown", onKeyDown)
}
```

- [ ] **Step 3: Add `positionClone` and auto-scroll**

Add above `createClone`:

```ts
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
```

- [ ] **Step 4: Fill in `updateDrag` with positioning**

Replace the empty `updateDrag`:

```ts
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
```

- [ ] **Step 5: Add stubs for functions not yet implemented**

```ts
function resolveDropZone(x: number, y: number): DropZone {
  return { type: "none" }
}

function updateHoverTimer(zone: DropZone): void {}

function applyVisualFeedback(zone: DropZone): void {}

function updateTabDrag(e: PointerEvent): void {}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement clone creation and cursor tracking"
```

---

### Task 5: Hit testing — resolveDropZone

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Replace the `resolveDropZone` stub**

```ts
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

  const rect2 = row.getBoundingClientRect()
  const index = Number(row.dataset.index)
  const insertIndex = y < rect2.top + rect2.height / 2 ? index : index + 1
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement hit testing and drop zone resolution"
```

---

### Task 6: Visual feedback — indicator, highlights, shrink

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Replace the `applyVisualFeedback` stub**

```ts
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
  row.classList.add(zone.blocked ? "bg-danger/30" : "bg-accent/20")
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
```

- [ ] **Step 2: Also show pre-timer feedback in `applyVisualFeedback`**

The `into-folder` zone on a shortcut (pre-merge, where `mergeReady` is false) shows `bg-accent/10`. This is already handled: `resolveNormalZone` returns `{ type: "into-folder", folderId: targetId, blocked: false }` for a shortcut center before merge timer fires. `showFolderHighlight` applies `bg-accent/20` for allowed. We want `bg-accent/10` for the pre-merge "keep hovering" state.

Update `showFolderHighlight`:

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement visual feedback — indicator, highlights, shrink"
```

---

### Task 7: Timer system — hover expansion

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Replace the `updateHoverTimer` stub**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement timer system for hover expansion"
```

---

### Task 8: Drop processing — normal item drag

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Replace the `processDrop` stub**

```ts
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
  // Will be filled in Task 9
}

function processTabDrop(e: PointerEvent): void {
  // Will be filled in Task 10
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement drop processing for normal item drag"
```

---

### Task 9: Selection mode drag

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Replace the `processSelectionDrop` stub**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement selection mode drag and drop"
```

---

### Task 10: Tab bar drag

**Files:**
- Modify: `src/shortcut-drag.ts`

- [ ] **Step 1: Implement `onTabPointerDown`**

Replace the empty `onTabPointerDown`:

```ts
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
```

- [ ] **Step 2: Add tab clone creation to `startDrag`**

Add the tab branch inside `startDrag`, after the item branch:

```ts
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
```

- [ ] **Step 3: Implement `updateTabDrag`**

Replace the empty `updateTabDrag`:

```ts
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
```

- [ ] **Step 4: Implement `processTabDrop`**

Replace the empty `processTabDrop`:

```ts
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
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/shortcut-drag.ts
git commit -m "feat: implement tab bar drag and drop"
```

---

### Task 11: Integrate into shortcut-settings.ts

**Files:**
- Modify: `src/shortcut-settings.ts`

This task wires everything together: exposes state accessors, adds data attributes, always renders drag handles, removes old `initDragAndDrop`, and calls `initDrag`.

- [ ] **Step 1: Add import for `initDrag`**

At top of `src/shortcut-settings.ts`, add:

```ts
import { initDrag } from "./shortcut-drag"
```

- [ ] **Step 2: Export state accessors**

After the `render()` function (line 46), add:

```ts
export function getSelectedTabId(): string | null { return selectedTabId }
export function getViewingFolderId(): string | null { return viewingFolderId }
export function getSelectionMode(): boolean { return selectionMode }
export function getSelectedIds(): Set<string> { return selectedIds }

export function setSelectedTabId(id: string | null): void { selectedTabId = id }
export function setViewingFolderId(id: string | null): void { viewingFolderId = id }

export function exitSelectionMode(): void {
  selectionMode = false
  selectedIds.clear()
}
```

- [ ] **Step 3: Add `data-tab-id` to tab pills in `renderTabBar`**

In `renderTabBar`, after `pill.className = ...` (the pill creation block around line 220), add:

```ts
pill.dataset.tabId = tab.id
```

Also, in selection mode, remove the `pointerEvents = "none"` line (line 228) — the drag module needs to detect hovers on disabled pills. Keep the opacity:

```ts
if (selectionMode) {
  pill.style.opacity = "0.4"
}
```

- [ ] **Step 4: Always render drag handle in `createRow`, add `data-drag-handle`**

Replace the block at lines 339-346:

```ts
if (!selectionMode) {
  row.draggable = true

  const handle = document.createElement("span")
  handle.className = "cursor-grab text-muted shrink-0"
  handle.appendChild(icon("dragHandle", { size: 10 }))
  row.appendChild(handle)
}
```

With:

```ts
const handle = document.createElement("span")
handle.dataset.dragHandle = ""
handle.className = "cursor-grab text-muted shrink-0"
handle.appendChild(icon("dragHandle", { size: 10 }))
row.appendChild(handle)
```

This removes `draggable = true` and always renders the handle (both normal and selection mode).

- [ ] **Step 5: Add `data-zone` to list containers in `renderItemList`**

In the flat view branch (around line 438), after creating the `list` div, add:

```ts
list.dataset.zone = "top-level"
```

In the split view branch, after creating `leftCol` (around line 471), add:

```ts
leftCol.dataset.zone = "top-level"
```

After creating `rightCol` (around line 498), add:

```ts
rightCol.dataset.zone = "folder"
rightCol.dataset.folderId = viewingFolderId!
```

- [ ] **Step 6: Delete `initDragAndDrop` and its calls**

Delete the entire `initDragAndDrop` function (lines 659-813).

Remove these three call sites in `renderItemList`:
- Line 466: `if (!selectionMode) initDragAndDrop(list, false, null)`
- Lines 518-521: `if (!selectionMode) { initDragAndDrop(leftCol, false, null); initDragAndDrop(rightCol, true, folder!) }`

- [ ] **Step 7: Wire `initDrag` in `initShortcutSettings`**

Replace the body of `initShortcutSettings` (lines 836-848):

```ts
export function initShortcutSettings(): void {
  tabBarEl = document.getElementById("sc-tab-bar")!
  itemListEl = document.getElementById("sc-item-list")!
  controlBarEl = document.getElementById("sc-control-bar")!

  const tabs = getTabs()
  if (tabs.length > 0 && !selectedTabId) {
    selectedTabId = tabs[0].id
  }

  render()
  store.local.subscribe("shortcuts", syncFromStore)

  initDrag(tabBarEl, itemListEl, {
    getTabs,
    save,
    render,
    getSelectedTabId: () => selectedTabId,
    getViewingFolderId: () => viewingFolderId,
    getSelectionMode: () => selectionMode,
    getSelectedIds: () => selectedIds,
    setSelectedTabId: (id) => { selectedTabId = id },
    setViewingFolderId: (id) => { viewingFolderId = id },
    exitSelectionMode: () => { selectionMode = false; selectedIds.clear() },
    openCreateFolderPopover,
  })
}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/shortcut-settings.ts
git commit -m "feat: integrate drag module, remove old initDragAndDrop"
```

---

### Task 12: Build, verify, and clean up

**Files:**
- All modified files

- [ ] **Step 1: Build**

Run: `./build.sh`
Expected: Successful build in `dist/`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Remove unused imports from shortcut-settings.ts**

The old `initDragAndDrop` used `reorderItems`, `reorderFolderChildren`, `moveShortcutIntoFolder`, `mergeShortcutsIntoNewFolder`, and `MAX_CHILDREN_PER_FOLDER` from the shortcuts import. Check if these are still used elsewhere in the file. If any import is only used in the deleted `initDragAndDrop`, remove it from the import statement.

Imports that should remain (used by non-drag code): `addTab`, `deleteTab`, `addShortcut`, `addFolder`, `deleteItem`, `deleteItems`, `editShortcut`, `editFolder`, `addShortcutToFolder`, `deleteShortcutFromFolder`, `editShortcutInFolder`, `MAX_TABS`.

Imports to remove (were only used by old DnD): `reorderItems`, `reorderFolderChildren`, `moveShortcutIntoFolder`, `mergeShortcutsIntoNewFolder`, `MAX_CHILDREN_PER_FOLDER`.

- [ ] **Step 4: Final type-check and build**

Run: `npx tsc --noEmit && ./build.sh`
Expected: No errors, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/shortcut-settings.ts
git commit -m "chore: remove unused imports after drag module extraction"
```
