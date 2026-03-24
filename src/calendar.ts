import { store } from "./store"

type CalendarEvent = {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  htmlLink: string
}

const LS_CACHED_EVENTS = "sp:calendar:cachedEvents"
const LS_LAST_FETCH = "sp:calendar:lastFetch"
const COOLDOWN = 10_000
const REFRESH_INTERVAL = 300_000

type State = "not-connected" | "loading" | "loaded" | "error"

let currentState: State = "loading"
let currentEvents: CalendarEvent[] = []
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let openPopover: HTMLElement | null = null

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
    localStorage.removeItem(LS_CACHED_EVENTS)
    localStorage.removeItem(LS_LAST_FETCH)
  } catch {
    /* */
  }
}

function getCachedEvents(): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(LS_CACHED_EVENTS)
    if (!raw) return null
    return JSON.parse(raw) as CalendarEvent[]
  } catch {
    return null
  }
}

function setCachedEvents(events: CalendarEvent[]): void {
  try {
    localStorage.setItem(LS_CACHED_EVENTS, JSON.stringify(events))
    localStorage.setItem(LS_LAST_FETCH, String(Date.now()))
  } catch {
    /* quota */
  }
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

async function fetchTodayEvents(): Promise<void> {
  if (!store.sync.get("calendarEnabled")) return

  if (!store.local.get("calendarConnected")) {
    currentState = "not-connected"
    currentEvents = []
    renderTrigger()
    return
  }

  if (isCooldownActive()) {
    const cached = getCachedEvents()
    if (cached) {
      currentEvents = cached
      currentState = "loaded"
      renderTrigger()
      return
    }
  }

  currentState = "loading"
  renderTrigger()

  const token = await getToken(false)
  if (!token) {
    store.local.set("calendarConnected", false)
    currentState = "not-connected"
    currentEvents = []
    renderTrigger()
    return
  }

  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000)

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  })

  try {
    let res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (res.status === 401) {
      const api = getApi()
      if (api?.identity?.removeCachedAuthToken) {
        try {
          await api.identity.removeCachedAuthToken({ token })
        } catch {
          /* */
        }
      }
      const freshToken = await getToken(false)
      if (!freshToken) {
        store.local.set("calendarConnected", false)
        currentState = "not-connected"
        currentEvents = []
        renderTrigger()
        return
      }
      res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${freshToken}` } }
      )
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    currentEvents = (data.items ?? [])
      .filter((e: Record<string, unknown>) => e.status !== "cancelled")
      .map((e: Record<string, unknown>) => ({
        id: e.id as string,
        title: (e.summary as string) ?? "(No title)",
        startTime: (e.start as Record<string, string>)?.dateTime ?? null,
        endTime: (e.end as Record<string, string>)?.dateTime ?? null,
        allDay: !!(e.start as Record<string, string>)?.date,
        htmlLink: (e.htmlLink as string) ?? "",
      }))

    currentState = "loaded"
    setCachedEvents(currentEvents)
  } catch {
    const cached = getCachedEvents()
    if (cached) {
      currentEvents = cached
      currentState = "loaded"
    } else {
      currentState = "error"
    }
  }

  renderTrigger()
}

function closePopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
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

const CALENDAR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`

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
    trigger.innerHTML = `${CALENDAR_ICON} <span class="text-xs">Loading...</span>`
    return
  }

  if (currentState === "error") {
    trigger.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`
    return
  }

  const count = currentEvents.length
  const label = count === 1 ? "1 event today" : `${count} events today`
  trigger.innerHTML = `${CALENDAR_ICON} <span class="text-sm">${label}</span>`
}

function showCalendarPopover(anchor: HTMLElement): void {
  closePopover()
  const popover = document.createElement("div")
  popover.className =
    "fixed bg-gray-800 rounded-lg shadow-lg p-3 min-w-[280px] max-w-[340px] max-h-[400px] overflow-y-auto text-white"

  let html = `<div class="text-sm font-medium mb-2">Today's Events</div>`

  if (currentEvents.length === 0) {
    html += `<div class="text-sm text-white/60">No events scheduled</div>`
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
          )}" target="_blank" rel="noopener" class="block p-2 rounded bg-white/10 hover:bg-white/20 transition-colors">`
        : `<div class="p-2 rounded bg-white/10">`
      const linkClose = event.htmlLink ? "</a>" : "</div>"
      html += `${linkOpen}<div class="text-xs text-white/60">${escapeHtml(
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
  openPopover = popover

  const onClickOutside = (e: MouseEvent) => {
    if (
      !popover.contains(e.target as Node) &&
      e.target !== anchor &&
      !anchor.contains(e.target as Node)
    ) {
      closePopover()
      document.removeEventListener("click", onClickOutside)
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
}

function startRefreshInterval(): void {
  stopRefreshInterval()
  refreshIntervalId = setInterval(() => fetchTodayEvents(), REFRESH_INTERVAL)
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
      fetchTodayEvents()
      return
    }
    if (currentState === "loaded") {
      if (openPopover) {
        closePopover()
      } else {
        showCalendarPopover(trigger)
      }
    }
  })

  store.sync.subscribe("calendarEnabled", (val) => {
    if (val && store.local.get("calendarConnected")) {
      fetchTodayEvents()
      startRefreshInterval()
    } else {
      trigger.hidden = true
      closePopover()
      stopRefreshInterval()
    }
  })

  store.local.subscribe("calendarConnected", (connected) => {
    if (connected && store.sync.get("calendarEnabled")) {
      fetchTodayEvents()
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

  fetchTodayEvents()
  startRefreshInterval()
}
