import { store } from "./store"
import type { Tab, Shortcut } from "./shortcuts"
import type { SearchProvider, SearchResult } from "./search"

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
    const matches: SearchResult[] = []
    for (const sc of all) {
      if (matches.length >= 3) break
      if (
        sc.name.toLowerCase().includes(trimmed) ||
        sc.url.toLowerCase().includes(trimmed)
      ) {
        const url = sc.url
        matches.push({
          label: sc.name,
          description: sc.url,
          action: () => window.open(url, "_blank"),
        })
      }
    }
    return matches
  },
}
