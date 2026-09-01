import { store } from "./store"
import { githubFetch, hasScope, API_ROOT } from "./github-auth"

export type CiState = "success" | "failure" | "pending"
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED"

export type GithubItem = {
  id: string
  title: string
  repo: string
  number: number
  url: string
  updatedAt: number
  author: { login: string; avatarUrl: string } | null
  isBot: boolean
  isDraft: boolean
  reviewDecision: ReviewDecision | null
  /** Approvals in / reviewers asked, for the progress pips. */
  approvals: number
  reviewersTotal: number
  ci: CiState | null
  /** What actually failed, e.g. `build, lint`. Empty unless `ci` is failure. */
  ciDetail: string
  conflicted: boolean
  labels: { name: string; color: string }[]
  /** Notifications only — the thread to mark read. */
  threadId?: string
  reason?: string
}

export type Contributions = {
  /** One count per day, oldest first. */
  days: number[]
  total: number
}

export type GithubData = {
  reviews: GithubItem[]
  mine: GithubItem[]
  mentions: GithubItem[]
  issues: GithubItem[]
  contributions: Contributions | null
  fetchedAt: number
  /**
   * Sections the fetch couldn't fill, mapped to why. A missing scope is not an
   * error the user can act on from the card, but silently rendering an empty
   * section as "all clear" would be a lie.
   */
  degraded: Partial<Record<"reviews" | "mine" | "mentions" | "issues", string>>
}

export const EMPTY_DATA: GithubData = {
  reviews: [],
  mine: [],
  mentions: [],
  issues: [],
  contributions: null,
  fetchedAt: 0,
  degraded: {},
}

const CONTRIBUTION_WEEKS = 12

const PR_FIELDS = `
  id
  number
  title
  url
  isDraft
  updatedAt
  repository { nameWithOwner }
  author { login avatarUrl __typename }
  reviewDecision
  mergeable
  approvals: reviews(states: APPROVED) { totalCount }
  reviewRequests(first: 1) { totalCount }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 30) {
            nodes {
              __typename
              ... on CheckRun { name conclusion }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
`

const ISSUE_FIELDS = `
  id
  number
  title
  url
  updatedAt
  repository { nameWithOwner }
  author { login avatarUrl __typename }
  labels(first: 3) { nodes { name color } }
`

const QUERY = `
query Meridian($reviews: String!, $mine: String!, $issues: String!, $wantContributions: Boolean!) {
  viewer {
    login
    contributionsCollection @include(if: $wantContributions) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date } }
      }
    }
  }
  reviews: search(query: $reviews, type: ISSUE, first: 25) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  mine: search(query: $mine, type: ISSUE, first: 25) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  issues: search(query: $issues, type: ISSUE, first: 25) {
    nodes { ... on Issue { ${ISSUE_FIELDS} } }
  }
}
`

export class GithubApiError extends Error {}

/**
 * One GraphQL round trip for reviews, your PRs, issues and the contribution
 * calendar, plus one REST call for notifications — REST is the only place
 * notifications exist. Everything the card draws comes from these two.
 */
export async function fetchGithubData(): Promise<GithubData> {
  const scope = scopeQualifier()
  const wantIssues = enabled("issues")
  const wantContributions = store.sync.get("githubShowContributions")

  const [graph, mentions] = await Promise.all([
    runQuery({
      reviews: `is:open is:pr archived:false review-requested:@me${scope}`,
      mine: `is:open is:pr archived:false author:@me${scope}`,
      // Search rejects an empty query, so a disabled section still needs one;
      // asking for nothing costs less than a second round trip later.
      issues: wantIssues ? `is:open is:issue archived:false assignee:@me${scope}` : "is:issue assignee:@me created:<1970-01-02",
      wantContributions,
    }),
    enabled("mentions") ? fetchNotifications() : Promise.resolve({ items: [], degraded: undefined }),
  ])

  const data: GithubData = {
    reviews: mapNodes(graph.data?.reviews?.nodes, mapPullRequest),
    mine: mapNodes(graph.data?.mine?.nodes, mapPullRequest),
    issues: wantIssues ? mapNodes(graph.data?.issues?.nodes, mapIssue) : [],
    mentions: mentions.items,
    contributions: mapContributions(graph.data?.viewer?.contributionsCollection),
    fetchedAt: Date.now(),
    degraded: {},
  }

  if (mentions.degraded) data.degraded.mentions = mentions.degraded
  // A partial GraphQL response still carries the sections that resolved, so the
  // errors annotate what is missing rather than throwing the rest away.
  if (graph.errors?.length) {
    const message = graph.errors[0]?.message ?? "GitHub couldn't answer part of the query."
    for (const key of ["reviews", "mine", "issues"] as const) {
      if (!graph.data?.[key]) data.degraded[key] = message
    }
  }

  return data
}

async function runQuery(variables: Record<string, unknown>): Promise<any> {
  const res = await githubFetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  })

  if (res.status === 403 || res.status === 429) {
    throw new GithubApiError(rateLimitMessage(res))
  }
  if (!res.ok) throw new GithubApiError(`GitHub answered ${res.status}.`)

  const body = await res.json()
  if (!body.data && body.errors?.length) {
    throw new GithubApiError(body.errors[0].message ?? "GitHub rejected the query.")
  }
  return body
}

async function fetchNotifications(): Promise<{ items: GithubItem[]; degraded?: string }> {
  if (!hasScope("notifications")) {
    return { items: [], degraded: "This token can't read notifications. Reconnect to grant the scope." }
  }

  const res = await githubFetch("/notifications?all=false&per_page=25")
  if (res.status === 403) return { items: [], degraded: rateLimitMessage(res) }
  if (!res.ok) return { items: [], degraded: `GitHub answered ${res.status}.` }

  const threads: any[] = await res.json()
  return {
    items: threads
      // Review requests have their own section; showing them twice makes the
      // card look busier than the work actually is.
      .filter((t) => t.reason !== "review_requested")
      .map(mapNotification),
  }
}

/** GitHub reports both a spent budget and a hard abuse limit through the same code. */
function rateLimitMessage(res: Response): string {
  const remaining = res.headers.get("x-ratelimit-remaining")
  if (remaining === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000
    const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000))
    return `GitHub rate limit reached. Resets in ${mins} min.`
  }
  return "GitHub refused the request. The token may be missing a scope."
}

function scopeQualifier(): string {
  const org = store.sync.get("githubOrgFilter").trim()
  return org ? ` org:${org}` : ""
}

function enabled(section: string): boolean {
  return store.sync.get("githubSections").includes(section as any)
}

function mapNodes(nodes: any[] | undefined, map: (n: any) => GithubItem): GithubItem[] {
  if (!Array.isArray(nodes)) return []
  return nodes.filter((n) => n && n.id).map(map)
}

function mapPullRequest(node: any): GithubItem {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup
  const { state, detail } = mapRollup(rollup)
  return {
    id: node.id,
    title: node.title,
    repo: node.repository?.nameWithOwner ?? "",
    number: node.number,
    url: node.url,
    updatedAt: Date.parse(node.updatedAt),
    author: mapAuthor(node.author),
    isBot: isBot(node.author),
    isDraft: Boolean(node.isDraft),
    reviewDecision: node.reviewDecision ?? null,
    approvals: node.approvals?.totalCount ?? 0,
    reviewersTotal: (node.approvals?.totalCount ?? 0) + (node.reviewRequests?.totalCount ?? 0),
    ci: state,
    ciDetail: detail,
    conflicted: node.mergeable === "CONFLICTING",
    labels: [],
  }
}

function mapIssue(node: any): GithubItem {
  return {
    id: node.id,
    title: node.title,
    repo: node.repository?.nameWithOwner ?? "",
    number: node.number,
    url: node.url,
    updatedAt: Date.parse(node.updatedAt),
    author: mapAuthor(node.author),
    isBot: isBot(node.author),
    isDraft: false,
    reviewDecision: null,
    approvals: 0,
    reviewersTotal: 0,
    ci: null,
    ciDetail: "",
    conflicted: false,
    labels: (node.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })),
  }
}

function mapNotification(thread: any): GithubItem {
  return {
    id: `notif-${thread.id}`,
    threadId: thread.id,
    reason: thread.reason,
    title: thread.subject?.title ?? "",
    repo: thread.repository?.full_name ?? "",
    number: subjectNumber(thread.subject?.url),
    url: subjectUrl(thread),
    updatedAt: Date.parse(thread.updated_at),
    author: null,
    isBot: false,
    isDraft: false,
    reviewDecision: null,
    approvals: 0,
    reviewersTotal: 0,
    ci: null,
    ciDetail: "",
    conflicted: false,
    labels: [],
  }
}

/**
 * Notifications carry an API URL, not a web one. Rewriting it is the only way
 * to a clickable link — the REST payload has no `html_url` for the subject.
 */
function subjectUrl(thread: any): string {
  const repo = thread.repository?.html_url ?? "https://github.com"
  const api: string | undefined = thread.subject?.url
  if (!api || !api.startsWith(`${API_ROOT}/repos/`)) return repo
  return api
    .replace(`${API_ROOT}/repos/`, "https://github.com/")
    .replace("/pulls/", "/pull/")
}

function subjectNumber(url: string | undefined): number {
  const match = url?.match(/\/(\d+)$/)
  return match ? Number(match[1]) : 0
}

function mapAuthor(author: any): { login: string; avatarUrl: string } | null {
  if (!author?.login) return null
  return { login: author.login, avatarUrl: author.avatarUrl ?? "" }
}

function isBot(author: any): boolean {
  if (!author?.login) return false
  return author.__typename === "Bot" || author.login.endsWith("[bot]")
}

function mapRollup(rollup: any): { state: CiState | null; detail: string } {
  if (!rollup?.state) return { state: null, detail: "" }

  const contexts: any[] = rollup.contexts?.nodes ?? []
  const failed = contexts
    .filter((c) =>
      c.__typename === "CheckRun"
        ? c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.conclusion === "CANCELLED"
        : c.state === "FAILURE" || c.state === "ERROR"
    )
    .map((c) => c.name ?? c.context)
    .filter(Boolean)

  switch (rollup.state) {
    case "SUCCESS":
      return { state: "success", detail: "" }
    case "FAILURE":
    case "ERROR":
      return { state: "failure", detail: failed.slice(0, 3).join(", ") }
    case "PENDING":
    case "EXPECTED":
      return { state: "pending", detail: "" }
    default:
      return { state: null, detail: "" }
  }
}

function mapContributions(collection: any): Contributions | null {
  const calendar = collection?.contributionCalendar
  if (!calendar?.weeks) return null

  const weeks = calendar.weeks.slice(-CONTRIBUTION_WEEKS)
  const days: number[] = []
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) days.push(day.contributionCount ?? 0)
  }
  return { days, total: calendar.totalContributions ?? 0 }
}

/**
 * Ignore-list and bot muting are applied here rather than in the queries: the
 * search syntax can express neither without one qualifier per repo. Deliberately
 * *not* applied before caching — the cache holds what GitHub said, so unmuting
 * bots brings them straight back instead of waiting for the next fetch.
 */
export function filterData(data: GithubData): GithubData {
  const ignored = new Set(store.sync.get("githubIgnoredRepos").map((r) => r.toLowerCase()))
  const hideBots = store.sync.get("githubHideBots")

  const keep = (item: GithubItem): boolean => {
    if (ignored.has(item.repo.toLowerCase())) return false
    if (hideBots && item.isBot) return false
    return true
  }

  return {
    ...data,
    reviews: data.reviews.filter(keep),
    mine: data.mine.filter(keep),
    mentions: data.mentions.filter(keep),
    issues: data.issues.filter(keep),
  }
}

/** Marks one notification thread read. Best-effort: a failure just re-renders. */
export async function markNotificationRead(threadId: string): Promise<boolean> {
  try {
    const res = await githubFetch(`/notifications/threads/${threadId}`, { method: "PATCH" })
    return res.ok || res.status === 205
  } catch {
    return false
  }
}

/**
 * How urgent an item is, highest first. Sections do most of the sorting, but
 * within "your PRs" the difference between blocked and merely open is the whole
 * point of the widget, so it can't be left to `updated_at`.
 */
export function urgency(item: GithubItem): number {
  if (item.conflicted) return 5
  if (item.reviewDecision === "CHANGES_REQUESTED") return 4
  if (item.ci === "failure") return 3
  if (item.reviewDecision === "APPROVED") return 2
  if (item.isDraft) return 0
  return 1
}

/** Items where somebody is waiting on you — the number on the trigger badge. */
export function actionableCount(data: GithubData): number {
  const blocked = data.mine.filter((i) => urgency(i) >= 3).length
  return data.reviews.length + blocked + data.mentions.length
}
