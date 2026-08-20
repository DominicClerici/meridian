# Shortcuts Settings UI Overhaul

## Overview

Complete redesign of the shortcuts tab in the settings dialog. Replaces the dropdown-based tab selector and flat button toolbar with a visual tab bar, 3-column grid layout with folder expansion, a bottom control bar, and multi-select mode.

## State Model

Module-level variables in `shortcut-settings.ts`:

```
selectedTabId: string | null     — active tab
viewingFolderId: string | null   — expanded folder (null = full-width list)
selectionMode: boolean           — multi-select active
selectedIds: Set<string>         — checked item IDs during selection
```

Existing `getTabs()` / `save()` pattern unchanged. `MAX_TABS` changes from 10 to 6 (data model and UI).

## Architecture

Composable render sections with a coordinator:

- `renderTabBar()` — 6-slot tab strip with inline editing
- `renderItemList()` — 3-column grid with folder split view
- `renderControlBar()` — bottom action bar, swaps for selection mode
- `render()` — calls all three

State lives in module-level variables. Each render function takes no arguments, reads state directly, and rebuilds its DOM section.

## Tab Bar

Horizontal strip at the top of the shortcuts panel.

**Layout:**
- Flex container, left-aligned, gap between items
- Each tab: `[bookmark icon] [editable input] [x on hover]`
- Active tab: `bg-accent`, `text-accent-foreground`
- Inactive tabs: `bg-surface`, `text-foreground`, hover state
- If < 6 tabs, a `+` ghost/outline button appears after the last tab

**Inline editing:**
- Tab name is an `<input>` styled invisible (no border, no background, no outline, inherits text color/font)
- Input width adapts to content
- Clicking text of the already-active tab focuses input and selects all text
- Clicking an inactive tab switches to it (does not enter edit mode)
- Saves on `blur` or when settings dialog closes

**New tab creation:**
- `+` creates tab named `"Tab N"` where N = `tabs.length + 1`
- New tab becomes active immediately
- Name input auto-focused with text selected

**Delete:**
- Small x button appears on hover at top-right of tab pill
- Deletes the tab. If active, first remaining tab becomes active
- No confirmation for single tab delete

**Selection mode:**
- Tabs become visually disabled (reduced opacity, no pointer events)

## Item List (3-Column Grid)

Below the tab bar, above the control bar.

**Container:**
- CSS grid, 3 equal columns (`grid-cols-3`), gap between columns
- Fills remaining vertical space, `overflow-y-auto`

**Default (no folder selected):**
- Items span all 3 columns (`col-span-3`)
- Each row: `[drag handle] [icon] [name] [edit btn] [delete btn]`
  - Drag handle: `dragHandle` icon, `text-muted`, `cursor-grab`
  - Icon: `folder` icon for folders, `link` icon for shortcuts (Feather icons)
  - Name: truncated, `flex-1`. Shortcuts show URL as `text-muted text-xs` secondary text
  - Edit/delete: ghost icon buttons, visible on hover (`opacity-0 group-hover:opacity-100`)
- Rows: `bg-surface` on hover, `rounded-theme`, small gap

**Folder selected (split view):**
- Left column (col 1): tab's top-level items, compressed. Selected folder has `border-l-2 border-accent` and `bg-accent/10`
- Right columns (cols 2-3): folder's children as vertical list. Subtle left border (`border-l border-input-border/20`) separator
- Edit/delete use icon-only ghost buttons in both columns to fit narrower space

**Selection mode:**
- Edit/delete buttons replaced with checkboxes
- Drag handles hidden
- Clicking a row toggles its checkbox
- Checkboxes appear in both columns during split view

**Drag-and-drop readiness:**
- Rows have `draggable`, `data-index`, `data-id`, `data-type` attributes
- Existing `initDragAndDrop` adapted for grid structure

## Control Bar

Fixed at bottom of shortcuts panel.

**Layout:**
- Flex, `justify-between`. Left = navigation, right = actions
- `border-t border-input-border/15`, `px-6 py-3`

**Normal mode — left:**
- Back chevron (`chevronLeft` icon): ghost button, only visible when `viewingFolderId` is set. Clears folder view

**Normal mode — right:**
- `Add Shortcut`: primary button. Opens popover with name + URL form
- `Add Folder`: outline button. Opens popover with name form. Hidden when inside a folder
- `Select Many`: ghost button, text only (no icon). Enters selection mode

**Selection mode — left:**
- Back chevron remains if visible but disabled

**Selection mode — right:**
- `Select All`: outline button. Selects all items in the current tab — top-level shortcuts, top-level folders, and all shortcuts inside folders
- `Delete Selected`: destructive button. Disabled until >= 1 selected. Opens confirmation dialog
- `Cancel`: ghost button. Exits selection mode, clears `selectedIds`
- Add Shortcut, Add Folder, Select Many are hidden

**Confirmation dialog:**
- Uses `createDialog` from components
- Title: "Delete selected items?"
- Body: "Are you sure? This will permanently delete N item(s)."
- Buttons: Cancel (outline), Delete (destructive)
- Click outside = cancel

## Add/Edit Popovers

**Add Shortcut:**
- Anchored to "Add Shortcut" button
- Name input (focused on open), URL input, Save button
- If viewing a folder, adds to folder. Otherwise adds to tab top level
- Validates non-empty fields. Enter on last input submits. Escape closes

**Add Folder:**
- Anchored to "Add Folder" button
- Name input (focused, pre-filled "New Folder", selected), Save button
- Validates non-empty name

**Edit (shortcut or folder):**
- Anchored to the edit button on the row
- Shortcut: name + URL inputs (pre-filled), Save button
- Folder: name input (pre-filled), Save button
- Same submit/escape behavior

**Shared form:**
- Compact vertical layout, inputs stacked with small gap
- Uses `createInput` and `createButton("Save", "primary")` from components
- Save at bottom right

## New Icons

Registered in `src/icons/modern.ts`, sourced from Feather Icons:

| Name | Feather Icon | Purpose |
|------|-------------|---------|
| `link` | `link` | Shortcut items in list |
| `folder` | `folder` | Folder items in list |
| `chevronLeft` | `chevron-left` | Back button in control bar |
| `tab` | `bookmark` | Generic icon in each tab pill |

Existing icons reused: `dragHandle`, `edit`, `trash`, `plus`, `close`.

## Files Modified

| File | Changes |
|------|---------|
| `src/shortcut-settings.ts` | Complete rewrite. New render architecture with `renderTabBar()`, `renderItemList()`, `renderControlBar()`, `render()`. Selection mode. Popover-based add/edit forms |
| `src/shortcuts.ts` | `MAX_TABS` 10 -> 6. Add `deleteItems(tabs: Tab[], tabId: string, itemIds: string[]): Tab[]` — removes items by ID from the tab's top-level items and from inside any folders |
| `src/settings.ts` | Update `buildShortcutsPanel()` to emit new container structure (tab bar, grid, control bar containers) |
| `src/icons/modern.ts` | Register `link`, `folder`, `chevronLeft`, `tab` icons |
| `src/index.html` | Remove `sc-prompt-dialog` element |

## Files NOT Modified

- `src/components.ts` — uses existing helpers as-is
- `src/dock.ts` — untouched
- `src/store.ts` — untouched
- `src/styles.css` — primarily Tailwind utilities; minor additions possible for invisible input and grid layout

## Design System Integration

All new UI uses the existing token system:

- **Surfaces**: `bg-panel`, `bg-surface`, `bg-popover`
- **Text**: `text-foreground`, `text-muted`, `text-accent-foreground`
- **Actions**: `bg-accent`, `bg-danger`, `border-accent`
- **Inputs**: `bg-input`, `border-input-border`
- **Shape**: `rounded-theme`
- **Components**: `createButton`, `createInput`, `createCheckbox`, `createPopover`, `createDialog`
