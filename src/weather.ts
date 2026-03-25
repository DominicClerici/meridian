import { store } from "./store"

type WeatherData = {
  temperature: number
  weatherCode: number
}

type WeatherInfo = {
  icon: string
  condition: string
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
const COOLDOWN = 120_000
const REFRESH_INTERVAL = 300_000

type State = "no-permission" | "loading" | "loaded" | "error"

let currentState: State = "loading"
let currentData: WeatherData | null = null
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let openPopover: HTMLElement | null = null

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
        if (lat !== null && lon !== null) {
          resolve({ lat, lon })
        } else {
          resolve(null)
        }
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
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const data: WeatherData = {
      temperature: json.current.temperature_2m,
      weatherCode: json.current.weather_code,
    }
    currentData = data
    currentState = "loaded"
    setCachedData(data)
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

function closeWeatherPopover(): void {
  if (openPopover) {
    openPopover.remove()
    openPopover = null
  }
}

function renderTrigger(): void {
  const trigger = document.getElementById("weather-trigger") as HTMLButtonElement
  if (!store.sync.get("weatherEnabled")) {
    trigger.hidden = true
    return
  }
  trigger.hidden = false

  if (currentState === "no-permission") {
    trigger.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg> <span class="text-xs">Enable location</span>`
    return
  }

  if (currentState === "loading") {
    trigger.innerHTML = `<span class="text-xs">Loading...</span>`
    return
  }

  if (currentState === "error") {
    trigger.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`
    return
  }

  if (currentData) {
    const info = getWeatherInfo(currentData.weatherCode)
    const unit = store.sync.get("weatherUnit")
    const temp = Math.round(currentData.temperature)
    trigger.innerHTML = `<span>${info.icon}</span> <span class="text-sm">${temp}\u00B0${unit.toUpperCase()} ${info.condition}</span>`
  }
}

function showWeatherPopover(anchor: HTMLElement): void {
  closeWeatherPopover()
  const popover = document.createElement("div")
  popover.className = "fixed bg-popover text-popover-foreground rounded-lg shadow-lg p-3 min-w-[200px]"

  document.body.appendChild(popover)
  const rect = anchor.getBoundingClientRect()
  popover.style.right = (window.innerWidth - rect.right) + "px"
  popover.style.top = (rect.bottom + 4) + "px"
  openPopover = popover

  const onClickOutside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      closeWeatherPopover()
      document.removeEventListener("click", onClickOutside)
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0)
}

export function initWeather(): void {
  const trigger = document.getElementById("weather-trigger") as HTMLButtonElement
  const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (currentState === "no-permission") {
      settingsDialog.showModal()
      return
    }
    if (currentState === "loaded") {
      if (openPopover) {
        closeWeatherPopover()
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
      closeWeatherPopover()
      stopRefreshInterval()
    }
  })

  store.sync.subscribe("weatherUnit", () => {
    try {
      localStorage.removeItem(LS_LAST_FETCH)
      localStorage.removeItem(LS_CACHED_DATA)
    } catch { /* */ }
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
