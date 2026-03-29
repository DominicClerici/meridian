# Drag and Drop Design — Shortcuts Settings UI

## Overview

Replaces the current per-list native HTML DnD with a unified pointer-event-based drag system. Supports cross-tab, cross-column, timer-based hover expansion, tab bar reordering, and bulk selection drag.

## Architecture & File Structure

### New file: `src/shortcut-drag.ts`

Contains all drag logic. Exports one function: `initDrag(tabBarEl, itemListEl)`.

Pointer event listeners attach to the stable container elements (`sc-tab-bar`, `sc-item-list`) which survive re-renders. Uses event delegation — no re-attachment needed after `render()`.

### Dependency flow

```
shortcut-settings.ts
  ├── imports initDrag from shortcut-drag.ts
  ├── calls initDrag(tabBarEl, itemListEl) once during init
  └── exports state accessors for drag module

shortcut-drag.ts
  ├── imports pure functions from shortcuts.ts
  ├── imports UI state readers/setters from shortcut-settings.ts
  └── calls save() + render() after mutations

shortcuts.ts
  └── new pure functions: reorderTabs, extractItem, insertItem, insertIntoFolder
```

### State accessors exposed by shortcut-settings.ts

Read-only: `getSelectedTabId()`, `getViewingFolderId()`, `getSelectionMode()`, `getSelectedIds()`

Write (for timer-triggered view switches): `setSelectedTabId(id)`, `setViewingFolderId(id)`

Also: `render()` and `save()` (or drag module imports store directly).

### Changes to shortcut-settings.ts

- Delete `initDragAndDrop()` entirely
- Remove `initDragAndDrop` calls from `renderItemList()`
- Remove `draggable = true` from `createRow()` (pointer events on handle replace it)
- Add data attributes during render for hit testing:
  - `data-zone="top-level"` on flat list / left column
  - `data-zone="folder"` + `data-folder-id` on right column
  - `data-tab-id` on each tab pill

## Data Layer (shortcuts.ts)

### New pure functions

**`reorderTabs(tabs, fromIndex, toIndex): Tab[]`**
Reorder tabs in the tab bar. Same splice pattern as `reorderItems`.

**`extractItem(tabs, tabId, itemId): [Tab[], TabItem]`**
Removes an item by ID from wherever it lives — searches top-level items first, then each folder's children. Returns updated tabs and the extracted item.

**`insertItem(tabs, tabId, item, index): Tab[]`**
Insert a `TabItem` into a tab's top-level items at a specific index. Respects `MAX_ITEMS_PER_TAB`.

**`insertIntoFolder(tabs, tabId, folderId, shortcut, index): Tab[]`**
Insert a `Shortcut` into a folder's children at a specific index. Respects `MAX_CHILDREN_PER_FOLDER`.

### How drags resolve to functions

| Scenario | Operations |
|----------|-----------|
| Reorder in same list | `reorderItems` or `reorderFolderChildren` (existing) |
| Top-level shortcut to folder (same tab) | `extractItem` then `insertIntoFolder` |
| Folder child to top-level (same tab) | `extractItem` then `insertItem` |
| Folder child to different folder | `extractItem` then `insertIntoFolder` |
| Any item to different tab | `extractItem` then `insertItem` or `insertIntoFolder` |
| Merge two shortcuts | `mergeShortcutsIntoNewFolder` (existing) |
| Tab reorder | `reorderTabs` |
| Bulk move (selection) | Loop: `extractItem` each, then `insertItem` each |

## Drag Controller State Machine

### States

- **Idle** — listening for `pointerdown` on drag handles
- **Pending** — pointerdown fired, waiting for 3px movement to distinguish click from drag
- **Dragging** — clone visible, hit-testing on every pointermove

### Transitions

```
Idle -> Pending:     pointerdown on drag handle
Pending -> Dragging: pointermove exceeds 3px threshold
Pending -> Idle:     pointerup before threshold (was a click)
Dragging -> Idle:    pointerup (process drop) or Escape (cancel, restore snapshot)
```

### Drag context (captured at Pending -> Dragging)

```ts
interface DragContext {
  sourceTabId: string
  sourceItemId: string
  sourceType: "shortcut" | "folder"
  sourceFolderId: string | null    // null = top-level

  isSelectionDrag: boolean
  draggedIds: string[]             // [sourceItemId] in normal, all selected in selection
  selectionHasFolders: boolean

  clone: HTMLElement
  offsetX: number
  offsetY: number

  snapshot: Tab[]

  hoverTimer: number | null
  hoverTarget: { type: "tab" | "folder" | "shortcut"; id: string } | null
}
```

### Event listeners

- `pointerdown` on `itemListEl` and `tabBarEl` (delegated)
- `pointermove` and `pointerup` on `document` — attached only during Pending/Dragging
- `keydown` on `document` for Escape — attached only during Dragging

Tab bar drags use the same state machine with a context type flag. Pointerdown on a tab pill (not its input or close button) enters tab-drag mode.

## Hit Testing & Drop Zone Detection

On each `pointermove`, `document.elementFromPoint(x, y)` determines the target. The clone has `pointer-events: none`.

### Zone types

```ts
type DropZone =
  | { type: "reorder"; location: "top-level" | "folder"; index: number }
  | { type: "into-folder"; folderId: string; blocked?: boolean }
  | { type: "merge-shortcut"; targetId: string }
  | { type: "tab"; tabId: string }
  | { type: "none" }
```

### Resolution logic

1. **Hit a `[data-id]` row:**
   - Center zone (`|clientY - midY| < rect.height * 0.25`): active only for shortcuts over folders or other shortcuts (not folder drags). Produces `into-folder` or `merge-shortcut`.
   - Edge zone: produces `reorder`. Index from cursor position relative to row midpoint (above = before, below = after).

2. **Hit the tab bar:** walk to closest tab pill. Produces `{ type: "tab", tabId }`.

3. **Hit item list but not on a row:** produces `reorder` at end of list.

4. **Nothing relevant:** produces `none`.

### Cross-column in split view

Column containers get `data-zone="top-level"` (left) and `data-zone="folder"` (right). The hit element's `closest("[data-zone]")` determines which column.

### Constraints applied during hit testing

| Dragging | Over | Result |
|----------|------|--------|
| Folder | Folder center | Treated as reorder (folders can't nest) |
| Folder | Right column | `none` (can't drop folder into folder) |
| Selection with folders | Folder center | `into-folder` flagged as blocked |
| Any | Same row as source | `none` |
| Shortcut | Full folder center | `into-folder` flagged as blocked |

## Timer System

Single `hoverTimer` and `hoverTarget` in drag context. On each `pointermove`, compare current zone to stored target. Same target: timer continues. Different: clear old, start new. No target: clear.

### Timer actions

| Hover target | After 300ms | Effect |
|---|---|---|
| Tab pill | `setSelectedTabId()` + clear `viewingFolderId` + `render()` | View switches to hovered tab (flat view); drag continues |
| Folder center (shortcut drag) | `setViewingFolderId()` + `render()` | Split view opens; user can drop in right column |
| Shortcut center (shortcut drag) | Set `mergeReady` flag | Visual upgrades to merge highlight; drop produces `merge-shortcut` |

### Immediate feedback before timer fires

- Tab pill: `ring-2 ring-accent/50`
- Folder row: `bg-accent/10`
- Shortcut row: `bg-accent/10`

Full effect (tab switch, folder expand, merge highlight) triggers only after 300ms.

### Re-render during drag

Timer-triggered re-renders rebuild DOM inside containers. Drag survives because:
- Clone is on `document.body`
- Pointer events are on stable containers
- Drag context stores IDs, not DOM references
- Reorder indicator is on `document.body`
- Next `pointermove` hit-tests fresh DOM

## Visual Feedback

### Drag clone

- `cloneNode(true)` of grabbed row
- `position: fixed` on `document.body`, `pointer-events: none`, `z-index: 9999`
- Base transform: `scale(0.97)`, slight `box-shadow`, `opacity: 0.9`
- CSS `transition: transform 150ms ease` for animated shrink effect

### Source row dimming

Original row gets `opacity-50`. In selection mode, all selected rows get this.

### Reorder indicator

Single persistent `div` (2px tall, accent-colored, `position: fixed`) on `document.body`. Positioned above the target row using `getBoundingClientRect()` viewport coordinates. Hidden when zone is not `reorder`. Avoids layout-shifting border classes.

### Zone highlights on rows

Cleared from all rows on each `pointermove`, then reapplied:

| Zone | Class | Meaning |
|------|-------|---------|
| `into-folder` (allowed) | `bg-accent/20` | Will drop into folder |
| `into-folder` (full or blocked) | `bg-danger/30` | Blocked |
| `merge-shortcut` (pre-timer) | `bg-accent/10` | Keep hovering to merge |
| `merge-shortcut` (post-timer) | `bg-warning/20` | Drop to create folder |

### Tab pill highlights

| State | Style |
|-------|-------|
| Hover, pre-timer | `ring-2 ring-accent/50` |
| Hover, post-timer (switched) | Active tab styles (re-rendered) |
| Selection mode hover | `ring-2 ring-accent/50` (stays as preview) |

### Shrink-on-droppable

Clone animates to `scale(0.9)` when over a zone that drops INTO something (folder center, tab pill in selection mode). Returns to `scale(0.97)` when leaving. CSS transition handles animation.

### Selection mode "+N" badge

When `isSelectionDrag` and `draggedIds.length > 1`: small badge at top-right of clone showing `+{count - 1}`. Styled as `bg-accent text-accent-foreground text-xs rounded-full px-1.5`.

## Selection Mode Drag

### Starting

Only selected rows' drag handles are active. Grabbing one drags all selected. `draggedIds` from `selectedIds`. `selectionHasFolders` computed once at start.

### Drop zone differences

| Zone | Normal drag | Selection drag |
|------|------------|----------------|
| Reorder (edge) | Insert at index | Not allowed |
| Into folder (center) | Move single item | Move all (blocked if `selectionHasFolders`) |
| Merge shortcut | New folder from two | Not allowed |
| Tab pill hover | 300ms switch, drop in list | No switch. Drop directly on pill, items to index 0 |
| Tab pill drop | Not a drop zone | Is a drop zone |

### Tab bar in selection mode

Hover shows `ring-2 ring-accent/50` and clone shrinks. No 300ms timer. No tab switch. Releasing on pill drops all items at index 0 of that tab.

### Folder expansion in selection mode

300ms hover timer still works (when `selectionHasFolders` is false) to let user preview folder contents. The expanded right column is view-only during selection drag — not a valid drop zone (reorder zones don't apply in selection mode). The actual drop target remains the folder row's center zone in the left column. Direct drop on folder center also works without waiting for expansion.

### After drop

Exit selection mode, clear `selectedIds`, render. User returns to normal mode on the target tab.

## Tab Bar Drag

### Starting

`pointerdown` on tab pill (not its input or close button) when selection mode is off. Same 3px threshold.

### Behavior

- Clone of tab pill, fixed positioning, follows cursor
- Hit testing horizontal only among tab pills
- Vertical 2px accent line between pills as insertion indicator

### Drop

`reorderTabs(tabs, fromIndex, toIndex)` then save.

### Constraints

- Cannot drag tab into item list
- Cannot drag items into tab bar to create new tab
- Disabled during selection mode
