import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { githubConnected, githubSnapshot } from "../../github"
import { searchGithub } from "../../github-api"
import type { GithubItem } from "../../github-api"
import { relativeTime } from "./history"
import type { Candidate, QueryContext, SearchSource } from "../types"

function glyphFor(item: GithubItem): string {
  if (item.isDraft) return "gitDraft"
  return item.number && item.url.includes("/pull/") ? "gitPullRequest" : "issueOpen"
}

function candidate(item: GithubItem): Candidate {
  return {
    id: `github:${item.id}`,
    title: item.title,
    subtitle: `${item.repo}#${item.number}`,
    detail: item.updatedAt ? relativeTime(item.updatedAt) : undefined,
    haystack: [item.repo, `#${item.number}`],
    boost: item.updatedAt ? Math.max(0, 1 - (Date.now() - item.updatedAt) / (14 * 86400000)) : 0.5,
    icon: () => icon(glyphFor(item), { size: 16 }),
    copyValue: item.url,
    run: (mode) => navigate(item.url, "search", mode === "newTab" ? "newTab" : "default"),
    actions: [
      { id: "open", label: "Open on GitHub", glyph: "externalLink", run: () => navigate(item.url, "search") },
      {
        id: "new-tab",
        label: "Open in new tab",
        glyph: "tab",
        run: () => navigate(item.url, "search", "newTab"),
      },
      { id: "copy", label: "Copy link", glyph: "copy", run: () => navigator.clipboard?.writeText(item.url) },
    ],
  }
}

export const githubSource: SearchSource = {
  id: "github",
  label: "GitHub",
  token: "gh",
  glyph: "github",
  weight: 1.05,
  limit: 3,
  scopedLimit: 20,
  debounce: 200,
  available: () => store.sync.get("githubEnabled") && githubConnected(),
  unavailable: () => ({
    message: store.sync.get("githubEnabled")
      ? "GitHub isn't connected."
      : "The GitHub widget is turned off.",
  }),
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    const query = ctx.text.trim()

    // Blended: whatever the card already pulled down, at no network cost.
    if (!ctx.scoped) {
      if (!query) return []
      const data = githubSnapshot()
      return [...data.reviews, ...data.mine, ...data.mentions, ...data.issues].map(candidate)
    }

    if (!query) {
      const data = githubSnapshot()
      return [...data.reviews, ...data.mine, ...data.mentions, ...data.issues].map(candidate)
    }

    // Scoped: reach past your own items to everything you can see.
    return searchGithub(query, ctx.limit)
      .then((items) => (ctx.signal.aborted ? [] : items.map(candidate)))
      .catch(() => [])
  },
  idle(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" })
  },
}
