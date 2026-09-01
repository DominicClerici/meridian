import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { linearConnected, linearSnapshot } from "../../linear"
import { searchIssues } from "../../linear-api"
import type { LinearIssue } from "../../linear-api"
import type { Candidate, QueryContext, SearchSource } from "../types"

/** Linear's own colour, so a row reads as its state at a glance. */
function stateDot(color: string): HTMLElement {
  const dot = document.createElement("span")
  dot.className = "shrink-0 w-3 h-3 rounded-full border-2"
  dot.style.borderColor = color || "currentColor"
  return dot
}

function candidate(issue: LinearIssue): Candidate {
  return {
    id: `linear:${issue.id}`,
    title: issue.title,
    subtitle: issue.identifier,
    detail: issue.stateName,
    haystack: [issue.identifier, issue.branchName, issue.projectName],
    boost: issue.priority > 0 ? 1 - issue.priority / 5 : 0.4,
    icon: () => stateDot(issue.stateColor),
    copyValue: issue.url,
    run: (mode) => navigate(issue.url, "search", mode === "newTab" ? "newTab" : "default"),
    actions: [
      { id: "open", label: "Open in Linear", glyph: "externalLink", run: () => navigate(issue.url, "search") },
      {
        id: "new-tab",
        label: "Open in new tab",
        glyph: "tab",
        run: () => navigate(issue.url, "search", "newTab"),
      },
      {
        id: "branch",
        label: "Copy branch name",
        glyph: "branch",
        run: () => navigator.clipboard?.writeText(issue.branchName),
      },
      { id: "copy", label: "Copy link", glyph: "copy", run: () => navigator.clipboard?.writeText(issue.url) },
    ],
  }
}

function cached(): LinearIssue[] {
  const data = linearSnapshot()
  return [...data.due, ...data.progress, ...data.todo]
}

export const linearSource: SearchSource = {
  id: "linear",
  label: "Linear",
  token: "lin",
  glyph: "linear",
  weight: 1.05,
  limit: 3,
  scopedLimit: 20,
  debounce: 200,
  available: () => store.sync.get("linearEnabled") && linearConnected(),
  unavailable: () => ({
    message: store.sync.get("linearEnabled")
      ? "Linear isn't connected."
      : "The Linear widget is turned off.",
  }),
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (!ctx.scoped) return query ? cached().map(candidate) : []
    if (!query) return cached().map(candidate)

    return searchIssues(query, ctx.limit)
      .then((issues) => (ctx.signal.aborted ? [] : issues.map(candidate)))
      .catch(() => cached().map(candidate))
  },
  idle(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" })
  },
}
