# Weather

**Files:** `src/weather.ts` (641 lines), `src/location.ts` (211 lines), `src/timezone-coords.ts` (157 lines). **Trigger:** `#weather-trigger`. **API:** [Open-Meteo](https://open-meteo.com/) — free, no key.

Follows the trigger/popover pattern in [widgets.md](widgets.md).

## Data flow

```
initWeather()
   └─ fetchWeather()
        ├─ cooldown active + cached?  → render from cache, done
        ├─ resolveLocation()          → manual, else device, else stored, else timezone estimate
        ├─ GET /v1/forecast?current=… → { temperature, weatherCode }
        └─ shouldRefetchHourly()?     → fetchHourlyData() (25-hour series for the chart)
```

Two separate endpoints. The **current** call drives the trigger button; the **hourly** call (`past_hours=12&forecast_hours=13`, 25 points, `timezone=auto`) drives the chart and only runs when needed.

### Coordinates

Coordinates come from `location.ts`, not from this module. `resolveLocation()` tries a manual pick, then the device locator, then the last stored value, then a timezone estimate — the full chain and the reasoning behind it are in [browser-compat.md](browser-compat.md#location).

What the widget adds on top:

- `currentLocation` holds the resolved location for the current render, seeded from `getStoredLocation()` in `initWeather()` so a cache-only render on page load still knows where it came from.
- `approximateNote()` appends a one-line "Approximate — estimated from your timezone (…)" caption whenever the source is `timezone`.
- `refreshWeather()` is the exported entry point settings calls after the user grants access or picks a city. It clears all three caches first, because the cached reading belongs to the old coordinates.

State `no-location` — reached only when the timezone is unmapped *and* nothing is stored — renders a "Set location" trigger that **opens the settings dialog** on click, where the location controls live (see [settings-ui.md](settings-ui.md#widgets)).

`fetchWeather()` guards re-entry with `fetchInFlight` around the resolve step. Location writes fire store subscribers, and without the guard a device-location refresh could re-enter the fetch it was triggered by.

### Caching

| Key | Contents |
|---|---|
| `sp:weather:cachedData` | Last current-conditions result |
| `sp:weather:lastFetch` | Timestamp for the 120s cooldown |
| `sp:weather:hourlyData` | The 25-point series plus `currentIndex` and `fetchedAtHour` |

`shouldRefetchHourly(currentTemp)` refetches when there's no cache, when the hour bucket (`Date.now() / 3_600_000`) has rolled over, or when the cached temperature at `currentIndex` disagrees with the freshly-fetched current temperature — the last one catches a forecast revision within the same hour.

A failed current-conditions fetch falls back to the cached reading and stays in `loaded` rather than showing an error, so a brief network blip is invisible.

Changing `weatherUnit` clears **all three** cache keys and refetches, because the API returns already-converted values rather than a canonical unit.

## Trigger

| State | Renders |
|---|---|
| `no-location` | `locationOff` icon + "Set location" |
| `loading` | "Loading..." |
| `error` | `refresh` icon (clicking does nothing — the state check only opens the popover when `loaded`) |
| `loaded` | Emoji + `72°F Partly cloudy` |

`WEATHER_MAP` (`weather.ts:22`) maps the 28 WMO weather codes Open-Meteo returns to an emoji and a condition string, defaulting to ❓/"Unknown".

## The chart

`buildChart()` (`weather.ts:243`) builds a 280×96 SVG by hand — no library.

- **Scale.** Y spans `min(temps) - 1` to `max(temps) + 1` so the line never touches the edges; X is evenly spaced across the 25 points.
- **Line.** `smoothPath()` draws a cubic Bézier through the points using the horizontal midpoint between neighbors as both control points — a monotone-ish smoothing that can't overshoot horizontally.
- **Fill.** The same path closed to the baseline, filled with a vertical gradient from 15% accent to transparent.
- **Grid.** Six horizontal rules at 6% opacity.
- **Now marker.** A dashed vertical line and a solid dot at `currentIndex` (always 12 — twelve hours of history precede it).
- **Hover.** A full-size transparent `<rect>` catches `mousemove`, finds the nearest point by X distance, and moves a highlight dot and vertical line to it while the header above swaps to that hour's time and temperature. `mouseleave` restores "Now".

Colors come from `var(--accent)` inside SVG attributes, so the chart follows the theme without any JS.

`formatHour()` respects the **clock's** `clock24Hour` setting rather than having its own.

`buildWeatherBody()` shows the chart when hourly data exists, and falls back to a single line of text (`⛅ 72°F · Partly cloudy`) when it doesn't; before either it renders the current state (a settings link for `no-location`, a retry button for `error`). The immersive popover wraps it at 280px, and the card in the other layouts hosts the same builder — `renderTrigger()` calls `refreshCard("weather")`, so both stay current. See [layouts.md](layouts.md).

## Refactor candidates

- **Weather codes map to emoji.** `WEATHER_MAP` renders ☀️ 🌤️ ⛅ ☁️ straight into `innerHTML`, so the widget's visual identity is whatever the OS emoji font decides — inconsistent across platforms and unstylable. Every other icon in the app goes through the theme-aware registry ([design-system.md](design-system.md#icons)).
- **The trigger is built with `innerHTML` string concatenation** (`weather.ts:481`) interpolating live API values. `condition` is from a fixed local map so it's not injectable today, but it's the one place in this file that writes unescaped data into markup.
- **Error state is a dead end.** `renderTrigger` shows a refresh icon, but the click handler only acts on `loaded` and `no-location` — clicking the refresh icon does nothing. Calendar handles the same state by retrying.
- **The gradient uses a fixed `id="wg"`.** Two charts on the page would collide; harmless today because only one weather body — popover or card — exists at a time.
- **Cooldown and interval logic is duplicated from `calendar.ts`** almost line for line — see [widgets.md](widgets.md#refactor-candidates).
- **The refresh interval runs in hidden tabs.** Every open new tab polls Open-Meteo every 5 minutes forever.
- **Hourly data is fetched for a fixed 25-hour window** with `currentIndex` hard-coded to 12, so any change to `past_hours` silently breaks the marker.
- **Chart interaction is mouse-only** — `mousemove`/`mouseleave`, no touch or keyboard equivalent.
