import { store } from "./store"
import { linearRequest } from "./linear-auth"
import { normalizePrUrl } from "./issue-links"
import type { LinearSection } from "./defaults"

export type LinearStateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"

export type LinearWorkflowState = {
  id: string
  name: string
  type: string
  color: string
  position: number
}

export type LinearTeam = {
  id: string
  key: string
  name: string
  states: LinearWorkflowState[]
  cycle: LinearCycle | null
}

export type LinearCycle = {
  number: number
  name: string
  startsAt: number
  endsAt: number
  /** 0..1, as Linear computes it. */
  progress: number
  /** Daily totals from the cycle's first day, for the burndown. */
  scopeHistory: number[]
  completedHistory: number[]
  teamKey: string
}

export type LinearIssue = {
  id: string
  identifier: string
  title: string
  url: string
  /** Linear's own scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number
  priorityLabel: string
  updatedAt: number
  /** `YYYY-MM-DD`, or empty. Timeless on purpose — it has no clock. */
  dueDate: string
  branchName: string
  stateId: string
  stateName: string
  stateType: string
  stateColor: string
  teamId: string
  teamKey: string
  projectName: string
  cycleNumber: number | null
  labels: { name: string; color: string }[]
  /** Normalizable pull request URLs attached to the issue, newest first. */
  prUrls: string[]
  slaBreachesAt: number | null
}

export type LinearInboxItem = {
  id: string
  type: string
  title: string
  subtitle: string
  url: string
  createdAt: number
  actorName: string
  actorAvatarUrl: string | null
  issueIdentifier: string
  issueStateColor: string
  issueStateType: string
}

export type LinearData = {
  inbox: LinearInboxItem[]
  due: LinearIssue[]
  progress: LinearIssue[]
  todo: LinearIssue[]
  teams: LinearTeam[]
  cycle: LinearCycle | null
  fetchedAt: number
  /**
   * Sections the fetch couldn't fill, mapped to why. Rendering an empty section
   * as "all clear" when the query actually failed would be a lie.
   */
  degraded: Partial<Record<LinearSection, string>>
}

export const EMPTY_DATA: LinearData = {
  inbox: [],
  due: [],
  progress: [],
  todo: [],
  teams: [],
  cycle: null,
  fetchedAt: 0,
  degraded: {},
}

/** How far ahead of today an issue counts as "due". Beyond this it is just work. */
const DUE_HORIZON_DAYS = 2

const ISSUE_FIELDS = `
  id
  identifier
  title
  url
  priority
  priorityLabel
  updatedAt
  dueDate
  branchName
  slaBreachesAt
  state { id name type color }
  team { id key }
  project { name }
  cycle { number }
  labels(first: 3) { nodes { name color } }
  attachments(first: 6) @include(if: $wantLinks) { nodes { url sourceType } }
`

const QUERY = `
query Meridian(
  $activeFilter: IssueFilter!
  $dueFilter: IssueFilter!
  $wantInbox: Boolean!
  $wantLinks: Boolean!
  $wantCycle: Boolean!
) {
  viewer { id displayName }
  active: issues(filter: $activeFilter, first: 50, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} }
  }
  due: issues(filter: $dueFilter, first: 25, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} }
  }
  notifications(first: 50) @include(if: $wantInbox) {
    nodes {
      id
      type
      title
      subtitle
      url
      createdAt
      readAt
      snoozedUntilAt
      actor { displayName avatarUrl }
      botActor { name avatarUrl }
      ... on IssueNotification {
        issue { identifier state { type color } }
      }
    }
  }
  teams(first: 25) {
    nodes {
      id
      key
      name
      states(first: 40) { nodes { id name type color position } }
      activeCycle @include(if: $wantCycle) {
        number
        name
        startsAt
        endsAt
        progress
        scopeHistory
        completedIssueCountHistory
      }
    }
  }
}
`

/**
 * One round trip for everything the card draws.
 *
 * The issue list is split into two aliased queries rather than one broad
 * search, because a single `first: 50` ordered by `updatedAt` would let a large
 * stale backlog crowd out the overdue item that is the whole reason to look.
 * `active` guarantees the work in flight; `due` guarantees the deadlines, from
 * any state. They overlap, and the merge below resolves it.
 */
export async function fetchLinearData(): Promise<LinearData> {
  const wantInbox = sectionEnabled("inbox")
  const wantLinks = store.sync.get("linearLinkGithub")
  const wantCycle = store.sync.get("linearShowCycle")
  const team = store.sync.get("linearTeamFilter").trim().toUpperCase()

  const mine: Record<string, unknown> = { assignee: { isMe: { eq: true } } }
  if (team) mine.team = { key: { eq: team } }

  const { data, errors } = await linearRequest(QUERY, {
    activeFilter: { ...mine, state: { type: { in: ["triage", "unstarted", "started"] } } },
    dueFilter: {
      ...mine,
      state: { type: { nin: ["completed", "canceled"] } },
      dueDate: { lte: isoDate(addDays(new Date(), DUE_HORIZON_DAYS)) },
    },
    wantInbox,
    wantLinks,
    wantCycle,
  })

  const teams: LinearTeam[] = (data?.teams?.nodes ?? []).map(mapTeam)
  const active: LinearIssue[] = (data?.active?.nodes ?? []).filter(Boolean).map(mapIssue)
  const dueRaw: LinearIssue[] = (data?.due?.nodes ?? []).filter(Boolean).map(mapIssue)

  // Due wins the overlap outright: an overdue issue that is also in progress is
  // read as late, not as busy, and showing it in both sections would double the
  // count on the trigger badge.
  const due = dueRaw.filter(isDueSoon).sort(byDueThenUrgency)
  const claimed = new Set(due.map((i) => i.id))

  const rest = active.filter((i) => !claimed.has(i.id))

  const result: LinearData = {
    inbox: wantInbox ? mapInbox(data?.notifications?.nodes) : [],
    due,
    progress: rest.filter((i) => i.stateType === "started").sort(byUrgencyThenUpdated),
    todo: rest.filter((i) => i.stateType !== "started").sort(byUrgencyThenUpdated),
    teams,
    cycle: wantCycle ? pickCycle(teams, [...due, ...rest]) : null,
    fetchedAt: Date.now(),
    degraded: {},
  }

  // A partial response still carries the sections that resolved, so the errors
  // annotate what is missing rather than throwing the rest away.
  if (errors?.length) {
    const message = errors[0]?.message ?? "Linear couldn't answer part of the query."
    if (!data?.active) {
      result.degraded.progress = message
      result.degraded.todo = message
    }
    if (!data?.due) result.degraded.due = message
    if (wantInbox && !data?.notifications) result.degraded.inbox = message
  }

  return result
}

// ---------------------------------------------------------------- mapping

function mapIssue(node: any): LinearIssue {
  const prUrls: string[] = []
  for (const attachment of node.attachments?.nodes ?? []) {
    if (attachment?.url && normalizePrUrl(attachment.url)) prUrls.push(attachment.url)
  }

  return {
    id: node.id,
    identifier: node.identifier ?? "",
    title: node.title ?? "",
    url: node.url ?? "",
    priority: node.priority ?? 0,
    priorityLabel: node.priorityLabel ?? "",
    updatedAt: Date.parse(node.updatedAt) || 0,
    dueDate: node.dueDate ?? "",
    branchName: node.branchName ?? "",
    stateId: node.state?.id ?? "",
    stateName: node.state?.name ?? "",
    stateType: node.state?.type ?? "",
    stateColor: node.state?.color ?? "#8b8b8b",
    teamId: node.team?.id ?? "",
    teamKey: node.team?.key ?? "",
    projectName: node.project?.name ?? "",
    cycleNumber: node.cycle?.number ?? null,
    labels: (node.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })),
    prUrls,
    slaBreachesAt: node.slaBreachesAt ? Date.parse(node.slaBreachesAt) : null,
  }
}

function mapTeam(node: any): LinearTeam {
  const cycle = node.activeCycle
  return {
    id: node.id,
    key: node.key ?? "",
    name: node.name ?? "",
    states: (node.states?.nodes ?? [])
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        color: s.color,
        position: s.position ?? 0,
      }))
      .sort((a: LinearWorkflowState, b: LinearWorkflowState) => a.position - b.position),
    cycle: cycle
      ? {
          number: cycle.number ?? 0,
          name: cycle.name ?? "",
          startsAt: Date.parse(cycle.startsAt) || 0,
          endsAt: Date.parse(cycle.endsAt) || 0,
          progress: cycle.progress ?? 0,
          scopeHistory: cycle.scopeHistory ?? [],
          completedHistory: cycle.completedIssueCountHistory ?? [],
          teamKey: node.key ?? "",
        }
      : null,
  }
}

/**
 * Unread only, and not currently snoozed. `NotificationFilter` can express
 * neither — it has no `readAt` field — so the cut happens here.
 */
function mapInbox(nodes: any[] | undefined): LinearInboxItem[] {
  if (!Array.isArray(nodes)) return []
  const now = Date.now()

  return nodes
    .filter((n) => {
      if (!n || n.readAt) return false
      const snoozed = n.snoozedUntilAt ? Date.parse(n.snoozedUntilAt) : 0
      return !snoozed || snoozed <= now
    })
    .map((n) => ({
      id: n.id,
      type: n.type ?? "",
      title: n.title ?? "",
      subtitle: n.subtitle ?? "",
      url: n.url ?? "",
      createdAt: Date.parse(n.createdAt) || 0,
      actorName: n.actor?.displayName ?? n.botActor?.name ?? "",
      actorAvatarUrl: n.actor?.avatarUrl ?? n.botActor?.avatarUrl ?? null,
      issueIdentifier: n.issue?.identifier ?? "",
      issueStateColor: n.issue?.state?.color ?? "",
      issueStateType: n.issue?.state?.type ?? "",
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Which team's cycle the burndown draws. With a team pinned there is no choice;
 * otherwise it is the team the user actually has work in, since a workspace can
 * expose a dozen teams the user never touches.
 */
function pickCycle(teams: LinearTeam[], issues: LinearIssue[]): LinearCycle | null {
  const pinned = store.sync.get("linearTeamFilter").trim().toUpperCase()
  if (pinned) return teams.find((t) => t.key.toUpperCase() === pinned)?.cycle ?? null

  const counts = new Map<string, number>()
  for (const issue of issues) {
    if (issue.teamId) counts.set(issue.teamId, (counts.get(issue.teamId) ?? 0) + 1)
  }

  let best: LinearCycle | null = null
  let bestCount = -1
  for (const team of teams) {
    if (!team.cycle) continue
    const count = counts.get(team.id) ?? 0
    if (count > bestCount) {
      best = team.cycle
      bestCount = count
    }
  }
  return best
}

// ---------------------------------------------------------------- dates

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Local calendar date as `YYYY-MM-DD` — `toISOString()` would shift the day. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function isDueSoon(issue: LinearIssue): boolean {
  if (!issue.dueDate) return false
  return issue.dueDate <= isoDate(addDays(new Date(), DUE_HORIZON_DAYS))
}

/** Whole days from today; negative is overdue. Both sides are timeless dates. */
export function daysUntilDue(dueDate: string): number {
  if (!dueDate) return Number.POSITIVE_INFINITY
  const [y, m, d] = dueDate.split("-").map(Number)
  if (!y || !m || !d) return Number.POSITIVE_INFINITY
  const due = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

export function dueLabel(dueDate: string): string {
  const days = daysUntilDue(dueDate)
  if (days < -1) return `${Math.abs(days)}d overdue`
  if (days === -1) return "Yesterday"
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `in ${days}d`
}

// ---------------------------------------------------------------- ranking

/**
 * How loudly an issue is asking for attention, highest first. Linear's own
 * `priority` can't carry this alone: it puts "no priority" at 0, below Low, and
 * it knows nothing about a date that has already passed.
 */
export function urgency(issue: LinearIssue): number {
  const days = daysUntilDue(issue.dueDate)
  if (days < 0) return 6
  if (issue.slaBreachesAt && issue.slaBreachesAt - Date.now() < 86_400_000) return 5
  if (days === 0) return 4
  if (issue.priority === 1) return 3
  if (days === 1) return 2
  if (issue.priority === 2) return 2
  if (issue.stateType === "started") return 1
  return 0
}

function byUrgencyThenUpdated(a: LinearIssue, b: LinearIssue): number {
  return urgency(b) - urgency(a) || b.updatedAt - a.updatedAt
}

function byDueThenUrgency(a: LinearIssue, b: LinearIssue): number {
  return daysUntilDue(a.dueDate) - daysUntilDue(b.dueDate) || urgency(b) - urgency(a)
}

/** Items where something is actually waiting on you — the trigger badge number. */
export function actionableCount(data: LinearData): number {
  return data.inbox.length + data.due.length
}

/**
 * The team filter is a setting, not part of the data, so it applies on read.
 * That way changing it re-renders the cached copy instead of forcing a refetch
 * before the card can say anything.
 */
export function filterData(data: LinearData): LinearData {
  const team = store.sync.get("linearTeamFilter").trim().toUpperCase()
  if (!team) return data

  const keep = (issue: LinearIssue): boolean => issue.teamKey.toUpperCase() === team
  const keepInbox = (item: LinearInboxItem): boolean =>
    !item.issueIdentifier || item.issueIdentifier.toUpperCase().startsWith(`${team}-`)

  return {
    ...data,
    inbox: data.inbox.filter(keepInbox),
    due: data.due.filter(keep),
    progress: data.progress.filter(keep),
    todo: data.todo.filter(keep),
  }
}

function sectionEnabled(section: LinearSection): boolean {
  return store.sync.get("linearSections").includes(section)
}

// ---------------------------------------------------------------- mutations

const ISSUE_UPDATE = `
mutation MeridianSetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { id updatedAt state { id name type color } }
  }
}
`

/** Moves one issue to another workflow state. Resolves to the new state, or null. */
export async function updateIssueState(
  issueId: string,
  stateId: string
): Promise<{ id: string; name: string; type: string; color: string } | null> {
  try {
    const { data } = await linearRequest(ISSUE_UPDATE, { id: issueId, stateId })
    if (!data?.issueUpdate?.success) return null
    const state = data.issueUpdate.issue?.state
    return state ? { id: state.id, name: state.name, type: state.type, color: state.color } : null
  } catch {
    return null
  }
}

const NOTIFICATION_READ = `
mutation MeridianReadNotification($id: String!, $readAt: DateTime!) {
  notificationUpdate(id: $id, input: { readAt: $readAt }) { success }
}
`

/** Marks one inbox item read. Best-effort: a failure just re-renders the row. */
export async function markNotificationRead(id: string): Promise<boolean> {
  try {
    const { data } = await linearRequest(NOTIFICATION_READ, {
      id,
      readAt: new Date().toISOString(),
    })
    return Boolean(data?.notificationUpdate?.success)
  } catch {
    return false
  }
}
