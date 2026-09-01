import { store } from "../../store"
import { icon } from "../../icons/registry"
import { normalizeUrl, prettyUrl } from "../../url"
import { navigate } from "../../navigate"
import type { SyncSettings } from "../../defaults"
import type { Candidate, QueryContext, SearchSource } from "../types"

export type Engine = SyncSettings["searchEngine"]

const ENGINE_URLS: Record<Engine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  yahoo: "https://search.yahoo.com/search?p=",
  duckduckgo: "https://duckduckgo.com/?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  qwant: "https://www.qwant.com/?q=",
  startpage: "https://www.startpage.com/sp/search?query=",
}

export const ENGINE_NAMES: Record<Engine, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  qwant: "Qwant",
  startpage: "Startpage",
}

/**
 * Drawn inline rather than fetched, so the palette owes nothing to the network
 * to paint its first row — and so choosing DuckDuckGo doesn't quietly call
 * Google's favicon service for the logo.
 */
const ENGINE_SVGS: Record<Engine, string> = {
  google: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
  bing: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><defs><linearGradient id="sp-bing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#37bdff"/><stop offset="1" stop-color="#1b6ec2"/></linearGradient></defs><path fill="url(#sp-bing)" d="M6 2.2 9.9 3.6v12.7l5.2-3-2.5-1.2-1.6-4 7.9 2.8v4.4L9.9 21.8 6 19.5z"/></svg>`,
  yahoo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#5F01D1" d="M2 6.1h3.9l2.7 6.9 2.7-6.9h3.8l-6 14.3H5.3l1.6-3.7z"/><circle fill="#5F01D1" cx="17.6" cy="18.3" r="2.1"/><path fill="#5F01D1" d="M18.2 3.6H22l-3.4 8.2h-3.3z"/></svg>`,
  duckduckgo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#DE5833" cx="12" cy="12" r="10"/><path fill="#fff" d="M13.6 21.8c-.5-2-1.2-4.4-1.6-6.6-.5-2.6-.6-4.6-.2-6 .4-1.4 1.4-2.2 2.7-2.2 1.5 0 2.5 1 2.5 2.4 0 .7-.2 1.3-.5 2 .9.3 1.6.9 2 1.7l-3 .8.5.7 2.8-.7c.3 1.4.1 3-.6 4.5-.9 1.7-2.4 3-4.6 3.4z"/><circle fill="#2D4F8E" cx="14.3" cy="9" r="1.1"/><circle fill="#fff" cx="14.6" cy="8.7" r=".35"/><path fill="#67BD5B" d="M8.6 21.2a10 10 0 0 1-3.3-2.6l1.4-6.9 2.6.7z"/></svg>`,
  ecosia: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle fill="#0D7E4C" cx="12" cy="12" r="10"/><path fill="#fff" d="M17.4 13.6c-1 3-3.6 4.9-6.6 4.7-.6 0-1.2-.2-1.7-.4l1.3-1.9c2-.2 3.7-1.4 4.6-3.2zM6.6 15.6c-1-1.6-1.2-3.6-.5-5.4C7.2 7.1 10.4 5.4 13.6 6c1.4.3 2.6 1 3.5 2l-8.4 4.9 1 1.7z"/></svg>`,
  qwant: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="#F5164E" d="M12 2a10 10 0 1 0 4.6 18.9l-2-3.3-1.3 2.6-2.4-4.7h4.3A6 6 0 1 1 18 12c0 1.3-.4 2.5-1.1 3.5l2 3.3A10 10 0 0 0 12 2z"/></svg>`,
  startpage: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><rect fill="#6573FF" x="2" y="2" width="20" height="20" rx="6"/><path fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" d="M14.4 14.4 17 17"/><circle fill="none" stroke="#fff" stroke-width="1.9" cx="11" cy="11" r="3.6"/></svg>`,
}

export function engineIcon(engine: Engine): HTMLElement {
  const span = document.createElement("span")
  span.className = "shrink-0 flex items-center justify-center w-4 h-4"
  span.innerHTML = ENGINE_SVGS[engine]
  return span
}

export function engineUrl(engine: Engine, query: string): string {
  return ENGINE_URLS[engine] + encodeURIComponent(query)
}

/* ── Bangs ──────────────────────────────────────────────────────────────── */

export type Bang = { keys: string[]; name: string; url: string; engine?: Engine }

/**
 * DuckDuckGo's `!` convention, cut down to the ones worth muscle memory. The
 * engine bangs re-target the built-in row; the rest are their own destinations.
 */
export const BANGS: Bang[] = [
  { keys: ["g", "google"], name: "Google", url: "", engine: "google" },
  { keys: ["b", "bing"], name: "Bing", url: "", engine: "bing" },
  { keys: ["y", "yahoo"], name: "Yahoo", url: "", engine: "yahoo" },
  { keys: ["d", "ddg", "duck"], name: "DuckDuckGo", url: "", engine: "duckduckgo" },
  { keys: ["e", "ecosia"], name: "Ecosia", url: "", engine: "ecosia" },
  { keys: ["q", "qwant"], name: "Qwant", url: "", engine: "qwant" },
  { keys: ["sp", "startpage"], name: "Startpage", url: "", engine: "startpage" },
  { keys: ["yt", "youtube"], name: "YouTube", url: "https://www.youtube.com/results?search_query=" },
  { keys: ["gh", "github"], name: "GitHub", url: "https://github.com/search?q=" },
  { keys: ["w", "wiki", "wikipedia"], name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=" },
  { keys: ["so", "stackoverflow"], name: "Stack Overflow", url: "https://stackoverflow.com/search?q=" },
  { keys: ["mdn"], name: "MDN", url: "https://developer.mozilla.org/en-US/search?q=" },
  { keys: ["npm"], name: "npm", url: "https://www.npmjs.com/search?q=" },
  { keys: ["r", "reddit"], name: "Reddit", url: "https://www.reddit.com/search/?q=" },
  { keys: ["a", "amazon"], name: "Amazon", url: "https://www.amazon.com/s?k=" },
  { keys: ["maps"], name: "Maps", url: "https://www.google.com/maps/search/" },
  { keys: ["tr", "translate"], name: "Translate", url: "https://translate.google.com/?text=" },
]

export function findBang(key: string): Bang | undefined {
  const lower = key.toLowerCase()
  return BANGS.find((b) => b.keys.includes(lower))
}

/* ── The web-search row ─────────────────────────────────────────────────── */

/**
 * Pinned to the bottom rather than the top. It is always available, so it is
 * the escape hatch you fall back to, not the thing you have to arrow past to
 * reach the tab you already had open. With nothing else matching it is the only
 * row, so Enter still searches the web without a detour.
 */
export const engineSource: SearchSource = {
  id: "engine",
  label: "Web",
  token: "web",
  glyph: "search",
  weight: 1,
  limit: 1,
  available: () => true,
  query(ctx: QueryContext): Candidate[] {
    const query = ctx.text.trim()
    if (!query) return []

    const bang = ctx.bang ? findBang(ctx.bang) : undefined
    const engine = bang?.engine ?? store.sync.get("searchEngine")
    const target = bang && !bang.engine ? bang.url + encodeURIComponent(query) : engineUrl(engine, query)
    const name = bang && !bang.engine ? bang.name : ENGINE_NAMES[engine]

    return [
      {
        id: `engine:${bang?.name ?? engine}`,
        title: query,
        subtitle: `Search ${name}`,
        icon: () =>
          bang && !bang.engine ? icon("search", { size: 16 }) : engineIcon(engine),
        pin: "bottom",
        copyValue: target,
        run: (mode) => navigate(target, "search", mode === "newTab" ? "newTab" : "default"),
      },
    ]
  },
}

/* ── Direct navigation ──────────────────────────────────────────────────── */

/** Only what could actually be an address — `normalizeUrl` rejects the rest. */
function asUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  if (!trimmed.includes(".") && !trimmed.includes(":")) return null
  return normalizeUrl(trimmed) || null
}

export const navigationSource: SearchSource = {
  id: "navigation",
  label: "Go to",
  token: "",
  glyph: "globe",
  weight: 1,
  limit: 1,
  available: () => true,
  query(ctx: QueryContext): Candidate[] {
    const href = asUrl(ctx.text)
    if (!href) return []
    return [
      {
        id: `goto:${href}`,
        title: prettyUrl(href),
        subtitle: "Open address",
        icon: () => icon("globe", { size: 16 }),
        pin: "top",
        copyValue: href,
        run: (mode) => navigate(href, "search", mode === "newTab" ? "newTab" : "default"),
      },
    ]
  },
}

/* ── Engine autocomplete ────────────────────────────────────────────────── */

/**
 * The only source that talks to a third party, and the only one off by default:
 * it sends what you are typing to the search engine before you have decided to
 * search. The host grant is optional and requested when the setting is flipped.
 */
const SUGGEST_ENDPOINTS: Partial<Record<Engine, string>> = {
  google: "https://suggestqueries.google.com/complete/search?client=firefox&q=",
  bing: "https://api.bing.com/osjson.aspx?query=",
  duckduckgo: "https://duckduckgo.com/ac/?type=list&q=",
  ecosia: "https://ac.ecosia.org/autocomplete?type=list&q=",
}

export const SUGGEST_ORIGINS = [
  "https://suggestqueries.google.com/*",
  "https://api.bing.com/*",
  "https://duckduckgo.com/*",
  "https://ac.ecosia.org/*",
]

export const suggestionsSource: SearchSource = {
  id: "suggestions",
  label: "Suggestions",
  token: "",
  glyph: "search",
  weight: 0.62,
  limit: 3,
  debounce: 170,
  available: () =>
    store.sync.get("searchSuggestions") &&
    Boolean(SUGGEST_ENDPOINTS[store.sync.get("searchEngine")]),
  async query(ctx: QueryContext): Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (query.length < 2) return []

    const engine = store.sync.get("searchEngine")
    const endpoint = SUGGEST_ENDPOINTS[engine]
    if (!endpoint) return []

    let payload: unknown
    try {
      const res = await fetch(endpoint + encodeURIComponent(query), {
        signal: ctx.signal,
      })
      if (!res.ok) return []
      payload = await res.json()
    } catch {
      return []
    }

    // Every one of these endpoints answers with OpenSearch's `[query, [terms]]`.
    const terms = Array.isArray(payload) ? payload[1] : null
    if (!Array.isArray(terms)) return []

    return terms
      .filter((t): t is string => typeof t === "string" && t.toLowerCase() !== query.toLowerCase())
      .slice(0, ctx.limit)
      .map((term) => ({
        id: `suggest:${term}`,
        title: term,
        prematched: true,
        icon: () => icon("search", { size: 15, class: "opacity-45" }),
        copyValue: term,
        run: (mode) =>
          navigate(engineUrl(engine, term), "search", mode === "newTab" ? "newTab" : "default"),
      }))
  },
}
