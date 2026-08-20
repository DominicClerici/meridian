# Widgets: Clock, Todo, Weather — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three widgets to the startpage extension — a live clock above the search bar, a to-do list in a popover, and a weather widget fetching from open-meteo.

**Architecture:** Each widget gets its own TypeScript file with an exported `initX()` function, following the existing one-file-per-feature pattern (see `src/dock.ts`, `src/search.ts`). Pure data logic is separated from DOM code (see `src/shortcuts.ts` → `src/shortcut-settings.ts`). All settings are stored via the typed reactive store in `src/store.ts`. New setting keys are added to `src/defaults.ts`.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4 (standalone CLI in `bin/`), esbuild (standalone in `bin/`). No npm. Build via `./build.sh`. Type-check via `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-03-23-widgets-clock-todo-weather-design.md`

---

### Task 1: Add new settings to defaults.ts

**Files:**
- Modify: `src/defaults.ts`

This task adds all new setting keys and defaults for the three widgets. Every subsequent task depends on these types being in place.

- [ ] **Step 1: Add Todo type import and clock/todo/weather keys to SyncSettings**

In `src/defaults.ts`, add the new keys to `SyncSettings`:

```ts
export type SyncSettings = {
  bgColor: "red" | "green" | "blue";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  clock24Hour: boolean;
  clockShowAmPm: boolean;
  clockShowDate: boolean;
  clockDateFormat: "long" | "short" | "abbr" | "numeric" | "numericShort";
  clockSize: "small" | "medium" | "large";
  todoEnabled: boolean;
  todoShowBadges: boolean;
  weatherEnabled: boolean;
  weatherUnit: "f" | "c";
};
```

- [ ] **Step 2: Update LocalSettings with new keys**

`LocalSettings` will reference a `Todo` type that will be defined in `src/todos.ts` (Task 4). For now, use an inline type. Once Task 4 is done, `defaults.ts` will import `Todo` from `./todos` — matching the existing pattern where `Tab` is imported from `./shortcuts`.

```ts
import type { Todo } from "./todos"

export type LocalSettings = {
  shortcuts: Tab[]
  todos: Todo[]
  weatherLat: number | null
  weatherLon: number | null
}
```

- [ ] **Step 3: Add default values for all new keys**

Update `syncDefaults` and `localDefaults`:

```ts
export const syncDefaults: SyncSettings = {
  bgColor: "blue",
  searchEngine: "google",
  debounceSearch: false,
  clockEnabled: true,
  clockShowSeconds: false,
  clock24Hour: false,
  clockShowAmPm: true,
  clockShowDate: false,
  clockDateFormat: "long",
  clockSize: "medium",
  todoEnabled: true,
  todoShowBadges: true,
  weatherEnabled: true,
  weatherUnit: "f",
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
  todos: [],
  weatherLat: null,
  weatherLon: null,
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add settings schema for clock, todo, and weather widgets"
```

---

### Task 2: Update index.html with new elements

**Files:**
- Modify: `src/index.html`

Adds the clock `<div>`, widgets container with trigger buttons, new settings fieldsets, and the todo add/edit dialog.

- [ ] **Step 1: Add clock div above search input**

Inside `#search-wrapper > div.max-w-lg`, add a clock div before the search input (before line 19):

```html
<div id="clock" class="text-center text-white mb-4 tabular-nums"></div>
```

- [ ] **Step 2: Add widgets container in top-right**

After the `#settings-open` button (after line 16), add:

```html
<div id="widgets" class="fixed top-4 right-4 flex items-center gap-2">
  <button id="weather-trigger" class="flex items-center gap-1 p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white text-sm" hidden></button>
  <button id="todo-trigger" class="relative flex items-center gap-1 p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white" aria-label="Todos" hidden>
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 18H3"/>
      <path d="M11 12H3"/>
      <path d="M11 6H3"/>
      <path d="m15 9 3 3-3 3"/>
    </svg>
    <span id="todo-badge-count" class="absolute -top-1 -right-1 text-[10px] bg-white/90 text-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-semibold" hidden></span>
    <span id="todo-badge-overdue" class="absolute -top-1 -left-1 text-[10px] bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-semibold" hidden></span>
  </button>
</div>
```

- [ ] **Step 3: Add Clock settings fieldset**

After the Search fieldset closing `</fieldset>` (after line 73), add:

```html
<fieldset id="settings-clock" class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Clock</legend>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-clock-enabled" class="rounded">
      <label for="settings-clock-enabled" class="text-sm">Show clock</label>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-clock-seconds" class="rounded">
      <label for="settings-clock-seconds" class="text-sm">Show seconds</label>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-clock-24h" class="rounded">
      <label for="settings-clock-24h" class="text-sm">24-hour format</label>
    </div>
    <div id="settings-clock-ampm-row" class="flex items-center gap-2">
      <input type="checkbox" id="settings-clock-ampm" class="rounded">
      <label for="settings-clock-ampm" class="text-sm">Show AM/PM</label>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-clock-date" class="rounded">
      <label for="settings-clock-date" class="text-sm">Show date</label>
    </div>
    <div id="settings-clock-date-format-row" class="flex items-center gap-2">
      <label for="settings-clock-date-format" class="text-sm">Date format</label>
      <select id="settings-clock-date-format" class="text-sm rounded px-2 py-1 border border-gray-300">
        <option value="long">January 24th</option>
        <option value="short">Jan. 24th</option>
        <option value="abbr">Jan 24</option>
        <option value="numeric">01/24/2024</option>
        <option value="numericShort">01/24</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label for="settings-clock-size" class="text-sm">Size</label>
      <select id="settings-clock-size" class="text-sm rounded px-2 py-1 border border-gray-300">
        <option value="small">Small</option>
        <option value="medium">Medium</option>
        <option value="large">Large</option>
      </select>
    </div>
  </div>
</fieldset>
```

- [ ] **Step 4: Add Todo settings fieldset**

After the Clock fieldset, add:

```html
<fieldset id="settings-todo" class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Todo</legend>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-todo-enabled" class="rounded">
      <label for="settings-todo-enabled" class="text-sm">Enable todo widget</label>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-todo-badges" class="rounded">
      <label for="settings-todo-badges" class="text-sm">Show badges</label>
    </div>
    <button id="settings-todo-clear" type="button" class="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 self-start">Clear all todos</button>
  </div>
</fieldset>
```

- [ ] **Step 5: Add Weather settings fieldset**

After the Todo fieldset, add:

```html
<fieldset id="settings-weather" class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Weather</legend>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-weather-enabled" class="rounded">
      <label for="settings-weather-enabled" class="text-sm">Enable weather</label>
    </div>
    <div class="flex items-center gap-2">
      <label for="settings-weather-unit" class="text-sm">Temperature unit</label>
      <select id="settings-weather-unit" class="text-sm rounded px-2 py-1 border border-gray-300">
        <option value="f">Fahrenheit</option>
        <option value="c">Celsius</option>
      </select>
    </div>
    <div id="settings-weather-location-row">
      <button id="settings-weather-grant" type="button" class="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">Grant location access</button>
      <p id="settings-weather-location-help" class="text-xs text-gray-500 mt-1" hidden>Location access was denied. Please enable it in your browser settings for this extension.</p>
    </div>
  </div>
</fieldset>
```

- [ ] **Step 6: Add Todo add/edit dialog**

After the `#sc-prompt-dialog` closing `</dialog>` (after line 88), add:

```html
<dialog id="todo-prompt-dialog" class="rounded-xl p-0 backdrop:bg-black/50">
  <form method="dialog" class="p-4 min-w-[300px] flex flex-col gap-3">
    <h3 id="todo-prompt-title" class="text-sm font-semibold"></h3>
    <input id="todo-prompt-title-input" type="text" placeholder="Title" class="text-sm rounded px-2 py-1 border border-gray-300" required maxlength="256">
    <textarea id="todo-prompt-desc" placeholder="Description (optional)" class="text-sm rounded px-2 py-1 border border-gray-300 resize-y" rows="3" maxlength="1024"></textarea>
    <input id="todo-prompt-url" type="url" placeholder="URL (optional)" class="text-sm rounded px-2 py-1 border border-gray-300">
    <input id="todo-prompt-due" type="date" class="text-sm rounded px-2 py-1 border border-gray-300">
    <div class="flex gap-2 justify-end">
      <button type="button" id="todo-prompt-cancel" class="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
      <button type="submit" id="todo-prompt-save" class="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">Save</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 7: Verify build**

Run: `./build.sh`
Expected: Builds successfully to `dist/`

- [ ] **Step 8: Commit**

```bash
git add src/index.html
git commit -m "feat: add HTML elements for clock, todo, weather widgets and settings"
```

---

### Task 3: Build clock widget

**Files:**
- Create: `src/clock.ts`

The clock renders above the search bar, updates every second, with blinking colons. Reads all clock settings from the store reactively.

- [ ] **Step 1: Create `src/clock.ts`**

```ts
import { store } from "./store"
import type { SyncSettings } from "./defaults"

const SIZE_MAP: Record<SyncSettings["clockSize"], string> = {
  small: "3rem",
  medium: "5rem",
  large: "8rem",
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_SHORT = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."]
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function ordinal(day: number): string {
  if (day > 3 && day < 21) return day + "th"
  switch (day % 10) {
    case 1: return day + "st"
    case 2: return day + "nd"
    case 3: return day + "rd"
    default: return day + "th"
  }
}

function formatDate(now: Date, fmt: SyncSettings["clockDateFormat"]): string {
  const month = now.getMonth()
  const day = now.getDate()
  const year = now.getFullYear()
  const mm = String(month + 1).padStart(2, "0")
  const dd = String(day).padStart(2, "0")

  switch (fmt) {
    case "long": return `${MONTHS_LONG[month]} ${ordinal(day)}`
    case "short": return `${MONTHS_SHORT[month]} ${ordinal(day)}`
    case "abbr": return `${MONTHS_ABBR[month]} ${day}`
    case "numeric": return `${mm}/${dd}/${year}`
    case "numericShort": return `${mm}/${dd}`
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

let intervalId: ReturnType<typeof setInterval> | null = null
let colonVisible = true

function renderClock(): void {
  const el = document.getElementById("clock")
  if (!el) return

  const enabled = store.sync.get("clockEnabled")
  if (!enabled) {
    el.hidden = true
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    return
  }

  el.hidden = false
  const now = new Date()
  const showSeconds = store.sync.get("clockShowSeconds")
  const is24h = store.sync.get("clock24Hour")
  const showAmPm = !is24h && store.sync.get("clockShowAmPm")
  const showDate = store.sync.get("clockShowDate")
  const dateFormat = store.sync.get("clockDateFormat")
  const size = store.sync.get("clockSize")

  let hours = now.getHours()
  let ampm = ""
  if (!is24h) {
    ampm = hours >= 12 ? "PM" : "AM"
    hours = hours % 12 || 12
  }

  const colonOpacity = colonVisible ? "1" : "0.5"
  const colon = `<span style="opacity:${colonOpacity}">:</span>`

  let timeHtml = `${is24h ? pad(hours) : hours}${colon}${pad(now.getMinutes())}`
  if (showSeconds) {
    timeHtml += `${colon}${pad(now.getSeconds())}`
  }
  if (showAmPm) {
    timeHtml += ` <span style="font-size:0.4em;vertical-align:super">${ampm}</span>`
  }

  let html = `<div style="font-size:${SIZE_MAP[size]};line-height:1">${timeHtml}</div>`
  if (showDate) {
    html += `<div class="text-white/70 mt-1" style="font-size:${size === "small" ? "0.875rem" : size === "medium" ? "1.125rem" : "1.5rem"}">${formatDate(now, dateFormat)}</div>`
  }

  el.innerHTML = html

  if (intervalId === null) {
    intervalId = setInterval(() => {
      colonVisible = !colonVisible
      renderClock()
    }, 1000)
  }
}

export function initClock(): void {
  renderClock()

  const keys: (keyof SyncSettings)[] = [
    "clockEnabled", "clockShowSeconds", "clock24Hour",
    "clockShowAmPm", "clockShowDate", "clockDateFormat", "clockSize",
  ]
  for (const key of keys) {
    store.sync.subscribe(key, () => renderClock())
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/clock.ts
git commit -m "feat: add live clock widget with blinking colons and date display"
```

---

### Task 4: Build todos.ts (pure data functions)

**Files:**
- Create: `src/todos.ts`

Pure functions for todo CRUD, filtering, sorting, and staleness purging. No DOM code. Mirrors the pattern of `src/shortcuts.ts`.

- [ ] **Step 1: Create `src/todos.ts`**

Define the `Todo` type here (imported by `defaults.ts`), matching the pattern where `shortcuts.ts` defines `Tab`.

```ts
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
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/todos.ts
git commit -m "feat: add todo pure data functions (CRUD, filter, purge)"
```

---

### Task 5: Build todo widget (popover, rendering, drag-and-drop)

**Files:**
- Create: `src/todo.ts`

The main todo UI — trigger button with badges, popover with accordions, item rendering, completion toggling, drag-and-drop reordering, and the add/edit dialog. This is the largest task.

- [ ] **Step 1: Create `src/todo.ts` with the prompt helper and badge updates**

```ts
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
```

- [ ] **Step 2: Add popover rendering with accordions and todo items**

Append to `src/todo.ts`:

```ts
function closePopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
  updateBadges()
}

function createAccordion(label: string, isRed: boolean): { wrapper: HTMLElement; content: HTMLElement; toggle: () => void } {
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
  return { wrapper, content, toggle: () => trigger.click() }
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
```

- [ ] **Step 3: Add drag-and-drop logic for todo sections**

Append to `src/todo.ts`:

```ts
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
```

- [ ] **Step 4: Add the showPopover function and initTodo**

Append to `src/todo.ts`:

```ts
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
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/todo.ts
git commit -m "feat: add todo widget with popover, accordions, drag-and-drop"
```

---

### Task 6: Build weather widget

**Files:**
- Create: `src/weather.ts`

Handles geolocation, open-meteo fetch with cooldown, weather code mapping, trigger rendering in three states, and blank popover.

- [ ] **Step 1: Create `src/weather.ts` with weather code mapping and types**

```ts
import { store } from "./store"

type WeatherData = {
  temperature: number
  weatherCode: number
}

type WeatherInfo = {
  icon: string
  condition: string
}

const WEATHER_MAP: Record<number, WeatherInfo> = {
  0: { icon: "\u2600\uFE0F", condition: "Clear sky" },
  1: { icon: "\uD83C\uDF24\uFE0F", condition: "Mainly clear" },
  2: { icon: "\u26C5", condition: "Partly cloudy" },
  3: { icon: "\u2601\uFE0F", condition: "Overcast" },
  45: { icon: "\uD83C\uDF2B\uFE0F", condition: "Fog" },
  48: { icon: "\uD83C\uDF2B\uFE0F", condition: "Fog" },
  51: { icon: "\uD83C\uDF26\uFE0F", condition: "Light drizzle" },
  53: { icon: "\uD83C\uDF26\uFE0F", condition: "Drizzle" },
  55: { icon: "\uD83C\uDF26\uFE0F", condition: "Dense drizzle" },
  56: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing drizzle" },
  57: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing drizzle" },
  61: { icon: "\uD83C\uDF27\uFE0F", condition: "Light rain" },
  63: { icon: "\uD83C\uDF27\uFE0F", condition: "Rain" },
  65: { icon: "\uD83C\uDF27\uFE0F", condition: "Heavy rain" },
  66: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing rain" },
  67: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing rain" },
  71: { icon: "\u2744\uFE0F", condition: "Light snow" },
  73: { icon: "\u2744\uFE0F", condition: "Snow" },
  75: { icon: "\u2744\uFE0F", condition: "Heavy snow" },
  77: { icon: "\u2744\uFE0F", condition: "Snow grains" },
  80: { icon: "\uD83C\uDF27\uFE0F", condition: "Light showers" },
  81: { icon: "\uD83C\uDF27\uFE0F", condition: "Showers" },
  82: { icon: "\uD83C\uDF27\uFE0F", condition: "Heavy showers" },
  85: { icon: "\u2744\uFE0F", condition: "Snow showers" },
  86: { icon: "\u2744\uFE0F", condition: "Heavy snow showers" },
  95: { icon: "\u26C8\uFE0F", condition: "Thunderstorm" },
  96: { icon: "\u26C8\uFE0F", condition: "Thunderstorm with hail" },
  99: { icon: "\u26C8\uFE0F", condition: "Thunderstorm with hail" },
}

function getWeatherInfo(code: number): WeatherInfo {
  return WEATHER_MAP[code] ?? { icon: "\u2753", condition: "Unknown" }
}

const LS_LAST_FETCH = "sp:weather:lastFetch"
const LS_CACHED_DATA = "sp:weather:cachedData"
const COOLDOWN = 120_000
const REFRESH_INTERVAL = 300_000
```

- [ ] **Step 2: Add geolocation, fetch, and caching logic**

Append to `src/weather.ts`:

```ts
type State = "no-permission" | "loading" | "loaded" | "error"

let currentState: State = "loading"
let currentData: WeatherData | null = null
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let openPopover: HTMLElement | null = null

function getCachedData(): WeatherData | null {
  try {
    const raw = localStorage.getItem(LS_CACHED_DATA)
    if (!raw) return null
    return JSON.parse(raw) as WeatherData
  } catch {
    return null
  }
}

function setCachedData(data: WeatherData): void {
  try {
    localStorage.setItem(LS_CACHED_DATA, JSON.stringify(data))
    localStorage.setItem(LS_LAST_FETCH, String(Date.now()))
  } catch { /* quota */ }
}

function isCooldownActive(): boolean {
  try {
    const last = localStorage.getItem(LS_LAST_FETCH)
    if (!last) return false
    return Date.now() - Number(last) < COOLDOWN
  } catch {
    return false
  }
}

function getCoordinates(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        store.local.set("weatherLat", coords.lat)
        store.local.set("weatherLon", coords.lon)
        resolve(coords)
      },
      () => {
        const lat = store.local.get("weatherLat")
        const lon = store.local.get("weatherLon")
        if (lat !== null && lon !== null) {
          resolve({ lat, lon })
        } else {
          resolve(null)
        }
      },
      { timeout: 10000 }
    )
  })
}

async function fetchWeather(): Promise<void> {
  if (!store.sync.get("weatherEnabled")) return

  if (isCooldownActive()) {
    const cached = getCachedData()
    if (cached) {
      currentData = cached
      currentState = "loaded"
      renderTrigger()
      return
    }
  }

  currentState = "loading"
  renderTrigger()

  const coords = await getCoordinates()
  if (!coords) {
    currentState = "no-permission"
    renderTrigger()
    return
  }

  const unit = store.sync.get("weatherUnit")
  const tempUnit = unit === "c" ? "celsius" : "fahrenheit"
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const data: WeatherData = {
      temperature: json.current.temperature_2m,
      weatherCode: json.current.weather_code,
    }
    currentData = data
    currentState = "loaded"
    setCachedData(data)
  } catch {
    const cached = getCachedData()
    if (cached) {
      currentData = cached
      currentState = "loaded"
    } else {
      currentState = "error"
    }
  }

  renderTrigger()
}
```

- [ ] **Step 3: Add trigger rendering and popover**

Append to `src/weather.ts`:

```ts
function closeWeatherPopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
}

function renderTrigger(): void {
  const trigger = document.getElementById("weather-trigger") as HTMLButtonElement
  if (!store.sync.get("weatherEnabled")) {
    trigger.hidden = true
    return
  }
  trigger.hidden = false

  if (currentState === "no-permission") {
    trigger.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg> <span class="text-xs">Enable location</span>`
    return
  }

  if (currentState === "loading") {
    trigger.innerHTML = `<span class="text-xs">Loading...</span>`
    return
  }

  if (currentState === "error") {
    trigger.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`
    return
  }

  if (currentData) {
    const info = getWeatherInfo(currentData.weatherCode)
    const unit = store.sync.get("weatherUnit")
    const temp = Math.round(currentData.temperature)
    trigger.innerHTML = `<span>${info.icon}</span> <span class="text-sm">${temp}\u00B0${unit.toUpperCase()} ${info.condition}</span>`
  }
}

function showWeatherPopover(anchor: HTMLElement): void {
  closeWeatherPopover()
  const popover = document.createElement("div")
  popover.className = "fixed bg-gray-800 rounded-lg shadow-lg p-3 min-w-[200px]"

  document.body.appendChild(popover)
  const rect = anchor.getBoundingClientRect()
  popover.style.right = (window.innerWidth - rect.right) + "px"
  popover.style.top = (rect.bottom + 4) + "px"
  openPopover = popover

  const onClickOutside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      closeWeatherPopover()
      document.removeEventListener("click", onClickOutside)
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
}

export function initWeather(): void {
  const trigger = document.getElementById("weather-trigger") as HTMLButtonElement
  const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "no-permission") {
      settingsDialog.showModal()
      return
    }
    if (currentState === "loaded") {
      if (openPopover) {
        closeWeatherPopover()
      } else {
        showWeatherPopover(trigger)
      }
    }
  })

  store.sync.subscribe("weatherEnabled", (val) => {
    if (val) {
      fetchWeather()
      startRefreshInterval()
    } else {
      trigger.hidden = true
      closeWeatherPopover()
      stopRefreshInterval()
    }
  })

  store.sync.subscribe("weatherUnit", () => {
    try { localStorage.removeItem(LS_LAST_FETCH) } catch { /* */ }
    fetchWeather()
  })

  if (store.sync.get("weatherEnabled")) {
    fetchWeather()
    startRefreshInterval()
  } else {
    trigger.hidden = true
  }
}

function startRefreshInterval(): void {
  stopRefreshInterval()
  refreshIntervalId = setInterval(() => fetchWeather(), REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/weather.ts
git commit -m "feat: add weather widget with geolocation, open-meteo fetch, cooldown"
```

---

### Task 7: Wire settings for all three widgets

**Files:**
- Modify: `src/settings.ts`

Add event listeners and store subscriptions for all new settings controls in the settings dialog.

- [ ] **Step 1: Add clock settings wiring**

At the end of `initSettings()` in `src/settings.ts`, add clock settings wiring:

```ts
  const clockEnabled = document.getElementById("settings-clock-enabled") as HTMLInputElement
  const clockSeconds = document.getElementById("settings-clock-seconds") as HTMLInputElement
  const clock24h = document.getElementById("settings-clock-24h") as HTMLInputElement
  const clockAmPm = document.getElementById("settings-clock-ampm") as HTMLInputElement
  const clockAmPmRow = document.getElementById("settings-clock-ampm-row") as HTMLElement
  const clockDate = document.getElementById("settings-clock-date") as HTMLInputElement
  const clockDateFormat = document.getElementById("settings-clock-date-format") as HTMLSelectElement
  const clockDateFormatRow = document.getElementById("settings-clock-date-format-row") as HTMLElement
  const clockSize = document.getElementById("settings-clock-size") as HTMLSelectElement

  clockEnabled.checked = store.sync.get("clockEnabled")
  clockSeconds.checked = store.sync.get("clockShowSeconds")
  clock24h.checked = store.sync.get("clock24Hour")
  clockAmPm.checked = store.sync.get("clockShowAmPm")
  clockDate.checked = store.sync.get("clockShowDate")
  clockDateFormat.value = store.sync.get("clockDateFormat")
  clockSize.value = store.sync.get("clockSize")
  clockAmPmRow.hidden = store.sync.get("clock24Hour")
  clockDateFormatRow.hidden = !store.sync.get("clockShowDate")

  clockEnabled.addEventListener("change", () => store.sync.set("clockEnabled", clockEnabled.checked))
  clockSeconds.addEventListener("change", () => store.sync.set("clockShowSeconds", clockSeconds.checked))
  clock24h.addEventListener("change", () => {
    store.sync.set("clock24Hour", clock24h.checked)
    clockAmPmRow.hidden = clock24h.checked
  })
  clockAmPm.addEventListener("change", () => store.sync.set("clockShowAmPm", clockAmPm.checked))
  clockDate.addEventListener("change", () => {
    store.sync.set("clockShowDate", clockDate.checked)
    clockDateFormatRow.hidden = !clockDate.checked
  })
  clockDateFormat.addEventListener("change", () => store.sync.set("clockDateFormat", clockDateFormat.value as SyncSettings["clockDateFormat"]))
  clockSize.addEventListener("change", () => store.sync.set("clockSize", clockSize.value as SyncSettings["clockSize"]))

  store.sync.subscribe("clockEnabled", (v) => { clockEnabled.checked = v })
  store.sync.subscribe("clockShowSeconds", (v) => { clockSeconds.checked = v })
  store.sync.subscribe("clock24Hour", (v) => {
    clock24h.checked = v
    clockAmPmRow.hidden = v
  })
  store.sync.subscribe("clockShowAmPm", (v) => { clockAmPm.checked = v })
  store.sync.subscribe("clockShowDate", (v) => {
    clockDate.checked = v
    clockDateFormatRow.hidden = !v
  })
  store.sync.subscribe("clockDateFormat", (v) => { clockDateFormat.value = v })
  store.sync.subscribe("clockSize", (v) => { clockSize.value = v })
```

- [ ] **Step 2: Add todo settings wiring**

Continue appending to `initSettings()`:

```ts
  const todoEnabled = document.getElementById("settings-todo-enabled") as HTMLInputElement
  const todoBadges = document.getElementById("settings-todo-badges") as HTMLInputElement
  const todoClear = document.getElementById("settings-todo-clear") as HTMLButtonElement

  todoEnabled.checked = store.sync.get("todoEnabled")
  todoBadges.checked = store.sync.get("todoShowBadges")

  todoEnabled.addEventListener("change", () => store.sync.set("todoEnabled", todoEnabled.checked))
  todoBadges.addEventListener("change", () => store.sync.set("todoShowBadges", todoBadges.checked))
  todoClear.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all todos?")) {
      store.local.set("todos", [])
    }
  })

  store.sync.subscribe("todoEnabled", (v) => { todoEnabled.checked = v })
  store.sync.subscribe("todoShowBadges", (v) => { todoBadges.checked = v })
```

- [ ] **Step 3: Add weather settings wiring**

Continue appending to `initSettings()`:

```ts
  const weatherEnabled = document.getElementById("settings-weather-enabled") as HTMLInputElement
  const weatherUnit = document.getElementById("settings-weather-unit") as HTMLSelectElement
  const weatherGrant = document.getElementById("settings-weather-grant") as HTMLButtonElement
  const weatherLocationRow = document.getElementById("settings-weather-location-row") as HTMLElement
  const weatherLocationHelp = document.getElementById("settings-weather-location-help") as HTMLElement

  weatherEnabled.checked = store.sync.get("weatherEnabled")
  weatherUnit.value = store.sync.get("weatherUnit")

  function updateWeatherLocationUI(): void {
    const hasCoords = store.local.get("weatherLat") !== null
    weatherLocationRow.hidden = hasCoords
  }
  updateWeatherLocationUI()

  weatherEnabled.addEventListener("change", () => store.sync.set("weatherEnabled", weatherEnabled.checked))
  weatherUnit.addEventListener("change", () => store.sync.set("weatherUnit", weatherUnit.value as SyncSettings["weatherUnit"]))
  weatherGrant.addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store.local.set("weatherLat", pos.coords.latitude)
        store.local.set("weatherLon", pos.coords.longitude)
        updateWeatherLocationUI()
        weatherLocationHelp.hidden = true
      },
      () => {
        weatherLocationHelp.hidden = false
      },
      { timeout: 10000 }
    )
  })

  store.sync.subscribe("weatherEnabled", (v) => { weatherEnabled.checked = v })
  store.sync.subscribe("weatherUnit", (v) => { weatherUnit.value = v })
  store.local.subscribe("weatherLat", () => updateWeatherLocationUI())
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat: wire clock, todo, weather settings in settings dialog"
```

---

### Task 8: Wire init functions in index.ts

**Files:**
- Modify: `src/index.ts`

Import and call the three new init functions.

- [ ] **Step 1: Update `src/index.ts`**

Replace the full content of `src/index.ts`:

```ts
import { store } from "./store"
import { applyBgColor, initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search"
import { initClock } from "./clock"
import { initTodo } from "./todo"
import { initWeather } from "./weather"

applyBgColor(store.sync.get("bgColor"))
store.sync.subscribe("bgColor", applyBgColor)

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
  initClock()
  initTodo()
  initWeather()
})
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire clock, todo, weather init in index.ts"
```

---

### Task 9: Full build and smoke test

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `./build.sh`
Expected: Builds successfully, `dist/` contains `index.html`, `index.js`, `styles.css`

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify dist output has new files bundled**

Check that `dist/index.js` contains references to the new widget code (clock, todo, weather functions should be bundled in).

Run: `grep -c "initClock\|initTodo\|initWeather" dist/index.js`
Expected: At least 3 matches

- [ ] **Step 4: Verify HTML has all new elements**

Run: `grep -c "id=\"clock\"\|id=\"widgets\"\|id=\"todo-trigger\"\|id=\"weather-trigger\"\|id=\"todo-prompt-dialog\"" dist/index.html`
Expected: 5 matches

- [ ] **Step 5: Commit (if any fixes were needed)**

Only if adjustments were made during verification.
