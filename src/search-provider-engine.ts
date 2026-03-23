import { store } from "./store"
import type { SyncSettings } from "./defaults"
import type { SearchProvider, SearchResult } from "./search"

type Engine = SyncSettings["searchEngine"]

const ENGINE_URLS: Record<Engine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  yahoo: "https://search.yahoo.com/search?p=",
  duckduckgo: "https://duckduckgo.com/?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  qwant: "https://www.qwant.com/?q=",
  startpage: "https://www.startpage.com/sp/search?query=",
}

const ENGINE_NAMES: Record<Engine, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  qwant: "Qwant",
  startpage: "Startpage",
}

export const searchEngineProvider: SearchProvider = {
  id: "search-engine",
  order: 0,
  maxResults: 1,
  query(input: string): SearchResult[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    const engine = store.sync.get("searchEngine")
    const url = ENGINE_URLS[engine]
    const name = ENGINE_NAMES[engine]
    return [{
      label: `Search ${name} for '${trimmed}'`,
      action: () => window.open(url + encodeURIComponent(trimmed), "_blank"),
    }]
  },
}
