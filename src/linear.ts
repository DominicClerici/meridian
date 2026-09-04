import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover, createButton, createInput, createMenu } from "./components"
import { registerCard, refreshCard, refreshCards } from "./layout"
import { openSettings } from "./settings"
import type { LinearSection } from "./defaults"
import {
  authenticateOAuth,
  connectWithApiKey,
  isConnected,
  disconnect,
  getClientId,
  LinearAuthError,
} from "./linear-auth"
import {
  fetchLinearData,
  filterData,
  updateIssueState,
  markNotificationRead,
  actionableCount,
  urgency,
  daysUntilDue,
  dueLabel,
  EMPTY_DATA,
} from "./linear-api"
import type { LinearData, LinearIssue, LinearInboxItem, LinearWorkflowState } from "./linear-api"
import { publishLinearLinks, githubRefForPr, normalizePrUrl, onLinksChanged } from "./issue-links"

const LS_DATA = "sp:linear:data"
const LS_FETCH = "sp:linear:lastFetch"

const COOLDOWN = 60_000
const REFRESH_INTERVAL = 300_000

/** Rows a section shows before it collapses behind a "show all". */
const ROWS_COLLAPSED = 4

type State = "loading" | "loaded" | "error" | "not-connected"

const SECTION_META: Record<LinearSection, { label: string; icon: string }> = {
  inbox: { label: "Inbox", icon: "inbox" },
  due: { label: "Due & overdue", icon: "dueClock" },
  progress: { label: "In progress", icon: "cycleRing" },
  todo: { label: "Up next", icon: "todoList" },
}

/** Linear's notification `type` strings, said the way a person would. */
const INBOX_LABELS: Record<string, string> = {
  issueAssignedToYou: "Assigned",
  issueMention: "Mentioned",
  issueCommentMention: "Mentioned",
  issueNewComment: "Comment",
  issueStatusChanged: "Status",
  issueBlocking: "Blocking",
  issueUnassignedFromYou: "Unassigned",
  issueDue: "Due",
  issueEmojiReaction: "Reaction",
  issueSubscribed: "Update",
  projectUpdateCreated: "Project update",
}

let currentState: State = "loading"
let data: LinearData = EMPTY_DATA
let errorMessage = ""
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let linearPopoverClose: (() => void) | null = null
let inFlight: Promise<void> | null = null

/** Sections the user has expanded past `ROWS_COLLAPSED`, for this page's life. */
const expanded = new Set<LinearSection>()

type LiveBody = { root: HTMLElement; rebuild: () => void }
const liveBodies = new Set<LiveBody>()

// ---------------------------------------------------------------- cache

function getCached(): LinearData | null {
  try {
    const raw = localStorage.getItem(LS_DATA)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LinearData
    // The team filter is a setting, so it applies on read: changing it takes
    // effect on the cached copy without a round trip.
    return filterData({ ...EMPTY_DATA, ...parsed })
  } catch {
    return null
  }
}

function setCached(next: LinearData): void {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(next))
    localStorage.setItem(LS_FETCH, String(Date.now()))
  } catch {
    // Quota or private mode — the widget still works, it just refetches.
  }
}

function clearCache(): void {
  localStorage.removeItem(LS_DATA)
  localStorage.removeItem(LS_FETCH)
  lastAttempt = 0
}

/**
 * Guards on the last *attempt*, not the last success. Gating on the cached
 * timestamp instead would let a failed fetch re-render the error, which
 * re-renders the card, which refetches — a tight retry loop against an API that
 * is already refusing us.
 */
let lastAttempt = 0

function isCooldownActive(): boolean {
  return Date.now() - lastAttempt < COOLDOWN
}

// ---------------------------------------------------------------- fetching

export function refreshLinear(force = false): Promise<void> {
  if (!store.sync.get("linearEnabled") || !isConnected()) return Promise.resolve()
  if (inFlight) return inFlight
  if (!force && isCooldownActive()) return Promise.resolve()

  lastAttempt = Date.now()
  if (currentState !== "loaded") setState("loading")

  // `inFlight` is cleared before each `setState`, not in a `finally`: the footer
  // reads it to choose between "Refreshing…" and a timestamp, and a finally runs
  // after the render it is supposed to describe.
  inFlight = (async () => {
    try {
      const next = await fetchLinearData()
      data = filterData(next)
      setCached(next)
      publishLinks()
      errorMessage = ""
      inFlight = null
      setState("loaded")
    } catch (err: unknown) {
      inFlight = null
      if (err instanceof LinearAuthError) {
        // The token is already gone by the time this lands — clearTokens() runs
        // inside linearRequest, and its subscriber re-renders as not-connected.
        errorMessage = err.message
        return
      }
      errorMessage = err instanceof Error ? err.message : "Couldn't reach Linear."
      setState("error")
    }
  })()

  return inFlight
}

/** Hands the GitHub card every pull request a Linear issue claims. */
function publishLinks(): void {
  if (!store.sync.get("linearLinkGithub")) {
    publishLinearLinks([])
    return
  }

  const entries: { prUrl: string; ref: ReturnType<typeof refFor> }[] = []
  for (const issue of [...data.due, ...data.progress, ...data.todo]) {
    for (const prUrl of issue.prUrls) entries.push({ prUrl, ref: refFor(issue) })
  }
  publishLinearLinks(entries)
}

function refFor(issue: LinearIssue) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    stateName: issue.stateName,
    stateType: issue.stateType,
    stateColor: issue.stateColor,
  }
}

function setState(next: State): void {
  currentState = next
  notifyDataChanged()
}

function notifyDataChanged(): void {
  renderTrigger()
  for (const body of [...liveBodies]) {
    if (body.root.isConnected) body.rebuild()
    else liveBodies.delete(body)
  }
  // Only the tile: the grid/side card's body is a live body above, and
  // re-rendering it here would rebuild the same DOM a second time.
  refreshCard("linear-summary")
}

function startRefreshInterval(): void {
  if (refreshIntervalId !== null) return
  refreshIntervalId = setInterval(() => {
    if (document.visibilityState === "visible") void refreshLinear()
  }, REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId === null) return
  clearInterval(refreshIntervalId)
  refreshIntervalId = null
}

// ---------------------------------------------------------------- helpers

function sections(): LinearSection[] {
  const chosen = store.sync.get("linearSections")
  return (Object.keys(SECTION_META) as LinearSection[]).filter((s) => chosen.includes(s))
}

function relativeTime(ts: number): string {
  if (!ts) return ""
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

function openUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

function statesFor(teamId: string): LinearWorkflowState[] {
  return data.teams.find((t) => t.id === teamId)?.states ?? []
}

// ---------------------------------------------------------------- glyphs

/**
 * Linear's status glyph, in the state's own color — the fastest thing to read
 * on the whole row, and the detail that makes the card feel like Linear rather
 * than a list of links. Drawn rather than iconified because the color is data.
 *
 * The `started` wedge is a stroked circle at half radius: a dash pattern over a
 * stroke that thick fills inward, which draws a pie without any arc maths.
 */
function stateGlyph(type: string, color: string, size = 14): HTMLElement {
  const c = color || "#8b8b8b"
  const span = document.createElement("span")
  span.className = "shrink-0 inline-flex items-center justify-center"

  let inner: string
  switch (type) {
    case "completed":
      inner = `<circle cx="7" cy="7" r="6.2" fill="${c}"/><path d="M4.3 7.2 6.2 9.1 9.8 5.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
      break
    case "canceled":
      inner = `<circle cx="7" cy="7" r="6.2" fill="${c}"/><path d="M4.6 7h4.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>`
      break
    case "started":
      inner =
        `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6"/>` +
        `<circle cx="7" cy="7" r="2.8" fill="none" stroke="${c}" stroke-width="5.6" stroke-dasharray="8.8 17.6" transform="rotate(-90 7 7)"/>`
      break
    case "triage":
      inner =
        `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6"/>` +
        `<path d="M7 4.2v3.2" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<circle cx="7" cy="9.6" r="0.9" fill="${c}"/>`
      break
    case "backlog":
      inner = `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="1.7 2.3" opacity="0.8"/>`
      break
    default:
      inner = `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6"/>`
  }

  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 14 14">${inner}</svg>`
  return span
}

/** Only Urgent and High get a glyph; below that it is noise on every row. */
function priorityGlyph(issue: LinearIssue): HTMLElement | null {
  if (issue.priority === 1) {
    const wrap = document.createElement("span")
    wrap.className = "shrink-0 text-danger"
    wrap.title = issue.priorityLabel || "Urgent"
    wrap.appendChild(icon("priorityUrgent", { size: 13 }))
    return wrap
  }
  if (issue.priority === 2) {
    const wrap = document.createElement("span")
    wrap.className = "shrink-0 text-warning/80"
    wrap.title = issue.priorityLabel || "High"
    wrap.appendChild(icon("priorityBars", { size: 13 }))
    return wrap
  }
  return null
}

function statusChip(text: string, tone: "danger" | "warning" | "success" | "muted"): HTMLElement {
  const tones = {
    danger: "bg-danger/15 text-danger",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
    muted: "bg-popover-foreground/[0.07] text-popover-foreground/50",
  }
  const chip = document.createElement("span")
  chip.className = `shrink-0 px-1.5 py-px rounded-[4px] text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`
  chip.textContent = text
  return chip
}

function dueChip(issue: LinearIssue): HTMLElement | null {
  if (!issue.dueDate) return null
  const days = daysUntilDue(issue.dueDate)
  if (days > 2) return null
  return statusChip(dueLabel(issue.dueDate), days < 0 ? "danger" : days === 0 ? "warning" : "muted")
}

/**
 * The GitHub half of the cross-link. The attachment alone proves a pull request
 * exists, so the chip renders from the URL even when the GitHub card is off or
 * still loading; when that card *has* the PR, its check state comes along too.
 * See `issue-links.ts`.
 */
function prChip(issue: LinearIssue): HTMLElement | null {
  if (!store.sync.get("linearLinkGithub") || !issue.prUrls.length) return null

  const prUrl = issue.prUrls[0]
  const key = normalizePrUrl(prUrl)
  if (!key) return null
  const number = key.split("#")[1] ?? ""
  const ref = githubRefForPr(prUrl)

  const chip = document.createElement("a")
  chip.href = ref?.url ?? prUrl
  chip.target = "_blank"
  chip.rel = "noopener noreferrer"
  chip.className =
    "shrink-0 inline-flex items-center gap-1 px-1.5 rounded-[4px] leading-[16px] bg-popover-foreground/[0.07] text-popover-foreground/55 hover:text-popover-foreground/85 transition-colors"
  // The chip is a link inside a link; without this the row's href wins.
  chip.addEventListener("click", (e) => e.stopPropagation())

  chip.appendChild(icon(ref?.isDraft ? "gitDraft" : "gitPullRequest", { size: 11, class: "opacity-70" }))

  const label = document.createElement("span")
  label.className = "text-[10px] tabular-nums"
  label.textContent = `#${number}`
  chip.appendChild(label)

  if (ref?.ci) {
    const mark = {
      success: { name: "checkPassed", className: "text-success/80", label: "All checks passed" },
      failure: { name: "checkFailed", className: "text-danger", label: "Checks failed" },
      pending: { name: "checkPending", className: "text-warning/80", label: "Checks running" },
    }[ref.ci]
    const dot = document.createElement("span")
    dot.className = `shrink-0 ${mark.className}`
    dot.appendChild(icon(mark.name, { size: 10 }))
    chip.appendChild(dot)
    chip.title = `${ref.repo} #${ref.number} — ${mark.label}`
  } else {
    chip.title = ref ? `${ref.repo} #${ref.number}` : `Pull request #${number}`
  }

  if (issue.prUrls.length > 1) {
    const more = document.createElement("span")
    more.className = "text-[10px] opacity-60"
    more.textContent = `+${issue.prUrls.length - 1}`
    chip.appendChild(more)
  }

  return chip
}

// ---------------------------------------------------------------- rows

/**
 * A row's trailing controls. Both are links-inside-a-link, so both stop the
 * click before the row navigates.
 */
function issueActions(issue: LinearIssue): HTMLElement {
  const wrap = document.createElement("span")
  wrap.className =
    "shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"

  const states = statesFor(issue.teamId)
  if (states.length) {
    const status = document.createElement("button")
    status.className =
      "p-1 rounded-theme-xs text-popover-foreground/40 hover:text-popover-foreground/80 hover:bg-popover-foreground/[0.08] transition-colors"
    status.title = `Status: ${issue.stateName}`
    status.appendChild(stateGlyph(issue.stateType, issue.stateColor, 13))
    status.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      createMenu(
        status,
        states.map((state) => ({
          label: state.name,
          icon: stateGlyph(state.type, state.color, 12),
          disabled: state.id === issue.stateId,
          hint: "Already in this status",
          onClick: () => void moveIssue(issue, state),
        }))
      )
    })
    wrap.appendChild(status)
  }

  if (issue.branchName) {
    const copy = document.createElement("button")
    copy.className =
      "p-1 rounded-theme-xs text-popover-foreground/40 hover:text-popover-foreground/80 hover:bg-popover-foreground/[0.08] transition-colors"
    copy.title = `Copy branch name — ${issue.branchName}`
    copy.appendChild(icon("branch", { size: 13 }))
    copy.addEventListener("click", async (e) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(issue.branchName)
        copy.replaceChildren(icon("check", { size: 13 }))
        copy.classList.add("text-success")
        setTimeout(() => {
          copy.classList.remove("text-success")
          copy.replaceChildren(icon("branch", { size: 13 }))
        }, 1200)
      } catch {
        // Clipboard denied — the name is in the tooltip to copy by hand.
      }
    })
    wrap.appendChild(copy)
  }

  return wrap
}

/**
 * Applies the new state locally before the network confirms it. A status change
 * is the one interaction here with a visible latency cost, and waiting on a
 * round trip to redraw a dot makes the whole card feel remote.
 */
async function moveIssue(issue: LinearIssue, state: LinearWorkflowState): Promise<void> {
  const before = { id: issue.stateId, name: issue.stateName, type: issue.stateType, color: issue.stateColor }
  applyState(issue.id, { id: state.id, name: state.name, type: state.type, color: state.color })
  // Not the body's own rebuild: a status change moves an issue between sections,
  // which changes the trigger badge and the Dashboard tile too. Anything that
  // edits `data` has to go out through here, or the counts drift from the rows.
  notifyDataChanged()

  const confirmed = await updateIssueState(issue.id, state.id)
  if (!confirmed) {
    applyState(issue.id, before)
    notifyDataChanged()
    return
  }
  // Completing an issue takes it out of every section this card renders, so the
  // refetch is what actually removes the row.
  if (confirmed.type === "completed" || confirmed.type === "canceled") void refreshLinear(true)
}

function applyState(
  issueId: string,
  state: { id: string; name: string; type: string; color: string }
): void {
  const patch = (issue: LinearIssue): LinearIssue =>
    issue.id === issueId
      ? { ...issue, stateId: state.id, stateName: state.name, stateType: state.type, stateColor: state.color }
      : issue

  data = {
    ...data,
    due: data.due.map(patch),
    progress: data.progress.map(patch),
    todo: data.todo.map(patch),
  }
  setCached(data)
}

function buildIssueRow(issue: LinearIssue, section: LinearSection): HTMLElement {
  const row = document.createElement("a")
  row.href = issue.url
  row.target = "_blank"
  row.rel = "noopener noreferrer"
  row.className =
    "group flex items-start gap-2 px-1.5 py-1.5 -mx-1.5 rounded-theme transition-colors hover:bg-popover-foreground/[0.06] focus-visible:bg-popover-foreground/[0.06] outline-none"

  const glyph = stateGlyph(issue.stateType, issue.stateColor, 14)
  glyph.classList.add("mt-0.5")
  glyph.title = issue.stateName
  row.appendChild(glyph)

  const main = document.createElement("span")
  main.className = "flex-1 min-w-0 flex flex-col gap-0.5"

  const titleLine = document.createElement("span")
  titleLine.className = "flex items-center gap-1.5 min-w-0"

  const priority = priorityGlyph(issue)
  if (priority) titleLine.appendChild(priority)

  const title = document.createElement("span")
  title.className = "truncate min-w-0 text-[13px] leading-snug text-popover-foreground/90"
  title.textContent = issue.title
  titleLine.appendChild(title)

  // The due section already sorts by date, so the chip only earns its place in
  // the other sections, where a deadline is the surprising part.
  if (section !== "due") {
    const due = dueChip(issue)
    if (due) titleLine.appendChild(due)
  }
  main.appendChild(titleLine)

  const meta = document.createElement("span")
  meta.className = "flex items-center gap-1.5 min-w-0 text-[11px] text-popover-foreground/40"

  const identifier = document.createElement("span")
  identifier.className = "shrink-0 font-mono text-[10px] tracking-tight"
  identifier.textContent = issue.identifier
  meta.appendChild(identifier)

  if (section === "due") {
    const days = daysUntilDue(issue.dueDate)
    const stamp = document.createElement("span")
    stamp.className = `shrink-0 ${days < 0 ? "text-danger/80" : days === 0 ? "text-warning/80" : ""}`
    stamp.textContent = `· ${dueLabel(issue.dueDate)}`
    meta.appendChild(stamp)
  } else {
    const age = document.createElement("span")
    age.className = "shrink-0 tabular-nums"
    age.textContent = `· ${relativeTime(issue.updatedAt)}`
    meta.appendChild(age)
  }

  const pr = prChip(issue)
  if (pr) meta.appendChild(pr)

  // A 380px card cannot hold all four trailing pieces, and a project truncated
  // to "B…" is worse than no project at all. The pull request and the labels
  // are the compact, color-coded ones, so they win the space and the project
  // fills in only when the row is quiet enough to read it.
  const labelCount = pr ? 1 : 2
  if (issue.projectName && (!pr || !issue.labels.length)) {
    const project = document.createElement("span")
    project.className = "truncate min-w-0 opacity-80"
    project.textContent = issue.projectName
    meta.appendChild(project)
  }

  for (const label of issue.labels.slice(0, labelCount)) {
    const tag = document.createElement("span")
    tag.className = "shrink-0 px-1 rounded-[3px] text-[10px] leading-[15px]"
    tag.style.backgroundColor = `${label.color}26`
    tag.style.color = label.color
    tag.textContent = label.name
    meta.appendChild(tag)
  }

  main.appendChild(meta)
  row.appendChild(main)
  row.appendChild(issueActions(issue))

  return row
}

function buildInboxRow(item: LinearInboxItem): HTMLElement {
  const row = document.createElement("a")
  row.href = item.url
  row.target = "_blank"
  row.rel = "noopener noreferrer"
  row.className =
    "group flex items-start gap-2 px-1.5 py-1.5 -mx-1.5 rounded-theme transition-colors hover:bg-popover-foreground/[0.06] focus-visible:bg-popover-foreground/[0.06] outline-none"

  if (item.actorAvatarUrl) {
    const img = document.createElement("img")
    img.src = item.actorAvatarUrl
    img.alt = ""
    img.loading = "lazy"
    img.referrerPolicy = "no-referrer"
    img.title = item.actorName
    img.className = "w-5 h-5 rounded-full shrink-0 mt-px bg-popover-foreground/10"
    row.appendChild(img)
  } else {
    row.appendChild(icon("inbox", { size: 15, class: "shrink-0 mt-0.5 opacity-40" }))
  }

  const main = document.createElement("span")
  main.className = "flex-1 min-w-0 flex flex-col gap-0.5"

  const titleLine = document.createElement("span")
  titleLine.className = "flex items-center gap-1.5 min-w-0"

  const title = document.createElement("span")
  title.className = "truncate min-w-0 text-[13px] leading-snug text-popover-foreground/90"
  // `title` is the actor line ("Dana assigned you an issue"); the subtitle is
  // the issue itself, which is the part worth reading first.
  title.textContent = item.subtitle || item.title
  titleLine.appendChild(title)

  const kind = INBOX_LABELS[item.type]
  if (kind) titleLine.appendChild(statusChip(kind, "muted"))
  main.appendChild(titleLine)

  const meta = document.createElement("span")
  meta.className = "flex items-center gap-1.5 min-w-0 text-[11px] text-popover-foreground/40"

  if (item.issueIdentifier) {
    const identifier = document.createElement("span")
    identifier.className = "shrink-0 font-mono text-[10px] tracking-tight"
    identifier.textContent = item.issueIdentifier
    meta.appendChild(identifier)
  }

  const who = document.createElement("span")
  who.className = "truncate min-w-0"
  who.textContent = item.subtitle && item.title ? item.title : item.actorName
  meta.appendChild(who)

  const age = document.createElement("span")
  age.className = "shrink-0 tabular-nums"
  age.textContent = `· ${relativeTime(item.createdAt)}`
  meta.appendChild(age)

  main.appendChild(meta)
  row.appendChild(main)

  const done = document.createElement("button")
  done.className =
    "shrink-0 mt-0.5 p-1 rounded-theme-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-popover-foreground/40 hover:text-popover-foreground/80"
  done.title = "Mark as read"
  done.appendChild(icon("mailOpen", { size: 14 }))
  done.addEventListener("click", async (e) => {
    // The row is a link; without this the click both marks read and navigates.
    e.preventDefault()
    e.stopPropagation()
    done.disabled = true
    if (await markNotificationRead(item.id)) {
      data = { ...data, inbox: data.inbox.filter((n) => n.id !== item.id) }
      setCached(data)
      notifyDataChanged()
    } else {
      done.disabled = false
    }
  })
  row.appendChild(done)

  return row
}

// ---------------------------------------------------------------- sections

function buildSection(section: LinearSection, onChange: () => void): HTMLElement | null {
  const items: (LinearIssue | LinearInboxItem)[] = data[section] ?? []
  const degraded = data.degraded[section]
  if (!items.length && !degraded) return null

  const meta = SECTION_META[section]
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1 pt-2.5 first:pt-0"

  const head = document.createElement("div")
  head.className =
    "flex items-center gap-1.5 px-1.5 -mx-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-popover-foreground/35"
  head.appendChild(icon(meta.icon, { size: 12, class: "opacity-70" }))

  const label = document.createElement("span")
  label.className = "flex-1 min-w-0 truncate"
  label.textContent = meta.label
  head.appendChild(label)

  if (items.length) {
    const count = document.createElement("span")
    count.className = "tabular-nums opacity-80"
    count.textContent = String(items.length)
    head.appendChild(count)
  }
  wrap.appendChild(head)

  if (degraded) {
    const note = document.createElement("p")
    note.className = "px-1.5 -mx-1.5 text-[11px] leading-relaxed text-warning/80"
    note.textContent = degraded
    wrap.appendChild(note)
  }

  const list = document.createElement("div")
  list.className = "flex flex-col"
  const open = expanded.has(section)
  const visible = open ? items : items.slice(0, ROWS_COLLAPSED)
  for (const item of visible) {
    list.appendChild(
      section === "inbox"
        ? buildInboxRow(item as LinearInboxItem)
        : buildIssueRow(item as LinearIssue, section)
    )
  }
  wrap.appendChild(list)

  if (items.length > ROWS_COLLAPSED) {
    const more = document.createElement("button")
    more.className =
      "self-start px-1.5 -mx-1.5 py-0.5 text-[11px] text-popover-foreground/40 hover:text-accent transition-colors"
    more.textContent = open ? "Show less" : `Show ${items.length - ROWS_COLLAPSED} more`
    more.addEventListener("click", () => {
      if (open) expanded.delete(section)
      else expanded.add(section)
      onChange()
    })
    wrap.appendChild(more)
  }

  return wrap
}

/**
 * The active cycle as a burndown: scope as a faint area, completed as an accent
 * line climbing into it. Two series in 34px — the shape of the gap is the whole
 * message, so neither line carries an axis or a label.
 */
function buildCycle(): HTMLElement | null {
  if (!store.sync.get("linearShowCycle")) return null
  const cycle = data.cycle
  if (!cycle) return null

  const scope = cycle.scopeHistory
  const done = cycle.completedHistory
  const points = Math.min(scope.length, done.length)

  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1.5 pt-3 mt-1 border-t border-popover-foreground/[0.07]"

  if (points > 1) {
    const max = Math.max(...scope.slice(0, points), 1)
    const width = 100
    const height = 34
    const step = width / (points - 1)
    const y = (value: number): number => height - (value / max) * (height - 3) - 1.5
    const path = (series: number[]): string =>
      series
        .slice(0, points)
        .map((value, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(value).toFixed(2)}`)
        .join(" ")

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    // The chart is a shape, not a measurement: letting it stretch to the card's
    // width beats reserving a fixed box that is wrong in two of three layouts.
    svg.setAttribute("preserveAspectRatio", "none")
    svg.setAttribute("class", "w-full h-[34px] overflow-visible")

    const scopePath = path(scope)
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path")
    area.setAttribute("d", `${scopePath} L${width},${height} L0,${height} Z`)
    area.setAttribute("fill", "currentColor")
    area.setAttribute("class", "text-popover-foreground/[0.06]")
    svg.appendChild(area)

    const scopeLine = document.createElementNS("http://www.w3.org/2000/svg", "path")
    scopeLine.setAttribute("d", scopePath)
    scopeLine.setAttribute("fill", "none")
    scopeLine.setAttribute("stroke", "currentColor")
    scopeLine.setAttribute("stroke-width", "1")
    scopeLine.setAttribute("vector-effect", "non-scaling-stroke")
    scopeLine.setAttribute("class", "text-popover-foreground/20")
    svg.appendChild(scopeLine)

    const doneLine = document.createElementNS("http://www.w3.org/2000/svg", "path")
    doneLine.setAttribute("d", path(done))
    doneLine.setAttribute("fill", "none")
    doneLine.setAttribute("stroke", "currentColor")
    doneLine.setAttribute("stroke-width", "1.5")
    doneLine.setAttribute("stroke-linecap", "round")
    doneLine.setAttribute("stroke-linejoin", "round")
    doneLine.setAttribute("vector-effect", "non-scaling-stroke")
    doneLine.setAttribute("class", "text-accent")
    svg.appendChild(doneLine)

    wrap.appendChild(svg)
  }

  const caption = document.createElement("div")
  caption.className = "flex items-center gap-1.5 text-[11px] text-popover-foreground/35"

  const name = document.createElement("span")
  name.className = "truncate min-w-0"
  name.textContent = cycle.name
    ? `${cycle.teamKey} · ${cycle.name}`
    : `${cycle.teamKey} · Cycle ${cycle.number}`
  caption.appendChild(name)

  const remaining = Math.ceil((cycle.endsAt - Date.now()) / 86_400_000)
  const timing = document.createElement("span")
  timing.className = "shrink-0 tabular-nums"
  timing.textContent =
    remaining > 1 ? `· ${remaining}d left` : remaining === 1 ? "· ends tomorrow" : remaining === 0 ? "· ends today" : "· ended"
  caption.appendChild(timing)

  const percent = document.createElement("span")
  percent.className = "shrink-0 ml-auto tabular-nums text-popover-foreground/50"
  percent.textContent = `${Math.round(cycle.progress * 100)}%`
  caption.appendChild(percent)

  wrap.appendChild(caption)
  return wrap
}

function buildFooter(onChange: () => void): HTMLElement {
  const footer = document.createElement("div")
  footer.className = "flex items-center gap-2 pt-2.5 mt-1 text-[11px] text-popover-foreground/35"

  const stamp = document.createElement("span")
  stamp.className = "flex-1 min-w-0 truncate"
  const last = Number(localStorage.getItem(LS_FETCH) ?? 0)
  const since = last ? relativeTime(last) : ""
  stamp.textContent = inFlight
    ? "Refreshing…"
    : since === "now"
      ? "Updated just now"
      : since
        ? `Updated ${since} ago`
        : ""
  footer.appendChild(stamp)

  const user = store.local.get("linearUser")
  if (user?.orgUrlKey) {
    const org = document.createElement("a")
    org.href = `https://linear.app/${user.orgUrlKey}`
    org.target = "_blank"
    org.rel = "noopener noreferrer"
    org.className = "shrink-0 truncate max-w-[120px] hover:text-popover-foreground/60 transition-colors"
    org.textContent = user.orgName || user.orgUrlKey
    footer.appendChild(org)
  }

  const refresh = document.createElement("button")
  refresh.className = "shrink-0 hover:text-popover-foreground/70 transition-colors disabled:opacity-40"
  refresh.title = "Refresh"
  refresh.disabled = inFlight !== null
  refresh.appendChild(icon("refresh", { size: 13 }))
  refresh.addEventListener("click", () => {
    void refreshLinear(true)
    onChange()
  })
  footer.appendChild(refresh)

  return footer
}

function buildEmpty(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2 px-4 py-7 text-center"
  wrap.appendChild(icon("checkPassed", { size: 26, class: "text-popover-foreground/15" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/60"
  heading.textContent = "Nothing on your plate"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[250px] text-[11px] leading-relaxed text-popover-foreground/35"
  sub.textContent = "Inbox clear, nothing due, no issues assigned to you."
  wrap.appendChild(sub)

  return wrap
}

function buildError(onChange: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
  wrap.appendChild(icon("alertTriangle", { size: 22, class: "text-warning/70" }))

  const message = document.createElement("p")
  message.className = "max-w-[260px] text-[12px] leading-relaxed text-popover-foreground/55"
  message.textContent = errorMessage || "Couldn't reach Linear."
  wrap.appendChild(message)

  wrap.appendChild(
    createButton("Try again", "outline", {
      tone: "popover",
      onClick: () => {
        void refreshLinear(true)
        onChange()
      },
    })
  )
  return wrap
}

function buildSkeleton(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-3 py-1"
  wrap.dataset.loading = "true"
  for (let i = 0; i < 3; i++) {
    const row = document.createElement("div")
    row.className = "flex items-center gap-2"
    const dot = document.createElement("span")
    dot.className = "w-3.5 h-3.5 rounded-full bg-popover-foreground/[0.07] shrink-0 animate-pulse"
    const lines = document.createElement("span")
    lines.className = "flex-1 flex flex-col gap-1.5"
    const a = document.createElement("span")
    a.className = "h-2.5 rounded bg-popover-foreground/[0.07] animate-pulse"
    a.style.width = `${72 - i * 13}%`
    const b = document.createElement("span")
    b.className = "h-2 rounded bg-popover-foreground/[0.05] animate-pulse w-1/4"
    lines.append(a, b)
    row.append(dot, lines)
    wrap.appendChild(row)
  }
  return wrap
}

// ---------------------------------------------------------------- connect

/**
 * Connecting happens in the card, not only in Settings, so the widget is a way
 * in rather than a dead box pointing somewhere else. The API key is the whole
 * form; OAuth is one line underneath, because it cannot work until the user has
 * registered their own Linear app and there is nothing to gain from leading
 * with a button that usually fails. See `docs/linear.md`.
 */
function buildConnectPanel(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2.5 px-4 py-6 text-center"

  wrap.appendChild(icon("linear", { size: 28, class: "text-popover-foreground/25" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/70"
  heading.textContent = "Connect Linear"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[268px] text-[11px] leading-relaxed text-popover-foreground/40"
  sub.textContent = "See your inbox, what's due and what's in flight — and move an issue along without leaving this tab."
  wrap.appendChild(sub)

  const status = document.createElement("p")
  status.className = "max-w-[270px] text-[11px] leading-relaxed text-warning/80"
  status.hidden = true

  const field = document.createElement("div")
  field.className = "flex items-center gap-1.5 w-full max-w-[280px]"

  const keyInput = createInput({ type: "password", placeholder: "lin_api_…" }) as HTMLInputElement
  keyInput.className += " flex-1 min-w-0"

  const save = createButton("Connect", "primary", {
    tone: "popover",
    onClick: () => void submit(),
  })
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit()
  })

  async function submit(): Promise<void> {
    save.disabled = true
    status.hidden = true
    const result = await connectWithApiKey(keyInput.value)
    save.disabled = false
    if (result.ok) {
      keyInput.value = ""
      return
    }
    status.hidden = false
    status.textContent = result.error
  }

  field.append(keyInput, save)
  wrap.appendChild(field)

  const help = document.createElement("p")
  help.className = "max-w-[268px] text-[11px] leading-relaxed text-popover-foreground/35"
  help.textContent =
    "Linear → Settings → Security & access → New API key. Give it Read and Write, "
    + "and access to every team you want to see here."
  wrap.appendChild(help)

  const openLinear = document.createElement("button")
  openLinear.className = "text-[11px] underline text-accent"
  openLinear.textContent = "Open Linear API settings"
  openLinear.addEventListener("click", () => openUrl("https://linear.app/settings/account/security"))
  wrap.appendChild(openLinear)

  const oauth = document.createElement("button")
  oauth.className = "text-[11px] text-popover-foreground/35 hover:text-popover-foreground/60 transition-colors"
  oauth.textContent = getClientId() ? "Or sign in with OAuth" : "Set up OAuth instead"
  oauth.addEventListener("click", async () => {
    if (!getClientId()) {
      openSettings("advanced")
      return
    }
    oauth.disabled = true
    status.hidden = true
    const result = await authenticateOAuth()
    oauth.disabled = false
    if (result.ok) return
    status.hidden = false
    status.textContent = result.error
    if (result.needsClientId) openSettings("advanced")
  })
  wrap.appendChild(oauth)

  wrap.appendChild(status)
  return wrap
}

// ---------------------------------------------------------------- body

export function buildLinearBody(): { el: HTMLElement; rebuild: () => void; dispose: () => void } {
  const root = document.createElement("div")
  root.className = "flex flex-col min-w-0 max-h-[440px] overflow-y-auto overflow-x-hidden"

  function rebuild(): void {
    root.replaceChildren()

    if (!isConnected()) {
      root.appendChild(buildConnectPanel())
      return
    }
    if (currentState === "error") {
      root.appendChild(buildError(rebuild))
      root.appendChild(buildFooter(rebuild))
      return
    }
    if (currentState === "loading" && !data.fetchedAt) {
      root.appendChild(buildSkeleton())
      return
    }

    let any = false
    for (const section of sections()) {
      const el = buildSection(section, rebuild)
      if (el) {
        root.appendChild(el)
        any = true
      }
    }
    if (!any) root.appendChild(buildEmpty())

    const cycle = buildCycle()
    if (cycle) root.appendChild(cycle)
    root.appendChild(buildFooter(rebuild))
  }

  rebuild()

  const entry: LiveBody = { root, rebuild }
  liveBodies.add(entry)

  return {
    el: root,
    rebuild,
    dispose: () => {
      liveBodies.delete(entry)
    },
  }
}

/**
 * The Dashboard tile: one number per section and nothing else. At 118px there
 * is no room for a row that says anything useful, and a count is the part of
 * this widget that reads from across a room.
 */
export function buildLinearTile(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex items-center gap-5 min-w-0"

  const counts: Record<LinearSection, number> = {
    inbox: data.inbox.length,
    due: data.due.length,
    progress: data.progress.length,
    todo: data.todo.length,
  }
  const captions: Record<LinearSection, string> = {
    inbox: "inbox",
    due: data.due.some((i) => daysUntilDue(i.dueDate) < 0) ? "due · overdue" : "due soon",
    progress: "in progress",
    todo: "up next",
  }

  for (const section of sections()) {
    const cell = document.createElement("div")
    cell.className = "flex flex-col gap-0.5 min-w-0"

    const count = counts[section]
    const urgent = (section === "inbox" || section === "due") && count > 0

    const value = document.createElement("span")
    value.className = `text-[26px] leading-none font-semibold tabular-nums ${
      count ? (urgent ? "text-popover-foreground/90" : "text-popover-foreground/70") : "text-popover-foreground/25"
    }`
    value.textContent = String(count)
    cell.appendChild(value)

    const caption = document.createElement("span")
    caption.className = "text-[10px] uppercase tracking-[0.08em] text-popover-foreground/35 truncate"
    caption.textContent = captions[section]
    cell.appendChild(caption)

    wrap.appendChild(cell)
  }

  return wrap
}

// ---------------------------------------------------------------- trigger

function renderTrigger(): void {
  const trigger = document.getElementById("linear-trigger") as HTMLButtonElement | null
  if (!trigger) return

  if (!store.sync.get("linearEnabled")) {
    trigger.hidden = true
    closeLinearPopover()
    return
  }
  trigger.hidden = false

  const badge = document.getElementById("linear-badge") as HTMLElement
  const count = isConnected() && currentState === "loaded" ? actionableCount(data) : 0
  badge.hidden = count === 0
  badge.textContent = count > 99 ? "99+" : String(count)
  trigger.title = isConnected() ? `${count} item${count === 1 ? "" : "s"} need you in Linear` : "Connect Linear"
}

function closeLinearPopover(): void {
  linearPopoverClose?.()
  linearPopoverClose = null
}

function showLinearPopover(anchor: HTMLElement): void {
  closeLinearPopover()

  const body = buildLinearBody()
  body.el.style.width = "380px"
  void refreshLinear()

  const { close } = createPopover(anchor, body.el, {
    onClose: () => {
      linearPopoverClose = null
      body.dispose()
    },
  })
  linearPopoverClose = close
}

// ---------------------------------------------------------------- cards

let cardBody: ReturnType<typeof buildLinearBody> | null = null

registerCard({
  id: "linear",
  title: "Linear",
  order: 45,
  regions: { default: "grid", dashboard: "side" },
  enabledKey: "linearEnabled",
  render: () => {
    cardBody = buildLinearBody()
    void refreshLinear()
    return cardBody.el
  },
  onUnmount: () => {
    cardBody?.dispose()
    cardBody = null
  },
})

registerCard({
  id: "linear-summary",
  title: "Linear",
  order: 45,
  regions: { dashboard: "top" },
  enabledKey: "linearEnabled",
  // The tile has no way to connect, so it stays out of the row until there is
  // something to count. The side card is where a new user signs in.
  isEnabled: () => isConnected(),
  render: buildLinearTile,
  renderTile: buildLinearTile,
  tileTitle: () => "Linear",
})

// ---------------------------------------------------------------- init

/** The card data, for the palette's blended pass. */
export function linearSnapshot(): LinearData {
  return data
}

export function linearConnected(): boolean {
  return Boolean(store.local.get("linearToken"))
}

export function initLinear(): void {
  const trigger = document.getElementById("linear-trigger") as HTMLButtonElement | null

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation()
    if (linearPopoverClose) closeLinearPopover()
    else showLinearPopover(trigger)
  })

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && store.sync.get("linearEnabled") && isConnected()) {
      void refreshLinear()
    }
  })

  // The GitHub card publishing its pull requests changes what the PR chips can
  // say. Own-source updates are skipped: this card is already re-rendering for
  // the fetch that produced them.
  onLinksChanged((source) => {
    if (source === "github" && store.sync.get("linearLinkGithub")) notifyDataChanged()
  })

  store.sync.subscribe("linearEnabled", (enabled) => {
    if (enabled && isConnected()) {
      void refreshLinear()
      startRefreshInterval()
    } else {
      closeLinearPopover()
      stopRefreshInterval()
    }
    renderTrigger()
  })

  store.local.subscribe("linearToken", (token) => {
    refreshCards()
    if (token && store.sync.get("linearEnabled")) {
      currentState = "loading"
      void refreshLinear(true)
      startRefreshInterval()
    } else {
      stopRefreshInterval()
      data = EMPTY_DATA
      clearCache()
      publishLinearLinks([])
      currentState = "not-connected"
      notifyDataChanged()
    }
  })

  // Section choices re-render from the cache; the team filter and the cycle
  // toggle change the query itself, so those refetch.
  store.sync.subscribe("linearSections", () => {
    const cached = getCached()
    if (cached) data = cached
    notifyDataChanged()
  })
  for (const key of ["linearTeamFilter", "linearShowCycle", "linearLinkGithub"] as const) {
    store.sync.subscribe(key, () => {
      clearCache()
      void refreshLinear(true)
    })
  }
  store.sync.subscribe("linearClientId", () => {
    if (store.local.get("linearTokenType") === "oauth") void disconnect()
  })

  if (!store.sync.get("linearEnabled")) {
    renderTrigger()
    return
  }
  if (!isConnected()) {
    currentState = "not-connected"
    renderTrigger()
    return
  }

  const cached = getCached()
  if (cached) {
    data = cached
    currentState = "loaded"
    publishLinks()
  }
  renderTrigger()
  void refreshLinear()
  startRefreshInterval()
}
