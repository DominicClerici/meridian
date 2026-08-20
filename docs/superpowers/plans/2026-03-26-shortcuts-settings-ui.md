# Shortcuts Settings UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shortcuts settings tab's dropdown/toolbar UI with a visual tab bar, 3-column grid with folder expansion, bottom control bar, and multi-select mode.

**Architecture:** Composable render functions (`renderTabBar`, `renderItemList`, `renderControlBar`) coordinated by a single `render()`. Module-level state drives all rendering. Popover-based add/edit forms replace the modal dialog. All styling via existing design system tokens.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4, existing component library (`createButton`, `createInput`, `createPopover`, `createDialog`, `createCheckbox`)

---

### Task 1: Register New Icons

**Files:**
- Modify: `src/icons/modern.ts:59` (before the closing `}` of the icons object)

- [ ] **Step 1: Add Feather icon SVGs to the modern theme**

Add these four entries to the `icons` object in `src/icons/modern.ts`, before the closing brace on line 59:

```ts
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,

  folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,

  chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,

  tab: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`,
```

- [ ] **Step 2: Build and verify no errors**

Run: `./build.sh`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/icons/modern.ts
git commit -m "feat: register link, folder, chevronLeft, tab icons from Feather"
```

---

### Task 2: Update MAX_TABS and Add Batch Delete

**Files:**
- Modify: `src/shortcuts.ts:23` (MAX_TABS constant)
- Modify: `src/shortcuts.ts` (add `deleteItems` function at end of file)

- [ ] **Step 1: Change MAX_TABS from 10 to 6**

In `src/shortcuts.ts`, change line 23:

```ts
// old
export const MAX_TABS = 10

// new
export const MAX_TABS = 6
```

- [ ] **Step 2: Add the deleteItems batch function**

Add this function at the end of `src/shortcuts.ts` (after the `mergeShortcutsIntoNewFolder` function, before end of file):

```ts
export function deleteItems(
  tabs: Tab[],
  tabId: string,
  itemIds: string[]
): Tab[] {
  const idSet = new Set(itemIds)
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items
        .filter((i) => !idSet.has(i.id))
        .map((i) => {
          if (i.type !== "folder") return i
          return {
            ...i,
            children: i.children.filter((c) => !idSet.has(c.id)),
          }
        }),
    }
  })
}
```

- [ ] **Step 3: Build and verify**

Run: `./build.sh`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/shortcuts.ts
git commit -m "feat: change MAX_TABS to 6, add deleteItems batch function"
```

---

### Task 3: Update Panel Structure in settings.ts

**Files:**
- Modify: `src/settings.ts:600-662` (replace `buildShortcutsPanel` function)

The new panel emits three container divs (tab bar, item list, control bar) instead of the old dropdown/toolbar layout. The `shortcut-settings.ts` rewrite (Task 5) will populate these containers.

- [ ] **Step 1: Replace buildShortcutsPanel**

Replace the entire `buildShortcutsPanel` function (lines 600-662) in `src/settings.ts` with:

```ts
function buildShortcutsPanel(): HTMLDivElement {
  const panel = document.createElement("div")
  panel.dataset.settingsTab = "shortcuts"
  panel.className = "settings-panel flex flex-col h-full"
  panel.hidden = true

  const tabBar = document.createElement("div")
  tabBar.id = "sc-tab-bar"
  tabBar.className = "flex items-center gap-1.5 px-6 pt-4 pb-3 shrink-0"
  panel.appendChild(tabBar)

  const itemList = document.createElement("div")
  itemList.id = "sc-item-list"
  itemList.className = "flex-1 overflow-y-auto px-6"
  panel.appendChild(itemList)

  const controlBar = document.createElement("div")
  controlBar.id = "sc-control-bar"
  controlBar.className = "flex items-center justify-between px-6 py-3 shrink-0 border-t border-input-border/15"
  panel.appendChild(controlBar)

  const recsRow = document.createElement("div")
  recsRow.className = "flex items-center gap-2 px-6 pb-4 pt-1 border-t border-input-border/15"

  const recsInput = document.createElement("input")
  recsInput.type = "checkbox"
  recsInput.id = "settings-recommendations-enabled"
  recsInput.className = "rounded accent-accent shrink-0"
  recsRow.appendChild(recsInput)

  const recsLabel = document.createElement("label")
  recsLabel.htmlFor = "settings-recommendations-enabled"
  recsLabel.className = "text-sm"
  recsLabel.textContent = "Show smart suggestions in dock"
  recsRow.appendChild(recsLabel)

  panel.appendChild(recsRow)

  return panel
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Build succeeds. The old `sc-controls`, `sc-list`, `sc-tab-select`, recommendations checkbox, and import button elements are gone from the panel. The `shortcut-settings.ts` will fail to find some old element IDs — that's expected and will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "refactor: replace shortcuts panel structure with tab-bar/item-list/control-bar layout"
```

---

### Task 4: Remove Old Prompt Dialog from HTML

**Files:**
- Modify: `src/index.html:87-123` (remove `sc-prompt-dialog`)

- [ ] **Step 1: Remove the sc-prompt-dialog element**

Delete lines 87-123 from `src/index.html` — the entire `<dialog id="sc-prompt-dialog">` element and its contents:

```html
    <dialog
      id="sc-prompt-dialog"
      class="rounded-xl p-0 backdrop:bg-page-overlay/50 bg-panel text-foreground"
    >
      <form method="dialog" class="p-4 min-w-[260px] flex flex-col gap-3">
        <h3 id="sc-prompt-title" class="text-sm font-semibold"></h3>
        <input
          id="sc-prompt-name"
          type="text"
          placeholder="Name"
          class="text-sm rounded px-2 py-1 border border-input-border bg-input"
          required
        />
        <input
          id="sc-prompt-url"
          type="text"
          placeholder="URL"
          class="text-sm rounded px-2 py-1 border border-input-border bg-input"
        />
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            id="sc-prompt-cancel"
            class="text-xs px-3 py-1 rounded bg-secondary hover:bg-secondary-hover text-secondary-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="sc-prompt-save"
            class="text-xs px-3 py-1 rounded bg-accent text-accent-foreground hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "refactor: remove sc-prompt-dialog, replaced by popovers"
```

---

### Task 5: Rewrite shortcut-settings.ts — State, Helpers, and Render Coordinator

**Files:**
- Rewrite: `src/shortcut-settings.ts` (complete replacement)

This is the largest task. It replaces the entire file with the new architecture. We build it in steps within a single file write.

- [ ] **Step 1: Write the complete shortcut-settings.ts**

Replace the entire contents of `src/shortcut-settings.ts` with the following. This is a complete file — read through it fully before writing.

```ts
import { store } from "./store"
import type { Tab, TabItem, Folder, Shortcut } from "./shortcuts"
import {
  addTab,
  deleteTab,
  addShortcut,
  addFolder,
  deleteItem,
  deleteItems,
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
  MAX_CHILDREN_PER_FOLDER,
} from "./shortcuts"
import { createButton, createInput, createCheckbox, createPopover, createDialog } from "./components"
import { icon } from "./icons/registry"

let selectedTabId: string | null = null
let viewingFolderId: string | null = null
let selectionMode = false
let selectedIds = new Set<string>()

let tabBarEl: HTMLElement
let itemListEl: HTMLElement
let controlBarEl: HTMLElement

function getTabs(): Tab[] {
  return store.local.get("shortcuts")
}

function save(tabs: Tab[]): void {
  store.local.set("shortcuts", tabs)
}

function render(): void {
  renderTabBar()
  renderItemList()
  renderControlBar()
}

// ---------- Popover Forms ----------

function openAddShortcutPopover(anchor: HTMLElement): void {
  const container = document.createElement("div")
  container.className = "flex flex-col gap-2 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = "Add Shortcut"
  container.appendChild(title)

  const nameInput = createInput({ placeholder: "Name" })
  container.appendChild(nameInput)

  const urlInput = createInput({ placeholder: "https://..." })
  container.appendChild(urlInput)

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container)

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    const url = (urlInput as HTMLInputElement).value.trim()
    if (!name || !url) return
    let tabs = getTabs()
    if (viewingFolderId) {
      tabs = addShortcutToFolder(tabs, selectedTabId!, viewingFolderId, name, url)
    } else {
      tabs = addShortcut(tabs, selectedTabId!, name, url)
    }
    save(tabs)
    close()
  }

  saveBtn.addEventListener("click", submit)
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit() }
    if (e.key === "Escape") close()
  })
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close()
  })

  requestAnimationFrame(() => (nameInput as HTMLInputElement).focus())
}

function openAddFolderPopover(anchor: HTMLElement): void {
  const container = document.createElement("div")
  container.className = "flex flex-col gap-2 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = "Add Folder"
  container.appendChild(title)

  const nameInput = createInput({ placeholder: "Folder name", value: "New Folder" })
  container.appendChild(nameInput)

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container)

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    if (!name) return
    const tabs = addFolder(getTabs(), selectedTabId!, name)
    save(tabs)
    close()
  }

  saveBtn.addEventListener("click", submit)
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit() }
    if (e.key === "Escape") close()
  })

  requestAnimationFrame(() => {
    const input = nameInput as HTMLInputElement
    input.focus()
    input.select()
  })
}

function openEditPopover(anchor: HTMLElement, item: TabItem | Shortcut, inFolder: boolean, folder: Folder | null): void {
  const isShortcut = item.type === "shortcut"
  const container = document.createElement("div")
  container.className = "flex flex-col gap-2 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = isShortcut ? "Edit Shortcut" : "Edit Folder"
  container.appendChild(title)

  const nameInput = createInput({ placeholder: "Name", value: item.name })
  container.appendChild(nameInput)

  let urlInput: HTMLInputElement | HTMLTextAreaElement | null = null
  if (isShortcut) {
    urlInput = createInput({ placeholder: "https://...", value: (item as Shortcut).url })
    container.appendChild(urlInput)
  }

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container)

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    if (!name) return
    let tabs = getTabs()
    if (isShortcut) {
      const url = (urlInput as HTMLInputElement).value.trim()
      if (!url) return
      if (inFolder && folder) {
        tabs = editShortcutInFolder(tabs, selectedTabId!, folder.id, item.id, name, url)
      } else {
        tabs = editShortcut(tabs, selectedTabId!, item.id, name, url)
      }
    } else {
      tabs = editFolder(tabs, selectedTabId!, item.id, name)
    }
    save(tabs)
    close()
  }

  const lastInput = urlInput ?? nameInput
  saveBtn.addEventListener("click", submit)
  lastInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit() }
    if (e.key === "Escape") close()
  })
  if (urlInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close()
    })
  }

  requestAnimationFrame(() => (nameInput as HTMLInputElement).focus())
}

// ---------- Tab Bar ----------

function renderTabBar(): void {
  tabBarEl.innerHTML = ""
  const tabs = getTabs()

  for (const tab of tabs) {
    const isActive = tab.id === selectedTabId
    const pill = document.createElement("div")
    pill.className = `relative flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm cursor-pointer transition-colors group ${
      isActive
        ? "bg-accent text-accent-foreground"
        : "bg-surface text-foreground hover:bg-surface"
    }`

    if (selectionMode) {
      pill.style.opacity = "0.4"
      pill.style.pointerEvents = "none"
    }

    const tabIcon = icon("tab", { size: 12 })
    tabIcon.classList.add("shrink-0")
    if (isActive) tabIcon.classList.add("text-accent-foreground")
    pill.appendChild(tabIcon)

    const nameInput = document.createElement("input")
    nameInput.type = "text"
    nameInput.value = tab.name
    nameInput.className = `bg-transparent border-none outline-none font-medium text-sm ${
      isActive ? "text-accent-foreground" : "text-foreground"
    }`
    nameInput.style.width = `${Math.max(tab.name.length, 1)}ch`
    nameInput.readOnly = !isActive

    nameInput.addEventListener("input", () => {
      nameInput.style.width = `${Math.max(nameInput.value.length, 1)}ch`
    })

    nameInput.addEventListener("focus", () => {
      if (isActive) nameInput.select()
    })

    nameInput.addEventListener("blur", () => {
      const newName = nameInput.value.trim()
      if (newName && newName !== tab.name) {
        let tabs = getTabs()
        tabs = tabs.map((t) => (t.id === tab.id ? { ...t, name: newName } : t))
        save(tabs)
      }
    })

    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        nameInput.blur()
      }
    })

    pill.addEventListener("click", (e) => {
      if (e.target === nameInput && isActive) return
      if (!isActive) {
        selectedTabId = tab.id
        viewingFolderId = null
        render()
      }
    })

    pill.appendChild(nameInput)

    const closeBtn = document.createElement("button")
    closeBtn.className = "absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-danger text-danger-foreground opacity-0 group-hover:opacity-100 transition-opacity"
    closeBtn.appendChild(icon("close", { size: 8 }))
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      let tabs = deleteTab(getTabs(), tab.id)
      save(tabs)
      if (selectedTabId === tab.id) {
        selectedTabId = tabs.length > 0 ? tabs[0].id : null
        viewingFolderId = null
      }
      render()
    })
    pill.appendChild(closeBtn)

    tabBarEl.appendChild(pill)
  }

  if (tabs.length < MAX_TABS && !selectionMode) {
    const addBtn = createButton("", "ghost", { icon: icon("plus", { size: 12 }) })
    addBtn.className = "w-8 h-8 flex items-center justify-center rounded-theme border border-dashed border-input-border text-muted hover:text-foreground hover:border-accent transition-colors"
    addBtn.addEventListener("click", () => {
      const tabs = addTab(getTabs(), `Tab ${getTabs().length + 1}`)
      save(tabs)
      selectedTabId = tabs[tabs.length - 1].id
      viewingFolderId = null
      render()

      requestAnimationFrame(() => {
        const lastPill = tabBarEl.querySelector(`div:nth-child(${tabs.length})`)
        const input = lastPill?.querySelector("input") as HTMLInputElement | null
        if (input) {
          input.readOnly = false
          input.focus()
          input.select()
        }
      })
    })
    tabBarEl.appendChild(addBtn)
  }
}

// ---------- Item List ----------

function createRow(
  item: TabItem | Shortcut,
  index: number,
  inFolder: boolean,
  folder: Folder | null,
  compact: boolean
): HTMLElement {
  const row = document.createElement("div")
  row.className = `flex items-center gap-2 px-2 py-1.5 rounded-theme text-sm group transition-colors hover:bg-surface ${
    compact ? "text-xs" : ""
  }`
  row.dataset.index = String(index)
  row.dataset.id = item.id
  row.dataset.type = item.type

  if (!selectionMode) {
    row.draggable = true

    const handle = document.createElement("span")
    handle.className = "cursor-grab text-muted shrink-0"
    handle.appendChild(icon("dragHandle", { size: 10 }))
    row.appendChild(handle)
  }

  if (selectionMode) {
    const cb = createCheckbox("", selectedIds.has(item.id), (checked) => {
      if (checked) selectedIds.add(item.id)
      else selectedIds.delete(item.id)
      renderControlBar()
    })
    cb.classList.add("shrink-0")
    row.appendChild(cb)

    row.style.cursor = "pointer"
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("label")) return
      const input = cb.querySelector("input") as HTMLInputElement
      input.checked = !input.checked
      input.dispatchEvent(new Event("change"))
    })
  }

  const itemIcon = icon(item.type === "folder" ? "folder" : "link", { size: compact ? 12 : 14 })
  itemIcon.classList.add("shrink-0", "text-muted")
  row.appendChild(itemIcon)

  const label = document.createElement("div")
  label.className = "flex-1 min-w-0 truncate"

  const nameSpan = document.createElement("span")
  nameSpan.className = "truncate"
  nameSpan.textContent = item.name
  label.appendChild(nameSpan)

  if (item.type === "shortcut" && !compact) {
    const urlSpan = document.createElement("span")
    urlSpan.className = "text-muted text-xs ml-1.5"
    urlSpan.textContent = item.url
    label.appendChild(urlSpan)
  }
  row.appendChild(label)

  if (!selectionMode) {
    const editBtn = createButton("", "ghost", { icon: icon("edit", { size: 12 }) })
    editBtn.className = "shrink-0 w-6 h-6 flex items-center justify-center rounded-theme text-muted hover:text-foreground hover:bg-surface transition-colors opacity-0 group-hover:opacity-100"
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      openEditPopover(editBtn, item, inFolder, folder)
    })
    row.appendChild(editBtn)

    const delBtn = createButton("", "ghost", { icon: icon("trash", { size: 12 }) })
    delBtn.className = "shrink-0 w-6 h-6 flex items-center justify-center rounded-theme text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      let tabs = getTabs()
      if (inFolder && folder) {
        tabs = deleteShortcutFromFolder(tabs, selectedTabId!, folder.id, item.id)
      } else {
        tabs = deleteItem(tabs, selectedTabId!, item.id)
      }
      save(tabs)
    })
    row.appendChild(delBtn)
  }

  return row
}

function renderItemList(): void {
  itemListEl.innerHTML = ""
  const tabs = getTabs()
  const tab = tabs.find((t) => t.id === selectedTabId)

  if (!tab) {
    const empty = document.createElement("div")
    empty.className = "flex items-center justify-center h-full text-sm text-muted"
    empty.textContent = "Create a tab to get started"
    itemListEl.appendChild(empty)
    return
  }

  const inFolder = viewingFolderId !== null
  const folder = inFolder
    ? (tab.items.find((i) => i.id === viewingFolderId && i.type === "folder") as Folder | undefined)
    : null

  if (inFolder && !folder) {
    viewingFolderId = null
    renderItemList()
    return
  }

  if (!inFolder) {
    const list = document.createElement("div")
    list.className = "grid grid-cols-3 gap-1"

    if (tab.items.length === 0) {
      const empty = document.createElement("div")
      empty.className = "col-span-3 flex items-center justify-center py-8 text-sm text-muted"
      empty.textContent = "No shortcuts yet"
      list.appendChild(empty)
    }

    for (let i = 0; i < tab.items.length; i++) {
      const item = tab.items[i]
      const row = createRow(item, i, false, null, false)
      row.className += " col-span-3"

      if (item.type === "folder" && !selectionMode) {
        row.style.cursor = "pointer"
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("button")) return
          viewingFolderId = item.id
          render()
        })
      }

      list.appendChild(row)
    }

    itemListEl.appendChild(list)
    if (!selectionMode) initDragAndDrop(list, false, null)
  } else {
    const grid = document.createElement("div")
    grid.className = "grid grid-cols-3 gap-3 h-full"

    const leftCol = document.createElement("div")
    leftCol.className = "col-span-1 flex flex-col gap-0.5 overflow-y-auto"

    for (let i = 0; i < tab.items.length; i++) {
      const item = tab.items[i]
      const row = createRow(item, i, false, null, true)

      if (item.id === viewingFolderId) {
        row.className += " border-l-2 border-accent bg-accent/10"
      }

      if (item.type === "folder" && !selectionMode) {
        row.style.cursor = "pointer"
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("button")) return
          if (item.id === viewingFolderId) {
            viewingFolderId = null
          } else {
            viewingFolderId = item.id
          }
          render()
        })
      }

      leftCol.appendChild(row)
    }

    const rightCol = document.createElement("div")
    rightCol.className = "col-span-2 flex flex-col gap-0.5 overflow-y-auto border-l border-input-border/20 pl-3"

    if (folder!.children.length === 0) {
      const empty = document.createElement("div")
      empty.className = "flex items-center justify-center h-full text-sm text-muted"
      empty.textContent = "Empty folder"
      rightCol.appendChild(empty)
    }

    for (let i = 0; i < folder!.children.length; i++) {
      const child = folder!.children[i]
      const row = createRow(child, i, true, folder!, false)
      rightCol.appendChild(row)
    }

    grid.appendChild(leftCol)
    grid.appendChild(rightCol)
    itemListEl.appendChild(grid)

    if (!selectionMode) {
      initDragAndDrop(leftCol, false, null)
      initDragAndDrop(rightCol, true, folder!)
    }
  }
}

// ---------- Control Bar ----------

function renderControlBar(): void {
  controlBarEl.innerHTML = ""

  const left = document.createElement("div")
  left.className = "flex items-center gap-2"

  const right = document.createElement("div")
  right.className = "flex items-center gap-2"

  if (viewingFolderId) {
    const backBtn = createButton("", "ghost", { icon: icon("chevronLeft", { size: 14 }) })
    backBtn.className = "w-8 h-8 flex items-center justify-center rounded-theme text-muted hover:text-foreground hover:bg-surface transition-colors"
    if (selectionMode) {
      backBtn.disabled = true
      backBtn.style.opacity = "0.4"
    } else {
      backBtn.addEventListener("click", () => {
        viewingFolderId = null
        render()
      })
    }
    left.appendChild(backBtn)
  }

  if (!selectionMode) {
    if (selectedTabId) {
      const addShortcutBtn = createButton("Add Shortcut", "primary", {
        icon: icon("plus", { size: 12 }),
      })
      addShortcutBtn.addEventListener("click", () => {
        openAddShortcutPopover(addShortcutBtn)
      })
      right.appendChild(addShortcutBtn)

      if (!viewingFolderId) {
        const addFolderBtn = createButton("Add Folder", "outline", {
          icon: icon("plus", { size: 12 }),
        })
        addFolderBtn.addEventListener("click", () => {
          openAddFolderPopover(addFolderBtn)
        })
        right.appendChild(addFolderBtn)
      }

      const selectManyBtn = createButton("Select", "ghost")
      selectManyBtn.addEventListener("click", () => {
        selectionMode = true
        selectedIds.clear()
        render()
      })
      right.appendChild(selectManyBtn)
    }
  } else {
    const selectAllBtn = createButton("Select All", "outline")
    selectAllBtn.addEventListener("click", () => {
      const tabs = getTabs()
      const tab = tabs.find((t) => t.id === selectedTabId)
      if (!tab) return
      for (const item of tab.items) {
        selectedIds.add(item.id)
        if (item.type === "folder") {
          for (const child of item.children) {
            selectedIds.add(child.id)
          }
        }
      }
      render()
    })
    right.appendChild(selectAllBtn)

    const deleteBtn = createButton("Delete Selected", "destructive")
    deleteBtn.disabled = selectedIds.size === 0
    if (selectedIds.size === 0) deleteBtn.style.opacity = "0.5"
    deleteBtn.addEventListener("click", () => {
      openDeleteConfirmation()
    })
    right.appendChild(deleteBtn)

    const cancelBtn = createButton("Cancel", "ghost")
    cancelBtn.addEventListener("click", () => {
      selectionMode = false
      selectedIds.clear()
      render()
    })
    right.appendChild(cancelBtn)
  }

  controlBarEl.appendChild(left)
  controlBarEl.appendChild(right)
}

// ---------- Delete Confirmation ----------

function openDeleteConfirmation(): void {
  const { dialog, body, close } = createDialog()

  body.className = "p-6 min-w-[300px] flex flex-col gap-4"

  const title = document.createElement("h3")
  title.className = "text-sm font-semibold text-foreground"
  title.textContent = "Delete selected items?"
  body.appendChild(title)

  const message = document.createElement("p")
  message.className = "text-sm text-muted"
  message.textContent = `Are you sure? This will permanently delete ${selectedIds.size} item(s).`
  body.appendChild(message)

  const btnRow = document.createElement("div")
  btnRow.className = "flex gap-2 justify-end"

  const cancelBtn = createButton("Cancel", "outline", {
    onClick: close,
  })
  btnRow.appendChild(cancelBtn)

  const deleteBtn = createButton("Delete", "destructive", {
    onClick: () => {
      let tabs = deleteItems(getTabs(), selectedTabId!, Array.from(selectedIds))
      save(tabs)
      selectionMode = false
      selectedIds.clear()
      close()
      render()
    },
  })
  btnRow.appendChild(deleteBtn)

  body.appendChild(btnRow)

  dialog.showModal()
}

// ---------- Drag and Drop ----------

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
          "border-accent",
          "bg-accent/20",
          "bg-warning/20",
          "bg-danger/30"
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
          "border-accent",
          "bg-accent/20",
          "bg-warning/20",
          "bg-danger/30"
        )
      )

    const targetIndex = Number(row.dataset.index)
    const targetType = row.dataset.type

    if (dragType === "folder" || inFolder) {
      row.classList.add("border-t-2", "border-accent")
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
          row.classList.add("bg-danger/30")
        } else {
          row.classList.add("bg-accent/20")
        }
      } else if (targetType === "shortcut") {
        row.classList.add("bg-warning/20")
      }
    } else {
      row.classList.add("border-t-2", "border-accent")
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
        const container = document.createElement("div")
        container.className = "flex flex-col gap-2 min-w-[220px]"

        const title = document.createElement("span")
        title.className = "text-xs font-semibold text-foreground"
        title.textContent = "Create Folder"
        container.appendChild(title)

        const nameInput = createInput({ placeholder: "Folder name", value: "New Folder" })
        container.appendChild(nameInput)

        const btnRow = document.createElement("div")
        btnRow.className = "flex justify-end"
        const saveBtn = createButton("Save", "primary")
        btnRow.appendChild(saveBtn)
        container.appendChild(btnRow)

        const { close } = createPopover(row, container)

        function doMerge() {
          const name = (nameInput as HTMLInputElement).value.trim()
          if (!name) return
          tabs = mergeShortcutsIntoNewFolder(
            tabs,
            selectedTabId!,
            targetId,
            draggedItem.id,
            name
          )
          save(tabs)
          close()
        }

        function doCancel() {
          if (preDropSnapshot) save(preDropSnapshot)
          close()
        }

        saveBtn.addEventListener("click", doMerge)
        nameInput.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); doMerge() }
          if (ev.key === "Escape") doCancel()
        })

        requestAnimationFrame(() => {
          const input = nameInput as HTMLInputElement
          input.focus()
          input.select()
        })
      }
    } else {
      tabs = reorderItems(tabs, selectedTabId!, dragIndex, targetIndex)
      save(tabs)
    }
  })
}

// ---------- Sync from Store ----------

function syncFromStore(): void {
  const tabs = getTabs()
  if (selectedTabId && !tabs.find((t) => t.id === selectedTabId)) {
    selectedTabId = tabs.length > 0 ? tabs[0].id : null
    viewingFolderId = null
  }
  if (viewingFolderId && selectedTabId) {
    const tab = tabs.find((t) => t.id === selectedTabId)
    if (
      !tab ||
      !tab.items.find((i) => i.id === viewingFolderId && i.type === "folder")
    ) {
      viewingFolderId = null
    }
  }
  render()
}

// ---------- Init ----------

export function initShortcutSettings(): void {
  tabBarEl = document.getElementById("sc-tab-bar")!
  itemListEl = document.getElementById("sc-item-list")!
  controlBarEl = document.getElementById("sc-control-bar")!

  const tabs = getTabs()
  if (tabs.length > 0 && !selectedTabId) {
    selectedTabId = tabs[0].id
  }

  render()
  store.local.subscribe("shortcuts", syncFromStore)
}
```

- [ ] **Step 2: Build and verify no TypeScript errors**

Run: `./build.sh`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual smoke test**

Open the extension in a browser. Verify:
1. Settings dialog opens, Shortcuts tab is visible
2. Tab bar appears — clicking `+` creates a new tab with focused input
3. Clicking a tab switches to it
4. Typing in the tab name input and blurring saves
5. Hovering a tab shows the x button, clicking deletes the tab
6. Adding shortcuts via the popover form works
7. Adding folders via the popover form works
8. Clicking a folder opens the split view
9. Clicking the same folder again or the back chevron closes the split view
10. Edit popovers work for both shortcuts and folders
11. Delete buttons work on individual items
12. Selection mode: checkboxes appear, drag handles hidden, tabs disabled
13. Select All selects everything in the current tab
14. Delete Selected shows confirmation, confirming deletes items
15. Cancel exits selection mode

- [ ] **Step 4: Commit**

```bash
git add src/shortcut-settings.ts
git commit -m "feat: rewrite shortcut-settings with tab bar, grid layout, control bar, and selection mode"
```

---

### Task 6: Final Integration and Cleanup

**Files:**
- Verify: all files from Tasks 1-5 work together

- [ ] **Step 1: Full build**

Run: `./build.sh`
Expected: Clean build, no errors.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Verify drag-and-drop still works**

Open extension, add a tab with multiple shortcuts. Verify:
1. Dragging shortcuts reorders them
2. Dragging a shortcut onto another shortcut opens the merge-to-folder popover
3. Dragging a shortcut onto a folder moves it inside
4. Inside a folder, dragging reorders children
5. In split view, both columns support drag-and-drop

- [ ] **Step 4: Verify selection mode in split view**

1. Open a folder (split view)
2. Enter selection mode
3. Checkboxes appear in both columns
4. Select All selects items from both columns
5. Delete Selected removes the selected items from both places

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration fixes for shortcuts settings UI"
```

Only run this step if fixes were made. Skip if no changes needed.
