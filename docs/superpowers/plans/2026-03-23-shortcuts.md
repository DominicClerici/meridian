# Shortcuts System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tab-based shortcut system with a bottom dock for navigation and full CRUD + drag-and-drop management in the settings dialog.

**Architecture:** Single `shortcuts` key in `store.local` holding a `Tab[]` array. Three new files: `shortcuts.ts` (pure data logic), `dock.ts` (main-screen dock UI), `shortcut-settings.ts` (settings panel UI with drag-and-drop). Array position determines display order.

**Tech Stack:** Vanilla TypeScript, HTML, Tailwind CSS v4, native HTML Drag and Drop API, browser extension storage via existing store.

**Spec:** `docs/superpowers/specs/2026-03-23-shortcuts-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shortcuts.ts` | Create | Types (`Tab`, `Shortcut`, `Folder`, `TabItem`), CRUD helpers, limit constants |
| `src/dock.ts` | Create | Dock bar rendering, tab selector, folder popovers, click-to-open-URL |
| `src/shortcut-settings.ts` | Create | Settings panel: tab/item management, add/edit/delete dialogs, folder view, drag-and-drop |
| `src/defaults.ts` | Modify | Add `shortcuts: Tab[]` to `LocalSettings`, default `[]` |
| `src/index.html` | Modify | Add dock container, add shortcuts settings section inside dialog |
| `src/index.ts` | Modify | Import and initialize dock + shortcut settings |

---

### Task 1: Data Types and Store Integration

**Files:**
- Create: `src/shortcuts.ts`
- Modify: `src/defaults.ts:1-13`

- [ ] **Step 1: Create `src/shortcuts.ts` with types and constants**

```ts
export type Shortcut = {
  type: "shortcut"
  id: string
  name: string
  url: string
}

export type Folder = {
  type: "folder"
  id: string
  name: string
  children: Shortcut[]
}

export type TabItem = Shortcut | Folder

export type Tab = {
  id: string
  name: string
  items: TabItem[]
}

export const MAX_TABS = 10
export const MAX_ITEMS_PER_TAB = 256
export const MAX_CHILDREN_PER_FOLDER = 64
```

- [ ] **Step 2: Update `src/defaults.ts` to add `shortcuts` to `LocalSettings`**

Append the `shortcuts` key to the existing `LocalSettings` type and `localDefaults`. Import `Tab` from `shortcuts.ts`. Keep any existing keys intact.

In `src/defaults.ts`, add the import at the top:

```ts
import type { Tab } from "./shortcuts"
```

In the `LocalSettings` type, add:

```ts
  shortcuts: Tab[]
```

In `localDefaults`, add:

```ts
  shortcuts: [],
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/shortcuts.ts src/defaults.ts
git commit -m "feat: add shortcut data types and store integration"
```

---

### Task 2: CRUD Helpers in `shortcuts.ts`

**Files:**
- Modify: `src/shortcuts.ts`

Pure functions that take a `Tab[]` and return a new `Tab[]`. No store dependency — the caller reads from and writes to the store.

- [ ] **Step 1: Add tab CRUD helpers**

```ts
export function addTab(tabs: Tab[], name: string): Tab[] {
  if (tabs.length >= MAX_TABS) return tabs
  return [...tabs, { id: crypto.randomUUID(), name, items: [] }]
}

export function deleteTab(tabs: Tab[], tabId: string): Tab[] {
  return tabs.filter((t) => t.id !== tabId)
}

```

- [ ] **Step 2: Add item CRUD helpers (add/delete/edit shortcut and folder at tab level)**

```ts
export function addShortcut(
  tabs: Tab[],
  tabId: string,
  name: string,
  url: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId || t.items.length >= MAX_ITEMS_PER_TAB) return t
    const sc: Shortcut = {
      type: "shortcut",
      id: crypto.randomUUID(),
      name,
      url,
    }
    return { ...t, items: [...t.items, sc] }
  })
}

export function addFolder(tabs: Tab[], tabId: string, name: string): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId || t.items.length >= MAX_ITEMS_PER_TAB) return t
    const folder: Folder = {
      type: "folder",
      id: crypto.randomUUID(),
      name,
      children: [],
    }
    return { ...t, items: [...t.items, folder] }
  })
}

export function deleteItem(tabs: Tab[], tabId: string, itemId: string): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return { ...t, items: t.items.filter((i) => i.id !== itemId) }
  })
}

export function editShortcut(
  tabs: Tab[],
  tabId: string,
  itemId: string,
  name: string,
  url: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) =>
        i.id === itemId && i.type === "shortcut" ? { ...i, name, url } : i
      ),
    }
  })
}

export function editFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  name: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) =>
        i.id === folderId && i.type === "folder" ? { ...i, name } : i
      ),
    }
  })
}
```

- [ ] **Step 3: Add folder-children CRUD helpers**

```ts
export function addShortcutToFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  name: string,
  url: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => {
        if (
          i.id !== folderId ||
          i.type !== "folder" ||
          i.children.length >= MAX_CHILDREN_PER_FOLDER
        )
          return i
        const sc: Shortcut = {
          type: "shortcut",
          id: crypto.randomUUID(),
          name,
          url,
        }
        return { ...i, children: [...i.children, sc] }
      }),
    }
  })
}

export function deleteShortcutFromFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcutId: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => {
        if (i.id !== folderId || i.type !== "folder") return i
        return { ...i, children: i.children.filter((c) => c.id !== shortcutId) }
      }),
    }
  })
}

export function editShortcutInFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcutId: string,
  name: string,
  url: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => {
        if (i.id !== folderId || i.type !== "folder") return i
        return {
          ...i,
          children: i.children.map((c) =>
            c.id === shortcutId ? { ...c, name, url } : c
          ),
        }
      }),
    }
  })
}
```

- [ ] **Step 4: Add reorder and drag-drop helpers**

```ts
export function reorderItems(
  tabs: Tab[],
  tabId: string,
  fromIndex: number,
  toIndex: number
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const items = [...t.items]
    const [moved] = items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)
    return { ...t, items }
  })
}

export function reorderFolderChildren(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  fromIndex: number,
  toIndex: number
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => {
        if (i.id !== folderId || i.type !== "folder") return i
        const children = [...i.children]
        const [moved] = children.splice(fromIndex, 1)
        children.splice(toIndex, 0, moved)
        return { ...i, children }
      }),
    }
  })
}

export function moveShortcutIntoFolder(
  tabs: Tab[],
  tabId: string,
  shortcutId: string,
  folderId: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const shortcut = t.items.find(
      (i) => i.id === shortcutId && i.type === "shortcut"
    ) as Shortcut | undefined
    if (!shortcut) return t
    const folder = t.items.find(
      (i) => i.id === folderId && i.type === "folder"
    ) as Folder | undefined
    if (!folder || folder.children.length >= MAX_CHILDREN_PER_FOLDER) return t
    return {
      ...t,
      items: t.items
        .filter((i) => i.id !== shortcutId)
        .map((i) =>
          i.id === folderId && i.type === "folder"
            ? { ...i, children: [...i.children, shortcut] }
            : i
        ),
    }
  })
}

export function mergeShortcutsIntoNewFolder(
  tabs: Tab[],
  tabId: string,
  targetId: string,
  draggedId: string,
  folderName: string
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const target = t.items.find(
      (i) => i.id === targetId && i.type === "shortcut"
    ) as Shortcut | undefined
    const dragged = t.items.find(
      (i) => i.id === draggedId && i.type === "shortcut"
    ) as Shortcut | undefined
    if (!target || !dragged) return t
    const folder: Folder = {
      type: "folder",
      id: crypto.randomUUID(),
      name: folderName,
      children: [
        { ...target, type: "shortcut" },
        { ...dragged, type: "shortcut" },
      ],
    }
    const items = t.items
      .filter((i) => i.id !== draggedId)
      .map((i) => (i.id === targetId ? folder : i))
    return { ...t, items: items as TabItem[] }
  })
}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/shortcuts.ts
git commit -m "feat: add shortcut CRUD and drag-drop helpers"
```

---

### Task 3: HTML Markup

**Files:**
- Modify: `src/index.html:9-17` (add dock container inside `#app`)
- Modify: `src/index.html:29-30` (add shortcuts settings section before close button)

- [ ] **Step 1: Add dock container to `#app` div**

After the settings-open button (line 16), before the closing `</div>` (line 17), add:

```html
    <div id="dock" class="fixed bottom-0 left-0 right-0 flex items-center gap-2 p-2 bg-black/30" hidden>
      <div id="dock-tabs" class="flex gap-1 border-r border-white/20 pr-2 mr-2"></div>
      <div id="dock-items" class="flex gap-2 overflow-x-auto"></div>
    </div>
```

- [ ] **Step 2: Add shortcuts settings section inside the dialog**

Between the background color `</fieldset>` (line 29) and the close button (line 30), add:

```html
      <fieldset class="border-0 p-0 m-0 mt-4">
        <legend class="text-sm font-medium mb-2">Shortcuts</legend>
        <div id="sc-controls" class="flex gap-2 mb-2 flex-wrap items-center">
          <select id="sc-tab-select" class="text-sm rounded px-2 py-1 border border-gray-300"></select>
          <button id="sc-add-tab" class="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">Add Tab</button>
          <button id="sc-delete-tab" class="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600" hidden>Delete Tab</button>
          <button id="sc-add-shortcut" class="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600" hidden>Add Shortcut</button>
          <button id="sc-add-folder" class="text-xs px-2 py-1 rounded bg-yellow-500 text-white hover:bg-yellow-600" hidden>Add Folder</button>
          <button id="sc-back" class="text-xs px-2 py-1 rounded bg-gray-500 text-white hover:bg-gray-600" hidden>Back</button>
        </div>
        <div id="sc-list" class="flex flex-col gap-1 max-h-48 overflow-y-auto"></div>
      </fieldset>
```

- [ ] **Step 3: Add the prompt dialog for creating/editing items**

After the settings `</dialog>` closing tag (line 32), add a second dialog:

```html
  <dialog id="sc-prompt-dialog" class="rounded-xl p-0 backdrop:bg-black/50">
    <form method="dialog" class="p-4 min-w-[260px] flex flex-col gap-3">
      <h3 id="sc-prompt-title" class="text-sm font-semibold"></h3>
      <input id="sc-prompt-name" type="text" placeholder="Name" class="text-sm rounded px-2 py-1 border border-gray-300" required>
      <input id="sc-prompt-url" type="text" placeholder="URL" class="text-sm rounded px-2 py-1 border border-gray-300">
      <div class="flex gap-2 justify-end">
        <button type="button" id="sc-prompt-cancel" class="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
        <button type="submit" id="sc-prompt-save" class="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">Save</button>
      </div>
    </form>
  </dialog>
```

- [ ] **Step 4: Build to verify HTML is valid**

Run: `./build.sh`
Expected: Build complete with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat: add dock and shortcut settings HTML markup"
```

---

### Task 4: Dock UI

**Files:**
- Create: `src/dock.ts`

- [ ] **Step 1: Create `src/dock.ts` with dock rendering and tab selection**

```ts
import { store } from "./store"
import type { Tab, TabItem, Folder } from "./shortcuts"

let activeTabId: string | null = null
let openPopover: HTMLElement | null = null

function getTabs(): Tab[] {
  return store.local.get("shortcuts")
}

function closeDockPopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
}

function renderDockItem(item: TabItem): HTMLElement {
  const el = document.createElement("button")
  el.className =
    "px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-sm whitespace-nowrap"

  if (item.type === "folder") {
    el.textContent = "\uD83D\uDCC1 " + item.name
    el.addEventListener("click", (e) => {
      e.stopPropagation()
      if (openPopover) {
        closeDockPopover()
        return
      }
      showFolderPopover(item, el)
    })
  } else {
    el.textContent = item.name
    el.addEventListener("click", () => {
      window.open(item.url, "_blank")
    })
  }

  return el
}

function showFolderPopover(folder: Folder, anchor: HTMLElement): void {
  closeDockPopover()
  const popover = document.createElement("div")
  popover.className =
    "fixed bg-gray-800 rounded-lg shadow-lg p-2 flex flex-col gap-1 min-w-[150px]"

  for (const child of folder.children) {
    const btn = document.createElement("button")
    btn.className =
      "text-left px-3 py-1 rounded hover:bg-white/20 text-white text-sm"
    btn.textContent = child.name
    btn.addEventListener("click", () => {
      window.open(child.url, "_blank")
    })
    popover.appendChild(btn)
  }

  if (folder.children.length === 0) {
    const empty = document.createElement("span")
    empty.className = "text-white/50 text-xs px-3 py-1"
    empty.textContent = "Empty folder"
    popover.appendChild(empty)
  }

  document.body.appendChild(popover)
  const rect = anchor.getBoundingClientRect()
  popover.style.left = rect.left + "px"
  popover.style.bottom = (window.innerHeight - rect.top + 4) + "px"
  openPopover = popover

  const onClickOutside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && e.target !== anchor) {
      closeDockPopover()
      document.removeEventListener("click", onClickOutside)
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
}

function render(): void {
  const dock = document.getElementById("dock") as HTMLElement
  const tabsContainer = document.getElementById("dock-tabs") as HTMLElement
  const itemsContainer = document.getElementById("dock-items") as HTMLElement
  const tabs = getTabs()

  closeDockPopover()

  if (tabs.length === 0) {
    dock.hidden = true
    return
  }

  dock.hidden = false

  if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id
  }

  tabsContainer.innerHTML = ""
  for (const tab of tabs) {
    const btn = document.createElement("button")
    btn.className =
      "px-2 py-1 rounded text-xs text-white " +
      (tab.id === activeTabId
        ? "bg-white/30 font-semibold"
        : "hover:bg-white/20")
    btn.textContent = tab.name
    btn.addEventListener("click", () => {
      activeTabId = tab.id
      render()
    })
    tabsContainer.appendChild(btn)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)!
  itemsContainer.innerHTML = ""
  for (const item of activeTab.items) {
    itemsContainer.appendChild(renderDockItem(item))
  }
}

export function initDock(): void {
  render()
  store.local.subscribe("shortcuts", render)
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/dock.ts
git commit -m "feat: add dock UI with tab selector and folder popovers"
```

---

### Task 5: Settings UI — Tab Management and Prompt Dialog

**Files:**
- Create: `src/shortcut-settings.ts`

This task creates the settings module with tab management and the reusable prompt dialog. Item list and drag-and-drop follow in later tasks.

- [ ] **Step 1: Create `src/shortcut-settings.ts` with prompt dialog helper and tab management**

```ts
import { store } from "./store"
import type { Tab, TabItem, Folder, Shortcut } from "./shortcuts"
import {
  addTab,
  deleteTab,
  addShortcut,
  addFolder,
  deleteItem,
  editShortcut,
  editFolder,
  addShortcutToFolder,
  deleteShortcutFromFolder,
  editShortcutInFolder,
  reorderItems,
  reorderFolderChildren,
  moveShortcutIntoFolder,
  mergeShortcutsIntoNewFolder,
  MAX_TABS,
  MAX_ITEMS_PER_TAB,
  MAX_CHILDREN_PER_FOLDER,
} from "./shortcuts"

let selectedTabId: string | null = null
let viewingFolderId: string | null = null

function getTabs(): Tab[] {
  return store.local.get("shortcuts")
}

function save(tabs: Tab[]): void {
  store.local.set("shortcuts", tabs)
}

function prompt(
  title: string,
  fields: { name?: string; url?: string; showUrl?: boolean }
): Promise<{ name: string; url: string } | null> {
  return new Promise((resolve) => {
    const dialog = document.getElementById(
      "sc-prompt-dialog"
    ) as HTMLDialogElement
    const titleEl = document.getElementById(
      "sc-prompt-title"
    ) as HTMLHeadingElement
    const nameInput = document.getElementById(
      "sc-prompt-name"
    ) as HTMLInputElement
    const urlInput = document.getElementById(
      "sc-prompt-url"
    ) as HTMLInputElement
    const cancelBtn = document.getElementById(
      "sc-prompt-cancel"
    ) as HTMLButtonElement
    const form = dialog.querySelector("form") as HTMLFormElement

    titleEl.textContent = title
    nameInput.value = fields.name ?? ""
    urlInput.value = fields.url ?? ""
    urlInput.hidden = !fields.showUrl
    urlInput.required = !!fields.showUrl

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
      resolve({ name: nameInput.value.trim(), url: urlInput.value.trim() })
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
    nameInput.focus()
  })
}

function renderList(): void {
  const list = document.getElementById("sc-list") as HTMLElement
  const addShortcutBtn = document.getElementById(
    "sc-add-shortcut"
  ) as HTMLButtonElement
  const addFolderBtn = document.getElementById(
    "sc-add-folder"
  ) as HTMLButtonElement
  const deleteTabBtn = document.getElementById(
    "sc-delete-tab"
  ) as HTMLButtonElement
  const backBtn = document.getElementById("sc-back") as HTMLButtonElement
  const tabSelect = document.getElementById(
    "sc-tab-select"
  ) as HTMLSelectElement

  const tabs = getTabs()
  const tab = tabs.find((t) => t.id === selectedTabId)

  list.innerHTML = ""

  if (!tab) {
    addShortcutBtn.hidden = true
    addFolderBtn.hidden = true
    deleteTabBtn.hidden = true
    backBtn.hidden = true
    return
  }

  const inFolder = viewingFolderId !== null
  const folder = inFolder
    ? (tab.items.find(
        (i) => i.id === viewingFolderId && i.type === "folder"
      ) as Folder | undefined)
    : null

  if (inFolder && !folder) {
    viewingFolderId = null
    renderList()
    return
  }

  tabSelect.hidden = inFolder
  backBtn.hidden = !inFolder
  deleteTabBtn.hidden = inFolder
  addShortcutBtn.hidden = false
  addFolderBtn.hidden = inFolder

  const items: (TabItem | Shortcut)[] = inFolder
    ? folder!.children
    : tab.items

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const row = document.createElement("div")
    row.className =
      "flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-sm group"
    row.draggable = true
    row.dataset.index = String(i)
    row.dataset.id = item.id
    row.dataset.type = item.type

    const handle = document.createElement("span")
    handle.className = "cursor-grab text-gray-400"
    handle.textContent = "\u2630"
    row.appendChild(handle)

    const label = document.createElement("span")
    label.className = "flex-1 truncate"
    if (item.type === "folder") {
      label.textContent = "\uD83D\uDCC1 " + item.name
    } else {
      label.textContent = item.name
      if (item.url) {
        const urlSpan = document.createElement("span")
        urlSpan.className = "text-gray-400 ml-1 text-xs"
        urlSpan.textContent = item.url
        label.appendChild(urlSpan)
      }
    }
    row.appendChild(label)

    if (item.type === "folder" && !inFolder) {
      const openBtn = document.createElement("button")
      openBtn.className = "text-xs text-blue-500 hover:underline"
      openBtn.textContent = "Open"
      openBtn.addEventListener("click", () => {
        viewingFolderId = item.id
        renderList()
      })
      row.appendChild(openBtn)
    }

    const editBtn = document.createElement("button")
    editBtn.className = "text-xs text-blue-500 hover:underline"
    editBtn.textContent = "Edit"
    editBtn.addEventListener("click", async () => {
      const isShortcut = item.type === "shortcut"
      const result = await prompt(isShortcut ? "Edit Shortcut" : "Edit Folder", {
        name: item.name,
        url: isShortcut ? item.url : undefined,
        showUrl: isShortcut,
      })
      if (!result) return
      let tabs = getTabs()
      if (inFolder && folder) {
        tabs = editShortcutInFolder(
          tabs,
          selectedTabId!,
          folder.id,
          item.id,
          result.name,
          result.url
        )
      } else if (isShortcut) {
        tabs = editShortcut(
          tabs,
          selectedTabId!,
          item.id,
          result.name,
          result.url
        )
      } else {
        tabs = editFolder(tabs, selectedTabId!, item.id, result.name)
      }
      save(tabs)
    })
    row.appendChild(editBtn)

    const delBtn = document.createElement("button")
    delBtn.className = "text-xs text-red-500 hover:underline"
    delBtn.textContent = "Delete"
    delBtn.addEventListener("click", () => {
      let tabs = getTabs()
      if (inFolder && folder) {
        tabs = deleteShortcutFromFolder(
          tabs,
          selectedTabId!,
          folder.id,
          item.id
        )
      } else {
        tabs = deleteItem(tabs, selectedTabId!, item.id)
      }
      save(tabs)
    })
    row.appendChild(delBtn)

    list.appendChild(row)
  }

  initDragAndDrop(list, inFolder, folder)
}

function initDragAndDrop(
  list: HTMLElement,
  inFolder: boolean,
  folder: Folder | null
): void {
  let dragIndex: number | null = null
  let dragType: string | null = null
  let preDropSnapshot: Tab[] | null = null

  list.addEventListener("dragstart", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-index]") as HTMLElement
    if (!row) return
    dragIndex = Number(row.dataset.index)
    dragType = row.dataset.type ?? null
    preDropSnapshot = getTabs()
    row.classList.add("opacity-50")
    e.dataTransfer!.effectAllowed = "move"
  })

  list.addEventListener("dragend", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest("[data-index]") as HTMLElement
    if (row) row.classList.remove("opacity-50")
    dragIndex = null
    dragType = null
    preDropSnapshot = null
    list
      .querySelectorAll("[data-index]")
      .forEach((el) =>
        el.classList.remove(
          "border-t-2",
          "border-blue-500",
          "bg-blue-100",
          "bg-amber-100",
          "bg-red-300"
        )
      )
  })

  list.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    const row = (e.target as HTMLElement).closest("[data-index]") as HTMLElement
    if (!row) return

    list
      .querySelectorAll("[data-index]")
      .forEach((el) =>
        el.classList.remove(
          "border-t-2",
          "border-blue-500",
          "bg-blue-100",
          "bg-amber-100",
          "bg-red-300"
        )
      )

    const targetIndex = Number(row.dataset.index)
    const targetType = row.dataset.type

    if (dragType === "folder" || inFolder) {
      row.classList.add("border-t-2", "border-blue-500")
      return
    }

    const rect = row.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const overCenter = Math.abs(e.clientY - midY) < rect.height * 0.25

    if (overCenter && targetIndex !== dragIndex) {
      if (targetType === "folder") {
        const tabs = getTabs()
        const tab = tabs.find((t) => t.id === selectedTabId)
        const targetFolder = tab?.items[targetIndex] as Folder | undefined
        if (
          targetFolder &&
          targetFolder.children.length >= MAX_CHILDREN_PER_FOLDER
        ) {
          row.classList.add("bg-red-300")
        } else {
          row.classList.add("bg-blue-100")
        }
      } else if (targetType === "shortcut") {
        row.classList.add("bg-amber-100")
      }
    } else {
      row.classList.add("border-t-2", "border-blue-500")
    }
  })

  list.addEventListener("drop", async (e: DragEvent) => {
    e.preventDefault()
    if (dragIndex === null) return

    const row = (e.target as HTMLElement).closest("[data-index]") as HTMLElement
    if (!row) return

    const targetIndex = Number(row.dataset.index)
    const targetType = row.dataset.type
    const targetId = row.dataset.id!
    let tabs = getTabs()
    const tab = tabs.find((t) => t.id === selectedTabId)
    if (!tab) return

    const draggedItem = (inFolder ? folder!.children : tab.items)[dragIndex]

    if (dragType === "folder" || inFolder) {
      if (inFolder && folder) {
        tabs = reorderFolderChildren(
          tabs,
          selectedTabId!,
          folder.id,
          dragIndex,
          targetIndex
        )
      } else {
        tabs = reorderItems(tabs, selectedTabId!, dragIndex, targetIndex)
      }
      save(tabs)
      return
    }

    const rect = row.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const overCenter = Math.abs(e.clientY - midY) < rect.height * 0.25

    if (overCenter && targetIndex !== dragIndex) {
      if (targetType === "folder") {
        const targetFolder = tab.items[targetIndex] as Folder
        if (targetFolder.children.length >= MAX_CHILDREN_PER_FOLDER) return
        tabs = moveShortcutIntoFolder(
          tabs,
          selectedTabId!,
          draggedItem.id,
          targetId
        )
        save(tabs)
      } else if (targetType === "shortcut") {
        const result = await prompt("Create Folder", {
          name: "New Folder",
          showUrl: false,
        })
        if (!result) {
          if (preDropSnapshot) save(preDropSnapshot)
          return
        }
        tabs = mergeShortcutsIntoNewFolder(
          tabs,
          selectedTabId!,
          targetId,
          draggedItem.id,
          result.name
        )
        save(tabs)
      }
    } else {
      tabs = reorderItems(tabs, selectedTabId!, dragIndex, targetIndex)
      save(tabs)
    }
  })
}

function updateTabSelect(): void {
  const select = document.getElementById(
    "sc-tab-select"
  ) as HTMLSelectElement
  const addTabBtn = document.getElementById(
    "sc-add-tab"
  ) as HTMLButtonElement
  const tabs = getTabs()

  select.innerHTML = ""

  if (tabs.length === 0) {
    const opt = document.createElement("option")
    opt.textContent = "No tabs"
    opt.disabled = true
    opt.selected = true
    select.appendChild(opt)
    selectedTabId = null
  } else {
    if (!selectedTabId || !tabs.find((t) => t.id === selectedTabId)) {
      selectedTabId = tabs[0].id
    }
    for (const tab of tabs) {
      const opt = document.createElement("option")
      opt.value = tab.id
      opt.textContent = tab.name
      opt.selected = tab.id === selectedTabId
      select.appendChild(opt)
    }
  }

  addTabBtn.hidden = tabs.length >= MAX_TABS

  viewingFolderId = null
  renderList()
}

export function initShortcutSettings(): void {
  const tabSelect = document.getElementById(
    "sc-tab-select"
  ) as HTMLSelectElement
  const addTabBtn = document.getElementById(
    "sc-add-tab"
  ) as HTMLButtonElement
  const deleteTabBtn = document.getElementById(
    "sc-delete-tab"
  ) as HTMLButtonElement
  const addShortcutBtn = document.getElementById(
    "sc-add-shortcut"
  ) as HTMLButtonElement
  const addFolderBtn = document.getElementById(
    "sc-add-folder"
  ) as HTMLButtonElement
  const backBtn = document.getElementById("sc-back") as HTMLButtonElement

  tabSelect.addEventListener("change", () => {
    selectedTabId = tabSelect.value
    viewingFolderId = null
    renderList()
  })

  addTabBtn.addEventListener("click", async () => {
    const result = await prompt("Add Tab", {
      name: "New Tab",
      showUrl: false,
    })
    if (!result) return
    const tabs = addTab(getTabs(), result.name)
    save(tabs)
    selectedTabId = tabs[tabs.length - 1].id
    updateTabSelect()
  })

  deleteTabBtn.addEventListener("click", () => {
    if (!selectedTabId) return
    const tabs = deleteTab(getTabs(), selectedTabId)
    save(tabs)
    selectedTabId = tabs.length > 0 ? tabs[0].id : null
    updateTabSelect()
  })

  addShortcutBtn.addEventListener("click", async () => {
    if (!selectedTabId) return
    const isInFolder = viewingFolderId !== null
    const result = await prompt("Add Shortcut", {
      name: "",
      url: "",
      showUrl: true,
    })
    if (!result) return
    let tabs = getTabs()
    if (isInFolder) {
      tabs = addShortcutToFolder(
        tabs,
        selectedTabId,
        viewingFolderId!,
        result.name,
        result.url
      )
    } else {
      tabs = addShortcut(tabs, selectedTabId, result.name, result.url)
    }
    save(tabs)
  })

  addFolderBtn.addEventListener("click", async () => {
    if (!selectedTabId) return
    const result = await prompt("Add Folder", {
      name: "New Folder",
      showUrl: false,
    })
    if (!result) return
    const tabs = addFolder(getTabs(), selectedTabId, result.name)
    save(tabs)
  })

  backBtn.addEventListener("click", () => {
    viewingFolderId = null
    renderList()
  })

  updateTabSelect()
  store.local.subscribe("shortcuts", () => {
    updateTabSelect()
  })
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shortcut-settings.ts
git commit -m "feat: add shortcut settings UI with CRUD and drag-and-drop"
```

---

### Task 6: Wire Up Entry Point

**Files:**
- Modify: `src/index.ts:1-16`

- [ ] **Step 1: Update `src/index.ts` to import and initialize dock and shortcut settings**

Add imports for `initDock` from `dock.ts` and `initShortcutSettings` from `shortcut-settings.ts`. Call both inside the `DOMContentLoaded` handler after `store.init()`.

```ts
import { store } from "./store";
import { applyBgColor, initSettings } from "./settings";
import { initDock } from "./dock";
import { initShortcutSettings } from "./shortcut-settings";

applyBgColor(store.sync.get("bgColor"));
store.sync.subscribe("bgColor", applyBgColor);

document.addEventListener("DOMContentLoaded", async () => {
  await store.init();
  initSettings();
  initDock();
  initShortcutSettings();
});
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Build complete with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up dock and shortcut settings initialization"
```

---

### Task 7: Manual Smoke Test

No automated test framework exists in this project. Verify functionality by loading the extension in the browser.

- [ ] **Step 1: Build the extension**

Run: `./build.sh`
Expected: `dist/` directory contains `index.html`, `index.js`, `styles.css`, `manifest.json`.

- [ ] **Step 2: Load in browser and verify empty state**

Load `dist/` as an unpacked extension. Open a new tab.
Expected: Dock is hidden (no tabs). Settings gear icon visible. Open settings — shortcuts section shows "No tabs" in dropdown and "Add Tab" button.

- [ ] **Step 3: Test tab creation**

Click "Add Tab", enter name, save.
Expected: Tab appears in dropdown and in dock tab selector. "Add Shortcut" and "Add Folder" buttons appear.

- [ ] **Step 4: Test shortcut creation and dock display**

Add a shortcut with name and URL.
Expected: Shortcut appears in settings list and in dock. Clicking shortcut in dock opens URL in new tab.

- [ ] **Step 5: Test folder creation and popover**

Add a folder, then drag a shortcut onto the folder in settings.
Expected: Shortcut moves into folder. Folder in dock shows popover on click with the shortcut inside.

- [ ] **Step 6: Test drag-and-drop reordering**

Add multiple shortcuts. Drag to reorder.
Expected: Items reorder correctly. Order persists after page reload.

- [ ] **Step 7: Test shortcut merge into new folder**

Drag a shortcut over another shortcut (center).
Expected: Prompt to create folder. On confirm, both shortcuts are inside the new folder.

- [ ] **Step 8: Test folder capacity indicator**

Fill a folder to 64 shortcuts. Drag another shortcut over it.
Expected: Folder shows red background. Drop is blocked.

- [ ] **Step 9: Fix any issues found, rebuild, re-test, and commit**

```bash
git add -A
git commit -m "fix: address issues from manual smoke test"
```
