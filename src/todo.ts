import { store } from "./store"
import { icon } from "./icons/registry"
import type { Priority, Recurrence, Todo, TodoGroup } from "./todos"
import {
  MAX_PINNED,
  MAX_TODOS,
  addTodo,
  archiveTodo,
  canPin,
  clearArchive,
  deleteTodo,
  editTodo,
  getActive,
  getArchived,
  getOverdue,
  getSubtasks,
  groupActive,
  normalizeTodos,
  progressToday,
  reorderTodos,
  restoreTodo,
  setPinned,
  subtaskStats,
  todayKey,
  toggleTodo,
} from "./todos"
import {
  createButton,
  createCheckbox,
  createInput,
  createMenu,
  createPopover,
  createSelect,
} from "./components"
import type { MenuItem } from "./components"
import { registerCard } from "./layout"

let openPopoverClose: (() => void) | null = null

function getTodos(): Todo[] {
  return normalizeTodos(store.local.get("todos"))
}

/**
 * The only write path. `store.set` notifies synchronously, and every live body
 * re-renders off that notification — so nothing here ever re-renders by hand.
 */
function save(todos: Todo[]): void {
  store.local.set("todos", todos)
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

const MS_DAY = 86_400_000

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

type DueTone = "overdue" | "today" | "soon" | "later"

function dueInfo(key: string, today = todayKey()): { label: string; long: string; tone: DueTone } {
  const date = dateFromKey(key)
  const delta = Math.round((date.getTime() - dateFromKey(today).getTime()) / MS_DAY)
  const long = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })

  if (delta < 0) return { label: delta === -1 ? "Yesterday" : `${-delta}d late`, long, tone: "overdue" }
  if (delta === 0) return { label: "Today", long, tone: "today" }
  if (delta === 1) return { label: "Tomorrow", long, tone: "soon" }
  if (delta < 7) return { label: date.toLocaleDateString("en-US", { weekday: "short" }), long, tone: "soon" }
  return { label: long, long, tone: "later" }
}

const DUE_CHIP: Record<DueTone, string> = {
  overdue: "bg-danger/20 text-danger font-medium",
  today: "bg-accent/20 text-accent font-medium",
  soon: "bg-popover-foreground/[0.08] text-popover-foreground/60",
  later: "bg-popover-foreground/[0.08] text-popover-foreground/45",
}

const RECURRENCE_OPTIONS: { value: string; label: string; recurrence: Recurrence }[] = [
  { value: "none", label: "Does not repeat", recurrence: null },
  { value: "daily", label: "Daily", recurrence: { freq: "daily", interval: 1 } },
  { value: "weekly", label: "Weekly", recurrence: { freq: "weekly", interval: 1 } },
  { value: "biweekly", label: "Every 2 weeks", recurrence: { freq: "weekly", interval: 2 } },
  { value: "monthly", label: "Monthly", recurrence: { freq: "monthly", interval: 1 } },
  { value: "yearly", label: "Yearly", recurrence: { freq: "yearly", interval: 1 } },
]

function recurrenceValue(r: Recurrence): string {
  if (!r) return "none"
  return (
    RECURRENCE_OPTIONS.find((o) => o.recurrence?.freq === r.freq && o.recurrence.interval === r.interval)?.value ??
    "none"
  )
}

function recurrenceLabel(r: Recurrence): string {
  if (!r) return ""
  const match = RECURRENCE_OPTIONS.find((o) => o.value === recurrenceValue(r))
  return match && match.recurrence ? match.label : `Every ${r.interval} ${r.freq}`
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "none", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

const PRIORITY_DOT: Record<Priority, string> = {
  none: "",
  low: "bg-popover-foreground/35",
  medium: "bg-warning",
  high: "bg-danger",
}

function priorityDot(priority: Priority): HTMLElement | null {
  if (priority === "none") return null
  const dot = document.createElement("span")
  dot.className = `shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[priority]}`
  dot.title = `${PRIORITY_OPTIONS.find((p) => p.value === priority)!.label} priority`
  return dot
}

function chip(text: string, className: string): HTMLElement {
  const el = document.createElement("span")
  el.className = `shrink-0 inline-flex items-center text-[11px] leading-none px-1.5 py-1 rounded-full tabular-nums ${className}`
  el.textContent = text
  return el
}

/**
 * Hides a piece of a row below a container width. The wrapper carries the two
 * display utilities alone — `hidden` plus a variant — because a variant only
 * reliably beats a *base* utility on the same element; putting `hidden` next to
 * the `inline-flex` that `icon()` and `chip()` already set would leave the
 * winner up to Tailwind's utility ordering. `contents` keeps the child a direct
 * flex item of the row.
 */
const CONTAINER_TOGGLE: Record<number, string> = {
  300: "hidden @min-[300px]:contents",
  360: "hidden @min-[360px]:contents",
}

function atLeast(width: 300 | 360, el: HTMLElement): HTMLElement {
  const wrap = document.createElement("span")
  wrap.className = CONTAINER_TOGGLE[width]
  wrap.appendChild(el)
  return wrap
}

/**
 * Square icon buttons are built by hand rather than through `createButton`,
 * whose base class list sets its own padding — Tailwind resolves conflicting
 * utilities by stylesheet order, not by the order they appear in the string.
 */
function iconButton(
  name: string,
  label: string,
  onClick: (btn: HTMLButtonElement) => void,
  opts?: { size?: number; className?: string; disabled?: boolean }
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.disabled = !!opts?.disabled
  btn.className = [
    "shrink-0 inline-flex items-center justify-center rounded-theme transition-colors",
    opts?.disabled
      ? "text-popover-foreground/20 cursor-not-allowed"
      : "text-popover-foreground/45 hover:text-popover-foreground hover:bg-popover-foreground/[0.09]",
    opts?.className ?? "",
  ].join(" ")
  const box = opts?.size ?? 26
  btn.style.width = `${box}px`
  btn.style.height = `${box}px`
  btn.setAttribute("aria-label", label)
  btn.title = label
  btn.appendChild(icon(name, { size: 14 }))
  if (!opts?.disabled) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      onClick(btn)
    })
  }
  return btn
}

/** Shrinks a kit button to widget scale without fighting its utility classes. */
function compact(btn: HTMLButtonElement): HTMLButtonElement {
  btn.style.padding = "4px 10px"
  btn.style.fontSize = "12.5px"
  return btn
}

/* ── Trigger (immersive) ────────────────────────────────────────────────── */

const RING_RADIUS = 21.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function buildRing(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(NS, "svg")
  svg.setAttribute("data-todo-ring", "")
  svg.setAttribute("viewBox", "0 0 48 48")
  svg.setAttribute("role", "img")
  svg.classList.add("absolute", "inset-0", "w-full", "h-full", "pointer-events-none")

  const circle = (opacity: string): SVGCircleElement => {
    const c = document.createElementNS(NS, "circle")
    c.setAttribute("cx", "24")
    c.setAttribute("cy", "24")
    c.setAttribute("r", String(RING_RADIUS))
    c.setAttribute("fill", "none")
    c.setAttribute("stroke-width", "2")
    c.setAttribute("stroke-linecap", "round")
    c.setAttribute("transform", "rotate(-90 24 24)")
    c.style.opacity = opacity
    return c
  }

  const track = circle("0.18")
  track.style.stroke = "currentColor"
  const arc = circle("1")
  arc.setAttribute("data-todo-arc", "")
  arc.style.transition = "stroke-dasharray 300ms ease"

  svg.appendChild(track)
  svg.appendChild(arc)
  return svg
}

/**
 * The trigger says what the closed widget can: how much is open, how much is
 * late, and — as a ring around the icon — how much of today is already done.
 */
function updateTrigger(): void {
  const trigger = document.getElementById("todo-trigger")
  if (!trigger) return

  // The glyph itself is prepended by index.ts; this only adds the ring behind it.
  if (!trigger.querySelector("[data-todo-ring]")) {
    trigger.insertBefore(buildRing(), trigger.firstChild)
  }

  const showBadges = store.sync.get("todoShowBadges")
  const todos = getTodos()
  const overdueCount = getOverdue(todos).length
  const activeCount = getActive(todos).length

  const countBadge = document.getElementById("todo-badge-count") as HTMLElement | null
  const overdueBadge = document.getElementById("todo-badge-overdue") as HTMLElement | null
  if (countBadge) {
    countBadge.textContent = String(activeCount)
    countBadge.hidden = !showBadges || activeCount === 0
  }
  if (overdueBadge) {
    overdueBadge.textContent = String(overdueCount)
    overdueBadge.hidden = !showBadges || overdueCount === 0
  }

  const { done, open } = progressToday(todos)
  const total = done + open
  const ring = trigger.querySelector("[data-todo-ring]") as SVGSVGElement | null
  const arc = trigger.querySelector("[data-todo-arc]") as SVGCircleElement | null
  if (!ring || !arc) return

  if (showBadges && total > 0) {
    ring.style.display = ""
    // A round cap still paints a dot at zero length, which reads as progress.
    arc.style.display = done > 0 ? "" : "none"
    arc.style.strokeDasharray = `${((RING_CIRCUMFERENCE * done) / total).toFixed(2)} ${RING_CIRCUMFERENCE}`
    arc.style.stroke = overdueCount > 0 ? "var(--danger)" : "var(--accent)"
    const summary = `${done} of ${total} done today`
    ring.setAttribute("aria-label", summary)
    trigger.title = summary
  } else {
    ring.style.display = "none"
    trigger.removeAttribute("title")
  }
}

/* ── The add / edit form ────────────────────────────────────────────────── */

type FormResult = {
  title: string
  description: string | null
  url: string | null
  dueDate: string | null
  priority: Priority
  recurrence: Recurrence
}

function todoFormPopover(
  anchor: HTMLElement,
  heading: string,
  prefill?: Partial<FormResult>
): Promise<FormResult | null> {
  return new Promise((resolve) => {
    let resolved = false

    const form = document.createElement("div")
    form.className = "flex flex-col gap-2 w-[268px]"

    const title = document.createElement("h3")
    title.className = "text-[13px] font-semibold text-popover-foreground/80"
    title.textContent = heading
    form.appendChild(title)

    const titleInput = createInput({
      placeholder: "Title",
      value: prefill?.title ?? "",
      tone: "popover",
    }) as HTMLInputElement
    form.appendChild(titleInput)

    const descInput = createInput({
      placeholder: "Notes (optional)",
      value: prefill?.description ?? "",
      multiline: true,
      rows: 2,
      tone: "popover",
    }) as HTMLTextAreaElement
    form.appendChild(descInput)

    const urlInput = createInput({
      type: "url",
      placeholder: "Link (optional)",
      value: prefill?.url ?? "",
      tone: "popover",
    }) as HTMLInputElement
    form.appendChild(urlInput)

    const dueInput = createInput({
      type: "date",
      value: prefill?.dueDate ?? "",
      tone: "popover",
    }) as HTMLInputElement
    form.appendChild(dueInput)

    const prioritySelect = createSelect({
      options: PRIORITY_OPTIONS,
      value: prefill?.priority ?? "none",
      tone: "popover",
      width: "100%",
    })
    form.appendChild(prioritySelect)

    const repeatSelect = createSelect({
      options: RECURRENCE_OPTIONS.map(({ value, label }) => ({ value, label })),
      value: recurrenceValue(prefill?.recurrence ?? null),
      tone: "popover",
      width: "100%",
    })
    form.appendChild(repeatSelect)

    function submit(): void {
      const value = titleInput.value.trim()
      if (!value) {
        titleInput.focus()
        return
      }
      resolved = true
      popover.close()
      resolve({
        title: value,
        description: descInput.value.trim() || null,
        url: urlInput.value.trim() || null,
        dueDate: dueInput.value || null,
        priority: prioritySelect.value as Priority,
        recurrence: RECURRENCE_OPTIONS.find((o) => o.value === repeatSelect.value)?.recurrence ?? null,
      })
    }

    const row = document.createElement("div")
    row.className = "flex gap-2 justify-end pt-0.5"
    row.appendChild(
      compact(
        createButton("Cancel", "ghost", {
          tone: "popover",
          onClick: () => {
            resolved = true
            popover.close()
            resolve(null)
          },
        })
      )
    )
    row.appendChild(compact(createButton("Save", "primary", { onClick: submit })))
    form.appendChild(row)

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        submit()
      }
    })

    const popover = createPopover(anchor, form, {
      onClose: () => {
        if (!resolved) resolve(null)
      },
    })

    titleInput.focus()
  })
}

async function editFlow(anchor: HTMLElement, todo: Todo): Promise<void> {
  const result = await todoFormPopover(anchor, "Edit todo", todo)
  if (!result) return
  save(editTodo(getTodos(), todo.id, result))
}

/* ── The row menu ───────────────────────────────────────────────────────── */

function openRowMenu(anchor: HTMLElement, todo: Todo, onDeleted: () => void): void {
  const todos = getTodos()
  const archived = todo.archived || todo.completed
  const items: MenuItem[] = []

  if (!archived) {
    const pinnable = canPin(todos, todo.id)
    items.push({
      label: todo.pinned ? "Unpin" : "Pin",
      icon: icon(todo.pinned ? "pinFilled" : "pin", { size: 14 }),
      disabled: !pinnable,
      hint: `Only ${MAX_PINNED} todos can be pinned at once`,
      onClick: () => save(setPinned(getTodos(), todo.id, !todo.pinned)),
    })
  }

  items.push({
    label: "Edit",
    icon: icon("edit", { size: 14 }),
    onClick: () => void editFlow(anchor, todo),
  })

  items.push({
    label: todo.completed ? "Mark incomplete" : "Complete",
    icon: icon("checkCircle", { size: 14 }),
    onClick: () => save(toggleTodo(getTodos(), todo.id)),
  })

  items.push({
    label: archived ? "Restore" : "Archive",
    icon: icon(archived ? "archiveRestore" : "archive", { size: 14 }),
    onClick: () => save(archived ? restoreTodo(getTodos(), todo.id) : archiveTodo(getTodos(), todo.id)),
  })

  items.push("separator")
  items.push({
    label: "Delete",
    icon: icon("trash", { size: 14 }),
    danger: true,
    onClick: () => {
      save(deleteTodo(getTodos(), todo.id))
      onDeleted()
    },
  })

  createMenu(anchor, items)
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

type RowHost = {
  todos: Todo[]
  openDetail: (id: string) => void
  onDeleted: () => void
}

function renderRow(todo: Todo, opts: { draggable: boolean; archived: boolean }, host: RowHost): HTMLElement {
  const row = document.createElement("div")
  row.className =
    "group relative flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-theme text-sm cursor-pointer transition-colors hover:bg-popover-foreground/[0.06]"
  row.dataset.id = todo.id
  row.tabIndex = 0
  row.setAttribute("role", "button")
  if (opts.draggable) row.draggable = true

  const box = createCheckbox("", todo.completed, () => save(toggleTodo(getTodos(), todo.id)), {
    tone: "popover",
    className: "shrink-0",
    size: 17,
  })
  box.addEventListener("click", (e) => e.stopPropagation())
  row.appendChild(box)

  const main = document.createElement("div")
  main.className = "flex-1 min-w-0 flex flex-col"

  const titleRow = document.createElement("div")
  titleRow.className = "flex items-center gap-1.5 min-w-0"

  const dot = priorityDot(todo.priority)
  if (dot) titleRow.appendChild(dot)

  const title = document.createElement("span")
  title.className = "truncate min-w-0"
  title.textContent = todo.title
  if (todo.completed) title.classList.add("line-through", "opacity-40")
  titleRow.appendChild(title)

  if (todo.recurrence) {
    const repeat = icon("repeat", { size: 11, class: "text-popover-foreground/35" })
    repeat.title = recurrenceLabel(todo.recurrence)
    titleRow.appendChild(atLeast(300, repeat))
  }

  if (todo.url) {
    const link = icon("link", { size: 11, class: "text-popover-foreground/30" })
    link.title = todo.url
    titleRow.appendChild(atLeast(300, link))
  }

  main.appendChild(titleRow)

  if (todo.description) {
    const note = document.createElement("span")
    note.className = "hidden truncate text-[11px] leading-tight text-popover-foreground/40 @min-[440px]:block"
    note.textContent = todo.description
    main.appendChild(note)
  }

  row.appendChild(main)

  const stats = subtaskStats(host.todos, todo.id)
  if (stats.total > 0) {
    const sub = chip(`${stats.done}/${stats.total}`, "bg-popover-foreground/[0.08] text-popover-foreground/50")
    sub.title = `${stats.done} of ${stats.total} subtasks done`
    row.appendChild(atLeast(300, sub))
  }

  if (todo.dueDate && !opts.archived) {
    const info = dueInfo(todo.dueDate)
    const pill = chip(info.label, DUE_CHIP[info.tone])
    pill.title = info.long
    row.appendChild(pill)
  }

  const controls = document.createElement("div")
  controls.className = "shrink-0 flex items-center gap-0.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
  if (!todo.pinned) controls.classList.add("opacity-0")

  if (!opts.archived) {
    const pinnable = canPin(host.todos, todo.id)
    controls.appendChild(
      iconButton(
        todo.pinned ? "pinFilled" : "pin",
        todo.pinned ? "Unpin" : pinnable ? "Pin" : `Only ${MAX_PINNED} todos can be pinned at once`,
        () => save(setPinned(getTodos(), todo.id, !todo.pinned)),
        {
          disabled: !pinnable,
          className: todo.pinned ? "text-accent hover:text-accent" : "",
        }
      )
    )
  }

  controls.appendChild(iconButton("moreVertical", "More actions", (btn) => openRowMenu(btn, todo, host.onDeleted)))
  row.appendChild(controls)

  if (opts.draggable) {
    const handle = document.createElement("span")
    handle.className =
      "hidden shrink-0 w-3 justify-center opacity-0 transition-opacity cursor-grab group-hover:opacity-30 @min-[360px]:flex"
    handle.appendChild(icon("dragHandle", { size: 10 }))
    row.appendChild(handle)
  }

  row.addEventListener("click", () => host.openDetail(todo.id))
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      host.openDetail(todo.id)
    }
  })

  return row
}

function initSectionDrag(container: HTMLElement, sectionIds: string[]): void {
  let dragId: string | null = null

  const clearMarks = (): void => {
    container.querySelectorAll("[data-id]").forEach((el) => el.classList.remove("border-t-2", "border-accent"))
  }

  container.addEventListener("dragstart", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null
    if (!row) return
    dragId = row.dataset.id!
    row.classList.add("opacity-50")
    e.dataTransfer!.effectAllowed = "move"
  })

  container.addEventListener("dragend", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null
    row?.classList.remove("opacity-50")
    dragId = null
    clearMarks()
  })

  container.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    clearMarks()
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null
    if (row && row.dataset.id !== dragId) row.classList.add("border-t-2", "border-accent")
  })

  container.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault()
    if (!dragId) return
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null
    const toId = row?.dataset.id
    if (!toId || dragId === toId) return
    save(reorderTodos(getTodos(), sectionIds, dragId, toId))
  })
}

/* ── Detail view ────────────────────────────────────────────────────────── */

function detailField(label: string, value: HTMLElement | string): HTMLElement {
  const row = document.createElement("div")
  row.className = "flex items-start gap-2 text-[12px] min-w-0"
  const key = document.createElement("span")
  key.className = "shrink-0 w-[52px] text-popover-foreground/40"
  key.textContent = label
  row.appendChild(key)
  if (typeof value === "string") {
    const val = document.createElement("span")
    val.className = "min-w-0 text-popover-foreground/75 break-words"
    val.textContent = value
    row.appendChild(val)
  } else {
    row.appendChild(value)
  }
  return row
}

function renderDetail(todo: Todo, host: RowHost, onBack: () => void): HTMLElement {
  const root = document.createElement("div")
  root.className = "flex flex-col gap-3 min-w-0"

  const header = document.createElement("div")
  header.className = "flex items-center gap-1.5 min-w-0"
  header.appendChild(iconButton("chevronLeft", "Back to list", onBack))
  header.appendChild(
    createCheckbox("", todo.completed, () => save(toggleTodo(getTodos(), todo.id)), {
      tone: "popover",
      className: "shrink-0",
      size: 18,
    })
  )

  const title = document.createElement("h3")
  title.className = "flex-1 min-w-0 text-[15px] font-semibold leading-snug text-popover-foreground break-words"
  title.textContent = todo.title
  if (todo.completed) title.classList.add("line-through", "opacity-50")
  header.appendChild(title)
  header.appendChild(iconButton("moreVertical", "More actions", (btn) => openRowMenu(btn, todo, host.onDeleted)))
  root.appendChild(header)

  const fields = document.createElement("div")
  fields.className = "flex flex-col gap-1.5"

  if (todo.dueDate) {
    const info = dueInfo(todo.dueDate)
    const wrap = document.createElement("span")
    wrap.className = "flex items-center gap-1.5 min-w-0 flex-wrap"
    wrap.appendChild(chip(info.label, DUE_CHIP[info.tone]))
    const exact = document.createElement("span")
    exact.className = "text-[12px] text-popover-foreground/45"
    exact.textContent = dateFromKey(todo.dueDate).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    wrap.appendChild(exact)
    fields.appendChild(detailField("Due", wrap))
  }

  if (todo.recurrence) fields.appendChild(detailField("Repeats", recurrenceLabel(todo.recurrence)))

  if (todo.priority !== "none") {
    const wrap = document.createElement("span")
    wrap.className = "flex items-center gap-1.5"
    const dot = priorityDot(todo.priority)
    if (dot) wrap.appendChild(dot)
    const text = document.createElement("span")
    text.className = "text-[12px] text-popover-foreground/75"
    text.textContent = PRIORITY_OPTIONS.find((p) => p.value === todo.priority)!.label
    wrap.appendChild(text)
    fields.appendChild(detailField("Priority", wrap))
  }

  if (todo.url) {
    const link = document.createElement("a")
    link.href = todo.url
    link.target = "_blank"
    link.rel = "noopener"
    link.className = "min-w-0 truncate text-[12px] text-accent hover:underline"
    link.textContent = todo.url
    fields.appendChild(detailField("Link", link))
  }

  if (todo.archived || todo.completed) {
    fields.appendChild(detailField("Status", todo.completed ? "Completed" : "Archived, still open"))
  }

  if (fields.childElementCount > 0) root.appendChild(fields)

  if (todo.description) {
    const note = document.createElement("p")
    note.className =
      "rounded-theme bg-popover-foreground/[0.05] px-2.5 py-2 text-[12px] leading-relaxed text-popover-foreground/70 whitespace-pre-wrap break-words"
    note.textContent = todo.description
    root.appendChild(note)
  }

  root.appendChild(renderSubtasks(todo, host))

  const footer = document.createElement("div")
  footer.className = "flex items-center gap-2 pt-0.5"
  const editBtn: HTMLButtonElement = compact(
    createButton("Edit", "outline", {
      tone: "popover",
      icon: icon("edit", { size: 13 }),
      onClick: () => void editFlow(editBtn, todo),
    })
  )
  footer.appendChild(editBtn)
  if (todo.url) {
    footer.appendChild(
      compact(
        createButton("Open link", "ghost", {
          tone: "popover",
          icon: icon("externalLink", { size: 13 }),
          onClick: () => window.open(todo.url!, "_blank", "noopener"),
        })
      )
    )
  }
  root.appendChild(footer)

  return root
}

function renderSubtasks(parent: Todo, host: RowHost): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1"

  const subs = getSubtasks(host.todos, parent.id)
  const stats = subtaskStats(host.todos, parent.id)

  const head = document.createElement("div")
  head.className = "flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-popover-foreground/35"
  const label = document.createElement("span")
  label.textContent = "Subtasks"
  head.appendChild(label)

  if (stats.total > 0) {
    const count = document.createElement("span")
    count.className = "tabular-nums opacity-80"
    count.textContent = `${stats.done}/${stats.total}`
    head.appendChild(count)

    const track = document.createElement("div")
    track.className = "flex-1 h-1 rounded-full bg-popover-foreground/10 overflow-hidden"
    const fill = document.createElement("div")
    fill.className = "h-full rounded-full bg-accent transition-[width] duration-300"
    fill.style.width = `${(stats.done / stats.total) * 100}%`
    track.appendChild(fill)
    head.appendChild(track)
  }
  wrap.appendChild(head)

  for (const sub of subs) {
    const row = document.createElement("div")
    row.className = "group flex items-center gap-2 pl-1 pr-0.5 py-0.5 rounded-theme text-[13px] hover:bg-popover-foreground/[0.05]"
    row.appendChild(
      createCheckbox("", sub.completed, () => save(toggleTodo(getTodos(), sub.id)), {
        tone: "popover",
        className: "shrink-0",
        size: 15,
      })
    )

    const text = document.createElement("span")
    text.className = "flex-1 min-w-0 truncate"
    text.textContent = sub.title
    if (sub.completed) text.classList.add("line-through", "opacity-40")
    row.appendChild(text)

    row.appendChild(
      iconButton("trash", "Delete subtask", () => save(deleteTodo(getTodos(), sub.id)), {
        size: 22,
        className: "opacity-0 group-hover:opacity-100 hover:text-danger",
      })
    )
    wrap.appendChild(row)
  }

  const input = createInput({ placeholder: "Add a subtask…", tone: "popover" }) as HTMLInputElement
  input.dataset.subtaskInput = ""
  input.style.fontSize = "13px"
  input.style.padding = "5px 10px"
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    const title = input.value.trim()
    if (!title) return
    input.value = ""
    save(addTodo(getTodos(), { title, parentId: parent.id }))
  })
  wrap.appendChild(input)

  return wrap
}

/* ── The body ───────────────────────────────────────────────────────────── */

type View = "active" | "archive"

type LiveBody = { root: HTMLElement; render: () => void }
const liveBodies = new Set<LiveBody>()

function emptyState(glyph: string, title: string, hint: string, action?: HTMLElement): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center"

  const art = document.createElement("div")
  art.className = "text-popover-foreground/15"
  art.appendChild(icon(glyph, { size: 30 }))
  wrap.appendChild(art)

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/60"
  heading.textContent = title
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[250px] text-[11px] leading-relaxed text-popover-foreground/35"
  sub.textContent = hint
  wrap.appendChild(sub)

  if (action) wrap.appendChild(action)
  return wrap
}

function scrollArea(): HTMLElement {
  const el = document.createElement("div")
  el.className = "flex flex-col max-h-[420px] min-w-0 overflow-y-auto overflow-x-hidden"
  return el
}

function groupHeader(group: TodoGroup): HTMLElement {
  const head = document.createElement("div")
  head.className = `flex items-center gap-1.5 px-1.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.09em] ${
    group.key === "overdue" ? "text-danger/75" : "text-popover-foreground/35"
  }`
  if (group.key === "pinned") head.appendChild(icon("pinFilled", { size: 9 }))

  const label = document.createElement("span")
  label.textContent = group.label
  head.appendChild(label)

  const count = document.createElement("span")
  count.className = "tabular-nums opacity-60"
  count.textContent = String(group.todos.length)
  head.appendChild(count)
  return head
}

/**
 * The whole widget body — toolbar, the active list or the archive, or one
 * todo's detail view. Shared by the immersive popover and the card in the
 * other layouts, so what it shows at a given size is decided by container
 * queries on `root`, never by the viewport: the same markup fills a 340px
 * popover and a card column three times as wide. See docs/layouts.md.
 */
export function buildTodoList(): { el: HTMLElement; rebuild: () => void } {
  const root = document.createElement("div")
  root.className = "@container flex flex-col min-w-0"

  let view: View = "active"
  let detailId: string | null = null

  function openDetail(id: string): void {
    detailId = id
    render()
  }

  function backToList(): void {
    detailId = null
    render()
  }

  function setView(next: View): void {
    view = next
    detailId = null
    render()
  }

  function render(): void {
    const active = document.activeElement as HTMLElement | null
    const keepSubtaskFocus = !!active && root.contains(active) && active.dataset.subtaskInput !== undefined

    const todos = getTodos()
    const host: RowHost = { todos, openDetail, onDeleted: backToList }

    if (detailId) {
      const todo = todos.find((t) => t.id === detailId)
      if (todo) {
        root.replaceChildren(renderDetail(todo, host, backToList))
        if (keepSubtaskFocus) root.querySelector<HTMLElement>("[data-subtask-input]")?.focus()
        return
      }
      detailId = null
    }

    root.replaceChildren(renderToolbar(todos))
    root.appendChild(view === "active" ? renderActive(todos, host) : renderArchive(todos, host))
  }

  function renderToolbar(todos: Todo[]): HTMLElement {
    const bar = document.createElement("div")
    bar.className = "flex items-center gap-2 min-w-0 pb-1.5"

    const left = document.createElement("div")
    left.className = "flex flex-1 items-center gap-1.5 min-w-0"
    const right = document.createElement("div")
    right.className = "flex shrink-0 items-center gap-1"

    if (view === "archive") {
      left.appendChild(iconButton("chevronLeft", "Back to active todos", () => setView("active")))
      const archived = getArchived(todos)
      const label = document.createElement("span")
      label.className = "truncate text-[12px] font-medium text-popover-foreground/60"
      label.textContent = `Archive · ${archived.length}`
      left.appendChild(label)
      if (archived.length > 0) right.appendChild(clearArchiveButton())
    } else {
      const { done, open } = progressToday(todos)
      const activeCount = getActive(todos).length
      const caption = document.createElement("span")
      caption.className = "truncate text-[12px] text-popover-foreground/45"
      caption.textContent =
        done + open > 0
          ? `${done} of ${done + open} done today`
          : activeCount > 0
            ? `${activeCount} ${activeCount === 1 ? "todo" : "todos"}`
            : ""
      left.appendChild(caption)

      right.appendChild(iconButton("archive", "Archive", () => setView("archive")))
      right.appendChild(addButton(todos))
    }

    bar.appendChild(left)
    bar.appendChild(right)
    return bar
  }

  function addButton(todos: Todo[]): HTMLButtonElement {
    const atCap = todos.length >= MAX_TODOS
    const btn = document.createElement("button")
    btn.type = "button"
    btn.disabled = atCap
    btn.className = `shrink-0 inline-flex items-center justify-center rounded-full transition-colors ${
      atCap
        ? "bg-popover-foreground/10 text-popover-foreground/30 cursor-not-allowed"
        : "bg-accent text-accent-foreground hover:bg-accent-hover"
    }`
    btn.style.width = "26px"
    btn.style.height = "26px"
    const label = atCap ? `Limit of ${MAX_TODOS} todos reached` : "New todo"
    btn.setAttribute("aria-label", label)
    btn.title = label
    btn.appendChild(icon("plus", { size: 14 }))
    if (!atCap) {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation()
        const result = await todoFormPopover(btn, "New todo")
        if (result) save(addTodo(getTodos(), result))
      })
    }
    return btn
  }

  function clearArchiveButton(): HTMLButtonElement {
    // Two taps rather than `confirm()`: a native dialog swallows the click the
    // popover's outside-click handler is listening for, closing the widget.
    let armed = false
    const btn = iconButton("trash", "Clear archive", () => {
      if (!armed) {
        armed = true
        btn.classList.add("text-danger")
        btn.title = "Clear the archive? Click again to confirm."
        setTimeout(() => {
          armed = false
          btn.classList.remove("text-danger")
          btn.title = "Clear archive"
        }, 3000)
        return
      }
      save(clearArchive(getTodos()))
    })
    return btn
  }

  function renderActive(todos: Todo[], host: RowHost): HTMLElement {
    const groups = groupActive(todos)
    if (groups.length === 0) {
      const hasArchive = getArchived(todos).length > 0
      return emptyState(
        "todoEmpty",
        hasArchive ? "All clear" : "No todos yet",
        hasArchive
          ? "Everything on your list is done or archived."
          : "Add one with +. Give it a due date, a priority or a repeat, break it into subtasks, and click any todo to open its details.",
        hasArchive
          ? compact(
              createButton("Open archive", "ghost", {
                tone: "popover",
                icon: icon("archive", { size: 13 }),
                onClick: () => setView("archive"),
              })
            )
          : undefined
      )
    }

    const scroll = scrollArea()
    for (const group of groups) {
      scroll.appendChild(groupHeader(group))
      const list = document.createElement("div")
      list.className = "flex flex-col"
      for (const todo of group.todos) {
        list.appendChild(renderRow(todo, { draggable: group.draggable, archived: false }, host))
      }
      if (group.draggable && group.todos.length > 1) {
        initSectionDrag(list, group.todos.map((t) => t.id))
      }
      scroll.appendChild(list)
    }
    return scroll
  }

  function renderArchive(todos: Todo[], host: RowHost): HTMLElement {
    const archived = getArchived(todos)
    if (archived.length === 0) {
      return emptyState(
        "archive",
        "Nothing archived",
        "Completed todos land here, and so does anything you archive by hand — finished or not. Nothing is ever removed on its own."
      )
    }

    const scroll = scrollArea()
    const list = document.createElement("div")
    list.className = "flex flex-col"
    for (const todo of archived) {
      list.appendChild(renderRow(todo, { draggable: false, archived: true }, host))
    }
    scroll.appendChild(list)
    return scroll
  }

  render()

  for (const entry of [...liveBodies]) {
    if (!entry.root.isConnected) liveBodies.delete(entry)
  }
  liveBodies.add({ root, render })

  return { el: root, rebuild: render }
}

/* ── Cross-widget entry point ───────────────────────────────────────────── */

/**
 * A compact card for a single todo, anchored anywhere. The calendar uses it for
 * the todo chips it draws on a day, so something due can be read and checked
 * off without leaving the calendar.
 */
/**
 * The palette's write path. Search can add, complete and archive todos, and it
 * has to go through the same `save` the widget does or the two views drift.
 */
export function applyTodos(next: Todo[]): void {
  save(next)
}

/** Todos as the widget sees them — normalized, not the raw store array. */
export function currentTodos(): Todo[] {
  return getTodos()
}

export function showTodoPopover(anchor: HTMLElement, id: string): void {
  const todo = getTodos().find((t) => t.id === id)
  if (!todo) return

  const content = document.createElement("div")
  content.className = "flex flex-col gap-2 w-[236px]"

  let close: (() => void) | null = null

  const head = document.createElement("div")
  head.className = "flex items-start gap-2 min-w-0"
  head.appendChild(
    createCheckbox(
      "",
      todo.completed,
      () => {
        save(toggleTodo(getTodos(), todo.id))
        close?.()
      },
      { tone: "popover", className: "shrink-0", size: 16 }
    )
  )
  const title = document.createElement("span")
  title.className = "flex-1 min-w-0 text-[13px] font-medium text-popover-foreground break-words"
  title.textContent = todo.title
  head.appendChild(title)
  const dot = priorityDot(todo.priority)
  if (dot) head.appendChild(dot)
  content.appendChild(head)

  if (todo.description) {
    const note = document.createElement("p")
    note.className = "text-[11px] leading-relaxed text-popover-foreground/55 whitespace-pre-wrap break-words"
    note.textContent = todo.description
    content.appendChild(note)
  }

  const meta = document.createElement("div")
  meta.className = "flex flex-wrap items-center gap-1.5"
  if (todo.dueDate) {
    const info = dueInfo(todo.dueDate)
    meta.appendChild(chip(info.label, DUE_CHIP[info.tone]))
  }
  if (todo.recurrence) meta.appendChild(chip(recurrenceLabel(todo.recurrence), DUE_CHIP.later))
  const stats = subtaskStats(getTodos(), todo.id)
  if (stats.total > 0) meta.appendChild(chip(`${stats.done}/${stats.total}`, DUE_CHIP.later))
  if (meta.childElementCount > 0) content.appendChild(meta)

  if (todo.url) {
    content.appendChild(
      compact(
        createButton("Open link", "ghost", {
          tone: "popover",
          icon: icon("externalLink", { size: 13 }),
          className: "self-start",
          onClick: () => window.open(todo.url!, "_blank", "noopener"),
        })
      )
    )
  }

  close = createPopover(anchor, content).close
}

/* ── Hosts ──────────────────────────────────────────────────────────────── */

function closePopover(): void {
  openPopoverClose?.()
}

function showPopover(anchor: HTMLElement): void {
  closePopover()

  const content = document.createElement("div")
  content.className = "flex flex-col w-[340px]"

  const header = document.createElement("div")
  header.className = "flex items-center justify-between border-b border-popover-foreground/[0.08] pb-2 mb-1"
  const heading = document.createElement("h2")
  heading.className = "text-sm font-semibold uppercase tracking-wider text-popover-foreground/70"
  heading.textContent = "Todos"
  header.appendChild(heading)
  content.appendChild(header)
  content.appendChild(buildTodoList().el)

  const { close } = createPopover(anchor, content, {
    onClose: () => {
      openPopoverClose = null
    },
  })
  openPopoverClose = close
}

registerCard({
  id: "todo",
  title: "Todos",
  order: 40,
  regions: { default: "grid", dashboard: "side" },
  enabledKey: "todoEnabled",
  render: () => buildTodoList().el,
})

// Module scope, not `initTodo`: a card body can be built during `applyLayout()`,
// which runs before DOMContentLoaded. See docs/layouts.md#boot-ordering.
store.local.subscribe("todos", () => {
  updateTrigger()
  for (const entry of [...liveBodies]) {
    if (entry.root.isConnected) entry.render()
    else liveBodies.delete(entry)
  }
})

export function initTodo(): void {
  const trigger = document.getElementById("todo-trigger") as HTMLButtonElement
  trigger.hidden = !store.sync.get("todoEnabled")

  // One rewrite at boot, and only when something is actually missing — this
  // runs on every new tab, and every write costs a browser.storage round trip.
  const raw = store.local.get("todos") as unknown
  const stale =
    !Array.isArray(raw) ||
    raw.some(
      (t) =>
        !t ||
        typeof t !== "object" ||
        (t as Record<string, unknown>).archived === undefined ||
        (t as Record<string, unknown>).priority === undefined ||
        (t as Record<string, unknown>).parentId === undefined ||
        (t as Record<string, unknown>).pinned === undefined ||
        (t as Record<string, unknown>).recurrence === undefined
    )
  if (stale) save(normalizeTodos(raw))

  updateTrigger()

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (openPopoverClose) closePopover()
    else showPopover(trigger)
  })

  store.sync.subscribe("todoEnabled", (val) => {
    trigger.hidden = !val
    if (!val) closePopover()
  })
  store.sync.subscribe("todoShowBadges", () => updateTrigger())
}
