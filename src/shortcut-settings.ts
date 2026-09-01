import { store } from "./store"
import { prettyUrl, normalizeUrl, urlHost } from "./url"
import { renderIcon } from "./shortcut-icon"
import { createIconPicker } from "./shortcut-icon-picker"
import { initGridDrag } from "./shortcut-drag"
import { openImportDialog, exportBackup } from "./shortcut-import"
import { idbKeysIn, idbDeleteIn, ICON_STORE } from "./idb"
import { icon } from "./icons/registry"
import {
  createButton,
  createDialog,
  createInput,
  createMenu,
  showToast,
  type MenuItem,
} from "./components"
import {
  addFolder,
  addShortcut,
  addShortcutToFolder,
  addTab,
  collectImageKeys,
  createFolderFromItems,
  deleteItems,
  deleteTab,
  duplicateItem,
  editFolder,
  editShortcut,
  editShortcutInFolder,
  editTab,
  findFolder,
  findTab,
  insertItem,
  itemCapacity,
  locate,
  moveItems,
  reorderFolderChildren,
  reorderItems,
  sortContainer,
  tabCapacity,
  MAX_TABS,
  type Folder,
  type IconSpec,
  type Shortcut,
  type Tab,
  type TabItem,
} from "./shortcuts"

/**
 * The shortcuts settings panel: a tab rail, a grid of tiles, and a detail pane.
 *
 * Selection is ambient rather than a mode — click selects, Cmd/Ctrl-click adds,
 * Shift-click ranges — which is why there is no `selectionMode` flag here and
 * why nothing can survive the dialog closing.
 */

// ------------------------------------------------------------------- state

type Detail =
  | { kind: "item"; id: string }
  | { kind: "tab"; id: string }
  | { kind: "new-shortcut" }
  | { kind: "new-folder" }

let tabId: string | null = null
let folderId: string | null = null
let selection = new Set<string>()
let detail: Detail | null = null
let query = ""
let searchAllTabs = false

/** Anchor for Shift-click ranges, and the roving-tabindex target. */
let anchorId: string | null = null
let focusId: string | null = null

/** Keyboard drag: the tile picked up with Space, and where it came from. */
let grabbedId: string | null = null
let grabOrigin = 0

let panelEl: HTMLElement
let railEl: HTMLElement
let headerEl: HTMLElement
let scrollEl: HTMLElement
let gridEl: HTMLElement
let selectionBarEl: HTMLElement
let detailEl: HTMLElement

/** Guards the detail pane against being rebuilt under a cursor mid-edit. */
let detailKey = ""

const getTabs = (): Tab[] => store.local.get("shortcuts")
const save = (tabs: Tab[]): void => store.local.set("shortcuts", tabs)

function apply(result: { tabs: Tab[]; ok: boolean; reason?: string }): boolean {
  if (result.reason) showToast(result.reason, { variant: result.ok ? "default" : "danger" })
  if (result.ok) save(result.tabs)
  return result.ok
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: number | null = null
  const run = (...args: T) => {
    if (timer !== null) clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), ms)
  }
  run.flush = (...args: T) => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    fn(...args)
  }
  return run
}

// ------------------------------------------------------------ what's shown

type Entry = { item: TabItem; folder: Folder | null; tab: Tab }

function currentTab(): Tab | null {
  return tabId ? findTab(getTabs(), tabId) : null
}

function currentFolder(): Folder | null {
  return tabId && folderId ? findFolder(getTabs(), tabId, folderId) : null
}

function matches(item: TabItem, q: string): boolean {
  if (item.name.toLowerCase().includes(q)) return true
  return item.type === "shortcut" && item.url.toLowerCase().includes(q)
}

/**
 * The tiles to draw. A search flattens folders so a match inside one is
 * reachable without knowing which folder it's in; otherwise this is just the
 * current container.
 */
function visibleEntries(): Entry[] {
  const tabs = getTabs()
  const q = query.trim().toLowerCase()

  if (q) {
    const scope = searchAllTabs ? tabs : tabs.filter((t) => t.id === tabId)
    const found: Entry[] = []
    for (const tab of scope) {
      for (const item of tab.items) {
        if (matches(item, q)) found.push({ item, folder: null, tab })
        if (item.type === "folder") {
          for (const child of item.children) {
            if (matches(child, q)) found.push({ item: child, folder: item, tab })
          }
        }
      }
    }
    return found
  }

  const tab = currentTab()
  if (!tab) return []
  const folder = currentFolder()
  if (folder) return folder.children.map((c) => ({ item: c, folder, tab }))
  return tab.items.map((i) => ({ item: i, folder: null, tab }))
}

const searching = (): boolean => query.trim().length > 0

// ------------------------------------------------------------------ saving

function commitItem(
  id: string,
  patch: { name?: string; url?: string; icon?: IconSpec | null }
): string | null {
  const tabs = getTabs()
  const found = locate(tabs, id)
  if (!found) return "That item no longer exists."

  const name = patch.name ?? found.item.name
  const iconArg = patch.icon

  if (found.item.type === "folder") {
    save(editFolder(tabs, found.tab.id, found.item.id, name, iconArg))
    return null
  }

  const url = patch.url ?? found.item.url
  const result = found.folder
    ? editShortcutInFolder(tabs, found.tab.id, found.folder.id, id, name, url, iconArg)
    : editShortcut(tabs, found.tab.id, id, name, url, iconArg)

  if (!result.ok) return result.reason ?? "Couldn't save that."
  save(result.tabs)
  return null
}

function deleteWithUndo(ids: string[], label: string): void {
  if (ids.length === 0) return
  const before = getTabs()
  save(deleteItems(before, ids))
  for (const id of ids) selection.delete(id)
  if (detail?.kind === "item" && ids.includes(detail.id)) detail = null
  showToast(label, {
    action: { label: "Undo", onClick: () => save(before) },
  })
  render()
}

// ------------------------------------------------------------------- rail

function renderRail(): void {
  railEl.replaceChildren()
  const tabs = getTabs()

  const heading = document.createElement("div")
  heading.className = "sc-rail-heading"
  heading.textContent = "Tabs"
  railEl.appendChild(heading)

  for (const tab of tabs) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "sc-rail-item"
    btn.dataset.tabId = tab.id
    btn.setAttribute("aria-selected", String(tab.id === tabId))

    if (tab.icon) {
      btn.appendChild(renderIcon(tab.icon, { kind: "tab", name: tab.name }, { size: 14 }))
    }

    const name = document.createElement("span")
    name.className = "sc-rail-name"
    name.textContent = tab.name
    btn.appendChild(name)

    const count = document.createElement("span")
    count.className = "sc-rail-count"
    count.textContent = String(tab.items.length)
    btn.appendChild(count)

    btn.addEventListener("click", () => selectTab(tab.id))
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault()
      openTabMenu(btn, tab)
    })

    railEl.appendChild(btn)
  }

  const room = tabCapacity(tabs)
  const add = document.createElement("button")
  add.type = "button"
  add.className = "sc-rail-add"
  add.disabled = room.free === 0
  add.title = room.free === 0 ? `You can have at most ${MAX_TABS} tabs.` : "Add a tab"
  add.appendChild(icon("plus", { size: 12 }))
  const addLabel = document.createElement("span")
  addLabel.textContent = "New tab"
  add.appendChild(addLabel)
  add.addEventListener("click", () => {
    const result = addTab(getTabs(), `Tab ${getTabs().length + 1}`)
    if (!apply(result)) return
    const created = result.tabs[result.tabs.length - 1]
    tabId = created.id
    folderId = null
    selection.clear()
    detail = { kind: "tab", id: created.id }
    render()
  })
  railEl.appendChild(add)
}

function selectTab(id: string): void {
  if (tabId === id) return
  tabId = id
  folderId = null
  selection.clear()
  detail = null
  focusId = null
  query = ""
  render()
}

// ----------------------------------------------------------------- header

function renderHeader(): void {
  headerEl.replaceChildren()
  const tab = currentTab()

  const crumb = document.createElement("div")
  crumb.className = "sc-crumb flex-1 min-w-0"

  if (tab) {
    const folder = currentFolder()
    if (folder) {
      const up = document.createElement("button")
      up.type = "button"
      up.className = "sc-crumb-btn"
      up.textContent = tab.name
      up.addEventListener("click", () => {
        folderId = null
        detail = null
        focusId = null
        render()
      })
      crumb.appendChild(up)

      const sep = icon("chevronRight", { size: 12 })
      sep.classList.add("text-muted", "shrink-0")
      crumb.appendChild(sep)

      const current = document.createElement("button")
      current.type = "button"
      current.className = "sc-crumb-btn sc-crumb-current"
      current.title = "Rename this folder or change its icon"
      current.textContent = folder.name
      current.addEventListener("click", () => openDetail({ kind: "item", id: folder.id }))
      crumb.appendChild(current)
    } else {
      const current = document.createElement("button")
      current.type = "button"
      current.className = "sc-crumb-btn sc-crumb-current"
      current.title = "Rename this tab or change its icon"
      current.textContent = tab.name
      current.addEventListener("click", () => openDetail({ kind: "tab", id: tab.id }))
      crumb.appendChild(current)
    }
  }
  headerEl.appendChild(crumb)

  // --- search ---
  const searchWrap = document.createElement("div")
  searchWrap.className =
    "flex items-center gap-1.5 px-2 rounded-theme border border-input-border bg-input h-[30px] w-[190px] shrink-0 focus-within:border-accent transition-colors"

  const searchIcon = icon("search", { size: 13 })
  searchIcon.classList.add("text-muted", "shrink-0")
  searchWrap.appendChild(searchIcon)

  const searchInput = document.createElement("input")
  searchInput.type = "text"
  searchInput.placeholder = "Search"
  searchInput.value = query
  searchInput.className =
    "flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted"
  const runSearch = debounce((value: string) => {
    query = value
    focusId = null
    renderGrid()
    renderScopeToggle()
  }, 160)
  searchInput.addEventListener("input", () => runSearch(searchInput.value))
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      searchInput.value = ""
      query = ""
      renderGrid()
      renderScopeToggle()
    }
  })
  searchWrap.appendChild(searchInput)

  const scopeBtn = document.createElement("button")
  scopeBtn.type = "button"
  scopeBtn.className = "text-[10px] px-1.5 py-0.5 rounded-theme-xs shrink-0 transition-colors"
  scopeBtn.addEventListener("click", () => {
    searchAllTabs = !searchAllTabs
    renderGrid()
    renderScopeToggle()
  })
  searchWrap.appendChild(scopeBtn)

  function renderScopeToggle(): void {
    scopeBtn.hidden = !searching()
    scopeBtn.textContent = searchAllTabs ? "All tabs" : "This tab"
    scopeBtn.className = `text-[10px] px-1.5 py-0.5 rounded-theme-xs shrink-0 transition-colors ${
      searchAllTabs ? "bg-accent text-accent-foreground" : "bg-surface text-muted hover:text-foreground"
    }`
  }
  renderScopeToggle()

  headerEl.appendChild(searchWrap)

  // --- actions ---
  const addBtn = createButton("Add", "primary", { icon: icon("plus", { size: 12 }) })
  addBtn.disabled = !tab
  if (!tab) addBtn.style.opacity = "0.5"
  addBtn.addEventListener("click", () => openAddMenu(addBtn))
  headerEl.appendChild(addBtn)

  const moreBtn = createButton("", "ghost", { icon: icon("moreVertical", { size: 14 }) })
  moreBtn.className += " px-1.5"
  moreBtn.addEventListener("click", () => openPanelMenu(moreBtn))
  headerEl.appendChild(moreBtn)
}

function openAddMenu(anchor: HTMLElement): void {
  const items: MenuItem[] = [
    {
      label: "Shortcut",
      icon: icon("link", { size: 14 }),
      onClick: () => openDetail({ kind: "new-shortcut" }),
    },
  ]
  if (!folderId) {
    items.push({
      label: "Folder",
      icon: icon("folder", { size: 14 }),
      onClick: () => openDetail({ kind: "new-folder" }),
    })
  }
  items.push("separator", {
    label: "Import…",
    icon: icon("bgUpload", { size: 14 }),
    onClick: () => openImportDialog(tabId),
  })
  createMenu(anchor, items)
}

function openPanelMenu(anchor: HTMLElement): void {
  const tab = currentTab()
  const entries = visibleEntries()

  const items: MenuItem[] = [
    {
      label: "Import shortcuts…",
      icon: icon("bgUpload", { size: 14 }),
      onClick: () => openImportDialog(tabId),
    },
    {
      label: "Export backup",
      icon: icon("archive", { size: 14 }),
      onClick: () => exportBackup(),
    },
    "separator",
    {
      label: "Select all",
      disabled: entries.length === 0,
      onClick: () => {
        selection = new Set(entries.map((e) => e.item.id))
        detail = null
        render()
      },
    },
    {
      label: "Sort by name",
      disabled: !tab || searching() || entries.length < 2,
      hint: searching() ? "Clear the search first" : undefined,
      onClick: () => {
        if (!tab) return
        const before = getTabs()
        save(sortContainer(before, tab.id, folderId))
        showToast("Sorted by name", {
          action: { label: "Undo", onClick: () => save(before) },
        })
      },
    },
  ]

  if (tab) {
    items.push("separator", {
      label: "Rename tab…",
      icon: icon("edit", { size: 14 }),
      onClick: () => openDetail({ kind: "tab", id: tab.id }),
    }, {
      label: "Delete tab",
      icon: icon("trash", { size: 14 }),
      danger: true,
      onClick: () => confirmDeleteTab(tab),
    })
  }

  createMenu(anchor, items)
}

function openTabMenu(anchor: HTMLElement, tab: Tab): void {
  createMenu(anchor, [
    {
      label: "Rename…",
      icon: icon("edit", { size: 14 }),
      onClick: () => {
        selectTab(tab.id)
        openDetail({ kind: "tab", id: tab.id })
      },
    },
    {
      label: "Delete tab",
      icon: icon("trash", { size: 14 }),
      danger: true,
      onClick: () => confirmDeleteTab(tab),
    },
  ])
}

/**
 * The one action that still asks first. Everything else deletes immediately
 * and offers Undo, but a tab takes every shortcut in it with it.
 */
function confirmDeleteTab(tab: Tab): void {
  const count = tab.items.reduce(
    (n, i) => n + 1 + (i.type === "folder" ? i.children.length : 0),
    0
  )

  const { body, open, close } = createDialog()
  body.className = "p-6 w-[340px] flex flex-col gap-3"

  const title = document.createElement("h3")
  title.className = "text-sm font-semibold text-foreground"
  title.textContent = `Delete "${tab.name}"?`
  body.appendChild(title)

  const message = document.createElement("p")
  message.className = "text-sm text-muted"
  message.textContent =
    count === 0
      ? "This tab is empty. It will be removed."
      : `This permanently deletes the tab and the ${count} item${count === 1 ? "" : "s"} in it.`
  body.appendChild(message)

  const row = document.createElement("div")
  row.className = "flex gap-2 justify-end pt-1"
  row.appendChild(createButton("Cancel", "outline", { onClick: close }))
  row.appendChild(
    createButton("Delete tab", "destructive", {
      onClick: () => {
        save(deleteTab(getTabs(), tab.id))
        if (tabId === tab.id) {
          tabId = null
          folderId = null
          detail = null
        }
        close()
        render()
      },
    })
  )
  body.appendChild(row)
  open()
}

// ------------------------------------------------------------------- grid

function renderGrid(): void {
  const hadFocus = gridEl.contains(document.activeElement)
  gridEl.replaceChildren()

  const tab = currentTab()
  if (!tab) {
    gridEl.appendChild(
      emptyState(
        getTabs().length === 0 ? "No tabs yet" : "Select a tab",
        getTabs().length === 0 ? "Create a tab to start adding shortcuts." : ""
      )
    )
    renderSelectionBar()
    return
  }

  const entries = visibleEntries()
  gridEl.dataset.zone = folderId ? "folder" : "top-level"
  if (folderId) gridEl.dataset.folderId = folderId
  else delete gridEl.dataset.folderId

  if (entries.length === 0) {
    gridEl.appendChild(
      searching()
        ? emptyState("No matches", `Nothing here matches "${query.trim()}".`)
        : emptyState(
            folderId ? "This folder is empty" : "No shortcuts yet",
            folderId
              ? "Drag shortcuts in, or add one below."
              : "Add one, or import from your bookmarks and history."
          )
    )
  }

  for (let i = 0; i < entries.length; i++) {
    gridEl.appendChild(createTile(entries[i], i))
  }

  if (!searching()) gridEl.appendChild(createAddTile())

  if (hadFocus) {
    const target = gridEl.querySelector<HTMLElement>('[data-id][tabindex="0"]')
    target?.focus()
  }

  renderSelectionBar()
}

function emptyState(title: string, detailText: string): HTMLElement {
  const el = document.createElement("div")
  el.className = "sc-empty"

  const heading = document.createElement("span")
  heading.className = "font-medium text-foreground"
  heading.textContent = title
  el.appendChild(heading)

  if (detailText) {
    const sub = document.createElement("span")
    sub.textContent = detailText
    el.appendChild(sub)
  }
  return el
}

function createTile(entry: Entry, index: number): HTMLElement {
  const { item, folder } = entry
  const isFolder = item.type === "folder"

  const tile = document.createElement("button")
  tile.type = "button"
  tile.className = "sc-tile"
  tile.dataset.id = item.id
  tile.dataset.type = item.type
  tile.dataset.index = String(index)
  if (folder) tile.dataset.parentFolder = folder.id
  tile.setAttribute("aria-selected", String(selection.has(item.id)))
  if (grabbedId === item.id) tile.dataset.grabbed = "true"

  const isFocus = focusId ? focusId === item.id : index === 0
  tile.tabIndex = isFocus ? 0 : -1

  tile.appendChild(
    renderIcon(
      item.icon,
      {
        kind: isFolder ? "folder" : "shortcut",
        name: item.name,
        url: isFolder ? undefined : item.url,
      },
      { size: 34 }
    )
  )

  const name = document.createElement("span")
  name.className = "sc-tile-name"
  name.textContent = item.name
  tile.appendChild(name)

  tile.title = isFolder
    ? `${item.name} — ${item.children.length} shortcut${item.children.length === 1 ? "" : "s"}`
    : `${item.name}\n${prettyUrl(item.url)}`

  if (isFolder) {
    const badge = document.createElement("span")
    badge.className = "sc-tile-badge"
    badge.textContent = String(item.children.length)
    tile.appendChild(badge)
  } else if (searching() && folder) {
    const badge = document.createElement("span")
    badge.className = "sc-tile-badge"
    badge.textContent = folder.name.slice(0, 1).toUpperCase()
    badge.title = `in ${folder.name}`
    tile.appendChild(badge)
  }

  const menuBtn = document.createElement("button")
  menuBtn.type = "button"
  menuBtn.className = "sc-tile-menu"
  menuBtn.tabIndex = -1
  menuBtn.setAttribute("aria-label", `Actions for ${item.name}`)
  menuBtn.appendChild(icon("moreVertical", { size: 12 }))
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    openItemMenu(menuBtn, entry)
  })
  tile.appendChild(menuBtn)

  tile.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".sc-tile-menu")) return
    onTileActivate(entry, e)
  })
  tile.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    openItemMenu(tile, entry)
  })

  return tile
}

function createAddTile(): HTMLElement {
  const tile = document.createElement("button")
  tile.type = "button"
  tile.className = "sc-tile sc-tile-add"
  tile.dataset.addTile = "true"
  tile.tabIndex = -1

  const plus = icon("plus", { size: 20 })
  plus.classList.add("shrink-0")
  tile.appendChild(plus)

  const name = document.createElement("span")
  name.className = "sc-tile-name"
  name.textContent = "Add"
  tile.appendChild(name)

  const room = tabId ? itemCapacity(getTabs(), tabId).free : 0
  if (!folderId && room === 0) {
    tile.disabled = true
    tile.title = "This tab is full."
  }

  tile.addEventListener("click", () => openAddMenu(tile))
  return tile
}

/**
 * Clicking a folder drills in — that is what people mean by clicking a folder.
 * Editing one is reached from the breadcrumb once inside, or from its menu.
 */
function onTileActivate(entry: Entry, e: MouseEvent | KeyboardEvent): void {
  const id = entry.item.id
  const additive = e.metaKey || e.ctrlKey

  if (e.shiftKey && anchorId) {
    const ids = visibleEntries().map((x) => x.item.id)
    const from = ids.indexOf(anchorId)
    const to = ids.indexOf(id)
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from]
      selection = new Set(ids.slice(lo, hi + 1))
      detail = null
      focusId = id
      render()
      return
    }
  }

  if (additive) {
    if (selection.has(id)) selection.delete(id)
    else selection.add(id)
    anchorId = id
    focusId = id
    detail = selection.size === 1 ? { kind: "item", id: [...selection][0] } : null
    render()
    return
  }

  anchorId = id
  focusId = id

  if (entry.item.type === "folder" && !searching()) {
    selection.clear()
    folderId = entry.item.id
    detail = null
    focusId = null
    render()
    return
  }

  // A search result inside a folder navigates to it, so the tile you clicked
  // is the tile you end up editing.
  if (searching() && entry.folder) {
    tabId = entry.tab.id
    folderId = entry.folder.id
    query = ""
  } else if (searching()) {
    tabId = entry.tab.id
    folderId = null
    query = ""
  }

  selection = new Set([id])
  openDetail({ kind: "item", id })
}

function openItemMenu(anchor: HTMLElement, entry: Entry): void {
  const { item } = entry
  const tabs = getTabs()
  const selected = selection.has(item.id) ? [...selection] : [item.id]
  const many = selected.length > 1

  const items: MenuItem[] = [
    {
      label: many ? `Edit ${item.name}` : "Edit",
      icon: icon("edit", { size: 14 }),
      onClick: () => {
        selection = new Set([item.id])
        openDetail({ kind: "item", id: item.id })
      },
    },
  ]

  if (item.type === "folder") {
    items.push({
      label: "Open",
      icon: icon("folder", { size: 14 }),
      onClick: () => {
        folderId = item.id
        selection.clear()
        detail = null
        render()
      },
    })
  }

  items.push({
    label: many ? `Duplicate ${selected.length} items` : "Duplicate",
    icon: icon("copy", { size: 14 }),
    onClick: () => duplicateSelected(selected),
  })

  if (!folderId && !searching()) {
    const shortcuts = selected.filter((id) => {
      const f = locate(tabs, id)
      return f?.item.type === "shortcut" && !f.folder
    })
    items.push({
      label: "New folder from selection",
      icon: icon("folder", { size: 14 }),
      disabled: shortcuts.length === 0,
      hint: "Folders can't go inside other folders",
      onClick: () => makeFolderFrom(shortcuts),
    })
  }

  if (tabs.length > 1) {
    items.push({
      label: many ? `Move ${selected.length} items to…` : "Move to…",
      icon: icon("externalLink", { size: 14 }),
      onClick: () => openMoveMenu(anchor, selected),
    })
  }

  items.push("separator", {
    label: many ? `Delete ${selected.length} items` : "Delete",
    icon: icon("trash", { size: 14 }),
    danger: true,
    onClick: () =>
      deleteWithUndo(
        selected,
        many ? `${selected.length} items deleted` : `"${item.name}" deleted`
      ),
  })

  createMenu(anchor, items)
}

function openMoveMenu(anchor: HTMLElement, ids: string[]): void {
  const tabs = getTabs()
  createMenu(
    anchor,
    tabs.map((t) => ({
      label: t.name,
      disabled: t.id === tabId && !folderId,
      hint: "Already here",
      trailing: (() => {
        const span = document.createElement("span")
        span.className = "text-[10px] opacity-50"
        span.textContent = String(t.items.length)
        return span
      })(),
      onClick: () => {
        const before = getTabs()
        const result = moveItems(before, ids, { tabId: t.id, folderId: null })
        if (!apply(result)) return
        selection.clear()
        detail = null
        showToast(`Moved to ${t.name}`, {
          action: { label: "Undo", onClick: () => save(before) },
        })
        render()
      },
    }))
  )
}

function duplicateSelected(ids: string[]): void {
  let tabs = getTabs()
  let made = 0
  for (const id of ids) {
    const found = locate(tabs, id)
    if (!found || found.folder) continue
    const result = insertItem(tabs, found.tab.id, duplicateItem(found.item), found.index + 1)
    if (!result.ok) {
      showToast(result.reason ?? "Couldn't duplicate.", { variant: "danger" })
      break
    }
    tabs = result.tabs
    made++
  }
  if (made === 0) return
  save(tabs)
  showToast(`${made} item${made === 1 ? "" : "s"} duplicated`)
}

function makeFolderFrom(ids: string[]): void {
  if (!tabId || ids.length === 0) return
  const before = getTabs()
  const result = createFolderFromItems(before, tabId, ids, "New folder")
  if (!apply(result)) return
  selection.clear()
  const created = findTab(result.tabs, tabId)?.items.find(
    (i) => i.type === "folder" && !findTab(before, tabId!)?.items.some((o) => o.id === i.id)
  )
  if (created) openDetail({ kind: "item", id: created.id })
  else render()
}

// --------------------------------------------------------- selection bar

function renderSelectionBar(): void {
  selectionBarEl.replaceChildren()
  selectionBarEl.hidden = selection.size < 2
  if (selection.size < 2) return

  const label = document.createElement("span")
  label.className = "flex-1 min-w-0 font-medium"
  label.textContent = `${selection.size} selected`
  selectionBarEl.appendChild(label)

  const ids = [...selection]

  if (!folderId && !searching()) {
    const folderBtn = createButton("New folder", "outline", {
      icon: icon("folder", { size: 12 }),
    })
    folderBtn.addEventListener("click", () => {
      const tabs = getTabs()
      const shortcuts = ids.filter((id) => {
        const f = locate(tabs, id)
        return f?.item.type === "shortcut" && !f.folder
      })
      makeFolderFrom(shortcuts)
    })
    selectionBarEl.appendChild(folderBtn)
  }

  if (getTabs().length > 1) {
    const moveBtn = createButton("Move to…", "outline")
    moveBtn.addEventListener("click", () => openMoveMenu(moveBtn, ids))
    selectionBarEl.appendChild(moveBtn)
  }

  const delBtn = createButton("Delete", "destructive-outline", {
    icon: icon("trash", { size: 12 }),
  })
  delBtn.addEventListener("click", () => deleteWithUndo(ids, `${ids.length} items deleted`))
  selectionBarEl.appendChild(delBtn)

  const clearBtn = createButton("Clear", "ghost")
  clearBtn.addEventListener("click", () => {
    selection.clear()
    render()
  })
  selectionBarEl.appendChild(clearBtn)
}

// ------------------------------------------------------------ detail pane

function openDetail(next: Detail): void {
  detail = next
  render()
}

function keyFor(d: Detail | null): string {
  if (selection.size >= 2) return `multi:${selection.size}`
  if (!d) return ""
  return "id" in d ? `${d.kind}:${d.id}` : d.kind
}

function renderDetail(): void {
  const key = keyFor(detail)
  if (key === detailKey) return
  detailKey = key

  detailEl.replaceChildren()
  detailEl.hidden = key === ""
  if (key === "") return

  if (selection.size >= 2) {
    detailEl.hidden = true
    return
  }

  if (!detail) return
  if (detail.kind === "tab") buildTabDetail(detail.id)
  else if (detail.kind === "item") buildItemDetail(detail.id)
  else buildDraftDetail(detail.kind === "new-folder" ? "folder" : "shortcut")
}

function detailHeader(title: string): void {
  const head = document.createElement("div")
  head.className = "flex items-center gap-2"

  const heading = document.createElement("span")
  heading.className = "flex-1 min-w-0 text-xs font-semibold uppercase tracking-wider text-muted"
  heading.textContent = title
  head.appendChild(heading)

  const close = createButton("", "ghost", { icon: icon("close", { size: 12 }) })
  close.className += " !px-1 !py-1"
  close.setAttribute("aria-label", "Close")
  close.addEventListener("click", () => {
    detail = null
    render()
  })
  head.appendChild(close)

  detailEl.appendChild(head)
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "sc-field"
  const l = document.createElement("span")
  l.className = "sc-field-label"
  l.textContent = label
  wrap.appendChild(l)
  wrap.appendChild(control)
  return wrap
}

function buildItemDetail(id: string): void {
  const found = locate(getTabs(), id)
  if (!found) {
    detail = null
    return
  }
  const item = found.item
  const isFolder = item.type === "folder"

  detailHeader(isFolder ? "Folder" : "Shortcut")

  const nameInput = createInput({ value: item.name, placeholder: "Name" }) as HTMLInputElement
  detailEl.appendChild(field("Name", nameInput))

  let urlInput: HTMLInputElement | null = null
  let urlError: HTMLElement | null = null

  if (!isFolder) {
    urlInput = createInput({
      value: (item as Shortcut).url,
      placeholder: "https://example.com",
    }) as HTMLInputElement
    const wrap = field("Address", urlInput)
    urlError = document.createElement("span")
    urlError.className = "text-xs text-danger"
    urlError.hidden = true
    wrap.appendChild(urlError)
    detailEl.appendChild(wrap)
  }

  const picker = createIconPicker({
    target: {
      kind: isFolder ? "folder" : "shortcut",
      name: item.name,
      url: isFolder ? undefined : (item as Shortcut).url,
    },
    value: item.icon ?? null,
    onChange: (spec) => commitItem(id, { icon: spec }),
  })
  detailEl.appendChild(field("Icon", picker.el))

  const push = debounce(() => {
    const name = nameInput.value.trim() || item.name
    if (urlInput) {
      const href = normalizeUrl(urlInput.value)
      if (!href) {
        urlError!.textContent = "That doesn't look like a web address."
        urlError!.hidden = false
        commitItem(id, { name })
        return
      }
      urlError!.hidden = true
      commitItem(id, { name, url: urlInput.value })
    } else {
      commitItem(id, { name })
    }
    picker.setTarget({
      kind: isFolder ? "folder" : "shortcut",
      name,
      url: urlInput?.value,
    })
  }, 350)

  nameInput.addEventListener("input", () => push())
  nameInput.addEventListener("blur", () => push.flush())
  urlInput?.addEventListener("input", () => push())
  urlInput?.addEventListener("blur", () => push.flush())

  const spacer = document.createElement("div")
  spacer.className = "flex-1"
  detailEl.appendChild(spacer)

  const actions = document.createElement("div")
  actions.className = "flex flex-col gap-2"

  if (isFolder) {
    const openBtn = createButton("Open folder", "outline", {
      icon: icon("folder", { size: 12 }),
    })
    openBtn.addEventListener("click", () => {
      folderId = item.id
      detail = null
      selection.clear()
      render()
    })
    actions.appendChild(openBtn)

    const count = document.createElement("span")
    count.className = "text-xs text-muted"
    const n = (item as Folder).children.length
    count.textContent = `${n} shortcut${n === 1 ? "" : "s"} inside`
    actions.appendChild(count)
  }

  const delBtn = createButton("Delete", "destructive-outline", {
    icon: icon("trash", { size: 12 }),
  })
  delBtn.addEventListener("click", () => {
    push.flush()
    deleteWithUndo([id], `"${item.name}" deleted`)
  })
  actions.appendChild(delBtn)

  detailEl.appendChild(actions)
}

function buildTabDetail(id: string): void {
  const tab = findTab(getTabs(), id)
  if (!tab) {
    detail = null
    return
  }

  detailHeader("Tab")

  const nameInput = createInput({ value: tab.name, placeholder: "Tab name" }) as HTMLInputElement
  detailEl.appendChild(field("Name", nameInput))

  const picker = createIconPicker({
    target: { kind: "tab", name: tab.name },
    value: tab.icon ?? null,
    onChange: (spec) => save(editTab(getTabs(), id, nameInput.value.trim() || tab.name, spec ?? undefined)),
  })
  detailEl.appendChild(field("Icon", picker.el))

  const push = debounce(() => {
    const name = nameInput.value.trim()
    if (!name) return
    save(editTab(getTabs(), id, name, picker.getIcon() ?? undefined))
    picker.setTarget({ kind: "tab", name })
  }, 350)
  nameInput.addEventListener("input", () => push())
  nameInput.addEventListener("blur", () => push.flush())

  const spacer = document.createElement("div")
  spacer.className = "flex-1"
  detailEl.appendChild(spacer)

  const delBtn = createButton("Delete tab", "destructive-outline", {
    icon: icon("trash", { size: 12 }),
  })
  delBtn.addEventListener("click", () => confirmDeleteTab(tab))
  detailEl.appendChild(delBtn)
}

/**
 * A new item lives only in this pane until its URL is valid, so an incomplete
 * shortcut never reaches the model.
 */
function buildDraftDetail(kind: "shortcut" | "folder"): void {
  detailHeader(kind === "folder" ? "New folder" : "New shortcut")

  let draftIcon: IconSpec | null = null

  const nameInput = createInput({ placeholder: "Name" }) as HTMLInputElement
  detailEl.appendChild(field("Name", nameInput))

  let urlInput: HTMLInputElement | null = null
  let urlError: HTMLElement | null = null

  if (kind === "shortcut") {
    urlInput = createInput({ placeholder: "https://example.com" }) as HTMLInputElement
    const wrap = field("Address", urlInput)
    urlError = document.createElement("span")
    urlError.className = "text-xs text-danger"
    urlError.hidden = true
    wrap.appendChild(urlError)
    detailEl.appendChild(wrap)
  }

  const picker = createIconPicker({
    target: { kind, name: "" },
    value: null,
    onChange: (spec) => {
      draftIcon = spec
    },
  })
  detailEl.appendChild(field("Icon", picker.el))

  const spacer = document.createElement("div")
  spacer.className = "flex-1"
  detailEl.appendChild(spacer)

  const addBtn = createButton(kind === "folder" ? "Create folder" : "Add shortcut", "primary")
  addBtn.disabled = true
  addBtn.style.opacity = "0.5"

  function refresh(): void {
    const name = nameInput.value.trim()
    const href = urlInput ? normalizeUrl(urlInput.value) : "ok"
    const valid = kind === "folder" ? name.length > 0 : Boolean(href)
    addBtn.disabled = !valid
    addBtn.style.opacity = valid ? "" : "0.5"
    picker.setTarget({ kind, name: name || urlHost(urlInput?.value ?? ""), url: urlInput?.value })
  }

  // Typing an address first is the common case, so the name fills itself in
  // from the host until the field is touched.
  let nameTouched = false
  nameInput.addEventListener("input", () => {
    nameTouched = nameInput.value.trim().length > 0
    refresh()
  })
  urlInput?.addEventListener("input", () => {
    if (!nameTouched) {
      const host = urlHost(urlInput!.value)
      nameInput.value = host ? host.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : ""
    }
    if (urlError && !urlError.hidden) urlError.hidden = true
    refresh()
  })

  function submit(): void {
    const name = nameInput.value.trim()
    if (!tabId) return

    if (kind === "folder") {
      if (!name) return
      const result = addFolder(getTabs(), tabId, name, draftIcon ?? undefined)
      if (!apply(result)) return
      detail = null
      render()
      return
    }

    const raw = urlInput!.value
    if (!normalizeUrl(raw)) {
      urlError!.textContent = "That doesn't look like a web address."
      urlError!.hidden = false
      return
    }

    const finalName = name || urlHost(raw) || raw
    const result = folderId
      ? addShortcutToFolder(getTabs(), tabId, folderId, finalName, raw, draftIcon ?? undefined)
      : addShortcut(getTabs(), tabId, finalName, raw, draftIcon ?? undefined)
    if (!apply(result)) return

    // Stay in the draft so several can be added in a row.
    nameInput.value = ""
    urlInput!.value = ""
    nameTouched = false
    draftIcon = null
    picker.setIcon(null)
    refresh()
    nameInput.blur()
    urlInput!.focus()
    render()
  }

  addBtn.addEventListener("click", submit)
  for (const input of [nameInput, urlInput]) {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        submit()
      }
    })
  }
  detailEl.appendChild(addBtn)

  requestAnimationFrame(() => (urlInput ?? nameInput).focus())
}

// -------------------------------------------------------------- keyboard

function gridColumns(): number {
  const tracks = getComputedStyle(gridEl).gridTemplateColumns
  const n = tracks.split(" ").filter((t) => t && t !== "none").length
  return Math.max(1, n)
}

function tiles(): HTMLElement[] {
  return [...gridEl.querySelectorAll<HTMLElement>("[data-id]")]
}

function moveFocus(delta: number): void {
  const list = tiles()
  if (list.length === 0) return
  const current = list.findIndex((t) => t.dataset.id === focusId)
  const next = Math.max(0, Math.min(list.length - 1, (current === -1 ? 0 : current) + delta))
  focusId = list[next].dataset.id ?? null
  for (const t of list) t.tabIndex = t.dataset.id === focusId ? 0 : -1
  list[next].focus()
}

/** Space picks a tile up; the arrows then reorder rather than move focus. */
function moveGrabbed(delta: number): void {
  if (!grabbedId || !tabId) return
  const found = locate(getTabs(), grabbedId)
  if (!found) return
  const list = folderId ? found.folder?.children ?? [] : found.tab.items
  const to = Math.max(0, Math.min(list.length - 1, found.index + delta))
  if (to === found.index) return

  save(
    folderId
      ? reorderFolderChildren(getTabs(), tabId, folderId, found.index, to)
      : reorderItems(getTabs(), tabId, found.index, to)
  )
  render()
  requestAnimationFrame(() => {
    gridEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(grabbedId!)}"]`)?.focus()
  })
}

function onGridKeyDown(e: KeyboardEvent): void {
  const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")
  const columns = gridColumns()

  if (e.key === "Escape") {
    if (grabbedId) {
      const id = grabbedId
      grabbedId = null
      const found = locate(getTabs(), id)
      if (found && tabId) {
        save(
          folderId
            ? reorderFolderChildren(getTabs(), tabId, folderId, found.index, grabOrigin)
            : reorderItems(getTabs(), tabId, found.index, grabOrigin)
        )
      }
      e.stopPropagation()
      render()
      return
    }
    if (detail) {
      detail = null
      e.stopPropagation()
      render()
      return
    }
    if (selection.size > 0) {
      selection.clear()
      e.stopPropagation()
      render()
      return
    }
    if (folderId) {
      folderId = null
      e.stopPropagation()
      render()
    }
    return
  }

  if (!tile) return

  const steps: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns,
  }

  if (e.key in steps) {
    e.preventDefault()
    if (grabbedId) moveGrabbed(steps[e.key])
    else moveFocus(steps[e.key])
    return
  }

  if (e.key === "Home" || e.key === "End") {
    e.preventDefault()
    moveFocus(e.key === "Home" ? -tiles().length : tiles().length)
    return
  }

  if (e.key === " ") {
    e.preventDefault()
    if (grabbedId) {
      grabbedId = null
      render()
      return
    }
    if (searching()) {
      showToast("Clear the search to reorder.")
      return
    }
    const found = locate(getTabs(), tile.dataset.id!)
    if (!found) return
    grabbedId = tile.dataset.id!
    grabOrigin = found.index
    render()
    requestAnimationFrame(() => {
      gridEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(grabbedId!)}"]`)?.focus()
    })
    return
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault()
    const ids = selection.has(tile.dataset.id!) ? [...selection] : [tile.dataset.id!]
    deleteWithUndo(ids, ids.length > 1 ? `${ids.length} items deleted` : "Deleted")
    return
  }

  if (e.key === "Enter") {
    e.preventDefault()
    const entry = visibleEntries().find((x) => x.item.id === tile.dataset.id)
    if (entry) onTileActivate(entry, e)
  }
}

// ------------------------------------------------------------------- init

function render(): void {
  renderRail()
  renderHeader()
  renderGrid()
  renderDetail()
}

function reconcile(): void {
  const tabs = getTabs()

  if (!tabId || !findTab(tabs, tabId)) {
    tabId = tabs[0]?.id ?? null
    folderId = null
  }
  if (folderId && (!tabId || !findFolder(tabs, tabId, folderId))) folderId = null

  for (const id of [...selection]) {
    if (!locate(tabs, id)) selection.delete(id)
  }
  if (detail?.kind === "item" && !locate(tabs, detail.id)) detail = null
  if (detail?.kind === "tab" && !findTab(tabs, detail.id)) detail = null
  if (detail && detail.kind !== "item" && detail.kind !== "tab" && !tabId) detail = null

  render()
}

/**
 * Uploaded icons are reference-counted by sweep rather than on delete, since
 * an item can disappear through a dozen paths. Runs once, before the panel can
 * have produced any uncommitted draft icon.
 */
async function collectGarbage(): Promise<void> {
  try {
    const referenced = collectImageKeys(getTabs())
    for (const key of await idbKeysIn(ICON_STORE)) {
      if (!referenced.has(key)) await idbDeleteIn(ICON_STORE, key)
    }
  } catch {
    // A blocked or unavailable IndexedDB just means the sweep waits for next boot.
  }
}

export function initShortcutSettings(): void {
  panelEl = document.getElementById("sc-panel")!

  railEl = document.createElement("div")
  railEl.className = "sc-rail"
  panelEl.appendChild(railEl)

  const main = document.createElement("div")
  main.className = "flex-1 flex flex-col min-w-0"

  headerEl = document.createElement("div")
  headerEl.className = "flex items-center gap-2 px-6 pt-4 pb-3 shrink-0"
  main.appendChild(headerEl)

  scrollEl = document.createElement("div")
  scrollEl.className = "flex-1 overflow-y-auto px-6 min-h-0"

  gridEl = document.createElement("div")
  gridEl.className = "sc-grid"
  gridEl.addEventListener("keydown", onGridKeyDown)
  scrollEl.appendChild(gridEl)
  main.appendChild(scrollEl)

  selectionBarEl = document.createElement("div")
  selectionBarEl.className = "sc-selection-bar"
  selectionBarEl.hidden = true
  main.appendChild(selectionBarEl)

  panelEl.appendChild(main)

  detailEl = document.createElement("div")
  detailEl.className = "sc-detail"
  detailEl.hidden = true
  panelEl.appendChild(detailEl)

  const tabs = getTabs()
  if (!tabId && tabs.length > 0) tabId = tabs[0].id

  render()
  store.local.subscribe("shortcuts", reconcile)

  initGridDrag({
    gridEl,
    railEl,
    scrollEl,
    getTabs,
    save,
    getState: () => ({ tabId, folderId, selection }),
    setLocation: (nextTab, nextFolder) => {
      tabId = nextTab
      folderId = nextFolder
      detail = null
      render()
    },
    clearSelection: () => {
      selection.clear()
      detail = null
    },
    notify: (message) => showToast(message),
    refresh: render,
  })

  setTimeout(collectGarbage, 3000)
}
