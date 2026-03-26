import { store } from "./store"
import { icon } from "./icons/registry"
import type { Todo } from "./todos"
import {
  addTodo,
  editTodo,
  deleteTodo,
  toggleTodo,
  reorderTodos,
  getOverdue,
  getActive,
  getCompleted,
  purgeStale,
} from "./todos"
import {
  createButton,
  createPopover,
  createAccordion,
  createCheckbox,
  createInput,
} from "./components"

let openPopover: HTMLElement | null = null

function getTodos(): Todo[] {
  return store.local.get("todos")
}

function save(todos: Todo[]): void {
  store.local.set("todos", todos)
}

function updateBadges(): void {
  const showBadges = store.sync.get("todoShowBadges")
  const todos = getTodos()
  const overdueCount = getOverdue(todos).length
  const incompleteCount = overdueCount + getActive(todos).length

  const countBadge = document.getElementById("todo-badge-count") as HTMLElement
  const overdueBadge = document.getElementById(
    "todo-badge-overdue"
  ) as HTMLElement

  if (showBadges && incompleteCount > 0) {
    countBadge.textContent = String(incompleteCount)
    countBadge.hidden = false
  } else {
    countBadge.hidden = true
  }

  if (showBadges && overdueCount > 0) {
    overdueBadge.textContent = String(overdueCount)
    overdueBadge.hidden = false
  } else {
    overdueBadge.hidden = true
  }
}

function todoFormPopover(
  anchor: HTMLElement,
  parentPopover: HTMLElement,
  title: string,
  prefill?: {
    title?: string
    description?: string | null
    url?: string | null
    dueDate?: string | null
  }
): Promise<{
  title: string
  description: string | null
  url: string | null
  dueDate: string | null
} | null> {
  return new Promise((resolve) => {
    let resolved = false

    const form = document.createElement("div")
    form.className = "flex flex-col gap-2 min-w-[260px]"

    const heading = document.createElement("h3")
    heading.className = "text-[13px] font-semibold text-popover-foreground/80"
    heading.textContent = title
    form.appendChild(heading)

    const inputCls =
      "w-full text-sm rounded-theme px-2.5 py-2 border border-white/[0.08] bg-white/[0.06] text-popover-foreground placeholder:text-popover-foreground/30 outline-none focus:border-accent/60 transition-colors"

    const titleInput = createInput({
      placeholder: "Title",
      value: prefill?.title ?? "",
    })
    titleInput.className = inputCls
    form.appendChild(titleInput)

    const descInput = createInput({
      placeholder: "Description (optional)",
      value: prefill?.description ?? "",
      multiline: true,
      rows: 2,
    })
    descInput.className = `${inputCls} resize-y`
    form.appendChild(descInput)

    const urlInput = createInput({
      type: "url",
      placeholder: "URL (optional)",
      value: prefill?.url ?? "",
    })
    urlInput.className = inputCls
    form.appendChild(urlInput)

    const dueInput = createInput({
      type: "date",
      value: prefill?.dueDate ?? "",
    })
    dueInput.className = inputCls
    form.appendChild(dueInput)

    const btnRow = document.createElement("div")
    btnRow.className = "flex gap-2 justify-end"

    const cancelBtn = createButton("Cancel", "ghost", {
      onClick: () => {
        resolved = true
        popover.close()
        resolve(null)
      },
    })
    cancelBtn.className =
      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium text-popover-foreground/50 hover:text-popover-foreground hover:bg-white/[0.06] transition-colors"
    const saveBtn = createButton("Save", "primary", {
      onClick: () => {
        const t = (titleInput as HTMLInputElement).value.trim()
        if (!t) return
        resolved = true
        popover.close()
        resolve({
          title: t,
          description: (descInput as HTMLTextAreaElement).value.trim() || null,
          url: (urlInput as HTMLInputElement).value.trim() || null,
          dueDate: (dueInput as HTMLInputElement).value || null,
        })
      },
    })

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(saveBtn)
    form.appendChild(btnRow)

    const popover = createPopover(anchor, form, {
      parentPopover,
      onClose: () => {
        if (!resolved) resolve(null)
      },
    })

    ;(titleInput as HTMLInputElement).focus()
  })
}

function closePopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
  updateBadges()
}

function renderTodoItem(
  todo: Todo,
  section: "overdue" | "active" | "completed",
  onUpdate: () => void
): HTMLElement {
  const row = document.createElement("div")
  row.className =
    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm group transition-colors hover:bg-white/[0.06]"
  row.dataset.id = todo.id

  if (section !== "completed") {
    row.draggable = true
  }

  const titleSpan = document.createElement("span")
  titleSpan.className = "flex-1 truncate"
  titleSpan.textContent = todo.title
  if (todo.description) titleSpan.title = todo.description
  if (section === "completed" || todo.completed) {
    titleSpan.classList.add("line-through", "opacity-40")
  }

  const checkboxLabel = createCheckbox("", todo.completed, (checked) => {
    const todos = toggleTodo(getTodos(), todo.id)
    save(todos)
    if (checked) {
      titleSpan.classList.add("line-through", "opacity-40")
    } else {
      titleSpan.classList.remove("line-through", "opacity-40")
    }
  })
  checkboxLabel.className = "shrink-0"
  row.appendChild(checkboxLabel)
  row.appendChild(titleSpan)

  const actions = document.createElement("div")
  actions.className =
    "flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"

  if (todo.url) {
    const urlBtn = createButton("", "ghost", {
      icon: icon("externalLink"),
      onClick: () => window.open(todo.url!, "_blank"),
    })
    urlBtn.className =
      "p-1 rounded text-popover-foreground/40 hover:text-popover-foreground transition-colors"
    actions.appendChild(urlBtn)
  }

  const editBtn = createButton("", "ghost", {
    icon: icon("edit"),
    onClick: async () => {
      const result = await todoFormPopover(editBtn, openPopover!, "Edit Todo", {
        title: todo.title,
        description: todo.description,
        url: todo.url,
        dueDate: todo.dueDate,
      })
      if (!result) return
      save(editTodo(getTodos(), todo.id, result))
      onUpdate()
    },
  })
  editBtn.className =
    "p-1 rounded text-popover-foreground/40 hover:text-popover-foreground transition-colors"
  actions.appendChild(editBtn)

  const delBtn = createButton("", "ghost", {
    icon: icon("trash"),
    onClick: () => {
      save(deleteTodo(getTodos(), todo.id))
      onUpdate()
    },
  })
  delBtn.className =
    "p-1 rounded text-danger/50 hover:text-danger transition-colors"
  actions.appendChild(delBtn)

  row.appendChild(actions)

  if (todo.dueDate && section !== "completed") {
    const badge = document.createElement("span")
    const date = new Date(todo.dueDate + "T00:00:00")
    badge.textContent = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
    badge.className =
      section === "overdue"
        ? "text-[11px] px-1.5 py-0.5 rounded-full bg-danger/20 text-danger shrink-0 font-medium"
        : "text-[11px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-popover-foreground/50 shrink-0"
    row.appendChild(badge)
  }

  if (section !== "completed") {
    const handle = document.createElement("span")
    handle.className =
      "opacity-0 group-hover:opacity-30 transition-opacity cursor-grab shrink-0"
    handle.appendChild(icon("dragHandle"))
    row.appendChild(handle)
  }

  return row
}

function initSectionDrag(
  container: HTMLElement,
  sectionIds: string[],
  onUpdate: () => void
): void {
  let dragId: string | null = null

  container.addEventListener("dragstart", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement
    if (!row) return
    dragId = row.dataset.id!
    row.classList.add("opacity-50")
    e.dataTransfer!.effectAllowed = "move"
  })

  container.addEventListener("dragend", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement
    if (row) row.classList.remove("opacity-50")
    dragId = null
    container
      .querySelectorAll("[data-id]")
      .forEach((el) => el.classList.remove("border-t-2", "border-accent"))
  })

  container.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    container
      .querySelectorAll("[data-id]")
      .forEach((el) => el.classList.remove("border-t-2", "border-accent"))
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement
    if (row && row.dataset.id !== dragId) {
      row.classList.add("border-t-2", "border-accent")
    }
  })

  container.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault()
    if (!dragId) return
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement
    if (!row) return
    const toId = row.dataset.id!
    if (dragId === toId) return
    const todos = reorderTodos(getTodos(), sectionIds, dragId, toId)
    save(todos)
    onUpdate()
  })
}

function showPopover(anchor: HTMLElement): void {
  closePopover()
  let todos = purgeStale(getTodos())
  save(todos)

  const content = document.createElement("div")
  content.className = "flex flex-col w-[340px]"

  const header = document.createElement("div")
  header.className =
    "flex items-center justify-between pb-2 mb-1 border-b border-white/[0.06]"

  const heading = document.createElement("h2")
  heading.className =
    "text-base font-semibold text-popover-foreground/70 tracking-wider uppercase"
  heading.textContent = "Todos"
  header.appendChild(heading)

  const addBtn = createButton("", "ghost", {
    icon: icon("plus"),
    onClick: async () => {
      const result = await todoFormPopover(addBtn, openPopover!, "New Todo")
      if (!result) return
      save(addTodo(getTodos(), result))
      rebuildSections()
    },
  })
  addBtn.className =
    "w-7 h-7 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover transition-colors"
  header.appendChild(addBtn)
  content.appendChild(header)

  const scrollArea = document.createElement("div")
  scrollArea.className =
    "flex flex-col gap-1 max-h-[420px] overflow-y-auto pt-1"
  content.appendChild(scrollArea)

  function rebuildSections() {
    scrollArea.innerHTML = ""
    const todos = getTodos()
    const overdue = getOverdue(todos)
    const active = getActive(todos)
    const completed = getCompleted(todos)

    if (todos.length === 0) {
      const empty = document.createElement("div")
      empty.className = "flex flex-col items-center justify-center py-8 gap-2"
      const emptyIcon = document.createElement("div")
      emptyIcon.className = "text-popover-foreground/15"
      emptyIcon.appendChild(icon("todoEmpty"))
      const emptyText = document.createElement("p")
      emptyText.className = "text-xs text-popover-foreground/30"
      emptyText.textContent = "No todos yet"
      empty.appendChild(emptyIcon)
      empty.appendChild(emptyText)
      scrollArea.appendChild(empty)
      return
    }

    if (overdue.length > 0) {
      const acc = createAccordion(`Overdue (${overdue.length})`, {
        labelClass: "text-danger/80",
      })
      for (const t of overdue) {
        acc.content.appendChild(renderTodoItem(t, "overdue", rebuildSections))
      }
      initSectionDrag(
        acc.content,
        overdue.map((t) => t.id),
        rebuildSections
      )
      scrollArea.appendChild(acc.container)
    }

    const todoAcc = createAccordion(`Todo (${active.length})`, {
      labelClass: "text-popover-foreground/60",
    })
    for (const t of active) {
      todoAcc.content.appendChild(renderTodoItem(t, "active", rebuildSections))
    }
    initSectionDrag(
      todoAcc.content,
      active.map((t) => t.id),
      rebuildSections
    )
    scrollArea.appendChild(todoAcc.container)

    if (completed.length > 0) {
      const compAcc = createAccordion(`Completed (${completed.length})`, {
        labelClass: "text-popover-foreground/40",
        defaultOpen: false,
      })
      for (const t of completed) {
        compAcc.content.appendChild(
          renderTodoItem(t, "completed", rebuildSections)
        )
      }
      scrollArea.appendChild(compAcc.container)
    }
  }

  rebuildSections()

  const { el: popoverEl } = createPopover(anchor, content, {
    onClose: () => {
      openPopover = null
      updateBadges()
    },
  })
  openPopover = popoverEl
}

export function initTodo(): void {
  const trigger = document.getElementById("todo-trigger") as HTMLButtonElement
  const enabled = store.sync.get("todoEnabled")
  trigger.hidden = !enabled

  const todos = purgeStale(getTodos())
  if (todos.length !== getTodos().length) save(todos)

  updateBadges()

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (openPopover) {
      closePopover()
    } else {
      showPopover(trigger)
    }
  })

  store.sync.subscribe("todoEnabled", (val) => {
    trigger.hidden = !val
    if (!val) closePopover()
  })
  store.sync.subscribe("todoShowBadges", () => updateBadges())
  store.local.subscribe("todos", () => updateBadges())
}
