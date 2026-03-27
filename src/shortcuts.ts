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

export const MAX_TABS = 6
export const MAX_ITEMS_PER_TAB = 256
export const MAX_CHILDREN_PER_FOLDER = 64

export function addTab(tabs: Tab[], name: string): Tab[] {
  if (tabs.length >= MAX_TABS) return tabs
  return [...tabs, { id: crypto.randomUUID(), name, items: [] }]
}

export function deleteTab(tabs: Tab[], tabId: string): Tab[] {
  return tabs.filter((t) => t.id !== tabId)
}

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
