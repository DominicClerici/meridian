import { store } from "./store"
import type { Todo } from "./todos"
import {
  addTodo, editTodo, deleteTodo, toggleTodo,
  reorderTodos, getOverdue, getActive, getCompleted, purgeStale,
} from "./todos"

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

function todoPrompt(
  title: string,
  prefill?: { title?: string; description?: string | null; url?: string | null; dueDate?: string | null }
): Promise<{ title: string; description: string | null; url: string | null; dueDate: string | null } | null> {
  return new Promise((resolve) => {
    const dialog = document.getElementById("todo-prompt-dialog") as HTMLDialogElement
    const titleEl = document.getElementById("todo-prompt-title") as HTMLHeadingElement
    const titleInput = document.getElementById("todo-prompt-title-input") as HTMLInputElement
    const descInput = document.getElementById("todo-prompt-desc") as HTMLTextAreaElement
    const urlInput = document.getElementById("todo-prompt-url") as HTMLInputElement
    const dueInput = document.getElementById("todo-prompt-due") as HTMLInputElement
    const cancelBtn = document.getElementById("todo-prompt-cancel") as HTMLButtonElement
    const form = dialog.querySelector("form") as HTMLFormElement

    titleEl.textContent = title
    titleInput.value = prefill?.title ?? ""
    descInput.value = prefill?.description ?? ""
    urlInput.value = prefill?.url ?? ""
    dueInput.value = prefill?.dueDate ?? ""

    let resolved = false

    function cleanup() {
      form.removeEventListener("submit", onSubmit)
      cancelBtn.removeEventListener("click", onCancel)
      dialog.removeEventListener("close", onClose)
    }

    function onSubmit(e: Event) {
      e.preventDefault()
      resolved = true
      cleanup()
      dialog.close()
      resolve({
        title: titleInput.value.trim(),
        description: descInput.value.trim() || null,
        url: urlInput.value.trim() || null,
        dueDate: dueInput.value || null,
      })
    }

    function onCancel() {
      resolved = true
      cleanup()
      dialog.close()
      resolve(null)
    }

    function onClose() {
      if (!resolved) {
        cleanup()
        resolve(null)
      }
    }

    form.addEventListener("submit", onSubmit)
    cancelBtn.addEventListener("click", onCancel)
    dialog.addEventListener("close", onClose)
    dialog.showModal()
    titleInput.focus()
  })
}

function closePopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
  updateBadges()
}

function createAccordion(label: string, isRed: boolean): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement("div")
  const trigger = document.createElement("button")
  trigger.className = `w-full text-left text-sm font-semibold px-2 py-1 flex items-center gap-1 ${isRed ? "text-red-500" : "text-white"}`
  const chevron = document.createElement("span")
  chevron.textContent = "\u25BC"
  chevron.className = "text-xs transition-transform"
  trigger.appendChild(chevron)
  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = "flex flex-col gap-1 px-1"
  let expanded = true

  trigger.addEventListener("click", () => {
    expanded = !expanded
    content.hidden = !expanded
    chevron.style.transform = expanded ? "" : "rotate(-90deg)"
  })

  wrapper.appendChild(trigger)
  wrapper.appendChild(content)
  return { wrapper, content }
}

function renderTodoItem(
  todo: Todo,
  section: "overdue" | "active" | "completed",
  onUpdate: () => void
): HTMLElement {
  const row = document.createElement("div")
  row.className = "flex items-center gap-2 px-2 py-1 rounded text-sm bg-white/10 group"
  row.dataset.id = todo.id

  if (section !== "completed") {
    row.draggable = true
  }

  const checkbox = document.createElement("input")
  checkbox.type = "checkbox"
  checkbox.checked = todo.completed
  checkbox.className = "rounded shrink-0"
  checkbox.addEventListener("change", () => {
    const todos = toggleTodo(getTodos(), todo.id)
    save(todos)
    const isNowCompleted = todos.find((t) => t.id === todo.id)?.completed
    if (isNowCompleted) {
      titleSpan.classList.add("line-through", "text-white/40")
    } else {
      titleSpan.classList.remove("line-through", "text-white/40")
    }
  })
  row.appendChild(checkbox)

  const titleSpan = document.createElement("span")
  titleSpan.className = "flex-1 truncate"
  titleSpan.textContent = todo.title

  if (section === "completed") {
    titleSpan.classList.add("text-white/40")
  }
  if (todo.completed && section !== "completed") {
    titleSpan.classList.add("line-through", "text-white/40")
  }

  if (todo.description) {
    titleSpan.title = todo.description
  }
  row.appendChild(titleSpan)

  if (todo.url) {
    const urlBtn = document.createElement("button")
    urlBtn.className = "text-white/50 hover:text-white shrink-0"
    urlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
    urlBtn.addEventListener("click", () => window.open(todo.url!, "_blank"))
    row.appendChild(urlBtn)
  }

  const editBtn = document.createElement("button")
  editBtn.className = "text-white/50 hover:text-white shrink-0"
  editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`
  editBtn.addEventListener("click", async () => {
    const result = await todoPrompt("Edit Todo", {
      title: todo.title,
      description: todo.description,
      url: todo.url,
      dueDate: todo.dueDate,
    })
    if (!result) return
    const todos = editTodo(getTodos(), todo.id, result)
    save(todos)
    onUpdate()
  })
  row.appendChild(editBtn)

  const delBtn = document.createElement("button")
  delBtn.className = "text-red-400 hover:text-red-300 shrink-0"
  delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`
  delBtn.addEventListener("click", () => {
    const todos = deleteTodo(getTodos(), todo.id)
    save(todos)
    onUpdate()
  })
  row.appendChild(delBtn)

  if (section !== "completed") {
    const handle = document.createElement("span")
    handle.className = "cursor-grab text-white/30 shrink-0"
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
      el.classList.remove("border-t-2", "border-blue-500")
    )
  })

  container.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    container.querySelectorAll("[data-id]").forEach((el) =>
      el.classList.remove("border-t-2", "border-blue-500")
    )
    const row = (e.target as HTMLElement).closest("[data-id]") as HTMLElement
    if (row && row.dataset.id !== dragId) {
      row.classList.add("border-t-2", "border-blue-500")
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

  const popover = document.createElement("div")
  popover.className = "fixed bg-gray-800 rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[300px] max-w-[400px] max-h-[500px] overflow-y-auto"

  const addBtn = document.createElement("button")
  addBtn.className = "text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 self-start"
  addBtn.textContent = "Add todo"
  addBtn.addEventListener("click", async () => {
    const result = await todoPrompt("Add Todo")
    if (!result) return
    const updated = addTodo(getTodos(), result)
    save(updated)
    rebuildContent()
  })
  popover.appendChild(addBtn)

  function rebuildContent() {
    while (popover.children.length > 1) {
      popover.removeChild(popover.lastChild!)
    }
    const todos = getTodos()
    const overdue = getOverdue(todos)
    const active = getActive(todos)
    const completed = getCompleted(todos)

    if (overdue.length > 0) {
      const acc = createAccordion(`Overdue (${overdue.length})`, true)
      for (const t of overdue) {
        acc.content.appendChild(renderTodoItem(t, "overdue", rebuildContent))
      }
      initSectionDrag(acc.content, overdue.map((t) => t.id), rebuildContent)
      popover.appendChild(acc.wrapper)
    }

    const todoAcc = createAccordion(`Todo (${active.length})`, false)
    for (const t of active) {
      todoAcc.content.appendChild(renderTodoItem(t, "active", rebuildContent))
    }
    initSectionDrag(todoAcc.content, active.map((t) => t.id), rebuildContent)
    popover.appendChild(todoAcc.wrapper)

    const compAcc = createAccordion(`Completed (${completed.length})`, false)
    for (const t of completed) {
      compAcc.content.appendChild(renderTodoItem(t, "completed", rebuildContent))
    }
    popover.appendChild(compAcc.wrapper)
  }

  rebuildContent()

  document.body.appendChild(popover)
  const rect = anchor.getBoundingClientRect()
  popover.style.right = (window.innerWidth - rect.right) + "px"
  popover.style.top = (rect.bottom + 4) + "px"
  openPopover = popover

  const onClickOutside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      closePopover()
      document.removeEventListener("click", onClickOutside)
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
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
