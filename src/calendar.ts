import { store } from "./store"
import { refreshCards, registerCard } from "./layout"
import { icon } from "./icons/registry"
import { createPopover } from "./components"
import { getDueOn, normalizeTodos } from "./todos"
import type { Todo } from "./todos"
import { showTodoPopover } from "./todo"
import {
  authenticate as googleAuthenticate,
  getValidToken,
  invalidateToken,
  revoke as googleRevoke,
} from "./google-auth"
import type { AuthOutcome } from "./google-auth"

export type { AuthOutcome }

type CalendarEvent = {
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
const LS_LAST_FETCH = "sp:calendar:lastFetch"
const EVENTS_PREFIX = "sp:calendar:events:"

const COOLDOWN = 10_000
const REFRESH_INTERVAL = 300_000
const CALENDAR_LIST_TTL = 3_600_000

type State = "not-connected" | "loading" | "loaded" | "error"
type ViewMode = "1d" | "1w"

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

let currentState: State = "loading"
let currentEvents: CalendarEvent[] = []
/** Which range `currentEvents` was fetched for. The views refuse to draw a range it doesn't cover. */
let currentRangeKey: string | null = null
/** Shared so a second caller awaits the running fetch rather than getting an instant no-op. */
let inFlight: Promise<void> | null = null
let todayEventCount = 0
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let calendarPopoverClose: (() => void) | null = null
let popoverRebuild: (() => void) | null = null
let viewMode: ViewMode = "1d"
let offset = 0

export async function authenticate(): Promise<AuthOutcome> {
  const outcome = await googleAuthenticate()
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
  await googleRevoke()

  store.local.set("calendarConnected", false)
  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.startsWith("sp:calendar:")) localStorage.removeItem(key)
    }
  } catch { /* */ }
}

function getDateRange(): { start: Date; end: Date } {
  const now = new Date()
  // Spans are advanced by date component, not by adding ms: across a DST
  // boundary a fixed 86_400_000 lands an hour either side of local midnight.
  if (viewMode === "1d") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    return { start, end }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  return { start, end }
}

function rangeKey(start: Date, end: Date): string {
  return localDateStr(start) + "_" + localDateStr(end)
}

function eventsCacheKey(start: Date, end: Date): string {
  return EVENTS_PREFIX + rangeKey(start, end)
}

function getCachedEvents(start: Date, end: Date): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(eventsCacheKey(start, end))
    if (!raw) return null
    const { ts, events } = JSON.parse(raw) as { ts: number; events: CalendarEvent[] }
    if (Date.now() - ts > REFRESH_INTERVAL) return null
    return events
  } catch {
    return null
  }
}

function setCachedEvents(start: Date, end: Date, events: CalendarEvent[]): void {
  try {
    localStorage.setItem(eventsCacheKey(start, end), JSON.stringify({ ts: Date.now(), events }))
  } catch { /* quota */ }
}

function isCooldownActive(): boolean {
  try {
    const last = localStorage.getItem(LS_LAST_FETCH)
    if (!last) return false
    return Date.now() - Number(last) < COOLDOWN
  } catch {
    return false
  }
}

function fetchEvents(): Promise<void> {
  if (inFlight) return inFlight

  const run = (async () => {
    if (!store.sync.get("calendarEnabled")) return
    if (!store.local.get("calendarConnected")) {
      currentState = "not-connected"
      currentEvents = []
      currentRangeKey = null
      renderTrigger()
      return
    }

    const { start, end } = getDateRange()
    await runFetch(start, end)

    renderTrigger()
    popoverRebuild?.()
  })()

  inFlight = run.finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runFetch(start: Date, end: Date): Promise<void> {
  if (isCooldownActive()) {
    const cached = getCachedEvents(start, end)
    if (cached) {
      currentEvents = cached
      currentRangeKey = rangeKey(start, end)
      currentState = "loaded"
      renderTrigger()
      return
    }
  }

  const cached = getCachedEvents(start, end)
  if (cached) {
    currentEvents = cached
    currentRangeKey = rangeKey(start, end)
    currentState = "loaded"
    renderTrigger()
  } else if (currentState !== "loaded") {
    currentState = "loading"
    renderTrigger()
  }

  let token = await getValidToken()
  if (!token) {
    store.local.set("calendarConnected", false)
    currentState = "not-connected"
    currentEvents = []
    currentRangeKey = null
    renderTrigger()
    return
  }

  try {
    let calendars: CalendarInfo[]
    let colorMap: GoogleColorMap
    try {
      calendars = await fetchCalendarList(token)
      colorMap = await fetchColorMap(token)
    } catch (e) {
      if (e instanceof Error && e.message.includes("401")) {
        localStorage.removeItem(LS_CALENDAR_LIST)
        localStorage.removeItem(LS_CALENDAR_LIST_TS)
        localStorage.removeItem(LS_COLOR_MAP)
        await invalidateToken()
        token = await getValidToken()
        if (!token) {
          store.local.set("calendarConnected", false)
          currentState = "not-connected"
          currentEvents = []
          renderTrigger()
          return
        }
        calendars = await fetchCalendarList(token)
        colorMap = await fetchColorMap(token)
      } else {
        throw e
      }
    }

    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
    })

    const allEvents: CalendarEvent[] = []
    let reached = 0

    for (const cal of calendars) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) continue
        reached++

        const data = await res.json()
        for (const e of (data.items ?? []) as Record<string, unknown>[]) {
          if (e.status === "cancelled") continue
          const colorId = e.colorId as string | undefined
          const color = colorId && colorMap.event?.[colorId]
            ? colorMap.event[colorId].background
            : cal.backgroundColor

          allEvents.push({
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
      } catch {
        continue
      }
    }

    if (calendars.length > 0 && reached === 0) {
      throw new Error("Every calendar request failed")
    }

    allEvents.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0
      return aTime - bTime
    })

    currentEvents = allEvents
    currentRangeKey = rangeKey(start, end)
    currentState = "loaded"
    if (viewMode === "1d" && offset === 0) todayEventCount = currentEvents.length
    setCachedEvents(start, end, allEvents)
    try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())) } catch { /* */ }
  } catch {
    if (!cached) {
      currentState = "error"
    }
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

const NAV_LIMITS: Record<ViewMode, number> = { "1d": 6, "1w": 3 }

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
      viewMode = mode
      offset = 0
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

function showEventDetail(anchor: HTMLElement, event: CalendarEvent): void {
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

  createPopover(anchor, content)
}

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
}

type MapOpts = {
  pxPerMin: number
  minEventHeight: number
  gapScale: number
  gapMin: number
  gapMax: number
}

const EMPTY_MAP: TimeMap = {
  slices: [],
  total: 0,
  domain: { start: 0, end: 0 },
  y: () => 0,
}

function clamp(lo: number, v: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Slices the domain at every span boundary, sizes each slice by duration
 * (compressed if nothing covers it), then grows slices until every span clears
 * `minEventH` — so the shortest event still has room for its title. Growth only
 * ever adds height, so the relaxation converges; six passes is far more than
 * any realistic day needs.
 */
function buildTimeMap(spans: Span[], opts: MapOpts): TimeMap {
  if (spans.length === 0) return EMPTY_MAP

  const domain = {
    start: Math.min(...spans.map(s => s.start)),
    end: Math.max(...spans.map(s => s.end)),
  }
  if (domain.end <= domain.start) return EMPTY_MAP

  const bounds = [...new Set(spans.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b)

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
      h: busy
        ? dur * opts.pxPerMin
        : clamp(opts.gapMin, dur * opts.pxPerMin * opts.gapScale, opts.gapMax),
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

  return { slices, total, domain, y: mapY }
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

/** One event. Text is sized to fit the block, dropping to a bare title when short. */
function renderBlock(block: Block, w: number, h: number, m: Metrics): HTMLElement {
  const el = document.createElement("div")
  el.className =
    "absolute overflow-hidden rounded-theme-xs cursor-pointer flex flex-col transition-[filter,box-shadow] hover:brightness-110 hover:z-10"
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
  el.title = `${block.event.title} · ${formatTimeRange(block.event)}`
  el.addEventListener("click", () => showEventDetail(el, block.event))
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
  chip.className = "truncate rounded-theme-xs cursor-pointer leading-tight hover:brightness-110"
  chip.style.backgroundColor = tint(event.color, 22)
  chip.style.boxShadow = `inset 2px 0 0 ${event.color}`
  chip.style.padding = full ? "3px 7px 3px 9px" : "1.5px 4px 1.5px 6px"
  chip.style.fontSize = `${(full ? m.titleFont : m.metaFont).toFixed(2)}px`
  chip.classList.add("text-popover-foreground/85", "font-medium")
  chip.textContent = event.title
  chip.title = `${event.title} · All day`
  chip.addEventListener("click", () => showEventDetail(chip, event))
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
    "relative overflow-hidden rounded-theme flex items-center gap-2.5 cursor-pointer hover:brightness-110 transition-[filter]"
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

  card.addEventListener("click", () => showEventDetail(card, next.event))
  wrap.appendChild(card)
  return { el: wrap, tick: paint }
}

function dayMetrics(width: number): Metrics & MapOpts & { maxHeight: number } {
  return {
    width,
    gutter: width >= 200 ? Math.round(clamp(36, width * 0.1, 48)) : 0,
    labelFont: clamp(8.5, width * 0.026, 10.5),
    titleFont: clamp(10.5, width * 0.032, 13),
    metaFont: clamp(9, width * 0.026, 11),
    minEventHeight: clamp(19, width * 0.05, 26),
    pxPerMin: clamp(0.55, width * 0.0017, 1),
    gapScale: 0.16,
    gapMin: 14,
    gapMax: clamp(18, width * 0.06, 30),
    maxHeight: clamp(240, width * 0.72, 460),
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

  const map = buildTimeMap(blocks, m)
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
  return {
    width,
    gutter: 0,
    dayWidth,
    labelFont: clamp(8.5, width * 0.019, 10),
    titleFont: clamp(8.5, dayWidth * 0.13, 11),
    metaFont: clamp(8, dayWidth * 0.105, 9.5),
    minEventHeight: clamp(12, dayWidth * 0.15, 17),
    pxPerMin: clamp(0.22, dayWidth * 0.005, 0.5),
    gapScale: 0.1,
    gapMin: 8,
    gapMax: 16,
    maxHeight: clamp(200, width * 0.5, 380),
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

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

  const header = document.createElement("div")
  header.className = "flex shrink-0"

  for (const day of days) {
    const col = document.createElement("div")
    col.className = "flex flex-col items-center gap-0.5 min-w-0"
    col.style.width = `${m.dayWidth}px`

    const name = document.createElement("div")
    name.className = day.isToday
      ? "uppercase tracking-[0.08em] font-semibold text-accent leading-none"
      : "uppercase tracking-[0.08em] text-popover-foreground/40 leading-none"
    name.style.fontSize = `${m.labelFont.toFixed(2)}px`
    name.textContent = WEEKDAYS[day.date.getDay()]
    col.appendChild(name)

    const num = document.createElement("div")
    num.className = day.isToday
      ? "font-semibold text-accent tabular-nums leading-none"
      : "text-popover-foreground/70 tabular-nums leading-none"
    num.style.fontSize = `${(m.labelFont + 2).toFixed(2)}px`
    num.textContent = String(day.date.getDate())
    col.appendChild(num)

    header.appendChild(col)
  }
  root.appendChild(header)

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

  const map = buildTimeMap(allBlocks, m)

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


function renderTrigger(): void {
  cardBody?.rebuild()
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

  const count = todayEventCount
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
type LiveBody = { root: HTMLElement; ro: ResizeObserver; timer: ReturnType<typeof setInterval>; mounted: boolean }
const liveBodies = new Set<LiveBody>()

function retire(entry: LiveBody): void {
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
export function buildCalendarBody(): { el: HTMLElement; rebuild: () => void; dispose: () => void } {
  const content = document.createElement("div")
  content.className = "flex flex-col gap-0 min-w-0"

  const viewHost = document.createElement("div")
  viewHost.className = "min-w-0"

  let width = 320
  let parts: ViewParts | null = null
  let requested: string | null = null

  function draw(): void {
    if (width <= 0) return

    // `currentEvents` is module state shared with the fetch loop, and the view
    // resets to 1d/today on every mount. If what we hold was fetched for some
    // other range, rendering it would silently show the wrong day — or, once
    // the views filter by date, an empty one. Ask for the right range instead.
    const { start, end } = getDateRange()
    const key = rangeKey(start, end)
    if (currentRangeKey !== key) {
      parts = null
      viewHost.replaceChildren(
        emptyNote(requested === key ? "Couldn't reach Google Calendar." : "Loading…")
      )
      if (requested !== key) {
        requested = key
        fetchEvents().then(() => {
          if (content.isConnected) draw()
        })
      }
      return
    }
    requested = null

    const scrollTop = viewHost.querySelector<HTMLElement>(".overflow-y-auto")?.scrollTop ?? null
    viewHost.replaceChildren()
    parts = viewMode === "1d"
      ? renderDayView(currentEvents, width, rebuild)
      : renderWeekView(currentEvents, width)
    viewHost.appendChild(parts.el)
    if (scrollTop) {
      const next = viewHost.querySelector<HTMLElement>(".overflow-y-auto")
      if (next) requestAnimationFrame(() => { next.scrollTop = scrollTop })
    }
  }

  function rebuild(): void {
    content.replaceChildren()
    content.appendChild(
      renderControls(() => {
        fetchEvents().then(rebuild)
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
  popoverRebuild = body.rebuild
  fetchEvents()

  const { close } = createPopover(anchor, body.el, {
    onClose: () => {
      calendarPopoverClose = null
      popoverRebuild = null
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
  isEnabled: () => store.local.get("calendarConnected"),
  render: () => {
    viewMode = "1d"
    offset = 0
    cardBody = buildCalendarBody()
    fetchEvents()
    return cardBody.el
  },
  onUnmount: () => {
    cardBody?.dispose()
    cardBody = null
  },
})

// The day and week views draw todos due in the range, so a change over in the
// todo widget has to reach the calendar the same way a fetch does.
store.local.subscribe("todos", () => {
  cardBody?.rebuild()
  popoverRebuild?.()
})

function startRefreshInterval(): void {
  stopRefreshInterval()
  refreshIntervalId = setInterval(() => fetchEvents(), REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
}

export function initCalendar(): void {
  const trigger = document.getElementById("calendar-trigger") as HTMLButtonElement

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "error") {
      fetchEvents()
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
      fetchEvents()
      startRefreshInterval()
    } else {
      trigger.hidden = true
      closeCalendarPopover()
      stopRefreshInterval()
    }
  })

  store.local.subscribe("calendarConnected", (connected) => {
    refreshCards()
    if (connected && store.sync.get("calendarEnabled")) {
      fetchEvents()
      startRefreshInterval()
    } else {
      stopRefreshInterval()
      currentState = "not-connected"
      currentEvents = []
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

  fetchEvents()
  startRefreshInterval()
}
