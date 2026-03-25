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
  const importHistoryBtn = document.getElementById(
    "sc-import-history"
  ) as HTMLButtonElement
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
    importHistoryBtn.hidden = true
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
  importHistoryBtn.hidden = inFolder

  const items: (TabItem | Shortcut)[] = inFolder
    ? folder!.children
    : tab.items

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const row = document.createElement("div")
    row.className =
      "flex items-center gap-2 px-2 py-1 bg-surface rounded text-sm group"
    row.draggable = true
    row.dataset.index = String(i)
    row.dataset.id = item.id
    row.dataset.type = item.type

    const handle = document.createElement("span")
    handle.className = "cursor-grab text-muted"
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
        urlSpan.className = "text-muted ml-1 text-xs"
        urlSpan.textContent = item.url
        label.appendChild(urlSpan)
      }
    }
    row.appendChild(label)

    if (item.type === "folder" && !inFolder) {
      const openBtn = document.createElement("button")
      openBtn.className = "text-xs text-accent hover:underline"
      openBtn.textContent = "Open"
      openBtn.addEventListener("click", () => {
        viewingFolderId = item.id
        renderList()
      })
      row.appendChild(openBtn)
    }

    const editBtn = document.createElement("button")
    editBtn.className = "text-xs text-accent hover:underline"
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
    delBtn.className = "text-xs text-danger hover:underline"
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

  initDragAndDrop(list, inFolder, folder ?? null)
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

  renderList()
}

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
  updateTabSelect()
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
    viewingFolderId = null
    updateTabSelect()
  })

  deleteTabBtn.addEventListener("click", () => {
    if (!selectedTabId) return
    const tabs = deleteTab(getTabs(), selectedTabId)
    save(tabs)
    selectedTabId = tabs.length > 0 ? tabs[0].id : null
    viewingFolderId = null
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
  store.local.subscribe("shortcuts", syncFromStore)
}
