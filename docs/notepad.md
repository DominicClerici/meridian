# Notepad

One freeform note, autosaved, in every layout.

**Source:** `src/notepad.ts`, the `#notepad-trigger` button in `index.html`, the `.notepad*` rules in `styles.css`.

## What it is

A `<textarea>` and a footer. There is no editor model, no document tree and no markdown parser: the note is a plain string, and what the user typed is byte-for-byte what is stored. That is the whole design decision the rest of this file follows from — the widget's job is to be instantly writable, not to be a document editor.

The only assistance is [list continuation](#list-continuation) on Enter.

## Storage

| Key | Namespace | Type | Default |
|---|---|---|---|
| `notepadBody` | `local` | `string` | `""` |
| `notepadUpdatedAt` | `local` | `number \| null` | `null` |
| `notepadEnabled` | `sync` | `boolean` | `true` |
| `notepadFont` | `sync` | `NotepadFont` (`"sans" \| "mono"`) | `"sans"` |

**The note is `local`, not `sync`, on purpose.** `browser.storage.sync` caps a single item at 8KB and throttles to roughly 120 writes a minute; a scratchpad hits both. The cost is that the note doesn't follow the user to another machine, which the settings panel says out loud rather than leaving them to discover.

`MAX_NOTE_LENGTH` (`defaults.ts`) is 50,000 characters, enforced as the textarea's `maxLength`. The cap is **visible before it is hit**: from 45,000 characters on (`COUNTER_THRESHOLD`, 90%) the footer's word count is replaced by `46,000 / 50,000 characters` in the warning colour.

### The write path

Typing never writes. `input` queues the value and schedules `flush()` 500ms out (`SAVE_DEBOUNCE_MS`), so a burst of typing lands as one pair of storage writes. `flush()` also runs on:

- **blur** — clicking away commits immediately,
- **`visibilitychange` → hidden** and **`pagehide`** (module scope, once for the module rather than once per body) — a new tab is far more likely to be closed or switched away from than sat on, and without these the last half-second of typing would be lost,
- **`onUnmount`** on the card, so a layout switch or a disabled widget doesn't drop pending text,
- **Ctrl/Cmd+S** in the editor, which also suppresses the browser's own save dialog.

`notepadUpdatedAt` is written **before** `notepadBody`, because the `notepadBody` subscription is what repaints every body — the other order would paint the previous edit time.

## Hosts

One builder, `buildNotepadBody()`, serves all three:

| Layout | Where |
|---|---|
| Default | `grid`, one column (no `span`) |
| Dashboard | `side` — the carousel |
| Immersive | popover behind `#notepad-trigger` |

Registration is `order: 50`, after Todos. There is no `renderTile()` because the notepad never lands in Dashboard's top row: a 118px tile can hold a glance, and a note that fits in one is a note that didn't need writing down.

**The immersive popover focuses the editor on open.** A trigger the user pressed deliberately is only ever pressed to write something.

**The trigger carries state**: `#notepad-badge` is a dot, shown whenever the note is non-empty. Closed, the widget still says whether there is anything in it.

### Live bodies

Like the todo list, bodies register themselves in a module-level `liveBodies` set and are driven from the store subscription rather than by re-rendering the card. `sweep()` drops any whose `root` has left the document and disconnects its `ResizeObserver`.

Two operations run across the set:

- **`paintAll()`** — footer only (word count, save status). Called on every status change and by a 60s interval that keeps *Edited 4m ago* honest. The interval starts with the first body and stops with the last.
- **`syncAll()`** — pulls `notepadBody` into each editor. **A focused editor is skipped**: it is the source of the write that triggered the sync, and overwriting it would eat keystrokes. Cross-tab edits therefore land in every idle tab, and a tab actively being typed in wins — last writer to flush takes the note.

`refreshCard("notepad")` is deliberately *not* used for content changes; it replaces the body wholesale and would throw away the caret and the scroll position.

## The editor

The textarea carries no chrome — no border, no inset field background. The card is the paper. That leaves two things to do the work a focus ring normally would:

- an accent `caret-color`, and
- the hairline above the footer, which goes from `rgba(255,255,255,0.08)` to 55% accent on `.notepad:focus-within`, transitioned over `--transition-speed`.

**Height is JavaScript, not CSS.** `resize()` measures `scrollHeight` at `height: auto` and clamps it between `MIN_EDITOR_PX` (132) and `MAX_EDITOR_PX` (340), switching `overflow-y` to `auto` at the ceiling. It is driven by a `ResizeObserver` on `root` that reacts **only to width changes** — width is what re-wraps the text, and it is the one dimension the observer isn't itself setting, so it can't feed back. That observer's first callback is also what gives the editor a real measurement: at build time the body isn't in the document yet.

In Default's packed grid, growing the card triggers a repack through the grid's own per-card observer, so the column reflows as the note gets longer ([layouts.md](layouts.md#staying-current)).

The empty state is the placeholder. A notepad that greets you with an illustration you have to click past is a notepad that made you work to write in it.

## List continuation

`continueList()` runs on plain Enter with a collapsed selection, and does nothing otherwise (Shift/Ctrl/Alt+Enter, or Enter over a selection, are the browser's).

It matches the text from the line start to the caret against two patterns:

| Typed | Enter gives |
|---|---|
| `- oat milk` | `- ` (also `*`, `+`, `•`) |
| `- [ ] pack bag` | `- [ ] ` |
| `1. draft memo` | `2. ` (also `1)` → `2)`) |
| `  - indented` | `  - ` — leading whitespace is carried |
| `- ` (empty item) | the marker is deleted; the list ends |

Numbers increment from the line above; nothing renumbers the rest of the list afterwards. That is deliberate — a renumbering pass is a document model, and this widget doesn't have one.

**Both edits go through `document.execCommand`** (`insertText` / `delete`), with a `setRangeText` + synthetic `input` fallback. `execCommand` is deprecated but it is still the only way to change a textarea's value and have the browser record the change on its native undo stack. A scratchpad where Ctrl+Z does nothing feels broken.

## The footer

`word count · status · ⋮`, on a hairline.

**Status** has four faces: the transient `flash` (a message, 3s), `Saving…`, `Saved` with a check (1.8s, then back to idle), and idle — `Edited 4m ago`, or nothing at all when the note is empty.

**The ⋮ menu** holds *Copy text* and *Clear note*, both disabled with a `hint` when the note is empty rather than hidden.

**Clear is an inline confirm, not `confirm()`.** A native dialog swallows the click the popover's outside-click handler is listening for, closing the widget out from under the user — the same trap `todo.ts` documents. Choosing *Clear note* swaps the footer for `Clear this note? [Cancel] [Clear]`, which times out back to normal after 6 seconds. The clear itself runs as a select-all plus `execCommand("delete")` through the editor, so it lands on the undo stack; the flash afterwards says so (`Cleared — Ctrl+Z to undo`, `⌘Z` on a Mac).

## Settings

The **Notepad** accordion in the Widgets tab: the enable checkbox, a **Typeface** select (Sans / Monospace), the line explaining that the note is device-local, and a destructive **Clear note**. The settings-dialog clear *does* use `confirm()` — there is no popover for it to close.

`notepadFont` is applied by swapping one Tailwind font class on the editor, driven by a **single module-level subscription** that walks `liveBodies`. Per-body subscriptions would leak, since nothing unsubscribes when a card is discarded.

## Refactor candidates

- **Nothing renumbers an ordered list.** Inserting an item in the middle of `1. 2. 3.` leaves two items numbered the same. Fixing it properly means a line model the widget deliberately doesn't have; fixing it cheaply means a renumber pass on Enter that would fight the user editing a deliberately non-sequential list.
- **Concurrent edits are last-writer-wins.** Two tabs typing into the note at once will clobber each other at the 500ms flush boundary, with no merge and no notice. Rare on a new-tab page, but real.
- **The note can't be searched.** It is invisible to the search bar, which is where a user with a long scratchpad would look for something in it.
- **`Tab` is not captured**, so there is no way to indent inside the editor. That is the accessible default — capturing Tab traps keyboard users — but a Tab-indents-with-Escape-to-leave arrangement would be better than either.
- **One note.** The store shape is a bare string, so adding a note picker later means a migration. See the *Note model* choice in the design notes: this was the deliberate trade for a widget that opens ready to type.
- **The height clamp is in pixels, not in lines.** `MIN_EDITOR_PX` / `MAX_EDITOR_PX` were picked against the 13px/1.65 body and don't track the typeface, so the monospace face fits a slightly different number of lines in the same box.
