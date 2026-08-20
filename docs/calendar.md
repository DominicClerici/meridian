# Calendar

**File:** `src/calendar.ts` (1033 lines). **Trigger:** `#calendar-trigger`. **API:** Google Calendar v3. **Auth:** OAuth2 via `chrome.identity.getAuthToken`.

The largest widget, and the only one with multiple views. Follows the trigger/popover pattern in [widgets.md](widgets.md).

## Auth

Unlike Spotify's PKCE flow, this uses Chrome's built-in `identity.getAuthToken`, which relies on the `oauth2` block in `manifest.json`:

```json
"oauth2": {
  "client_id": "…apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/calendar.readonly"]
}
```

Chrome brokers the token against the signed-in Chrome profile — there's no redirect flow and no token storage. The extension only tracks a `calendarConnected` boolean in `store.local`.

The `key` field in `manifest.json` pins the extension ID, which is what makes the OAuth client's registered redirect URI stable across installs. **Forking this requires your own Google OAuth client**, since the shipped `client_id` is bound to this extension's ID.

- `authenticate()` — `getToken(true)` (interactive), then set `calendarConnected`.
- `disconnect()` — `removeCachedAuthToken`, then hit Google's revoke endpoint, clear the flag, and delete every `sp:calendar:*` localStorage key by prefix scan.

**401 recovery** (`calendar.ts:254`): if the calendar-list or colors call fails with a 401, the cached list, list timestamp, and color map are dropped, the token is removed from Chrome's cache, a fresh non-interactive token is requested, and both calls are retried once. Failing that, the widget drops to `not-connected`.

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
| `sp:calendar:events:<start>_<end>` | 5 minutes, keyed by ISO date range |
| `sp:calendar:lastFetch` | 10s cooldown |

Because the events cache is keyed by range, navigating back to a range you've already viewed is instant. Cached events render immediately while a refresh runs behind them, and a failed fetch keeps the cached copy rather than erroring.

`todayEventCount` — the number shown on the trigger — is only updated when a fetch runs in `1d` view at `offset === 0`, so browsing other days doesn't corrupt the badge.

## Views

The popover is 660px wide: a controls header, then one of three views. `viewMode` and `offset` are module-level, and reset to `1d` / `0` every time the popover opens.

**Controls** (`renderControls`): a `1D / 1W / 1M` segmented control, and prev/label/next navigation. `getNavLabel()` produces "Today"/"Yesterday"/"Tomorrow", "This Week"/"Last Week"/"Next Week", or a formatted date/range/month. Navigation is bounded by `NAV_LIMITS` — ±6 days, ±3 weeks, ±1 month — with the arrows dimmed at the edge. Changing view or offset refetches, then rebuilds.

**Day (`1d`).** A vertical list, all-day events under an "All Day" heading first, then timed cards. Each card is a 3px left border in the event color, a time column, the title, and the location. Clicking opens the event detail popover.

**Week (`1w`).** Seven columns, Monday-first, today's column tinted and its header in accent. Each event is a colored bar whose height encodes duration — `duration/60 * 28`px, clamped to 16–48px — with a native `title` tooltip. All-day bars are a fixed 12px.

**Month (`1m`).** A Monday-first grid with leading and trailing blanks. Each day cell shows the date and up to five colored dots. Clicking a day with one event opens its detail; with several, it opens a day list popover that can drill into an event detail and come **back** via a back button that reopens the list.

**Event detail** (`showEventDetail`): color dot, title, time range, location, calendar name, and a link to Google Calendar.

`getDateRange()` computes the fetch window from `viewMode` + `offset`. Week ranges start Monday (`day === 0 ? -6 : 1 - day`); month ranges are the first of the month to the first of the next.

`localDateStr()` formats a `Date` as local `YYYY-MM-DD`, deliberately avoiding `toISOString()` — which is UTC and would put late-evening events on the wrong day.

## Refactor candidates

- **One file, 1033 lines, six responsibilities:** OAuth, fetching, caching, three view renderers, and two popover flows. The three views alone are ~290 lines and share nothing but the event type.
- **N+1 requests per refresh.** Every fetch hits `/events` once per calendar, serially in a `for` loop with an `await` inside. Ten calendars means ten round trips, every five minutes, before the popover is even opened. `Promise.all` would at least parallelize them.
- **The events cache key uses `toISOString().slice(0,10)`** (`calendar.ts:177`) while every other date in the file uses `localDateStr()`. In a timezone behind UTC, the cache key can name a different day than the range it holds.
- **Every view refetches on navigation.** `renderControls`'s `onUpdate` calls `fetchEvents().then(rebuild)` even when the target range is already cached and fresh.
- **The color map is cached forever** with no TTL and no invalidation except disconnect.
- **`viewMode` and `offset` are module-level globals** mutated from button handlers, which is why the popover has to reset them on open.
- **Two nearly identical "list of events" renderers** — `renderDayView`'s cards and `showDayEventList`'s rows.
- **No calendar filtering.** Every `selected` calendar is fetched and every event is shown; holidays and shared calendars can't be turned off. (`notes.md` lists this as a wanted feature.)
- **Week and month views ignore multi-day events.** Bucketing is by start date only, so an event spanning three days appears once.
- **Nothing indicates the current time.** Neither the day nor the week view draws a now-marker, and the day view doesn't scroll to the current hour.
- **`renderTrigger` hides the button entirely when `not-connected`**, so a user who enabled the widget but hasn't signed in sees nothing at all and no path to connect except finding it in settings.
- **The 401 retry path is inline and duplicated**, nested three levels deep inside `fetchEvents`'s try block.
