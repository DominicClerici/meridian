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

const ENGINE_SVGS: Record<Engine, string> = {
  google: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
  bing: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#008373" d="M5 3v16.5l4.5 2.5 7-4.5 1-2.5-5-2.5V3z"/><path fill="#00A68E" d="M9.5 8v11l7-4.5-5-2.5z"/><path fill="#00C9A7" d="M5 3l4.5 5v6L5 19.5z"/></svg>`,
  yahoo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#6001D2" d="M14.54 3H21l-5.41 8.82L21 21h-4.67l-3.87-5.7L8.57 21H2l6.48-9.18L2 3h6.49l3 4.76z"/></svg>`,
  duckduckgo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#DE5833" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle fill="#DE5833" cx="9" cy="10" r="1.5"/><circle fill="#DE5833" cx="15" cy="10" r="1.5"/><path fill="#DE5833" d="M12 16c-2.21 0-4-1.34-4-3h8c0 1.66-1.79 3-4 3z"/></svg>`,
  ecosia: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#36ACBF" cx="12" cy="12" r="10"/><path fill="#fff" d="M12 6a6 6 0 0 0-6 6c0 2.5 1.5 4.6 3.6 5.5L12 12l2.4 5.5A6 6 0 0 0 12 6z"/></svg>`,
  qwant: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#5C2D91" cx="12" cy="12" r="10"/><path fill="#fff" d="M15.5 16.5l-2-3.5h-3l-2 3.5M8.5 13h7M12 7.5V13"/></svg>`,
  startpage: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#6573FF" cx="12" cy="12" r="10"/><path fill="#fff" d="M10 8l6 4-6 4z"/></svg>`,
}

function engineIcon(engine: Engine): HTMLElement {
  const span = document.createElement("span")
  span.className = "shrink-0 flex items-center justify-center w-4 h-4"
  span.innerHTML = ENGINE_SVGS[engine]
  return span
}

export const searchEngineProvider: SearchProvider = {
  id: "search-engine",
  order: 0,
  maxResults: 1,
  query(input: string): SearchResult[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    const engine = store.sync.get("searchEngine")
    const url = ENGINE_URLS[engine] + encodeURIComponent(trimmed)
    const name = ENGINE_NAMES[engine]
    const newTab = store.sync.get("searchOpenInNewTab")
    return [{
      label: `Search ${name} for '${trimmed}'`,
      icon: engineIcon(engine),
      group: "search-engine",
      action: () => {
        if (newTab) window.open(url, "_blank")
        else location.href = url
      },
    }]
  },
}
