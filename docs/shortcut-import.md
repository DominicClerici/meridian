# Importing and exporting shortcuts

**Files:** `src/shortcut-import.ts` (1129) · `src/bookmarks-api.ts` (39) · `src/ext-call.ts` (39) · `src/history-api.ts` (22)

## What this replaced

`history-import.ts` had been **unreachable** for some time before it was deleted. `initHistoryImport()` looked up `#sc-import-history` and returned early when it was absent — and nothing in the app created that button. `#sc-tab-select`, which it read the destination tab from, was likewise gone. So `#history-import-dialog` in `index.html` was orphaned markup and the whole 216-line module was dead: there was no way to import anything.

## The flow

`openImportDialog(preferredTabId?)` opens a three-step dialog. **Nothing is written until the last step**, so backing out at any point leaves the tree untouched.

```
source ──▶ pick ──▶ destination ──▶ commit (+ Undo toast)
```

Step state lives in the function's closure, not in module scope, so a dialog can't inherit anything from a previous one.

## Sources

| Source | Mechanism | Needs |
|---|---|---|
| Browser bookmarks | `bookmarks.getTree()`, walked into a flat list with folder paths | The `bookmarks` optional permission |
| Browsing history | `history.search` over 90 days, deduped by URL, ranked by `visitCount` | `history` (already granted) |
| Paste a list | One address per line | — |
| Bookmarks HTML file | The Netscape format every browser exports | — |
| Restore a backup | JSON written by `exportBackup()` | — |

A source whose API isn't present renders as a disabled card explaining why, rather than failing after it's picked. This is what the settings page looks like when the extension APIs are absent entirely (for instance when `dist/` is served over plain HTTP for testing): bookmarks and history are disabled, the other three still work.

### The permission request

`bookmarks` is an **optional** permission. It is declared in `optional_permissions` in both manifests rather than `permissions`, so installing the extension doesn't prompt for bookmark access and an update doesn't disable the extension pending re-approval. The prompt happens when someone picks that source.

`requestBookmarks()` therefore has to run **synchronously inside the click handler** — Chrome refuses a permission request that isn't tied to a user gesture, so nothing may be awaited before it. `pickSource()` is written around that constraint.

Declining is not an error: the dialog returns to the source list with an explanation.

### Parsing quirks

**Netscape HTML.** `<DT>` has no closing tag, so a nested `<DL>` may be parsed either as a child of the `<DT>` or as its next sibling depending on the file. `fromNetscapeHtml` handles both. Top-level `<DL>`s are found with `:not(:has(dt ancestor))` logic — any `<DL>` that isn't inside a `<DT>` is a root.

**Paste.** `Name | https://…` and `Name <https://…>` are both recognised; anything else is a bare URL and the name comes from the host.

**Everything** goes through `toCandidates()`, which normalizes each URL, drops the ones `normalizeUrl` rejects (including `javascript:` and `data:`), skips browser-internal schemes, dedupes within the batch, and flags any URL already present anywhere in the tree.

## Duplicate detection

`allShortcutUrls(tabs)` is normalized on both sides before comparison, so a legacy `example.com` and an incoming `https://example.com/` match. Duplicates are hidden by default behind a **"Hide N already saved"** toggle and are excluded from the initial selection, but they can be shown and imported deliberately.

## Destination

Three choices, plus one modifier:

- **An existing tab** — append to a tab you already have.
- **A new tab** — disabled at `MAX_TABS`.
- **A new folder** — one folder inside an existing tab.
- **Keep the folder structure** — offered only when the picked candidates actually carry paths.

Because **folders can't nest**, `buildFolders()` groups by `path[0]` and collapses everything deeper into that top-level folder. A bookmark at `Bookmarks bar / Work / Design / Tools` lands in a folder called `Bookmarks bar`. The checkbox says so.

`commitImport()` (`shortcut-import.ts:322`) builds the new items, truncates to whatever `itemCapacity` allows, appends, and reports `{ added, skipped, message }`. The panel turns that into a toast carrying **Undo**, which restores the pre-import `Tab[]`.

## Export and restore

`exportBackup()` downloads the whole `Tab[]` as JSON with a `format`/`version` header and a dated filename.

`parseBackup()` is deliberately paranoid — a backup is a user-supplied file, so nothing about its shape is assumed. Every tab, item and child is validated field by field, every URL goes back through `makeShortcut` (so a hand-edited backup can't inject a `javascript:` shortcut), fresh IDs are generated throughout, and over-long folders are truncated. Anything that doesn't validate is dropped rather than failing the whole file.

Restoring offers **Merge** (append the backup's tabs up to `MAX_TABS`) or **Replace everything**, both undoable from the toast.

## The extension API wrapper

`ext-call.ts` holds the calling-convention shim that `history-api.ts` and `bookmarks-api.ts` share:

> Chrome's `chrome.*` is callback-first and returns nothing. Firefox's `browser.*` is promise-only: it never invokes a trailing callback, and its argument validation rejects the extra parameter outright. Passing a callback *and* taking the return value covers both, with the throw as the third case.

It used to be private to `history-api.ts`. See [browser-compat.md](browser-compat.md).

## Refactor candidates

- **`shortcut-import.ts` is 1129 lines** and mixes four parsers, the commit logic, and a three-step dialog. The parsers are pure functions with no DOM in them and would be happier — and testable — in their own module.
- **The candidate list renders at most 300 rows** with a "filter to narrow" hint. It's honest, and Select-all still takes every match, but a real virtualised list would remove the caveat.
- **No progress for large histories.** `fromHistory` loops until it has 2000 candidates behind a single spinner; a long scan looks identical to a hung one.
- **Restore validation silently drops what it can't parse.** For a corrupted backup that is right; for a *partly* corrupted one the user is told "imported 40" with no hint that 5 were discarded.
- **`bookmarksGranted()` is exported but unused** — `pickSource` always calls `requestBookmarks()`, which resolves immediately when the permission is already held. Either use it to pre-label the card or drop it.
