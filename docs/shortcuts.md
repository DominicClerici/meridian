# Shortcuts

The bookmark system: data model, pure operations, the icon layer everything draws through, the dock that renders it, and the settings panel that edits it.

**Files:** `src/shortcuts.ts` (551, pure), `src/shortcut-icon.ts` (180), `src/shortcut-settings.ts` (1525), and the four dock modules — `src/dock.ts` (601), `src/dock-drag.ts` (360), `src/dock-menu.ts` (233), `src/dock-magnify.ts` (154). The settings grid's drag engine is separate — see [drag-and-drop.md](drag-and-drop.md). Import and export are separate — see [shortcut-import.md](shortcut-import.md).

## Data model

```
Tab      { id, name, icon?, items: TabItem[] }
TabItem  = Shortcut | Folder
Shortcut { type: "shortcut", id, name, url, icon? }
Folder   { type: "folder",   id, name, children: Shortcut[], icon? }
```

**Folders hold shortcuts only — no nesting.** A `Folder` is one level deep by construction, which is what keeps every operation below a two-level map instead of a tree walk. Every path that could violate it — `moveItems`, `createFolderFromItems`, the drag engine, the importer — skips folders rather than failing.

All IDs are `crypto.randomUUID()`. Stored as a single `Tab[]` at `store.local.get("shortcuts")`, so the whole tree is one storage value rewritten on every change. Cross-tab sync comes free from the store.

### Icons

One `IconSpec` union covers tabs, folders and shortcuts:

```ts
type IconSpec =
  | { type: "favicon" }                                  // shortcut default
  | { type: "folder" }                                   // folder default
  | { type: "color"; color: AccentColor }                // legacy: first letter on a tile
  | { type: "mono"; text: string; color: AccentColor }   // 1–2 chosen characters
  | { type: "glyph"; name: string; color?: AccentColor } // from the app's own icon set
  | { type: "image"; key: string }                       // uploaded blob, IndexedDB
```

`favicon`, `folder` and `color` predate the rest and are still what sits in existing users' storage, so **every consumer must handle them**. Keeping them legal is what let the model change land with no migration pass. `icon` is optional throughout; absent means the default for that kind.

`image` icons are blobs in the `shortcut-icons` IndexedDB store keyed by a UUID — see [storage.md](storage.md#indexeddb).

### URL normalization

`addShortcut`, `editShortcut`, `addShortcutToFolder`, `editShortcutInFolder` and `makeShortcut` all run the URL through `normalizeUrl()` (`url.ts:59`) and refuse the write when it returns `""`. That is the only URL validation in the app, and it does three jobs:

- **Canonical form.** `example.com` is stored as `https://example.com/`, so it navigates correctly and the favicon helper resolves. Previously the raw string was stored and `window.location.href = "example.com"` resolved *relative to the extension page*.
- **Rejecting junk.** A bare string only becomes a URL if it could plausibly be a host. Without that check, `new URL("https://not a url at all")` percent-encodes the spaces and returns a "valid" URL. An explicit scheme is trusted, so `http://wiki` still works.
- **Rejecting `javascript:` and `data:`.** A stored shortcut reaches `window.location.href` in `dock.ts`, so these would be a stored-XSS vector.

`dock.ts` also normalizes at navigation time, which covers shortcuts saved before any of this existed.

### Limits

| Constant | Value | Enforced in |
|---|---|---|
| `MAX_TABS` | 6 | `addTab` |
| `MAX_ITEMS_PER_TAB` | 256 | `addShortcut`, `addFolder`, `insertItem`, `moveItems` |
| `MAX_CHILDREN_PER_FOLDER` | 64 | `addShortcutToFolder`, `insertIntoFolder`, `moveItems`, `createFolderFromItems` |

Every operation that can hit a limit returns an `OpResult` rather than silently returning its input:

```ts
type OpResult = { tabs: Tab[]; ok: boolean; reason?: string }
```

`tabs` is always usable — unchanged when `ok` is false — so a caller that doesn't care about the reason can still just save the result. `reason` is a user-facing sentence; the settings panel puts it in a toast. `reason` can also be set on a *successful* result, for partial outcomes ("2 folders skipped — folders can't nest").

For pre-flight checks (disabling an Add control before it's pressed) there are `tabCapacity`, `itemCapacity` and `folderCapacity`, each returning `{ used, max, free }`.

## Pure operations

`shortcuts.ts` imports only `url.ts` (a zero-dependency leaf) and a type from `defaults.ts`. Every function takes a `Tab[]` and returns a new one — the caller persists via `save()`.

**Lookups**

| Function | Effect |
|---|---|
| `findTab(tabs, tabId)` / `findFolder(tabs, tabId, folderId)` | `null` when absent |
| `locate(tabs, itemId)` | Finds an item **anywhere** → `{ tab, item, folder, index }` or `null` |
| `allShortcutUrls(tabs)` | Every URL, for import duplicate detection |
| `collectImageKeys(tabs)` | Every referenced `image` icon key, for the blob sweep |

`locate` is the workhorse: the settings panel never needs to know whether the thing it is editing is top-level or inside a folder.

**Mutations** — those returning `OpResult` are marked ⚠

| Function | Effect |
|---|---|
| ⚠ `addTab` / `editTab` / `deleteTab` / `reorderTabs` | Tab CRUD; tabs now carry an optional icon |
| ⚠ `addShortcut` / ⚠ `addFolder` / ⚠ `addShortcutToFolder` | Append |
| `makeShortcut(name, url, icon?)` | A detached `Shortcut`, or `null` on a bad URL |
| ⚠ `editShortcut` / ⚠ `editShortcutInFolder` / `editFolder` | Update in place |
| `deleteItem` / `deleteShortcutFromFolder` | Remove one |
| `deleteItems(tabs, ids)` | Batch remove, every tab, top level **and** inside folders |
| `reorderItems` / `reorderFolderChildren` | Reorder within a container |
| `extractItem(tabs, itemId)` | → `[newTabs, TabItem \| null]` |
| ⚠ `insertItem` / ⚠ `insertIntoFolder` | Insert at an index |
| ⚠ `moveItems(tabs, ids, dest)` | **The move primitive** |
| ⚠ `createFolderFromItems(tabs, tabId, ids, name, icon?)` | Gather shortcuts into a new folder in the first one's slot |
| `sortContainer(tabs, tabId, folderId)` | Alphabetise one container |
| `duplicateItem(item)` | Copy with fresh IDs, children included |

`moveItems` is what every gesture composes: extract each ID from wherever it is, then re-insert them in order at one destination (`{ tabId, folderId?, index? }`). It checks capacity for the whole batch before writing anything, and drops folders when the destination is a folder rather than refusing the move. Reorder, file-into-folder, and move-to-tab are all one call to it.

`extractItem` returns `TabItem | null`. The previous version ended in `return [updated, extracted!]` with a non-null assertion that was false whenever the ID wasn't found, handing callers `undefined` typed as a `TabItem`.

## The icon layer

`shortcut-icon.ts` is the single source of truth for how a shortcut looks. Before it, the ten palette colours had **four** disagreeing JS definitions (`dock.ts`, `shortcut-settings.ts`, `settings.ts`, `search-provider-shortcuts.ts`) that also disagreed with the `--swatch-*` CSS tokens, so the same shortcut rendered one colour in the dock and another in settings. There were also two favicon helpers that behaved differently on a scheme-less URL.

```ts
renderIcon(spec, { kind, name, url }, { size?, className? }): HTMLElement
```

- **Colours are never resolved to hex in JS.** A swatch is emitted as `var(--swatch-<name>)`, so the CSS tokens stay the only definition and light/dark keep their separate values for free.
- **`faviconUrl()` normalizes first**, so `example.com` and `https://example.com` resolve identically.
- **Omit `size` to let CSS size the element.** That is how the dock keeps sizing icons from a stylesheet (so the Dashboard layout can enlarge them) while the settings panel sizes inline.

The returned element carries `sc-icon` plus one variant class — `sc-icon-img`, `sc-icon-tile`, or `sc-icon-glyph` — which is the whole styling contract. Failed favicons swap themselves for the `link` glyph; a missing uploaded blob falls back to the kind's default.

`ICON_GLYPHS` is the list offered by the picker. `forgetImage(key)` drops a cached blob URL after an upload is replaced.

## The dock

`dock.ts` — the row of shortcuts, in all three layouts. It renders, it navigates,
and (since the overhaul) it edits: reorder by dragging a tile, right-click for a
menu, middle-click to open in a new tab.

**Files:** `src/dock.ts` (601) renders and lays out the row; `src/dock-magnify.ts`
(154) is the Immersive fisheye; `src/dock-drag.ts` (360) is the on-page drag;
`src/dock-menu.ts` (233) is the context menu and the inline editor.

**Structure** (all in `index.html`):

```
#dock-wrapper              .dock-wrapper — hidden when there are no tabs
├─ #dock                   sizing tokens live here; ::before is the glass shelf
│  └─ #dock-scroll         horizontal scroll + the edge-fade mask
│     └─ #dock-groups      offsetParent for the fisheye; the tab-swap animates here
│        ├─ #dock-suggestions   recommendation tiles (hidden when empty)
│        ├─ #dock-divider       hidden with the suggestions
│        └─ #dock-items         the active tab's items
└─ #dock-tabs              tab pills + #dock-tabs-indicator, hidden below 2 tabs
```

### Three presentations, one element

`layout.ts` moves `#dock-wrapper` between frames; `dock.ts` reads the mode back
out of the store and drives everything else from one `MODES` table.

| | Immersive | Default | Dashboard |
|---|---|---|---|
| Where | pinned bottom-centre | in-flow under the search bar, above the cards | in the left column, under the search bar |
| Surface | a glass shelf | none | none |
| Tile / icon | 58px / 34px | 54px / 26px | 68px / 25px, circular |
| Names | hover tooltip | hover tooltip | printed under the tile |
| Max rows | 1 | 2 | 3 |
| Fisheye | yes | — | — |

Only Immersive floats free of the page, so only Immersive gets a container. The
other two sit inside a composition that already has structure, and a second slab
there would read as a toolbar.

### Laying out the row

The row is placed by `relayout()`, not by the browser. It picks the **fewest rows
that fit** and then assigns every tile an explicit `grid-row` / `grid-column`:

1. Try one row. If the tiles fit the available width, take it.
2. Otherwise try two, then three, up to the mode's `maxRows`.
3. If even `maxRows` won't hold them, stay at `maxRows` and scroll horizontally.

Rows are chosen for the suggestions and the shortcuts **together**, so both
groups sit on the same number of rows and the divider between them spans the
full height. Within a group, `cols = ceil(count / rows)` and item *i* lands at
`(row i/cols, col i%cols)` — plain row-major, so the reading order is the stored
order at any row count, and a short last row simply ends early.

**Available width comes from the frame, never from the dock.** The dock is
shrink-to-fit, so its own width is a *result* of the last pass; reading it back
would let one wrapped row keep the next pass wrapped. The per-mode cap lives in
`MODES[…].maxWidth` rather than in CSS for the same reason —
`getComputedStyle` hands back a percentage max-width verbatim, which can be read
but not measured against.

Explicit placement is also what the fisheye and the drag engine are built on:
both displace tiles with transforms against a snapshot, which would be
meaningless if the browser were free to reflow the row underneath.

**Edge fades** are the only cue that the row is cut off — there is no scrollbar
and, past `maxRows`, no wrap either. `updateFades()` stamps
`data-fade="left|right|both"` on `#dock` from the scroll position and CSS masks
the matching edge.

### The fisheye

`dock-magnify.ts`. Every cell is scaled by its distance from the pointer
(`cos²` falloff over 2.4 tile widths, peaking at 1.55×) and pushed sideways by
however much its neighbours grew, so the row spreads around the cursor instead
of overlapping. The push is derived, not measured: a cell's displacement is the
total extra width of everything to its left, plus half its own, recentred on the
row. That means every frame is arithmetic over one snapshot — no layout reads
while the pointer moves.

Two pieces of the layout exist only to serve it:

- **`--dock-headroom`** — top padding on the scroller so a tile at full
  magnification can rise clear of the shelf. The glass is `#dock::before`
  starting *below* that padding, which is why the shelf stays compact while the
  icons stand above it.
- **`--dock-spread`** — slack at each end of the row. Without it the tiles under
  the cursor push their neighbours past the scroller and the edge fades cut in
  on a row that fits perfectly well at rest.

Transforms track the pointer with no transition; `.is-settling` adds one for the
220ms of entering and leaving, so neither snaps. `prefers-reduced-motion` skips
the whole module, and a drag suspends it.

### Dragging on the page

`dock-drag.ts`. Deliberately not `shortcut-drag.ts`: that engine drags a
*selection* around the settings grid, knows about the tab rail and the
breadcrumb, and lives inside a dialog. This one drags exactly one tile and has
three destinations — a new slot in the row, a folder tile, or another tab's pill.

Geometry is snapshotted at pick-up and every frame after is arithmetic over it.
The lifted tile keeps its grid slot (it is only made invisible) and a clone
follows the cursor; the others are translated by the difference between the slot
they hold and the slot they would hold, so one CSS transition is the whole
animation. Dropping flies the clone to its landing rect while the row is
released underneath, so the handoff is invisible. Escape cancels.

Drop targets are found with `document.elementFromPoint`, not `e.target`. The
drag can't take pointer capture — every move would then report the tile being
dragged and a drop onto a tab pill could never be seen.

Folders accept shortcuts only: the model is one level deep, and `moveItems`
would silently drop a folder rather than nest it. A move to another tab reports
itself in a toast with **Undo**, since the shortcut leaves the view.

A drag ends in a click on the tile it started from, so `dockDragSuppressedClick()`
gates the navigation handler — without it every reorder would also open the site.

### Menus, editing and folders

**Right-click** a tile for Open / Open in new tab / Edit… / Duplicate / Remove.
Removing is immediate with an Undo toast, matching the settings panel.
**Middle-click** opens in a new tab (and `mousedown` is swallowed, or the browser
starts its autoscroll cursor instead).

**Edit…** opens an inline editor anchored to the tile — name, address, icon.
Every keystroke lands in the store after 300ms and the debounce is flushed on
close, so the tile behind it updates as you type and there is no Save button to
miss. An address that doesn't normalize leaves the stored value alone and marks
the field rather than writing junk. Anything beyond those three fields — folders,
moves, bulk work — is handed to the settings panel by the **All settings**
button. The editor reuses `createIconPicker` verbatim; the `.dock-edit` rule
remaps the four palette tokens the picker draws from, which is what lets a
control built for the settings dialog sit on a dark popover.

**Folders** open an `above-center` popover: a header with the folder's icon, name
and child count, then a 4-column grid of tiles. Clicking a child navigates and
closes; middle-clicking opens it in a new tab.

### Tabs

The pill row sits under the dock in every layout and is hidden below two tabs.
The active pill's underline is **one element that slides** (`#dock-tabs-indicator`),
rather than a border on each pill — that is what makes switching read as a single
movement. The pills and the indicator move on the press; only the icons wait,
crossfading out in the direction the new tab lies and arriving from the far side.

### Labels

Outside Dashboard there is **one** tooltip element, reused, parented to `<body>`.
It has to be: the scroller clips its overflow, and in Immersive the tile it
belongs to is being scaled out from under it. The previous dock created a
label element per item and tracked them in a module-level array that had to be
swept on every render.

## The settings panel

`shortcut-settings.ts` fills `#sc-panel`, which `settings.ts` creates. Three columns:

```
#sc-panel  .flex
├─ .sc-rail        tab rail — one row per tab, icon + name + item count, then New tab
├─ .flex-1         header (breadcrumb, search, Add, ⋯) / .sc-grid / .sc-selection-bar
└─ .sc-detail      the item, tab, or draft being edited — hidden when nothing is
```

The settings dialog is 900×600 to fit it; see [settings-ui.md](settings-ui.md).

### State

```ts
let tabId, folderId          // where you are
let selection: Set<string>   // what's picked
let detail: Detail | null    // what the right pane shows
let query, searchAllTabs     // the filter
let anchorId, focusId        // Shift-click anchor, roving tabindex
let grabbedId, grabOrigin    // keyboard drag
```

**There is no selection mode.** Selection is ambient — click selects, Cmd/Ctrl-click toggles, Shift-click ranges, and a `.sc-selection-bar` appears at two or more. The old `selectionMode` flag was module-global and never reset when the dialog closed, so reopening settings could land you back in it.

`reconcile()` runs on every `shortcuts` change and repairs stale state before re-rendering: a deleted tab resets `tabId`, a deleted folder drops `folderId`, deleted items leave `selection` and `detail`.

### Clicking

| Gesture | Result |
|---|---|
| Click a shortcut | Select it and open its detail pane |
| Click a folder | **Drill into it** — that is what clicking a folder means |
| Click the breadcrumb's current segment | Edit that tab or folder (rename, icon) |
| Cmd/Ctrl-click | Add to or remove from the selection |
| Shift-click | Select the range from the anchor |
| Click a tile's ⋯, or right-click | Edit / Open / Duplicate / New folder / Move to… / Delete |
| Click a search result inside a folder | Navigate there, then open its detail |

### The detail pane

Three modes, discriminated on `Detail`: an existing `item`, a `tab`, or a draft (`new-shortcut` / `new-folder`).

Existing items **auto-save** — a 350ms debounce on input, flushed on blur — so there is no Save button. The pane is guarded by a `detailKey` string (`renderDetail`, `shortcut-settings.ts:962`): a store change that doesn't alter *which* thing is being edited leaves the DOM alone, so a re-render can't yank the cursor out of a field mid-word. The grid behind it still updates live from the same writes.

Drafts (`buildDraftDetail`, `shortcut-settings.ts:1163`) live only in the pane until their URL is valid, so an incomplete shortcut never reaches the model. Typing an address first fills the name in from the host until the name field is touched, and adding one keeps the draft open so several can be added in a row.

### Keyboard

The grid is a roving-tabindex composite (`onGridKeyDown`, `shortcut-settings.ts:1320`). Column count is read back from the resolved `grid-template-columns`, so arrow navigation follows what is actually on screen.

| Key | Effect |
|---|---|
| ← → ↑ ↓ | Move focus (↑↓ by one row) |
| Home / End | First / last tile |
| Enter | Same as clicking |
| Space | **Pick the tile up**; arrows then reorder; Space again drops it |
| Delete / Backspace | Delete the tile, or the whole selection |
| Escape | Drop a grab → close the detail → clear the selection → leave the folder |

### Destructive actions

Everything deletes immediately and offers **Undo** in a toast for six seconds, restoring the pre-delete `Tab[]` wholesale. The one exception is deleting a tab, which still opens a confirmation naming exactly how many items go with it — it is the only action that can destroy dozens of things at once.

### Uploaded icon cleanup

`collectGarbage()` sweeps the `shortcut-icons` store against `collectImageKeys(getTabs())` three seconds after init, deleting anything unreferenced. Sweeping beats tracking deletes because an item can disappear through a dozen paths (delete, tab delete, undo, restore-from-backup), and each one would otherwise have to remember to free the blob.

## Refactor candidates

- **`shortcut-settings.ts` is 1525 lines.** Rail, grid, detail pane, menus and keyboard handling in one module. The detail pane in particular (three modes, ~400 lines) is a self-contained widget that could live in its own file.
- **`renderRail` / `renderHeader` / `renderGrid` rebuild from `innerHTML`-equivalent teardown.** The detail pane is guarded against this but the grid isn't, so a store write from another tab still drops grid scroll position. A keyed reconcile over `data-id` would fix it.
- **`createFolderFromItems` computes its insertion slot with an O(n²) `includes` scan.** Correct, and n ≤ 256, but a Set of kept IDs would say the same thing more plainly.
- **Search scope is a two-state toggle in the field.** It works, but "This tab / All tabs" as a text button next to a magnifier is a control with no precedent elsewhere in the app.
- **The `+ Add` tile and the header `Add` button open the same menu** from two places in the same view. One of them is redundant.
- **Icon rendering has no size token.** `renderIcon(..., { size: 34 })` and friends hard-code pixel values at six call sites; the dock's come from `--dock-icon`. A small scale (`sm`/`md`/`lg`) would keep them in step.
- **`render()` in `dock.ts` rebuilds the whole row, including the tab pills.** Cheap at these counts, but it means a keystroke in the inline editor discards and recreates every tile — and the editor's popover is left anchored to a node that is no longer in the document. A keyed reconcile over `data-dock-id` would fix both.
- **The dock's drag is pointer-only.** There is no keyboard path to reordering on the page, unlike the settings grid's Space-to-grab. The gesture is also single-item; the settings grid drags a selection.
- **`MODES` in `dock.ts` holds sizes that the stylesheet also needs.** They are published as custom properties (`--dock-tile`, `--dock-gap`, `--dock-spread`) so there is one source, but the split means a new layout has to be added in both files.
- **Nothing is shown when a tab is empty.** A tab with no items renders an empty row rather than an invitation to add one; only a complete absence of tabs hides the dock.
