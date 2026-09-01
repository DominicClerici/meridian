import { prettyUrl } from "../../url"
import { navigate } from "../../navigate"
import {
  bookmarksGetTree,
  bookmarksGranted,
  bookmarksSupported,
  requestBookmarks,
} from "../../bookmarks-api"
import { pageIcon } from "./history"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * `getTree` walks the whole tree and allocates the lot, which is far too much
 * to redo on every keystroke — and bookmarks change on the order of days, not
 * milliseconds. Cached, with the permission state cached alongside it so
 * `available()` can stay synchronous.
 */
const TTL = 60_000

type Entry = { id: string; title: string; url: string; folder: string; added: number }

let cache: Entry[] = []
let cachedAt = 0
let granted = false
let loading: Promise<void> | null = null

function walk(nodes: BookmarkTreeNode[], folder: string, out: Entry[]): void {
  for (const node of nodes) {
    if (node.url) {
      out.push({
        id: node.id,
        title: node.title || prettyUrl(node.url),
        url: node.url,
        folder,
        added: node.dateAdded ?? 0,
      })
    }
    if (node.children) {
      walk(node.children, node.title ? (folder ? `${folder} / ${node.title}` : node.title) : folder, out)
    }
  }
}

function refresh(): Promise<void> {
  if (loading) return loading
  loading = bookmarksGetTree()
    .then((tree) => {
      const out: Entry[] = []
      walk(tree, "", out)
      cache = out
      cachedAt = Date.now()
    })
    .catch(() => {
      cache = []
      cachedAt = Date.now()
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** Refreshed on open rather than polled — see `initSearch`. */
export function primeBookmarks(): void {
  if (!bookmarksSupported()) return
  bookmarksGranted().then((ok) => {
    granted = ok
    if (ok && Date.now() - cachedAt > TTL) refresh()
  })
}

export const bookmarksSource: SearchSource = {
  id: "bookmarks",
  label: "Bookmarks",
  token: "bm",
  glyph: "star",
  weight: 1.15,
  limit: 4,
  scopedLimit: 25,
  available: () => granted && bookmarksSupported(),
  unavailable: () => {
    if (!bookmarksSupported()) {
      return { message: "This browser exposes no bookmarks API." }
    }
    return {
      message: "Searching bookmarks needs a one-time permission.",
      action: {
        id: "grant",
        label: "Allow bookmark access",
        glyph: "star",
        keepOpen: true,
        // Synchronous with the click on purpose: Chrome rejects a permission
        // request that isn't.
        run: () => {
          requestBookmarks().then((ok) => {
            granted = ok
            if (ok) refresh()
          })
        },
      },
    }
  },
  async query(ctx: QueryContext): Promise<Candidate[]> {
    if (!ctx.text.trim() && !ctx.scoped) return []
    if (Date.now() - cachedAt > TTL) await refresh()
    if (ctx.signal.aborted) return []

    return cache.map((entry) => ({
      id: `bookmark:${entry.id}`,
      title: entry.title,
      subtitle: prettyUrl(entry.url),
      detail: entry.folder || undefined,
      haystack: [entry.url],
      icon: () => pageIcon(entry.url),
      copyValue: entry.url,
      run: (mode) => navigate(entry.url, "search", mode === "newTab" ? "newTab" : "default"),
      actions: [
        { id: "open", label: "Open", glyph: "externalLink", run: () => navigate(entry.url, "search") },
        {
          id: "new-tab",
          label: "Open in new tab",
          glyph: "tab",
          run: () => navigate(entry.url, "search", "newTab"),
        },
      ],
    }))
  },
  idle(ctx: QueryContext): Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" }) as Promise<Candidate[]>
  },
}
