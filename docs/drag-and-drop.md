# Drag and Drop

The pointer-based drag engine for the shortcuts settings panel. **File:** `src/shortcut-drag.ts` (1127 lines).

Not HTML5 drag-and-drop — Pointer Events throughout, because HTML5 DnD can't do live reorder animation, hover-to-drill, or a custom drag image that isn't a screenshot.

`shortcut-drag.ts` imports only `shortcuts.ts`. It never touches the store and never queries the DOM for state it wasn't handed: everything it needs comes through a `DragCallbacks` object.

```ts
initDrag(tabBarEl, itemListEl, {
  getTabs, save, render,
  getSelectedTabId, getViewingFolderId, getSelectionMode, getSelectedIds,
  setSelectedTabId, setViewingFolderId, exitSelectionMode,
  openCreateFolderPopover,
})
```

Called once from `initShortcutSettings()` (`shortcut-settings.ts:888`).

## What you can drag

| Gesture | Result |
|---|---|
| Drag a row within its list | Reorder |
| Drag a row onto a folder row | Move into that folder |
| Drag a shortcut onto another shortcut, and **hold** | Merge both into a new folder (prompts for a name) |
| Drag a row onto a tab pill | Move to that tab |
| Hover a tab pill for 1s while dragging | Switch to that tab mid-drag, then keep dragging |
| Hover a folder row for 1s while dragging | Drill into that folder mid-drag, then keep dragging |
| Drag with multiple items selected | Move the whole selection into a folder or tab |
| Drag a tab pill | Reorder tabs |
| Press Escape mid-drag | Cancel and restore the pre-drag snapshot |

## State machine

```
idle ──pointerdown──▶ pending ──moved >3px──▶ dragging ──pointerup──▶ (drop) ──▶ idle
                         └──pointerup (a click)──▶ idle
```

Three module-level variables carry it: `state`, `ctx` (the drag context), and `pendingStart` (the pointerdown coordinates).

The `pending` phase and its `DRAG_THRESHOLD = 3` are what let rows stay clickable — under 3px of movement, `pointerup` cleans up without ever starting a drag, and the click goes through normally.

Two context shapes, discriminated on `mode`:

- **`ItemDragCtx`** — source tab/item/type/folder, whether it's a selection drag and which IDs, the clone element, grab offsets, a `snapshot: Tab[]` of the pre-drag state, and the hover-timer machinery.
- **`TabDragCtx`** — source tab ID and index, clone, offsets.

`pointerdown` bails early on buttons, inputs, and labels, so the row's edit/delete controls and selection checkboxes still work.

## Geometry snapshots

The engine measures once at drag start rather than per-move.

```ts
interface RowSnap  { id, type, index, contentTop, height, left, width }
interface ZoneSnap { location: "top-level" | "folder", folderId, rows: RowSnap[], stride, el }
```

`snapshotZones()` (`shortcut-drag.ts:337`) walks every `[data-zone]` container and records each row's position in **content space** — `rect.top - zoneRect.top + scrollTop` — so the numbers stay valid while the list scrolls underneath. `stride` is the center-to-center distance between consecutive rows (falling back to row height when there's only one), and it's what the reorder animation translates by.

Snapshots are retaken whenever a hover timer changes the visible list (switching tab, drilling into a folder).

## Resolving a drop target

`resolveDropZone(x, y)` (`shortcut-drag.ts:457`) produces one of:

```ts
{ type: "reorder", location, index }
{ type: "into-folder", folderId, blocked }
{ type: "merge-shortcut", targetId }
{ type: "tab", tabId }
{ type: "none" }
```

Resolution order:

1. **Tab pills first** — `elementFromPoint`, then `closest("[data-tab-id]")` scoped to the tab bar.
2. **Outside the item list entirely** → `none`.
3. **Inside a zone** — the snapshot whose live rect contains the point. An empty zone means index 0; past the last row means append.
4. **On a row** — `none` if it's the dragged item itself, or part of the dragged selection, or if a folder is being dragged into a folder view (no nesting).
5. Then `resolveNormalSnap` or `resolveSelectionSnap`.

**`resolveNormalSnap`.** The middle 50% of a row (`|contentY - midY| < height * 0.25`) is the "center" band; anywhere else picks an insertion point above or below. In the center band, over a **folder** it's `into-folder` (with `blocked` set if the folder is at `MAX_CHILDREN_PER_FOLDER`); over a **shortcut** it's `into-folder` too, unless the hover timer has already fired for that shortcut, in which case it becomes `merge-shortcut`. Folders being dragged, and anything inside a folder view, skip the center band entirely and always reorder.

**`resolveSelectionSnap`** is deliberately narrow: a multi-selection can only be dropped into a folder or onto a tab. Anything else is `none`. It's `blocked` if the selection contains folders (folders can't nest) or if the target folder can't fit all of them.

## Hover intent

`updateHoverTimer(zone)` (`shortcut-drag.ts:605`) runs a `HOVER_DELAY = 1000`ms timer whenever the hovered target changes. Moving to a different target cancels and restarts it.

The feedback is two-phase, so the user can see the commitment building:

1. Immediately — a faint accent tint (tab pill) or a zero-width ring (folder row).
2. After 250ms — a 750ms transition to the full accent fill / 2px ring.

At 1000ms `onHoverTimerFire` acts:

| Target | Action |
|---|---|
| Tab | Switch to it, exit any folder view, re-render, re-apply drag styling, re-snapshot |
| Folder | Drill into it, same |
| Shortcut | Set `mergeReady = true` — the next `resolveDropZone` now returns `merge-shortcut` |

Selection drags skip the tab-hover timer (you can drop onto a tab, but you can't navigate into one mid-drag).

## Visual feedback

Rebuilt from scratch on every pointer move — `clearVisualFeedback()` then re-apply.

**Reorder** is a FLIP-style animation with no measuring: `applyReorderTransforms()` (`shortcut-drag.ts:798`) translates rows by exactly `±stride` with a 200ms transition to open a gap at the insertion index, and positions a `preview` element (accent outline over a 10%-accent fill) in the gap. The direction rules differ for a same-zone move (rows between source and destination shift one way) versus a cross-zone move (everything at or after the index shifts down). Dropping back where you started (`D === S || D === S + 1`) hides the preview entirely.

**Other zones:**

| Zone | Feedback |
|---|---|
| `into-folder` (folder target) | Row tinted `bg-accent/20` |
| `into-folder` (shortcut target) | Row tinted `bg-accent/10` — the weaker tint means "hold to merge" |
| `into-folder` blocked | Row tinted `bg-danger/30` |
| `merge-shortcut` | Row tinted `bg-warning/20` |
| `tab` | Pill ringed in accent |
| empty zone | Whole zone ringed and tinted |

The dragged clone also shrinks from `scale(0.97)` to `scale(0.9)` when it's over a container it would go *into*, rather than between.

**The clone** is a `cloneNode(true)` of the source row, fixed-positioned, 90% opacity, with a shadow. A selection drag of *n* items adds a `+n-1` badge. The original row is set to `opacity: 0` (single drag) or `opacity-50` on every selected row (selection drag).

**Coordinate space.** The clone, preview, and tab indicator are appended to the nearest `<dialog>` ancestor — a `<dialog>` renders in the top layer, so a `position: fixed` child of `document.body` would appear *behind* it. `dialogOffset()` converts viewport coordinates into the dialog's local space for every positioned element.

**Auto-scroll:** within 40px of the list's top or bottom edge, scroll by 8px per pointer move.

## Committing the drop

Every drop path starts from `ctx.snapshot` — the `Tab[]` captured at pointerdown — not from the current store value. Mid-drag tab switches and folder drills already re-rendered from live data, so replaying the whole move against the snapshot is what keeps the result consistent.

**`processNormalDrop`:**

- **reorder, same tab and same container** → `reorderItems` / `reorderFolderChildren`. The source index is read back off the DOM (`getAttribute("data-index")`), not from the model.
- **reorder, anywhere else** → `extractItem` then `insertItem` / `insertIntoFolder`.
- **into-folder** → `extractItem` then `insertIntoFolder(..., 0)`. Only fires when the target row's `data-type` is `folder`; the shortcut case falls through and does nothing, because dropping on a shortcut without holding is a no-op by design.
- **merge-shortcut** → opens `openCreateFolderPopover` anchored to the target row. Saving calls `mergeShortcutsIntoNewFolder` against the snapshot; cancelling saves the snapshot back unchanged.

**`processSelectionDrop`** handles only `tab` and `into-folder`: extract every dragged ID in turn, then re-insert them in order at the destination, then `exitSelectionMode()`.

**`processTabDrop`** finds the pill under the pointer, decides before/after from the horizontal midpoint, and calls `reorderTabs` with an index adjusted for the removal of the source (`finalIndex > sourceIndex ? finalIndex - 1 : finalIndex`).

**Escape** (`onKeyDown`, `shortcut-drag.ts:258`) saves `ctx.snapshot` back for item drags — which undoes any mid-drag tab switch or folder drill — then cleans up. Tab drags aren't restored, but they haven't written anything yet either.

`cleanup()` runs on every exit path: clears timers and hover animation, removes the clone, hides the preview and indicator, strips every inline `transition`/`transform`/`opacity` from rows, empties the snapshots, and detaches all three document listeners.

## Refactor candidates

- **The source index comes from the DOM.** `processNormalDrop` reads `data-index` off the source row (`shortcut-drag.ts:963`) with a `?? 0` fallback, so a stale or missing attribute silently reorders to position 0. The index is in `ctx` already via the snapshot — use it.
- **Nine callbacks is a lot of surface.** `DragCallbacks` exists to keep the engine store-free, which is right, but four getters, three setters, and two commands is really "hand me the panel's mutable state". A single state object with a `mutate()` would be smaller and harder to desync.
- **`resolveDropZone` returns `into-folder` for shortcut targets.** A shortcut isn't a folder, and `processNormalDrop` then has to check `data-type === "folder"` and silently drop the event. A distinct `hover-shortcut` zone type would make the state legible instead of overloading one variant with two meanings.
- **Hover animation is hand-written inline styles with a nested timer.** `startHoverAnimation` sets `backgroundColor`, `color`, `boxShadow`, and a child input's color across two timers, then `clearHoverAnimation` unsets each one individually. Two CSS classes plus a transition would be a fraction of the code and wouldn't leak style properties when a path is missed.
- **Drop-target resolution is one 80-line function with five bail-out branches** and two more helpers that repeat the center-band math. The zone rules deserve a table.
- **Escape restores by writing the snapshot back** rather than by not having written. Since nothing is saved until drop, the only thing being undone is the mid-drag navigation — which would be cheaper to undo by restoring `selectedTabId`/`viewingFolderId` directly.
- **Tab reorder has no live preview of the resulting order** — just a thin insertion indicator — while item reorder animates. Inconsistent feel between two gestures in the same panel.
- **Selection drags can't reorder.** `resolveSelectionSnap` returns `none` for everything except folder and tab targets, so there's no way to move a multi-selection within its own list.
- **No touch or keyboard path.** Pointer Events cover touch mechanically, but nothing accounts for scroll-vs-drag on a touch screen, and there's no keyboard alternative to any of these gestures.
