# Weather

**Files:** `src/weather.ts`, `src/location.ts`, `src/timezone-coords.ts`. **Trigger:** `#weather-trigger`. **API:** [Open-Meteo](https://open-meteo.com/) — free, no key.

Follows the trigger/popover pattern in [widgets.md](widgets.md).

## Data flow

```
initWeather()
   └─ fetchWeather()
        ├─ cooldown active + series fresh? → render from cache, done
        ├─ resolveLocation()               → manual, else device, else stored, else timezone estimate
        ├─ GET /v1/forecast                → current + 72h hourly + 3d daily, every variable, one request
        └─ metric == Air Quality?          → GET /v1/air-quality on the separate host
```

One forecast request covers every metric. `current=` drives the trigger and the headline, `hourly=` with `past_days=1&forecast_days=2` gives a 72-hour span the chart window slides inside, and `daily=` gives each metric's high and low plus the three days of sunrise/sunset times behind [the sun row](#sunrise-and-sunset). The daily block is requested in two halves — `DAILY_VARS` for the numeric aggregates and `DAILY_TIME_VARS` for `sunrise`/`sunset`, which come back as wall-clock strings and so cannot ride in the same numeric map. `timezone=auto` means every timestamp comes back in the **forecast location's** timezone, and the whole module reasons in that zone rather than the browser's — the two only differ when a city was picked by hand.

Three unit parameters ride along, all derived from the single `weatherUnit` setting: `temperature_unit`, `wind_speed_unit`, and `precipitation_unit`. Fahrenheit implies mph and inches, Celsius implies km/h and mm. The API converts server-side, so changing the unit clears every cache.

### Coordinates

Coordinates come from `location.ts`, not from this module. `resolveLocation()` tries a manual pick, then the device locator, then the last stored value, then a timezone estimate — the full chain and the reasoning behind it are in [browser-compat.md](browser-compat.md#location).

What the widget adds on top:

- `currentLocation` holds the resolved location for the current render, seeded from `getStoredLocation()` in `initWeather()` so a cache-only render on page load still knows where it came from.
- `locationLabel()` picks the display name: the manual label, else `Current location` for a device fix, else the city half of the API's `timezone` field.
- When the source is `timezone`, two things say so — `approximateNote()` under the chart, and a warning triangle on the trigger (below).
- `refreshWeather()` is the exported entry point settings calls after the user grants access or picks a city. It clears every cache first, because the cached readings belong to the old coordinates.

State `no-location` — reached only when the timezone is unmapped *and* nothing is stored — renders a "Set location" trigger that **opens the settings dialog on the weather section** via `openSettings("widgets", "weather")` (see [settings-ui.md](settings-ui.md#deep-linking-into-a-section)).

`fetchWeather()` guards re-entry with `fetchInFlight` around the resolve step. Location writes fire store subscribers, and without the guard a device-location refresh could re-enter the fetch it was triggered by.

### Caching

| Key | Contents |
|---|---|
| `sp:weather:cachedData` | Last current-conditions result: `weatherCode`, `isDay`, and a `values` map keyed by API variable |
| `sp:weather:lastFetch` | Timestamp for the 120s cooldown |
| `sp:weather:hourlyData` | The 72-point series for every variable, the daily aggregates, the daily `sun` times, `utcOffset`, `timezone`, and `fetchedAtHour` |
| `sp:weather:aqiData` | The 72-point US AQI series plus its current reading and `utcOffset` |

The cooldown is skipped when `seriesStale()` is true — the hour bucket (`Date.now() / 3_600_000`) rolled over since the series was fetched, so the chart window has moved and the data behind it has to move with it.

Each getter validates the shape it reads and returns `null` on a mismatch, which is how caches written by earlier versions get discarded instead of throwing: `getCachedSeries()` requires a keyed `hourly` map, `getCachedData()` requires a `values` map. `sun` is deliberately *not* required — a cache written before sun times were requested stays usable and simply renders no sun row until the next fetch fills it in.

A failed forecast fetch falls back to the cached reading and stays in `loaded` rather than showing an error, so a brief network blip is invisible.

## Metrics

`weatherMetric` (sync) picks what the body charts. It is changed from a ghost [`createSelect`](components.md#createselect) at the top of the body — which doubles as the body's heading — or from the matching row in the settings dialog; the two stay in sync through the store.

| Label | Charted variable | Corner block | Notes |
|---|---|---|---|
| Real Temperature | `temperature_2m` | H / L | |
| **Feels Like** (default) | `apparent_temperature` | H / L | |
| Humidity | `relative_humidity_2m` | H / L | |
| Wind Speed + Gusts | `wind_speed_10m` | Gust (hovered hour) · H (day's peak) | Replaces the condition icon with a compass |
| UV Index | `uv_index` | H | Caption: Low → Extreme |
| Precipitation | `precipitation_probability` | Hr (hovered hour's amount) · Day (total) | The amount stands in for a high/low |
| Air Quality | `us_aqi` | H / L | Separate host; caption: Good → Hazardous |

Each metric is one `MetricDef` in the `METRICS` array — its API variable, any companion series it needs (`aux`), how to format the headline and the trigger, an optional caption word, and a `detail()` that returns the corner rows for whichever hour is hovered. Adding a metric means adding an entry and, if the variable isn't requested yet, a name in `HOURLY_VARS` / `DAILY_VARS`.

`buildView()` turns the selected def plus the cached series into a `MetricView`: the 24 windowed values, the companion series sliced to match, today's row of daily aggregates, and the live current reading. It returns `null` when the data isn't there, and the body says so instead of drawing an empty chart.

### Air quality

`us_aqi` comes from `air-quality-api.open-meteo.com/v1/air-quality`, which needs its own `host_permissions` entry ([architecture.md](architecture.md#manifest)). It is fetched **lazily** — only while Air Quality is the selected metric — so the other six metrics still cost exactly one request. The response has the same shape as the forecast's hourly block, so the same window logic drives it.

The endpoint has no daily aggregates, so the metric sets `derivedExtremes` and the high/low are computed from the day's own hourly values.

## Sunrise and sunset

One line under the chart, naming whichever crossing comes **next** — sunset through the day, sunrise once it is dark — with its wall-clock time and how far off it is:

```
────────────── 24-hour chart ──────────────
 ☀↓  Sunset  7:42 PM                in 3h 12m
```

`nextSolarEvent()` scans both daily arrays for the earliest timestamp still ahead of now and returns the winner. It reasons in the forecast location's zone like everything else here: sun times carry no UTC offset, so `parseWallClock()` reads them as UTC and compares them against a "now" shifted into the same frame — the same trick as `wallClock()`, and for the same reason. Because the series spans yesterday through tomorrow, tomorrow's sunrise is already in hand long before midnight.

It returns `null` at polar latitudes, where the API reports no crossing for the day, and the row hides itself rather than inventing one.

`formatWallTime()` is the minute-precision counterpart to `formatHour()` — both follow the clock's `clock24Hour` setting, but the chart's hour labels are always on the hour and a sunset is not. `formatCountdown()` gives `in 42m`, `in 3h 12m`, `in 3h`, or `any moment` under a minute.

**Keeping the countdown honest.** The forecast only comes round every five minutes, which is far too coarse for a number reading in minutes, so `SUN_TICK_INTERVAL` (60s) drives `tickBodies()` alongside the refresh interval — both start and stop together with `weatherEnabled`. A tick calls each live body's `tick`, which is `showSun()` alone: it rewrites four bits of text and redraws one icon, touching neither the chart nor the headline, so a pointer resting on the chart is undisturbed. That is why `LiveBody` carries `tick` as well as `refresh`.

The tile deliberately shows **no** countdown. It is only rebuilt on a fetch, and a countdown frozen five minutes behind is worse than a clock time that simply stays true.

## Trigger

| State | Renders |
|---|---|
| `no-location` | `locationOff` icon + "Set location" — click opens settings |
| `loading` | "Loading…" |
| `error` | `refresh` icon — click retries |
| `loaded` | Condition icon + the selected metric, e.g. `93°F Clear sky`, `12 mph Clear sky`, `AQI 46 Clear sky` |

The trigger follows the metric selection, because in Immersive it is the only part of the widget that is visible without a click. Each metric's `compact()` names its own unit, since a bare `41%` beside a sun icon says nothing.

`WEATHER_MAP` maps the 28 WMO weather codes to an icon name in the theme registry and a condition string, defaulting to `wxUnknown`/"Unknown". Codes 0–2 carry an `iconNight` as well, chosen by the `is_day` flag.

When the location came from a timezone estimate, `appendApproximateBadge()` overlays an `alertTriangle` in the trigger's top-right corner, tinted `var(--warning)` with a drop shadow so it reads over any background, and sets the button's `title`. The trigger element carries `relative` in `index.html` for it.

## The tile

`buildWeatherTile()` is the Dashboard top row's form: the condition glyph, the
selected metric's reading at 30px, one caption line naming the metric and
the condition, and the next sun time — 118px leaves room for the third line, and
it is the one fact worth a glance that the reading itself cannot carry. No chart and no metric picker — a tile is 118px tall and sized by
its own content, so anything that needs room belongs in the body instead. The
tile's card header is the location rather than the word "Weather", via
`tileTitle` ([layouts.md](layouts.md#the-tile-row)).

## The body

`buildWeatherBody()` is the single builder for two of the three hosts — the 280px popover in Immersive and the Default layout's card ([layouts.md](layouts.md)). Layout, top to bottom:

```
Feels Like ⌄
Boulder, CO, US                       H 94°   ☀
93°  ⟨hovered hour⟩                   L 61°
────────────── 24-hour chart ──────────────
☀↓ Sunset  7:42 PM                        in 3h 12m
Approximate — estimated from your timezone (Denver). Set an exact location in settings.
```

The sun row sits below the chart, behind a hairline rule: it is a fact about the day rather than part of the reading, and it does not move when the metric changes. Its icon is tinted `text-accent`, tying it to the chart line drawn in the same colour.

**Everything is sized from the host's measured width, never the viewport.** A `ResizeObserver` on the body root updates `hostWidth` and calls `render()`, which sets the selector, caption, corner, icon, and chart dimensions from that one number, so the same body is correct at 200px and at 600px. The first `render()` runs at a placeholder 280px; the observer corrects it on the first frame.

`render()` and `showHovered()` split the work: `render()` rebuilds the view and the chart (on a resize or a metric change), `showHovered()` updates only the headline, caption, corner rows, and compass (on every pointer move). The condition icon is deliberately left out of the hover path — it carries no per-hour information, and rebuilding it on every pointer move would be pure churn.

Each body registers itself in `liveBodies` alongside its observer. The set is pruned by `root.isConnected` on every rebuild, because `refreshCard` discards the old body without telling anyone, and it is what a metric change or a fresh fetch iterates to update every mounted instance in place.

### The chart window

24 hourly points, chosen two ways depending on the local hour at the location:

| Local hour | Window | `currentIndex` |
|---|---|---|
| 03:00 – 20:59 | That calendar day, 00:00 → 23:00 | The current hour |
| 21:00 – 02:59 | Rolling: 11 hours behind now, 12 ahead | 11 |

The daytime rule shows the day you are actually living in; late at night that day is nearly over, so the window rolls forward into tomorrow instead. `windowIndices()` finds "now" by matching a formatted `YYYY-MM-DDTHH:00` key against the series times, then returns a start offset, clamped so the window never runs off either end of the 72-hour span. Because the whole span is cached, the window moves with the clock without another request.

### Drawing

`renderChart()` builds the SVG at the host's **measured pixel size** rather than a fixed viewBox that gets stretched, so stroke weight and label size stay constant at any width. Chart height is `clamp(88, width * 0.36, 180)`.

- **Scale.** The y domain is the data's own range plus 6% padding, so the line never touches the edges. Metrics that mean nothing below zero (wind, UV, precipitation, AQI) set `zeroFloor` and get a domain anchored at 0 instead, which is what keeps a rainless day reading as *no rain* rather than as mid-range. A perfectly flat series is given a one-unit band above it rather than around it, for the same reason.
- **Gaps.** `fillNulls()` carries the nearest reading into any `null` at the edge of a model's range; a window that is entirely null means the metric has no data and the body says so instead.
- **Line.** `smoothPath()` draws a cubic Bézier through the points using the horizontal midpoint between neighbors as both control points — a monotone-ish smoothing that can't overshoot horizontally.
- **Fill.** The same path closed to the baseline, filled with a vertical gradient from 18% accent to transparent. Each chart gets its own gradient id from `gradientSeq`, so two mounted bodies can't collide.
- **Grid.** Five horizontal rules at 6% opacity.
- **Axis.** Hour labels every 3 / 4 / 6 hours depending on width, dropped near the edges where they would clip. `formatAxisHour()` gives `6a` / `18` per the clock's `clock24Hour` setting.
- **Now marker.** A dashed vertical line and a solid dot at `currentIndex`.
- **Hover.** A full-size transparent `<rect>` catches `pointermove` (so a touch drag works too), finds the nearest point by X distance, and moves a highlight dot and vertical line to it. The **headline** swaps to that hour's reading, a muted time label appears beside it, and the corner rows and compass follow; `pointerleave` restores the live reading. Hovering the current hour shows the live current reading rather than the hourly forecast for it, which can differ slightly.

Colors come from `var(--accent)` and `currentColor` inside SVG attributes, so the chart follows the theme without any JS.

### The compass

Wind replaces the condition icon with `renderCompass()` — a ring, four ticks with north emphasized, a needle, and the cardinal abbreviation beneath. It is a **weather vane**: the needle points *into* the wind, at the direction the wind is coming from, which is what `wind_direction_10m` reports, and the label names that same direction.

The needle's length runs from 50% to 92% of the radius, scaled by the hour's speed against the window's peak, so moving along the chart shows the wind turning and strengthening at once. It is drawn at the same measured size as the icon it replaces, and redrawn on every hover.

## Candidate metrics

Everything below comes back from the same `api.open-meteo.com/v1/forecast` call already being made — adding a metric costs no extra request as long as it is appended to the existing `hourly=` / `daily=` / `current=` lists. The seven that ship are marked ✅.

**Has a current value, a 24-hour series, and a daily high/low — the full shape the selector wants:**

| Metric | `hourly` / `current` | `daily` extremes | |
|---|---|---|---|
| Temperature | `temperature_2m` | `temperature_2m_max` / `_min` | ✅ |
| Feels like | `apparent_temperature` | `apparent_temperature_max` / `_min` | ✅ |
| Humidity | `relative_humidity_2m` | `relative_humidity_2m_max` / `_min` | ✅ |
| Wind speed | `wind_speed_10m` | `wind_speed_10m_max`, `wind_speed_10m_mean` | ✅ |
| Wind gusts | `wind_gusts_10m` | `wind_gusts_10m_max` | ✅ |
| UV index | `uv_index` | `uv_index_max` | ✅ |

**Has a current value and a series, with a daily total or single figure instead of a high/low:**

| Metric | `hourly` / `current` | `daily` | |
|---|---|---|---|
| Precipitation | `precipitation`, `rain`, `showers`, `snowfall` | `precipitation_sum`, `rain_sum`, `showers_sum`, `snowfall_sum`, `precipitation_hours` | ✅ (amount only) |
| Chance of precipitation | `precipitation_probability` | `precipitation_probability_max` / `_min` / `_mean` | ✅ |
| Cloud cover | `cloud_cover` (+ `_low` / `_mid` / `_high`) | `cloud_cover_mean` | |
| Pressure | `pressure_msl`, `surface_pressure` | `pressure_msl_mean` | |
| Dew point | `dew_point_2m` | `dew_point_2m_mean` | |

**Series only, no daily counterpart:** `visibility`, `snow_depth`, `wet_bulb_temperature_2m`, `surface_temperature`, `soil_temperature_0cm`, `soil_moisture_0_to_1cm`, `freezing_level_height`, `vapour_pressure_deficit`, `evapotranspiration`, `et0_fao_evapotranspiration`, `shortwave_radiation`, `direct_radiation`, `diffuse_radiation`, `sunshine_duration`, `is_day`, and the convective set `cape` / `lifted_index` / `convective_inhibition` / `boundary_layer_height` / `total_column_integrated_water_vapour`.

**Daily only, no series:** `sunrise` ✅ and `sunset` ✅ (not metrics — see [Sunrise and sunset](#sunrise-and-sunset)), `daylight_duration`, `wind_direction_10m_dominant`, `shortwave_radiation_sum`, `uv_index_clear_sky_max`.

**On the air-quality host** (`air-quality-api.open-meteo.com/v1/air-quality`, already in `host_permissions`): `us_aqi` ✅, plus `european_aqi`, `pm2_5`, `pm10`, `ozone`, `nitrogen_dioxide`, `sulphur_dioxide`, `carbon_monoxide`, `ammonia`, `dust`, `aerosol_optical_depth`, `uv_index`, and the pollen set (`alder` / `birch` / `grass` / `ragweed`, Europe only). These share one request, so a second air-quality metric is free once that fetch is already happening.

## Refactor candidates

- **The trigger still shows a condition string next to the metric**, which makes its width jump between "Clear sky" and "Thunderstorm with hail".
- **Cooldown and interval logic is duplicated from `calendar.ts`** almost line for line — see [widgets.md](widgets.md#refactor-candidates).
- **The refresh interval runs in hidden tabs.** Every open new tab polls Open-Meteo every 5 minutes forever.
- **Chart interaction has no keyboard equivalent.** `pointermove` covers mouse and touch, but there is no way to step through hours from the keyboard.
- **The chart is rebuilt from scratch on every resize tick**, rather than rescaling the paths it already has.
- **The air-quality fetch has no error surface.** A failed request leaves the body saying air quality isn't available here, with no retry and no way to tell a dead network from an unsupported location.
- **Precipitation charts probability but names itself "Precipitation"**, and its corner shows amounts — one metric doing two jobs because neither is worth a row on its own.
