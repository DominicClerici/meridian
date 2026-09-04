import { store } from "./store"
import { registerCard } from "./layout"
import { icon } from "./icons/registry"
import { createButton, createPopover } from "./components"
import { openSettings } from "./settings"
import { getDueOn, normalizeTodos } from "./todos"
import type { Todo } from "./todos"
import { showTodoPopover } from "./todo"
import {
  authenticate as googleAuthenticate,
  getValidToken,
  invalidateToken,
  releaseGoogle,
} from "./google-auth"
import type { AuthOutcome } from "./google-auth"

export type { AuthOutcome }

export type CalendarEvent = {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  allDayDate: string | null
  htmlLink: string
  calendarId: string
  calendarName: string
  color: string
  location: string | null
}

type CalendarInfo = {
  id: string
  name: string
  backgroundColor: string
}

type GoogleColorMap = {
  event: Record<string, { background: string }>
}

const LS_CALENDAR_LIST = "sp:calendar:calendarList"
const LS_CALENDAR_LIST_TS = "sp:calendar:calendarListTs"
const LS_COLOR_MAP = "sp:calendar:colors"
const WEEK_PREFIX = "sp:calendar:week:"
/** Pre-week caches, keyed by whatever range the view happened to ask for. Swept on init. */
const LEGACY_KEYS = ["sp:calendar:events:", "sp:calendar:lastFetch"]

/** How long a cached week is served before it is refetched behind the view. */
const WEEK_TTL = 300_000
const REFRESH_INTERVAL = 300_000
const CALENDAR_LIST_TTL = 3_600_000
/** `draw()` asks for its week on every render, so a failed week has to stop answering for a while. */
const FETCH_RETRY_COOLDOWN = 20_000
/** Weeks this far from the current one are dropped from localStorage; nothing can navigate to them. */
const WEEK_KEEP_RADIUS = 3

type State = "not-connected" | "loading" | "loaded" | "error"
type ViewMode = "1d" | "1w"

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** One week of events, as fetched and as cached. */
type WeekData = { ts: number; events: CalendarEvent[] }

let currentState: State = "loading"
/** Every week we hold, keyed by the local date of its Sunday. Both views read out of exactly one. */
const weeks = new Map<string, WeekData>()
const weekFetches = new Map<string, Promise<void>>()
const weekFailedAt = new Map<string, number>()
/** A localStorage miss is worth remembering — `draw()` would otherwise re-parse for it every render. */
const weekHydrated = new Set<string>()
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let calendarPopoverClose: (() => void) | null = null
let viewMode: ViewMode = "1d"
let offset = 0

export async function authenticate(): Promise<AuthOutcome> {
  const outcome = await googleAuthenticate("calendar")
  if (outcome.ok) store.local.set("calendarConnected", true)
  return outcome
}

function getCachedCalendarList(): CalendarInfo[] | null {
  try {
    const ts = localStorage.getItem(LS_CALENDAR_LIST_TS)
    if (!ts || Date.now() - Number(ts) > CALENDAR_LIST_TTL) return null
    const raw = localStorage.getItem(LS_CALENDAR_LIST)
    return raw ? (JSON.parse(raw) as CalendarInfo[]) : null
  } catch {
    return null
  }
}

async function fetchCalendarList(token: string): Promise<CalendarInfo[]> {
  const cached = getCachedCalendarList()
  if (cached) return cached

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`CalendarList HTTP ${res.status}`)

  const data = await res.json()
  const calendars: CalendarInfo[] = (data.items ?? [])
    .filter((c: Record<string, unknown>) => c.selected !== false)
    .map((c: Record<string, unknown>) => ({
      id: c.id as string,
      name: (c.summaryOverride ?? c.summary ?? "") as string,
      backgroundColor: (c.backgroundColor ?? "#4285f4") as string,
    }))

  try {
    localStorage.setItem(LS_CALENDAR_LIST, JSON.stringify(calendars))
    localStorage.setItem(LS_CALENDAR_LIST_TS, String(Date.now()))
  } catch { /* quota */ }

  return calendars
}

async function fetchColorMap(token: string): Promise<GoogleColorMap> {
  try {
    const cached = localStorage.getItem(LS_COLOR_MAP)
    if (cached) return JSON.parse(cached) as GoogleColorMap
  } catch { /* */ }

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/colors",
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Colors HTTP ${res.status}`)

  const data = (await res.json()) as GoogleColorMap
  try {
    localStorage.setItem(LS_COLOR_MAP, JSON.stringify(data))
  } catch { /* quota */ }

  return data
}

export async function disconnect(): Promise<void> {
  // The flag goes first: `releaseGoogle()` reads it back to decide whether the
  // shared token still has a user. Revoking here unconditionally would sign the
  // mail widget out of the same account.
  store.local.set("calendarConnected", false)
  await releaseGoogle()

  clearWeeks()
  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.startsWith("sp:calendar:")) localStorage.removeItem(key)
    }
  } catch { /* */ }
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

// Every span here is advanced by date component, not by adding ms: across a DST
// boundary a fixed 86_400_000 lands an hour either side of local midnight.
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}

/** The key a week is cached under: the local date of its Sunday. */
function weekKeyOf(d: Date): string {
  return localDateStr(startOfWeek(d))
}

/** The week `n` weeks from the one containing today. */
function weekKeyAt(n: number): string {
  return localDateStr(addDays(startOfWeek(new Date()), n * 7))
}

function dayAt(n: number): Date {
  return addDays(new Date(), n)
}

function weekStartAt(n: number): Date {
  return addDays(startOfWeek(new Date()), n * 7)
}

/** The one week the current view draws out of — a day is always inside a week we hold. */
function visibleWeekKey(): string {
  return viewMode === "1d" ? weekKeyOf(dayAt(offset)) : weekKeyAt(offset)
}

function getDateRange(): { start: Date; end: Date } {
  if (viewMode === "1d") {
    const start = dayAt(offset)
    return { start, end: addDays(start, 1) }
  }
  const start = weekStartAt(offset)
  return { start, end: addDays(start, 7) }
}

/* ── The week cache ─────────────────────────────────────────────────────── */

function readWeekCache(key: string): WeekData | null {
  try {
    const raw = localStorage.getItem(WEEK_PREFIX + key)
    if (!raw) return null
    const data = JSON.parse(raw) as WeekData
    return data && typeof data.ts === "number" && Array.isArray(data.events) ? data : null
  } catch {
    return null
  }
}

function writeWeekCache(key: string, data: WeekData): void {
  try {
    localStorage.setItem(WEEK_PREFIX + key, JSON.stringify(data))
  } catch {
    pruneWeekCache()
    try { localStorage.setItem(WEEK_PREFIX + key, JSON.stringify(data)) } catch { /* quota */ }
  }
}

/** Drops cached weeks nothing can navigate to any more, and the pre-week caches. */
function pruneWeekCache(): void {
  try {
    const keep = new Set<string>()
    for (let n = -WEEK_KEEP_RADIUS; n <= WEEK_KEEP_RADIUS; n++) keep.add(WEEK_PREFIX + weekKeyAt(n))
    for (const key of Object.keys(localStorage)) {
      if (LEGACY_KEYS.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key)
      else if (key.startsWith(WEEK_PREFIX) && !keep.has(key)) localStorage.removeItem(key)
    }
  } catch { /* */ }
}

/** What we hold for a week, fresh or stale. Hydrates from localStorage once, then reads memory. */
function getWeek(key: string): WeekData | null {
  const held = weeks.get(key)
  if (held) return held
  if (weekHydrated.has(key)) return null
  weekHydrated.add(key)
  const cached = readWeekCache(key)
  if (cached) weeks.set(key, cached)
  return cached
}

function isFresh(data: WeekData): boolean {
  return Date.now() - data.ts < WEEK_TTL
}

/**
 * Brings `key` up to date without ever blocking a render: callers fire and
 * forget, and the redraw arrives from `notifyDataChanged()` when the fetch
 * lands. It must stay safe to call from inside `draw()` — a version that
 * resolved into a redraw would spin a failing week into a microtask loop.
 *
 * The promise is only for ordering the prefetch behind the visible week.
 */
function requestWeek(key: string, force = false): Promise<void> {
  const running = weekFetches.get(key)
  if (running) return running

  let data = getWeek(key)
  if (!data || !isFresh(data)) {
    // Another tab may have cached this week since we last looked.
    const cached = readWeekCache(key)
    if (cached && (!data || cached.ts > data.ts)) {
      weeks.set(key, cached)
      weekHydrated.add(key)
      data = cached
      notifyDataChanged()
    }
  }
  if (data && isFresh(data) && !force) return Promise.resolve()

  const failedAt = weekFailedAt.get(key)
  if (!force && failedAt !== undefined && Date.now() - failedAt < FETCH_RETRY_COOLDOWN) {
    return Promise.resolve()
  }
  weekFailedAt.delete(key)

  const run = fetchWeek(key)
    .then(events => {
      const next = { ts: Date.now(), events }
      weeks.set(key, next)
      weekHydrated.add(key)
      writeWeekCache(key, next)
    })
    .catch(() => {
      weekFailedAt.set(key, Date.now())
    })
    .finally(() => {
      weekFetches.delete(key)
      syncState()
      notifyDataChanged()
    })

  weekFetches.set(key, run)
  syncState()
  return run
}

/**
 * Every week the current view can reach without a fetch. The day view spans
 * ±7 days, which never leaves the weeks either side of today; the week view
 * gets its neighbour so one more step is already in hand when it is taken.
 */
function prefetchKeys(): string[] {
  const here = viewMode === "1w" ? offset : 0
  const wanted = new Set([-1, 0, 1])
  for (const n of [here - 1, here + 1]) {
    if (Math.abs(n) <= NAV_LIMITS["1w"]) wanted.add(n)
  }
  return [...wanted].map(weekKeyAt)
}

/**
 * The visible week first, alone, so it is never queued behind a prefetch; its
 * neighbours start as soon as it lands.
 *
 * Only the visible week is revalidated. A neighbour we already hold is left
 * alone however stale it has gone — navigating to it renders that copy
 * instantly and refreshes it behind the view, which is the whole point of
 * holding it. Refreshing all five every five minutes would be five times the
 * requests for weeks nobody is looking at.
 */
function refreshCalendar(force = false): Promise<void> {
  if (!store.sync.get("calendarEnabled")) return Promise.resolve()
  if (!store.local.get("calendarConnected")) {
    syncState()
    return Promise.resolve()
  }
  return requestWeek(visibleWeekKey(), force).then(() => {
    for (const key of prefetchKeys()) {
      if (!getWeek(key)) requestWeek(key)
    }
  })
}

/* ── State and redraws ──────────────────────────────────────────────────── */

let notifyQueued = false

/**
 * One entry point for "the data moved" — coalesced, because a fetch landing,
 * a state change and a cross-tab adoption can all fire in the same tick, and
 * each host rebuild is a full re-render.
 *
 * It goes through `liveBodies` rather than the card and the popover by name, so
 * a body only has to exist to stay current.
 */
function notifyDataChanged(): void {
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    renderTrigger()
    for (const entry of [...liveBodies]) entry.rebuild()
  })
}

function setState(next: State): void {
  if (next === currentState) return
  currentState = next
  notifyDataChanged()
}

/** The trigger speaks for today, so the widget's state is this week's state. */
function syncState(): void {
  if (!store.local.get("calendarConnected")) {
    setState("not-connected")
    return
  }
  const key = weekKeyAt(0)
  if (getWeek(key)) setState("loaded")
  else if (weekFetches.has(key)) setState("loading")
  else setState(weekFailedAt.has(key) ? "error" : "loading")
}

function countEventsToday(): number {
  const data = getWeek(weekKeyAt(0))
  if (!data) return 0
  const dateStr = localDateStr(new Date())
  return blocksForDay(data.events, dateStr).length + allDayFor(data.events, dateStr).length
}

/* ── Fetching ───────────────────────────────────────────────────────────── */

type FetchContext = { token: string; calendars: CalendarInfo[]; colorMap: GoogleColorMap }

let contextInFlight: Promise<FetchContext> | null = null

/** Token, calendar list and colour map, shared so parallel week fetches ask for them once. */
function getFetchContext(): Promise<FetchContext> {
  if (contextInFlight) return contextInFlight
  const run = loadFetchContext().finally(() => { contextInFlight = null })
  contextInFlight = run
  return run
}

async function loadFetchContext(): Promise<FetchContext> {
  const token = await requireToken()
  try {
    return await withToken(token)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("401")) throw e
    // The list and the colours are cached; a 401 means both the cache and the
    // token behind them are suspect, so drop the lot and go round once more.
    localStorage.removeItem(LS_CALENDAR_LIST)
    localStorage.removeItem(LS_CALENDAR_LIST_TS)
    localStorage.removeItem(LS_COLOR_MAP)
    await invalidateToken()
    return await withToken(await requireToken())
  }
}

async function withToken(token: string): Promise<FetchContext> {
  const [calendars, colorMap] = await Promise.all([fetchCalendarList(token), fetchColorMap(token)])
  return { token, calendars, colorMap }
}

async function requireToken(): Promise<string> {
  const token = await getValidToken("calendar")
  if (!token) {
    markDisconnected()
    throw new Error("No Google token")
  }
  return token
}

function markDisconnected(): void {
  clearWeeks()
  store.local.set("calendarConnected", false)
  syncState()
}

function clearWeeks(): void {
  weeks.clear()
  weekHydrated.clear()
  weekFailedAt.clear()
}

async function fetchWeek(key: string): Promise<CalendarEvent[]> {
  const start = new Date(`${key}T00:00:00`)
  const { token, calendars, colorMap } = await getFetchContext()

  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: addDays(start, 7).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  })

  // Google has no cross-calendar events endpoint, so this is one request per
  // calendar. They go out together — a week costs one round trip, not N.
  const results = await Promise.all(
    calendars.map(cal => fetchCalendarEvents(cal, params, token, colorMap))
  )
  const reached = results.filter((r): r is CalendarEvent[] => r !== null)

  // Committing an all-failed batch would cache "no events" for the week and
  // serve it for the next five minutes.
  if (calendars.length > 0 && reached.length === 0) throw new Error("Every calendar request failed")

  const events = reached.flat()
  events.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0
    return aTime - bTime
  })
  return events
}

/** One calendar's slice of a week. A failed calendar is skipped, not fatal. */
async function fetchCalendarEvents(
  cal: CalendarInfo,
  params: URLSearchParams,
  token: string,
  colorMap: GoogleColorMap
): Promise<CalendarEvent[] | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null

    const data = await res.json()
    const events: CalendarEvent[] = []
    for (const e of (data.items ?? []) as Record<string, unknown>[]) {
      if (e.status === "cancelled") continue
      const colorId = e.colorId as string | undefined
      const color = colorId && colorMap.event?.[colorId]
        ? colorMap.event[colorId].background
        : cal.backgroundColor

      events.push({
        id: e.id as string,
        title: (e.summary as string) ?? "(No title)",
        startTime: (e.start as Record<string, string>)?.dateTime ?? null,
        endTime: (e.end as Record<string, string>)?.dateTime ?? null,
        allDay: !!(e.start as Record<string, string>)?.date,
        allDayDate: (e.start as Record<string, string>)?.date ?? null,
        htmlLink: (e.htmlLink as string) ?? "",
        calendarId: cal.id,
        calendarName: cal.name,
        color,
        location: (e.location as string) ?? null,
      })
    }
    return events
  } catch {
    return null
  }
}

function closeCalendarPopover(): void {
  if (calendarPopoverClose) {
    calendarPopoverClose()
    calendarPopoverClose = null
  }
}

function formatTime(isoString: string): string {
  return formatClock(new Date(isoString))
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: !store.sync.get("clock24Hour"),
  })
}

/**
 * How far either view can travel. Both bounds are set by what the prefetch
 * holds: the weeks either side of today cover every day within ±7, and the
 * week view's ±2 is one step beyond whatever its own neighbour prefetch has
 * already brought in.
 */
const NAV_LIMITS: Record<ViewMode, number> = { "1d": 7, "1w": 2 }

/**
 * Switching view keeps the period you were looking at rather than snapping
 * back to today. A week further out than ±7 days has no day inside the day
 * view's bound, so it lands on the nearest day the day view can reach.
 */
function switchView(mode: ViewMode): void {
  if (mode === viewMode) return
  if (mode === "1w") {
    const delta = (startOfWeek(dayAt(offset)).getTime() - startOfWeek(new Date()).getTime()) / 604_800_000
    offset = clamp(-NAV_LIMITS["1w"], Math.round(delta), NAV_LIMITS["1w"])
  } else if (offset !== 0) {
    const days = (weekStartAt(offset).getTime() - dayAt(0).getTime()) / 86_400_000
    offset = clamp(-NAV_LIMITS["1d"], Math.round(days), NAV_LIMITS["1d"])
  }
  viewMode = mode
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function getNavLabel(): string {
  const now = new Date()

  if (viewMode === "1d") {
    if (offset === 0) return "Today"
    if (offset === -1) return "Yesterday"
    if (offset === 1) return "Tomorrow"
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    return d.toLocaleDateString("en-US", { month: "long" }) + " " + ordinal(d.getDate())
  }

  if (offset === 0) return "This Week"
  if (offset === -1) return "Last Week"
  if (offset === 1) return "Next Week"
  const { start, end } = getDateRange()
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short" }) + " " + ordinal(d.getDate())
  return fmt(start) + " – " + fmt(lastDay)
}

function formatTimeRange(event: CalendarEvent): string {
  if (event.allDay) return "All day"
  if (!event.startTime || !event.endTime) return ""
  return formatTime(event.startTime) + " – " + formatTime(event.endTime)
}

function renderControls(onUpdate: () => void): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col gap-2 shrink-0"

  const row = document.createElement("div")
  row.className = "flex items-center justify-between gap-2 min-w-0"

  const segmented = document.createElement("div")
  segmented.className = "flex gap-0.5 bg-popover-foreground/5 rounded-theme p-0.5 shrink-0"

  for (const mode of ["1d", "1w"] as ViewMode[]) {
    const btn = document.createElement("button")
    btn.textContent = mode.toUpperCase()
    btn.className = mode === viewMode
      ? "px-3 py-1 rounded-theme text-xs font-semibold bg-accent text-accent-foreground transition-colors"
      : "px-3 py-1 rounded-theme text-xs font-medium text-muted hover:bg-surface transition-colors"
    btn.addEventListener("click", () => {
      switchView(mode)
      onUpdate()
    })
    segmented.appendChild(btn)
  }
  row.appendChild(segmented)

  const nav = document.createElement("div")
  nav.className = "flex items-center gap-0.5 min-w-0"

  const limit = NAV_LIMITS[viewMode]

  function navButton(iconName: "chevronLeft" | "chevronRight", step: number, atEdge: boolean): HTMLElement {
    const btn = document.createElement("button")
    btn.className = "w-7 h-7 flex items-center justify-center rounded-theme text-muted hover:bg-surface transition-colors shrink-0"
    btn.appendChild(icon(iconName, { size: 14 }))
    btn.setAttribute("aria-label", step < 0 ? "Previous" : "Next")
    if (atEdge) btn.classList.add("opacity-30", "pointer-events-none")
    btn.addEventListener("click", () => {
      if (Math.abs(offset + step) > limit) return
      offset += step
      onUpdate()
    })
    return btn
  }

  nav.appendChild(navButton("chevronLeft", -1, offset <= -limit))

  const label = document.createElement("span")
  label.className = "text-sm font-semibold text-foreground truncate text-center min-w-0 px-1"
  label.textContent = getNavLabel()
  nav.appendChild(label)

  nav.appendChild(navButton("chevronRight", 1, offset >= limit))
  row.appendChild(nav)
  wrapper.appendChild(row)

  const sep = document.createElement("div")
  sep.className = "h-px bg-input-border/20"
  wrapper.appendChild(sep)

  return wrapper
}

function eventDetailContent(event: CalendarEvent): HTMLElement {
  const content = document.createElement("div")
  content.className = "flex flex-col gap-3 min-w-[240px] max-w-[300px]"

  const header = document.createElement("div")
  header.className = "flex items-center gap-2"
  const dot = document.createElement("div")
  dot.className = "w-2.5 h-2.5 rounded-full shrink-0"
  dot.style.backgroundColor = event.color
  header.appendChild(dot)
  const title = document.createElement("div")
  title.className = "text-[15px] font-semibold text-popover-foreground"
  title.textContent = event.title
  header.appendChild(title)
  content.appendChild(header)

  const fields = document.createElement("div")
  fields.className = "flex flex-col gap-2"

  const timeStr = formatTimeRange(event)
  if (timeStr) {
    fields.appendChild(detailRow("Time", timeStr))
  }
  if (event.location) {
    fields.appendChild(detailRow("Where", event.location))
  }
  fields.appendChild(detailRow("Calendar", event.calendarName))
  content.appendChild(fields)

  if (event.htmlLink) {
    const link = document.createElement("a")
    link.href = event.htmlLink
    link.target = "_blank"
    link.rel = "noopener"
    link.className = "flex items-center justify-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-theme text-xs font-medium hover:bg-accent-hover transition-colors no-underline"
    link.textContent = "Open in Google Calendar ↗"
    content.appendChild(link)
  }

  return content
}

/* ── Event hover card ───────────────────────────────────────────────────────
 * Events are read by hovering, not clicking. The card is a singleton on
 * `document.body` rather than a `createPopover` — it has to outlive the block
 * it describes (a resize or a fetch rebuilds the whole timeline underneath it)
 * and it must not join the popover stack, which dismisses on outside click.
 *
 * Both timers are the polish: `HOVER_IN` keeps the card from strobing as the
 * pointer sweeps a dense day, and `HOVER_OUT` leaves a grace period wide enough
 * to cross the gap into the card and click the Google Calendar link.
 */

const HOVER_IN = 90
const HOVER_OUT = 160
/** Above the popover stack, which starts at 100 and climbs. */
const HOVER_Z = 2000

let hoverCard: HTMLElement | null = null
let hoverFor: HTMLElement | null = null
let hoverInTimer: number | null = null
let hoverOutTimer: number | null = null

function hideEventHover(): void {
  if (hoverInTimer !== null) { clearTimeout(hoverInTimer); hoverInTimer = null }
  if (hoverOutTimer !== null) { clearTimeout(hoverOutTimer); hoverOutTimer = null }
  hoverCard?.remove()
  hoverCard = null
  hoverFor = null
}

function scheduleHoverOut(): void {
  if (hoverOutTimer !== null) clearTimeout(hoverOutTimer)
  hoverOutTimer = window.setTimeout(() => {
    hoverOutTimer = null
    hideEventHover()
  }, HOVER_OUT)
}

/** Beside the block if it fits, flipped to the other side if not, always on screen. */
function placeHoverCard(card: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const margin = 8
  const gap = 10
  let left = a.right + gap
  if (left + c.width > window.innerWidth - margin) left = a.left - gap - c.width
  card.style.left = `${Math.round(clamp(margin, left, window.innerWidth - c.width - margin))}px`
  card.style.top = `${Math.round(clamp(margin, a.top + a.height / 2 - c.height / 2, window.innerHeight - c.height - margin))}px`
}

function showEventHover(anchor: HTMLElement, event: CalendarEvent): void {
  hideEventHover()
  const card = document.createElement("div")
  card.className =
    "fixed bg-popover text-popover-foreground rounded-theme p-3 flex flex-col gap-2 border border-popover-foreground/[0.08] glass-surface popover-enter"
  card.style.zIndex = String(HOVER_Z)
  card.appendChild(eventDetailContent(event))
  document.body.appendChild(card)

  card.addEventListener("mouseenter", () => {
    if (hoverOutTimer !== null) { clearTimeout(hoverOutTimer); hoverOutTimer = null }
  })
  card.addEventListener("mouseleave", scheduleHoverOut)

  hoverCard = card
  hoverFor = anchor
  placeHoverCard(card, anchor)
}

/** Makes `el` show the event's card on hover. Replaces the old click-to-open popover. */
function attachEventHover(el: HTMLElement, event: CalendarEvent): void {
  el.addEventListener("mouseenter", () => {
    if (hoverOutTimer !== null) { clearTimeout(hoverOutTimer); hoverOutTimer = null }
    if (hoverFor === el) return
    if (hoverInTimer !== null) clearTimeout(hoverInTimer)
    hoverInTimer = window.setTimeout(() => {
      hoverInTimer = null
      showEventHover(el, event)
    }, HOVER_IN)
  })
  el.addEventListener("mouseleave", () => {
    if (hoverInTimer !== null) { clearTimeout(hoverInTimer); hoverInTimer = null }
    scheduleHoverOut()
  })
}

// The card is positioned from a rect taken once, so anything that moves the
// block out from under it — the timeline scrolling, the window resizing —
// retires it rather than leaving it pointing at nothing.
window.addEventListener("scroll", hideEventHover, true)
window.addEventListener("resize", hideEventHover)

function detailRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div")
  row.className = "flex items-center gap-2"
  const lbl = document.createElement("div")
  lbl.className = "text-xs text-muted min-w-[50px]"
  lbl.textContent = label
  const val = document.createElement("div")
  val.className = "text-xs text-popover-foreground/70"
  val.textContent = value
  row.appendChild(lbl)
  row.appendChild(val)
  return row
}

/* ── Timeline engine ─────────────────────────────────────────────────────────
 * Both views draw the same thing: events as duration-scaled blocks on a
 * vertical axis whose empty stretches are squeezed. `buildTimeMap` turns a set
 * of busy spans into a piecewise-linear minutes → pixels function; the day view
 * feeds it one day's events and the week view feeds it all seven days at once,
 * so 9am on Monday sits at the same y as 9am on Friday.
 */

type Span = { start: number; end: number }

type Slice = Span & { busy: boolean; h: number; y: number }

type TimeMap = {
  slices: Slice[]
  total: number
  domain: Span
  /** Minutes past local midnight → pixels from the top of the timeline. */
  y: (min: number) => number
  /** The inverse: pixels from the top → the minute there, and whether that stretch is drawn to scale. */
  minAt: (px: number) => { min: number; busy: boolean }
}

type MapOpts = {
  pxPerMin: number
  minEventHeight: number
  /** Gap heights run gapMin → gapMax over a sqrt curve, reaching gapMax at gapFull minutes. */
  gapMin: number
  gapMax: number
  gapFull: number
  /** Floor for the whole axis. Sparse days grow their gaps to reach it. */
  minTotal: number
}

const EMPTY_MAP: TimeMap = {
  slices: [],
  total: 0,
  domain: { start: 0, end: 0 },
  y: () => 0,
  minAt: () => ({ min: 0, busy: false }),
}

function clamp(lo: number, v: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const CORE_START = 8 * 60
const CORE_END = 18 * 60
/** A sparse axis grows to this fraction of its scroll cap — enough to read, never enough to scroll. */
const MIN_TOTAL_RATIO = 0.55
/** Gap duration at which compression tops out at `gapMax`. */
const GAP_FULL_MIN = 8 * 60

/**
 * The window the axis always covers. Without it the domain is whatever the
 * events happen to span, so a lone 2pm event fills the timeline top to bottom
 * and reads exactly like a lone 8am one. Today also anchors to `now`, so the
 * now-line lands where it belongs instead of clamping to an edge.
 */
function coreAnchor(isToday: boolean): Span {
  if (!isToday) return { start: CORE_START, end: CORE_END }
  const now = minutesNow()
  return { start: Math.min(CORE_START, now), end: Math.max(CORE_END, now) }
}

/**
 * Empty time is compressed, but not to a constant: a flat clamp made a 45m gap
 * and a 4h gap the same height, which is most of a day's shape thrown away.
 * The sqrt keeps every gap distinguishable while still bounding the tallest.
 */
function gapHeight(dur: number, o: MapOpts): number {
  return o.gapMin + (o.gapMax - o.gapMin) * Math.sqrt(clamp(0, dur / o.gapFull, 1))
}

/**
 * Slices the domain at every span boundary, sizes each slice by duration
 * (compressed if nothing covers it), then grows slices until every span clears
 * `minEventH` — so the shortest event still has room for its title. Growth only
 * ever adds height, so the relaxation converges; six passes is far more than
 * any realistic day needs. A final pass grows the gaps — never the events,
 * which stay scaled to their duration — until the axis clears `minTotal`.
 *
 * `anchor` widens the domain to a fixed window so y means the same thing from
 * one day to the next; it deliberately does not join `spans`, since it is a
 * reference frame rather than something to draw or to relax around.
 */
function buildTimeMap(spans: Span[], opts: MapOpts, anchor?: Span): TimeMap {
  if (spans.length === 0) return EMPTY_MAP

  const domain = {
    start: Math.min(...spans.map(s => s.start), anchor?.start ?? Infinity),
    end: Math.max(...spans.map(s => s.end), anchor?.end ?? -Infinity),
  }
  if (domain.end <= domain.start) return EMPTY_MAP

  const bounds = [
    ...new Set([domain.start, domain.end, ...spans.flatMap(s => [s.start, s.end])]),
  ].sort((a, b) => a - b)

  const slices: Slice[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]
    const end = bounds[i + 1]
    const mid = (start + end) / 2
    const busy = spans.some(s => s.start <= mid && s.end > mid)
    const dur = end - start
    slices.push({
      start,
      end,
      busy,
      y: 0,
      h: busy ? dur * opts.pxPerMin : gapHeight(dur, opts),
    })
  }

  const covered = spans.map(s =>
    slices.map((sl, i) => (sl.start >= s.start && sl.end <= s.end ? i : -1)).filter(i => i >= 0)
  )

  for (let pass = 0; pass < 6; pass++) {
    let grew = false
    for (let s = 0; s < spans.length; s++) {
      const idx = covered[s]
      if (idx.length === 0) continue
      const have = idx.reduce((sum, i) => sum + slices[i].h, 0)
      const deficit = opts.minEventHeight - have
      if (deficit <= 0.5) continue
      const totalDur = idx.reduce((sum, i) => sum + (slices[i].end - slices[i].start), 0)
      for (const i of idx) {
        slices[i].h += (deficit * (slices[i].end - slices[i].start)) / totalDur
      }
      grew = true
    }
    if (!grew) break
  }

  // Relaxation only ever touched busy slices, so the gaps are untouched here.
  const gaps = slices.filter(sl => !sl.busy)
  const gapDur = gaps.reduce((sum, sl) => sum + (sl.end - sl.start), 0)
  const deficit = opts.minTotal - slices.reduce((sum, sl) => sum + sl.h, 0)
  if (deficit > 0 && gapDur > 0) {
    for (const sl of gaps) sl.h += (deficit * (sl.end - sl.start)) / gapDur
  }

  let y = 0
  for (const sl of slices) {
    sl.y = y
    y += sl.h
  }
  const total = y

  function mapY(min: number): number {
    if (min <= domain.start) return 0
    if (min >= domain.end) return total
    for (const sl of slices) {
      if (min < sl.end) {
        return sl.y + (sl.h * (min - sl.start)) / (sl.end - sl.start)
      }
    }
    return total
  }

  function minAt(px: number): { min: number; busy: boolean } {
    for (const sl of slices) {
      if (px < sl.y + sl.h) {
        const min = sl.h > 0 ? sl.start + ((sl.end - sl.start) * (px - sl.y)) / sl.h : sl.start
        return { min: clamp(sl.start, min, sl.end), busy: sl.busy }
      }
    }
    const last = slices[slices.length - 1]
    return { min: last.end, busy: last.busy }
  }

  return { slices, total, domain, y: mapY, minAt }
}

/**
 * Groups events into clusters of mutually-overlapping blocks. Every event in a
 * cluster gets its own column, ordered by end time so the latest-ending event
 * sits furthest right.
 */
function assignColumns<T extends Span>(blocks: T[]): { block: T; col: number; cols: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: { block: T; col: number; cols: number }[] = []

  let cluster: T[] = []
  let clusterEnd = -Infinity

  function flush(): void {
    if (cluster.length === 0) return
    const ordered = [...cluster].sort((a, b) => a.end - b.end || a.start - b.start)
    ordered.forEach((block, col) => out.push({ block, col, cols: ordered.length }))
    cluster = []
    clusterEnd = -Infinity
  }

  for (const block of sorted) {
    if (block.start >= clusterEnd) flush()
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.end)
  }
  flush()

  return out
}

type Block = Span & { event: CalendarEvent }

/** Timed events for one local day, clipped to that day's midnight boundaries. */
function blocksForDay(events: CalendarEvent[], dateStr: string): Block[] {
  const blocks: Block[] = []
  for (const event of events) {
    if (event.allDay || !event.startTime || !event.endTime) continue
    const s = new Date(event.startTime)
    const e = new Date(event.endTime)
    const dayStart = new Date(`${dateStr}T00:00:00`)
    const startMin = Math.max(0, (s.getTime() - dayStart.getTime()) / 60_000)
    const endMin = Math.min(1440, (e.getTime() - dayStart.getTime()) / 60_000)
    if (endMin <= 0 || startMin >= 1440 || endMin <= startMin) continue
    blocks.push({ start: startMin, end: endMin, event })
  }
  return blocks.sort((a, b) => a.start - b.start || a.end - b.end)
}

function allDayFor(events: CalendarEvent[], dateStr: string): CalendarEvent[] {
  return events.filter(e => e.allDay && e.allDayDate === dateStr)
}

function minutesNow(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

function formatHourLabel(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = Math.round(min % 60)
  if (store.sync.get("clock24Hour")) {
    return m === 0 ? String(h).padStart(2, "0") : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }
  const h12 = h % 12 === 0 ? 12 : h % 12
  const suffix = h < 12 ? "a" : "p"
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`
}

/** Minutes past local midnight as a full wall-clock time, for the scrubline readout. */
function formatMinuteOfDay(min: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setMinutes(Math.round(min))
  return formatClock(d)
}

function formatDuration(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/* ── Shared timeline pieces ─────────────────────────────────────────────── */

type Metrics = {
  width: number
  gutter: number
  titleFont: number
  metaFont: number
  labelFont: number
  minEventHeight: number
}

function absEl(className: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement("div")
  el.className = className
  Object.assign(el.style, style)
  return el
}

/** Time labels down the left edge, one per distinct event start, thinned so they never collide. */
function renderGutter(map: TimeMap, blocks: Block[], m: Metrics): HTMLElement[] {
  if (m.gutter <= 0) return []
  const marks = [...new Set(blocks.map(b => b.start))]
    .map(min => ({ min, y: map.y(min) }))
    .sort((a, b) => a.y - b.y)

  const out: HTMLElement[] = []
  let lastY = -Infinity
  for (const mark of marks) {
    if (mark.y - lastY < m.labelFont * 1.6) continue
    lastY = mark.y
    const el = absEl("absolute left-0 text-popover-foreground/40 tabular-nums leading-none select-none", {
      top: `${mark.y}px`,
      width: `${m.gutter - 6}px`,
      fontSize: `${m.labelFont}px`,
      textAlign: "right",
    })
    el.textContent = formatHourLabel(mark.min)
    out.push(el)
  }
  return out
}

/** A dashed rule with the elided duration, drawn across each compressed gap. */
function renderGapMarks(map: TimeMap, m: Metrics): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const sl of map.slices) {
    if (sl.busy || sl.h < 9) continue
    const row = absEl("absolute flex items-center gap-1.5 pointer-events-none", {
      top: `${sl.y + sl.h / 2 - 5}px`,
      left: `${m.gutter}px`,
      right: "0px",
      height: "10px",
    })
    const rule = (): HTMLElement =>
      absEl("flex-1 border-t border-dashed border-popover-foreground/15", { position: "static" })
    row.appendChild(rule())
    if (sl.h >= 13 && sl.end - sl.start >= 25) {
      const label = document.createElement("span")
      label.className = "text-popover-foreground/30 tabular-nums leading-none"
      label.style.fontSize = `${Math.max(8, m.labelFont - 1)}px`
      label.textContent = formatDuration(sl.end - sl.start)
      row.appendChild(label)
      row.appendChild(rule())
    }
    out.push(row)
  }
  return out
}

/**
 * The hover scrubline: a hairline across the full timeline at the pointer, with
 * the time under it read off `map.minAt` — the inverse of the layout, so it
 * stays honest on a non-linear axis.
 *
 * Over a compressed gap a few pixels sweep hours, so the whole group dims there
 * rather than pretending the readout tracks the pointer at the same rate.
 * Position is written straight to `top` with no transition — a lagging line
 * reads as broken — while the opacity change is what carries the smoothness.
 */
function attachScrubber(scroll: HTMLElement, inner: HTMLElement, map: TimeMap, m: Metrics): void {
  const row = absEl("absolute pointer-events-none transition-opacity duration-150", {
    left: "0px",
    right: "0px",
    top: "0px",
    height: "0px",
    opacity: "0",
    zIndex: "15",
  })
  row.appendChild(
    absEl("absolute bg-popover-foreground/30", {
      left: `${m.gutter}px`,
      right: "0px",
      top: "0px",
      height: "1px",
    })
  )

  const pill = document.createElement("div")
  pill.className =
    "absolute left-0 rounded-theme-xs bg-popover-foreground/90 text-popover tabular-nums font-medium leading-none whitespace-nowrap px-1.5 py-1"
  pill.style.fontSize = `${Math.max(9.5, m.labelFont).toFixed(2)}px`
  row.appendChild(pill)
  inner.appendChild(row)

  let pillH = 0
  let clientY = 0
  let visible = false
  let frame = 0

  function paint(): void {
    frame = 0
    if (!visible) return
    const y = clamp(0, clientY - inner.getBoundingClientRect().top, map.total)
    const { min, busy } = map.minAt(y)
    row.style.top = `${y.toFixed(1)}px`
    row.style.opacity = busy ? "1" : "0.45"
    // Snapped to 5 minutes: at these scales the pixel is not that precise, and
    // an exact-minute readout jitters on every frame.
    pill.textContent = formatMinuteOfDay(clamp(map.domain.start, Math.round(min / 5) * 5, map.domain.end))
    if (pillH === 0) pillH = pill.offsetHeight
    pill.style.top = `${(clamp(0, y - pillH / 2, Math.max(0, map.total - pillH)) - y).toFixed(1)}px`
  }

  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(paint)
  }

  scroll.addEventListener("mousemove", (e) => {
    visible = true
    clientY = e.clientY
    schedule()
  })
  scroll.addEventListener("mouseleave", () => {
    visible = false
    if (frame !== 0) { cancelAnimationFrame(frame); frame = 0 }
    row.style.opacity = "0"
  })
  // Content moving under a stationary pointer changes the time it is over.
  scroll.addEventListener("scroll", () => { if (visible) schedule() })
}

/** One event. Text is sized to fit the block, dropping to a bare title when short. */
function renderBlock(block: Block, w: number, h: number, m: Metrics): HTMLElement {
  const el = document.createElement("div")
  el.className =
    "absolute overflow-hidden rounded-theme-xs flex flex-col transition-[filter,box-shadow] hover:brightness-110 hover:z-10"
  el.style.justifyContent = h >= 30 ? "flex-start" : "center"
  el.style.backgroundColor = tint(block.event.color, 20)
  el.style.boxShadow = `inset 2px 0 0 ${block.event.color}`

  const roomy = h >= m.titleFont * 1.2 + 6
  const padY = roomy ? 3 : 0
  const padX = w >= 54 ? 6 : 4

  const inner = document.createElement("div")
  inner.className = "flex flex-col min-w-0"
  inner.style.padding = `${padY}px ${padX}px ${padY}px ${padX + 3}px`

  const titleFont = Math.min(m.titleFont, Math.max(8, (h - padY * 2) / 1.18))
  const title = document.createElement("div")
  title.className = "truncate font-medium text-popover-foreground/90 leading-tight"
  title.style.fontSize = `${titleFont.toFixed(2)}px`
  title.textContent = block.event.title
  inner.appendChild(title)

  const needed = titleFont * 1.18 + m.metaFont * 1.18 + padY * 2
  if (h >= needed + 2 && w >= 66) {
    const meta = document.createElement("div")
    meta.className = "truncate text-popover-foreground/50 tabular-nums leading-tight"
    meta.style.fontSize = `${m.metaFont.toFixed(2)}px`
    meta.textContent =
      h >= needed + m.metaFont * 1.4 && block.event.location
        ? `${formatHourLabel(block.start)} · ${block.event.location}`
        : `${formatHourLabel(block.start)} – ${formatHourLabel(block.end)}`
    inner.appendChild(meta)
  }

  el.appendChild(inner)
  attachEventHover(el, block.event)
  return el
}

/** Positioned blocks for one day, laid into `host` (which spans that day's width). */
function layoutBlocks(host: HTMLElement, map: TimeMap, blocks: Block[], width: number, m: Metrics): void {
  const gapPx = width >= 120 ? 2 : 1
  for (const { block, col, cols } of assignColumns(blocks)) {
    const top = map.y(block.start)
    const h = Math.max(m.minEventHeight, map.y(block.end) - top)
    const colW = (width - gapPx * (cols - 1)) / cols
    const el = renderBlock(block, colW, h, m)
    el.style.top = `${top}px`
    el.style.height = `${h}px`
    el.style.left = `${col * (colW + gapPx)}px`
    el.style.width = `${colW}px`
    el.style.zIndex = String(col + 1)
    host.appendChild(el)
  }
}

/** The "you are here" rule. `accentFrom`/`accentTo` mark which slice of the width is today. */
function renderNowLine(
  map: TimeMap,
  m: Metrics,
  accent: { from: number; to: number } | null
): HTMLElement {
  const y = clamp(0, map.y(minutesNow()), map.total)
  const row = absEl("absolute pointer-events-none", {
    top: `${y}px`,
    left: `${m.gutter}px`,
    right: "0px",
    height: "0px",
    zIndex: "20",
  })

  const faint = absEl("absolute left-0 right-0 bg-accent/25", { top: "0px", height: "1px" })
  row.appendChild(faint)

  const solid = absEl("absolute bg-accent", {
    top: "0px",
    height: "1.5px",
    left: accent ? `${accent.from}px` : "0px",
    width: accent ? `${accent.to - accent.from}px` : "100%",
    borderRadius: "1px",
  })
  row.appendChild(solid)

  const dot = absEl("absolute rounded-full bg-accent", {
    top: "-2.25px",
    left: accent ? `${accent.from - 2}px` : "-2px",
    width: "5px",
    height: "5px",
  })
  row.appendChild(dot)

  return row
}

/* ── All-day strip ──────────────────────────────────────────────────────── */

function allDayChip(event: CalendarEvent, m: Metrics, full: boolean): HTMLElement {
  const chip = document.createElement("div")
  chip.className = "truncate rounded-theme-xs leading-tight hover:brightness-110"
  chip.style.backgroundColor = tint(event.color, 22)
  chip.style.boxShadow = `inset 2px 0 0 ${event.color}`
  chip.style.padding = full ? "3px 7px 3px 9px" : "1.5px 4px 1.5px 6px"
  chip.style.fontSize = `${(full ? m.titleFont : m.metaFont).toFixed(2)}px`
  chip.classList.add("text-popover-foreground/85", "font-medium")
  chip.textContent = event.title
  attachEventHover(chip, event)
  return chip
}

/* ── Todo cross-link ────────────────────────────────────────────────────── */

/**
 * Todos carry a bare `dueDate`, so a day the calendar is already drawing is
 * also a day the todo widget has an answer for. These are the open ones due
 * that day, drawn beside the all-day events and accent-tinted to read as a
 * different kind of thing. Empty when the todo widget is switched off.
 */
function todosDueOn(dateStr: string): Todo[] {
  if (!store.sync.get("todoEnabled")) return []
  return getDueOn(normalizeTodos(store.local.get("todos")), dateStr)
}

function todoChip(todo: Todo, m: Metrics, full: boolean): HTMLElement {
  const chip = document.createElement("div")
  chip.className =
    "flex items-center gap-1 min-w-0 rounded-theme-xs cursor-pointer leading-tight font-medium text-popover-foreground/85 hover:brightness-110"
  chip.style.backgroundColor = tint("var(--accent)", 16)
  chip.style.boxShadow = "inset 2px 0 0 var(--accent)"
  chip.style.padding = full ? "3px 7px 3px 9px" : "1.5px 4px 1.5px 6px"
  chip.style.fontSize = `${(full ? m.titleFont : m.metaFont).toFixed(2)}px`

  const glyph = icon(todo.pinned ? "pinFilled" : "checkCircle", {
    size: Math.round(full ? m.titleFont : m.metaFont),
  })
  glyph.classList.add("opacity-60")
  chip.appendChild(glyph)

  const label = document.createElement("span")
  label.className = "truncate min-w-0"
  label.textContent = todo.title
  chip.appendChild(label)

  chip.title = `${todo.title} · todo`
  chip.addEventListener("click", () => showTodoPopover(chip, todo.id))
  return chip
}

/* ── Day view ───────────────────────────────────────────────────────────── */

type ViewParts = { el: HTMLElement; tick: () => void }

function emptyNote(text: string): HTMLElement {
  const el = document.createElement("div")
  el.className = "text-sm text-popover-foreground/45 text-center py-8"
  el.textContent = text
  return el
}

/** A failed week, with the way out of it — the retry bypasses the fetch cooldown. */
function retryNote(key: string, redraw: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center gap-2 py-8"
  wrap.appendChild(emptyNote("Couldn't reach Google Calendar."))
  wrap.firstElementChild!.className = "text-sm text-popover-foreground/45 text-center"

  const retry = document.createElement("button")
  retry.className = "px-2.5 py-1 rounded-theme text-xs font-medium text-muted hover:bg-surface transition-colors"
  retry.textContent = "Retry"
  retry.addEventListener("click", () => {
    void requestWeek(key, true)
    redraw()
  })
  wrap.appendChild(retry)
  return wrap
}

function sectionLabel(text: string, font: number): HTMLElement {
  const el = document.createElement("div")
  el.className = "uppercase tracking-[0.09em] text-popover-foreground/40 font-semibold leading-none"
  el.style.fontSize = `${font.toFixed(2)}px`
  el.textContent = text
  return el
}

function scroller(maxHeight: number): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "relative overflow-y-auto overflow-x-hidden min-w-0"
  el.style.maxHeight = `${Math.round(maxHeight)}px`
  return el
}

/**
 * The card above the day timeline. Shows the first event that hasn't ended —
 * an event already underway reads "Happening now" and carries a progress bar,
 * anything later reads "Next up". Returns null once the day is done.
 */
function renderNextUp(blocks: Block[], m: Metrics, requestRebuild: () => void): ViewParts | null {
  const now = minutesNow()
  const next = blocks.filter(b => b.end > now).sort((a, b) => a.start - b.start)[0]
  if (!next) return null

  const live = next.start <= now
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1.5 shrink-0"
  wrap.appendChild(sectionLabel(live ? "Happening now" : "Next up", Math.max(9, m.metaFont - 0.5)))

  const card = document.createElement("div")
  card.className =
    "relative overflow-hidden rounded-theme flex items-center gap-2.5 hover:brightness-110 transition-[filter]"
  card.style.backgroundColor = tint(next.event.color, 16)
  card.style.boxShadow = `inset 3px 0 0 ${next.event.color}`
  card.style.padding = `${m.titleFont >= 12 ? 9 : 7}px ${m.titleFont >= 12 ? 11 : 9}px`
  card.style.paddingLeft = `${m.titleFont >= 12 ? 13 : 11}px`

  const info = document.createElement("div")
  info.className = "flex flex-col min-w-0 flex-1 gap-0.5"

  const title = document.createElement("div")
  title.className = "truncate font-semibold text-popover-foreground leading-tight"
  title.style.fontSize = `${(m.titleFont + 1.5).toFixed(2)}px`
  title.textContent = next.event.title
  info.appendChild(title)

  const meta = document.createElement("div")
  meta.className = "truncate text-popover-foreground/55 tabular-nums leading-tight"
  meta.style.fontSize = `${m.metaFont.toFixed(2)}px`
  meta.textContent = formatTimeRange(next.event) + (next.event.location ? ` · ${next.event.location}` : "")
  info.appendChild(meta)
  card.appendChild(info)

  const pill = document.createElement("div")
  pill.className = "shrink-0 rounded-full bg-accent/15 text-accent font-semibold tabular-nums leading-none whitespace-nowrap"
  pill.style.fontSize = `${Math.max(9, m.metaFont).toFixed(2)}px`
  pill.style.padding = "4px 8px"
  card.appendChild(pill)

  const bar = document.createElement("div")
  bar.className = "absolute bottom-0 left-0 h-[2px]"
  bar.style.backgroundColor = next.event.color
  if (live) card.appendChild(bar)

  let mounted = false
  function paint(): void {
    const t = minutesNow()
    if (mounted && (t >= next.end || t >= next.start !== live)) {
      requestRebuild()
      return
    }
    pill.textContent = live
      ? `${formatDuration(next.end - t)} left`
      : `in ${formatDuration(Math.max(1, next.start - t))}`
    if (live) {
      bar.style.width = `${clamp(0, ((t - next.start) / (next.end - next.start)) * 100, 100).toFixed(1)}%`
    }
  }
  paint()
  mounted = true

  attachEventHover(card, next.event)
  wrap.appendChild(card)
  return { el: wrap, tick: paint }
}

function dayMetrics(width: number): Metrics & MapOpts & { maxHeight: number } {
  const maxHeight = clamp(240, width * 0.72, 460)
  return {
    width,
    gutter: width >= 200 ? Math.round(clamp(36, width * 0.1, 48)) : 0,
    labelFont: clamp(8.5, width * 0.026, 10.5),
    titleFont: clamp(10.5, width * 0.032, 13),
    metaFont: clamp(9, width * 0.026, 11),
    minEventHeight: clamp(19, width * 0.05, 26),
    pxPerMin: clamp(0.55, width * 0.0017, 1),
    gapMin: 14,
    gapMax: clamp(18, width * 0.06, 30),
    gapFull: GAP_FULL_MIN,
    minTotal: maxHeight * MIN_TOTAL_RATIO,
    maxHeight,
  }
}

function renderDayView(events: CalendarEvent[], width: number, requestRebuild: () => void): ViewParts {
  const m = dayMetrics(width)
  const { start } = getDateRange()
  const dateStr = localDateStr(start)
  const isToday = dateStr === localDateStr(new Date())

  const blocks = blocksForDay(events, dateStr)
  const allDay = allDayFor(events, dateStr)

  const root = document.createElement("div")
  root.className = "flex flex-col gap-2.5 min-w-0 pt-2.5"

  const ticks: (() => void)[] = []

  if (isToday) {
    const nextUp = renderNextUp(blocks, m, requestRebuild)
    if (nextUp) {
      root.appendChild(nextUp.el)
      ticks.push(nextUp.tick)
    }
  }

  if (allDay.length > 0) {
    const strip = document.createElement("div")
    strip.className = "flex flex-col gap-1.5 shrink-0"
    strip.appendChild(sectionLabel("All day", Math.max(9, m.metaFont - 0.5)))
    const chips = document.createElement("div")
    chips.className = "flex flex-wrap gap-1"
    for (const event of allDay) chips.appendChild(allDayChip(event, m, true))
    strip.appendChild(chips)
    root.appendChild(strip)
  }

  const dueTodos = todosDueOn(dateStr)
  if (dueTodos.length > 0) {
    const strip = document.createElement("div")
    strip.className = "flex flex-col gap-1.5 shrink-0"
    strip.appendChild(sectionLabel("Due", Math.max(9, m.metaFont - 0.5)))
    const chips = document.createElement("div")
    chips.className = "flex flex-wrap gap-1"
    for (const todo of dueTodos) chips.appendChild(todoChip(todo, m, true))
    strip.appendChild(chips)
    root.appendChild(strip)
  }

  if (blocks.length === 0) {
    root.appendChild(
      emptyNote(allDay.length > 0 || dueTodos.length > 0 ? "Nothing else scheduled" : "No events")
    )
    return { el: root, tick: () => ticks.forEach(t => t()) }
  }

  const map = buildTimeMap(blocks, m, coreAnchor(isToday))
  const contentW = Math.max(40, width - m.gutter - 6)

  const scroll = scroller(m.maxHeight)
  const inner = document.createElement("div")
  inner.className = "relative"
  inner.style.height = `${Math.ceil(map.total)}px`

  for (const el of renderGutter(map, blocks, m)) inner.appendChild(el)
  for (const el of renderGapMarks(map, m)) inner.appendChild(el)

  const host = absEl("absolute top-0", { left: `${m.gutter}px`, width: `${contentW}px`, height: `${map.total}px` })
  layoutBlocks(host, map, blocks, contentW, m)
  inner.appendChild(host)

  let nowRow: HTMLElement | null = null
  if (isToday) {
    nowRow = renderNowLine(map, m, null)
    inner.appendChild(nowRow)
  }

  attachScrubber(scroll, inner, map, m)
  scroll.appendChild(inner)
  root.appendChild(scroll)

  if (nowRow) {
    const y = clamp(0, map.y(minutesNow()), map.total)
    requestAnimationFrame(() => {
      scroll.scrollTop = clamp(0, y - scroll.clientHeight / 2, Math.max(0, map.total - scroll.clientHeight))
    })
    ticks.push(() => {
      nowRow!.style.top = `${clamp(0, map.y(minutesNow()), map.total)}px`
    })
  }

  return { el: root, tick: () => ticks.forEach(t => t()) }
}

/* ── Week view ──────────────────────────────────────────────────────────── */

function weekMetrics(width: number): Metrics & MapOpts & { maxHeight: number; dayWidth: number } {
  // No time gutter: the week's seven columns span the full measured width.
  const dayWidth = Math.max(70, width) / 7
  const maxHeight = clamp(200, width * 0.5, 380)
  return {
    width,
    gutter: 0,
    dayWidth,
    labelFont: clamp(8.5, width * 0.019, 10),
    titleFont: clamp(8.5, dayWidth * 0.13, 11),
    metaFont: clamp(8, dayWidth * 0.105, 9.5),
    minEventHeight: clamp(12, dayWidth * 0.15, 17),
    pxPerMin: clamp(0.22, dayWidth * 0.005, 0.5),
    gapMin: 8,
    gapMax: 16,
    gapFull: GAP_FULL_MIN,
    minTotal: maxHeight * MIN_TOTAL_RATIO,
    maxHeight,
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Day names and dates over the seven columns. Drawn from dates alone, so the skeleton shares it. */
function weekHeaderRow(dates: Date[], m: Metrics & { dayWidth: number }): HTMLElement {
  const todayStr = localDateStr(new Date())
  const header = document.createElement("div")
  header.className = "flex shrink-0"

  for (const date of dates) {
    const isToday = localDateStr(date) === todayStr
    const col = document.createElement("div")
    col.className = "flex flex-col items-center gap-0.5 min-w-0"
    col.style.width = `${m.dayWidth}px`

    const name = document.createElement("div")
    name.className = isToday
      ? "uppercase tracking-[0.08em] font-semibold text-accent leading-none"
      : "uppercase tracking-[0.08em] text-popover-foreground/40 leading-none"
    name.style.fontSize = `${m.labelFont.toFixed(2)}px`
    name.textContent = WEEKDAYS[date.getDay()]
    col.appendChild(name)

    const num = document.createElement("div")
    num.className = isToday
      ? "font-semibold text-accent tabular-nums leading-none"
      : "text-popover-foreground/70 tabular-nums leading-none"
    num.style.fontSize = `${(m.labelFont + 2).toFixed(2)}px`
    num.textContent = String(date.getDate())
    col.appendChild(num)

    header.appendChild(col)
  }
  return header
}

function renderWeekView(events: CalendarEvent[], width: number): ViewParts {
  const m = weekMetrics(width)
  const { start } = getDateRange()
  const todayStr = localDateStr(new Date())

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const dateStr = localDateStr(date)
    return {
      date,
      dateStr,
      isToday: dateStr === todayStr,
      blocks: blocksForDay(events, dateStr),
      allDay: allDayFor(events, dateStr),
      todos: todosDueOn(dateStr),
    }
  })

  const todayIndex = days.findIndex(d => d.isToday)
  const root = document.createElement("div")
  root.className = "flex flex-col gap-1.5 min-w-0 pt-2"
  root.dataset.loading = "true"
  root.appendChild(weekHeaderRow(days.map(d => d.date), m))

  if (days.some(d => d.allDay.length > 0 || d.todos.length > 0)) {
    const row = document.createElement("div")
    row.className = "flex shrink-0"
    for (const day of days) {
      const col = document.createElement("div")
      col.className = "flex flex-col gap-px min-w-0 px-px"
      col.style.width = `${m.dayWidth}px`
      // Two rows per day, events first — a week column has no room for more.
      const chips = [
        ...day.allDay.map(event => () => allDayChip(event, m, false)),
        ...day.todos.map(todo => () => todoChip(todo, m, false)),
      ]
      for (const build of chips.slice(0, 2)) col.appendChild(build())
      if (chips.length > 2) {
        const more = document.createElement("div")
        more.className = "truncate text-popover-foreground/40 leading-tight"
        more.style.fontSize = `${m.metaFont.toFixed(2)}px`
        more.style.padding = "0 4px 0 6px"
        more.textContent = `+${chips.length - 2}`
        col.appendChild(more)
      }
      row.appendChild(col)
    }
    root.appendChild(row)
  }

  const allBlocks = days.flatMap(d => d.blocks)
  if (allBlocks.length === 0) {
    root.appendChild(emptyNote("No events this week"))
    return { el: root, tick: () => {} }
  }

  const map = buildTimeMap(allBlocks, m, coreAnchor(todayIndex >= 0))

  const scroll = scroller(m.maxHeight)
  const inner = document.createElement("div")
  inner.className = "relative"
  inner.style.height = `${Math.ceil(map.total)}px`

  if (todayIndex >= 0) {
    inner.appendChild(
      absEl("absolute top-0 bottom-0 bg-accent/[0.07] rounded-theme-xs pointer-events-none", {
        left: `${todayIndex * m.dayWidth}px`,
        width: `${m.dayWidth}px`,
      })
    )
  }

  for (let i = 1; i < 7; i++) {
    inner.appendChild(
      absEl("absolute top-0 bottom-0 bg-popover-foreground/[0.06] pointer-events-none", {
        left: `${i * m.dayWidth}px`,
        width: "1px",
      })
    )
  }

  for (const el of renderGapMarks(map, m)) inner.appendChild(el)

  days.forEach((day, i) => {
    if (day.blocks.length === 0) return
    const host = absEl("absolute top-0", {
      left: `${i * m.dayWidth + 1}px`,
      width: `${m.dayWidth - 2}px`,
      height: `${map.total}px`,
    })
    layoutBlocks(host, map, day.blocks, m.dayWidth - 2, m)
    inner.appendChild(host)
  })

  let nowRow: HTMLElement | null = null
  if (todayIndex >= 0) {
    nowRow = renderNowLine(map, m, {
      from: todayIndex * m.dayWidth,
      to: (todayIndex + 1) * m.dayWidth,
    })
    inner.appendChild(nowRow)
  }

  attachScrubber(scroll, inner, map, m)
  scroll.appendChild(inner)
  root.appendChild(scroll)

  if (nowRow) {
    const y = clamp(0, map.y(minutesNow()), map.total)
    requestAnimationFrame(() => {
      scroll.scrollTop = clamp(0, y - scroll.clientHeight / 2, Math.max(0, map.total - scroll.clientHeight))
    })
  }

  return {
    el: root,
    tick: () => {
      if (nowRow) nowRow.style.top = `${clamp(0, map.y(minutesNow()), map.total)}px`
    },
  }
}


/* ── Skeleton ───────────────────────────────────────────────────────────── */

/** Where a placeholder block sits, as a fraction of the timeline's height. */
const DAY_SKELETON: [number, number][] = [[0, 0.12], [0.19, 0.29], [0.37, 0.58], [0.66, 0.76], [0.85, 0.97]]
const WEEK_SKELETON: [number, number][][] = [
  [[0.1, 0.24]],
  [[0.04, 0.18], [0.42, 0.62]],
  [[0.3, 0.44]],
  [[0.12, 0.34], [0.55, 0.66]],
  [[0.22, 0.3], [0.46, 0.72]],
  [[0.08, 0.2], [0.62, 0.78]],
  [[0.36, 0.5]],
]

function skeletonBlock(left: number, top: number, width: number, height: number): HTMLElement {
  return absEl("absolute bg-popover-foreground/[0.07] rounded-theme-xs", {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${Math.max(6, height)}px`,
  })
}

/**
 * Stands in for a view whose week hasn't landed yet, at the same dimensions the
 * real one will take. Navigation never waits on a fetch, so this is what a step
 * past the prefetch window shows for the ~300ms before the events arrive.
 */
function renderSkeleton(width: number): HTMLElement {
  return viewMode === "1d" ? daySkeleton(width) : weekSkeleton(width)
}

function daySkeleton(width: number): HTMLElement {
  const m = dayMetrics(width)
  const root = document.createElement("div")
  root.className = "flex flex-col gap-2.5 min-w-0 pt-2.5 animate-pulse"
  root.dataset.loading = "true"

  if (offset === 0) {
    const nextUp = document.createElement("div")
    nextUp.className = "bg-popover-foreground/[0.05] rounded-theme shrink-0"
    nextUp.style.height = `${Math.round(clamp(48, width * 0.17, 62))}px`
    root.appendChild(nextUp)
  }

  const height = Math.round(m.maxHeight * 0.68)
  const inner = document.createElement("div")
  inner.className = "relative min-w-0"
  inner.style.height = `${height}px`

  const contentW = Math.max(40, width - m.gutter - 6)
  for (const [from, to] of DAY_SKELETON) {
    if (m.gutter > 0) {
      inner.appendChild(skeletonBlock(0, from * height + 2, Math.max(14, m.gutter - 12), 6))
    }
    inner.appendChild(skeletonBlock(m.gutter, from * height, contentW, (to - from) * height))
  }
  root.appendChild(inner)
  return root
}

function weekSkeleton(width: number): HTMLElement {
  const m = weekMetrics(width)
  const start = weekStartAt(viewMode === "1w" ? offset : 0)
  const root = document.createElement("div")
  root.className = "flex flex-col gap-1.5 min-w-0 pt-2"
  root.appendChild(weekHeaderRow(Array.from({ length: 7 }, (_, i) => addDays(start, i)), m))

  const height = Math.round(m.maxHeight * 0.72)
  const inner = document.createElement("div")
  inner.className = "relative min-w-0 animate-pulse"
  inner.style.height = `${height}px`

  const todayIndex = Array.from({ length: 7 }, (_, i) => localDateStr(addDays(start, i)))
    .indexOf(localDateStr(new Date()))
  if (todayIndex >= 0) {
    inner.appendChild(
      absEl("absolute top-0 bottom-0 bg-accent/[0.07] rounded-theme-xs pointer-events-none", {
        left: `${todayIndex * m.dayWidth}px`,
        width: `${m.dayWidth}px`,
      })
    )
  }

  for (let i = 1; i < 7; i++) {
    inner.appendChild(
      absEl("absolute top-0 bottom-0 bg-popover-foreground/[0.06] pointer-events-none", {
        left: `${i * m.dayWidth}px`,
        width: "1px",
      })
    )
  }

  WEEK_SKELETON.forEach((spans, i) => {
    for (const [from, to] of spans) {
      inner.appendChild(
        skeletonBlock(i * m.dayWidth + 1, from * height, m.dayWidth - 2, (to - from) * height)
      )
    }
  })
  root.appendChild(inner)
  return root
}

function renderTrigger(): void {
  const trigger = document.getElementById("calendar-trigger") as HTMLButtonElement
  if (!store.sync.get("calendarEnabled")) {
    trigger.hidden = true
    closeCalendarPopover()
    return
  }

  if (currentState === "not-connected") {
    trigger.hidden = true
    return
  }

  trigger.hidden = false

  if (currentState === "loading") {
    trigger.innerHTML = ""
    trigger.appendChild(icon("calendar", { size: 24 }))
    const loadLabel = document.createElement("span")
    loadLabel.className = "text-xs"
    loadLabel.textContent = "Loading..."
    trigger.appendChild(loadLabel)
    return
  }

  if (currentState === "error") {
    trigger.innerHTML = ""
    trigger.appendChild(icon("refresh", { size: 24 }))
    return
  }

  const count = countEventsToday()
  const label = count === 1 ? "1 event today" : `${count} events today`
  trigger.innerHTML = ""
  trigger.appendChild(icon("calendar", { size: 24 }))
  const evtLabel = document.createElement("span")
  evtLabel.className = "text-sm"
  evtLabel.textContent = label
  trigger.appendChild(evtLabel)
}

/**
 * A live body: the ResizeObserver that re-lays it out, and the minute ticker
 * that walks the now-line down the timeline. `refreshCard` and `rebuild` both
 * throw the old body away without telling anyone, so each entry retires itself
 * once it leaves the document. `mounted` guards the window between building a
 * body and its host inserting it, when it is legitimately disconnected.
 */
type LiveBody = {
  root: HTMLElement
  rebuild: () => void
  ro: ResizeObserver
  timer: ReturnType<typeof setInterval>
  mounted: boolean
}
const liveBodies = new Set<LiveBody>()

function retire(entry: LiveBody): void {
  hideEventHover()
  entry.ro.disconnect()
  clearInterval(entry.timer)
  liveBodies.delete(entry)
}

/**
 * Nav controls plus the current view (1d/1w). Shared by the immersive popover
 * and the card in the other layouts; `rebuild` re-renders after a nav or fetch.
 *
 * Every dimension inside comes from the host's measured width rather than the
 * viewport, because the same builder fills a 660px popover in Immersive and a
 * grid card everywhere else. See docs/layouts.md.
 */
/**
 * The sign-in rendered inline, so an enabled-but-unconnected card is a way in
 * rather than a dead box pointing at Settings — the same shape as the GitHub,
 * Linear and Mail cards.
 */
function buildConnectPanel(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col items-center justify-center gap-2.5 px-4 py-6 text-center"

  wrap.appendChild(icon("calendar", { size: 30, class: "text-popover-foreground/25" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/70"
  heading.textContent = "Connect Google Calendar"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[260px] text-[11px] leading-relaxed text-popover-foreground/40"
  sub.textContent = "See today and the week ahead without leaving this tab."
  wrap.appendChild(sub)

  const status = document.createElement("p")
  status.className = "max-w-[270px] text-[11px] leading-relaxed text-warning/80"
  status.hidden = true

  const connect = createButton("Sign in with Google", "primary", {
    tone: "popover",
    icon: icon("calendar", { size: 15 }),
    onClick: async () => {
      connect.disabled = true
      status.hidden = true
      const result = await authenticate()
      connect.disabled = false
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
  wrap.appendChild(status)
  return wrap
}

export function buildCalendarBody(): { el: HTMLElement; rebuild: () => void; dispose: () => void } {
  const content = document.createElement("div")
  content.className = "flex flex-col gap-0 min-w-0"

  const viewHost = document.createElement("div")
  viewHost.className = "min-w-0"

  let width = 320
  let parts: ViewParts | null = null

  function draw(): void {
    if (width <= 0) return
    // Every path below replaces the view, and an element removed from under the
    // pointer fires no mouseleave — the card would sit there anchored to nothing.
    hideEventHover()

    // Navigation never waits on the network: whatever week the controls are
    // pointing at is drawn from what we hold, and the request below is fire-
    // and-forget — a stale week refreshes underneath, a missing one arrives as
    // a redraw from notifyDataChanged(). Chaining a redraw onto it instead
    // would spin a permanently failing week into a microtask loop.
    const key = visibleWeekKey()
    const data = getWeek(key)
    requestWeek(key)

    const scrollTop = viewHost.querySelector<HTMLElement>(".overflow-y-auto")?.scrollTop ?? null
    viewHost.replaceChildren()

    if (!data) {
      parts = null
      const failed = weekFailedAt.has(key) && !weekFetches.has(key)
      viewHost.appendChild(failed ? retryNote(key, draw) : renderSkeleton(width))
      return
    }

    parts = viewMode === "1d"
      ? renderDayView(data.events, width, rebuild)
      : renderWeekView(data.events, width)
    viewHost.appendChild(parts.el)
    if (scrollTop) {
      const next = viewHost.querySelector<HTMLElement>(".overflow-y-auto")
      if (next) requestAnimationFrame(() => { next.scrollTop = scrollTop })
    }
  }

  function rebuild(): void {
    content.replaceChildren()
    if (!store.local.get("calendarConnected")) {
      content.appendChild(buildConnectPanel())
      return
    }
    content.appendChild(
      renderControls(() => {
        // Redraw first — the new period is already in hand, or is a skeleton.
        rebuild()
        void refreshCalendar()
      })
    )
    content.appendChild(viewHost)
    draw()
  }

  rebuild()

  const ro = new ResizeObserver((entries) => {
    const next = Math.round(entries[0].contentRect.width)
    if (next <= 0 || next === width) return
    width = next
    draw()
  })
  ro.observe(content)

  const entry: LiveBody = {
    root: content,
    rebuild,
    ro,
    timer: setInterval(() => {
      if (content.isConnected) {
        entry.mounted = true
        parts?.tick()
      } else if (entry.mounted) {
        retire(entry)
      }
    }, 30_000),
    mounted: false,
  }
  liveBodies.add(entry)

  return { el: content, rebuild, dispose: () => retire(entry) }
}

function showCalendarPopover(anchor: HTMLElement): void {
  closeCalendarPopover()
  viewMode = "1d"
  offset = 0

  const body = buildCalendarBody()
  body.el.style.width = "660px"
  void refreshCalendar()

  const { close } = createPopover(anchor, body.el, {
    onClose: () => {
      calendarPopoverClose = null
      body.dispose()
    },
  })
  calendarPopoverClose = close
}

let cardBody: ReturnType<typeof buildCalendarBody> | null = null

registerCard({
  id: "calendar",
  title: "Calendar",
  order: 30,
  regions: { default: "grid", dashboard: "side" },
  span: { default: 2 },
  enabledKey: "calendarEnabled",
  render: () => {
    viewMode = "1d"
    offset = 0
    cardBody = buildCalendarBody()
    void refreshCalendar()
    return cardBody.el
  },
  onUnmount: () => {
    cardBody?.dispose()
    cardBody = null
  },
})

// The day and week views draw todos due in the range, so a change over in the
// todo widget has to reach the calendar the same way a fetch does.
store.local.subscribe("todos", notifyDataChanged)

function startRefreshInterval(): void {
  stopRefreshInterval()
  refreshIntervalId = setInterval(() => void refreshCalendar(), REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
}

/** Every event currently held in memory, for the palette's blended pass. */
export function calendarSnapshot(): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const week of weeks.values()) out.push(...week.events)
  return out
}

/**
 * A live search across every calendar, for when the palette is scoped to
 * Calendar. The cached weeks only cover what the card has drawn; this reaches
 * the year either side of today, which is the range a search is asked about.
 */
export async function searchCalendar(query: string, signal: AbortSignal): Promise<CalendarEvent[]> {
  if (!store.local.get("calendarConnected")) return []

  const now = new Date()
  const params = new URLSearchParams({
    q: query,
    timeMin: addDays(now, -365).toISOString(),
    timeMax: addDays(now, 365).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "25",
  })

  const { token, calendars, colorMap } = await getFetchContext()
  if (signal.aborted) return []

  const results = await Promise.all(
    calendars.map((cal) => fetchCalendarEvents(cal, params, token, colorMap))
  )
  return results.filter((r): r is CalendarEvent[] => r !== null).flat()
}

export function initCalendar(): void {
  const trigger = document.getElementById("calendar-trigger") as HTMLButtonElement

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "error") {
      void refreshCalendar(true)
      return
    }
    if (currentState === "loaded") {
      if (calendarPopoverClose) {
        closeCalendarPopover()
      } else {
        showCalendarPopover(trigger)
      }
    }
  })

  store.sync.subscribe("calendarEnabled", (val) => {
    if (val && store.local.get("calendarConnected")) {
      void refreshCalendar()
      startRefreshInterval()
    } else {
      trigger.hidden = true
      closeCalendarPopover()
      stopRefreshInterval()
    }
  })

  store.local.subscribe("calendarConnected", (connected) => {
    // Every live body redraws itself off the state change below; the connect
    // panel and the calendar are two branches of the same rebuild.
    notifyDataChanged()
    if (connected && store.sync.get("calendarEnabled")) {
      void refreshCalendar()
      startRefreshInterval()
    } else {
      stopRefreshInterval()
      clearWeeks()
      setState("not-connected")
      renderTrigger()
    }
  })

  if (!store.sync.get("calendarEnabled")) {
    trigger.hidden = true
    return
  }

  if (!store.local.get("calendarConnected")) {
    currentState = "not-connected"
    renderTrigger()
    return
  }

  pruneWeekCache()
  syncState()
  renderTrigger()
  void refreshCalendar()
  startRefreshInterval()
}
