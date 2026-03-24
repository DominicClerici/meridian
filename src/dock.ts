import { store } from "./store"
import type { Tab, TabItem, Folder } from "./shortcuts"
import { getRecommendations } from "./recommendations"

let activeTabId: string | null = null
let openPopover: HTMLElement | null = null

function getTabs(): Tab[] {
  return store.local.get("shortcuts")
}

function getActiveTabDomains(tab: Tab): Set<string> {
  const domains = new Set<string>()
  for (const item of tab.items) {
    if (item.type === "shortcut") {
      try {
        let h = new URL(item.url).hostname
        if (h.startsWith("www.")) h = h.slice(4)
        if (h) domains.add(h)
      } catch { /* skip invalid URLs */ }
    } else if (item.type === "folder") {
      for (const child of item.children) {
        try {
          let h = new URL(child.url).hostname
          if (h.startsWith("www.")) h = h.slice(4)
          if (h) domains.add(h)
        } catch { /* skip invalid URLs */ }
      }
    }
  }
  return domains
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
        const wasThisFolder = openPopover.dataset.folderId === item.id
        closeDockPopover()
        if (wasThisFolder) return
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
  popover.dataset.folderId = folder.id

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

  const recs = getRecommendations(getActiveTabDomains(activeTab))
  if (recs.length > 0) {
    const divider = document.createElement("div")
    divider.className = "border-l border-white/20 self-stretch ml-2 mr-2"
    itemsContainer.appendChild(divider)

    for (const rec of recs) {
      const btn = document.createElement("button")
      btn.className =
        "px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-sm whitespace-nowrap"
      btn.textContent = "\u2726 " + rec.name
      btn.addEventListener("click", () => {
        window.open(rec.url, "_blank")
      })
      itemsContainer.appendChild(btn)
    }
  }
}

export function initDock(): void {
  render()
  store.local.subscribe("shortcuts", render)
  store.sync.subscribe("recommendationsEnabled", render)
  store.local.subscribe("recommendationData", render)
}
