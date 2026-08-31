# Todos

**Files:** `src/todos.ts` (402 lines, pure) · `src/todo.ts` (1236 lines, UI)

Same split as shortcuts: a pure data module with no imports, and a UI module that renders it. See [widgets.md](widgets.md) for the trigger/popover pattern this follows, and [layouts.md](layouts.md) for the card.

## Data model

```ts
type Priority = "none" | "low" | "medium" | "high"
type Recurrence = { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number } | null

type Todo = {
  id: string
  parentId: string | null     // set on a subtask; subtasks never nest further
  title: string
  description: string | null
  url: string | null
  dueDate: string | null      // "YYYY-MM-DD"
  priority: Priority
  recurrence: Recurrence
  pinned: boolean
  completed: boolean
  completedAt: string | null  // ISO — also stamped by a recurring completion
  archived: boolean
  archivedAt: string | null
  createdAt: string           // ISO
  updatedAt: string           // ISO
  order: number
}
```

Stored as `Todo[]` at `store.local.get("todos")`. `MAX_TODOS` is 500 and `MAX_PINNED` is 3.

`dueDate` is a bare date string, not a timestamp — it comes straight from an `<input type="date">`, so **dates compare as strings**: `todayKey()` produces the same local `YYYY-MM-DD` shape and `dueDate < todayKey()` is the overdue test. Nothing re-hydrates a due date into a `Date` except for formatting.

**Every read is normalized.** `getTodos()` in the UI runs `normalizeTodos()`, which fills in fields added after a todo was written (priority, pinning, archiving, recurrence, subtasks), re-parents orphaned subtasks, and clears pins that shouldn't exist. Stored data is raw JSON older than the current type, so nothing trusts the declared shape. `initTodo()` writes the normalized array back **once**, and only when a field is genuinely missing — this runs on every new tab, and each write is a `browser.storage` round trip.

## Three lives of a todo

| Where | Test |
|---|---|
| **Active** — the main list | `!completed && !archived` |
| **Archive** — behind the toolbar button | `completed \|\| archived` |
| Neither | Nothing is ever removed automatically |

Completing a todo and archiving one both take it out of the active list and put it in the archive; the difference is only whether it is finished. **An incomplete todo can be archived and stays incomplete**, sitting alongside the completed ones with an empty checkbox it can still be checked off in. `restoreTodo` is the one way back, and it clears *both* flags, because the active list holds neither.

There is no `purgeStale`. The old version deleted completed todos after three days and untouched ones after six months, silently and with no way back; the archive replaced it. The only deletions now are the row menu's **Delete** and the archive's **Clear archive** (a two-click button in the toolbar).

## Pure operations

| Function | Effect |
|---|---|
| `normalizeTodos(unknown)` | Fill missing fields, drop junk, adopt orphaned subtasks, enforce the pin limit |
| `addTodo(todos, { title, … , parentId? })` | Append with `order = max(order) + 1`; a subtask gets only a title |
| `editTodo(todos, id, partial)` | Patch the provided fields; a recurrence with no due date is anchored to today |
| `deleteTodo(todos, id)` | Remove the todo **and its subtasks** |
| `toggleTodo(todos, id)` | Complete or re-open — see below |
| `setPinned` / `canPin` / `countPinned` | Pinning, capped at `MAX_PINNED` |
| `archiveTodo` / `restoreTodo` / `clearArchive` | The archive |
| `reorderTodos(todos, sectionIds, fromId, toId)` | Reorder within one group, renumbering `order` 0..n |
| `groupActive(todos)` | The active list, partitioned (below) |
| `getArchived(todos)` | The archive, newest first |
| `getActive` / `getOverdue` / `getDueOn` | Top-level slices |
| `getSubtasks` / `subtaskStats` | One parent's children, and its `done/total` |
| `progressToday(todos)` | `{ done, open }` for the ring and the toolbar caption |
| `nextDueDate(dueDate, recurrence)` | The first occurrence strictly after today |

### `toggleTodo` carries three rules

1. **A recurring todo is never completed.** Its `dueDate` rolls to `nextDueDate`, its subtasks reset to incomplete, and only `completedAt` is stamped — so it stays in the active list and today's progress still counts it. This is the one case where `completedAt` is set while `completed` is false.
2. **Completing a parent completes its subtasks; re-opening one does not re-open them.** Un-checking a parent shouldn't undo finished work.
3. **Completing clears the pin**, exactly as archiving does — a pin is a claim on one of three slots in the active list, and the todo is leaving it.

`nextDueDate` advances from the stored due date rather than from today, then loops until it passes today. A weekly todo checked off four days late therefore stays on its weekday instead of drifting.

## Groups

Groups are **derived on every read**, never stored, which is why a todo moves from Today to Overdue by itself at midnight.

| Group | Contents | Order | Drag |
|---|---|---|---|
| Pinned | `pinned`, at most 3 | `order` | yes |
| Overdue | `dueDate < today` | due date | no |
| Today | `dueDate === today` | `order` | yes |
| Upcoming | `dueDate > today` | due date | no |
| No date | no `dueDate` | `order` | yes |

Empty groups aren't rendered. Date-sorted groups carry no drag handle: a hand-set order there would be immediately overruled by the dates.

`reorderTodos` renumbers a group 0..n, so **`order` is only meaningful inside a group** — two todos in different groups can share one without consequence. Ties break on `createdAt`.

## UI

**One builder, two hosts.** `buildTodoList()` returns the whole body — toolbar, list, and detail view — and both the immersive popover and the card use it. It re-renders itself from a module-level `store.local.subscribe("todos")`, so **no mutation path re-renders by hand**: everything writes through `save()` and the notification does the rest. That subscription is installed at module scope rather than in `initTodo()`, because a card body can be built during `applyLayout()`, before `DOMContentLoaded`.

**Sizing is container-driven.** The root carries Tailwind's `@container`, and the pieces that don't fit a narrow card hide themselves with `@min-[…]` variants — the same markup fills a ~298px card body in the Default 3-column grid, a ~316px immersive popover, and a ~383px Dashboard side column.

| Piece | Shown at |
|---|---|
| Repeat icon, link icon, subtask `2/5` chip | ≥ 300px |
| Drag handle | ≥ 360px |
| Description line under the title | ≥ 440px |

Those toggles live on a **wrapper** span carrying only `hidden` plus one variant (`atLeast()` in `todo.ts`). A variant reliably beats a *base* utility on the same element, but `hidden` next to the `inline-flex` that `icon()` and `chip()` already set is a coin flip decided by Tailwind's stylesheet order — and in the built CSS, `.inline-flex` lands after `.hidden`, so `hidden` would lose. The wrapper uses `display: contents` so the child stays a direct flex item of the row.

**Toolbar.** Left: `3 of 7 done today`, falling back to a plain count. Right: the archive toggle and the accent `+`. In the archive view it becomes a back arrow, `Archive · n`, and a two-click Clear. The `+` disables itself at `MAX_TODOS` rather than failing silently.

**Rows** are `checkbox · priority dot · title · repeat · link · subtask chip · due pill · pin · ⋮ · handle`. Clicking anywhere that isn't a control opens the detail view. The due pill is relative (`Today`, `Tomorrow`, `Fri`, `10d late`) with the exact date as its `title`, and is tinted danger when overdue, accent when due today.

**The pin button** is the row's only always-visible action once a todo is pinned; otherwise it appears on hover with the ⋮ button. When three todos are already pinned it renders disabled with an explaining `title` rather than vanishing.

**The ⋮ menu** (`createMenu`, see [components.md](components.md#createmenu)) holds Pin/Unpin · Edit · Complete · Archive/Restore · Delete. Pin is omitted for archived todos and disabled at the limit.

**Detail view** replaces the list in place — back arrow, checkbox, title, ⋮ — then the due date, repeat, priority, link and status fields, the description, the subtask list, and an Edit button. It is the only place subtasks can be added: an input at the end of the list commits on Enter, and focus is restored across the re-render that follows.

**The form** (`todoFormPopover`) is a promise-returning popover used for both add and edit — title, notes, link, due date, priority and repeat, with Enter in the title field submitting:

```ts
const result = await todoFormPopover(anchor, "Edit todo", todo)
if (!result) return
save(editTodo(getTodos(), todo.id, result))
```

Every control in it comes from the component kit with `tone: "popover"`. The old version overwrote `createInput`'s and `createButton`'s class lists with hard-coded `bg-white/[0.06]` values; the tone is the kit's own answer to the same problem. See [components.md](components.md#tones).

**Empty states teach.** With nothing at all: *"Add one with +. Give it a due date, a priority or a repeat, break it into subtasks, and click any todo to open its details."* With everything done: *"All clear"*, plus a button into the archive.

**Drag** is HTML5 drag-and-drop (`draggable`, `dragstart`/`dragover`/`drop`), attached per group, so a todo can only be reordered inside its own group — crossing groups is impossible by construction. The drop indicator is a `border-t-2 border-accent` on the hovered row.

## Trigger

`#todo-trigger` in `#widgets` (Immersive only). `index.ts` prepends the `todoList` glyph; `updateTrigger()` adds everything else:

| Part | Shows |
|---|---|
| `#todo-badge-count` (top-right) | Active todos |
| `#todo-badge-overdue` (top-left, danger) | Overdue todos |
| Progress ring | Today's completion — `done / (done + open)` from `progressToday` |

The ring is an inline SVG behind the glyph, `stroke-dasharray` on a rotated circle, accent-colored and danger-colored when anything is overdue. It hides its arc at zero, because a round line cap paints a dot even at zero length. All three are gated on `todoShowBadges`.

`progressToday` counts a todo as **done** when `completedAt` falls on today in *local* time (the stamp is UTC), and as **open** when it is active and due today or earlier. Recurring completions count, which is the reason they stamp `completedAt` at all.

## Calendar cross-link

When the calendar is connected, its day and week views draw the open todos due on each day beside the all-day events — accent-tinted, with a check-circle glyph (a pin, if pinned). `calendar.ts` reads them through `getDueOn()` and gates on `todoEnabled`; clicking one opens `showTodoPopover()` from `todo.ts`, a compact card that can check the todo off without leaving the calendar. `calendar.ts` subscribes to `todos` so a change in the widget reaches the calendar the same way a fetch does. Week columns show two chips per day and then `+n`.

The dependency runs one way — `calendar.ts` → `todo.ts` — and must stay that way.

## Refactor candidates

- **Two unrelated drag implementations.** Todos use HTML5 DnD; shortcuts use a hand-built pointer engine ([drag-and-drop.md](drag-and-drop.md)). Different behavior, different visuals, no shared code, in the same app.
- **Drag can't reschedule.** Dropping a todo from Upcoming into Today is the obvious way to change a due date, and it does nothing — groups are date-derived but drag only rewrites `order`.
- **No undo.** Delete and Clear archive are immediate; the two-click Clear is the only guard, and there is no toast primitive to offer anything better.
- **No keyboard entry path.** Enter submits the form now, but adding a todo still starts with a click on `+`; there is no quick-add field and no date parsing.
- **`MAX_TODOS` blocks the `+` button** but `addTodo` still returns the input unchanged if something calls it directly.
- **Rows re-render the whole body.** Checking one todo off rebuilds every row and both groups; fine at 500 items, wasteful in principle, and it means no row can hold transient state.
- **Recurrence is preset-only.** The data model carries `{ freq, interval }`, but the UI only offers six combinations and no end date.
