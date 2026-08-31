/**
 * Pure todo data. No imports, no DOM, no storage — every function takes the
 * array and returns a new one. `src/todo.ts` owns the UI and the persistence.
 */

export type Priority = "none" | "low" | "medium" | "high"

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly"

export type Recurrence = { freq: RecurrenceFreq; interval: number } | null

export type Todo = {
  id: string
  /** Set on a subtask, pointing at its parent. Subtasks never nest further. */
  parentId: string | null
  title: string
  description: string | null
  url: string | null
  dueDate: string | null
  priority: Priority
  recurrence: Recurrence
  pinned: boolean
  completed: boolean
  /**
   * When this was last checked off. A recurring todo keeps `completed: false`
   * and only stamps this, which is what lets today's progress count it.
   */
  completedAt: string | null
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  order: number
}

export const MAX_TODOS = 500
export const MAX_PINNED = 3

export type NewTodo = {
  title: string
  description?: string | null
  url?: string | null
  dueDate?: string | null
  priority?: Priority
  recurrence?: Recurrence
  parentId?: string | null
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

/** Local `YYYY-MM-DD`. Due dates are bare dates, so they compare as strings. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function addToDate(key: string, r: { freq: RecurrenceFreq; interval: number }): string {
  const [y, m, d] = key.split("-").map(Number)
  const n = Math.max(1, r.interval)
  if (r.freq === "daily" || r.freq === "weekly") {
    const step = r.freq === "weekly" ? 7 * n : n
    const next = new Date(y, m - 1, d + step)
    return todayKey(next)
  }
  const months = r.freq === "monthly" ? n : n * 12
  const target = new Date(y, m - 1 + months, 1)
  const day = Math.min(d, daysInMonth(target.getFullYear(), target.getMonth()))
  return todayKey(new Date(target.getFullYear(), target.getMonth(), day))
}

/**
 * The first occurrence strictly after today. Advancing from the stored due date
 * rather than from today keeps a weekly todo on its weekday even when it was
 * checked off late; the loop is what skips the occurrences that were missed.
 */
export function nextDueDate(dueDate: string, recurrence: Recurrence, today = todayKey()): string {
  if (!recurrence) return dueDate
  let next = addToDate(dueDate, recurrence)
  for (let i = 0; i < 500 && next <= today; i++) {
    next = addToDate(next, recurrence)
  }
  return next
}

/* ── Normalization ──────────────────────────────────────────────────────── */

const PRIORITIES: Priority[] = ["none", "low", "medium", "high"]
const FREQS: RecurrenceFreq[] = ["daily", "weekly", "monthly", "yearly"]

function normalizeRecurrence(value: unknown): Recurrence {
  if (!value || typeof value !== "object") return null
  const r = value as Record<string, unknown>
  if (!FREQS.includes(r.freq as RecurrenceFreq)) return null
  const interval = Number(r.interval)
  return { freq: r.freq as RecurrenceFreq, interval: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1 }
}

/**
 * Fills in fields added after a todo was written. Todos are stored as raw JSON
 * that predates priority, pinning, archiving, recurrence and subtasks, so every
 * read runs through here rather than trusting the declared type.
 */
export function normalizeTodos(todos: unknown): Todo[] {
  if (!Array.isArray(todos)) return []
  const now = new Date().toISOString()
  const ids = new Set<string>()

  const normalized = todos
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof t.id === "string")
    .map((t, i) => {
      ids.add(t.id as string)
      const completed = t.completed === true
      return {
        id: t.id as string,
        parentId: typeof t.parentId === "string" ? t.parentId : null,
        title: typeof t.title === "string" ? t.title : "",
        description: typeof t.description === "string" ? t.description : null,
        url: typeof t.url === "string" ? t.url : null,
        dueDate: typeof t.dueDate === "string" ? t.dueDate : null,
        priority: PRIORITIES.includes(t.priority as Priority) ? (t.priority as Priority) : "none",
        recurrence: normalizeRecurrence(t.recurrence),
        pinned: t.pinned === true,
        completed,
        completedAt: typeof t.completedAt === "string" ? t.completedAt : null,
        archived: t.archived === true,
        archivedAt: typeof t.archivedAt === "string" ? t.archivedAt : null,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : now,
        updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : now,
        order: typeof t.order === "number" ? t.order : i,
      } satisfies Todo
    })

  // A subtask whose parent is gone would be invisible in every view.
  const orphansAdopted = normalized.map((t) =>
    t.parentId && !ids.has(t.parentId) ? { ...t, parentId: null } : t
  )

  return enforcePinLimit(orphansAdopted)
}

function enforcePinLimit(todos: Todo[]): Todo[] {
  // Only a live top-level todo can hold a pin, so subtasks and anything already
  // gone from the active list are cleared before the limit is counted.
  const eligible = (t: Todo): boolean => !t.parentId && !isArchived(t)
  todos = todos.map((t) => (t.pinned && !eligible(t) ? { ...t, pinned: false } : t))

  const pinned = todos.filter((t) => t.pinned)
  if (pinned.length <= MAX_PINNED) return todos
  const keep = new Set(
    [...pinned].sort((a, b) => a.order - b.order).slice(0, MAX_PINNED).map((t) => t.id)
  )
  return todos.map((t) => (t.pinned && !keep.has(t.id) ? { ...t, pinned: false } : t))
}

/* ── Mutations ──────────────────────────────────────────────────────────── */

export function addTodo(todos: Todo[], data: NewTodo): Todo[] {
  if (todos.length >= MAX_TODOS) return todos
  const maxOrder = todos.reduce((max, t) => Math.max(max, t.order), 0)
  const now = new Date().toISOString()
  const parentId = data.parentId ?? null
  const todo: Todo = {
    id: crypto.randomUUID(),
    parentId,
    title: data.title,
    description: parentId ? null : data.description ?? null,
    url: parentId ? null : data.url ?? null,
    dueDate: parentId ? null : data.dueDate ?? null,
    priority: parentId ? "none" : data.priority ?? "none",
    recurrence: parentId ? null : data.recurrence ?? null,
    pinned: false,
    completed: false,
    completedAt: null,
    archived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    order: maxOrder + 1,
  }
  return [...todos, todo]
}

export function editTodo(
  todos: Todo[],
  id: string,
  data: Partial<Pick<Todo, "title" | "description" | "url" | "dueDate" | "priority" | "recurrence">>
): Todo[] {
  return todos.map((t) => {
    if (t.id !== id) return t
    const next: Todo = { ...t, ...data, updatedAt: new Date().toISOString() }
    // A repeat needs an anchor date to advance from.
    if (next.recurrence && !next.dueDate) next.dueDate = todayKey()
    return next
  })
}

/** Removes the todo and, if it is a parent, its subtasks. */
export function deleteTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((t) => t.id !== id && t.parentId !== id)
}

/**
 * Checks a todo off, or un-checks it. A recurring todo is never completed: its
 * due date rolls to the next occurrence, its subtasks reset, and only
 * `completedAt` moves — which is what keeps it in the active list.
 */
export function toggleTodo(todos: Todo[], id: string): Todo[] {
  const todo = todos.find((t) => t.id === id)
  if (!todo) return todos
  const now = new Date().toISOString()

  if (!todo.completed && todo.recurrence && todo.dueDate) {
    const next = nextDueDate(todo.dueDate, todo.recurrence)
    return todos.map((t) => {
      if (t.id === id) return { ...t, dueDate: next, completedAt: now, updatedAt: now }
      if (t.parentId === id) return { ...t, completed: false, completedAt: null, updatedAt: now }
      return t
    })
  }

  const completed = !todo.completed
  return todos.map((t) => {
    if (t.id !== id && t.parentId !== id) return t
    // A subtask is only dragged along when a parent is completed, never when
    // one is re-opened — re-opening a parent shouldn't undo finished subtasks.
    if (t.parentId === id && !completed) return t
    return {
      ...t,
      completed,
      completedAt: completed ? now : null,
      // Completing drops the pin, as archiving does: a pin is a claim on one of
      // three slots in the active list, and this is leaving it.
      pinned: completed ? false : t.pinned,
      updatedAt: now,
    }
  })
}

export function countPinned(todos: Todo[]): number {
  return todos.filter((t) => t.pinned && !t.parentId && !isArchived(t)).length
}

export function canPin(todos: Todo[], id: string): boolean {
  const todo = todos.find((t) => t.id === id)
  if (!todo || todo.parentId) return false
  return todo.pinned || countPinned(todos) < MAX_PINNED
}

export function setPinned(todos: Todo[], id: string, pinned: boolean): Todo[] {
  if (pinned && !canPin(todos, id)) return todos
  const now = new Date().toISOString()
  return todos.map((t) => (t.id === id ? { ...t, pinned, updatedAt: now } : t))
}

/** Moves a todo (and its subtasks) to the archive, completed or not. */
export function archiveTodo(todos: Todo[], id: string): Todo[] {
  const now = new Date().toISOString()
  return todos.map((t) =>
    t.id === id || t.parentId === id
      ? { ...t, archived: true, archivedAt: now, pinned: false, updatedAt: now }
      : t
  )
}

/** Back to the active list: un-archived *and* un-completed, since the active
 *  list holds neither. */
export function restoreTodo(todos: Todo[], id: string): Todo[] {
  const now = new Date().toISOString()
  return todos.map((t) => {
    if (t.id !== id && t.parentId !== id) return t
    if (t.parentId === id) return { ...t, archived: false, archivedAt: null, updatedAt: now }
    return { ...t, archived: false, archivedAt: null, completed: false, completedAt: null, updatedAt: now }
  })
}

export function clearArchive(todos: Todo[]): Todo[] {
  const gone = new Set(todos.filter((t) => !t.parentId && isArchived(t)).map((t) => t.id))
  return todos.filter((t) => !gone.has(t.id) && !(t.parentId && gone.has(t.parentId)))
}

/**
 * Reorders within one group. `order` is only meaningful relative to the group
 * it was renumbered in — groups are derived, so two todos in different groups
 * can hold the same `order` without anything going wrong.
 */
export function reorderTodos(todos: Todo[], sectionIds: string[], fromId: string, toId: string): Todo[] {
  const sectionSet = new Set(sectionIds)
  const section = todos.filter((t) => sectionSet.has(t.id)).sort((a, b) => a.order - b.order)
  const fromIdx = section.findIndex((t) => t.id === fromId)
  const toIdx = section.findIndex((t) => t.id === toId)
  if (fromIdx === -1 || toIdx === -1) return todos
  const [moved] = section.splice(fromIdx, 1)
  section.splice(toIdx, 0, moved)
  const orderMap = new Map(section.map((t, i) => [t.id, i]))
  return todos.map((t) => (orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t))
}

/* ── Queries ────────────────────────────────────────────────────────────── */

function isArchived(todo: Todo): boolean {
  return todo.archived || todo.completed
}

function byOrder(a: Todo, b: Todo): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt)
}

function byDue(a: Todo, b: Todo): number {
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || byOrder(a, b)
}

/** Top-level todos that are neither completed nor archived. */
export function getActive(todos: Todo[]): Todo[] {
  return todos.filter((t) => !t.parentId && !isArchived(t))
}

export function isOverdue(todo: Todo, today = todayKey()): boolean {
  return !isArchived(todo) && !!todo.dueDate && todo.dueDate < today
}

export function getOverdue(todos: Todo[], today = todayKey()): Todo[] {
  return getActive(todos).filter((t) => isOverdue(t, today)).sort(byDue)
}

/** Everything the archive view shows: completed todos and archived ones alike. */
export function getArchived(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => !t.parentId && isArchived(t))
    .sort((a, b) => {
      const key = (t: Todo) => t.archivedAt ?? t.completedAt ?? t.updatedAt
      return key(b).localeCompare(key(a))
    })
}

export type GroupKey = "pinned" | "overdue" | "today" | "upcoming" | "someday"

export type TodoGroup = {
  key: GroupKey
  label: string
  todos: Todo[]
  /** Date-sorted groups can't also be hand-sorted, so they carry no handle. */
  draggable: boolean
}

/**
 * The active list, partitioned. Groups are derived on every read, which is why
 * a todo moves from Today to Overdue on its own at midnight.
 */
export function groupActive(todos: Todo[], today = todayKey()): TodoGroup[] {
  const active = getActive(todos)
  const pinned = active.filter((t) => t.pinned)
  const rest = active.filter((t) => !t.pinned)

  const groups: TodoGroup[] = [
    { key: "pinned", label: "Pinned", todos: pinned.sort(byOrder), draggable: true },
    { key: "overdue", label: "Overdue", todos: rest.filter((t) => t.dueDate && t.dueDate < today).sort(byDue), draggable: false },
    { key: "today", label: "Today", todos: rest.filter((t) => t.dueDate === today).sort(byOrder), draggable: true },
    { key: "upcoming", label: "Upcoming", todos: rest.filter((t) => t.dueDate && t.dueDate > today).sort(byDue), draggable: false },
    { key: "someday", label: "No date", todos: rest.filter((t) => !t.dueDate).sort(byOrder), draggable: true },
  ]

  return groups.filter((g) => g.todos.length > 0)
}

export function getSubtasks(todos: Todo[], parentId: string): Todo[] {
  return todos.filter((t) => t.parentId === parentId).sort(byOrder)
}

export function subtaskStats(todos: Todo[], parentId: string): { done: number; total: number } {
  const subs = todos.filter((t) => t.parentId === parentId)
  return { done: subs.filter((t) => t.completed).length, total: subs.length }
}

/** Todos due on a given day and still open — what the calendar cross-link draws. */
export function getDueOn(todos: Todo[], dateKey: string): Todo[] {
  return getActive(todos)
    .filter((t) => t.dueDate === dateKey)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byOrder(a, b))
}

/**
 * Today's completion, for the trigger ring and the toolbar caption. `done`
 * counts anything checked off today, recurring todos included; `open` counts
 * what is still due today or already late.
 */
export function progressToday(todos: Todo[], today = todayKey()): { done: number; open: number } {
  let done = 0
  let open = 0
  for (const t of todos) {
    if (t.parentId) continue
    // `completedAt` is a UTC ISO stamp; the day it belongs to is the local one.
    if (t.completedAt && todayKey(new Date(t.completedAt)) === today) {
      done++
      continue
    }
    if (!isArchived(t) && t.dueDate && t.dueDate <= today) open++
  }
  return { done, open }
}
