import { store } from "./store"
import { prettyUrl } from "./url"
import { renderIcon } from "./shortcut-icon"
import type { Tab, Shortcut } from "./shortcuts"
import type { SearchProvider, SearchResult } from "./search"

function shortcutIcon(sc: Shortcut): HTMLElement {
  return renderIcon(sc.icon, { kind: "shortcut", name: sc.name, url: sc.url }, { size: 16 })
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
