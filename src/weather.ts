import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover } from "./components"

type WeatherData = {
  temperature: number
  weatherCode: number
}

type WeatherInfo = {
  icon: string
  condition: string
}

type HourlyCache = {
  times: string[]
  temps: number[]
  currentIndex: number
  fetchedAtHour: number
}

const WEATHER_MAP: Record<number, WeatherInfo> = {
  0: { icon: "\u2600\uFE0F", condition: "Clear sky" },
  1: { icon: "\uD83C\uDF24\uFE0F", condition: "Mainly clear" },
  2: { icon: "\u26C5", condition: "Partly cloudy" },
  3: { icon: "\u2601\uFE0F", condition: "Overcast" },
  45: { icon: "\uD83C\uDF2B\uFE0F", condition: "Fog" },
  48: { icon: "\uD83C\uDF2B\uFE0F", condition: "Fog" },
  51: { icon: "\uD83C\uDF26\uFE0F", condition: "Light drizzle" },
  53: { icon: "\uD83C\uDF26\uFE0F", condition: "Drizzle" },
  55: { icon: "\uD83C\uDF26\uFE0F", condition: "Dense drizzle" },
  56: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing drizzle" },
  57: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing drizzle" },
  61: { icon: "\uD83C\uDF27\uFE0F", condition: "Light rain" },
  63: { icon: "\uD83C\uDF27\uFE0F", condition: "Rain" },
  65: { icon: "\uD83C\uDF27\uFE0F", condition: "Heavy rain" },
  66: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing rain" },
  67: { icon: "\uD83C\uDF27\uFE0F", condition: "Freezing rain" },
  71: { icon: "\u2744\uFE0F", condition: "Light snow" },
  73: { icon: "\u2744\uFE0F", condition: "Snow" },
  75: { icon: "\u2744\uFE0F", condition: "Heavy snow" },
  77: { icon: "\u2744\uFE0F", condition: "Snow grains" },
  80: { icon: "\uD83C\uDF27\uFE0F", condition: "Light showers" },
  81: { icon: "\uD83C\uDF27\uFE0F", condition: "Showers" },
  82: { icon: "\uD83C\uDF27\uFE0F", condition: "Heavy showers" },
  85: { icon: "\u2744\uFE0F", condition: "Snow showers" },
  86: { icon: "\u2744\uFE0F", condition: "Heavy snow showers" },
  95: { icon: "\u26C8\uFE0F", condition: "Thunderstorm" },
  96: { icon: "\u26C8\uFE0F", condition: "Thunderstorm with hail" },
  99: { icon: "\u26C8\uFE0F", condition: "Thunderstorm with hail" },
}

function getWeatherInfo(code: number): WeatherInfo {
  return WEATHER_MAP[code] ?? { icon: "\u2753", condition: "Unknown" }
}

const LS_LAST_FETCH = "sp:weather:lastFetch"
const LS_CACHED_DATA = "sp:weather:cachedData"
const LS_HOURLY = "sp:weather:hourlyData"
const COOLDOWN = 120_000
const REFRESH_INTERVAL = 300_000

type State = "no-permission" | "loading" | "loaded" | "error"

let currentState: State = "loading"
let currentData: WeatherData | null = null
let hourlyCache: HourlyCache | null = null
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let openPopoverClose: (() => void) | null = null

function getCachedData(): WeatherData | null {
  try {
    const raw = localStorage.getItem(LS_CACHED_DATA)
    if (!raw) return null
    return JSON.parse(raw) as WeatherData
  } catch {
    return null
  }
}

function setCachedData(data: WeatherData): void {
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

function getCachedHourly(): HourlyCache | null {
  try {
    const raw = localStorage.getItem(LS_HOURLY)
    if (!raw) return null
    return JSON.parse(raw) as HourlyCache
  } catch {
    return null
  }
}

function setCachedHourly(data: HourlyCache): void {
  hourlyCache = data
  try {
    localStorage.setItem(LS_HOURLY, JSON.stringify(data))
  } catch { /* quota */ }
}

function clearHourlyCache(): void {
  hourlyCache = null
  try { localStorage.removeItem(LS_HOURLY) } catch { /* */ }
}

function shouldRefetchHourly(currentTemp: number): boolean {
  const cached = hourlyCache ?? getCachedHourly()
  if (!cached) return true
  const currentHour = Math.floor(Date.now() / 3_600_000)
  if (currentHour !== cached.fetchedAtHour) return true
  if (Math.round(cached.temps[cached.currentIndex]) !== Math.round(currentTemp)) return true
  return false
}

function getCoordinates(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        store.local.set("weatherLat", coords.lat)
        store.local.set("weatherLon", coords.lon)
        resolve(coords)
      },
      () => {
        const lat = store.local.get("weatherLat")
        const lon = store.local.get("weatherLon")
        if (lat !== null && lon !== null) resolve({ lat, lon })
        else resolve(null)
      },
      { timeout: 10000 }
    )
  })
}

async function fetchWeather(): Promise<void> {
  if (!store.sync.get("weatherEnabled")) return

  if (isCooldownActive()) {
    const cached = getCachedData()
    if (cached) {
      currentData = cached
      currentState = "loaded"
      renderTrigger()
      if (shouldRefetchHourly(cached.temperature)) fetchHourlyData()
      return
    }
  }

  currentState = "loading"
  renderTrigger()

  const coords = await getCoordinates()
  if (!coords) {
    currentState = "no-permission"
    renderTrigger()
    return
  }

  const unit = store.sync.get("weatherUnit")
  const tempUnit = unit === "c" ? "celsius" : "fahrenheit"

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    currentData = {
      temperature: json.current.temperature_2m,
      weatherCode: json.current.weather_code,
    }
    currentState = "loaded"
    setCachedData(currentData)
    if (shouldRefetchHourly(currentData.temperature)) fetchHourlyData()
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
}

async function fetchHourlyData(): Promise<void> {
  const lat = store.local.get("weatherLat")
  const lon = store.local.get("weatherLon")
  if (lat === null || lon === null) return

  const unit = store.sync.get("weatherUnit")
  const tempUnit = unit === "c" ? "celsius" : "fahrenheit"

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&past_hours=12&forecast_hours=13&temperature_unit=${tempUnit}&timezone=auto`
    )
    if (!res.ok) return
    const json = await res.json()
    setCachedHourly({
      times: json.hourly.time,
      temps: json.hourly.temperature_2m,
      currentIndex: 12,
      fetchedAtHour: Math.floor(Date.now() / 3_600_000),
    })
  } catch { /* keep existing cache */ }
}

function formatHour(index: number, currentIndex: number): string {
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())
  const h = new Date(base.getTime() + (index - currentIndex) * 3_600_000).getHours()
  if (store.sync.get("clock24Hour")) return `${String(h).padStart(2, "0")}:00`
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ""
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2
    d += `C${mx},${pts[i - 1][1]} ${mx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`
  }
  return d
}

function buildChart(data: HourlyCache, unit: string): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1"

  const rounded = data.temps.map((t) => Math.round(t))
  const uLabel = unit.toUpperCase()

  const header = document.createElement("div")
  header.className = "flex items-center justify-between px-0.5"
  const timeEl = document.createElement("span")
  timeEl.className = "text-[11px] text-popover-foreground/50 tabular-nums"
  const tempEl = document.createElement("span")
  tempEl.className = "text-sm font-semibold text-popover-foreground tabular-nums"
  header.appendChild(timeEl)
  header.appendChild(tempEl)
  wrap.appendChild(header)

  const W = 280,
    H = 96
  const PX = 6,
    PT = 10,
    PB = 6
  const cW = W - 2 * PX,
    cH = H - PT - PB

  const lo = Math.min(...rounded) - 1
  const hi = Math.max(...rounded) + 1
  const span = hi - lo

  const xOf = (i: number) => PX + (i / (data.temps.length - 1)) * cW
  const yOf = (t: number) => PT + cH - ((Math.round(t) - lo) / span) * cH

  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
  svg.style.width = "100%"
  svg.style.height = "auto"
  svg.style.display = "block"

  const defs = document.createElementNS(ns, "defs")
  const grad = document.createElementNS(ns, "linearGradient")
  grad.id = "wg"
  grad.setAttribute("x1", "0")
  grad.setAttribute("y1", "0")
  grad.setAttribute("x2", "0")
  grad.setAttribute("y2", "1")
  const s1 = document.createElementNS(ns, "stop")
  s1.setAttribute("offset", "0%")
  s1.setAttribute("stop-color", "var(--accent)")
  s1.setAttribute("stop-opacity", "0.15")
  const s2 = document.createElementNS(ns, "stop")
  s2.setAttribute("offset", "100%")
  s2.setAttribute("stop-color", "var(--accent)")
  s2.setAttribute("stop-opacity", "0")
  grad.append(s1, s2)
  defs.appendChild(grad)
  svg.appendChild(defs)

  for (let i = 0; i < 6; i++) {
    const y = PT + (i / 5) * cH
    const ln = document.createElementNS(ns, "line")
    ln.setAttribute("x1", String(PX))
    ln.setAttribute("x2", String(W - PX))
    ln.setAttribute("y1", String(y))
    ln.setAttribute("y2", String(y))
    ln.setAttribute("stroke", "currentColor")
    ln.setAttribute("stroke-opacity", "0.06")
    svg.appendChild(ln)
  }

  const pts: [number, number][] = data.temps.map((t, i) => [xOf(i), yOf(t)])
  const path = smoothPath(pts)

  const fill = document.createElementNS(ns, "path")
  fill.setAttribute(
    "d",
    `${path}L${pts[pts.length - 1][0]},${H - PB}L${pts[0][0]},${H - PB}Z`
  )
  fill.setAttribute("fill", "url(#wg)")
  svg.appendChild(fill)

  const line = document.createElementNS(ns, "path")
  line.setAttribute("d", path)
  line.setAttribute("fill", "none")
  line.setAttribute("stroke", "var(--accent)")
  line.setAttribute("stroke-width", "1.5")
  line.setAttribute("stroke-linecap", "round")
  svg.appendChild(line)

  const nx = xOf(data.currentIndex)

  const nowRef = document.createElementNS(ns, "line")
  nowRef.setAttribute("x1", String(nx))
  nowRef.setAttribute("x2", String(nx))
  nowRef.setAttribute("y1", String(PT))
  nowRef.setAttribute("y2", String(H - PB))
  nowRef.setAttribute("stroke", "var(--accent)")
  nowRef.setAttribute("stroke-opacity", "0.15")
  nowRef.setAttribute("stroke-dasharray", "2 2")
  svg.appendChild(nowRef)

  const nowDot = document.createElementNS(ns, "circle")
  nowDot.setAttribute("cx", String(nx))
  nowDot.setAttribute("cy", String(yOf(data.temps[data.currentIndex])))
  nowDot.setAttribute("r", "3")
  nowDot.setAttribute("fill", "var(--accent)")
  svg.appendChild(nowDot)

  const hDot = document.createElementNS(ns, "circle")
  hDot.setAttribute("r", "3.5")
  hDot.setAttribute("fill", "var(--accent)")
  hDot.style.display = "none"
  svg.appendChild(hDot)

  const hLine = document.createElementNS(ns, "line")
  hLine.setAttribute("y1", String(PT))
  hLine.setAttribute("y2", String(H - PB))
  hLine.setAttribute("stroke", "var(--accent)")
  hLine.setAttribute("stroke-opacity", "0.25")
  hLine.style.display = "none"
  svg.appendChild(hLine)

  const hit = document.createElementNS(ns, "rect")
  hit.setAttribute("x", "0")
  hit.setAttribute("y", "0")
  hit.setAttribute("width", String(W))
  hit.setAttribute("height", String(H))
  hit.setAttribute("fill", "transparent")
  svg.appendChild(hit)

  function showDefault() {
    timeEl.textContent = "Now"
    tempEl.textContent = `${rounded[data.currentIndex]}\u00B0${uLabel}`
    hDot.style.display = "none"
    hLine.style.display = "none"
    nowDot.style.display = ""
  }
  showDefault()

  hit.addEventListener("mousemove", (e: MouseEvent) => {
    const r = svg.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * W
    let near = 0,
      best = Infinity
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
    nowDot.style.display = near === data.currentIndex ? "" : "none"
    timeEl.textContent =
      near === data.currentIndex ? "Now" : formatHour(near, data.currentIndex)
    tempEl.textContent = `${rounded[near]}\u00B0${uLabel}`
  })

  hit.addEventListener("mouseleave", showDefault)

  wrap.appendChild(svg)
  return wrap
}

function closePopover(): void {
  if (openPopoverClose) {
    openPopoverClose()
    openPopoverClose = null
  }
}

function showWeatherPopover(anchor: HTMLElement): void {
  closePopover()

  const content = document.createElement("div")
  content.className = "flex flex-col w-[280px]"

  const cached = hourlyCache ?? getCachedHourly()
  if (cached) {
    content.appendChild(buildChart(cached, store.sync.get("weatherUnit")))
  } else if (currentData) {
    const info = getWeatherInfo(currentData.weatherCode)
    const unit = store.sync.get("weatherUnit")
    const temp = Math.round(currentData.temperature)
    const p = document.createElement("p")
    p.className = "text-sm text-popover-foreground"
    p.textContent = `${info.icon} ${temp}\u00B0${unit.toUpperCase()} \u00B7 ${info.condition}`
    content.appendChild(p)
  }

  const { close } = createPopover(anchor, content, {
    onClose: () => {
      openPopoverClose = null
    },
  })
  openPopoverClose = close
}

function renderTrigger(): void {
  const trigger = document.getElementById(
    "weather-trigger"
  ) as HTMLButtonElement
  if (!store.sync.get("weatherEnabled")) {
    trigger.hidden = true
    return
  }
  trigger.hidden = false

  if (currentState === "no-permission") {
    trigger.innerHTML = ""
    trigger.appendChild(icon("locationOff", { size: 24 }))
    const locLabel = document.createElement("span")
    locLabel.className = "text-xs"
    locLabel.textContent = "Enable location"
    trigger.appendChild(locLabel)
    return
  }

  if (currentState === "loading") {
    trigger.innerHTML = `<span class="text-xs">Loading...</span>`
    return
  }

  if (currentState === "error") {
    trigger.innerHTML = ""
    trigger.appendChild(icon("refresh", { size: 24 }))
    return
  }

  if (currentData) {
    const info = getWeatherInfo(currentData.weatherCode)
    const unit = store.sync.get("weatherUnit")
    const temp = Math.round(currentData.temperature)
    trigger.innerHTML = `<span>${info.icon}</span> <span class="text-sm">${temp}\u00B0${unit.toUpperCase()} ${info.condition}</span>`
  }
}

export function initWeather(): void {
  const trigger = document.getElementById(
    "weather-trigger"
  ) as HTMLButtonElement
  const settingsDialog = document.getElementById(
    "settings-dialog"
  ) as HTMLDialogElement

  hourlyCache = getCachedHourly()

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "no-permission") {
      settingsDialog.showModal()
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
    try {
      localStorage.removeItem(LS_LAST_FETCH)
      localStorage.removeItem(LS_CACHED_DATA)
    } catch { /* */ }
    clearHourlyCache()
    fetchWeather()
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
}

function stopRefreshInterval(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
}
