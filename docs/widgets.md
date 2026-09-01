# Widgets

The shared shape every widget follows, and the clock.

**Per-widget docs:** [todos.md](todos.md) · [notepad.md](notepad.md) · [weather.md](weather.md) · [spotify.md](spotify.md) · [calendar.md](calendar.md) · [github.md](github.md) · [mail.md](mail.md) · [linear.md](linear.md)

## Where widgets appear

The [layout](layouts.md) decides. In **Immersive** every widget is behind a trigger in `#widgets`, exactly as described below. In **Default** and **Dashboard** the same content is mounted into a card instead, via `registerCard()`.

That's why each widget now exposes its content as a standalone builder — `buildWeatherBody()`, `buildTodoList()`, `buildNotepadBody()`, `buildCalendarBody()`, `buildSpotifyBody()` — used by both its popover and its card. Adding to the popover means adding to the card for free; the two must never diverge.

Dashboard's top row is a third host, and the only one that isn't the same content: a tile is 118px tall, so `buildWeatherTile()` and `buildSpotifyTile()` show one reading and a caption instead of a chart or a full transport. A widget that never lands in a tile region doesn't need one. See [layouts.md](layouts.md#the-tile-row).

## The pattern

Four widgets — calendar, weather, todo, notepad — are **trigger + popover** in the Immersive layout. Their trigger buttons live in `#widgets` (top-right of the page) in `index.html`, all starting `hidden`. Two widgets break the pattern: the clock renders directly into `#clock` with no trigger, and Spotify renders a fixed card in the bottom-right corner (Immersive only — elsewhere it is a regular card), which idle shrinks and fades back rather than vanishing when `spotifyHideWhenIdle` is off ([spotify.md](spotify.md#the-idle-card)).

The trigger-based widgets share a structure worth knowing before you touch any one of them, because the same six pieces recur in each:

**0. State on the trigger.** A closed widget still says something: weather shows a temperature, calendar an event count, todo a count, an overdue badge and a ring of today's progress, the notepad a dot when there is anything written in it. Anything degraded or estimated has to be visible in *both* hosts — a notice in the expanded body and a badge on the trigger — since Immersive only ever shows the latter.

**1. A visibility flag.** Every widget has a `*Enabled` sync setting. `initX()` sets `trigger.hidden = !enabled` and subscribes to the key; the same key goes into the card's `enabledKey` so the card appears and disappears with it. Turning a widget off also closes its popover and stops its refresh interval.

**2. A state machine.** Network widgets carry a module-level `currentState`:

| Widget | States |
|---|---|
| Weather | `loading` · `loaded` · `error` · `no-location` |
| Calendar | `loading` · `loaded` · `error` · `not-connected` |
| GitHub | `loading` · `loaded` · `error` · `not-connected` |
| Linear | `loading` · `loaded` · `error` · `not-connected` |
| Mail | `loading` · `loaded` · `error` · `not-connected` |

`renderTrigger()` switches on it to decide what the button shows, and the click handler switches on it to decide what a click does — in `error` both retry, and in `no-location` the weather widget opens the settings dialog on its own section (`openSettings("widgets", "weather")`, see [settings-ui.md](settings-ui.md#deep-linking-into-a-section)).

Weather's `loaded` trigger also follows its `weatherMetric` setting, so what the button reads changes with the metric selected inside the body — see [weather.md](weather.md#trigger).

**3. A single popover handle.** A module-level `openPopoverClose: (() => void) | null` doubles as "is the popover open?" and as the way to close it. Clicking the trigger toggles: close if set, open if not. The popover's `onClose` nulls it. See [components.md](components.md#createpopover).

**4. A localStorage cache.** Data and a `lastFetch` timestamp are written to `sp:<widget>:*` keys directly, not through the store — see [storage.md](storage.md#raw-localstorage-caches). Cached data renders instantly on load while the network request is in flight.

**5. A cooldown plus a refresh interval.** Two different timers:

| Widget | Cooldown | Refresh interval |
|---|---|---|
| Weather | 120s | 300s |
| Calendar | 10s | 300s |
| GitHub | 60s | 300s, paused while the tab is hidden |
| Linear | 60s | 300s, paused while the tab is hidden |
| Mail | 60s, **per tab** | 300s, paused while the tab is hidden |
| Spotify | — | 5s poll; last played at most 1/min, and only when the idle card is on |

The cooldown guards against redundant fetches (a re-init, a settings change); the interval keeps a long-lived tab current. Weather and Calendar both implement this with the same `isCooldownActive()` / `startRefreshInterval()` / `stopRefreshInterval()` trio, written twice.

**6. `e.stopPropagation()` on the trigger click**, so the document-level popover dismissal handler doesn't immediately close what the click just opened.

The two **local** widgets keep only pieces 0, 1, 3 and 6. Todo and notepad have no state machine, no cache and no refresh interval, because their data *is* a store key — there is nothing to fetch and nothing to go stale. The notepad inverts piece 5 instead: rather than a read cooldown it has a debounced **write**, flushed on blur, on the tab being hidden and on unload. See [notepad.md](notepad.md#the-write-path).

## Clock

`clock.ts` (169 lines) — the largest element on the page, and the simplest module.

Renders into `#clock`. No trigger, no popover, no network, and no card — it is a singleton slot in all three layouts, above the search bar in Default and Immersive and left-aligned at the head of the main column in Dashboard. See [layouts.md](layouts.md#singleton-slots).

**World clocks are a separate module.** `world-clocks.ts` draws up to five extra timezones beside this one — a chip row under the clock in Default and Immersive, a tile each in the Dashboard's top row. It reads `clock24Hour` and `clockShowSeconds` from here so every clock on the page prints the same way, but it owns its own list, its own tick and its own settings section. See [world-clocks.md](world-clocks.md).

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
4. Build the content in a `buildMyWidgetBody()` that the popover uses, and `registerCard({ id, title, order, regions, enabledKey: "myWidgetEnabled", render: buildMyWidgetBody })` at module scope. Add a `renderTile` if one of those regions is Dashboard's `top`. Call `refreshCard("my-widget")` (or keep a rebuild closure) when its data changes — see [layouts.md](layouts.md#keeping-a-card-current).
5. Call `initMyWidget()` in `index.ts` inside the `DOMContentLoaded` handler.
6. Add an accordion to `buildWidgetsTab()` in `settings.ts` — see [settings-ui.md](settings-ui.md#adding-a-setting).
7. Document the storage keys in [storage.md](storage.md#key-inventory).

## Refactor candidates

- **The pattern is copy-pasted, not shared.** Weather, Calendar, GitHub, Linear and Mail each contain their own `isCooldownActive`, `getCached*`/`setCached*`, `startRefreshInterval`/`stopRefreshInterval`, `closePopover`, and enable-subscription — near-identical code in five files, with Spotify carrying a sixth variant of the polling half. A `createWidget({ trigger, enabledKey, fetch, render, cooldown, interval })` helper would absorb all of it and is the single highest-leverage refactor in the widget layer.
- **Weather and calendar don't pause when the tab is hidden.** `spotify.ts` has a `visibilitychange` handler and so does `world-clocks.ts`; weather and calendar keep their 5-minute intervals running in every background tab, on every open new tab. This is real wasted network on a page that's open constantly.
- **Each widget re-derives the same trigger markup.** `renderTrigger()` in weather and calendar both clear and rebuild the button with an icon plus a label span; calendar still does it by `innerHTML` string concatenation.
- **No shared empty/error/loading presentation.** Weather and calendar each spell out their own loading and error states; only weather's body explains what failed.
- **Three widgets, two answers to the same sizing question.** Weather and calendar each carry their own copy of the measured-width pattern — a `ResizeObserver` feeding a layout function, plus a set tracking live bodies so stale observers get swept — while the todo body does it in CSS with Tailwind's `@container` and no JS at all ([todos.md](todos.md#ui)). The CSS answer is the cheaper one wherever a body isn't sizing a canvas or an SVG chart.
- **Clock re-renders the whole element every second** just to blink a colon. A CSS animation on the colon spans would leave the DOM alone between minute changes.
- **Clock date formatting is English-only and hand-rolled.** Three literal month arrays plus a custom ordinal function, where `Intl.DateTimeFormat` covers the same five formats and every locale.
- **The main clock has no timezone setting**, despite `README.md:10` listing "timezone" as a clock feature. It always renders the local machine time; world clocks sit beside it rather than replacing it.
- **The clock's `setInterval` isn't second-aligned**, so the seconds display drifts within its tick. `world-clocks.ts` already has a second-aligned, self-cleaning, visibility-aware ticker (`onTick`) that the clock could share.
