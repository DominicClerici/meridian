# Calendar Widget Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use the frontend-design skill for all UI building, design, and implementation. All new UI must follow the standards and practices of APPEARANCE.md.

**Goal:** Replace the basic "today's events" calendar popover with a full multi-view (day/week/month) calendar widget with navigation, all-calendar fetching, Google event colors, and nested event detail popovers.

**Architecture:** Single-file rewrite of `src/calendar.ts`. Fetches from all visible Google calendars via `calendarList` API. Three view modes (1D/1W/1M) with offset-based navigation. Uses `createPopover()` from `components.ts` for all popover UI. Event colors come from Google's API. Caching via localStorage with 5-minute TTL for events, 1-hour TTL for calendar list.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4 utilities, browser extension APIs (`browser.identity`), Google Calendar API v3, `createPopover`/`createButton` from `src/components.ts`, icon system from `src/icons/registry.ts`.

**Spec:** `docs/superpowers/specs/2026-03-29-calendar-widget-overhaul-design.md`

---

### Task 1: Data types and color resolution

**Files:**
- Modify: `src/calendar.ts:1-11` (replace existing types)

- [ ] **Step 1: Replace the CalendarEvent type and add supporting types**

Replace the existing `CalendarEvent` type and add `CalendarInfo` and the Google color map type at the top of the file (after imports):

```ts
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
```

- [ ] **Step 2: Update localStorage key constants and add new ones**

Replace and extend the existing constants block:

```ts
const LS_CALENDAR_LIST = "sp:calendar:calendarList"
const LS_CALENDAR_LIST_TS = "sp:calendar:calendarListTs"
const LS_COLOR_MAP = "sp:calendar:colors"
const LS_LAST_FETCH = "sp:calendar:lastFetch"
const EVENTS_PREFIX = "sp:calendar:events:"

const COOLDOWN = 10_000
const REFRESH_INTERVAL = 300_000
const CALENDAR_LIST_TTL = 3_600_000
```

- [ ] **Step 3: Add state variables for view mode and navigation**

Replace the existing state variables (`currentState`, `currentEvents`, `refreshIntervalId`, `openPopover`) with:

```ts
type State = "not-connected" | "loading" | "loaded" | "error"
type ViewMode = "1d" | "1w" | "1m"

let currentState: State = "loading"
let currentEvents: CalendarEvent[] = []
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let calendarPopoverClose: (() => void) | null = null
let viewMode: ViewMode = "1d"
let offset = 0
```

- [ ] **Step 4: Build and test**

Run: `./build.sh`
Expected: Clean build, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/calendar.ts
git commit -m "refactor(calendar): replace types with multi-view data model"
```

---

### Task 2: Calendar list and color fetching

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add fetchCalendarList function**

Add after the `getApi()`/`getToken()` functions (keeping those unchanged):

```ts
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
```

- [ ] **Step 2: Add fetchColorMap function**

```ts
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
```

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): add calendar list and color map fetching with caching"
```

---

### Task 3: Date range computation and event fetching

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add date range computation**

```ts
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
  // 1m
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  return { start, end }
}
```

- [ ] **Step 2: Add event cache helpers**

```ts
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
```

- [ ] **Step 3: Rewrite fetchEvents to use date range and all calendars**

Replace the existing `fetchTodayEvents()` with `fetchEvents()`:

```ts
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
```

- [ ] **Step 4: Build and test**

Run: `./build.sh`
Expected: Clean build. (There will be a reference to `renderTrigger` which still exists from the original code.)

- [ ] **Step 5: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): multi-calendar event fetching with date range and caching"
```

---

### Task 4: Navigation labels and date formatting

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add navigation label computation**

```ts
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

  // 1m
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  return d.toLocaleDateString("en-US", { month: "long" })
}
```

- [ ] **Step 2: Add time formatting helper**

Keep the existing `formatTime` and `escapeHtml` helpers. Add:

```ts
function formatTimeRange(event: CalendarEvent): string {
  if (event.allDay) return "All day"
  if (!event.startTime || !event.endTime) return ""
  return formatTime(event.startTime) + " – " + formatTime(event.endTime)
}
```

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): navigation label computation and date formatting"
```

---

### Task 5: Popover controls (view selector + navigation)

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add import for createPopover and createButton**

Update the imports at the top of the file:

```ts
import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover, createButton } from "./components"
```

- [ ] **Step 2: Build the controls renderer**

```ts
function renderControls(onUpdate: () => void): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col gap-2"

  // Row 1: View selector
  const viewRow = document.createElement("div")
  viewRow.className = "flex"
  const segmented = document.createElement("div")
  segmented.className = "flex gap-0.5 bg-popover-foreground/5 rounded-theme p-0.5"

  for (const mode of ["1d", "1w", "1m"] as ViewMode[]) {
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
  viewRow.appendChild(segmented)
  wrapper.appendChild(viewRow)

  // Row 2: Navigation
  const navRow = document.createElement("div")
  navRow.className = "flex items-center justify-between"

  const limit = NAV_LIMITS[viewMode]

  const prevBtn = document.createElement("button")
  prevBtn.className = "w-7 h-7 flex items-center justify-center rounded-theme text-muted hover:bg-surface transition-colors"
  prevBtn.appendChild(icon("chevronLeft", { size: 14 }))
  if (offset <= -limit) {
    prevBtn.classList.add("opacity-30", "pointer-events-none")
  }
  prevBtn.addEventListener("click", () => {
    if (offset > -limit) {
      offset--
      onUpdate()
    }
  })

  const label = document.createElement("span")
  label.className = "text-sm font-semibold text-foreground"
  label.textContent = getNavLabel()

  const nextBtn = document.createElement("button")
  nextBtn.className = "w-7 h-7 flex items-center justify-center rounded-theme text-muted hover:bg-surface transition-colors"
  nextBtn.appendChild(icon("chevronRight", { size: 14 }))
  if (offset >= limit) {
    nextBtn.classList.add("opacity-30", "pointer-events-none")
  }
  nextBtn.addEventListener("click", () => {
    if (offset < limit) {
      offset++
      onUpdate()
    }
  })

  navRow.appendChild(prevBtn)
  navRow.appendChild(label)
  navRow.appendChild(nextBtn)
  wrapper.appendChild(navRow)

  // Separator
  const sep = document.createElement("div")
  sep.className = "h-px bg-input-border/20 -mx-3"
  wrapper.appendChild(sep)

  return wrapper
}
```

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): view selector and navigation controls"
```

---

### Task 6: Day view (1D) renderer

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add event detail popover builder**

This is shared across all views. It opens as a nested `createPopover()`:

```ts
function showEventDetail(anchor: HTMLElement, event: CalendarEvent, opts?: { backLabel?: string; onBack?: () => void }): void {
  const content = document.createElement("div")
  content.className = "flex flex-col gap-3 min-w-[240px] max-w-[300px]"

  if (opts?.backLabel) {
    const back = document.createElement("button")
    back.className = "flex items-center gap-1 text-muted text-xs hover:text-foreground transition-colors self-start"
    back.innerHTML = "&#8249; "
    const backText = document.createElement("span")
    backText.textContent = opts.backLabel
    back.appendChild(backText)
    back.addEventListener("click", () => {
      detailPopover.close()
      opts.onBack?.()
    })
    content.appendChild(back)
  }

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

  const detailPopover = createPopover(anchor, content)
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
```

- [ ] **Step 2: Add the day view renderer**

```ts
function renderDayView(events: CalendarEvent[]): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex flex-col gap-1 overflow-y-auto"
  container.style.maxHeight = "380px"

  if (events.length === 0) {
    const empty = document.createElement("div")
    empty.className = "text-sm text-muted text-center py-8"
    empty.textContent = "No events"
    container.appendChild(empty)
    return container
  }

  const allDay = events.filter(e => e.allDay)
  const timed = events.filter(e => !e.allDay)

  if (allDay.length > 0) {
    const label = document.createElement("div")
    label.className = "text-[10px] uppercase tracking-wider text-muted mb-1"
    label.textContent = "All Day"
    container.appendChild(label)

    for (const event of allDay) {
      container.appendChild(dayEventCard(event, true))
    }

    if (timed.length > 0) {
      const sep = document.createElement("div")
      sep.className = "h-px bg-input-border/20 my-1"
      container.appendChild(sep)
    }
  }

  for (const event of timed) {
    container.appendChild(dayEventCard(event, false))
  }

  return container
}

function dayEventCard(event: CalendarEvent, allDay: boolean): HTMLElement {
  const card = document.createElement("div")
  card.className = "flex items-start gap-2.5 p-2.5 bg-popover-foreground/5 rounded-theme cursor-pointer hover:bg-popover-foreground/10 transition-colors"
  card.style.borderLeft = `3px solid ${event.color}`

  if (!allDay && event.startTime) {
    const timeCol = document.createElement("div")
    timeCol.className = "min-w-[70px]"
    const startEl = document.createElement("div")
    startEl.className = "text-xs text-popover-foreground/70"
    startEl.textContent = formatTime(event.startTime)
    timeCol.appendChild(startEl)
    if (event.endTime) {
      const endEl = document.createElement("div")
      endEl.className = "text-[11px] text-muted"
      endEl.textContent = formatTime(event.endTime)
      timeCol.appendChild(endEl)
    }
    card.appendChild(timeCol)
  }

  const info = document.createElement("div")
  info.className = "flex-1 min-w-0"
  const titleEl = document.createElement("div")
  titleEl.className = "text-xs font-medium text-popover-foreground truncate"
  titleEl.textContent = event.title
  info.appendChild(titleEl)
  if (event.location) {
    const loc = document.createElement("div")
    loc.className = "text-[11px] text-muted mt-0.5 truncate"
    loc.textContent = event.location
    info.appendChild(loc)
  }
  card.appendChild(info)

  if (event.htmlLink) {
    const linkIcon = document.createElement("a")
    linkIcon.href = event.htmlLink
    linkIcon.target = "_blank"
    linkIcon.rel = "noopener"
    linkIcon.className = "text-muted text-[11px] no-underline shrink-0 hover:text-foreground transition-colors"
    linkIcon.textContent = "↗"
    linkIcon.addEventListener("click", (e) => e.stopPropagation())
    card.appendChild(linkIcon)
  }

  card.addEventListener("click", () => {
    showEventDetail(card, event)
  })

  return card
}
```

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): day view renderer with event cards and detail popover"
```

---

### Task 7: Week view (1W) renderer

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add the week view renderer**

```ts
function renderWeekView(events: CalendarEvent[]): HTMLElement {
  const container = document.createElement("div")

  const { start } = getDateRange()
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  // Day headers
  const headerGrid = document.createElement("div")
  headerGrid.className = "grid grid-cols-7 px-0 pt-2 pb-1"

  for (let i = 0; i < 7; i++) {
    const date = new Date(start.getTime() + i * 86_400_000)
    const dateStr = date.toISOString().slice(0, 10)
    const isToday = dateStr === todayStr
    const col = document.createElement("div")
    col.className = "text-center"

    const dayLabel = document.createElement("div")
    dayLabel.className = isToday
      ? "text-[10px] uppercase tracking-wider font-semibold text-accent"
      : "text-[10px] uppercase tracking-wider text-muted"
    dayLabel.textContent = isToday ? "Today" : days[i]
    col.appendChild(dayLabel)

    const dateNum = document.createElement("div")
    dateNum.className = isToday
      ? "text-xs font-semibold text-accent mt-0.5"
      : "text-xs text-muted mt-0.5"
    dateNum.textContent = String(date.getDate())
    col.appendChild(dateNum)

    headerGrid.appendChild(col)
  }
  container.appendChild(headerGrid)

  // Event columns
  const colGrid = document.createElement("div")
  colGrid.className = "grid grid-cols-7 pb-1"
  colGrid.style.minHeight = "200px"
  colGrid.style.alignItems = "start"

  for (let i = 0; i < 7; i++) {
    const date = new Date(start.getTime() + i * 86_400_000)
    const dateStr = date.toISOString().slice(0, 10)
    const isToday = dateStr === todayStr

    const col = document.createElement("div")
    col.className = "flex flex-col gap-0.5 px-0.5 py-1"
    if (isToday) {
      col.classList.add("bg-accent/5", "rounded-theme")
    }

    const dayEvents = events.filter(e => {
      if (e.allDay) {
        return true // all-day events show on all days of the range they span — simplified: show on the start date's column
      }
      if (!e.startTime) return false
      return e.startTime.slice(0, 10) === dateStr
    })

    // For all-day: filter to events whose date range includes this day
    const filtered = dayEvents.filter(e => {
      if (!e.allDay) return true
      // All-day events have startTime as null, we need the date from the API
      // Since we only fetch events within the week range, all-day events returned are relevant
      return true
    })

    for (const event of filtered) {
      const bar = document.createElement("div")
      bar.className = "rounded-sm cursor-pointer opacity-85 hover:opacity-100 transition-opacity"
      bar.style.backgroundColor = event.color

      if (event.allDay) {
        bar.style.height = "12px"
      } else if (event.startTime && event.endTime) {
        const duration = (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60_000
        const height = Math.max(16, Math.min(48, Math.round(duration / 60 * 28)))
        bar.style.height = height + "px"
      } else {
        bar.style.height = "16px"
      }

      bar.title = event.title + (event.startTime && event.endTime
        ? " · " + formatTime(event.startTime) + "–" + formatTime(event.endTime)
        : event.allDay ? " · All day" : "")

      bar.addEventListener("click", () => {
        showEventDetail(bar, event)
      })

      col.appendChild(bar)
    }

    colGrid.appendChild(col)
  }

  container.appendChild(colGrid)
  return container
}
```

- [ ] **Step 2: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): week view renderer with colored bars"
```

---

### Task 8: Month view (1M) renderer

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Add the month view renderer**

```ts
function renderMonthView(events: CalendarEvent[]): HTMLElement {
  const container = document.createElement("div")
  const { start, end } = getDateRange()
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const year = start.getFullYear()
  const month = start.getMonth()

  // Group events by date string
  const eventsByDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    let dateStr: string
    if (e.allDay) {
      // all-day events: use the start of the range as the date
      // The API returns the date in the `start.date` field, which we stored as startTime=null
      // We'll group by checking which days fall in range — for simplicity, we check htmlLink date or default to start
      dateStr = start.toISOString().slice(0, 10)
    } else if (e.startTime) {
      dateStr = e.startTime.slice(0, 10)
    } else {
      continue
    }
    if (!eventsByDate.has(dateStr)) eventsByDate.set(dateStr, [])
    eventsByDate.get(dateStr)!.push(e)
  }

  // Day-of-week headers
  const headerGrid = document.createElement("div")
  headerGrid.className = "grid grid-cols-7 pt-2 pb-1"
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const h = document.createElement("div")
    h.className = "text-center text-[10px] uppercase tracking-wider text-muted"
    h.textContent = day
    headerGrid.appendChild(h)
  }
  container.appendChild(headerGrid)

  // Calendar grid
  const grid = document.createElement("div")
  grid.className = "grid grid-cols-7"

  const firstDayOfWeek = start.getDay()
  const blanksBefore = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000)

  // Leading blanks
  for (let i = 0; i < blanksBefore; i++) {
    const blank = document.createElement("div")
    blank.className = "p-1 min-h-[48px]"
    grid.appendChild(blank)
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d)
    const dateStr = cellDate.toISOString().slice(0, 10)
    const isToday = dateStr === todayStr
    const dayEvents = eventsByDate.get(dateStr) ?? []

    const cell = document.createElement("div")
    cell.className = "p-1 min-h-[48px] text-center rounded-theme"

    if (isToday) {
      cell.classList.add("bg-accent/10")
    }

    const dateNum = document.createElement("div")
    dateNum.className = isToday
      ? "text-xs font-semibold text-accent"
      : "text-xs text-muted"
    dateNum.textContent = String(d)
    cell.appendChild(dateNum)

    if (dayEvents.length > 0) {
      const dotsRow = document.createElement("div")
      dotsRow.className = "flex gap-0.5 justify-center mt-1 flex-wrap"
      for (const e of dayEvents.slice(0, 5)) {
        const dot = document.createElement("div")
        dot.className = "w-1.5 h-1.5 rounded-full"
        dot.style.backgroundColor = e.color
        dotsRow.appendChild(dot)
      }
      cell.appendChild(dotsRow)

      cell.classList.add("cursor-pointer", "hover:bg-surface/50", "transition-colors")
      cell.addEventListener("click", () => {
        if (dayEvents.length === 1) {
          showEventDetail(cell, dayEvents[0])
        } else {
          showDayEventList(cell, cellDate, dayEvents)
        }
      })
    }

    grid.appendChild(cell)
  }

  // Trailing blanks
  const totalCells = blanksBefore + daysInMonth
  const remainder = totalCells % 7
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      const blank = document.createElement("div")
      blank.className = "p-1 min-h-[48px]"
      grid.appendChild(blank)
    }
  }

  container.appendChild(grid)
  return container
}
```

- [ ] **Step 2: Add the day event list popover (for multi-event cells)**

```ts
function showDayEventList(anchor: HTMLElement, date: Date, events: CalendarEvent[]): void {
  const content = document.createElement("div")
  content.className = "flex flex-col min-w-[240px] max-w-[300px]"

  const dateLabel = date.toLocaleDateString("en-US", { month: "long" }) + " " + ordinal(date.getDate())

  const header = document.createElement("div")
  header.className = "pb-2 mb-1 border-b border-input-border/20"
  const headerTitle = document.createElement("div")
  headerTitle.className = "text-sm font-semibold text-popover-foreground"
  headerTitle.textContent = dateLabel
  const headerSub = document.createElement("div")
  headerSub.className = "text-[11px] text-muted"
  headerSub.textContent = events.length + " event" + (events.length !== 1 ? "s" : "")
  header.appendChild(headerTitle)
  header.appendChild(headerSub)
  content.appendChild(header)

  const list = document.createElement("div")
  list.className = "flex flex-col gap-0.5"

  for (const event of events) {
    const item = document.createElement("div")
    item.className = "flex items-center gap-2 p-2 rounded-theme cursor-pointer hover:bg-popover-foreground/5 transition-colors"

    const dot = document.createElement("div")
    dot.className = "w-2 h-2 rounded-full shrink-0"
    dot.style.backgroundColor = event.color
    item.appendChild(dot)

    const info = document.createElement("div")
    info.className = "flex-1 min-w-0"
    const title = document.createElement("div")
    title.className = "text-xs text-popover-foreground truncate"
    title.textContent = event.title
    info.appendChild(title)
    const time = document.createElement("div")
    time.className = "text-[11px] text-muted"
    time.textContent = formatTimeRange(event)
    info.appendChild(time)
    item.appendChild(info)

    item.addEventListener("click", () => {
      listPopover.close()
      showEventDetail(anchor, event, {
        backLabel: dateLabel,
        onBack: () => showDayEventList(anchor, date, events),
      })
    })

    list.appendChild(item)
  }

  content.appendChild(list)
  const listPopover = createPopover(anchor, content)
}
```

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): month view renderer with dot indicators and day drill-down"
```

---

### Task 9: Main popover orchestration and trigger update

**Files:**
- Modify: `src/calendar.ts`

- [ ] **Step 1: Rewrite renderTrigger**

Replace the existing `renderTrigger` function. The trigger always shows today's events regardless of current view/offset:

```ts
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

  const count = currentEvents.length
  const label = count === 1 ? "1 event today" : `${count} events today`
  trigger.innerHTML = ""
  trigger.appendChild(icon("calendar", { size: 24 }))
  const evtLabel = document.createElement("span")
  evtLabel.className = "text-sm"
  evtLabel.textContent = label
  trigger.appendChild(evtLabel)
}
```

- [ ] **Step 2: Add the main calendar popover**

Replace the existing `showCalendarPopover` and `closePopover` functions:

```ts
function closeCalendarPopover(): void {
  if (calendarPopoverClose) {
    calendarPopoverClose()
    calendarPopoverClose = null
  }
}

function showCalendarPopover(anchor: HTMLElement): void {
  closeCalendarPopover()
  viewMode = "1d"
  offset = 0

  const content = document.createElement("div")
  content.className = "flex flex-col gap-0"
  content.style.width = "660px"

  function rebuild() {
    content.innerHTML = ""

    const controls = renderControls(() => {
      fetchEvents().then(rebuild)
    })
    content.appendChild(controls)

    let view: HTMLElement
    if (viewMode === "1d") {
      view = renderDayView(currentEvents)
    } else if (viewMode === "1w") {
      view = renderWeekView(currentEvents)
    } else {
      view = renderMonthView(currentEvents)
    }
    content.appendChild(view)
  }

  rebuild()

  const { close } = createPopover(anchor, content, {
    onClose: () => {
      calendarPopoverClose = null
    },
  })
  calendarPopoverClose = close
}
```

- [ ] **Step 3: Rewrite initCalendar**

Replace the existing `initCalendar` function, keeping the same export signature:

```ts
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
```

- [ ] **Step 4: Update disconnect to clear all calendar caches**

Replace the existing `disconnect` function:

```ts
export async function disconnect(): Promise<void> {
  const api = getApi()
  if (api?.identity?.removeCachedAuthToken) {
    const token = await getToken(false)
    if (token) {
      try {
        await api.identity.removeCachedAuthToken({ token })
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
      } catch { /* */ }
    }
  }

  store.local.set("calendarConnected", false)
  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.startsWith("sp:calendar:")) localStorage.removeItem(key)
    }
  } catch { /* */ }
}
```

- [ ] **Step 5: Remove dead code**

Delete any remaining old functions that are no longer referenced: the old `showCalendarPopover`, `closePopover`, `openPopover` variable, `getCachedEvents` (old version), `setCachedEvents` (old version), `fetchTodayEvents`.

- [ ] **Step 6: Build and test**

Run: `./build.sh`
Expected: Clean build, no type errors, no unused variables.

- [ ] **Step 7: Commit**

```bash
git add src/calendar.ts
git commit -m "feat(calendar): main popover orchestration with view switching and navigation"
```

---

### Task 10: Fix all-day event grouping in views

**Files:**
- Modify: `src/calendar.ts`

The `allDayDate` field is already in the type (Task 1) and populated during fetch (Task 3). Now fix the view renderers to use it for grouping/filtering instead of `startTime`.

- [ ] **Step 1: Fix month view event grouping**

In `renderMonthView`, replace the event grouping logic:

```ts
const eventsByDate = new Map<string, CalendarEvent[]>()
for (const e of events) {
  let dateStr: string
  if (e.allDay && e.allDayDate) {
    dateStr = e.allDayDate
  } else if (e.startTime) {
    dateStr = e.startTime.slice(0, 10)
  } else {
    continue
  }
  if (!eventsByDate.has(dateStr)) eventsByDate.set(dateStr, [])
  eventsByDate.get(dateStr)!.push(e)
}
```

- [ ] **Step 2: Fix week view all-day event filtering**

In `renderWeekView`, update the day event filtering to use `allDayDate`:

```ts
const dayEvents = events.filter(e => {
  if (e.allDay) {
    return e.allDayDate === dateStr
  }
  if (!e.startTime) return false
  return e.startTime.slice(0, 10) === dateStr
})
```

Remove the redundant second filter that was a no-op.

- [ ] **Step 3: Build and test**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/calendar.ts
git commit -m "fix(calendar): all-day event date grouping in week and month views"
```

---

### Task 11: Manual testing and polish

**Files:**
- Modify: `src/calendar.ts` (minor tweaks only)

- [ ] **Step 1: Build the extension**

Run: `./build.sh`

- [ ] **Step 2: Load in browser and test**

Load the extension in Chrome/Firefox:
- Open the new tab page
- Click the calendar trigger button
- Verify: popover opens with 1D view, showing today's events
- Switch to 1W view — verify 7 columns with colored bars, today highlighted
- Switch to 1M view — verify full month grid with dots, today highlighted
- Navigate forward/back in each view — verify labels change correctly
- Verify navigation stops at limits (arrows dim at boundaries)
- Click an event card in 1D — verify detail popover opens
- Click a bar in 1W — verify detail popover opens
- Click a multi-event day in 1M — verify list popover opens, clicking item shows detail with back button
- Click a single-event day in 1M — verify detail opens directly
- Verify "Open in Google Calendar" link works
- Verify event colors match Google Calendar colors

- [ ] **Step 3: Fix any issues found during testing**

Address any visual or functional issues.

- [ ] **Step 4: Final commit**

```bash
git add src/calendar.ts
git commit -m "polish(calendar): visual tweaks from manual testing"
```
