# Drag and Drop

The pointer-based drag engine for the shortcuts settings grid. **File:** `src/shortcut-drag.ts` (579 lines).

Not HTML5 drag-and-drop — Pointer Events throughout, because HTML5 DnD can't animate a live insertion point or carry a custom drag image that isn't a screenshot.

This is not the only drag engine. Two others share its `pointerdown → threshold → drag` shape and none of its code:

- `src/layout-edit.ts` reorders widget cards in the Default layout — absolutely-positioned cards inside a packer rather than tiles in a grid. See [layouts.md](layouts.md#rearranging).
- `src/dock-drag.ts` reorders shortcuts in the dock, on the page. One tile rather than a selection, three destinations rather than four, and it has to leave a magnifying row's transforms alone while it works. See [shortcuts.md](shortcuts.md#dragging-on-the-page).

## What replaced what

The previous engine was 1127 lines of row-based logic. Its reorder animation translated rows by a single `stride` — the centre-to-centre distance between consecutive rows — which is an assumption a **wrapping grid** breaks the moment there are two columns. That is why this is a rewrite rather than an adaptation.

Two gestures were deliberately dropped:

| Gone | Why | Replaced by |
|---|---|---|
| Hover a folder for 1s to drill into it mid-drag | Nothing announced the timer; you found it by accident or never | Drop onto the folder to file into it |
| Hold on a shortcut to merge both into a new folder | Same, plus it overloaded "drop on a shortcut" with two meanings | **New folder** in the selection bar, and in the tile menu |

Losing them removed the hover-timer machinery, the two-phase commitment animation, and the `merge-shortcut` drop zone — roughly half the old file.

## The host object

The engine never touches the store and never queries the DOM for state it wasn't handed. The old version took nine callbacks (four getters, three setters, two commands); this one takes one object:

```ts
initGridDrag({
  gridEl, railEl, scrollEl,
  getTabs, save,
  getState,      // () => { tabId, folderId, selection }
  setLocation,   // (tabId, folderId) => void
  clearSelection,
  notify,        // a toast
  refresh,
})
```

Called once from `initShortcutSettings()`.

## What you can drag

| Gesture | Result |
|---|---|
| Drag a tile within the grid | Reorder |
| Drag a tile onto a folder tile | File it into that folder |
| Drag a tile onto a tab in the rail | Move it to that tab |
| Drag with several tiles selected | Move the whole selection |
| Drag a tab in the rail | Reorder tabs |
| Press Escape mid-drag | Cancel |

Dragging an **unselected** tile drags only that tile and leaves the selection alone — grabbing one thing shouldn't silently take others with it.

Escape is free: nothing is written until the drop, so cancelling is just `cleanup()`. The old engine had to save a pre-drag snapshot back, because its mid-drag tab switches had already mutated visible state.

## State machine

```
idle ──pointerdown──▶ pending ──moved >4px──▶ dragging ──pointerup──▶ (drop) ──▶ idle
                         └──pointerup (a click)──▶ idle
```

`state`, `ctx`, and `pending` carry it. The `pending` phase and `THRESHOLD = 4` are what keep tiles clickable: under 4px of movement `pointerup` cleans up without ever starting a drag, and the click goes through.

`pointerdown` bails on `.sc-tile-menu` and on form controls, so the tile's own ⋯ button still works.

Two context shapes, discriminated on `mode`: `ItemDrag` (the dragged IDs, source location, clone, grab offsets, geometry, current target) and `TabDrag` (tab ID, source index, clone, offsets, target index).

## Geometry

Measured once at drag start:

```ts
type TileSnap = { id, type, index, left, top, width, height }
```

Positions are relative to the **grid's own box**. Both the tiles and the grid move together as the list scrolls, so a snapshot stays valid without re-measuring — converting a pointer position into that space is one subtraction against the live grid rect.

### Finding the insertion slot

`nearestSlot()` (`shortcut-drag.ts:130`) is what replaces the `stride` arithmetic. Every tile contributes two candidate slots — the one before it and the one after it, each anchored at the tile's vertical midpoint — and the closest by straight-line distance wins:

```
┌─────┐ ┌─────┐ ┌─────┐
│  A  │ │  B  │ │  C  │      slots: |A| |B| |C|
└─────┘ └─────┘ └─────┘             0 1 2 3 4 5 6  → deduped to 0..3
┌─────┐
│  D  │                             row wrapping needs no special case
└─────┘
```

Because it is pure distance, wrapping, ragged final rows, and varying column counts all fall out for free.

## Resolving a drop target

`resolveTarget()` (`shortcut-drag.ts:155`) returns one of:

```ts
{ kind: "reorder"; index }
{ kind: "into-folder"; folderId; blocked }
{ kind: "tab"; tabId; blocked }
{ kind: "none" }
```

Order:

1. **The rail first** — a tab row overlaps nothing else, and it's the only cross-tab move. Dropping on the tab you're already in (at the top level) is `none`.
2. **Outside the scroll area** → `none`.
3. **Over the middle 60% × 70% of a folder tile**, from the top level only → `into-folder`. `blocked` is set when the selection has no shortcuts in it, or when the folder can't fit them.
4. Otherwise → `reorder` at the nearest slot.

A folder tile is only a container from the top level. Inside a folder view there are no folders to drop onto, so the check is skipped entirely rather than guarded case by case.

## Visual feedback

Rebuilt on every move: `clearFeedback()` then re-apply.

| Target | Feedback |
|---|---|
| `reorder` | A 2px accent caret in the gap, transitioning between slots |
| `into-folder` | The folder tile fills accent and gains a ring |
| `into-folder`, blocked | The tile fills danger |
| `tab` | The rail row fills accent |
| `tab`, blocked | The rail row fills danger |

The clone shrinks from `scale(0.96)` to `scale(0.82)` when the drop would go *into* something rather than between — the one cue that distinguishes the two outcomes at a glance.

The caret is a child of `.sc-grid` (and the rail caret of `.sc-rail`), both of which are `position: relative`, so snapshot coordinates can be used directly as `left`/`top` with no conversion.

**The clone** is a `cloneNode(true)` of the tile, fixed-positioned, with a `+n` badge for a multi-drag. Dragged tiles drop to 35% opacity.

**Coordinate space.** The clone is appended to the nearest `<dialog>` ancestor — a `<dialog>` renders in the top layer, so a `position: fixed` child of `document.body` would appear *behind* it. `overlayOffset()` converts viewport coordinates into the dialog's local space.

**Auto-scroll:** within 48px of the scroll container's top or bottom edge, by 10px per pointer move.

## Committing

Every drop is one call to `moveItems`, which handles capacity and the folders-can't-nest rule itself. The engine's only real work is the reorder index.

**The index adjustment.** `nearestSlot` measures against the list *as it currently looks*, but `moveItems` extracts before it inserts. So the slot is pulled back by however many dragged items sit before it:

```ts
const removedBefore = drag.ids.filter((id) => {
  const index = list.findIndex((i) => i.id === id)
  return index !== -1 && index < target.index
}).length
const index = target.index - removedBefore
```

A single-item drag that lands where it started is detected here and skipped, so a stray click-drag doesn't write a no-op to storage.

The source index comes from `locate()` against the live model. The old engine read it off the DOM with `getAttribute("data-index") ?? 0`, so a stale attribute silently reordered to position 0.

**Tab drops** find the insertion row from the vertical midpoints and call `reorderTabs` with an index adjusted for the removal of the source.

`cleanup()` runs on every exit path: removes the clone, hides both carets, strips `sc-dragging-source` from every tile, clears the body class, and detaches all four document listeners.

## Refactor candidates

- **No touch handling.** Pointer Events cover touch mechanically, but nothing distinguishes a scroll gesture from a drag on a touch screen, so the grid is effectively undraggable there. `touch-action` plus a long-press delay is the usual fix.
- **The keyboard path lives in the other file.** Space-to-grab and arrow-to-move are in `shortcut-settings.ts`'s `onGridKeyDown`, not here, so "how do I move an item" is answered in two places. The engine could own both.
- **Feedback is applied by class-toggling a live query each move.** Cheap at this scale, but it re-queries the whole grid on every pointer event; tracking the previously-marked element would be one node instead.
- **Dragging out of a folder is only possible onto a tab.** There is no way to drag a child up to its parent tab's top level without first leaving the folder — the rail is the only escape hatch.
