import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { applyTodos, currentTodos, showTodoPopover } from "../../todo"
import { addTodo, archiveTodo, isOverdue, setPinned, toggleTodo, canPin } from "../../todos"
import type { Todo } from "../../todos"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * Popovers need something on screen to hang off. The widget's own trigger is
 * the right anchor when it is visible; the search bar is the fallback for a
 * layout that doesn't show one.
 */
function anchor(): HTMLElement | null {
  const trigger = document.getElementById("todo-trigger")
  if (trigger && !trigger.hidden && trigger.offsetParent !== null) return trigger
  return document.getElementById("search-wrapper")
}

function dueLabel(todo: Todo): string | undefined {
  if (!todo.dueDate) return undefined
  return isOverdue(todo) ? `overdue · ${todo.dueDate}` : todo.dueDate
}

function candidate(todo: Todo): Candidate {
  return {
    id: `todo:${todo.id}`,
    title: todo.title,
    subtitle: todo.description ?? undefined,
    detail: dueLabel(todo),
    haystack: todo.url ? [todo.url] : undefined,
    boost: todo.pinned ? 1 : isOverdue(todo) ? 0.85 : 0.5,
    icon: () => icon(todo.completed ? "checkCircle" : "todoEmpty", { size: 16 }),
    iconKey: todo.completed ? "done" : "open",
    copyValue: todo.title,
    run: (mode) => {
      if (todo.url) {
        navigate(todo.url, "search", mode === "newTab" ? "newTab" : "default")
        return
      }
      const host = anchor()
      if (host) showTodoPopover(host, todo.id)
    },
    keepOpen: !todo.url,
    actions: [
      {
        id: "toggle",
        label: todo.completed ? "Mark as open" : "Mark as done",
        glyph: "checkCircle",
        run: () => applyTodos(toggleTodo(currentTodos(), todo.id)),
      },
      {
        id: "pin",
        label: todo.pinned ? "Unpin" : "Pin",
        glyph: todo.pinned ? "pin" : "pinFilled",
        run: () => {
          const todos = currentTodos()
          if (todo.pinned || canPin(todos, todo.id)) {
            applyTodos(setPinned(todos, todo.id, !todo.pinned))
          }
        },
      },
      {
        id: "archive",
        label: "Archive",
        glyph: "archive",
        destructive: true,
        run: () => applyTodos(archiveTodo(currentTodos(), todo.id)),
      },
    ],
  }
}

export const todosSource: SearchSource = {
  id: "todos",
  label: "Todos",
  token: "todo",
  glyph: "todoList",
  weight: 1.1,
  limit: 3,
  scopedLimit: 20,
  available: () => store.sync.get("todoEnabled"),
  unavailable: () => ({ message: "The todo widget is turned off." }),
  query(ctx: QueryContext): Candidate[] {
    const query = ctx.text.trim()
    if (!query && !ctx.scoped) return []

    const todos = currentTodos().filter((t) => !t.archived)
    const rows = todos.map(candidate)

    // Scoped with a query that matches nothing, the useful answer is to make
    // the thing you just described rather than to report an empty list.
    if (ctx.scoped && query) {
      rows.push({
        id: `todo:new`,
        title: `Add todo "${query}"`,
        prematched: true,
        boost: 0,
        icon: () => icon("plus", { size: 16 }),
        run: () => applyTodos(addTodo(currentTodos(), { title: query })),
      })
    }
    return rows
  },
  idle(): Candidate[] {
    return currentTodos()
      .filter((t) => !t.archived && !t.completed)
      .slice(0, 20)
      .map(candidate)
  },
}
