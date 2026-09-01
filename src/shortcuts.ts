import { normalizeUrl } from "./url"
import type { AccentColor } from "./defaults"

/**
 * One icon shape for tabs, folders and shortcuts.
 *
 * `favicon`, `folder` and `color` predate the others and are still what's
 * sitting in existing users' storage, so every consumer has to handle them.
 * Keeping them legal is what lets this land with no migration pass.
 */
export type IconSpec =
  | { type: "favicon" }
  | { type: "folder" }
  | { type: "color"; color: AccentColor }
  | { type: "mono"; text: string; color: AccentColor }
  | { type: "glyph"; name: string; color?: AccentColor }
  | { type: "image"; key: string }

/** Both aliases now name the same union; kept so call sites read intent. */
export type ShortcutIcon = IconSpec
export type FolderIcon = IconSpec

export type Shortcut = {
  type: "shortcut"
  id: string
  name: string
  url: string
  icon?: IconSpec
}

export type Folder = {
  type: "folder"
  id: string
  name: string
  children: Shortcut[]
  icon?: IconSpec
}

export type TabItem = Shortcut | Folder

export type Tab = {
  id: string
  name: string
  icon?: IconSpec
  items: TabItem[]
}

export const MAX_TABS = 6
export const MAX_ITEMS_PER_TAB = 256
export const MAX_CHILDREN_PER_FOLDER = 64

/**
 * What an operation that can hit a limit reports back. `tabs` is always usable
 * — unchanged when `ok` is false — so a caller that doesn't care about the
 * reason can still just save the result.
 */
export type OpResult = { tabs: Tab[]; ok: boolean; reason?: string }

export type Capacity = { used: number; max: number; free: number }

const succeed = (tabs: Tab[]): OpResult => ({ tabs, ok: true })
const refuse = (tabs: Tab[], reason: string): OpResult => ({ tabs, ok: false, reason })

const TAB_FULL = `You can have at most ${MAX_TABS} tabs.`
const ITEMS_FULL = `This tab is full — ${MAX_ITEMS_PER_TAB} items is the maximum.`
const FOLDER_FULL = `This folder is full — ${MAX_CHILDREN_PER_FOLDER} shortcuts is the maximum.`
const BAD_URL = "That doesn't look like a web address."
const GONE = "That item no longer exists."

const uid = (): string => crypto.randomUUID()

const withIcon = (icon?: IconSpec) => (icon ? { icon } : {})

// ---------------------------------------------------------------- lookups

export function findTab(tabs: Tab[], tabId: string): Tab | null {
  return tabs.find((t) => t.id === tabId) ?? null
}

export function findFolder(tabs: Tab[], tabId: string, folderId: string): Folder | null {
  const item = findTab(tabs, tabId)?.items.find((i) => i.id === folderId)
  return item?.type === "folder" ? item : null
}

export type Located = {
  tab: Tab
  item: TabItem
  /** Null when the item sits at the top level of its tab. */
  folder: Folder | null
  /** Index within its container — the tab's items, or the folder's children. */
  index: number
}

/** Finds an item anywhere in the tree — top level or inside any folder. */
export function locate(tabs: Tab[], itemId: string): Located | null {
  for (const tab of tabs) {
    const topIndex = tab.items.findIndex((i) => i.id === itemId)
    if (topIndex !== -1) {
      return { tab, item: tab.items[topIndex], folder: null, index: topIndex }
    }
    for (const item of tab.items) {
      if (item.type !== "folder") continue
      const childIndex = item.children.findIndex((c) => c.id === itemId)
      if (childIndex !== -1) {
        return { tab, item: item.children[childIndex], folder: item, index: childIndex }
      }
    }
  }
  return null
}

export function tabCapacity(tabs: Tab[]): Capacity {
  return { used: tabs.length, max: MAX_TABS, free: Math.max(0, MAX_TABS - tabs.length) }
}

export function itemCapacity(tabs: Tab[], tabId: string): Capacity {
  const used = findTab(tabs, tabId)?.items.length ?? 0
  return { used, max: MAX_ITEMS_PER_TAB, free: Math.max(0, MAX_ITEMS_PER_TAB - used) }
}

export function folderCapacity(tabs: Tab[], tabId: string, folderId: string): Capacity {
  const used = findFolder(tabs, tabId, folderId)?.children.length ?? 0
  return { used, max: MAX_CHILDREN_PER_FOLDER, free: Math.max(0, MAX_CHILDREN_PER_FOLDER - used) }
}

/** Every shortcut URL in the tree, for import-time duplicate detection. */
export function allShortcutUrls(tabs: Tab[]): Set<string> {
  const urls = new Set<string>()
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.type === "shortcut") urls.add(item.url)
      else for (const child of item.children) urls.add(child.url)
    }
  }
  return urls
}

/**
 * Every `image` icon key currently referenced. The settings panel sweeps the
 * IndexedDB icon store against this rather than tracking deletes, which would
 * otherwise leak a blob on every path that removes an item.
 */
export function collectImageKeys(tabs: Tab[]): Set<string> {
  const keys = new Set<string>()
  const add = (icon?: IconSpec) => {
    if (icon?.type === "image") keys.add(icon.key)
  }
  for (const tab of tabs) {
    add(tab.icon)
    for (const item of tab.items) {
      add(item.icon)
      if (item.type === "folder") for (const child of item.children) add(child.icon)
    }
  }
  return keys
}

// ------------------------------------------------------------------- tabs

export function addTab(tabs: Tab[], name: string, icon?: IconSpec): OpResult {
  if (tabs.length >= MAX_TABS) return refuse(tabs, TAB_FULL)
  return succeed([...tabs, { id: uid(), name, items: [], ...withIcon(icon) }])
}

export function editTab(tabs: Tab[], tabId: string, name: string, icon?: IconSpec): Tab[] {
  return tabs.map((t) =>
    t.id === tabId ? { ...t, name, ...(icon !== undefined ? { icon } : {}) } : t
  )
}

export function deleteTab(tabs: Tab[], tabId: string): Tab[] {
  return tabs.filter((t) => t.id !== tabId)
}

export function reorderTabs(tabs: Tab[], fromIndex: number, toIndex: number): Tab[] {
  const result = [...tabs]
  const [moved] = result.splice(fromIndex, 1)
  if (!moved) return tabs
  result.splice(toIndex, 0, moved)
  return result
}

// -------------------------------------------------------------- creation

export function makeShortcut(name: string, url: string, icon?: IconSpec): Shortcut | null {
  const href = normalizeUrl(url)
  if (!href) return null
  return { type: "shortcut", id: uid(), name, url: href, ...withIcon(icon) }
}

export function addShortcut(
  tabs: Tab[],
  tabId: string,
  name: string,
  url: string,
  icon?: IconSpec
): OpResult {
  const tab = findTab(tabs, tabId)
  if (!tab) return refuse(tabs, GONE)
  if (tab.items.length >= MAX_ITEMS_PER_TAB) return refuse(tabs, ITEMS_FULL)
  const shortcut = makeShortcut(name, url, icon)
  if (!shortcut) return refuse(tabs, BAD_URL)
  return succeed(
    tabs.map((t) => (t.id === tabId ? { ...t, items: [...t.items, shortcut] } : t))
  )
}

export function addFolder(
  tabs: Tab[],
  tabId: string,
  name: string,
  icon?: IconSpec
): OpResult {
  const tab = findTab(tabs, tabId)
  if (!tab) return refuse(tabs, GONE)
  if (tab.items.length >= MAX_ITEMS_PER_TAB) return refuse(tabs, ITEMS_FULL)
  const folder: Folder = { type: "folder", id: uid(), name, children: [], ...withIcon(icon) }
  return succeed(
    tabs.map((t) => (t.id === tabId ? { ...t, items: [...t.items, folder] } : t))
  )
}

export function addShortcutToFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  name: string,
  url: string,
  icon?: IconSpec
): OpResult {
  const folder = findFolder(tabs, tabId, folderId)
  if (!folder) return refuse(tabs, GONE)
  if (folder.children.length >= MAX_CHILDREN_PER_FOLDER) return refuse(tabs, FOLDER_FULL)
  const shortcut = makeShortcut(name, url, icon)
  if (!shortcut) return refuse(tabs, BAD_URL)
  return succeed(
    mapFolder(tabs, tabId, folderId, (f) => ({ ...f, children: [...f.children, shortcut] }))
  )
}

// ---------------------------------------------------------------- editing

function mapFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  fn: (folder: Folder) => Folder
): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    return {
      ...t,
      items: t.items.map((i) => (i.id === folderId && i.type === "folder" ? fn(i) : i)),
    }
  })
}

/**
 * Passing `icon: undefined` leaves the icon alone; passing `null` clears it
 * back to the type's default. Without the null case an item could move from
 * default to a colour but never back.
 */
export function editShortcut(
  tabs: Tab[],
  tabId: string,
  itemId: string,
  name: string,
  url: string,
  icon?: IconSpec | null
): OpResult {
  const href = normalizeUrl(url)
  if (!href) return refuse(tabs, BAD_URL)
  return succeed(
    tabs.map((t) => {
      if (t.id !== tabId) return t
      return {
        ...t,
        items: t.items.map((i) =>
          i.id === itemId && i.type === "shortcut"
            ? { ...applyIcon(i, icon), name, url: href }
            : i
        ),
      }
    })
  )
}

export function editShortcutInFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcutId: string,
  name: string,
  url: string,
  icon?: IconSpec | null
): OpResult {
  const href = normalizeUrl(url)
  if (!href) return refuse(tabs, BAD_URL)
  return succeed(
    mapFolder(tabs, tabId, folderId, (f) => ({
      ...f,
      children: f.children.map((c) =>
        c.id === shortcutId ? { ...applyIcon(c, icon), name, url: href } : c
      ),
    }))
  )
}

export function editFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  name: string,
  icon?: IconSpec | null
): Tab[] {
  return mapFolder(tabs, tabId, folderId, (f) => ({ ...applyIcon(f, icon), name }))
}

function applyIcon<T extends { icon?: IconSpec }>(item: T, icon?: IconSpec | null): T {
  if (icon === undefined) return item
  if (icon === null) {
    const { icon: _dropped, ...rest } = item
    return rest as T
  }
  return { ...item, icon }
}

// --------------------------------------------------------------- removal

export function deleteItem(tabs: Tab[], tabId: string, itemId: string): Tab[] {
  return tabs.map((t) =>
    t.id === tabId ? { ...t, items: t.items.filter((i) => i.id !== itemId) } : t
  )
}

export function deleteShortcutFromFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcutId: string
): Tab[] {
  return mapFolder(tabs, tabId, folderId, (f) => ({
    ...f,
    children: f.children.filter((c) => c.id !== shortcutId),
  }))
}

/** Batch remove, top level and inside folders, across every tab. */
export function deleteItems(tabs: Tab[], itemIds: string[]): Tab[] {
  const ids = new Set(itemIds)
  if (ids.size === 0) return tabs
  return tabs.map((t) => ({
    ...t,
    items: t.items
      .filter((i) => !ids.has(i.id))
      .map((i) =>
        i.type === "folder"
          ? { ...i, children: i.children.filter((c) => !ids.has(c.id)) }
          : i
      ),
  }))
}

// -------------------------------------------------------------- movement

export function reorderItems(tabs: Tab[], tabId: string, from: number, to: number): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const items = [...t.items]
    const [moved] = items.splice(from, 1)
    if (!moved) return t
    items.splice(to, 0, moved)
    return { ...t, items }
  })
}

export function reorderFolderChildren(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  from: number,
  to: number
): Tab[] {
  return mapFolder(tabs, tabId, folderId, (f) => {
    const children = [...f.children]
    const [moved] = children.splice(from, 1)
    if (!moved) return f
    children.splice(to, 0, moved)
    return { ...f, children }
  })
}

/**
 * Pulls an item out from wherever it is. Returns `null` when the ID isn't
 * found — the previous version asserted non-null and handed callers
 * `undefined` typed as a `TabItem`.
 */
export function extractItem(tabs: Tab[], itemId: string): [Tab[], TabItem | null] {
  const found = locate(tabs, itemId)
  if (!found) return [tabs, null]
  const updated = found.folder
    ? deleteShortcutFromFolder(tabs, found.tab.id, found.folder.id, itemId)
    : deleteItem(tabs, found.tab.id, itemId)
  return [updated, found.item]
}

export function insertItem(
  tabs: Tab[],
  tabId: string,
  item: TabItem,
  index: number
): OpResult {
  const tab = findTab(tabs, tabId)
  if (!tab) return refuse(tabs, GONE)
  if (tab.items.length >= MAX_ITEMS_PER_TAB) return refuse(tabs, ITEMS_FULL)
  return succeed(
    tabs.map((t) => {
      if (t.id !== tabId) return t
      const items = [...t.items]
      items.splice(clamp(index, items.length), 0, item)
      return { ...t, items }
    })
  )
}

export function insertIntoFolder(
  tabs: Tab[],
  tabId: string,
  folderId: string,
  shortcut: Shortcut,
  index: number
): OpResult {
  const folder = findFolder(tabs, tabId, folderId)
  if (!folder) return refuse(tabs, GONE)
  if (folder.children.length >= MAX_CHILDREN_PER_FOLDER) return refuse(tabs, FOLDER_FULL)
  return succeed(
    mapFolder(tabs, tabId, folderId, (f) => {
      const children = [...f.children]
      children.splice(clamp(index, children.length), 0, shortcut)
      return { ...f, children }
    })
  )
}

const clamp = (index: number, length: number): number =>
  Math.max(0, Math.min(index, length))

/**
 * The move primitive every drag composes: take these items from wherever they
 * are and put them, in order, at one destination. Folders are skipped when the
 * destination is a folder, since folders can't nest.
 */
export function moveItems(
  tabs: Tab[],
  itemIds: string[],
  dest: { tabId: string; folderId?: string | null; index?: number }
): OpResult {
  const items: TabItem[] = []
  let working = tabs
  for (const id of itemIds) {
    const [next, item] = extractItem(working, id)
    if (!item) continue
    working = next
    items.push(item)
  }
  if (items.length === 0) return refuse(tabs, GONE)

  const intoFolder = dest.folderId != null
  const movable = intoFolder ? items.filter((i) => i.type === "shortcut") : items
  if (movable.length === 0) return refuse(tabs, "Folders can't go inside other folders.")

  const room = intoFolder
    ? folderCapacity(working, dest.tabId, dest.folderId!).free
    : itemCapacity(working, dest.tabId).free
  if (room < movable.length) {
    return refuse(tabs, intoFolder ? FOLDER_FULL : ITEMS_FULL)
  }

  let at = dest.index ?? Number.MAX_SAFE_INTEGER
  for (const item of movable) {
    const result = intoFolder
      ? insertIntoFolder(working, dest.tabId, dest.folderId!, item as Shortcut, at)
      : insertItem(working, dest.tabId, item, at)
    if (!result.ok) return refuse(tabs, result.reason ?? GONE)
    working = result.tabs
    if (at !== Number.MAX_SAFE_INTEGER) at++
  }

  const skipped = items.length - movable.length
  return skipped > 0
    ? { tabs: working, ok: true, reason: `${skipped} folder${skipped > 1 ? "s" : ""} skipped — folders can't nest.` }
    : succeed(working)
}

/**
 * Replaces the old hold-to-merge gesture: gather these top-level shortcuts
 * into a new folder placed where the first one was.
 */
export function createFolderFromItems(
  tabs: Tab[],
  tabId: string,
  itemIds: string[],
  name: string,
  icon?: IconSpec
): OpResult {
  const tab = findTab(tabs, tabId)
  if (!tab) return refuse(tabs, GONE)

  const ids = new Set(itemIds)
  const picked = tab.items.filter((i) => ids.has(i.id))
  const children = picked.filter((i): i is Shortcut => i.type === "shortcut")
  if (children.length === 0) return refuse(tabs, "Select at least one shortcut.")
  if (children.length > MAX_CHILDREN_PER_FOLDER) return refuse(tabs, FOLDER_FULL)

  const slot = tab.items.findIndex((i) => i.id === children[0].id)
  const folder: Folder = { type: "folder", id: uid(), name, children, ...withIcon(icon) }

  const kept = tab.items.filter((i) => !ids.has(i.id) || i.type === "folder")
  const before = tab.items.slice(0, slot).filter((i) => kept.includes(i)).length
  const items = [...kept.slice(0, before), folder, ...kept.slice(before)]

  const skipped = picked.length - children.length
  const result = tabs.map((t) => (t.id === tabId ? { ...t, items } : t))
  return skipped > 0
    ? { tabs: result, ok: true, reason: `${skipped} folder${skipped > 1 ? "s" : ""} skipped — folders can't nest.` }
    : succeed(result)
}

/** Alphabetises one container in place — the panel's "Sort by name" action. */
export function sortContainer(tabs: Tab[], tabId: string, folderId: string | null): Tab[] {
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })

  if (folderId) {
    return mapFolder(tabs, tabId, folderId, (f) => ({
      ...f,
      children: [...f.children].sort(byName),
    }))
  }
  return tabs.map((t) => (t.id === tabId ? { ...t, items: [...t.items].sort(byName) } : t))
}

/** Copies an item, giving it (and any children) fresh IDs. */
export function duplicateItem(item: TabItem): TabItem {
  if (item.type === "shortcut") return { ...item, id: uid() }
  return {
    ...item,
    id: uid(),
    children: item.children.map((c) => ({ ...c, id: uid() })),
  }
}
