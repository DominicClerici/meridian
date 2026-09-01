/**
 * The join between the Linear card and the GitHub card.
 *
 * Both widgets already hold everything needed to badge each other — a Linear
 * issue carries its pull request as an attachment, and a GitHub PR is the thing
 * that attachment points at — so the link costs no network at all. What it does
 * cost is a dependency, and a direct import either way would make two unrelated
 * widgets refuse to build without each other. So neither imports the other:
 * both publish into this index and read out of it, and this module imports
 * nothing.
 *
 * The join key is the pull request URL, which is the one identifier both sides
 * genuinely agree on. Matching on `ENG-123` scraped from a branch name or a PR
 * title would look like it worked until someone renamed a branch.
 */

export type LinearLinkRef = {
  identifier: string
  title: string
  url: string
  stateName: string
  stateType: string
  stateColor: string
}

export type GithubLinkRef = {
  number: number
  repo: string
  url: string
  title: string
  ci: "success" | "failure" | "pending" | null
  isDraft: boolean
  reviewDecision: string | null
  conflicted: boolean
}

export type LinkSource = "linear" | "github"

let linearByPr = new Map<string, LinearLinkRef>()
let githubByPr = new Map<string, GithubLinkRef>()

const listeners = new Set<(source: LinkSource) => void>()

/**
 * GitHub hands out the same pull request under several spellings — the API's
 * `/pulls/` form, a `#issuecomment` deep link, a trailing slash, mixed case in
 * the owner. Linear stores whichever one the person pasted, so every lookup has
 * to go through the same funnel or the two maps never meet.
 */
export function normalizePrUrl(raw: string): string {
  if (!raw) return ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ""
  }
  if (!/(^|\.)github\.com$/i.test(url.hostname)) return ""

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|pulls)\/(\d+)/)
  if (!match) return ""
  const [, owner, repo, number] = match
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`
}

/** Replaces the whole Linear side. A refetch is the only thing that writes it. */
export function publishLinearLinks(entries: { prUrl: string; ref: LinearLinkRef }[]): void {
  const next = new Map<string, LinearLinkRef>()
  for (const { prUrl, ref } of entries) {
    const key = normalizePrUrl(prUrl)
    if (key) next.set(key, ref)
  }
  linearByPr = next
  notify("linear")
}

/** Replaces the whole GitHub side. A refetch is the only thing that writes it. */
export function publishGithubLinks(entries: { prUrl: string; ref: GithubLinkRef }[]): void {
  const next = new Map<string, GithubLinkRef>()
  for (const { prUrl, ref } of entries) {
    const key = normalizePrUrl(prUrl)
    if (key) next.set(key, ref)
  }
  githubByPr = next
  notify("github")
}

export function clearLinks(source: LinkSource): void {
  if (source === "linear") linearByPr = new Map()
  else githubByPr = new Map()
  notify(source)
}

/** The Linear issue that claims this pull request, if the Linear card has one. */
export function linearRefForPr(prUrl: string): LinearLinkRef | null {
  const key = normalizePrUrl(prUrl)
  return key ? (linearByPr.get(key) ?? null) : null
}

/** The pull request behind this Linear attachment, if the GitHub card has it. */
export function githubRefForPr(prUrl: string): GithubLinkRef | null {
  const key = normalizePrUrl(prUrl)
  return key ? (githubByPr.get(key) ?? null) : null
}

/**
 * Fires with whichever side just changed. Each widget ignores its own source:
 * re-rendering on your own publish is redundant — you are already re-rendering
 * for the fetch that produced it — and doing it anyway is how two widgets that
 * refresh each other end up in a loop.
 */
export function onLinksChanged(callback: (source: LinkSource) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function notify(source: LinkSource): void {
  for (const listener of [...listeners]) listener(source)
}
