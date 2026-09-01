import { icon } from "../icons/registry"
import { store } from "../store"
import { navigate } from "../navigate"
import { getRecommendations } from "../recommendations"
import { recentQueries } from "./recents"
import { pageIcon } from "./sources/history"
import type { Ranked } from "./types"

/**
 * What an open-but-empty palette shows.
 *
 * Built directly rather than routed through a source, because none of it is a
 * search: these rows aren't matched against anything, and the moment a
 * character is typed they are all replaced.
 */

const MAX_RECENT = 5
const MAX_SUGGESTED = 4

export function emptyState(onQuery: (text: string) => void): Ranked[] {
  const rows: Ranked[] = []

  for (const recent of recentQueries(MAX_RECENT)) {
    rows.push({
      candidate: {
        id: `recent:${recent.text}`,
        title: recent.text,
        icon: () => icon("refresh", { size: 15, class: "opacity-45" }),
        copyValue: recent.text,
        keepOpen: true,
        run: () => onQuery(recent.text),
      },
      source: null,
      group: "Recent",
      score: 0,
    })
  }

  for (const suggestion of suggested()) {
    rows.push({
      candidate: {
        id: `suggested:${suggestion.url}`,
        title: suggestion.name,
        icon: () => pageIcon(suggestion.url),
        copyValue: suggestion.url,
        run: (mode) =>
          navigate(suggestion.url, "search", mode === "newTab" ? "newTab" : "default"),
      },
      source: null,
      group: "Suggested",
      score: 0,
    })
  }

  return rows
}

/**
 * The time-of-day recommendations the app already computes from history, topped
 * up with your own shortcuts when there aren't enough — a first-run profile has
 * no heatmap, and an empty section is worse than a predictable one.
 */
function suggested(): { name: string; url: string }[] {
  const out = getRecommendations(new Set()).slice(0, MAX_SUGGESTED)
  if (out.length >= MAX_SUGGESTED) return out

  const seen = new Set(out.map((r) => r.url))
  for (const tab of store.local.get("shortcuts")) {
    for (const item of tab.items) {
      if (out.length >= MAX_SUGGESTED) return out
      if (item.type !== "shortcut" || seen.has(item.url)) continue
      seen.add(item.url)
      out.push({ name: item.name, url: item.url })
    }
  }
  return out
}
