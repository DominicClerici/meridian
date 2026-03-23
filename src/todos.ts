export type Todo = {
  id: string
  title: string
  description: string | null
  url: string | null
  dueDate: string | null
  completed: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
  order: number
}

export const MAX_TODOS = 500

export function addTodo(
  todos: Todo[],
  data: { title: string; description?: string | null; url?: string | null; dueDate?: string | null }
): Todo[] {
  if (todos.length >= MAX_TODOS) return todos
  const maxOrder = todos.reduce((max, t) => Math.max(max, t.order), 0)
  const now = new Date().toISOString()
  const todo: Todo = {
    id: crypto.randomUUID(),
    title: data.title,
    description: data.description ?? null,
    url: data.url ?? null,
    dueDate: data.dueDate ?? null,
    completed: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    order: maxOrder + 1,
  }
  return [...todos, todo]
}

export function editTodo(
  todos: Todo[],
  id: string,
  data: { title?: string; description?: string | null; url?: string | null; dueDate?: string | null }
): Todo[] {
  return todos.map((t) => {
    if (t.id !== id) return t
    return {
      ...t,
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.url !== undefined && { url: data.url }),
      ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
      updatedAt: new Date().toISOString(),
    }
  })
}

export function deleteTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((t) => t.id !== id)
}

export function toggleTodo(todos: Todo[], id: string): Todo[] {
  return todos.map((t) => {
    if (t.id !== id) return t
    const completed = !t.completed
    return {
      ...t,
      completed,
      completedAt: completed ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    }
  })
}

export function reorderTodos(
  todos: Todo[],
  sectionIds: string[],
  fromId: string,
  toId: string
): Todo[] {
  const sectionSet = new Set(sectionIds)
  const section = todos.filter((t) => sectionSet.has(t.id)).sort((a, b) => a.order - b.order)
  const fromIdx = section.findIndex((t) => t.id === fromId)
  const toIdx = section.findIndex((t) => t.id === toId)
  if (fromIdx === -1 || toIdx === -1) return todos
  const [moved] = section.splice(fromIdx, 1)
  section.splice(toIdx, 0, moved)
  const orderMap = new Map(section.map((t, i) => [t.id, i]))
  return todos.map((t) => orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t)
}

function isOverdue(todo: Todo): boolean {
  if (todo.completed || !todo.dueDate) return false
  const due = new Date(todo.dueDate + "T23:59:59")
  return due < new Date()
}

export function getOverdue(todos: Todo[]): Todo[] {
  return todos.filter(isOverdue).sort((a, b) => a.order - b.order)
}

export function getActive(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => !t.completed && !isOverdue(t))
    .sort((a, b) => a.order - b.order)
}

export function getCompleted(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => t.completed)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return bTime - aTime
    })
}

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
const SIX_MONTHS = 6 * 30 * 24 * 60 * 60 * 1000

export function purgeStale(todos: Todo[]): Todo[] {
  const now = Date.now()
  return todos.filter((t) => {
    if (t.completed && t.completedAt) {
      return now - new Date(t.completedAt).getTime() < THREE_DAYS
    }
    return now - new Date(t.updatedAt).getTime() < SIX_MONTHS
  })
}
