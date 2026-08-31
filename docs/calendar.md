# Calendar

**Files:** `src/calendar.ts` (1465 lines), `src/google-auth.ts` (314 lines). **Trigger:** `#calendar-trigger`. **API:** Google Calendar v3. **Auth:** OAuth2, brokered or redirect — see [browser-compat.md](browser-compat.md#google-sign-in).

The largest widget, and the only one with multiple views (`1d` and `1w`). Follows the trigger/popover pattern in [widgets.md](widgets.md).

## Auth

Auth lives in `google-auth.ts`, not here. It presents one interface —
`authenticate()`, `getValidToken()`, `invalidateToken()`, `revoke()` — over two
mechanisms, because `identity.getAuthToken` does not work on every Chromium.

- **Brokered** (`getAuthToken`): zero setup, uses the browser profile's
  signed-in Google account and the `oauth2` block in `manifest.json`. Preferred
  where it works. Every call is raced against a clock, because on builds with
  Google sign-in removed it hangs rather than failing.
- **Redirect** (`launchWebAuthFlow`, implicit): works anywhere, needs the user's
  own OAuth client ID in the `googleClientId` setting.

`authenticate()` probes the broker, uses it when it answers, and falls back to
the redirect flow only when the broker is *silent* — a declined consent is
returned as-is rather than triggering a second window. The full rationale,
including why implicit rather than PKCE, is in
[browser-compat.md](browser-compat.md#google-sign-in).

Either way the resulting token lands in `googleAccessToken` / `googleTokenExpiry`,
so this module reads one shape. `calendar.ts` itself only tracks the
`calendarConnected` boolean in `store.local`.

The `key` field in `manifest.json` pins the extension ID, which is what makes
the redirect URI stable across installs. **Forking this requires your own Google
OAuth client** either way — the shipped `client_id` is bound to this extension's
ID.

- `authenticate()` — delegates to `google-auth`, then sets `calendarConnected`.
- `disconnect()` — `revoke()` (drops the cached token, hits Google's revoke
  endpoint, clears the method), then clears the flag and deletes every
  `sp:calendar:*` localStorage key by prefix scan.

**401 recovery**: if the calendar-list or colors call fails with a 401, the cached list, list timestamp, and color map are dropped, `invalidateToken()` clears the token (removing it from the browser's cache too, on the brokered path), a fresh one is fetched silently via `getValidToken()`, and both calls are retried once. Failing that, the widget drops to `not-connected`.

## Fetching

`fetchEvents()` fans out — Google's API has no cross-calendar events endpoint, so it fetches each calendar separately:

1. `GET /users/me/calendarList` → every calendar with `selected !== false`, cached **1 hour**.
2. `GET /colors` → Google's color-ID → hex map, cached indefinitely.
3. For each calendar, `GET /calendars/{id}/events?timeMin&timeMax&singleEvents=true&orderBy=startTime`. A failed calendar is skipped rather than failing the batch.
4. Normalize into `CalendarEvent`, dropping `status === "cancelled"`.
5. Sort: all-day first, then by start time.

**Event color** is the per-event `colorId` resolved through the color map, falling back to the calendar's own `backgroundColor`.

**All-day vs timed** is decided by which field Google populates: `start.date` (all-day, stored as `allDayDate`) or `start.dateTime` (timed, stored as `startTime`).

### Caching

| Key | TTL |
|---|---|
| `sp:calendar:calendarList` + `…ListTs` | 1 hour |
| `sp:calendar:colors` | Indefinite |
| `sp:calendar:events:<start>_<end>` | 5 minutes, keyed by local date range (`rangeKey`) |
| `sp:calendar:lastFetch` | 10s cooldown |

Because the events cache is keyed by range, navigating back to a range you've already viewed is instant. Cached events render immediately while a refresh runs behind them, and a failed fetch keeps the cached copy rather than erroring.

A batch where **every** calendar request failed throws rather than committing an
empty result. Without that, one bad refresh cached "no events" for the range and
served it for the next five minutes.

`fetchEvents()` shares one in-flight promise. A second caller awaits the running
fetch instead of getting an instant no-op — which matters because the views call
it themselves (below) and then act on the result.

`todayEventCount` — the number shown on the trigger — is only updated when a fetch runs in `1d` view at `offset === 0`, so browsing other days doesn't corrupt the badge.

### Which range the data is for

`currentEvents` is module state, written by whichever fetch ran last, while
`viewMode` and `offset` reset to `1d` / today on **every** mount. Those two facts
disagree: navigate the day view to tomorrow, close the popover, reopen it, and
the view is asking for today while the data in hand is tomorrow's.

`currentRangeKey` records the range `currentEvents` was fetched for, and `draw()`
refuses to render a range it doesn't cover — it shows "Loading…", asks for the
right range, and redraws when it arrives. Each body auto-requests a given range
**once**; if the fetch comes back still not covering it, the body settles on
"Couldn't reach Google Calendar." rather than asking again. Without that bound,
a failing fetch and a redraw-on-completion feed each other into a microtask loop
that never yields, which hangs the page rather than merely showing stale data.

Both hosts also kick a fetch on mount, so opening the widget shows the current
day rather than whatever the last background refresh happened to ask for.

This mattered less before the views filtered by date: the old day view rendered
every timed event in `currentEvents` regardless of which day it belonged to, so
a range mismatch showed the *wrong* day's events instead of an empty one.

## Views

`buildCalendarBody()` returns a controls header plus one of two views, and a
`rebuild` closure. The immersive popover pins it to 660px; the card in the other
layouts fills its column. `viewMode` and `offset` are module-level, and reset to
`1d` / `0` every time the popover opens or the card mounts — which is why data
refreshes call the held `cardBody.rebuild()` rather than `refreshCard`, so a
background fetch doesn't throw away the view the user navigated to. See
[layouts.md](layouts.md#keeping-a-card-current).

**Everything is sized from the host's measured width, never the viewport**, the
same way the weather body works ([weather.md](weather.md#the-body)). A
`ResizeObserver` on the body root feeds `draw()`, which re-renders the view at
that width; `dayMetrics(width)` and `weekMetrics(width)` are the single place
every font size, gutter width, pixels-per-minute and max height is decided.
A body is built at a placeholder 320px and corrected on the first frame.

**Controls** (`renderControls`): one row — a `1D / 1W` segmented control on the
left, prev/label/next navigation on the right. `getNavLabel()` produces
"Today"/"Yesterday"/"Tomorrow", "This Week"/"Last Week"/"Next Week", or a
formatted date or range. Navigation is bounded by `NAV_LIMITS` — ±6 days,
±3 weeks — with the arrows dimmed at the edge. Changing view or offset
refetches, then rebuilds.

### Todo chips

Both views also draw todos. A todo carries a bare `dueDate`, so a day the
calendar is already drawing is a day the todo widget has an answer for:
`todosDueOn(dateStr)` pulls the open ones through `getDueOn()` in `todos.ts`,
gated on `todoEnabled`, and `todoChip()` renders them accent-tinted with a
check-circle glyph (a pin, when pinned) so they read as a different kind of
thing from an event.

- **Day view** puts them in their own `Due` strip under the all-day strip.
- **Week view** appends them to each day's all-day column, events first, capped
  at two chips with a `+n` beneath.

Clicking one opens `showTodoPopover()` from `todo.ts` — a compact card that can
check the todo off without leaving the calendar. A module-level
`store.local.subscribe("todos")` rebuilds the card body and the popover, so a
change made in the todo widget reaches the calendar the way a fetch does.

The dependency runs one way — `calendar.ts` imports `todo.ts`, never the
reverse. See [todos.md](todos.md#calendar-cross-link).

### The timeline

Both views draw the same thing, so both go through one engine.

`buildTimeMap(spans, opts)` turns a set of busy intervals (minutes past local
midnight) into a piecewise-linear **minutes → pixels** function:

1. The domain runs from the earliest start to the latest end, so the empty
   stretch before the first event and after the last one is **not drawn at all**.
2. The domain is sliced at every event boundary. A slice covered by an event is
   `duration × pxPerMin` tall — **every event is scaled to its duration**. A
   slice covered by nothing is a gap, squeezed to
   `clamp(gapMin, duration × pxPerMin × gapScale, gapMax)`.
3. Slices are then grown until every span clears `minEventHeight`, so the
   shortest event of the day still has room for one line of its title. Growth is
   distributed across the slices an event spans, proportionally to their
   duration, and only ever adds height — so the relaxation converges. Six passes
   is the cap; no realistic day needs two.

The day view feeds it one day's events. The **week view feeds it all seven days
at once**, which is what makes 9am on Monday sit at the same y as 9am on Friday.

`assignColumns()` groups events into clusters of mutually-overlapping blocks.
Every event in a cluster gets its own column, ordered by end time, so **the
latest-ending event sits furthest right**. A non-overlapping event is a cluster
of one and spans the full width.

Shared pieces, all driven by the same `Metrics`:

| Piece | What it draws |
|---|---|
| `renderGutter` | A time label per distinct event start, thinned so labels never collide. **Day view only** — dropped below 200px, and the week view sets `gutter: 0` and never calls it, so its seven columns span the full measured width. |
| `renderGapMarks` | A dashed rule across each compressed gap, labelled with the elided duration ("3h"), so the axis never *looks* linear when it isn't. Suppressed under 9px tall, unlabelled under 13px. |
| `renderBlock` | One event: a duration-tinted background with a 2px inset rail in the event colour. Text is sized to fit — the time line is dropped when the block is short, padding goes to 0 when it is shorter still, and blocks under 30px centre their single line instead of top-aligning. |
| `renderNowLine` | The current-time rule. Full-width and faint, with a solid accent segment and a dot over the day it belongs to. Clamped to the domain, so a "now" before the first event pins to the top. |

The now-line is repositioned by a 30s ticker rather than a re-render, and the
timeline scrolls itself so "now" is centred on first mount.

**Day (`1d`).** Top to bottom: the *Next up* card, an all-day chip strip, then
the timeline.

`renderNextUp` picks the first event whose **end** is still in the future, so an
event already underway counts — it reads "Happening now", carries a
`40m left` pill and a progress bar along the bottom of the card, where a later
event reads "Next up" and `in 25m`. Once the last event of the day has ended the
header and the card both stop rendering. It is only built when `offset === 0`;
other days have no "now" and so get neither the card nor the now-line.

**Week (`1w`).** The same timeline, compact, seven times over: a header row of
day names and dates with today in accent, an optional all-day chip row, then one
shared axis with seven day columns, faint dividers between them and a tint
behind today's. There is **no time gutter** — `dayWidth` is `width / 7`, and
every x offset (dividers, today tint, block hosts, the now-line) is measured
from the left edge of the body. Time is still readable per block (`renderBlock`
prints the start, and wider blocks the range) and the compressed gaps are still
labelled with the elided duration by `renderGapMarks`, which now spans the full
width.

**Event detail** (`showEventDetail`): colour dot, title, time range, location,
calendar name, and a link to Google Calendar. Reached by clicking any block,
chip, or the *Next up* card.

`getDateRange()` computes the fetch window from `viewMode` + `offset`. Week
ranges run Sunday–Saturday (`getDate() - getDay()`), so on a Monday today is the
second column. Both spans advance their end by date component rather than by
adding 24h in ms, which would drift an hour off local midnight across a DST
boundary and clip the last day of the range.

`localDateStr()` formats a `Date` as local `YYYY-MM-DD`, deliberately avoiding
`toISOString()` — which is UTC and would put late-evening events on the wrong
day. `blocksForDay()` clips each event to the day's midnight boundaries, so a
timed event spanning midnight now appears on **both** days rather than only the
one it started on.

### Body lifecycle

A built body owns a `ResizeObserver` and a 30s interval, tracked in
`liveBodies`. Both hosts dispose explicitly — the popover from `onClose`, the
card from `onUnmount` — and the ticker is the backstop, retiring an entry that
it finds detached. The `mounted` flag exists because a body is legitimately
disconnected between being built and its host inserting it; retiring on
disconnection alone would kill a body that had not been mounted yet.

## Refactor candidates

- **One file, ~1570 lines, five responsibilities:** OAuth, fetching, caching, the timeline engine, and the two views built on it. The timeline half is self-contained and pure enough to move to its own module.
- **N+1 requests per refresh.** Every fetch hits `/events` once per calendar, serially in a `for` loop with an `await` inside. Ten calendars means ten round trips, every five minutes, before the popover is even opened. `Promise.all` would at least parallelize them.
- **Every view refetches on navigation.** `renderControls`'s `onUpdate` calls `fetchEvents().then(rebuild)` even when the target range is already cached and fresh.
- **The color map is cached forever** with no TTL and no invalidation except disconnect.
- **`viewMode` and `offset` are module-level globals** mutated from button handlers, which is why the popover has to reset them on open.
- **No calendar filtering.** Every `selected` calendar is fetched and every event is shown; holidays and shared calendars can't be turned off. (`notes.md` lists this as a wanted feature.)
- **All-day events are bucketed by start date only**, so a multi-day all-day event shows only on the day it starts. Timed events are clipped per day and no longer have this problem.
- **`renderTrigger` hides the button entirely when `not-connected`**, so a user who enabled the widget but hasn't signed in sees nothing at all and no path to connect except finding it in settings.
- **Todo chips only ever appear.** A due date can be read off the calendar but not set from it — dropping a todo on a day is the obvious gesture and does nothing.
- **The 401 retry path is inline and duplicated**, nested three levels deep inside `fetchEvents`'s try block.
