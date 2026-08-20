# Shortcuts System — Current State

> **Archived.** This was a handoff document written before drag-and-drop existed, and it describes the system as it stood then. It is kept for history only.
> Current documentation: [`docs/shortcuts.md`](../shortcuts.md) and [`docs/drag-and-drop.md`](../drag-and-drop.md).

This document describes everything built so far for the shortcuts system, written for the developer implementing drag-and-drop.

## Data Model

Defined in `src/shortcuts.ts`:

```
Tab { id, name, items: TabItem[] }
TabItem = Shortcut | Folder
Shortcut { type: "shortcut", id, name, url }
Folder { type: "folder", id, name, children: Shortcut[] }
```

Folders can only contain shortcuts (no nesting). All IDs are `crypto.randomUUID()`.

### Limits

| Constant | Value | Enforced in |
|----------|-------|-------------|
| `MAX_TABS` | 6 | `addTab` |
| `MAX_ITEMS_PER_TAB` | 256 | `addShortcut`, `addFolder` |
| `MAX_CHILDREN_PER_FOLDER` | 64 | `addShortcutToFolder`, `moveShortcutIntoFolder` |

## Storage

- Stored at `store.local.get("shortcuts")` / `store.local.set("shortcuts", tabs)` — a `Tab[]`
- Backed by `browser.storage.local` with localStorage fallback
- Cross-tab sync via `browser.storage.onChanged`
- Settings UI subscribes via `store.local.subscribe("shortcuts", syncFromStore)`

## Pure CRUD Functions (src/shortcuts.ts)

All functions are pure — they take a `Tab[]`, return a new `Tab[]`. The caller saves.

| Function | What it does |
|----------|-------------|
| `addTab(tabs, name)` | Append new tab |
| `deleteTab(tabs, tabId)` | Remove tab by ID |
| `addShortcut(tabs, tabId, name, url)` | Add shortcut to tab's top-level items |
| `addFolder(tabs, tabId, name)` | Add empty folder to tab's top-level items |
| `deleteItem(tabs, tabId, itemId)` | Remove item from tab's top-level |
| `deleteItems(tabs, tabId, itemIds[])` | Batch remove by ID from top-level AND inside folders |
| `editShortcut(tabs, tabId, itemId, name, url)` | Update top-level shortcut |
| `editFolder(tabs, tabId, folderId, name)` | Rename folder |
| `addShortcutToFolder(tabs, tabId, folderId, name, url)` | Add shortcut inside folder |
| `deleteShortcutFromFolder(tabs, tabId, folderId, shortcutId)` | Remove shortcut from folder |
| `editShortcutInFolder(tabs, tabId, folderId, shortcutId, name, url)` | Update shortcut inside folder |
| `reorderItems(tabs, tabId, fromIndex, toIndex)` | Reorder top-level items by index |
| `reorderFolderChildren(tabs, tabId, folderId, fromIndex, toIndex)` | Reorder children inside folder |
| `moveShortcutIntoFolder(tabs, tabId, shortcutId, folderId)` | Move top-level shortcut into a folder |
| `mergeShortcutsIntoNewFolder(tabs, tabId, targetId, draggedId, folderName)` | Create new folder from two shortcuts |

## Settings UI Architecture (src/shortcut-settings.ts)

### State

Four module-level variables drive all rendering:

```ts
selectedTabId: string | null      // which tab is active
viewingFolderId: string | null    // which folder is expanded (null = flat view)
selectionMode: boolean            // multi-select active
selectedIds: Set<string>          // checked item IDs during selection
```

### Render Functions

`render()` calls three sub-functions that each rebuild their DOM section from scratch:

- **`renderTabBar()`** — Horizontal row of tab pills at the top. Each pill has a bookmark icon, an inline-editable `<input>` for the name, and a hover `x` delete button. A `+` button appears when < 6 tabs. Tabs are disabled (opacity, no pointer events) during selection mode.

- **`renderItemList()`** — The main content area. Two layouts:
  - **Flat view** (`viewingFolderId === null`): A `grid grid-cols-3` where every row spans `col-span-3`, making a vertical list. Each row is built by `createRow()`.
  - **Split view** (`viewingFolderId !== null`): Left column (`col-span-1`) shows all top-level items in compact mode. Right columns (`col-span-2`) show the selected folder's children. The selected folder row gets `border-l-2 border-accent bg-accent/10`. Clicking a folder toggles the split view.

- **`renderControlBar()`** — Bottom bar with `justify-between`. Left side has a back chevron (visible only in split view). Right side has action buttons that swap based on mode:
  - Normal: Add Shortcut (primary), Add Folder (outline, hidden in folder view), Select (ghost)
  - Selection: Select All (outline), Delete Selected (destructive, disabled until selection > 0), Cancel (ghost)

### DOM Container IDs

Created by `buildShortcutsPanel()` in `src/settings.ts`:

| ID | Element | Purpose |
|----|---------|---------|
| `sc-tab-bar` | `<div>` | Tab pill container |
| `sc-item-list` | `<div>` | Item list / grid container |
| `sc-control-bar` | `<div>` | Bottom control bar |

### Row Structure (createRow function)

`createRow(item, index, inFolder, folder, compact)` builds a single item row:

```
Normal mode:  [dragHandle] [icon] [name (+url)] [editBtn] [deleteBtn]
Selection:    [checkbox]   [icon] [name (+url)]
```

Every row has these data attributes (important for drag-and-drop):

```
data-index="0"        // position in the current list
data-id="uuid-..."    // item's unique ID
data-type="shortcut"  // or "folder"
draggable="true"      // only in normal mode
```

The `compact` flag is `true` for left-column items in split view — uses `text-xs` and hides the URL.

### Popover Forms

All add/edit operations use `createPopover` from `src/components.ts` instead of modal dialogs:

- **`openAddShortcutPopover(anchor)`** — Name + URL inputs. Adds to folder if `viewingFolderId` is set.
- **`openAddFolderPopover(anchor)`** — Delegates to `openCreateFolderPopover`.
- **`openCreateFolderPopover(anchor, onSave, onCancel?)`** — Shared popover for creating folders. Used by both the "Add Folder" button and the drag-merge flow. The `onCancel` callback is used by drag-and-drop to restore the pre-drop snapshot.
- **`openEditPopover(anchor, item, inFolder, folder)`** — Pre-filled name (+ URL for shortcuts). Handles both shortcuts and folders.

## Current Drag-and-Drop (initDragAndDrop)

`initDragAndDrop(list, inFolder, folder)` is called on the list container element(s). It uses the native HTML Drag and Drop API.

### Where it's attached

- **Flat view**: Called once on the grid container
- **Split view**: Called twice — once on `leftCol` (top-level items), once on `rightCol` (folder children)
- **Selection mode**: Not called (drag is disabled)

### Closure state

```ts
dragIndex: number | null     // index of the item being dragged
dragType: string | null      // "shortcut" or "folder"
preDropSnapshot: Tab[] | null // snapshot for cancel/undo on merge
```

### Event handlers

**dragstart**: Stores `dragIndex`, `dragType`, takes a `preDropSnapshot`, adds `opacity-50` to the dragged row.

**dragend**: Clears state, removes all visual indicator classes from all rows.

**dragover**: Shows visual indicators based on what's being dragged and where:

| Dragging | Over | Visual | Meaning |
|----------|------|--------|---------|
| Folder (any) | Any row | `border-t-2 border-accent` | Reorder only |
| Any (inside folder) | Any row | `border-t-2 border-accent` | Reorder only |
| Shortcut | Shortcut (center) | `bg-warning/20` | Will merge into new folder |
| Shortcut | Folder (center) | `bg-accent/20` | Will move into folder |
| Shortcut | Full folder (center) | `bg-danger/30` | Blocked (folder at capacity) |
| Shortcut | Any (edge) | `border-t-2 border-accent` | Reorder |

The "center" zone is defined as `Math.abs(clientY - midY) < row.height * 0.25`.

**drop**: Executes the mutation based on the same position logic:

| Scenario | Action |
|----------|--------|
| Folder drag or in-folder drag | `reorderItems` or `reorderFolderChildren` |
| Shortcut onto folder (center) | `moveShortcutIntoFolder` (silently blocked if folder full) |
| Shortcut onto shortcut (center) | Opens `openCreateFolderPopover` → `mergeShortcutsIntoNewFolder`. If user cancels, restores `preDropSnapshot`. |
| Shortcut onto edge | `reorderItems` |

### Known limitations of current drag-and-drop

1. No drag between the two columns in split view (left ↔ right)
2. No drag between different tabs
3. No visual drag ghost/preview
4. The `save()` after each mutation triggers `syncFromStore` which calls `render()`, fully rebuilding the DOM. This means drag state is lost after a drop — the next drag is a fresh start.

## Icon Registry

Icons used by the shortcuts UI (registered in `src/icons/modern.ts`):

| Name | Usage |
|------|-------|
| `tab` | Tab pill icon (Feather bookmark) |
| `link` | Shortcut row icon |
| `folder` | Folder row icon |
| `dragHandle` | Drag handle on rows |
| `edit` | Edit button on rows |
| `trash` | Delete button on rows |
| `plus` | Add tab, Add Shortcut, Add Folder buttons |
| `close` | Tab delete (x) button |
| `chevronLeft` | Back button in control bar |

All icons auto-update on theme change via the icon registry's `icon()` function.

## Component Helpers Used

From `src/components.ts`:

| Component | Where used |
|-----------|-----------|
| `createButton(label, variant, opts?)` | All buttons. Variants: `primary`, `outline`, `ghost`, `destructive`, `override` |
| `createInput(opts)` | Popover form fields |
| `createCheckbox(label, checked, onChange)` | Selection mode row checkboxes |
| `createPopover(anchor, content, opts?)` | Add/edit/merge forms |
| `createDialog(opts?)` | Delete confirmation modal |

## File Map

| File | Relevance to drag-and-drop |
|------|---------------------------|
| `src/shortcuts.ts` | Pure functions you'll call: `reorderItems`, `reorderFolderChildren`, `moveShortcutIntoFolder`, `mergeShortcutsIntoNewFolder` |
| `src/shortcut-settings.ts` | Contains `initDragAndDrop` (lines 659-813), `createRow` (lines 324-411), `renderItemList` (lines 413-522) |
| `src/components.ts` | `createPopover` for the merge-folder prompt |
| `src/store.ts` | Storage layer — `save()` triggers re-render via subscription |
| `src/settings.ts` | Creates the panel containers; not relevant to drag logic |
| `src/dock.ts` | Main page dock; subscribes to shortcuts changes but has no drag interaction |
