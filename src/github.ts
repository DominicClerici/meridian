import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover, createButton } from "./components"
import { registerCard, refreshCard, refreshCards } from "./layout"
import { openSettings } from "./settings"
import type { GithubSection } from "./defaults"
import {
  authenticateDevice,
  cancelDeviceFlow,
  isConnected,
  clearTokens,
  GithubAuthError,
} from "./github-auth"
import type { DeviceCode } from "./github-auth"
import {
  fetchGithubData,
  filterData,
  markNotificationRead,
  actionableCount,
  urgency,
  EMPTY_DATA,
} from "./github-api"
import type { GithubData, GithubItem } from "./github-api"
import { publishGithubLinks, linearRefForPr, onLinksChanged } from "./issue-links"

const LS_DATA = "sp:github:data"
const LS_FETCH = "sp:github:lastFetch"

const COOLDOWN = 60_000
const REFRESH_INTERVAL = 300_000

/** Rows a section shows before it collapses behind a "show all". */
const ROWS_COLLAPSED = 4

type State = "loading" | "loaded" | "error" | "not-connected"

const SECTION_META: Record<GithubSection, { label: string; icon: string }> = {
  reviews: { label: "Needs your review", icon: "eye" },
  mine: { label: "Your pull requests", icon: "gitPullRequest" },
  mentions: { label: "Mentions", icon: "at" },
  issues: { label: "Assigned issues", icon: "issueOpen" },
}

const REASON_LABELS: Record<string, string> = {
  mention: "Mentioned",
  team_mention: "Team mention",
  assign: "Assigned",
  author: "Your thread",
  comment: "New comment",
  state_change: "State changed",
  ci_activity: "CI",
  security_alert: "Security",
  subscribed: "Update",
}

let currentState: State = "loading"
/** Exactly what GitHub returned, and what gets cached. */
let rawData: GithubData = EMPTY_DATA
/** `rawData` with the ignore-list and bot muting applied — what the UI reads. */
let data: GithubData = EMPTY_DATA
let errorMessage = ""
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let githubPopoverClose: (() => void) | null = null
let inFlight: Promise<void> | null = null

/** Sections the user has expanded past `ROWS_COLLAPSED`, for this page's life. */
const expanded = new Set<GithubSection>()

type LiveBody = { root: HTMLElement; rebuild: () => void }
const liveBodies = new Set<LiveBody>()

// ---------------------------------------------------------------- cache

function getCached(): GithubData | null {
  try {
    const raw = localStorage.getItem(LS_DATA)
    if (!raw) return null
    return { ...EMPTY_DATA, ...(JSON.parse(raw) as GithubData) }
  } catch {
    return null
  }
}

/** Filters are settings, not data, so they re-derive the view with no refetch. */
function applyFilters(): void {
  data = filterData(rawData)
  publishLinks()
}

function setCached(next: GithubData): void {
  writeCacheData(next)
  try {
    localStorage.setItem(LS_FETCH, String(Date.now()))
  } catch {
    // Quota or private mode — the widget still works, it just refetches.
  }
}

/** Rewrites the data without touching the timestamp — a local edit like marking
    a notification read is not a refresh, and shouldn't read as one. */
function writeCacheData(next: GithubData): void {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(next))
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
 * re-renders the card, which refetches — a tight retry loop against an API
 * that is already refusing us.
 */
let lastAttempt = 0

function isCooldownActive(): boolean {
  return Date.now() - lastAttempt < COOLDOWN
}

// ---------------------------------------------------------------- fetching

export function refreshGithub(force = false): Promise<void> {
  if (!store.sync.get("githubEnabled") || !isConnected()) return Promise.resolve()
  if (inFlight) return inFlight
  if (!force && isCooldownActive()) return Promise.resolve()

  lastAttempt = Date.now()
  if (currentState !== "loaded") setState("loading")

  // `inFlight` is cleared before each `setState`, not in a `finally`: the footer
  // reads it to decide between "Refreshing…" and a timestamp, and a finally runs
  // after the render it is supposed to describe.
  inFlight = (async () => {
    try {
      const next = await fetchGithubData()
      rawData = next
      applyFilters()
      setCached(next)
      errorMessage = ""
      inFlight = null
      setState("loaded")
    } catch (err: unknown) {
      inFlight = null
      if (err instanceof GithubAuthError) {
        // The token is already gone by the time this lands — clearTokens() runs
        // inside githubFetch, and its subscriber re-renders as not-connected.
        errorMessage = err.message
        return
      }
      errorMessage = err instanceof Error ? err.message : "Couldn't reach GitHub."
      setState("error")
    }
  })()

  return inFlight
}

/**
 * Hands the Linear card every pull request this one knows about, so a Linear
 * issue row can show its PR's check state without a second round trip. Filtered
 * data, not raw: a repo the user ignored here should not resurface over there.
 * See `issue-links.ts`.
 */
function publishLinks(): void {
  if (!store.sync.get("linearLinkGithub")) {
    publishGithubLinks([])
    return
  }
  publishGithubLinks(
    [...data.reviews, ...data.mine].map((item) => ({
      prUrl: item.url,
      ref: {
        number: item.number,
        repo: item.repo,
        url: item.url,
        title: item.title,
        ci: item.ci,
        isDraft: item.isDraft,
        reviewDecision: item.reviewDecision,
        conflicted: item.conflicted,
      },
    }))
  )
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
  refreshCard("github-summary")
}

function startRefreshInterval(): void {
  if (refreshIntervalId !== null) return
  refreshIntervalId = setInterval(() => {
    if (document.visibilityState === "visible") void refreshGithub()
  }, REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId === null) return
  clearInterval(refreshIntervalId)
  refreshIntervalId = null
}

// ---------------------------------------------------------------- helpers

function sections(): GithubSection[] {
  const chosen = store.sync.get("githubSections")
  return (Object.keys(SECTION_META) as GithubSection[]).filter((s) => chosen.includes(s))
}

function itemsFor(section: GithubSection): GithubItem[] {
  const list = data[section] ?? []
  if (section === "mine") return [...list].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt)
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
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

function shortRepo(repo: string): string {
  const org = store.sync.get("githubOrgFilter").trim()
  // With one org pinned, every row would start with the same word.
  if (org && repo.toLowerCase().startsWith(`${org.toLowerCase()}/`)) return repo.slice(org.length + 1)
  return repo
}

// ---------------------------------------------------------------- rows

function ciMark(item: GithubItem): HTMLElement | null {
  if (!item.ci) return null
  const map = {
    success: { name: "checkPassed", className: "text-success/70", label: "All checks passed" },
    failure: { name: "checkFailed", className: "text-danger", label: item.ciDetail ? `Failed: ${item.ciDetail}` : "Checks failed" },
    pending: { name: "checkPending", className: "text-warning/80", label: "Checks running" },
  }[item.ci]

  const wrap = document.createElement("span")
  wrap.className = `shrink-0 ${map.className}`
  wrap.title = map.label
  wrap.appendChild(icon(map.name, { size: 14 }))
  return wrap
}

function reviewPips(item: GithubItem): HTMLElement | null {
  if (item.reviewersTotal < 1) return null

  const wrap = document.createElement("span")
  wrap.className = "inline-flex items-center gap-[3px] shrink-0"
  wrap.title = `${item.approvals} of ${item.reviewersTotal} approvals`

  const shown = Math.min(item.reviewersTotal, 5)
  for (let i = 0; i < shown; i++) {
    const pip = document.createElement("span")
    pip.className =
      i < item.approvals
        ? "w-1.5 h-1.5 rounded-full bg-success/80"
        : "w-1.5 h-1.5 rounded-full bg-popover-foreground/20"
    wrap.appendChild(pip)
  }
  return wrap
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

/** The one-line verdict on your own PR, and the reason it sorts where it does. */
function mineChip(item: GithubItem): HTMLElement | null {
  if (item.conflicted) return statusChip("Conflicts", "danger")
  if (item.reviewDecision === "CHANGES_REQUESTED") return statusChip("Changes", "danger")
  if (item.isDraft) return statusChip("Draft", "muted")
  if (item.reviewDecision === "APPROVED") return statusChip("Ready", "success")
  return null
}

function avatar(item: GithubItem): HTMLElement | null {
  if (!item.author?.avatarUrl) return null
  const img = document.createElement("img")
  img.src = item.author.avatarUrl
  img.alt = ""
  img.loading = "lazy"
  img.referrerPolicy = "no-referrer"
  img.title = item.author.login
  img.className = "w-5 h-5 rounded-full shrink-0 mt-px bg-popover-foreground/10"
  return img
}

/**
 * The Linear half of the cross-link: the issue that claims this pull request,
 * in its own status color. Only appears when the Linear card is connected and
 * has actually seen the issue — there is no lookup to do otherwise, and no
 * network is spent finding out. See `issue-links.ts`.
 */
function linearChip(item: GithubItem): HTMLElement | null {
  if (!store.sync.get("linearLinkGithub")) return null
  const ref = linearRefForPr(item.url)
  if (!ref) return null

  const chip = document.createElement("a")
  chip.href = ref.url
  chip.target = "_blank"
  chip.rel = "noopener noreferrer"
  chip.title = `${ref.identifier} · ${ref.stateName} — ${ref.title}`
  chip.className =
    "shrink-0 inline-flex items-center gap-1 px-1.5 rounded-[4px] leading-[16px] bg-popover-foreground/[0.07] hover:bg-popover-foreground/[0.12] transition-colors"
  // The chip is a link inside a link; without this the row's href wins.
  chip.addEventListener("click", (e) => e.stopPropagation())

  const dot = document.createElement("span")
  dot.className = "w-1.5 h-1.5 rounded-full shrink-0"
  dot.style.backgroundColor = ref.stateColor
  chip.appendChild(dot)

  const label = document.createElement("span")
  label.className = "font-mono text-[10px] tracking-tight text-popover-foreground/60"
  label.textContent = ref.identifier
  chip.appendChild(label)

  return chip
}

function buildRow(item: GithubItem, section: GithubSection, onChange: () => void): HTMLElement {
  const row = document.createElement("a")
  row.href = item.url
  row.target = "_blank"
  row.rel = "noopener noreferrer"
  row.className =
    "group flex items-start gap-2 px-1.5 py-1.5 -mx-1.5 rounded-theme transition-colors hover:bg-popover-foreground/[0.06] focus-visible:bg-popover-foreground/[0.06] outline-none"

  const lead =
    section === "reviews" ? avatar(item)
    : section === "mine" ? icon(item.isDraft ? "gitDraft" : "gitPullRequest", { size: 15, class: "shrink-0 mt-0.5 opacity-40" })
    : section === "issues" ? icon("issueOpen", { size: 15, class: "shrink-0 mt-0.5 opacity-40" })
    : icon("at", { size: 15, class: "shrink-0 mt-0.5 opacity-40" })
  if (lead) row.appendChild(lead)

  const main = document.createElement("span")
  main.className = "flex-1 min-w-0 flex flex-col gap-0.5"

  const titleLine = document.createElement("span")
  titleLine.className = "flex items-center gap-1.5 min-w-0"

  const title = document.createElement("span")
  title.className = "truncate min-w-0 text-[13px] leading-snug text-popover-foreground/90"
  title.textContent = item.title
  titleLine.appendChild(title)

  if (section === "mine") {
    const chip = mineChip(item)
    if (chip) titleLine.appendChild(chip)
  }
  if (section === "mentions" && item.reason) {
    titleLine.appendChild(statusChip(REASON_LABELS[item.reason] ?? item.reason.replace(/_/g, " "), "muted"))
  }
  main.appendChild(titleLine)

  const meta = document.createElement("span")
  meta.className = "flex items-center gap-1.5 min-w-0 text-[11px] text-popover-foreground/40"

  const where = document.createElement("span")
  where.className = "truncate min-w-0"
  where.textContent = item.number ? `${shortRepo(item.repo)} #${item.number}` : shortRepo(item.repo)
  meta.appendChild(where)

  const age = document.createElement("span")
  age.className = "shrink-0 tabular-nums"
  age.textContent = `· ${relativeTime(item.updatedAt)}`
  meta.appendChild(age)

  const linear = linearChip(item)
  if (linear) meta.appendChild(linear)

  const pips = section === "mine" ? reviewPips(item) : null
  if (pips) meta.appendChild(pips)

  for (const label of item.labels.slice(0, 2)) {
    const tag = document.createElement("span")
    tag.className = "shrink-0 px-1 rounded-[3px] text-[10px] leading-[15px]"
    tag.style.backgroundColor = `#${label.color}26`
    tag.style.color = `#${label.color}`
    tag.textContent = label.name
    meta.appendChild(tag)
  }

  main.appendChild(meta)
  row.appendChild(main)

  const trailing = document.createElement("span")
  trailing.className = "shrink-0 flex items-center gap-1 pt-0.5"

  const mark = ciMark(item)
  if (mark) trailing.appendChild(mark)

  if (item.threadId) {
    const done = document.createElement("button")
    done.className =
      "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-popover-foreground/40 hover:text-popover-foreground/80"
    done.title = "Mark as read"
    done.appendChild(icon("mailOpen", { size: 14 }))
    done.addEventListener("click", async (e) => {
      // The row is a link; without this the click both marks read and navigates.
      e.preventDefault()
      e.stopPropagation()
      done.disabled = true
      if (await markNotificationRead(item.threadId!)) {
        rawData = { ...rawData, mentions: rawData.mentions.filter((m) => m.id !== item.id) }
        applyFilters()
        writeCacheData(rawData)
        // Not `onChange()`: one fewer mention changes the trigger badge and the
        // Dashboard tile too, and only this reaches them.
        notifyDataChanged()
      } else {
        done.disabled = false
      }
    })
    trailing.appendChild(done)
  }

  if (trailing.childElementCount) row.appendChild(trailing)
  return row
}

// ---------------------------------------------------------------- sections

function buildSection(section: GithubSection, onChange: () => void): HTMLElement | null {
  const items = itemsFor(section)
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
  for (const item of visible) list.appendChild(buildRow(item, section, onChange))
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

function buildContributions(): HTMLElement | null {
  if (!store.sync.get("githubShowContributions")) return null
  const contributions = data.contributions
  if (!contributions?.days.length) return null

  const max = Math.max(...contributions.days, 1)

  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1.5 pt-3 mt-1 border-t border-popover-foreground/[0.07]"

  const grid = document.createElement("div")
  grid.className = "grid grid-flow-col gap-[3px] justify-start"
  grid.style.gridTemplateRows = "repeat(7, 1fr)"

  for (const count of contributions.days) {
    const cell = document.createElement("span")
    cell.className = "w-[9px] h-[9px] rounded-[2px] bg-accent"
    // Four steps read as levels; a continuous ramp reads as noise at 9px.
    const level = count === 0 ? 0 : count >= max * 0.66 ? 1 : count >= max * 0.33 ? 0.66 : 0.34
    cell.style.opacity = level === 0 ? "0.08" : String(level)
    if (level === 0) cell.classList.replace("bg-accent", "bg-popover-foreground")
    grid.appendChild(cell)
  }
  wrap.appendChild(grid)

  const caption = document.createElement("span")
  caption.className = "text-[11px] text-popover-foreground/35"
  caption.textContent = `${contributions.total.toLocaleString()} contributions this year`
  wrap.appendChild(caption)

  return wrap
}

function buildFooter(onChange: () => void): HTMLElement {
  const footer = document.createElement("div")
  footer.className = "flex items-center gap-2 pt-2.5 mt-1 text-[11px] text-popover-foreground/35"

  const stamp = document.createElement("span")
  stamp.className = "flex-1 min-w-0 truncate"
  const last = Number(localStorage.getItem(LS_FETCH) ?? 0)
  stamp.textContent = inFlight
    ? "Refreshing…"
    : !last ? ""
    : relativeTime(last) === "now" ? "Updated just now"
    : `Updated ${relativeTime(last)} ago`
  footer.appendChild(stamp)

  const user = store.local.get("githubUser")
  if (user) {
    const account = document.createElement("a")
    account.href = `https://github.com/${user.login}`
    account.target = "_blank"
    account.rel = "noopener noreferrer"
    account.className = "shrink-0 hover:text-popover-foreground/60 transition-colors"
    account.textContent = `@${user.login}`
    footer.appendChild(account)
  }

  const refresh = document.createElement("button")
  refresh.className = "shrink-0 hover:text-popover-foreground/70 transition-colors disabled:opacity-40"
  refresh.title = "Refresh"
  refresh.disabled = inFlight !== null
  refresh.appendChild(icon("refresh", { size: 13 }))
  refresh.addEventListener("click", () => {
    void refreshGithub(true)
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
  heading.textContent = "You're all clear"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[250px] text-[11px] leading-relaxed text-popover-foreground/35"
  sub.textContent = "No reviews waiting, nothing blocked, no unread mentions."
  wrap.appendChild(sub)

  return wrap
}

function buildError(onChange: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
  wrap.appendChild(icon("alertTriangle", { size: 22, class: "text-warning/70" }))

  const message = document.createElement("p")
  message.className = "max-w-[260px] text-[12px] leading-relaxed text-popover-foreground/55"
  message.textContent = errorMessage || "Couldn't reach GitHub."
  wrap.appendChild(message)

  wrap.appendChild(
    createButton("Try again", "outline", {
      tone: "popover",
      onClick: () => {
        void refreshGithub(true)
        onChange()
      },
    })
  )
  return wrap
}

function buildSkeleton(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-3 py-1"
  for (let i = 0; i < 3; i++) {
    const row = document.createElement("div")
    row.className = "flex items-center gap-2"
    const dot = document.createElement("span")
    dot.className = "w-5 h-5 rounded-full bg-popover-foreground/[0.07] shrink-0 animate-pulse"
    const lines = document.createElement("span")
    lines.className = "flex-1 flex flex-col gap-1.5"
    const a = document.createElement("span")
    a.className = "h-2.5 rounded bg-popover-foreground/[0.07] animate-pulse"
    a.style.width = `${70 - i * 12}%`
    const b = document.createElement("span")
    b.className = "h-2 rounded bg-popover-foreground/[0.05] animate-pulse w-1/3"
    lines.append(a, b)
    row.append(dot, lines)
    wrap.appendChild(row)
  }
  return wrap
}

// ---------------------------------------------------------------- connect

/**
 * The device flow rendered inline, so the widget is a way in rather than a dead
 * box pointing at Settings. Owns its own polling: the abort fires when the body
 * is rebuilt or unmounted, which is also what a closed popover does.
 */
function buildConnectPanel(onChange: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2.5 px-4 py-6 text-center"

  wrap.appendChild(icon("github", { size: 30, class: "text-popover-foreground/25" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/70"
  heading.textContent = "Connect GitHub"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[260px] text-[11px] leading-relaxed text-popover-foreground/40"
  sub.textContent = "See review requests, your pull requests and mentions without leaving this tab."
  wrap.appendChild(sub)

  const status = document.createElement("p")
  status.className = "max-w-[270px] text-[11px] leading-relaxed text-warning/80"
  status.hidden = true

  const codeBox = document.createElement("div")
  codeBox.className = "flex flex-col items-center gap-2"
  codeBox.hidden = true

  const connect = createButton("Connect GitHub", "primary", {
    tone: "popover",
    icon: icon("github", { size: 15 }),
    onClick: async () => {
      connect.disabled = true
      status.hidden = true
      codeBox.hidden = true

      const result = await authenticateDevice({ onCode: (code) => showCode(code) })

      connect.disabled = false
      codeBox.hidden = true
      if (result.ok) return

      status.hidden = false
      status.textContent = result.error
      if (result.needsClientId) {
        const link = document.createElement("button")
        link.className = "underline text-accent ml-1"
        link.textContent = "Open Advanced settings"
        link.addEventListener("click", () => openSettings("advanced"))
        status.appendChild(link)
      }
    },
  })
  wrap.appendChild(connect)
  wrap.appendChild(codeBox)
  wrap.appendChild(status)

  function showCode(code: DeviceCode): void {
    codeBox.replaceChildren()
    codeBox.hidden = false
    connect.hidden = true

    const instruction = document.createElement("p")
    instruction.className = "text-[11px] text-popover-foreground/40"
    instruction.textContent = "Enter this code on GitHub:"
    codeBox.appendChild(instruction)

    const value = document.createElement("button")
    value.className =
      "font-mono text-[22px] tracking-[0.18em] text-popover-foreground/90 px-3 py-1 rounded-theme bg-popover-foreground/[0.06] hover:bg-popover-foreground/[0.1] transition-colors"
    value.textContent = code.userCode
    value.title = "Copy code"
    value.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.userCode)
        value.textContent = "Copied"
        setTimeout(() => { value.textContent = code.userCode }, 1200)
      } catch {
        // Clipboard denied — the code is on screen to type anyway.
      }
    })
    codeBox.appendChild(value)

    const open = createButton("Open github.com/login/device", "outline", {
      tone: "popover",
      icon: icon("externalLink", { size: 14 }),
      onClick: () => openUrl(code.verificationUri),
    })
    codeBox.appendChild(open)

    const waiting = document.createElement("p")
    waiting.className = "text-[11px] text-popover-foreground/35"
    waiting.textContent = "Waiting for approval…"
    codeBox.appendChild(waiting)

    const cancel = document.createElement("button")
    cancel.className = "text-[11px] text-popover-foreground/35 hover:text-popover-foreground/60 transition-colors"
    cancel.textContent = "Cancel"
    cancel.addEventListener("click", () => cancelDeviceFlow())
    codeBox.appendChild(cancel)

    // The tab opens itself: the code is worth nothing without the page, and a
    // user who has to find the URL by hand usually gives up on the second try.
    openUrl(code.verificationUri)
  }

  return wrap
}

// ---------------------------------------------------------------- body

export function buildGithubBody(): { el: HTMLElement; rebuild: () => void; dispose: () => void } {
  const root = document.createElement("div")
  root.className = "flex flex-col min-w-0 max-h-[440px]"

  function rebuild(): void {
    root.replaceChildren()

    if (!isConnected()) {
      root.appendChild(buildConnectPanel(rebuild))
      return
    }
    if (currentState === "loading" && !data.fetchedAt) {
      root.appendChild(buildSkeleton())
      return
    }

    // Only the list scrolls. The contribution strip and the footer are chrome:
    // burying the refresh button under four sections of rows means the one
    // control the widget has is the one nobody finds.
    const list = document.createElement("div")
    list.className = "flex flex-col flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden"

    if (currentState === "error") {
      list.appendChild(buildError(rebuild))
    } else {
      let any = false
      for (const section of sections()) {
        const el = buildSection(section, rebuild)
        if (el) {
          list.appendChild(el)
          any = true
        }
      }
      if (!any) list.appendChild(buildEmpty())
    }
    root.appendChild(list)

    if (currentState !== "error") {
      const contributions = buildContributions()
      if (contributions) root.appendChild(contributions)
    }
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
      cancelDeviceFlow()
    },
  }
}

/**
 * The Dashboard tile: one number per section and nothing else. At 118px there
 * is no room for a row that says anything useful, and a count is the part of
 * this widget that reads from across a room.
 */
export function buildGithubTile(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex items-center gap-5 min-w-0"

  const blocked = data.mine.filter((i) => urgency(i) >= 3).length
  const counts: Record<GithubSection, number> = {
    reviews: data.reviews.length,
    mine: data.mine.length,
    mentions: data.mentions.length,
    issues: data.issues.length,
  }
  const captions: Record<GithubSection, string> = {
    reviews: "to review",
    mine: blocked ? `open · ${blocked} blocked` : "open PRs",
    mentions: "mentions",
    issues: "issues",
  }

  for (const section of sections()) {
    const cell = document.createElement("div")
    cell.className = "flex flex-col gap-0.5 min-w-0"

    const value = document.createElement("span")
    const count = counts[section]
    const urgent = (section === "reviews" && count > 0) || (section === "mine" && blocked > 0) || (section === "mentions" && count > 0)
    value.className = `text-[26px] leading-none font-semibold tabular-nums ${count ? (urgent ? "text-popover-foreground/90" : "text-popover-foreground/70") : "text-popover-foreground/25"}`
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
  const trigger = document.getElementById("github-trigger") as HTMLButtonElement | null
  if (!trigger) return

  if (!store.sync.get("githubEnabled")) {
    trigger.hidden = true
    closeGithubPopover()
    return
  }
  trigger.hidden = false

  const badge = document.getElementById("github-badge") as HTMLElement
  const count = isConnected() && currentState === "loaded" ? actionableCount(data) : 0
  badge.hidden = count === 0
  badge.textContent = count > 99 ? "99+" : String(count)
  trigger.title = isConnected() ? `${count} item${count === 1 ? "" : "s"} need you on GitHub` : "Connect GitHub"
}

function closeGithubPopover(): void {
  githubPopoverClose?.()
  githubPopoverClose = null
}

function showGithubPopover(anchor: HTMLElement): void {
  closeGithubPopover()

  const body = buildGithubBody()
  body.el.style.width = "380px"
  void refreshGithub()

  const { close } = createPopover(anchor, body.el, {
    onClose: () => {
      githubPopoverClose = null
      body.dispose()
    },
  })
  githubPopoverClose = close
}

// ---------------------------------------------------------------- cards

let cardBody: ReturnType<typeof buildGithubBody> | null = null

registerCard({
  id: "github",
  title: "GitHub",
  order: 40,
  regions: { default: "grid", dashboard: "side" },
  enabledKey: "githubEnabled",
  render: () => {
    cardBody = buildGithubBody()
    void refreshGithub()
    return cardBody.el
  },
  onUnmount: () => {
    cardBody?.dispose()
    cardBody = null
  },
})

registerCard({
  id: "github-summary",
  title: "GitHub",
  order: 40,
  regions: { dashboard: "top" },
  enabledKey: "githubEnabled",
  // The tile has no way to connect, so it stays out of the row until there is
  // something to count. The side card is where a new user signs in.
  isEnabled: () => isConnected(),
  render: buildGithubTile,
  renderTile: buildGithubTile,
  tileTitle: () => "GitHub",
})

// ---------------------------------------------------------------- init

export function initGithub(): void {
  const trigger = document.getElementById("github-trigger") as HTMLButtonElement | null

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation()
    if (githubPopoverClose) closeGithubPopover()
    else showGithubPopover(trigger)
  })

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && store.sync.get("githubEnabled") && isConnected()) {
      void refreshGithub()
    }
  })

  // The Linear card publishing its issues changes what the identifier chips can
  // say. Own-source updates are skipped: this card is already re-rendering for
  // the fetch that produced them.
  onLinksChanged((source) => {
    if (source === "linear" && store.sync.get("linearLinkGithub")) notifyDataChanged()
  })

  store.sync.subscribe("linearLinkGithub", () => {
    publishLinks()
    notifyDataChanged()
  })

  store.sync.subscribe("githubEnabled", (enabled) => {
    if (enabled && isConnected()) {
      void refreshGithub()
      startRefreshInterval()
    } else {
      closeGithubPopover()
      stopRefreshInterval()
    }
    renderTrigger()
  })

  // Tracks *connectedness*, not the token value. Refreshing an expiring token
  // rewrites this key without the session changing, and treating that as a
  // fresh sign-in would drop the widget back to a skeleton every eight hours.
  let connected = isConnected()
  store.local.subscribe("githubToken", (token) => {
    const nowConnected = token !== null
    if (nowConnected === connected) return
    connected = nowConnected

    refreshCards()
    if (nowConnected && store.sync.get("githubEnabled")) {
      currentState = "loading"
      void refreshGithub(true)
      startRefreshInterval()
    } else {
      stopRefreshInterval()
      rawData = EMPTY_DATA
      data = EMPTY_DATA
      clearCache()
      currentState = "not-connected"
      notifyDataChanged()
    }
  })

  // Filters and section choices re-render from the cache; only the org filter
  // changes the query itself, so only that one refetches.
  for (const key of ["githubSections", "githubHideBots", "githubShowContributions", "githubIgnoredRepos"] as const) {
    store.sync.subscribe(key, () => {
      applyFilters()
      notifyDataChanged()
    })
  }
  store.sync.subscribe("githubOrgFilter", () => {
    clearCache()
    void refreshGithub(true)
  })
  store.sync.subscribe("githubClientId", () => {
    if (store.local.get("githubTokenType") === "oauth") clearTokens()
  })

  if (!store.sync.get("githubEnabled")) {
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
    rawData = cached
    applyFilters()
    currentState = "loaded"
  }
  renderTrigger()
  void refreshGithub()
  startRefreshInterval()
}
