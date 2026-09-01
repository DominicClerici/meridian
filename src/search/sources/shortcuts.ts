import { store } from "../../store"
import { icon } from "../../icons/registry"
import { prettyUrl } from "../../url"
import { navigate } from "../../navigate"
import { renderIcon } from "../../shortcut-icon"
import { openSettings } from "../../settings"
import type { Shortcut, Tab } from "../../shortcuts"
import type { Candidate, QueryContext, SearchSource } from "../types"

function flatten(tabs: Tab[]): { shortcut: Shortcut; tab: string }[] {
  const out: { shortcut: Shortcut; tab: string }[] = []
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.type === "shortcut") out.push({ shortcut: item, tab: tab.name })
      else for (const child of item.children) out.push({ shortcut: child, tab: `${tab.name} / ${item.name}` })
    }
  }
  return out
}

function candidate(shortcut: Shortcut, group: string): Candidate {
  const url = shortcut.url
  return {
    id: `shortcut:${shortcut.id}`,
    title: shortcut.name,
    subtitle: prettyUrl(url),
    detail: group,
    haystack: [url],
    icon: () =>
      renderIcon(shortcut.icon, { kind: "shortcut", name: shortcut.name, url }, { size: 16 }),
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
      {
        id: "edit",
        label: "Edit shortcut",
        glyph: "edit",
        run: () => openSettings("shortcuts"),
      },
    ],
  }
}

export const shortcutsSource: SearchSource = {
  id: "shortcuts",
  label: "Shortcuts",
  token: "sc",
  glyph: "link",
  // Yours, named by you, and a small set — a hit here is rarely a coincidence.
  weight: 1.25,
  limit: 4,
  scopedLimit: 24,
  available: () => store.local.get("shortcuts").some((tab) => tab.items.length > 0),
  query(ctx: QueryContext): Candidate[] {
    if (!ctx.text.trim() && !ctx.scoped) return []
    return flatten(store.local.get("shortcuts")).map(({ shortcut, tab }) =>
      candidate(shortcut, tab)
    )
  },
  idle(): Candidate[] {
    return flatten(store.local.get("shortcuts"))
      .slice(0, 24)
      .map(({ shortcut, tab }) => candidate(shortcut, tab))
  },
  unavailable: () => ({
    message: "No shortcuts yet.",
    action: {
      id: "add",
      label: "Add shortcuts",
      glyph: "plus",
      run: () => openSettings("shortcuts"),
    },
  }),
}
