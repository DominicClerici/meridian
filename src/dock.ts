import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover } from "./components"
import { getRecommendations } from "./recommendations"
import type { Tab, Folder, Shortcut, TabItem } from "./shortcuts"

const SWATCH_HEX: Record<string, string> = {
  rose: "#f43f5e",
  coral: "#f97316",
  amber: "#f59e0b",
  teal: "#14b8a6",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  slate: "#64748b",
  stone: "#78716c",
  zinc: "#71717a",
  graphite: "#57534e",
}

let wrapperEl: HTMLElement
let suggestionsEl: HTMLElement
let dividerEl: HTMLElement
let itemsEl: HTMLElement
let tabsEl: HTMLElement
let activeTabId: string | null = null
let labelEls: HTMLElement[] = []

function getTabs(): Tab[] {
  return store.local.get("shortcuts") ?? []
}

function getActiveTabDomains(tab: Tab): Set<string> {
  const domains = new Set<string>()
  for (const item of tab.items) {
    if (item.type === "shortcut") {
      try { domains.add(new URL(item.url).hostname.replace(/^www\./, "")) } catch {}
    } else {
      for (const child of item.children) {
        try { domains.add(new URL(child.url).hostname.replace(/^www\./, "")) } catch {}
      }
    }
  }
  return domains
}

function faviconUrl(url: string): string {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch {
    return ""
  }
}

function navigate(url: string): void {
  const openIn = store.sync.get("shortcutsOpenIn")
  if (openIn === "new") {
    window.open(url, "_blank", "noopener")
  } else {
    window.location.href = url
  }
}

function renderItemIcon(item: Shortcut | Folder): HTMLElement {
  if (item.type === "shortcut") {
    const ic = item.icon
    if (ic?.type === "color") {
      const el = document.createElement("span")
      el.className = "dock-item-color"
      el.style.background = SWATCH_HEX[ic.color] ?? ic.color
      el.textContent = item.name.charAt(0)
      return el
    }
    const img = document.createElement("img")
    img.className = "dock-item-favicon"
    img.src = faviconUrl(item.url)
    img.alt = ""
    img.loading = "lazy"
    img.addEventListener("error", () => {
      const fallback = icon("link", { size: 20 })
      fallback.classList.add("text-page-foreground", "opacity-60")
      img.replaceWith(fallback)
    })
    return img
  }

  const ic = item.icon
  if (ic?.type === "color") {
    const el = document.createElement("span")
    el.className = "dock-item-color"
    el.style.background = SWATCH_HEX[ic.color] ?? ic.color
    el.textContent = item.name.charAt(0)
    return el
  }
  const folderIcon = icon("folder", { size: 22 })
  folderIcon.classList.add("text-page-foreground", "opacity-70")
  return folderIcon
}

function positionLabel(btn: HTMLElement, label: HTMLElement): void {
  const r = btn.getBoundingClientRect()
  const lr = label.getBoundingClientRect()
  label.style.top = `${r.top - lr.height - 6}px`
  label.style.left = `${r.left + r.width / 2 - lr.width / 2}px`
}

function attachLabel(btn: HTMLElement, text: string): void {
  const label = document.createElement("span")
  label.className = "dock-item-label"
  label.textContent = text
  document.body.appendChild(label)

  btn.addEventListener("mouseenter", () => {
    label.style.opacity = "1"
    positionLabel(btn, label)
  })
  btn.addEventListener("mouseleave", () => {
    label.style.opacity = "0"
  })

  labelEls.push(label)
}

function createDockItem(
  item: TabItem,
  opts?: { suggestion?: boolean }
): HTMLElement {
  const btn = document.createElement("button")
  btn.className = "dock-item" + (opts?.suggestion ? " dock-suggestion" : "")
  btn.setAttribute("aria-label", item.name)

  btn.appendChild(renderItemIcon(item))
  attachLabel(btn, item.name)

  if (item.type === "shortcut") {
    btn.addEventListener("click", () => navigate(item.url))
  } else {
    btn.addEventListener("click", () => openFolderPopover(btn, item))
  }

  return btn
}

function createSuggestionItem(rec: { name: string; url: string }): HTMLElement {
  const btn = document.createElement("button")
  btn.className = "dock-item dock-suggestion"
  btn.setAttribute("aria-label", rec.name)

  const img = document.createElement("img")
  img.className = "dock-item-favicon"
  img.src = faviconUrl(rec.url)
  img.alt = ""
  img.loading = "lazy"
  img.addEventListener("error", () => {
    const fallback = icon("sparkle", { size: 18 })
    fallback.classList.add("text-page-foreground", "opacity-50")
    img.replaceWith(fallback)
  })
  btn.appendChild(img)
  attachLabel(btn, rec.name)

  btn.addEventListener("click", () => navigate(rec.url))
  return btn
}

function openFolderPopover(anchor: HTMLElement, folder: Folder): void {
  const content = document.createElement("div")
  let closePopover: (() => void) | null = null

  const header = document.createElement("div")
  header.className = "flex items-center gap-2 pb-2 border-b border-input-border/15 mb-1"
  const headerIcon = renderItemIcon(folder)
  headerIcon.style.width = "18px"
  headerIcon.style.height = "18px"
  header.appendChild(headerIcon)
  const headerName = document.createElement("span")
  headerName.className = "text-sm font-medium text-foreground"
  headerName.textContent = folder.name
  header.appendChild(headerName)
  content.appendChild(header)

  if (folder.children.length === 0) {
    const empty = document.createElement("div")
    empty.className = "text-xs text-muted py-4 text-center"
    empty.textContent = "Empty folder"
    content.appendChild(empty)
  } else {
    const grid = document.createElement("div")
    grid.className = "dock-folder-grid"

    for (const child of folder.children) {
      const item = document.createElement("button")
      item.className = "dock-folder-item"

      const childIcon = renderItemIcon(child)
      childIcon.style.width = "28px"
      childIcon.style.height = "28px"
      if (childIcon.tagName === "IMG") {
        (childIcon as HTMLImageElement).style.borderRadius = "6px"
      }
      item.appendChild(childIcon)

      const name = document.createElement("span")
      name.className = "dock-folder-item-name"
      name.textContent = child.name
      item.appendChild(name)

      item.addEventListener("click", (e) => {
        e.stopPropagation()
        navigate(child.url)
        closePopover?.()
      })

      grid.appendChild(item)
    }

    content.appendChild(grid)
  }

  const { close } = createPopover(anchor, content)
  closePopover = close
}

function cleanupLabels(): void {
  for (const el of labelEls) el.remove()
  labelEls = []
}

function render(): void {
  cleanupLabels()
  const tabs = getTabs()

  if (tabs.length === 0) {
    wrapperEl.hidden = true
    return
  }

  wrapperEl.hidden = false

  if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id
  }

  const tab = tabs.find((t) => t.id === activeTabId)!

  // Render tab buttons
  tabsEl.innerHTML = ""
  if (tabs.length > 1) {
    for (const t of tabs) {
      const btn = document.createElement("button")
      btn.className = "dock-tab-btn"
      btn.textContent = t.name
      btn.setAttribute("aria-selected", String(t.id === activeTabId))
      btn.addEventListener("click", () => {
        activeTabId = t.id
        render()
      })
      tabsEl.appendChild(btn)
    }
  }

  // Render suggestions
  suggestionsEl.innerHTML = ""
  const domains = getActiveTabDomains(tab)
  const recs = getRecommendations(domains)

  if (recs.length > 0) {
    suggestionsEl.hidden = false
    dividerEl.hidden = false
    for (const rec of recs) {
      suggestionsEl.appendChild(createSuggestionItem(rec))
    }
  } else {
    suggestionsEl.hidden = true
    dividerEl.hidden = true
  }

  // Render dock items
  itemsEl.innerHTML = ""
  for (const item of tab.items) {
    itemsEl.appendChild(createDockItem(item))
  }
}

export function initDock(): void {
  wrapperEl = document.getElementById("dock-wrapper")!
  suggestionsEl = document.getElementById("dock-suggestions")!
  dividerEl = document.getElementById("dock-divider")!
  itemsEl = document.getElementById("dock-items")!
  tabsEl = document.getElementById("dock-tabs")!

  render()

  store.local.subscribe("shortcuts", () => render())
  store.sync.subscribe("recommendationsEnabled", () => render())
}
