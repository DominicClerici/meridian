# Shortcuts

The bookmark system: data model, pure operations, the dock that renders it, and the settings panel that edits it.

**Files:** `src/shortcuts.ts` (387 lines, pure), `src/dock.ts` (299), `src/shortcut-settings.ts` (901). Drag-and-drop is separate — see [drag-and-drop.md](drag-and-drop.md).

## Data model

```
Tab      { id, name, items: TabItem[] }
TabItem  = Shortcut | Folder
Shortcut { type: "shortcut", id, name, url, icon? }
Folder   { type: "folder",   id, name, children: Shortcut[], icon? }
```

```ts
type ShortcutIcon = { type: "favicon" } | { type: "color"; color: string }
type FolderIcon   = { type: "folder" }  | { type: "color"; color: string }
```

**Folders hold shortcuts only — no nesting.** A `Folder` is one level deep by construction, which is what keeps every operation below a two-level map instead of a tree walk.

All IDs are `crypto.randomUUID()`. `icon` is optional; absent means the default for that type (favicon for shortcuts, a folder glyph for folders). `color` is one of the ten `ACCENT_COLORS` names.

Stored as a single `Tab[]` at `store.local.get("shortcuts")`, so the whole tree is one storage value that's rewritten on every change. Cross-tab sync comes free from the store.

### Limits

| Constant | Value | Enforced in |
|---|---|---|
| `MAX_TABS` | 6 | `addTab` |
| `MAX_ITEMS_PER_TAB` | 256 | `addShortcut`, `addFolder`, `insertItem` |
| `MAX_CHILDREN_PER_FOLDER` | 64 | `addShortcutToFolder`, `moveShortcutIntoFolder`, `insertIntoFolder` |

Every limit is enforced by **silently returning the input unchanged**. Nothing surfaces to the user.

## Pure operations

`shortcuts.ts` imports nothing. Every function takes a `Tab[]` and returns a new `Tab[]` — the caller persists via `save()`. This is the cleanest seam in the codebase and the right place to add behavior.

| Function | Effect |
|---|---|
| `addTab(tabs, name)` | Append a tab |
| `deleteTab(tabs, tabId)` | Remove a tab and everything in it |
| `reorderTabs(tabs, from, to)` | Move a tab by index |
| `addShortcut(tabs, tabId, name, url, icon?)` | Append a shortcut to a tab |
| `addFolder(tabs, tabId, name, icon?)` | Append an empty folder to a tab |
| `deleteItem(tabs, tabId, itemId)` | Remove one top-level item |
| `deleteItems(tabs, tabId, itemIds[])` | Batch remove, top level **and** inside folders |
| `editShortcut(tabs, tabId, itemId, name, url, icon?)` | Update a top-level shortcut |
| `editFolder(tabs, tabId, folderId, name, icon?)` | Rename/re-icon a folder |
| `addShortcutToFolder(tabs, tabId, folderId, name, url, icon?)` | Append inside a folder |
| `deleteShortcutFromFolder(tabs, tabId, folderId, shortcutId)` | Remove from a folder |
| `editShortcutInFolder(tabs, tabId, folderId, shortcutId, name, url, icon?)` | Update inside a folder |
| `reorderItems(tabs, tabId, from, to)` | Reorder top-level items |
| `reorderFolderChildren(tabs, tabId, folderId, from, to)` | Reorder inside a folder |
| `moveShortcutIntoFolder(tabs, tabId, shortcutId, folderId)` | Top level → folder (appends) |
| `mergeShortcutsIntoNewFolder(tabs, tabId, targetId, draggedId, name, icon?)` | Two shortcuts → a new folder in the target's slot |
| `extractItem(tabs, tabId, itemId)` | → `[newTabs, item]`. Finds at top level *or* inside any folder |
| `insertItem(tabs, tabId, item, index)` | Insert at a top-level index |
| `insertIntoFolder(tabs, tabId, folderId, shortcut, index)` | Insert at an index inside a folder |

`extractItem` + `insertItem`/`insertIntoFolder` is the move primitive the drag engine composes for every cross-tab and cross-container move.

## The dock

`dock.ts` — the row of icons at the bottom of the page. Read-only: it renders shortcuts and opens them, and never edits.

**Structure** (all in `index.html`):

```
#dock-wrapper           hidden when there are no tabs
├─ #dock  .dock-surface
│  └─ #dock-scroll
│     ├─ #dock-suggestions   recommendation tiles (hidden when empty)
│     ├─ #dock-divider       hidden with the suggestions
│     └─ #dock-items         the active tab's items
└─ #dock-tabs               tab pills — only rendered when there's >1 tab
```

**Rendering.** `render()` (`dock.ts:232`) rebuilds everything from scratch on any change. It hides the whole wrapper when there are no tabs, falls back to the first tab if `activeTabId` no longer exists, and subscribes to both `shortcuts` (local) and `recommendationsEnabled` (sync).

**Item icons** (`renderItemIcon`): a `color` icon renders as a filled 24px tile with the item's first character; otherwise a shortcut gets a Google favicon `<img>` and a folder gets the `folder` glyph. Favicon load errors swap in the `link` icon.

**Item structure.** `itemShell()` gives every item two children: a `.dock-item-glyph` holding the favicon or colour chip, and a `.dock-item-name` carrying the name. The split exists for the Dashboard, where CSS promotes the glyph to a standing 54px circle and prints the name underneath it; everywhere else `.dock-item-name` is `display: none` and the glyph fills the 48px tile.

**Labels.** Outside Dashboard, names aren't rendered inline — `attachLabel()` creates a `.dock-item-label` span **appended to `document.body`**, positioned above the tile on `mouseenter` with `getBoundingClientRect`. Every label is tracked in a module-level `labelEls` array and cleared at the top of each `render()`; the fixed positioning is what lets the label escape the dock's `overflow-x: auto`. In Dashboard the tooltip is suppressed in CSS, since the name is already printed under the icon.

**The Dashboard treatment.** `[data-layout="dashboard"]` rules in `styles.css` strip the `.dock-surface` pill — no background, border, shadow or padding — and turn each item into a labelled circle, left-aligned under the search bar. The dock's own markup and JS are untouched by the switch, which is what keeps element identity across a layout change. See [layouts.md](layouts.md).

**Folders** open a modal, `above-center` popover containing a 3-column `.dock-folder-grid`. Clicking a child navigates and closes.

**Suggestions.** `getRecommendations(domains)` is passed the set of domains already present in the active tab so it won't suggest what's already docked. See [recommendations.md](recommendations.md).

**Navigation.** `navigate(url)` honors the `shortcutsOpenIn` setting: `window.open(url, "_blank", "noopener")` or `window.location.href = url`.

## The settings panel

`shortcut-settings.ts` fills the three containers that `settings.ts` creates — `#sc-tab-bar`, `#sc-item-list`, `#sc-control-bar`. This is where all editing happens.

### State

Four module-level variables:

```ts
let selectedTabId: string | null    // which tab is being edited
let viewingFolderId: string | null  // null = top level, else drilled into a folder
let selectionMode = false           // multi-select mode
let selectedIds = new Set<string>() // what's checked
```

`render()` rebuilds all three regions. `syncFromStore()` (`shortcut-settings.ts:856`) runs on every `shortcuts` change and repairs stale state — a deleted tab resets `selectedTabId` to the first, a deleted folder drops `viewingFolderId`.

### Tab bar

One pill per tab. The pill's name is an `<input>` that's `readOnly` unless the tab is active, so clicking an inactive tab selects it and clicking the active tab's name edits it. Width tracks content in `ch` units. Renaming saves on blur or Enter. A hover-revealed X deletes the tab **immediately, with no confirmation**. An `add` button appears while under `MAX_TABS` and focus-selects the new tab's name field on the next frame.

### Item list

Two layouts, both built from `createRow()`:

- **Top level** (`viewingFolderId === null`) — a `grid grid-cols-3` where every row spans all three columns. Rows show name plus a `prettyUrl()` of the URL. Clicking a folder row drills in.
- **Folder view** — a 1/3 + 2/3 split: the left column lists the tab's top-level items compactly (the open folder ringed in accent), the right column lists that folder's children. Clicking the open folder again drills back out.

Rows carry the attributes the drag engine reads: `data-id`, `data-type`, `data-index`, inside a container with `data-zone="top-level"` or `data-zone="folder"` (plus `data-folder-id`). Each row has hover-revealed edit and delete buttons.

### Selection mode

Entered from the "Select" button. Every row gains a checkbox and the whole row becomes a toggle; tab pills dim to 40% and the add-tab button disappears. "Select All" checks every item in the tab *including* folder children. "Delete Selected" opens a real themed confirmation dialog (`openDeleteConfirmation`, `shortcut-settings.ts:815`) and calls `deleteItems`.

### Popovers

Four builders, all modal popovers anchored to the button that opened them:

| Builder | Opens from |
|---|---|
| `openAddShortcutPopover` | "Add Shortcut" — adds to the current folder if drilled in, else top level |
| `openAddFolderPopover` | "Add Folder" |
| `openEditPopover` | A row's edit button — shows a URL field only for shortcuts |
| `openCreateFolderPopover` | Add Folder, **and the drag engine's merge gesture** |

All of them: validate on input and disable Save, submit on Enter, close on Escape, and focus the name field on the next frame.

### Icon picker

`createIconPicker(itemType, currentIcon)` (`shortcut-settings.ts:63`) — a default button (globe for shortcuts, folder for folders) plus ten color circles, returning `{ el, getIcon() }`. Selection is drawn as an outline in the swatch's own color with a check injected into the circle. Structurally near-identical to `buildSwatchGroup()` in `settings.ts`, but store-free.

## Refactor candidates

- **The ten palette colors have three disagreeing definitions.** `dock.ts:7` hard-codes its own `SWATCH_HEX` map whose values differ from the `--swatch-*` CSS tokens (`rose` is `#f43f5e` in the dock but `#e63e6d` in the token; `coral` `#f97316` vs `#e2603a`; `graphite` `#57534e` vs `#555566`), while `shortcut-settings.ts:40` and `settings.ts:156` each keep their own name → Tailwind-class map. The same shortcut therefore renders one color in the dock and a different one in the settings list. One source of truth, derived from the tokens.
- **Two favicon helpers that behave differently.** `dock.ts:46` returns `""` for a URL with no scheme; `shortcut-settings.ts:53` prepends `https://` first. A shortcut saved as `example.com` shows a favicon in settings and the fallback link icon in the dock.
- **URLs are never normalized on save.** The raw input string is stored, so `example.com` reaches `window.location.href = "example.com"` and resolves *relative to the extension page*. Normalizing at the `addShortcut`/`editShortcut` boundary fixes the navigation and both favicon helpers at once.
- **Deleting a tab is instant and unrecoverable.** One click on a hover-revealed X removes the tab and every shortcut in it, with no confirmation — while deleting *one* selected item does show a confirmation dialog.
- **Limits fail silently.** All three `MAX_*` guards return the input unchanged. Adding the 257th shortcut just does nothing, with no message.
- **The three form popovers are ~90% duplicated.** Add-shortcut, edit, and create-folder each hand-build label + input + icon picker + validation + Enter/Escape wiring. One `itemFormPopover({ title, fields, initial, onSubmit })` would replace all three.
- **`createIconPicker` and `buildSwatchGroup` are the same widget twice**, one store-backed and one callback-backed, in two different files.
- **`extractItem` can return `undefined` as `TabItem`.** It ends in `return [updated, extracted!]` (`shortcuts.ts:351`) with a non-null assertion that's false whenever the ID isn't found; callers then read `item.type` off it.
- **Icons can't be cleared.** `editShortcut` uses `...(icon !== undefined ? { icon } : {})`, so an item can move from default → color but never back to default via the API. The picker sidesteps this by always returning a concrete icon.
- **Full re-render on every change.** `render()` blows away all three regions with `innerHTML = ""`, which is why open inline edits and scroll positions are lost when another tab writes to `shortcuts`.
- **Selection state is module-global and never reset** when the settings dialog closes, so reopening can land back in selection mode.
- **`store.local.get("shortcuts")` is read through two different accessors** — `dock.ts` guards with `?? []`, `shortcut-settings.ts` doesn't. The store always returns the default, so the guard is dead, but the inconsistency suggests uncertainty about the contract.
