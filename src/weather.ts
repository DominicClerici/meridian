import { store } from "./store"
import { icon } from "./icons/registry"
import { createButton, createPopover, createSelect } from "./components"
import { refreshCard, registerCard } from "./layout"
import { getStoredLocation, resolveLocation } from "./location"
import { openSettings } from "./settings"
import type { ResolvedLocation } from "./location"
import type { WeatherMetric } from "./defaults"

type CurrentData = {
  weatherCode: number
  isDay: boolean
  values: Record<string, number | null>
}

/**
 * Three days of hourly readings around now (yesterday 00:00 → tomorrow 23:00 in
 * the location's own timezone) plus the daily aggregates covering them. Holding
 * the whole span means the 24-hour chart window can move with the clock, and
 * holding every variable means switching metrics costs no request.
 */
type Series = {
  times: string[]
  hourly: Record<string, (number | null)[]>
  daily: Record<string, (number | null)[]>
  dailyDates: string[]
  /**
   * Sunrise and sunset wall clocks, parallel to `dailyDates`. Optional because a
   * cache written before they were requested has to stay readable until the next
   * fetch fills it in — and because polar latitudes report no crossing at all.
   */
  sun?: { sunrise: (string | null)[]; sunset: (string | null)[] }
  utcOffset: number
  timezone: string
  fetchedAtHour: number
}

/** The air-quality endpoint is a separate host, so it gets a separate cache. */
type AqiData = {
  times: string[]
  values: (number | null)[]
  current: number | null
  utcOffset: number
  fetchedAtHour: number
}

type WeatherInfo = {
  icon: string
  iconNight?: string
  condition: string
}

const WEATHER_MAP: Record<number, WeatherInfo> = {
  0: { icon: "wxClear", iconNight: "wxClearNight", condition: "Clear sky" },
  1: { icon: "wxClear", iconNight: "wxClearNight", condition: "Mainly clear" },
  2: { icon: "wxPartly", iconNight: "wxPartlyNight", condition: "Partly cloudy" },
  3: { icon: "wxCloudy", condition: "Overcast" },
  45: { icon: "wxFog", condition: "Fog" },
  48: { icon: "wxFog", condition: "Rime fog" },
  51: { icon: "wxDrizzle", condition: "Light drizzle" },
  53: { icon: "wxDrizzle", condition: "Drizzle" },
  55: { icon: "wxDrizzle", condition: "Dense drizzle" },
  56: { icon: "wxSleet", condition: "Freezing drizzle" },
  57: { icon: "wxSleet", condition: "Freezing drizzle" },
  61: { icon: "wxRain", condition: "Light rain" },
  63: { icon: "wxRain", condition: "Rain" },
  65: { icon: "wxRain", condition: "Heavy rain" },
  66: { icon: "wxSleet", condition: "Freezing rain" },
  67: { icon: "wxSleet", condition: "Freezing rain" },
  71: { icon: "wxSnow", condition: "Light snow" },
  73: { icon: "wxSnow", condition: "Snow" },
  75: { icon: "wxSnow", condition: "Heavy snow" },
  77: { icon: "wxSnow", condition: "Snow grains" },
  80: { icon: "wxRain", condition: "Light showers" },
  81: { icon: "wxRain", condition: "Showers" },
  82: { icon: "wxRain", condition: "Heavy showers" },
  85: { icon: "wxSnow", condition: "Snow showers" },
  86: { icon: "wxSnow", condition: "Heavy snow showers" },
  95: { icon: "wxThunder", condition: "Thunderstorm" },
  96: { icon: "wxThunder", condition: "Thunderstorm with hail" },
  99: { icon: "wxThunder", condition: "Thunderstorm with hail" },
}

function getWeatherInfo(code: number): WeatherInfo {
  return WEATHER_MAP[code] ?? { icon: "wxUnknown", condition: "Unknown" }
}

function iconNameFor(data: CurrentData): string {
  const info = getWeatherInfo(data.weatherCode)
  return !data.isDay && info.iconNight ? info.iconNight : info.icon
}

const LS_LAST_FETCH = "sp:weather:lastFetch"
const LS_CACHED_DATA = "sp:weather:cachedData"
const LS_HOURLY = "sp:weather:hourlyData"
const LS_AQI = "sp:weather:aqiData"
const COOLDOWN = 120_000
const REFRESH_INTERVAL = 300_000
/** How often the "in 3h 12m" beside the next sun time is rewritten. */
const SUN_TICK_INTERVAL = 60_000

/** Hours in the chart, and the local-time band that gets the calendar-day window. */
const WINDOW_HOURS = 24
const DAY_WINDOW_START = 3
const DAY_WINDOW_END = 21
/** Where "now" sits in the rolling window: 11 hours behind it, 12 ahead. */
const ROLLING_OFFSET = 11

const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "uv_index",
  "precipitation",
  "precipitation_probability",
]

const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "relative_humidity_2m_max",
  "relative_humidity_2m_min",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "uv_index_max",
  "precipitation_sum",
  "precipitation_probability_max",
]

/** Daily fields that come back as wall clocks rather than numbers. */
const DAILY_TIME_VARS = ["sunrise", "sunset"]

type State = "no-location" | "loading" | "loaded" | "error"

let currentState: State = "loading"
let currentData: CurrentData | null = null
let currentLocation: ResolvedLocation | null = null
let seriesCache: Series | null = null
let aqiCache: AqiData | null = null
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let sunTickId: ReturnType<typeof setInterval> | null = null
let openPopoverClose: (() => void) | null = null
let fetchInFlight = false
let aqiInFlight = false

/** Live body instances, pruned on every rebuild so detached bodies can't pile up. */
type LiveBody = {
  root: HTMLElement
  ro: ResizeObserver
  refresh: () => void
  /** Rewrites only the countdown text, so it can run while the chart is hovered. */
  tick: () => void
}
const liveBodies = new Set<LiveBody>()

function pruneBodies(): void {
  for (const entry of liveBodies) {
    if (entry.root.isConnected) continue
    entry.ro.disconnect()
    liveBodies.delete(entry)
  }
}

function refreshBodies(): void {
  pruneBodies()
  for (const entry of liveBodies) entry.refresh()
}

/**
 * The forecast only comes round every five minutes, which is far too coarse for
 * a countdown reading in minutes. This redraws the sun row alone — no rebuild,
 * so a pointer resting on the chart is undisturbed.
 */
function tickBodies(): void {
  pruneBodies()
  for (const entry of liveBodies) entry.tick()
}

function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000)
}

function isImperial(): boolean {
  return store.sync.get("weatherUnit") === "f"
}

function windUnit(): string {
  return isImperial() ? "mph" : "km/h"
}

function formatPrecip(v: number): string {
  return isImperial() ? `${v.toFixed(2)}"` : `${v.toFixed(1)}mm`
}

function unitLabel(): string {
  return store.sync.get("weatherUnit").toUpperCase()
}

// ---------------------------------------------------------------- metrics

type Row = { mark: string; text: string }

type MetricView = {
  def: MetricDef
  times: string[]
  values: number[]
  currentIndex: number
  currentValue: number | null
  /** Windowed companion series, e.g. gusts and direction for wind. */
  aux: Record<string, (number | null)[]>
  /** Today's row of the daily aggregates. */
  daily: Record<string, number | null>
  /** Filled in only for metrics the API has no daily aggregate for. */
  extremes: { high: number; low: number } | null
}

type MetricDef = {
  id: WeatherMetric
  label: string
  source: "forecast" | "aqi"
  key: string
  aux?: string[]
  /** Anchor the chart's y-axis at zero, for quantities that mean nothing below it. */
  zeroFloor?: boolean
  compass?: boolean
  /** Derive the day's high/low from the hourly series instead of a daily field. */
  derivedExtremes?: boolean
  /** The headline reading. */
  format: (v: number) => string
  /** Small unit rendered beside the headline, when the format leaves it implicit. */
  suffix?: () => string | null
  /** The trigger's one-line version, which has to name its own unit. */
  compact: (v: number) => string
  /** A word for what the number means, shown beside it when nothing is hovered. */
  caption?: (v: number) => string
  /** The top-right block, recomputed at whichever hour is hovered. */
  detail: (view: MetricView, index: number) => Row[]
}

function auxAt(view: MetricView, key: string, index: number): number | null {
  const arr = view.aux[key]
  if (!arr) return null
  const v = arr[index]
  return typeof v === "number" ? v : null
}

function hiLoRows(
  view: MetricView,
  hiKey: string,
  loKey: string,
  fmt: (v: number) => string
): Row[] {
  const hi = view.daily[hiKey]
  const lo = view.daily[loKey]
  if (typeof hi !== "number" || typeof lo !== "number") return []
  return [
    { mark: "H", text: fmt(hi) },
    { mark: "L", text: fmt(lo) },
  ]
}

function degrees(v: number): string {
  return `${Math.round(v)}°`
}

function percent(v: number): string {
  return `${Math.round(v)}%`
}

function uvCategory(v: number): string {
  const n = Math.round(v)
  if (n <= 2) return "Low"
  if (n <= 5) return "Moderate"
  if (n <= 7) return "High"
  if (n <= 10) return "Very high"
  return "Extreme"
}

function aqiCategory(v: number): string {
  if (v <= 50) return "Good"
  if (v <= 100) return "Moderate"
  if (v <= 150) return "Unhealthy for some"
  if (v <= 200) return "Unhealthy"
  if (v <= 300) return "Very unhealthy"
  return "Hazardous"
}

const METRICS: MetricDef[] = [
  {
    id: "temperature",
    label: "Real Temperature",
    source: "forecast",
    key: "temperature_2m",
    format: degrees,
    compact: (v) => `${Math.round(v)}°${unitLabel()}`,
    detail: (view) =>
      hiLoRows(view, "temperature_2m_max", "temperature_2m_min", degrees),
  },
  {
    id: "apparent",
    label: "Feels Like",
    source: "forecast",
    key: "apparent_temperature",
    format: degrees,
    compact: (v) => `${Math.round(v)}°${unitLabel()}`,
    detail: (view) =>
      hiLoRows(view, "apparent_temperature_max", "apparent_temperature_min", degrees),
  },
  {
    id: "humidity",
    label: "Humidity",
    source: "forecast",
    key: "relative_humidity_2m",
    format: percent,
    compact: (v) => `${Math.round(v)}% RH`,
    detail: (view) =>
      hiLoRows(view, "relative_humidity_2m_max", "relative_humidity_2m_min", percent),
  },
  {
    id: "wind",
    label: "Wind Speed + Gusts",
    source: "forecast",
    key: "wind_speed_10m",
    aux: ["wind_gusts_10m", "wind_direction_10m"],
    zeroFloor: true,
    compass: true,
    format: (v) => String(Math.round(v)),
    suffix: windUnit,
    compact: (v) => `${Math.round(v)} ${windUnit()}`,
    detail: (view, index) => {
      const rows: Row[] = []
      const gust = auxAt(view, "wind_gusts_10m", index)
      if (gust !== null) rows.push({ mark: "Gust", text: String(Math.round(gust)) })
      const max = view.daily["wind_speed_10m_max"]
      if (typeof max === "number") rows.push({ mark: "H", text: String(Math.round(max)) })
      return rows
    },
  },
  {
    id: "uv",
    label: "UV Index",
    source: "forecast",
    key: "uv_index",
    zeroFloor: true,
    format: (v) => String(Math.round(v)),
    caption: uvCategory,
    compact: (v) => `UV ${Math.round(v)}`,
    detail: (view) => {
      const max = view.daily["uv_index_max"]
      if (typeof max !== "number") return []
      return [{ mark: "H", text: String(Math.round(max)) }]
    },
  },
  {
    id: "precipitation",
    label: "Precipitation",
    source: "forecast",
    key: "precipitation_probability",
    aux: ["precipitation"],
    zeroFloor: true,
    format: percent,
    compact: (v) => `${Math.round(v)}% precip`,
    // Probability is what the chart shows, so the corner carries the amount that
    // probability is about — the hovered hour's, and the day's total.
    detail: (view, index) => {
      const rows: Row[] = []
      const amount = auxAt(view, "precipitation", index)
      if (amount !== null) rows.push({ mark: "Hr", text: formatPrecip(amount) })
      const sum = view.daily["precipitation_sum"]
      if (typeof sum === "number") rows.push({ mark: "Day", text: formatPrecip(sum) })
      return rows
    },
  },
  {
    id: "aqi",
    label: "Air Quality",
    source: "aqi",
    key: "us_aqi",
    zeroFloor: true,
    derivedExtremes: true,
    format: (v) => String(Math.round(v)),
    caption: aqiCategory,
    compact: (v) => `AQI ${Math.round(v)}`,
    detail: (view) => {
      if (!view.extremes) return []
      return [
        { mark: "H", text: String(Math.round(view.extremes.high)) },
        { mark: "L", text: String(Math.round(view.extremes.low)) },
      ]
    },
  },
]

function metricDef(id: WeatherMetric): MetricDef {
  return METRICS.find((m) => m.id === id) ?? METRICS[1]
}

function activeMetric(): MetricDef {
  return metricDef(store.sync.get("weatherMetric"))
}

// ---------------------------------------------------------------- caching

function getCachedData(): CurrentData | null {
  try {
    const raw = localStorage.getItem(LS_CACHED_DATA)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CurrentData
    // Rejects the pre-metric shape, which held a single bare `temperature`.
    if (!parsed?.values || typeof parsed.values !== "object") return null
    return parsed
  } catch {
    return null
  }
}

function setCachedData(data: CurrentData): void {
  try {
    localStorage.setItem(LS_CACHED_DATA, JSON.stringify(data))
    localStorage.setItem(LS_LAST_FETCH, String(Date.now()))
  } catch { /* quota */ }
}

function isCooldownActive(): boolean {
  try {
    const last = localStorage.getItem(LS_LAST_FETCH)
    if (!last) return false
    return Date.now() - Number(last) < COOLDOWN
  } catch {
    return false
  }
}

function getCachedSeries(): Series | null {
  try {
    const raw = localStorage.getItem(LS_HOURLY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Series
    // Rejects every earlier cache shape, none of which had a keyed `hourly` map.
    if (
      !Array.isArray(parsed?.times) ||
      !parsed?.hourly ||
      typeof parsed.hourly !== "object" ||
      typeof parsed.utcOffset !== "number" ||
      !Array.isArray(parsed.dailyDates)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function setCachedSeries(data: Series): void {
  seriesCache = data
  try {
    localStorage.setItem(LS_HOURLY, JSON.stringify(data))
  } catch { /* quota */ }
}

function getCachedAqi(): AqiData | null {
  try {
    const raw = localStorage.getItem(LS_AQI)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AqiData
    if (
      !Array.isArray(parsed?.times) ||
      !Array.isArray(parsed?.values) ||
      typeof parsed.utcOffset !== "number"
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function setCachedAqi(data: AqiData): void {
  aqiCache = data
  try {
    localStorage.setItem(LS_AQI, JSON.stringify(data))
  } catch { /* quota */ }
}

/** The window is anchored to the local hour, so a rolled-over hour needs new data. */
function seriesStale(): boolean {
  const cached = seriesCache ?? getCachedSeries()
  if (!cached) return true
  return hourBucket() !== cached.fetchedAtHour
}

function aqiStale(): boolean {
  const cached = aqiCache ?? getCachedAqi()
  if (!cached) return true
  return hourBucket() !== cached.fetchedAtHour
}

// ---------------------------------------------------------------- fetching

async function fetchWeather(): Promise<void> {
  if (!store.sync.get("weatherEnabled")) return
  if (fetchInFlight) return

  if (isCooldownActive() && !seriesStale()) {
    const cached = getCachedData()
    if (cached) {
      currentData = cached
      currentState = "loaded"
      renderTrigger()
      if (activeMetric().source === "aqi") fetchAirQuality(currentLocation)
      return
    }
  }

  if (!currentData) {
    currentState = "loading"
    renderTrigger()
  }

  fetchInFlight = true
  let coords: ResolvedLocation | null
  try {
    coords = await resolveLocation()
  } finally {
    fetchInFlight = false
  }

  currentLocation = coords
  if (!coords) {
    currentState = "no-location"
    renderTrigger()
    return
  }

  const imperial = isImperial()

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
        `&current=${[...HOURLY_VARS, "weather_code", "is_day"].join(",")}` +
        `&hourly=${HOURLY_VARS.join(",")}` +
        `&daily=${[...DAILY_VARS, ...DAILY_TIME_VARS].join(",")}` +
        `&past_days=1&forecast_days=2` +
        `&temperature_unit=${imperial ? "fahrenheit" : "celsius"}` +
        `&wind_speed_unit=${imperial ? "mph" : "kmh"}` +
        `&precipitation_unit=${imperial ? "inch" : "mm"}&timezone=auto`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()

    const values: Record<string, number | null> = {}
    for (const key of HOURLY_VARS) {
      const v = json.current?.[key]
      values[key] = typeof v === "number" ? v : null
    }
    currentData = {
      weatherCode: json.current?.weather_code ?? 0,
      isDay: json.current?.is_day !== 0,
      values,
    }
    currentState = "loaded"
    setCachedData(currentData)

    if (Array.isArray(json.hourly?.time)) {
      const hourly: Record<string, (number | null)[]> = {}
      for (const key of HOURLY_VARS) {
        if (Array.isArray(json.hourly[key])) hourly[key] = json.hourly[key]
      }
      const daily: Record<string, (number | null)[]> = {}
      for (const key of DAILY_VARS) {
        if (Array.isArray(json.daily?.[key])) daily[key] = json.daily[key]
      }
      setCachedSeries({
        times: json.hourly.time,
        hourly,
        daily,
        dailyDates: json.daily?.time ?? [],
        sun: {
          sunrise: Array.isArray(json.daily?.sunrise) ? json.daily.sunrise : [],
          sunset: Array.isArray(json.daily?.sunset) ? json.daily.sunset : [],
        },
        utcOffset: json.utc_offset_seconds ?? 0,
        timezone: json.timezone ?? "",
        fetchedAtHour: hourBucket(),
      })
    }
  } catch {
    const cached = getCachedData()
    if (cached) {
      currentData = cached
      currentState = "loaded"
    } else {
      currentState = "error"
    }
  }

  renderTrigger()
  refreshBodies()

  if (activeMetric().source === "aqi") fetchAirQuality(coords)
}

/**
 * Air quality lives on its own host and is only worth a request when the user is
 * actually looking at it, so it is fetched lazily rather than folded into the
 * forecast call.
 */
async function fetchAirQuality(coords: ResolvedLocation | null): Promise<void> {
  if (!coords || aqiInFlight) return
  if (!aqiStale()) return

  aqiInFlight = true
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${coords.lat}&longitude=${coords.lon}` +
        `&current=us_aqi&hourly=us_aqi&past_days=1&forecast_days=2&timezone=auto`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json.hourly?.time)) return

    setCachedAqi({
      times: json.hourly.time,
      values: json.hourly.us_aqi ?? [],
      current: typeof json.current?.us_aqi === "number" ? json.current.us_aqi : null,
      utcOffset: json.utc_offset_seconds ?? 0,
      fetchedAtHour: hourBucket(),
    })

    renderTrigger()
    refreshBodies()
  } catch {
    /* The body falls back to whatever is cached, or says it has nothing. */
  } finally {
    aqiInFlight = false
  }
}

// ---------------------------------------------------------------- the window

/**
 * "Now" as a wall clock at the forecast location. `timezone=auto` returns every
 * timestamp in that zone, so the whole widget reasons in it rather than in the
 * browser's — the two only differ when a city was picked by hand.
 */
function wallClock(utcOffset: number): { date: string; hour: number } {
  const d = new Date(Date.now() + utcOffset * 1000)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  return { date, hour: d.getUTCHours() }
}

/**
 * Between 03:00 and 21:00 the chart shows the whole calendar day, which is what
 * you want when most of it is still ahead of you. Outside that band the day is
 * nearly over (or has barely begun), so it rolls instead: 11 hours behind now,
 * 12 ahead.
 */
function windowIndices(
  times: string[],
  utcOffset: number
): { start: number; currentIndex: number } | null {
  if (times.length < WINDOW_HOURS) return null

  const { date, hour } = wallClock(utcOffset)
  const nowIdx = times.indexOf(`${date}T${String(hour).padStart(2, "0")}:00`)
  if (nowIdx === -1) return null

  const dayMode = hour >= DAY_WINDOW_START && hour < DAY_WINDOW_END
  const wanted = dayMode ? nowIdx - hour : nowIdx - ROLLING_OFFSET
  const start = Math.max(0, Math.min(wanted, times.length - WINDOW_HOURS))

  return { start, currentIndex: nowIdx - start }
}

/** Gaps at the edge of a model's range would otherwise break the path. */
function fillNulls(values: (number | null)[]): number[] | null {
  const out: number[] = []
  let last: number | null = null
  for (const v of values) {
    if (typeof v === "number") last = v
    out.push(last ?? NaN)
  }
  let next: number | null = null
  for (let i = out.length - 1; i >= 0; i--) {
    if (!Number.isNaN(out[i])) next = out[i]
    else if (next !== null) out[i] = next
  }
  return out.some((v) => Number.isNaN(v)) ? null : out
}

function derivedDayExtremes(
  times: string[],
  values: (number | null)[],
  date: string
): { high: number; low: number } | null {
  let high = -Infinity
  let low = Infinity
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(date)) continue
    const v = values[i]
    if (typeof v !== "number") continue
    if (v > high) high = v
    if (v < low) low = v
  }
  return high === -Infinity ? null : { high, low }
}

function buildView(def: MetricDef): MetricView | null {
  if (def.source === "aqi") {
    const aqi = aqiCache ?? getCachedAqi()
    if (!aqi) return null
    const w = windowIndices(aqi.times, aqi.utcOffset)
    if (!w) return null
    const values = fillNulls(aqi.values.slice(w.start, w.start + WINDOW_HOURS))
    if (!values) return null
    const { date } = wallClock(aqi.utcOffset)
    return {
      def,
      times: aqi.times.slice(w.start, w.start + WINDOW_HOURS),
      values,
      currentIndex: w.currentIndex,
      currentValue: aqi.current ?? values[w.currentIndex] ?? null,
      aux: {},
      daily: {},
      extremes: derivedDayExtremes(aqi.times, aqi.values, date),
    }
  }

  const series = seriesCache ?? getCachedSeries()
  if (!series) return null
  const w = windowIndices(series.times, series.utcOffset)
  if (!w) return null
  const raw = series.hourly[def.key]
  if (!Array.isArray(raw)) return null
  const values = fillNulls(raw.slice(w.start, w.start + WINDOW_HOURS))
  if (!values) return null

  const aux: Record<string, (number | null)[]> = {}
  for (const key of def.aux ?? []) {
    const arr = series.hourly[key]
    if (Array.isArray(arr)) aux[key] = arr.slice(w.start, w.start + WINDOW_HOURS)
  }

  const { date } = wallClock(series.utcOffset)
  const di = series.dailyDates.indexOf(date)
  const daily: Record<string, number | null> = {}
  if (di !== -1) {
    for (const [key, arr] of Object.entries(series.daily)) {
      const v = arr[di]
      daily[key] = typeof v === "number" ? v : null
    }
  }

  const live = currentData?.values[def.key]

  return {
    def,
    times: series.times.slice(w.start, w.start + WINDOW_HOURS),
    values,
    currentIndex: w.currentIndex,
    currentValue: typeof live === "number" ? live : (values[w.currentIndex] ?? null),
    aux,
    daily,
    extremes: def.derivedExtremes
      ? derivedDayExtremes(series.times, raw, date)
      : null,
  }
}

function hourOf(iso: string): number {
  return Number(iso.slice(11, 13))
}

function formatHour(iso: string): string {
  const h = hourOf(iso)
  if (store.sync.get("clock24Hour")) return `${String(h).padStart(2, "0")}:00`
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`
}

function formatAxisHour(iso: string): string {
  const h = hourOf(iso)
  if (store.sync.get("clock24Hour")) return String(h).padStart(2, "0")
  return `${h % 12 || 12}${h >= 12 ? "p" : "a"}`
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

// ---------------------------------------------------------------- the sun

type SolarEvent = {
  kind: "sunrise" | "sunset"
  /** The location's own wall clock, `YYYY-MM-DDTHH:MM`. */
  iso: string
  minutesAway: number
}

/**
 * Sun times carry no offset, like every other timestamp here — they are the
 * forecast location's wall clock. Reading them as UTC and comparing against a
 * "now" shifted into the same frame keeps the browser's zone out of it, which is
 * what makes a hand-picked city report its own sunset rather than yours.
 */
function parseWallClock(iso: string): number {
  return Date.parse(iso.length === 16 ? `${iso}:00Z` : `${iso}Z`)
}

/**
 * Whichever crossing comes first from now: sunset through the day, sunrise once
 * it is dark. The forecast spans yesterday through tomorrow, so tomorrow's
 * sunrise is already in hand well before midnight. Null inside a polar day or
 * night, where the API reports no crossing at all.
 */
function nextSolarEvent(): SolarEvent | null {
  const series = seriesCache ?? getCachedSeries()
  if (!series?.sun) return null

  const now = Date.now() + series.utcOffset * 1000
  let best: SolarEvent | null = null
  let bestMs = Infinity

  for (const kind of ["sunrise", "sunset"] as const) {
    for (const iso of series.sun[kind] ?? []) {
      if (typeof iso !== "string") continue
      const ms = parseWallClock(iso)
      if (!Number.isFinite(ms) || ms <= now || ms >= bestMs) continue
      bestMs = ms
      best = { kind, iso, minutesAway: Math.round((ms - now) / 60_000) }
    }
  }

  return best
}

function solarIconName(kind: SolarEvent["kind"]): string {
  return kind === "sunrise" ? "wxSunrise" : "wxSunset"
}

function solarLabel(kind: SolarEvent["kind"]): string {
  return kind === "sunrise" ? "Sunrise" : "Sunset"
}

/** Wall clock to the minute, unlike `formatHour()`, which only ever shows :00. */
function formatWallTime(iso: string): string {
  const h = Number(iso.slice(11, 13))
  const m = iso.slice(14, 16)
  if (store.sync.get("clock24Hour")) return `${String(h).padStart(2, "0")}:${m}`
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`
}

function formatCountdown(minutes: number): string {
  if (minutes < 1) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`
}

// ---------------------------------------------------------------- the chart

let gradientSeq = 0

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ""
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2
    d += `C${mx},${pts[i - 1][1]} ${mx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`
  }
  return d
}

/**
 * Drawn at the host's measured pixel size rather than a fixed viewBox that gets
 * stretched, so line weight and label size stay constant whether the body is a
 * 280px popover or a full-width card.
 */
function renderChart(
  host: HTMLElement,
  view: MetricView,
  width: number,
  height: number,
  onHover: (index: number | null) => void
): void {
  const ns = "http://www.w3.org/2000/svg"
  const gradId = `wx-grad-${gradientSeq++}`

  const labelSize = clamp(8.5, width * 0.03, 11)
  const PX = 6
  const PT = 8
  const PB = Math.round(labelSize) + 10
  const cW = width - 2 * PX
  const cH = height - PT - PB

  const values = view.values
  const rawLo = Math.min(...values)
  const rawHi = Math.max(...values)
  const spread = rawHi - rawLo
  // A flat series still needs a band to sit in; anchoring it at the bottom keeps
  // an all-zero day reading as zero rather than as "mid-range".
  const pad = spread === 0 ? Math.max(1, Math.abs(rawHi) * 0.2) : Math.max(spread * 0.06, 0.5)
  const lo = view.def.zeroFloor ? Math.min(0, rawLo) : rawLo - pad
  const hi = rawHi + pad
  const span = hi - lo || 1

  const xOf = (i: number) =>
    PX + (values.length > 1 ? (i / (values.length - 1)) * cW : cW / 2)
  const yOf = (v: number) => PT + cH - ((v - lo) / span) * cH

  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  svg.style.width = "100%"
  svg.style.height = `${height}px`
  svg.style.display = "block"
  svg.style.touchAction = "pan-y"

  const defs = document.createElementNS(ns, "defs")
  const grad = document.createElementNS(ns, "linearGradient")
  grad.id = gradId
  grad.setAttribute("x1", "0")
  grad.setAttribute("y1", "0")
  grad.setAttribute("x2", "0")
  grad.setAttribute("y2", "1")
  const s1 = document.createElementNS(ns, "stop")
  s1.setAttribute("offset", "0%")
  s1.setAttribute("stop-color", "var(--accent)")
  s1.setAttribute("stop-opacity", "0.18")
  const s2 = document.createElementNS(ns, "stop")
  s2.setAttribute("offset", "100%")
  s2.setAttribute("stop-color", "var(--accent)")
  s2.setAttribute("stop-opacity", "0")
  grad.append(s1, s2)
  defs.appendChild(grad)
  svg.appendChild(defs)

  for (let i = 0; i < 5; i++) {
    const y = PT + (i / 4) * cH
    const ln = document.createElementNS(ns, "line")
    ln.setAttribute("x1", String(PX))
    ln.setAttribute("x2", String(width - PX))
    ln.setAttribute("y1", String(y))
    ln.setAttribute("y2", String(y))
    ln.setAttribute("stroke", "currentColor")
    ln.setAttribute("stroke-opacity", "0.06")
    svg.appendChild(ln)
  }

  const step = width >= 440 ? 3 : width >= 300 ? 4 : 6
  for (let i = 0; i < view.times.length; i++) {
    if (hourOf(view.times[i]) % step !== 0) continue
    const x = xOf(i)
    if (x < PX + labelSize || x > width - PX - labelSize) continue
    const label = document.createElementNS(ns, "text")
    label.setAttribute("x", String(x))
    label.setAttribute("y", String(height - 2))
    label.setAttribute("text-anchor", "middle")
    label.setAttribute("font-size", String(labelSize))
    label.setAttribute("fill", "currentColor")
    label.setAttribute("fill-opacity", "0.35")
    label.textContent = formatAxisHour(view.times[i])
    svg.appendChild(label)
  }

  const pts: [number, number][] = values.map((v, i) => [xOf(i), yOf(v)])
  const path = smoothPath(pts)

  const fill = document.createElementNS(ns, "path")
  fill.setAttribute(
    "d",
    `${path}L${pts[pts.length - 1][0]},${PT + cH}L${pts[0][0]},${PT + cH}Z`
  )
  fill.setAttribute("fill", `url(#${gradId})`)
  svg.appendChild(fill)

  const line = document.createElementNS(ns, "path")
  line.setAttribute("d", path)
  line.setAttribute("fill", "none")
  line.setAttribute("stroke", "var(--accent)")
  line.setAttribute("stroke-width", "1.75")
  line.setAttribute("stroke-linecap", "round")
  line.setAttribute("stroke-linejoin", "round")
  svg.appendChild(line)

  const inRange = view.currentIndex >= 0 && view.currentIndex < values.length
  const nx = inRange ? xOf(view.currentIndex) : 0

  if (inRange) {
    const nowRef = document.createElementNS(ns, "line")
    nowRef.setAttribute("x1", String(nx))
    nowRef.setAttribute("x2", String(nx))
    nowRef.setAttribute("y1", String(PT))
    nowRef.setAttribute("y2", String(PT + cH))
    nowRef.setAttribute("stroke", "var(--accent)")
    nowRef.setAttribute("stroke-opacity", "0.2")
    nowRef.setAttribute("stroke-dasharray", "2 3")
    svg.appendChild(nowRef)
  }

  const nowDot = document.createElementNS(ns, "circle")
  if (inRange) {
    nowDot.setAttribute("cx", String(nx))
    nowDot.setAttribute("cy", String(yOf(values[view.currentIndex])))
    nowDot.setAttribute("r", "3")
    nowDot.setAttribute("fill", "var(--accent)")
    svg.appendChild(nowDot)
  }

  const hLine = document.createElementNS(ns, "line")
  hLine.setAttribute("y1", String(PT))
  hLine.setAttribute("y2", String(PT + cH))
  hLine.setAttribute("stroke", "var(--accent)")
  hLine.setAttribute("stroke-opacity", "0.3")
  hLine.style.display = "none"
  svg.appendChild(hLine)

  const hDot = document.createElementNS(ns, "circle")
  hDot.setAttribute("r", "3.5")
  hDot.setAttribute("fill", "var(--accent)")
  hDot.style.display = "none"
  svg.appendChild(hDot)

  const hit = document.createElementNS(ns, "rect")
  hit.setAttribute("x", "0")
  hit.setAttribute("y", "0")
  hit.setAttribute("width", String(width))
  hit.setAttribute("height", String(height))
  hit.setAttribute("fill", "transparent")
  svg.appendChild(hit)

  function clear(): void {
    hDot.style.display = "none"
    hLine.style.display = "none"
    if (inRange) nowDot.style.display = ""
    onHover(null)
  }

  hit.addEventListener("pointermove", (e: PointerEvent) => {
    const r = svg.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * width
    let near = 0
    let best = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i][0] - sx)
      if (d < best) {
        best = d
        near = i
      }
    }
    hDot.setAttribute("cx", String(pts[near][0]))
    hDot.setAttribute("cy", String(pts[near][1]))
    hDot.style.display = ""
    hLine.setAttribute("x1", String(pts[near][0]))
    hLine.setAttribute("x2", String(pts[near][0]))
    hLine.style.display = ""
    nowDot.style.display = near === view.currentIndex ? "" : "none"
    onHover(near)
  })

  hit.addEventListener("pointerleave", clear)
  hit.addEventListener("pointercancel", clear)

  host.replaceChildren(svg)
  clear()
}

// ---------------------------------------------------------------- the compass

const CARDINALS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]

function cardinal(deg: number): string {
  return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
}

/**
 * A weather vane: the needle points into the wind, at the direction the wind is
 * coming *from*, and its length tracks the speed against the day's peak so the
 * dial says something as you move along the chart.
 */
function renderCompass(
  host: HTMLElement,
  size: number,
  direction: number | null,
  speed: number | null,
  peak: number
): void {
  const ns = "http://www.w3.org/2000/svg"
  const labelSize = Math.max(8, size * 0.26)
  const height = size + labelSize + 2
  const r = size / 2 - 1.5
  const cx = size / 2
  const cy = size / 2

  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", `0 0 ${size} ${height}`)
  svg.setAttribute("width", String(size))
  svg.setAttribute("height", String(height))
  svg.style.display = "block"
  svg.setAttribute("role", "img")
  svg.setAttribute(
    "aria-label",
    direction === null
      ? "Wind direction unavailable"
      : `Wind from the ${cardinal(direction)}`
  )

  const ring = document.createElementNS(ns, "circle")
  ring.setAttribute("cx", String(cx))
  ring.setAttribute("cy", String(cy))
  ring.setAttribute("r", String(r))
  ring.setAttribute("fill", "none")
  ring.setAttribute("stroke", "currentColor")
  ring.setAttribute("stroke-opacity", "0.18")
  svg.appendChild(ring)

  for (let i = 0; i < 4; i++) {
    const a = (i * 90 * Math.PI) / 180
    const tick = document.createElementNS(ns, "line")
    const inner = i === 0 ? r * 0.68 : r * 0.82
    tick.setAttribute("x1", String(cx + Math.sin(a) * inner))
    tick.setAttribute("y1", String(cy - Math.cos(a) * inner))
    tick.setAttribute("x2", String(cx + Math.sin(a) * r))
    tick.setAttribute("y2", String(cy - Math.cos(a) * r))
    tick.setAttribute("stroke", "currentColor")
    tick.setAttribute("stroke-opacity", i === 0 ? "0.45" : "0.2")
    svg.appendChild(tick)
  }

  if (direction !== null) {
    const factor = peak > 0 && speed !== null ? clamp(0, speed / peak, 1) : 0.5
    const len = r * (0.5 + 0.42 * factor)
    const half = Math.max(1.6, r * 0.15)

    const needle = document.createElementNS(ns, "path")
    needle.setAttribute("d", `M0,${-len} L${half},${half * 0.9} L${-half},${half * 0.9} Z`)
    needle.setAttribute("fill", "var(--accent)")
    needle.setAttribute("transform", `translate(${cx} ${cy}) rotate(${direction})`)
    svg.appendChild(needle)

    const tail = document.createElementNS(ns, "path")
    tail.setAttribute("d", `M0,${r * 0.34} L${half * 0.7},${half * 0.6} L${-half * 0.7},${half * 0.6} Z`)
    tail.setAttribute("fill", "currentColor")
    tail.setAttribute("fill-opacity", "0.25")
    tail.setAttribute("transform", `translate(${cx} ${cy}) rotate(${direction})`)
    svg.appendChild(tail)
  }

  const label = document.createElementNS(ns, "text")
  label.setAttribute("x", String(cx))
  label.setAttribute("y", String(height - 1))
  label.setAttribute("text-anchor", "middle")
  label.setAttribute("font-size", String(labelSize))
  label.setAttribute("fill", "currentColor")
  label.setAttribute("fill-opacity", "0.55")
  label.textContent = direction === null ? "—" : cardinal(direction)
  svg.appendChild(label)

  host.replaceChildren(svg)
}

// ---------------------------------------------------------------- the body

function closePopover(): void {
  if (openPopoverClose) {
    openPopoverClose()
    openPopoverClose = null
  }
}

/** An inline text link that lands on the weather section of the settings dialog. */
function settingsLink(label: string): HTMLButtonElement {
  const link = document.createElement("button")
  link.type = "button"
  link.className =
    "underline underline-offset-2 hover:text-accent transition-colors"
  link.textContent = label
  link.addEventListener("click", (e) => {
    e.stopPropagation()
    closePopover()
    openSettings("widgets", "weather")
  })
  return link
}

function locationLabel(): string {
  if (currentLocation?.label) return currentLocation.label
  if (currentLocation?.source === "device") return "Current location"
  const tz = (seriesCache ?? getCachedSeries())?.timezone
  if (tz) return tz.split("/").pop()!.replace(/_/g, " ")
  return "Current location"
}

/**
 * A timezone estimate is good enough to show a temperature but is not what the
 * user asked for, so say so once, quietly, rather than leaving it implicit.
 */
function approximateNote(): HTMLElement | null {
  if (currentLocation?.source !== "timezone") return null

  const note = document.createElement("p")
  note.className = "wx-note text-popover-foreground/50 leading-snug"
  note.append(
    currentLocation.label
      ? `Approximate — estimated from your timezone (${currentLocation.label}). Set an exact location in `
      : "Approximate — estimated from your timezone. Set an exact location in ",
    settingsLink("settings"),
    "."
  )
  return note
}

/**
 * The widget's content, independent of where it is shown. Every size in it is
 * derived from the host's measured width rather than the viewport, because the
 * same builder fills a 280px popover in Immersive and a grid card everywhere
 * else. See docs/layouts.md.
 */
export function buildWeatherBody(): HTMLElement {
  const root = document.createElement("div")
  root.className = "flex flex-col gap-2 text-popover-foreground min-w-0"

  if (currentState === "no-location") {
    const p = document.createElement("p")
    p.className = "text-sm text-popover-foreground/70 leading-snug"
    p.append(
      "No location yet — your browser didn't provide one and your timezone isn't recognized. Pick a city in ",
      settingsLink("settings"),
      "."
    )
    root.appendChild(p)
    return root
  }

  if (currentState === "loading" && !currentData) {
    const p = document.createElement("p")
    p.className = "text-sm text-popover-foreground/60"
    p.textContent = "Loading…"
    root.appendChild(p)
    return root
  }

  if (currentState === "error" && !currentData) {
    const p = document.createElement("p")
    p.className = "text-sm text-popover-foreground/70"
    p.textContent = "Couldn't reach the weather service."
    root.appendChild(p)
    const btn = createButton("Retry", "outline", {
      icon: icon("refresh"),
      onClick: () => fetchWeather(),
    })
    btn.className += " self-start"
    root.appendChild(btn)
    return root
  }

  const selectRow = document.createElement("div")
  selectRow.className = "flex items-center min-w-0 -mx-1.5"

  const select = createSelect({
    options: METRICS.map((m) => ({ value: m.id, label: m.label })),
    value: store.sync.get("weatherMetric"),
    variant: "ghost",
    onChange: (v) => store.sync.set("weatherMetric", v as WeatherMetric),
  })
  selectRow.appendChild(select)
  root.appendChild(selectRow)

  const selectTrigger = select.querySelector(
    ".select__trigger"
  ) as HTMLElement | null

  const header = document.createElement("div")
  header.className = "flex items-start justify-between gap-3 min-w-0"

  const left = document.createElement("div")
  left.className = "flex flex-col min-w-0"

  const locEl = document.createElement("span")
  locEl.className = "text-popover-foreground/55 truncate leading-tight"
  locEl.textContent = locationLabel()
  left.appendChild(locEl)

  const valueRow = document.createElement("div")
  valueRow.className = "flex items-baseline gap-1.5 min-w-0"

  const valueEl = document.createElement("span")
  valueEl.className = "font-semibold tabular-nums leading-none tracking-tight"
  valueRow.appendChild(valueEl)

  const suffixEl = document.createElement("span")
  suffixEl.className = "text-popover-foreground/55 whitespace-nowrap"
  suffixEl.hidden = true
  valueRow.appendChild(suffixEl)

  const captionEl = document.createElement("span")
  captionEl.className =
    "text-popover-foreground/45 tabular-nums whitespace-nowrap truncate"
  captionEl.hidden = true
  valueRow.appendChild(captionEl)

  left.appendChild(valueRow)
  header.appendChild(left)

  const right = document.createElement("div")
  right.className = "flex items-center gap-2 shrink-0"

  const detailEl = document.createElement("div")
  detailEl.className =
    "flex flex-col items-end leading-tight tabular-nums text-popover-foreground/70"
  right.appendChild(detailEl)

  const glyphHost = document.createElement("div")
  glyphHost.className = "shrink-0 text-popover-foreground/80 flex items-center"
  right.appendChild(glyphHost)

  header.appendChild(right)
  root.appendChild(header)

  const chartHost = document.createElement("div")
  root.appendChild(chartHost)

  const emptyEl = document.createElement("p")
  emptyEl.className = "text-sm text-popover-foreground/55 py-2"
  emptyEl.hidden = true
  root.appendChild(emptyEl)

  const sunRow = document.createElement("div")
  sunRow.className =
    "flex items-center gap-1.5 min-w-0 pt-2 border-t border-popover-foreground/10"
  sunRow.hidden = true

  const sunGlyph = document.createElement("span")
  sunGlyph.className = "flex items-center text-accent shrink-0"
  sunRow.appendChild(sunGlyph)

  const sunLabel = document.createElement("span")
  sunLabel.className = "text-popover-foreground/55 whitespace-nowrap"
  sunRow.appendChild(sunLabel)

  const sunTime = document.createElement("span")
  sunTime.className = "font-medium tabular-nums truncate"
  sunRow.appendChild(sunTime)

  const sunAway = document.createElement("span")
  sunAway.className =
    "ml-auto pl-2 text-popover-foreground/40 tabular-nums whitespace-nowrap"
  sunRow.appendChild(sunAway)

  root.appendChild(sunRow)

  const note = approximateNote()
  if (note) root.appendChild(note)

  let view: MetricView | null = null
  let hostWidth = 280

  function glyphSize(): number {
    return Math.round(clamp(28, hostWidth * 0.115, 52))
  }

  function drawGlyph(index: number | null): void {
    const def = activeMetric()
    if (def.compass && view) {
      const i = index ?? view.currentIndex
      const dir = auxAt(view, "wind_direction_10m", i)
      const speed = index === null ? view.currentValue : view.values[i]
      const peak = Math.max(...view.values)
      renderCompass(glyphHost, Math.round(glyphSize() * 1.05), dir, speed, peak)
      return
    }
    if (!currentData) {
      glyphHost.replaceChildren()
      return
    }
    const info = getWeatherInfo(currentData.weatherCode)
    const glyph = icon(iconNameFor(currentData), { size: glyphSize() })
    glyph.setAttribute("role", "img")
    glyph.setAttribute("aria-label", info.condition)
    glyph.title = info.condition
    glyphHost.replaceChildren(glyph)
  }

  function showSun(): void {
    const next = nextSolarEvent()
    sunRow.hidden = next === null
    if (!next) return

    sunGlyph.replaceChildren(
      icon(solarIconName(next.kind), {
        size: Math.round(clamp(14, hostWidth * 0.055, 20)),
      })
    )
    sunLabel.textContent = solarLabel(next.kind)
    sunTime.textContent = formatWallTime(next.iso)
    sunAway.textContent = formatCountdown(next.minutesAway)
  }

  function showHovered(index: number | null): void {
    const def = activeMetric()

    if (!view) {
      valueEl.textContent = "—"
      suffixEl.hidden = true
      captionEl.hidden = true
      detailEl.replaceChildren()
      return
    }

    const atNow = index === null || index === view.currentIndex
    const value =
      atNow && view.currentValue !== null
        ? view.currentValue
        : view.values[index ?? view.currentIndex]

    valueEl.textContent = def.format(value)

    const suffix = def.suffix?.() ?? null
    suffixEl.hidden = suffix === null
    if (suffix !== null) suffixEl.textContent = suffix

    const parts: string[] = []
    if (index !== null) {
      parts.push(index === view.currentIndex ? "Now" : formatHour(view.times[index]))
    }
    if (def.caption) parts.push(def.caption(value))
    captionEl.hidden = parts.length === 0
    captionEl.textContent = parts.join(" · ")

    const rows = def.detail(view, index ?? view.currentIndex)
    detailEl.replaceChildren(
      ...rows.map((row) => {
        const el = document.createElement("span")
        const mark = document.createElement("span")
        mark.className = "text-popover-foreground/40 mr-1"
        mark.textContent = row.mark
        el.appendChild(mark)
        el.append(row.text)
        return el
      })
    )

    // Only the compass carries per-hour information; the condition icon does not,
    // and rebuilding it on every pointermove would be pure churn.
    if (def.compass) drawGlyph(index)
  }

  function render(): void {
    const def = activeMetric()
    select.value = def.id
    view = buildView(def)
    if (!def.compass) drawGlyph(null)

    const small = `${clamp(10.5, hostWidth * 0.043, 14).toFixed(2)}px`
    locEl.style.fontSize = small
    suffixEl.style.fontSize = small
    captionEl.style.fontSize = small
    detailEl.style.fontSize = small
    if (selectTrigger) selectTrigger.style.fontSize = small
    sunRow.style.fontSize = small
    if (note) note.style.fontSize = `${clamp(10, hostWidth * 0.038, 12.5).toFixed(2)}px`
    valueEl.style.fontSize = `${clamp(30, hostWidth * 0.145, 60).toFixed(2)}px`

    if (view) {
      emptyEl.hidden = true
      chartHost.hidden = false
      const height = Math.round(clamp(88, hostWidth * 0.36, 180))
      renderChart(chartHost, view, Math.round(hostWidth), height, showHovered)
    } else {
      chartHost.replaceChildren()
      chartHost.hidden = true
      emptyEl.hidden = false
      emptyEl.textContent =
        def.source !== "aqi"
          ? "No data for this metric yet."
          : aqiInFlight
            ? "Loading air quality…"
            : "Air quality isn't available for this location."
      showHovered(null)
    }

    showSun()
  }

  render()

  pruneBodies()
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width)
    if (width <= 0 || width === hostWidth) return
    hostWidth = width
    render()
  })
  observer.observe(root)
  liveBodies.add({ root, ro: observer, refresh: render, tick: showSun })

  return root
}

/**
 * The Dashboard top-row form: one reading at a glance, no chart and no metric
 * picker. Sized by its own content — the tile row packs from the left, so a
 * short location and a long one both get exactly the width they need.
 */
export function buildWeatherTile(): HTMLElement {
  const root = document.createElement("div")
  root.className = "flex items-center gap-3 min-w-0 text-popover-foreground"

  if (currentState === "no-location") {
    root.appendChild(icon("locationOff", { size: 26, class: "opacity-50" }))
    const p = document.createElement("span")
    p.className = "text-[13px] text-popover-foreground/60"
    p.append("Set a location in ", settingsLink("settings"))
    root.appendChild(p)
    return root
  }

  if (!currentData) {
    const p = document.createElement("span")
    p.className = "text-[13px] text-popover-foreground/55"
    p.textContent = currentState === "error" ? "Unavailable" : "Loading…"
    root.appendChild(p)
    return root
  }

  const info = getWeatherInfo(currentData.weatherCode)
  const glyph = icon(iconNameFor(currentData), { size: 34 })
  glyph.classList.add("shrink-0", "text-popover-foreground/85")
  glyph.setAttribute("role", "img")
  glyph.setAttribute("aria-label", info.condition)
  root.appendChild(glyph)

  const col = document.createElement("div")
  col.className = "flex flex-col gap-0.5 min-w-0"

  const def = activeMetric()
  const value = triggerValue(def)

  const headline = document.createElement("div")
  headline.className =
    "text-[30px] font-semibold leading-none tracking-tight tabular-nums whitespace-nowrap"
  headline.textContent = value === null ? "—" : def.format(value)
  col.appendChild(headline)

  const sub = document.createElement("div")
  sub.className = "text-[11px] text-popover-foreground/50 whitespace-nowrap"
  sub.textContent = [def.id === "temperature" ? null : def.label, info.condition]
    .filter(Boolean)
    .join(" · ")
  col.appendChild(sub)

  const next = nextSolarEvent()
  if (next) {
    const sun = document.createElement("div")
    sun.className =
      "flex items-center gap-1 text-[11px] text-popover-foreground/45 whitespace-nowrap"
    sun.appendChild(
      icon(solarIconName(next.kind), { size: 12, class: "text-accent" })
    )
    sun.append(`${solarLabel(next.kind)} ${formatWallTime(next.iso)}`)
    col.appendChild(sun)
  }

  root.appendChild(col)
  return root
}

function showWeatherPopover(anchor: HTMLElement): void {
  closePopover()

  const content = document.createElement("div")
  content.className = "flex flex-col w-[280px]"
  content.appendChild(buildWeatherBody())

  const { close } = createPopover(anchor, content, {
    onClose: () => {
      openPopoverClose = null
    },
  })
  openPopoverClose = close
}

// ---------------------------------------------------------------- the trigger

/** Flags an estimated location on the trigger, where there is no room to explain. */
function appendApproximateBadge(trigger: HTMLElement): void {
  if (currentLocation?.source !== "timezone") {
    trigger.removeAttribute("title")
    return
  }

  const badge = document.createElement("span")
  badge.className = "absolute -top-1 -right-1 pointer-events-none leading-none"
  badge.style.color = "var(--warning)"
  badge.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.45))"
  badge.appendChild(icon("alertTriangle", { size: 14 }))
  trigger.appendChild(badge)

  trigger.title = "Approximate location — estimated from your timezone"
}

/** The selected metric's live reading, or null while it has not arrived. */
function triggerValue(def: MetricDef): number | null {
  if (def.source === "aqi") {
    const aqi = aqiCache ?? getCachedAqi()
    return aqi?.current ?? null
  }
  const v = currentData?.values[def.key]
  return typeof v === "number" ? v : null
}

function renderTrigger(): void {
  refreshCard("weather")
  const trigger = document.getElementById(
    "weather-trigger"
  ) as HTMLButtonElement
  if (!store.sync.get("weatherEnabled")) {
    trigger.hidden = true
    return
  }
  trigger.hidden = false
  trigger.replaceChildren()
  trigger.removeAttribute("title")

  if (currentState === "no-location") {
    trigger.appendChild(icon("locationOff", { size: 24 }))
    const locLabel = document.createElement("span")
    locLabel.className = "text-xs"
    locLabel.textContent = "Set location"
    trigger.appendChild(locLabel)
    return
  }

  if (currentState === "loading") {
    const label = document.createElement("span")
    label.className = "text-xs"
    label.textContent = "Loading…"
    trigger.appendChild(label)
    return
  }

  if (currentState === "error") {
    trigger.appendChild(icon("refresh", { size: 24 }))
    return
  }

  if (currentData) {
    const info = getWeatherInfo(currentData.weatherCode)
    const glyph = icon(iconNameFor(currentData), { size: 22 })
    glyph.classList.add("shrink-0")
    trigger.appendChild(glyph)

    const def = activeMetric()
    const value = triggerValue(def)

    const label = document.createElement("span")
    label.className = "text-sm"
    label.textContent =
      value === null ? info.condition : `${def.compact(value)} ${info.condition}`
    trigger.appendChild(label)

    appendApproximateBadge(trigger)
  }
}

function clearCaches(): void {
  try {
    localStorage.removeItem(LS_LAST_FETCH)
    localStorage.removeItem(LS_CACHED_DATA)
    localStorage.removeItem(LS_HOURLY)
    localStorage.removeItem(LS_AQI)
  } catch { /* */ }
  seriesCache = null
  aqiCache = null
}

/**
 * Refetch after the location changed — settings calls this when access is
 * granted or a city is picked. The cached readings belong to the old
 * coordinates, so they have to go with it.
 */
export function refreshWeather(): void {
  clearCaches()
  currentData = null
  fetchWeather()
}

export function initWeather(): void {
  const trigger = document.getElementById(
    "weather-trigger"
  ) as HTMLButtonElement

  seriesCache = getCachedSeries()
  aqiCache = getCachedAqi()
  // So a cached render on load can still say the location is only an estimate.
  currentLocation = getStoredLocation()

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "no-location") {
      openSettings("widgets", "weather")
      return
    }
    if (currentState === "error") {
      fetchWeather()
      return
    }
    if (currentState === "loaded") {
      if (openPopoverClose) {
        closePopover()
      } else {
        showWeatherPopover(trigger)
      }
    }
  })

  store.sync.subscribe("weatherEnabled", (val) => {
    if (val) {
      fetchWeather()
      startRefreshInterval()
    } else {
      trigger.hidden = true
      closePopover()
      stopRefreshInterval()
    }
  })

  store.sync.subscribe("weatherUnit", () => {
    // The API converts server-side, so every cached number is in the old unit.
    clearCaches()
    currentData = null
    fetchWeather()
  })

  store.sync.subscribe("weatherMetric", (id) => {
    if (metricDef(id).source === "aqi") fetchAirQuality(currentLocation)
    renderTrigger()
    refreshBodies()
  })

  store.sync.subscribe("clock24Hour", () => {
    renderTrigger()
    refreshBodies()
  })

  if (store.sync.get("weatherEnabled")) {
    fetchWeather()
    startRefreshInterval()
  } else {
    trigger.hidden = true
  }
}

function startRefreshInterval(): void {
  stopRefreshInterval()
  refreshIntervalId = setInterval(() => fetchWeather(), REFRESH_INTERVAL)
  sunTickId = setInterval(() => tickBodies(), SUN_TICK_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
  if (sunTickId !== null) {
    clearInterval(sunTickId)
    sunTickId = null
  }
}

registerCard({
  id: "weather",
  title: "Weather",
  order: 20,
  regions: { default: "grid", dashboard: "top" },
  enabledKey: "weatherEnabled",
  render: buildWeatherBody,
  renderTile: buildWeatherTile,
  tileTitle: () => (currentState === "no-location" ? "Weather" : locationLabel()),
})
