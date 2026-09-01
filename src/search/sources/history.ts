import { icon } from "../../icons/registry"
import { prettyUrl } from "../../url"
import { navigate } from "../../navigate"
import { faviconUrl } from "../../shortcut-icon"
import { historyAvailable, historySearch } from "../../history-api"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * The browser does the substring pass; the palette does the ranking. Asking for
 * more than the list will show gives the matcher something to choose from —
 * `chrome.history` orders by its own relevance, which knows nothing about how
 * you spell things.
 */
const FETCH_LIMIT = 60
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

/** Pages that can't be navigated to from an extension page, or shouldn't be. */
const HIDDEN = /^(chrome|edge|about|moz-extension|chrome-extension|brave|opera|vivaldi|view-source|devtools):/i

export function pageIcon(url: string): HTMLElement {
  const src = faviconUrl(url, 32)
  if (!src) return icon("globe", { size: 16 })

  const img = document.createElement("img")
  img.src = src
  img.width = 16
  img.height = 16
  img.loading = "lazy"
  img.className = "shrink-0 rounded-[3px] w-4 h-4 object-contain"
  img.addEventListener("error", () => img.replaceWith(icon("globe", { size: 16 })), {
    once: true,
  })
  return img
}

/** Recency and how often you go there, folded into one 0–1 signal. */
export function visitBoost(lastVisit: number | undefined, visits: number | undefined): number {
  const age = lastVisit ? Date.now() - lastVisit : MONTH_MS
  const recency = Math.max(0, 1 - age / MONTH_MS)
  const frequency = Math.min(1, Math.log2(1 + (visits ?? 0)) / 6)
  return recency * 0.6 + frequency * 0.4
}

export function relativeTime(at: number): string {
  const delta = Date.now() - at
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

export const historySource: SearchSource = {
  id: "history",
  label: "History",
  token: "hist",
  glyph: "refresh",
  weight: 1.05,
  limit: 5,
  scopedLimit: 25,
  debounce: 60,
  available: historyAvailable,
  unavailable: () => ({ message: "This browser exposes no history API." }),
  async query(ctx: QueryContext): Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (!query && !ctx.scoped) return []

    const items = await historySearch({ text: query, maxResults: FETCH_LIMIT })
    if (ctx.signal.aborted) return []

    const seen = new Set<string>()
    const out: Candidate[] = []

    for (const item of items) {
      const url = item.url
      if (!url || HIDDEN.test(url)) continue
      if (seen.has(url)) continue
      seen.add(url)

      out.push({
        id: `history:${url}`,
        title: item.title?.trim() || prettyUrl(url),
        subtitle: prettyUrl(url),
        detail: item.lastVisitTime ? relativeTime(item.lastVisitTime) : undefined,
        haystack: [url],
        boost: visitBoost(item.lastVisitTime, item.visitCount),
        icon: () => pageIcon(url),
        copyValue: url,
        run: (mode) => navigate(url, "search", mode === "newTab" ? "newTab" : "default"),
        actions: [
          { id: "open", label: "Open", glyph: "externalLink", run: () => navigate(url, "search") },
          {
            id: "new-tab",
            label: "Open in new tab",
            glyph: "tab",
            run: () => navigate(url, "search", "newTab"),
          },
        ],
      })
    }

    return out
  },
  idle(ctx: QueryContext): Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" }) as Promise<Candidate[]>
  },
}
