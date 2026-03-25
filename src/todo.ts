import { store } from "./store"
import type { Todo } from "./todos"
import {
  addTodo, editTodo, deleteTodo, toggleTodo,
  reorderTodos, getOverdue, getActive, getCompleted, purgeStale,
} from "./todos"
import {
  createButton, createPopover, createAccordion,
  createCheckbox, createInput,
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
  const overdueBadge = document.getElementById("todo-badge-overdue") as HTMLElement

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
  prefill?: { title?: string; description?: string | null; url?: string | null; dueDate?: string | null }
): Promise<{ title: string; description: string | null; url: string | null; dueDate: string | null } | null> {
  return new Promise((resolve) => {
    let resolved = false

    const form = document.createElement("div")
    form.className = "flex flex-col gap-2 min-w-[260px]"

    const heading = document.createElement("h3")
    heading.className = "text-sm font-semibold text-popover-foreground"
    heading.textContent = title
    form.appendChild(heading)

    const titleInput = createInput({ placeholder: "Title", value: prefill?.title ?? "" })
    form.appendChild(titleInput)

    const descInput = createInput({ placeholder: "Description (optional)", value: prefill?.description ?? "", multiline: true, rows: 2 })
    form.appendChild(descInput)

    const urlInput = createInput({ type: "url", placeholder: "URL (optional)", value: prefill?.url ?? "" })
    form.appendChild(urlInput)

    const dueInput = createInput({ type: "date", value: prefill?.dueDate ?? "" })
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
      onClose: () => { if (!resolved) resolve(null) },
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
  row.className = "flex items-center gap-2 px-2 py-1 rounded text-sm bg-popover-foreground/10 group"
  row.dataset.id = todo.id

  if (section !== "completed") {
    row.draggable = true
  }

  const titleSpan = document.createElement("span")
  titleSpan.className = "flex-1 truncate"
  titleSpan.textContent = todo.title

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

  if (section === "completed") {
    titleSpan.classList.add("opacity-40")
  }
  if (todo.completed && section !== "completed") {
    titleSpan.classList.add("line-through", "opacity-40")
  }

  if (todo.description) {
    titleSpan.title = todo.description
  }
  row.appendChild(titleSpan)

  if (todo.url) {
    const urlBtn = createButton("", "ghost", {
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
      onClick: () => window.open(todo.url!, "_blank"),
    })
    urlBtn.className = "text-muted hover:text-popover-foreground shrink-0 p-0.5"
    row.appendChild(urlBtn)
  }

  const editBtn = createButton("", "ghost", {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
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
  editBtn.className = "text-muted hover:text-popover-foreground shrink-0 p-0.5"
  row.appendChild(editBtn)

  const delBtn = createButton("", "ghost", {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    onClick: () => {
      save(deleteTodo(getTodos(), todo.id))
      onUpdate()
    },
  })
  delBtn.className = "text-danger/70 hover:text-danger shrink-0 p-0.5"
  row.appendChild(delBtn)

  if (section !== "completed") {
    const handle = document.createElement("span")
    handle.className = "cursor-grab text-popover-foreground/30 shrink-0"
    handle.textContent = "\u2630"
    row.appendChild(handle)
  }

  return row
}

function initSectionDrag(container: HTMLElement, sectionIds: string[], onUpdate: () => void): void {
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
    container.querySelectorAll("[data-id]").forEach((el) =>
      el.classList.remove("border-t-2", "border-accent")
    )
  })

  container.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    container.querySelectorAll("[data-id]").forEach((el) =>
      el.classList.remove("border-t-2", "border-accent")
    )
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
  content.className = "flex flex-col gap-2 min-w-[300px] max-w-[400px] max-h-[500px] overflow-y-auto"

  const addBtn = createButton("Add todo", "primary", {
    onClick: async () => {
      const result = await todoFormPopover(addBtn, openPopover!, "Add Todo")
      if (!result) return
      save(addTodo(getTodos(), result))
      rebuildContent()
    },
  })
  content.appendChild(addBtn)

  function rebuildContent() {
    while (content.children.length > 1) {
      content.removeChild(content.lastChild!)
    }
    const todos = getTodos()
    const overdue = getOverdue(todos)
    const active = getActive(todos)
    const completed = getCompleted(todos)

    if (overdue.length > 0) {
      const acc = createAccordion(`Overdue (${overdue.length})`, { labelClass: "text-danger" })
      for (const t of overdue) {
        acc.content.appendChild(renderTodoItem(t, "overdue", rebuildContent))
      }
      initSectionDrag(acc.content, overdue.map((t) => t.id), rebuildContent)
      content.appendChild(acc.container)
    }

    const todoAcc = createAccordion(`Todo (${active.length})`)
    for (const t of active) {
      todoAcc.content.appendChild(renderTodoItem(t, "active", rebuildContent))
    }
    initSectionDrag(todoAcc.content, active.map((t) => t.id), rebuildContent)
    content.appendChild(todoAcc.container)

    const compAcc = createAccordion(`Completed (${completed.length})`)
    for (const t of completed) {
      compAcc.content.appendChild(renderTodoItem(t, "completed", rebuildContent))
    }
    content.appendChild(compAcc.container)
  }

  rebuildContent()

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
