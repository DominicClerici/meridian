# Shortcuts System Design

## Overview

A tab-based shortcut system stored in `store.local`. Shortcuts are displayed in a bottom dock on the main screen and managed through the settings dialog. Supports tabs, folders, and shortcuts with drag-and-drop reordering in settings.

## Data Model

All shortcut data lives under a single `shortcuts` key in `store.local` as a flat array of tabs.

```ts
// Added to LocalSettings in src/defaults.ts
shortcuts: Tab[]

type Tab = {
  id: string       // crypto.randomUUID()
  name: string
  items: TabItem[]  // display order = array position
}

type TabItem = Shortcut | Folder

type Shortcut = {
  type: "shortcut"
  id: string
  name: string
  url: string
}

type Folder = {
  type: "folder"
  id: string
  name: string
  children: Shortcut[]  // display order = array position
}
```

Default value: `[]` (no tabs until user creates one).

### Limits

Enforced silently — only surfaced when the user hits them:

- 10 tabs maximum
- 256 items (shortcuts + folders) per tab
- 64 shortcuts per folder

IDs generated via `crypto.randomUUID()`.

## Dock UI (Main Screen)

A horizontal bar fixed to the bottom of the screen.

### Tab Selector

Positioned to the left of the dock. Clickable tab names — selecting one switches the displayed items. First tab selected by default. If no tabs exist, the dock area is empty.

### Dock Contents

Displays the selected tab's `items` left-to-right. Shortcuts and folders both appear as clickable elements.

- **Clicking a shortcut:** Opens `url` in a new tab via `window.open(url, "_blank")`.
- **Clicking a folder:** Opens a popover above the folder showing its `children` as shortcuts. Clicking a shortcut in the popover opens its URL in a new tab. Popover closes on outside click.

No drag-and-drop on the dock — reordering is settings-only.

## Settings UI — Shortcut Management

Located in the settings dialog below the background color fieldset.

### Top-Level Controls

- Tab selector (dropdown or tabs) to pick the tab being edited
- "Add Tab" button — prompts for name (default "New Tab"), hidden/disabled at 10 tabs
- "Add Shortcut" and "Add Folder" buttons — only visible when a tab is selected
- Delete tab button next to tab name — removes tab and all contents

### Item List

Vertical list of the selected tab's items. Each row shows:

- Drag handle
- Name (and URL for shortcuts, type indicator for folders)
- Edit button (modify name/url)
- Delete button (immediate, no confirmation)

### Folder View

Clicking a folder in the list enters folder view:

- Tab selector replaced by a back button to return to top-level
- List shows the folder's children (shortcuts only)
- "Add Shortcut" works (adds into folder), "Add Folder" hidden
- Same drag reordering and edit/delete per shortcut

## Drag-and-Drop Behavior (Settings List)

Uses native HTML Drag and Drop API. Data is committed only on drop, not during drag.

### Basic Reordering

Dragging between items reorders the array. A visual indicator (line/gap) shows the drop position.

### Shortcut Over Folder

- Folder highlights as a drop target on hover
- On drop: shortcut moves from top-level into the folder's `children`
- If folder is at 64 children max: folder shows red background, drop is blocked

### Shortcut Over Shortcut

- Target shortcut highlights distinctly (different from reorder indicator)
- On drop: dialog prompts to create a new folder (input pre-filled "New Folder")
  - **Confirm:** New folder created at the position of the first shortcut, containing both shortcuts. Both removed from top-level.
  - **Cancel:** List reverts to pre-drag state, no changes.

### Folder Drag

Folders can only be reordered. No special hover interactions with other items.

## File Structure

### New Files

- `src/shortcuts.ts` — Data types, CRUD operations (add/remove/move tab/folder/shortcut), limit enforcement. Pure data logic, no DOM.
- `src/dock.ts` — Dock UI: rendering, tab selector, folder popovers. Subscribes to `store.local` for reactivity.
- `src/shortcut-settings.ts` — Settings panel: item list, drag-and-drop, add/edit/delete, folder view navigation.

### Modified Files

- `src/defaults.ts` — Add `shortcuts: Tab[]` to `LocalSettings`, default `[]`.
- `src/index.ts` — Import and initialize dock and shortcut settings.
- `src/index.html` — Add dock container at bottom of body, shortcut settings section inside settings dialog.
- `src/settings.ts` — Minor changes if needed to accommodate new settings section.
