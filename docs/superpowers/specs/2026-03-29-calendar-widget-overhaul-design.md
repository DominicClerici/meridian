# Calendar Widget Overhaul

Replaces the basic "today's events" popover with a full multi-view calendar widget supporting day, week, and month views with navigation, all-calendar fetching, Google event colors, and nested event detail popovers.

## Decisions

- **Event colors:** Google's own colors from API (`colorId` / `backgroundColor`)
- **Calendars:** Fetch from all visible calendars via `calendarList` endpoint
- **Popover size:** Fixed ~700px wide, anchored to trigger, below-left
- **1D view:** Simple sorted event list, no timeline
- **All-day events:** Pinned to top section in all views
- **Architecture:** Single-file refactor of `calendar.ts`

## Data Layer

### CalendarEvent Type

Expanded from current implementation:

```ts
type CalendarEvent = {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  htmlLink: string
  calendarId: string
  calendarName: string
  color: string          // hex from Google's colorId or calendar backgroundColor
  location: string | null
  description: string | null
}
```

### CalendarInfo Type

```ts
type CalendarInfo = {
  id: string
  name: string
  backgroundColor: string
}
```

### API

**`fetchCalendarList(): Promise<CalendarInfo[]>`**
- Calls `GET https://www.googleapis.com/calendar/v3/users/me/calendarList`
- Filters to calendars where `selected === true` (visible in Google Calendar)
- Extracts `id`, `summary` (as name), `backgroundColor`
- Cached in localStorage (`sp:calendar:calendarList`) for 1 hour

**`fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]>`**
- For each calendar from `fetchCalendarList()`, calls `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` with `timeMin`, `timeMax`, `singleEvents=true`, `orderBy=startTime`
- Maps each event's `colorId` to a hex color using Google's event color definitions; falls back to the calendar's `backgroundColor`
- Merges all events, sorts by startTime (all-day events first)
- Returns unified `CalendarEvent[]`

**Google Calendar Color Resolution:**
- Events may have a `colorId` field (1-11) mapping to Google's predefined palette
- Fetch color definitions once via `GET https://www.googleapis.com/calendar/v3/colors` and cache indefinitely
- If event has no `colorId`, use the parent calendar's `backgroundColor`

### Caching Strategy

| Cache Key | TTL | Storage |
|-----------|-----|---------|
| `sp:calendar:calendarList` | 1 hour | localStorage |
| `sp:calendar:colors` | indefinite (until disconnect) | localStorage |
| `sp:calendar:events:{startISO}_{endISO}` | 5 minutes | localStorage |
| `sp:calendar:lastFetch` | — | localStorage (timestamp) |

**Behavior:**
- On popover open or view/nav change: serve cached data instantly, then background-refresh if cache age > 5 minutes
- 10-second cooldown between any API call (prevents burst from rapid navigation)
- On `disconnect()`: clear all `sp:calendar:*` keys from localStorage

### 401 Handling

Existing pattern preserved: on 401, remove cached auth token, get fresh token, retry once. If second attempt fails, mark as disconnected.

## State

```ts
let viewMode: "1d" | "1w" | "1m" = "1d"
let offset: number = 0  // 0 = current period
```

**Navigation limits:**
- 1D: offset -6 to +6 (6 days past/future)
- 1W: offset -3 to +3 (3 weeks past/future)
- 1M: offset -1 to +1 (1 month past/future)

Switching view mode resets offset to 0.

Arrow buttons are disabled (visually dimmed, no click handler) when at the limit.

### Date Range Calculation

Given `viewMode` and `offset`, compute the `startDate` and `endDate` for the API call:

- **1D:** `startDate` = today + offset days, `endDate` = startDate + 1 day
- **1W:** `startDate` = Monday of current week + (offset * 7 days), `endDate` = startDate + 7 days
- **1M:** `startDate` = 1st of current month + offset months, `endDate` = 1st of next month

## Navigation Labels

| View | Offset | Label |
|------|--------|-------|
| 1D | 0 | "Today" |
| 1D | -1 | "Yesterday" |
| 1D | +1 | "Tomorrow" |
| 1D | other | "March 25th" (month name + day with ordinal suffix, no year) |
| 1W | 0 | "This Week" |
| 1W | -1 | "Last Week" |
| 1W | +1 | "Next Week" |
| 1W | other | "Mar 16th – Mar 22nd" (abbreviated month + day ordinal for both endpoints) |
| 1M | 0 | Current month name (e.g. "March") |
| 1M | ±1 | Target month name (e.g. "February", "April") |

## Popover Structure

Replace the custom popover in `calendar.ts` with `createPopover()` from `components.ts`. The main calendar popover is opened when clicking the `#calendar-trigger` button.

**Popover container:** ~700px wide, uses `bg-popover text-popover-foreground rounded-theme` classes. Positioned below-left of anchor to avoid right-edge viewport overflow.

**Content rebuilding:** On every view mode or offset change, clear the popover content container and re-render. No DOM diffing — matches the todo widget pattern.

### Controls (always visible at top)

**Row 1 — View selector:**
Three buttons in a segmented group: `1D`, `1W`, `1M`. Active button uses `bg-accent text-accent-foreground`. Inactive buttons use `text-muted` with hover `bg-surface`. Group has `bg-surface/50 rounded-theme` wrapper.

**Row 2 — Navigation:**
Left arrow, center label, right arrow. Arrows use ghost button styling (`bg-surface` on hover). Arrows disabled at navigation limits (reduced opacity, no pointer events). Label uses `text-foreground font-semibold`.

Separator line below controls: `border-input-border/20`.

## Views

### 1D (Day View)

**All-day section** (only shown if all-day events exist):
- "ALL DAY" label: `text-muted text-[10px] uppercase tracking-wide`
- Each all-day event: card with colored left border (3px, event color), title, external link icon
- Separated from timed events by a divider line

**Timed events:**
- Sorted by start time ascending
- Each event card: `bg-popover-foreground/5 rounded-theme` with colored left border (3px)
- Left column (70px): start time + end time in `text-muted`
- Center: title (semibold) + location below (if present, in `text-muted`)
- Right: external link icon `↗`
- Clickable — opens event detail popover (nested `createPopover()`)

**Empty state:** Centered "No events" in `text-muted`.

### 1W (Week View)

**Day headers:**
- 7-column grid
- Each header: abbreviated day name (`text-muted uppercase text-[10px]`) + date number
- Today's column: accent-colored header text + subtle background highlight (`bg-accent/10`)

**Event columns:**
- 7-column grid below headers, min-height ~200px
- Each day column: vertical stack of colored bars with 3px gap
- Bar height proportional to event duration: 30min = 16px, 1hr = 28px, 1.5hr = 40px, 2hr+ = capped at 48px
- All-day events: thin 12px bar at top of column
- Bar color: event's Google color, `rounded-sm`, `opacity-85`
- Hover: `opacity-100`
- Clickable — opens event detail popover

### 1M (Month View)

**Day-of-week headers:**
- 7-column grid: Mon Tue Wed Thu Fri Sat Sun
- `text-muted uppercase text-[10px] tracking-wide`

**Calendar grid:**
- 7 columns × 5-6 rows depending on month
- Each cell: date number + row of colored dots below
- Dots: 6px circles, event's Google color, max ~5 per row (wrap if needed)
- Today's cell: `bg-accent/10 rounded-theme`, date number in accent color + bold
- Cells with events: `cursor-pointer`, hover `bg-surface/50`
- Cells without events: not clickable, no hover state
- Leading/trailing blank cells for days outside the month

**Cell click behavior:**
- **Multiple events:** Opens nested popover with day header ("March 29th" + event count), then list of events (color dot + title + time). Clicking an event in the list swaps popover content to event detail view with a "‹ March 29th" back breadcrumb.
- **Single event:** Opens event detail popover directly (no back breadcrumb).

## Event Detail Popover

Shared across all three views. Rendered as a nested `createPopover()`.

**Content:**
- Back breadcrumb (only when navigated from 1M multi-event list): "‹ March 29th" in `text-muted text-xs`, clickable to return to list
- Color dot (10px circle) + event title (semibold, 15px)
- Field rows: Time, Where (if location exists), Calendar name — label in `text-muted` (50px min-width), value in `text-popover-foreground/70`
- "Open in Google Calendar ↗" button: `bg-accent text-accent-foreground rounded-theme` full-width

## Trigger Button

Unchanged from current: `#calendar-trigger` in the top-right widgets area. Shows calendar icon + today's event count label (e.g. "3 events today"). The trigger always reflects today's events regardless of the popover's current view/offset — it serves as a quick glance at today, with the popover providing the full browsing experience.

## Theme Integration

All new UI uses design system tokens per APPEARANCE.md:

| Element | Token |
|---------|-------|
| Popover background | `bg-popover` |
| Popover text | `text-popover-foreground` |
| Active view button | `bg-accent text-accent-foreground` |
| Inactive view button | `text-muted` |
| Button hover | `bg-surface` |
| Today highlight | `bg-accent/10`, accent-colored text |
| Secondary text | `text-muted` |
| Borders/dividers | `border-input-border/20` |
| Border radius | `rounded-theme` |
| Event detail button | `bg-accent text-accent-foreground` |
| Event card hover | `bg-popover-foreground/5` |

**Exception:** Event colors come directly from Google's API and are applied as inline `style` attributes — these do not map to theme tokens.

## File Changes

| File | Change |
|------|--------|
| `src/calendar.ts` | Full rewrite: multi-calendar fetch, caching, 3 views, navigation, event detail popovers |
| `src/icons/modern.ts` | Add `chevronLeft` and `chevronRight` icons for navigation arrows |

No changes to `index.html`, `components.ts`, `store.ts`, `defaults.ts`, or `settings.ts`.
