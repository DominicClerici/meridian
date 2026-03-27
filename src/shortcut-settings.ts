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
    if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); submit() }
    if ((e as KeyboardEvent).key === "Escape") close()
  })
  nameInput.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") close()
  })

  requestAnimationFrame(() => (nameInput as HTMLInputElement).focus())
}

function openCreateFolderPopover(
  anchor: HTMLElement,
  onSave: (name: string) => void,
  onCancel?: () => void
): void {
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

  const { close } = createPopover(anchor, container, {
    onClose: () => onCancel?.(),
  })

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    if (!name) return
    onSave(name)
    close()
  }

  saveBtn.addEventListener("click", submit)
  nameInput.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); submit() }
    if ((e as KeyboardEvent).key === "Escape") { close() }
  })

  requestAnimationFrame(() => {
    const input = nameInput as HTMLInputElement
    input.focus()
    input.select()
  })
}

function openAddFolderPopover(anchor: HTMLElement): void {
  openCreateFolderPopover(anchor, (name) => {
    const tabs = addFolder(getTabs(), selectedTabId!, name)
    save(tabs)
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
    if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); submit() }
    if ((e as KeyboardEvent).key === "Escape") close()
  })
  if (urlInput) {
    nameInput.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") close()
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
        : "bg-surface text-foreground hover:bg-accent/10"
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
    const addBtn = createButton("", "override", { icon: icon("plus", { size: 12 }) })
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
    const editBtn = createButton("", "override", { icon: icon("edit", { size: 12 }) })
    editBtn.className = "shrink-0 w-6 h-6 flex items-center justify-center rounded-theme text-muted hover:text-foreground hover:bg-surface transition-colors opacity-0 group-hover:opacity-100"
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      openEditPopover(editBtn, item, inFolder, folder)
    })
    row.appendChild(editBtn)

    const delBtn = createButton("", "override", { icon: icon("trash", { size: 12 }) })
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
    const backBtn = createButton("", "override", { icon: icon("chevronLeft", { size: 14 }) })
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

  const delBtn = createButton("Delete", "destructive", {
    onClick: () => {
      let tabs = deleteItems(getTabs(), selectedTabId!, Array.from(selectedIds))
      save(tabs)
      selectionMode = false
      selectedIds.clear()
      close()
      render()
    },
  })
  btnRow.appendChild(delBtn)

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

  list.addEventListener("drop", (e: DragEvent) => {
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
        openCreateFolderPopover(row, (name) => {
          tabs = mergeShortcutsIntoNewFolder(
            tabs,
            selectedTabId!,
            targetId,
            draggedItem.id,
            name
          )
          save(tabs)
        }, () => {
          if (preDropSnapshot) save(preDropSnapshot)
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
