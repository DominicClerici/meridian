# Calendar

**Files:** `src/calendar.ts` (2139 lines), `src/google-auth.ts` (418 lines). **Trigger:** `#calendar-trigger`. **API:** Google Calendar v3. **Auth:** OAuth2, brokered or redirect — see [browser-compat.md](browser-compat.md#google-sign-in).

The largest widget, and the only one with multiple views (`1d` and `1w`). Follows the trigger/popover pattern in [widgets.md](widgets.md).

## Auth

Auth lives in `google-auth.ts`, not here. It presents one interface —
`authenticate(feature)`, `getValidToken(feature)`, `invalidateToken()`,
`releaseGoogle()` — over two mechanisms, because `identity.getAuthToken` does
not work on every Chromium.

**The account is shared with the mail widget**, and every call is scoped to a
feature: the token is issued for the union of the *connected* features' scopes,
so the calendar's consent screen never mentions Gmail. See
[mail.md](mail.md#the-shared-google-account).

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

- `authenticate()` — delegates to `google-auth` as the `calendar` feature, then
  sets `calendarConnected`.
- `disconnect()` — clears `calendarConnected` **first**, then `releaseGoogle()`,
  then deletes every `sp:calendar:*` localStorage key by prefix scan. The order
  matters: `releaseGoogle()` reads the flag back to decide whether the shared
  token still has a user, and only revokes once nothing is left. Revoking
  unconditionally here would sign the mail widget out of the same account.

**401 recovery**: if the calendar-list or colors call fails with a 401, the cached list, list timestamp, and color map are dropped, `invalidateToken()` clears the token (removing it from the browser's cache too, on the brokered path), a fresh one is fetched silently via `getValidToken()`, and both calls are retried once. Failing that, the widget drops to `not-connected`.

## Fetching

**The unit of fetching is a week.** Nothing asks for "the range the view wants" — both views read out of a Sunday-to-Sunday block of events, and a day is always inside a week we already hold. That is what makes every navigation instant: switching `1W` → `1D` is a filter over data in hand, and stepping a day or a week lands on a week the prefetch brought in.

`fetchWeek(key)` fans out — Google's API has no cross-calendar events endpoint, so it fetches each calendar separately:

1. `getFetchContext()` → a token, the calendar list, and the colour map, as one shared promise so parallel week fetches ask for them once.
   - `GET /users/me/calendarList` → every calendar with `selected !== false`, cached **1 hour**.
   - `GET /colors` → Google's color-ID → hex map, cached indefinitely.
2. For each calendar, `GET /calendars/{id}/events?timeMin&timeMax&singleEvents=true&orderBy=startTime`, **all in parallel** — a week costs one round trip, not N. A failed calendar is skipped rather than failing the batch.
3. Normalize into `CalendarEvent`, dropping `status === "cancelled"`.
4. Sort: all-day first, then by start time.

A batch where **every** calendar request failed throws rather than committing an
empty result. Without that, one bad refresh cached "no events" for the week and
served it for the next five minutes.

**Event color** is the per-event `colorId` resolved through the color map, falling back to the calendar's own `backgroundColor`.

**All-day vs timed** is decided by which field Google populates: `start.date` (all-day, stored as `allDayDate`) or `start.dateTime` (timed, stored as `startTime`).

Because Google returns everything that *overlaps* the window, an event crossing a week boundary comes back in both weeks — so a Saturday-night-into-Sunday event is drawn on both days without either week knowing about the other.

### The week cache

| Key | TTL |
|---|---|
| `sp:calendar:calendarList` + `…ListTs` | 1 hour |
| `sp:calendar:colors` | Indefinite |
| `sp:calendar:week:<sunday>` | 5 minutes (`WEEK_TTL`), keyed by the local date of its Sunday |

Three layers, in order: the `weeks` map in memory, `localStorage` under
`sp:calendar:week:`, then Google. `getWeek()` reads memory and hydrates from
`localStorage` on the first miss — a miss is recorded in `weekHydrated` so
`draw()`, which asks on every render, doesn't re-parse for it every time. The
localStorage layer is what makes the cache survive a reload and reach a second
new tab; it is read synchronously, so a warm week paints with no async gap at
all.

`requestWeek(key)` is the only way a fetch starts, and it **never blocks a
render**. Callers fire and forget; the redraw arrives from
`notifyDataChanged()` when the week lands. That is deliberate — `draw()` calls
it on every render, and a version that resolved into a redraw would spin a
permanently failing week into a microtask loop that hangs the page. It also
re-reads `localStorage` whenever what it holds is missing or stale, so a week
another tab fetched a moment ago is adopted instead of fetched again.

A stale week is **served, then refreshed underneath** — you see events
immediately and they update in place. A failed week is recorded in
`weekFailedAt` and not retried for 20s (`FETCH_RETRY_COOLDOWN`), which is the
other half of the loop bound; the view shows "Couldn't reach Google Calendar."
with a Retry that bypasses the cooldown.

`pruneWeekCache()` runs on init and on a quota error, dropping weeks outside
±3 and the pre-week `sp:calendar:events:` / `sp:calendar:lastFetch` keys.

### Prefetching

`refreshCalendar()` asks for the **visible week alone**, then its neighbours as
soon as that lands — the week you are looking at is never queued behind a
prefetch.

The prefetch set (`prefetchKeys()`) is always weeks −1, 0 and +1, plus the
weeks either side of the visible one, bounded by ±2. That set is exactly what
the navigation limits are built on:

| View | Range | Where the data comes from |
|---|---|---|
| `1d` | ±7 days | Weeks −1/0/+1 — a day within ±7 of today never leaves them, so **the day view never fetches** |
| `1w` | ±2 weeks | Week ±1 is prefetched on load; stepping onto it prefetches ±2 behind the render |

Only the visible week is **revalidated** on the 5-minute tick. A neighbour we
already hold is left alone however stale it has gone — navigating to it renders
that copy instantly and refreshes it behind the view, which is the whole point
of holding it. Refreshing all five every five minutes would be five times the
requests for weeks nobody is looking at.

The count on the trigger is derived, not recorded: `countEventsToday()` filters
today out of week 0 on every render, so browsing other days can't corrupt it.

### Skeletons

Navigation is never gated on the network, so a step that outruns the prefetch —
a cold start, a failed background fetch, week ±2 on a slow connection — has to
show *something*. `renderSkeleton(width)` draws the view's own shape at the
metrics the real one will use: the day view's *Next up* card, gutter ticks and
block bars; the week view's real header row (day names and dates need no data),
today's tint, the seven columns and dividers, and placeholder blocks. Both
pulse. The controls stay live throughout — you can keep stepping, and each
week snaps in as it arrives.

## Views

`buildCalendarBody()` returns a controls header plus one of two views, and a
`rebuild` closure. The immersive popover pins it to 660px; the card in the other
layouts fills its column. `viewMode` and `offset` are module-level, and reset to
`1d` / `0` every time the popover opens or the card mounts — which is why data
refreshes call the body's own `rebuild()` rather than `refreshCard`, so a
background fetch doesn't throw away the view the user navigated to. See
[layouts.md](layouts.md#keeping-a-card-current).

`draw()` renders whatever week the controls point at out of the cache and asks
for that week without waiting on it — a skeleton stands in until it lands. Every
redraw after a change in the data comes through one coalesced
`notifyDataChanged()`, because a fetch landing, a state change and a cross-tab
adoption can all fire in the same tick and each host rebuild is a full
re-render.

**Everything is sized from the host's measured width, never the viewport**, the
same way the weather body works ([weather.md](weather.md#the-body)). A
`ResizeObserver` on the body root feeds `draw()`, which re-renders the view at
that width; `dayMetrics(width)` and `weekMetrics(width)` are the single place
every font size, gutter width, pixels-per-minute and max height is decided.
A body is built at a placeholder 320px and corrected on the first frame.

**Controls** (`renderControls`): one row — a `1D / 1W` segmented control on the
left, prev/label/next navigation on the right. `getNavLabel()` produces
"Today"/"Yesterday"/"Tomorrow", "This Week"/"Last Week"/"Next Week", or a
formatted date or range. Navigation is bounded by `NAV_LIMITS` — ±7 days,
±2 weeks — with the arrows dimmed at the edge. Both bounds are set by what the
prefetch holds, not by taste; see [Prefetching](#prefetching). Changing view or
offset **rebuilds first and asks for data second**, so the click is never
waiting on the network.

**Switching view keeps the period you were looking at.** `switchView()` maps a
day onto the week containing it, and a week onto today when today is inside it,
otherwise its first day. A week further out than ±7 days has no day inside the
day view's bound, so `1W` at ±2 lands on the nearest day the day view can
reach — the one case where the mapping is a clamp rather than the same period.

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

`buildTimeMap(spans, opts, anchor)` turns a set of busy intervals (minutes past
local midnight) into a piecewise-linear **minutes → pixels** function:

1. The domain runs from the earliest start to the latest end, **widened to cover
   `anchor`** — so the empty stretch beyond it is never drawn, but the axis still
   has a fixed frame of reference.
2. The domain is sliced at every event boundary. A slice covered by an event is
   `duration × pxPerMin` tall — **every event is scaled to its duration**. A
   slice covered by nothing is a gap, compressed onto a sqrt curve:
   `gapMin + (gapMax - gapMin) × √(duration / gapFull)`.
3. Slices are grown until every span clears `minEventHeight`, so the shortest
   event of the day still has room for one line of its title. Growth is
   distributed across the slices an event spans, proportionally to their
   duration, and only ever adds height — so the relaxation converges. Six passes
   is the cap; no realistic day needs two.
4. If the axis is still shorter than `minTotal`, the shortfall is distributed
   across the **gaps only**, proportionally to duration. Step 3 touches only
   busy slices and step 4 only empty ones, so the two never fight.

The day view feeds it one day's events. The **week view feeds it all seven days
at once**, which is what makes 9am on Sunday sit at the same y as 9am on Friday.

### Keeping your bearings

Steps 1 and 4 exist because the axis used to carry no absolute information. The
domain was whatever the events happened to span, so a lone 2pm event filled the
timeline top to bottom and read exactly like a lone 8am one, 18px tall in a
210px slot.

`coreAnchor(isToday)` supplies the frame: **08:00–18:00**, extended to include
`now` when the view contains today (which also stops `renderNowLine` clamping to
an edge at 7am or 11pm). It is passed separately from `opts` and deliberately
**does not join `spans`** — it is a reference frame, not something to draw or to
relax around, so it shapes the domain and the slice bounds and nothing else.

The gap curve replaced a flat `clamp(gapMin, duration × pxPerMin × gapScale, gapMax)`,
which saturated almost immediately — in the week view every gap under 4.4h was
exactly `gapMin` and everything over 8.9h exactly `gapMax`, collapsing most of a
day's shape into two values. The sqrt keeps every gap distinguishable (15m →
9.4px, 2h → 12px, 6h → 14.9px) while still bounding the tallest, and it drops
`pxPerMin` from the formula: a gap's job is to say *time passed*, not to be to
scale.

`minTotal` is `maxHeight × MIN_TOTAL_RATIO` (0.55) — enough to read, never enough
to force a scroll. Because the shortfall goes to gaps, **events stay honestly
scaled to their duration** and compression only engages when it is actually
needed: a sparse day gets near-linear gaps because there is room for them, while
a packed day is already past the floor and keeps the curve. The reported case,
one 2pm–3pm event in a 420px week card, now renders a 61px "6h" gap, the 18px
event, and a 36px "3h" gap — the block sits 53% down instead of filling the
axis.

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
| `attachScrubber` | The hover scrubline — see below. |

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

### Hover: the scrubline and the event card

`attachScrubber(scroll, inner, map, m)` draws a hairline across the **full**
timeline at the pointer — the whole week in `1w`, the whole column in `1d` —
with a pill at the left edge reading the time under it. In the day view the pill
sits in the gutter; the week view has none, so it overlays the first column.

The readout comes from **`map.minAt(px)`**, the inverse of `map.y(min)` added
alongside it: it walks the same slices and interpolates back, so the time is
honest on an axis that is deliberately not linear. It returns the slice's `busy`
flag too, and the whole group drops to 0.45 opacity over a gap — a few pixels
there sweep hours, and the line should not claim to track the pointer at the
same rate everywhere.

Two things keep it feeling right. Position is written straight to `top` with
**no transition**, because a line that eases toward the cursor reads as broken;
the 150ms `transition-opacity` is what carries the show, hide, and gap-dim. And
paints are `requestAnimationFrame`-coalesced, so a fast sweep costs one layout
read per frame rather than one per event. Scrolling repaints too — content
moving under a stationary pointer changes the time it is over. The readout snaps
to 5 minutes; at these scales the pixel is not more precise than that, and an
exact-minute label jitters every frame.

**Event detail** — colour dot, title, time range, location, calendar name, and a
link to Google Calendar — is now **hover-driven, not click-driven**.
`attachEventHover(el, event)` wires it onto every block, all-day chip, and the
*Next up* card; nothing in the calendar opens it on click any more (todo chips
are the exception, and still click through to `showTodoPopover`).

The card is a module-level singleton on `document.body`, deliberately **not** a
`createPopover`:

- It has to outlive the element it describes. A resize or a fetch rebuilds the
  whole timeline underneath it.
- It must not join the popover stack, which dismisses on outside click and
  would fight the calendar's own popover.

`HOVER_IN` (90ms) stops it strobing as the pointer sweeps a dense day.
`HOVER_OUT` (160ms), cancelled by the card's own `mouseenter`, leaves a grace
period wide enough to cross the gap and click the Google Calendar link.
`placeHoverCard` puts it beside the block, flips to the other side when it would
run off, and clamps into the viewport.

Because the position is taken from a rect read once, anything that moves the
block out from under it retires the card: `window` scroll (capture) and resize,
`retire()` on a disposed body, and the top of `draw()` — **an element removed
from under the pointer fires no `mouseleave`**, so without that last one the
card would sit there anchored to nothing.

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
`liveBodies` — which is also the list `notifyDataChanged()` redraws, so a body
only has to exist to stay current rather than having to register itself with
the fetch layer by name. Both hosts dispose explicitly — the popover from `onClose`, the
card from `onUnmount` — and the ticker is the backstop, retiring an entry that
it finds detached. The `mounted` flag exists because a body is legitimately
disconnected between being built and its host inserting it; retiring on
disconnection alone would kill a body that had not been mounted yet.

## Refactor candidates

- **One file, ~2130 lines, six responsibilities:** OAuth, fetching, the week cache and its prefetch, the timeline engine, the skeletons, and the two views built on all of it. The timeline half is self-contained and pure enough to move to its own module; the cache half is the other obvious seam.
- **Still one request per calendar.** They go out in parallel now, but ten calendars is still ten requests per week, and a cold start asks for three weeks. `syncToken` incremental sync would turn the five-minute refresh into a delta.
- **The color map is cached forever** with no TTL and no invalidation except disconnect.
- **`viewMode` and `offset` are module-level globals** mutated from button handlers, which is why the popover has to reset them on open.
- **No calendar filtering.** Every `selected` calendar is fetched and every event is shown; holidays and shared calendars can't be turned off. (`notes.md` lists this as a wanted feature.)
- **All-day events are bucketed by start date only**, so a multi-day all-day event shows only on the day it starts. Timed events are clipped per day and no longer have this problem.
- **`renderTrigger` hides the button entirely when `not-connected`**, so in the Immersive layout a user who enabled the widget but hasn't signed in sees nothing at all and no path to connect except finding it in settings. The card form doesn't have this problem: `buildCalendarBody()` draws `buildConnectPanel()` — a sign-in button inline, the same shape as the GitHub, Linear and Mail cards — until `calendarConnected` flips.
- **Todo chips only ever appear.** A due date can be read off the calendar but not set from it — dropping a todo on a day is the obvious gesture and does nothing.
- **The 401 retry path still spells the same two calls twice**, once either side of `invalidateToken()` in `loadFetchContext()`.
