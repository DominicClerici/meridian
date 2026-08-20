# Todos

**Files:** `src/todos.ts` (128 lines, pure) · `src/todo.ts` (455 lines, UI)

Same split as shortcuts: a pure data module with no imports, and a UI module that renders it. See [widgets.md](widgets.md) for the trigger/popover pattern this follows.

## Data model

```ts
type Todo = {
  id: string
  title: string
  description: string | null
  url: string | null
  dueDate: string | null      // "YYYY-MM-DD"
  completed: boolean
  completedAt: string | null  // ISO
  createdAt: string           // ISO
  updatedAt: string           // ISO
  order: number
}
```

Stored as `Todo[]` at `store.local.get("todos")`. `MAX_TODOS` is 500, enforced in `addTodo` by silently returning the input.

`dueDate` is a bare date string, not a timestamp — it comes straight from an `<input type="date">`. Everything that compares it re-hydrates with an explicit time: `new Date(dueDate + "T23:59:59")` for overdue checks, `+ "T00:00:00"` for display, which keeps both in local time rather than UTC.

## Pure operations

| Function | Effect |
|---|---|
| `addTodo(todos, { title, description?, url?, dueDate? })` | Append with `order = max(order) + 1` |
| `editTodo(todos, id, partial)` | Patch only the provided fields; bump `updatedAt` |
| `deleteTodo(todos, id)` | Remove |
| `toggleTodo(todos, id)` | Flip `completed`, set or clear `completedAt` |
| `reorderTodos(todos, sectionIds, fromId, toId)` | Reorder within one section, renumbering `order` 0..n |
| `getOverdue(todos)` | Incomplete with a `dueDate` in the past, by `order` |
| `getActive(todos)` | Incomplete and not overdue, by `order` |
| `getCompleted(todos)` | Completed, most recently completed first |
| `purgeStale(todos)` | Drop expired items (below) |

**Sections are derived, not stored.** A todo doesn't know which section it's in; `getOverdue`/`getActive`/`getCompleted` partition the same array three ways on every read. That's why an item silently moves from Todo to Overdue when its due date passes.

**`reorderTodos` scopes to a section.** It filters the array to `sectionIds`, moves within that slice, then rewrites `order` as the slice's 0-based index for exactly those todos — so `order` values are only meaningful relative to their section, and re-ordering one section renumbers it independently of the others.

**`purgeStale`** drops completed todos older than **3 days** (by `completedAt`, falling back to `updatedAt`) and incomplete todos untouched for **6 months** (by `updatedAt`). It runs in `initTodo()` and again every time the popover opens.

## UI

**Trigger:** `#todo-trigger` in `#widgets`, with two absolutely-positioned badges — `#todo-badge-count` (top-right, overdue + active) and `#todo-badge-overdue` (top-left, danger-colored, overdue only). Both are gated on `todoShowBadges` and hidden at zero. `updateBadges()` re-runs on any `todos` change, so the counts stay live without the popover being open.

**Popover** (340px): a header with the title and a round accent add button, then a scrolling area (max 420px) of up to three accordion sections:

| Section | Label | Notes |
|---|---|---|
| Overdue | `Overdue (n)` in danger | Only rendered when non-empty |
| Todo | `Todo (n)` | Always rendered |
| Completed | `Completed (n)` | Only when non-empty; **collapsed by default** |

With no todos at all, an empty state (`todoEmpty` icon + "No todos yet") replaces the sections.

`rebuildSections()` is the local re-render, passed down to every row as `onUpdate` and called after add, edit, and delete.

**Rows** carry a checkbox, the title (struck through and 40% opacity when complete, with the description as a `title` tooltip), hover-revealed action buttons (open URL, edit, delete), a due-date pill (danger-tinted in the overdue section), and a drag handle. Completed rows get no drag handle and no due pill.

**The form** (`todoFormPopover`, `todo.ts:59`) is a promise-returning popover — title, description textarea, URL, and date — resolving to the form values or `null` on cancel or dismiss. Used for both add and edit:

```ts
const result = await todoFormPopover(anchor, "Edit Todo", prefill)
if (!result) return
save(editTodo(getTodos(), todo.id, result))
```

It's the only place in the codebase that models a dialog as an awaitable, and it reads considerably better than the callback style used everywhere else.

**Drag** here is **HTML5 drag-and-drop** (`draggable`, `dragstart`/`dragover`/`drop`), not the pointer engine used by shortcuts. `initSectionDrag()` is attached per section, so a todo can only be reordered within its own section — dropping across sections is impossible by construction. The drop indicator is a `border-t-2 border-accent` on the row being hovered.

## Refactor candidates

- **Two unrelated drag implementations.** Todos use HTML5 DnD; shortcuts use a hand-built pointer engine ([drag-and-drop.md](drag-and-drop.md)). Different behavior, different visuals, no shared code, in the same app.
- **The form popover styling bypasses the component kit.** `todo.ts:86` defines an `inputCls` of hard-coded `bg-white/[0.06]` and `border-white/[0.08]` values, then overwrites `createInput`'s class list with it — same for the cancel button overwriting `createButton`'s. The whole popover is styled against a dark surface with literal white alphas instead of tokens, so it will not survive a light-mode popover.
- **`purgeStale` deletes silently and permanently.** A completed todo vanishes three days later with no notice, no archive, and no undo, and the thresholds aren't configurable or documented in the UI.
- **`order` semantics are section-relative.** `addTodo` assigns `max(order) + 1` globally while `reorderTodos` renumbers a section from 0, so the two conventions collide — a reorder can hand a todo an `order` that already exists elsewhere.
- **Checkbox toggles bypass the re-render.** The row's checkbox mutates the title's classes directly instead of calling `onUpdate`, so a todo checked off stays sitting in the Todo section until the popover is reopened.
- **`MAX_TODOS` fails silently**, like every other limit in the codebase.
- **Badges count `getOverdue().length + getActive().length`** by running both partitions over the whole array on every `todos` change. Fine at 500 items, wasteful in principle.
- **No keyboard entry path.** Adding a todo takes a click on the trigger, a click on `+`, then a click on Save; Enter in the title field doesn't submit.
