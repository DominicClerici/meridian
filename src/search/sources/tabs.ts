import { prettyUrl } from "../../url"
import {
  activateTab,
  currentTabId,
  queryTabs,
  requestTabs,
  tabsGranted,
  tabsSupported,
} from "../../tabs-api"
import { pageIcon } from "./history"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * Switching to a tab you already have open, instead of opening a second copy of
 * it. `tabs` is optional, and without the grant the query still resolves — it
 * just omits `url` and `title`, which is the whole of what this needs, so the
 * grant is checked rather than inferred.
 */

let granted = false
let selfId: number | null = null

export function primeTabs(): void {
  if (!tabsSupported()) return
  tabsGranted().then((ok) => {
    granted = ok
    if (ok) currentTabId().then((id) => (selfId = id))
  })
}

export const tabsSource: SearchSource = {
  id: "tabs",
  label: "Open tabs",
  token: "tab",
  glyph: "tab",
  // Something already open is nearly always a better answer than a page about it.
  weight: 1.35,
  limit: 3,
  scopedLimit: 25,
  available: () => granted && tabsSupported(),
  unavailable: () => {
    if (!tabsSupported()) return { message: "This browser exposes no tabs API." }
    return {
      message: "Searching open tabs needs a one-time permission.",
      action: {
        id: "grant",
        label: "Allow tab access",
        glyph: "tab",
        keepOpen: true,
        run: () => {
          requestTabs().then((ok) => {
            granted = ok
            if (ok) currentTabId().then((id) => (selfId = id))
          })
        },
      },
    }
  },
  async query(ctx: QueryContext): Promise<Candidate[]> {
    if (!ctx.text.trim() && !ctx.scoped) return []

    const tabs = await queryTabs()
    if (ctx.signal.aborted) return []

    return tabs
      .filter((tab) => tab.id !== undefined && tab.id !== selfId && tab.url)
      .map((tab) => ({
        id: `tab:${tab.id}`,
        title: tab.title?.trim() || prettyUrl(tab.url!),
        subtitle: prettyUrl(tab.url!),
        detail: tab.audible ? "playing" : tab.pinned ? "pinned" : "open",
        haystack: [tab.url!],
        icon: () => pageIcon(tab.url!),
        copyValue: tab.url,
        run: () => activateTab(tab.id!, tab.windowId),
        actions: [
          {
            id: "switch",
            label: "Switch to tab",
            glyph: "tab",
            run: () => activateTab(tab.id!, tab.windowId),
          },
        ],
      }))
  },
  idle(ctx: QueryContext): Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" }) as Promise<Candidate[]>
  },
}
