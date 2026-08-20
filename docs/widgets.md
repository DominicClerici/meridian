# Widgets

The shared shape every widget follows, and the clock.

**Per-widget docs:** [todos.md](todos.md) · [weather.md](weather.md) · [spotify.md](spotify.md) · [calendar.md](calendar.md)

## Where widgets appear

The [layout](layouts.md) decides. In **Immersive** every widget is behind a trigger in `#widgets`, exactly as described below. In **Default** and **Dashboard** the same content is mounted into a card instead, via `registerCard()`.

That's why each widget now exposes its content as a standalone builder — `buildWeatherBody()`, `buildTodoList()`, `buildCalendarBody()`, `buildSpotifyBody()` — used by both its popover and its card. Adding to the popover means adding to the card for free; the two must never diverge.

## The pattern

Three widgets — calendar, weather, todo — are **trigger + popover** in the Immersive layout. Their trigger buttons live in `#widgets` (top-right of the page) in `index.html`, all starting `hidden`. Two widgets break the pattern: the clock renders directly into `#clock` with no trigger, and Spotify renders a fixed card in the bottom-right corner (Immersive only — elsewhere it is a regular card).

The trigger-based widgets share a structure worth knowing before you touch any one of them, because the same six pieces recur in each:

**1. A visibility flag.** Every widget has a `*Enabled` sync setting. `initX()` sets `trigger.hidden = !enabled` and subscribes to the key; the same key goes into the card's `enabledKey` so the card appears and disappears with it. Turning a widget off also closes its popover and stops its refresh interval.

**2. A state machine.** Network widgets carry a module-level `currentState`:

| Widget | States |
|---|---|
| Weather | `loading` · `loaded` · `error` · `no-permission` |
| Calendar | `loading` · `loaded` · `error` · `not-connected` |

`renderTrigger()` switches on it to decide what the button shows, and the click handler switches on it to decide what a click does — in `error` the calendar retries, in `no-permission` the weather widget opens the settings dialog.

**3. A single popover handle.** A module-level `openPopoverClose: (() => void) | null` doubles as "is the popover open?" and as the way to close it. Clicking the trigger toggles: close if set, open if not. The popover's `onClose` nulls it. See [components.md](components.md#createpopover).

**4. A localStorage cache.** Data and a `lastFetch` timestamp are written to `sp:<widget>:*` keys directly, not through the store — see [storage.md](storage.md#raw-localstorage-caches). Cached data renders instantly on load while the network request is in flight.

**5. A cooldown plus a refresh interval.** Two different timers:

| Widget | Cooldown | Refresh interval |
|---|---|---|
| Weather | 120s | 300s |
| Calendar | 10s | 300s |
| Spotify | — | 5s poll |

The cooldown guards against redundant fetches (a re-init, a settings change); the interval keeps a long-lived tab current. Weather and Calendar both implement this with the same `isCooldownActive()` / `startRefreshInterval()` / `stopRefreshInterval()` trio, written twice.

**6. `e.stopPropagation()` on the trigger click**, so the document-level popover dismissal handler doesn't immediately close what the click just opened.

## Clock

`clock.ts` (169 lines) — the largest element on the page, and the simplest module.

Renders into `#clock`. No trigger, no popover, no network. The element sits above the search bar in Default and Immersive; in Dashboard the Clock card adopts the very same element, so the running interval is never interrupted. See [layouts.md](layouts.md#singleton-slots).

**Settings** (seven, all `sync`, all in the General tab):

| Key | Effect |
|---|---|
| `clockEnabled` | Hides the element and stops the interval |
| `clockShowSeconds` | Appends `:SS` |
| `clock24Hour` | 24-hour time; suppresses AM/PM |
| `clockShowAmPm` | Superscript meridiem at 0.4em |
| `clockShowDate` | Shows a date line below |
| `clockDateFormat` | `long` (January 24th) · `short` (Jan. 24th) · `abbr` (Jan 24) · `numeric` (01/24/2024) · `numericShort` (01/24) |
| `clockSize` | `small` 3rem · `medium` 5rem · `large` 8rem |

`initClock()` renders once, then subscribes all seven keys to the same `renderClock()`.

**The tick.** A single `setInterval` at 1000ms flips a `colonVisible` flag and re-renders, so the colons pulse between full and 50% opacity once a second. The interval is created lazily inside `renderClock()` (only if none is running) and cleared when the clock is disabled. Because it's a plain 1000ms interval rather than one aligned to the second boundary, the displayed seconds can lag the true second by up to a full tick.

**Rendering** is a template string assigned to `innerHTML`, rebuilding the whole clock every second. Date formatting is hand-rolled: three month-name arrays and an `ordinal()` helper, all English-only.

## Adding a widget

1. Add `myWidgetEnabled` to `SyncSettings` in `defaults.ts`.
2. Add a trigger button to `#widgets` inside `#layout-parking` in `index.html`, `hidden` by default.
3. Create `src/my-widget.ts` exporting `initMyWidget()`: look up the trigger, wire the click toggle with `e.stopPropagation()`, render from cache, subscribe to `myWidgetEnabled`.
4. Build the content in a `buildMyWidgetBody()` that the popover uses, and `registerCard({ id, title, order, regions, enabledKey: "myWidgetEnabled", render: buildMyWidgetBody })` at module scope. Call `refreshCard("my-widget")` (or keep a rebuild closure) when its data changes — see [layouts.md](layouts.md#keeping-a-card-current).
5. Call `initMyWidget()` in `index.ts` inside the `DOMContentLoaded` handler.
6. Add an accordion to `buildWidgetsTab()` in `settings.ts` — see [settings-ui.md](settings-ui.md#adding-a-setting).
7. Document the storage keys in [storage.md](storage.md#key-inventory).

## Refactor candidates

- **The pattern is copy-pasted, not shared.** Weather and Calendar each contain their own `isCooldownActive`, `getCached*`/`setCached*`, `startRefreshInterval`/`stopRefreshInterval`, `closePopover`, and enable-subscription — near-identical code in two files, with Spotify carrying a third variant of the polling half. A `createWidget({ trigger, enabledKey, fetch, render, cooldown, interval })` helper would absorb all of it and is the single highest-leverage refactor in the widget layer.
- **Only Spotify pauses when the tab is hidden.** `spotify.ts` has a `visibilitychange` handler; weather and calendar keep their 5-minute intervals running in every background tab, on every open new tab. This is real wasted network on a page that's open constantly.
- **Each widget re-derives the same `<span>`-and-`innerHTML` trigger markup.** `renderTrigger()` in weather and calendar both clear and rebuild the button with an icon plus a label span.
- **No shared empty/error/loading presentation.** Weather shows "Loading...", calendar shows a calendar icon plus "Loading...", and errors are a bare refresh icon in both with no explanation of what failed.
- **Clock re-renders the whole element every second** just to blink a colon. A CSS animation on the colon spans would leave the DOM alone between minute changes.
- **Clock date formatting is English-only and hand-rolled.** Three literal month arrays plus a custom ordinal function, where `Intl.DateTimeFormat` covers the same five formats and every locale.
- **There is no timezone setting**, despite `README.md:10` listing "timezone" as a clock feature. The clock always renders the local machine time.
- **The clock's `setInterval` isn't second-aligned**, so the seconds display drifts within its tick.
