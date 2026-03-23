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
