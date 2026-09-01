import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { calendarSnapshot, searchCalendar } from "../../calendar"
import type { CalendarEvent } from "../../calendar"
import type { Candidate, QueryContext, SearchSource } from "../types"

function whenLabel(event: CalendarEvent): string {
  if (event.allDay) {
    return event.allDayDate ?? "all day"
  }
  if (!event.startTime) return ""
  const start = new Date(event.startTime)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start)
}

/** How near to now, so today's meeting outranks one three months out. */
function proximity(event: CalendarEvent): number {
  const at = event.startTime
    ? Date.parse(event.startTime)
    : event.allDayDate
      ? Date.parse(`${event.allDayDate}T12:00:00`)
      : NaN
  if (Number.isNaN(at)) return 0.4
  const days = Math.abs(at - Date.now()) / 86400000
  return Math.max(0, 1 - days / 60)
}

function candidate(event: CalendarEvent): Candidate {
  return {
    id: `calendar:${event.id}`,
    title: event.title || "(no title)",
    subtitle: event.location ?? event.calendarName,
    detail: whenLabel(event),
    haystack: [event.calendarName, event.location ?? ""],
    boost: proximity(event),
    icon: () => {
      const dot = document.createElement("span")
      dot.className = "shrink-0 w-3 h-3 rounded-[4px]"
      dot.style.background = event.color || "currentColor"
      return dot
    },
    copyValue: event.htmlLink,
    run: (mode) => navigate(event.htmlLink, "search", mode === "newTab" ? "newTab" : "default"),
    actions: [
      {
        id: "open",
        label: "Open in Calendar",
        glyph: "externalLink",
        run: () => navigate(event.htmlLink, "search"),
      },
      {
        id: "copy",
        label: "Copy link",
        glyph: "copy",
        run: () => navigator.clipboard?.writeText(event.htmlLink),
      },
    ],
  }
}

export const calendarSource: SearchSource = {
  id: "calendar",
  label: "Calendar",
  token: "cal",
  glyph: "calendar",
  weight: 1,
  limit: 3,
  scopedLimit: 20,
  debounce: 200,
  available: () => store.sync.get("calendarEnabled") && store.local.get("calendarConnected"),
  unavailable: () => ({
    message: store.sync.get("calendarEnabled")
      ? "Google Calendar isn't connected."
      : "The calendar widget is turned off.",
  }),
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (!ctx.scoped) return query ? calendarSnapshot().map(candidate) : []
    if (!query) return calendarSnapshot().map(candidate)

    return searchCalendar(query, ctx.signal)
      .then((events) => (ctx.signal.aborted ? [] : events.map(candidate)))
      .catch(() => calendarSnapshot().map(candidate))
  },
  idle(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" })
  },
}
