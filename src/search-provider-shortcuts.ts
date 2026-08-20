import { store } from "./store"
import { prettyUrl } from "./url"
import { icon as makeIcon } from "./icons/registry"
import type { Tab, Shortcut } from "./shortcuts"
import type { SearchProvider, SearchResult } from "./search"

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

function faviconUrl(url: string): string {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch {
    return ""
  }
}

function shortcutIcon(sc: Shortcut): HTMLElement {
  const ic = sc.icon
  if (ic?.type === "color") {
    const el = document.createElement("span")
    el.className = "shrink-0 w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
    el.style.background = SWATCH_HEX[ic.color] ?? ic.color
    el.textContent = sc.name.charAt(0)
    return el
  }
  const wrap = document.createElement("span")
  wrap.className = "shrink-0 flex items-center justify-center w-4 h-4"
  const img = document.createElement("img")
  img.className = "w-4 h-4 rounded-sm"
  img.src = faviconUrl(sc.url)
  img.alt = ""
  img.loading = "lazy"
  img.addEventListener("error", () => {
    const fallback = makeIcon("link", { size: 14 })
    fallback.classList.add("text-muted")
    wrap.replaceChildren(fallback)
  })
  wrap.appendChild(img)
  return wrap
}

function flattenShortcuts(tabs: Tab[]): Shortcut[] {
  const result: Shortcut[] = []
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.type === "shortcut") {
        result.push(item)
      } else {
        for (const child of item.children) {
          result.push(child)
        }
      }
    }
  }
  return result
}

export const shortcutsProvider: SearchProvider = {
  id: "shortcuts",
  order: 1,
  maxResults: 3,
  debounced: true,
  query(input: string): SearchResult[] {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed) return []
    const all = flattenShortcuts(store.local.get("shortcuts"))
    const newTab = store.sync.get("searchOpenInNewTab")
    const matches: SearchResult[] = []
    for (const sc of all) {
      if (matches.length >= this.maxResults) break
      if (
        sc.name.toLowerCase().includes(trimmed) ||
        sc.url.toLowerCase().includes(trimmed)
      ) {
        const url = sc.url
        matches.push({
          label: sc.name,
          description: prettyUrl(sc.url),
          icon: shortcutIcon(sc),
          group: "shortcuts",
          action: () => {
            if (newTab) window.open(url, "_blank")
            else location.href = url
          },
        })
      }
    }
    return matches
  },
}
