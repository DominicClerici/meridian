import { store } from "./store"
import { icon } from "./icons/registry"

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
type ViewMode = "1d" | "1w" | "1m"

let currentState: State = "loading"
let currentEvents: CalendarEvent[] = []
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let calendarPopoverClose: (() => void) | null = null
let viewMode: ViewMode = "1d"
let offset = 0

function getApi() {
  return globalThis.browser ?? globalThis.chrome
}

async function getToken(interactive: boolean): Promise<string | null> {
  const api = getApi()
  if (!api?.identity?.getAuthToken) return null

  try {
    const result = await api.identity.getAuthToken({ interactive })
    return result?.token ?? null
  } catch {
    return null
  }
}

export async function authenticate(): Promise<boolean> {
  const token = await getToken(true)
  if (!token) return false
  store.local.set("calendarConnected", true)
  return true
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
  const api = getApi()
  if (api?.identity?.removeCachedAuthToken) {
    const token = await getToken(false)
    if (token) {
      try {
        await api.identity.removeCachedAuthToken({ token })
        await fetch(
          `https://accounts.google.com/o/oauth2/revoke?token=${token}`
        )
      } catch {
        /* */
      }
    }
  }

  store.local.set("calendarConnected", false)
  try {
    localStorage.removeItem(LS_LAST_FETCH)
    localStorage.removeItem(LS_CALENDAR_LIST)
    localStorage.removeItem(LS_CALENDAR_LIST_TS)
    localStorage.removeItem(LS_COLOR_MAP)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(EVENTS_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    /* */
  }
}

function getDateRange(): { start: Date; end: Date } {
  const now = new Date()
  if (viewMode === "1d") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    const end = new Date(start.getTime() + 86_400_000)
    return { start, end }
  }
  if (viewMode === "1w") {
    const day = now.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + offset * 7)
    const sunday = new Date(monday.getTime() + 7 * 86_400_000)
    return { start: monday, end: sunday }
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  return { start, end }
}

function eventsCacheKey(start: Date, end: Date): string {
  return EVENTS_PREFIX + start.toISOString().slice(0, 10) + "_" + end.toISOString().slice(0, 10)
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

async function fetchEvents(): Promise<void> {
  if (!store.sync.get("calendarEnabled")) return
  if (!store.local.get("calendarConnected")) {
    currentState = "not-connected"
    currentEvents = []
    renderTrigger()
    return
  }

  const { start, end } = getDateRange()

  if (isCooldownActive()) {
    const cached = getCachedEvents(start, end)
    if (cached) {
      currentEvents = cached
      currentState = "loaded"
      renderTrigger()
      return
    }
  }

  const cached = getCachedEvents(start, end)
  if (cached) {
    currentEvents = cached
    currentState = "loaded"
    renderTrigger()
  } else if (currentState !== "loaded") {
    currentState = "loading"
    renderTrigger()
  }

  let token = await getToken(false)
  if (!token) {
    store.local.set("calendarConnected", false)
    currentState = "not-connected"
    currentEvents = []
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
        const api = getApi()
        if (api?.identity?.removeCachedAuthToken) {
          try { await api.identity.removeCachedAuthToken({ token }) } catch { /* */ }
        }
        token = await getToken(false)
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

    for (const cal of calendars) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) continue

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

    allEvents.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0
      return aTime - bTime
    })

    currentEvents = allEvents
    currentState = "loaded"
    setCachedEvents(start, end, allEvents)
    try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())) } catch { /* */ }
  } catch {
    if (!cached) {
      currentState = "error"
    }
  }

  renderTrigger()
}

function closePopover(): void {
  if (calendarPopoverClose) {
    calendarPopoverClose()
    calendarPopoverClose = null
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div")
  div.textContent = str
  return div.innerHTML
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

const NAV_LIMITS: Record<ViewMode, number> = { "1d": 6, "1w": 3, "1m": 1 }

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

  if (viewMode === "1w") {
    if (offset === 0) return "This Week"
    if (offset === -1) return "Last Week"
    if (offset === 1) return "Next Week"
    const { start, end } = getDateRange()
    const lastDay = new Date(end.getTime() - 86_400_000)
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short" }) + " " + ordinal(d.getDate())
    return fmt(start) + " – " + fmt(lastDay)
  }

  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  return d.toLocaleDateString("en-US", { month: "long" })
}

function formatTimeRange(event: CalendarEvent): string {
  if (event.allDay) return "All day"
  if (!event.startTime || !event.endTime) return ""
  return formatTime(event.startTime) + " – " + formatTime(event.endTime)
}

function renderTrigger(): void {
  const trigger = document.getElementById(
    "calendar-trigger"
  ) as HTMLButtonElement
  if (!store.sync.get("calendarEnabled")) {
    trigger.hidden = true
    closePopover()
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

  const count = currentEvents.length
  const label = count === 1 ? "1 event today" : `${count} events today`
  trigger.innerHTML = ""
  trigger.appendChild(icon("calendar", { size: 24 }))
  const evtLabel = document.createElement("span")
  evtLabel.className = "text-sm"
  evtLabel.textContent = label
  trigger.appendChild(evtLabel)
}

function showCalendarPopover(anchor: HTMLElement): void {
  closePopover()
  const popover = document.createElement("div")
  popover.className =
    "fixed bg-popover text-popover-foreground rounded-lg shadow-lg p-3 min-w-[280px] max-w-[340px] max-h-[400px] overflow-y-auto"

  let html = `<div class="text-sm font-medium mb-2">Today's Events</div>`

  if (currentEvents.length === 0) {
    html += `<div class="text-sm text-popover-foreground/60">No events scheduled</div>`
  } else {
    html += `<div class="flex flex-col gap-1">`
    for (const event of currentEvents) {
      const timeStr = event.allDay
        ? "All day"
        : event.startTime && event.endTime
        ? `${formatTime(event.startTime)} \u2013 ${formatTime(event.endTime)}`
        : ""
      const linkOpen = event.htmlLink
        ? `<a href="${escapeHtml(
            event.htmlLink
          )}" target="_blank" rel="noopener" class="block p-2 rounded bg-popover-foreground/10 hover:bg-popover-foreground/20 transition-colors">`
        : `<div class="p-2 rounded bg-popover-foreground/10">`
      const linkClose = event.htmlLink ? "</a>" : "</div>"
      html += `${linkOpen}<div class="text-xs text-popover-foreground/60">${escapeHtml(
        timeStr
      )}</div><div class="text-sm truncate">${escapeHtml(
        event.title
      )}</div>${linkClose}`
    }
    html += `</div>`
  }

  popover.innerHTML = html
  document.body.appendChild(popover)

  const rect = anchor.getBoundingClientRect()
  popover.style.right = window.innerWidth - rect.right + "px"
  popover.style.top = rect.bottom + 4 + "px"
  calendarPopoverClose = () => {
    popover.remove()
    document.removeEventListener("click", onClickOutside)
  }

  const onClickOutside = (e: MouseEvent) => {
    if (
      !popover.contains(e.target as Node) &&
      e.target !== anchor &&
      !anchor.contains(e.target as Node)
    ) {
      closePopover()
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
}

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
  const trigger = document.getElementById(
    "calendar-trigger"
  ) as HTMLButtonElement

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "error") {
      fetchEvents()
      return
    }
    if (currentState === "loaded") {
      if (calendarPopoverClose) {
        closePopover()
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
      closePopover()
      stopRefreshInterval()
    }
  })

  store.local.subscribe("calendarConnected", (connected) => {
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
