import { store } from "./store"
import type { Tab, TabItem, Folder, Shortcut, ShortcutIcon, FolderIcon } from "./shortcuts"
import { initDrag } from "./shortcut-drag"
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
  MAX_TABS,
} from "./shortcuts"
import { createButton, createInput, createCheckbox, createPopover, createDialog } from "./components"
import { icon, getIconSvg } from "./icons/registry"
import { ACCENT_COLORS } from "./defaults"

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

const SWATCH_BG: Record<string, string> = {
  rose: "bg-swatch-rose",
  coral: "bg-swatch-coral",
  amber: "bg-swatch-amber",
  teal: "bg-swatch-teal",
  sky: "bg-swatch-sky",
  violet: "bg-swatch-violet",
  slate: "bg-swatch-slate",
  stone: "bg-swatch-stone",
  zinc: "bg-swatch-zinc",
  graphite: "bg-swatch-graphite",
}

function getFaviconUrl(url: string): string {
  try {
    let u = url
    if (!/^https?:\/\//i.test(u)) u = "https://" + u
    return `https://www.google.com/s2/favicons?domain=${new URL(u).hostname}&sz=32`
  } catch {
    return ""
  }
}

function createIconPicker(
  itemType: "shortcut" | "folder",
  currentIcon?: ShortcutIcon | FolderIcon
): { el: HTMLElement; getIcon: () => ShortcutIcon | FolderIcon } {
  const defaultType = itemType === "shortcut" ? "favicon" : "folder"
  let selected: ShortcutIcon | FolderIcon = currentIcon ??
    (itemType === "shortcut" ? { type: "favicon" } : { type: "folder" })

  const container = document.createElement("div")
  container.className = "flex flex-col gap-1"

  const label = document.createElement("span")
  label.className = "text-xs text-muted"
  label.textContent = "Icon"
  container.appendChild(label)

  const row = document.createElement("div")
  row.className = "flex gap-2 items-center flex-wrap"

  const defaultBtn = document.createElement("button")
  defaultBtn.type = "button"
  defaultBtn.className = "w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-input-border/50 text-muted"
  defaultBtn.innerHTML = getIconSvg(itemType === "shortcut" ? "globe" : "folder")
  row.appendChild(defaultBtn)

  const colorBtns: HTMLButtonElement[] = []
  for (const color of ACCENT_COLORS) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = `w-6 h-6 rounded-full ${SWATCH_BG[color]} flex items-center justify-center cursor-pointer transition-all duration-150`
    btn.dataset.color = color
    btn.addEventListener("mouseenter", () => {
      if (!(selected.type === "color" && (selected as any).color === color))
        btn.style.transform = "scale(1.15)"
    })
    btn.addEventListener("mouseleave", () => { btn.style.transform = "" })
    btn.addEventListener("click", () => {
      selected = { type: "color", color }
      updateSelected()
    })
    colorBtns.push(btn)
    row.appendChild(btn)
  }

  function updateSelected(): void {
    const isDefault = selected.type === defaultType
    if (isDefault) {
      defaultBtn.style.outline = "2px solid var(--accent)"
      defaultBtn.style.outlineOffset = "2px"
      defaultBtn.style.borderColor = "var(--accent)"
      defaultBtn.style.color = "var(--accent)"
    } else {
      defaultBtn.style.outline = ""
      defaultBtn.style.outlineOffset = ""
      defaultBtn.style.borderColor = ""
      defaultBtn.style.color = ""
    }
    for (const btn of colorBtns) {
      const c = btn.dataset.color!
      const active = selected.type === "color" && (selected as any).color === c
      if (active) {
        btn.innerHTML = getIconSvg("swatchCheck")
        btn.style.outline = "2px solid"
        btn.style.outlineOffset = "2px"
        btn.style.outlineColor = `var(--swatch-${c})`
        btn.style.transform = ""
      } else {
        btn.innerHTML = ""
        btn.style.outline = ""
        btn.style.outlineOffset = ""
        btn.style.outlineColor = ""
      }
    }
  }

  defaultBtn.addEventListener("click", () => {
    selected = itemType === "shortcut"
      ? { type: "favicon" }
      : { type: "folder" }
    updateSelected()
  })
  defaultBtn.addEventListener("mouseenter", () => {
    if (selected.type !== defaultType) defaultBtn.style.transform = "scale(1.15)"
  })
  defaultBtn.addEventListener("mouseleave", () => { defaultBtn.style.transform = "" })

  container.appendChild(row)
  updateSelected()

  return { el: container, getIcon: () => selected }
}

function render(): void {
  renderTabBar()
  renderItemList()
  renderControlBar()
}

function openAddShortcutPopover(anchor: HTMLElement): void {
  const container = document.createElement("div")
  container.className = "flex flex-col gap-3 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = "Add Shortcut"
  container.appendChild(title)

  const nameGroup = document.createElement("div")
  nameGroup.className = "flex flex-col gap-1"
  const nameLabel = document.createElement("span")
  nameLabel.className = "text-xs text-muted"
  nameLabel.textContent = "Name"
  nameGroup.appendChild(nameLabel)
  const nameInput = createInput({ placeholder: "Name" })
  nameGroup.appendChild(nameInput)
  container.appendChild(nameGroup)

  const urlGroup = document.createElement("div")
  urlGroup.className = "flex flex-col gap-1"
  const urlLabel = document.createElement("span")
  urlLabel.className = "text-xs text-muted"
  urlLabel.textContent = "URL"
  urlGroup.appendChild(urlLabel)
  const urlInput = createInput({ placeholder: "https://..." })
  urlGroup.appendChild(urlInput)
  container.appendChild(urlGroup)

  const iconPicker = createIconPicker("shortcut")
  container.appendChild(iconPicker.el)

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  saveBtn.disabled = true
  saveBtn.style.opacity = "0.5"
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container, { modal: true })

  function updateSaveState() {
    const valid = (nameInput as HTMLInputElement).value.trim() !== "" &&
                  (urlInput as HTMLInputElement).value.trim() !== ""
    saveBtn.disabled = !valid
    saveBtn.style.opacity = valid ? "" : "0.5"
  }
  nameInput.addEventListener("input", updateSaveState)
  urlInput.addEventListener("input", updateSaveState)

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    const url = (urlInput as HTMLInputElement).value.trim()
    if (!name || !url) return
    const iconVal = iconPicker.getIcon() as ShortcutIcon
    let tabs = getTabs()
    if (viewingFolderId) {
      tabs = addShortcutToFolder(tabs, selectedTabId!, viewingFolderId, name, url, iconVal)
    } else {
      tabs = addShortcut(tabs, selectedTabId!, name, url, iconVal)
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
  onSave: (name: string, icon?: FolderIcon) => void,
  onCancel?: () => void
): void {
  const container = document.createElement("div")
  container.className = "flex flex-col gap-3 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = "Create Folder"
  container.appendChild(title)

  const nameGroup = document.createElement("div")
  nameGroup.className = "flex flex-col gap-1"
  const nameLabel = document.createElement("span")
  nameLabel.className = "text-xs text-muted"
  nameLabel.textContent = "Name"
  nameGroup.appendChild(nameLabel)
  const nameInput = createInput({ placeholder: "Folder name", value: "New Folder" })
  nameGroup.appendChild(nameInput)
  container.appendChild(nameGroup)

  const iconPicker = createIconPicker("folder")
  container.appendChild(iconPicker.el)

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container, {
    modal: true,
    onClose: () => onCancel?.(),
  })

  function updateSaveState() {
    const valid = (nameInput as HTMLInputElement).value.trim() !== ""
    saveBtn.disabled = !valid
    saveBtn.style.opacity = valid ? "" : "0.5"
  }
  nameInput.addEventListener("input", updateSaveState)
  updateSaveState()

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    if (!name) return
    onSave(name, iconPicker.getIcon() as FolderIcon)
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
  openCreateFolderPopover(anchor, (name, folderIcon) => {
    const tabs = addFolder(getTabs(), selectedTabId!, name, folderIcon)
    save(tabs)
  })
}

function openEditPopover(anchor: HTMLElement, item: TabItem | Shortcut, inFolder: boolean, folder: Folder | null): void {
  const isShortcut = item.type === "shortcut"
  const container = document.createElement("div")
  container.className = "flex flex-col gap-3 min-w-[220px]"

  const title = document.createElement("span")
  title.className = "text-xs font-semibold text-foreground"
  title.textContent = isShortcut ? "Edit Shortcut" : "Edit Folder"
  container.appendChild(title)

  const nameGroup = document.createElement("div")
  nameGroup.className = "flex flex-col gap-1"
  const nameLabel = document.createElement("span")
  nameLabel.className = "text-xs text-muted"
  nameLabel.textContent = "Name"
  nameGroup.appendChild(nameLabel)
  const nameInput = createInput({ placeholder: "Name", value: item.name })
  nameGroup.appendChild(nameInput)
  container.appendChild(nameGroup)

  let urlInput: HTMLInputElement | HTMLTextAreaElement | null = null
  if (isShortcut) {
    const urlGroup = document.createElement("div")
    urlGroup.className = "flex flex-col gap-1"
    const urlLabel = document.createElement("span")
    urlLabel.className = "text-xs text-muted"
    urlLabel.textContent = "URL"
    urlGroup.appendChild(urlLabel)
    urlInput = createInput({ placeholder: "https://...", value: (item as Shortcut).url })
    urlGroup.appendChild(urlInput)
    container.appendChild(urlGroup)
  }

  const iconPicker = createIconPicker(
    isShortcut ? "shortcut" : "folder",
    item.icon
  )
  container.appendChild(iconPicker.el)

  const btnRow = document.createElement("div")
  btnRow.className = "flex justify-end"
  const saveBtn = createButton("Save", "primary")
  btnRow.appendChild(saveBtn)
  container.appendChild(btnRow)

  const { close } = createPopover(anchor, container, { modal: true })

  function updateSaveState() {
    const nameVal = (nameInput as HTMLInputElement).value.trim()
    const urlVal = urlInput ? (urlInput as HTMLInputElement).value.trim() : "ok"
    const valid = nameVal !== "" && urlVal !== ""
    saveBtn.disabled = !valid
    saveBtn.style.opacity = valid ? "" : "0.5"
  }
  nameInput.addEventListener("input", updateSaveState)
  if (urlInput) urlInput.addEventListener("input", updateSaveState)
  updateSaveState()

  function submit() {
    const name = (nameInput as HTMLInputElement).value.trim()
    if (!name) return
    const iconVal = iconPicker.getIcon()
    let tabs = getTabs()
    if (isShortcut) {
      const url = (urlInput as HTMLInputElement).value.trim()
      if (!url) return
      if (inFolder && folder) {
        tabs = editShortcutInFolder(tabs, selectedTabId!, folder.id, item.id, name, url, iconVal as ShortcutIcon)
      } else {
        tabs = editShortcut(tabs, selectedTabId!, item.id, name, url, iconVal as ShortcutIcon)
      }
    } else {
      tabs = editFolder(tabs, selectedTabId!, item.id, name, iconVal as FolderIcon)
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
    pill.dataset.tabId = tab.id

    if (selectionMode) {
      pill.style.opacity = "0.4"
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
      const currentTabs = getTabs()
      const tabs = addTab(currentTabs, `Tab ${currentTabs.length + 1}`)
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


function createRow(
  item: TabItem | Shortcut,
  index: number,
  inFolder: boolean,
  folder: Folder | null,
  compact: boolean
): HTMLElement {
  const row = document.createElement("div")
  row.className = `flex items-center gap-2 px-2 py-1.5 rounded-theme text-sm group transition-colors hover:bg-surface${
    selectionMode ? "" : " cursor-grab"
  }`
  row.dataset.index = String(index)
  row.dataset.id = item.id
  row.dataset.type = item.type

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

  const iconConfig = item.icon
  if (iconConfig?.type === "color") {
    const dot = document.createElement("span")
    dot.className = `w-3.5 h-3.5 rounded-full shrink-0 ${SWATCH_BG[(iconConfig as any).color] ?? ""}`
    row.appendChild(dot)
  } else if (item.type === "shortcut" && (!iconConfig || iconConfig.type === "favicon")) {
    const img = document.createElement("img")
    img.src = getFaviconUrl((item as Shortcut).url)
    img.className = "w-4 h-4 rounded-sm shrink-0"
    img.alt = ""
    img.addEventListener("error", () => {
      const fallback = icon("link", { size: 14 })
      fallback.classList.add("shrink-0", "text-muted")
      img.replaceWith(fallback)
    }, { once: true })
    row.appendChild(img)
  } else {
    const itemIcon = icon("folder", { size: 14 })
    itemIcon.classList.add("shrink-0", "text-muted")
    row.appendChild(itemIcon)
  }

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
    list.className = "grid grid-cols-3"
    list.dataset.zone = "top-level"

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
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("button")) return
          viewingFolderId = item.id
          render()
        })
      }

      list.appendChild(row)
    }

    itemListEl.appendChild(list)
  } else {
    const grid = document.createElement("div")
    grid.className = "grid grid-cols-3 gap-3 h-full"

    const leftCol = document.createElement("div")
    leftCol.className = "col-span-1 flex flex-col gap-0.5 overflow-y-auto"
    leftCol.dataset.zone = "top-level"

    for (let i = 0; i < tab.items.length; i++) {
      const item = tab.items[i]
      const row = createRow(item, i, false, null, true)

      if (item.id === viewingFolderId) {
        row.className += " ring-2 ring-accent bg-accent/10"
      }

      if (item.type === "folder" && !selectionMode) {
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
    rightCol.dataset.zone = "folder"
    rightCol.dataset.folderId = viewingFolderId!

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
  }
}


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
      backBtn.style.opacity = "0.5"
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


function openDeleteConfirmation(): void {
  const { dialog, body, open, close } = createDialog()

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

  open()
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
  render()
}


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

  initDrag(tabBarEl, itemListEl, {
    getTabs,
    save,
    render,
    getSelectedTabId: () => selectedTabId,
    getViewingFolderId: () => viewingFolderId,
    getSelectionMode: () => selectionMode,
    getSelectedIds: () => selectedIds,
    setSelectedTabId: (id) => { selectedTabId = id },
    setViewingFolderId: (id) => { viewingFolderId = id },
    exitSelectionMode: () => { selectionMode = false; selectedIds.clear() },
    openCreateFolderPopover,
  })
}
