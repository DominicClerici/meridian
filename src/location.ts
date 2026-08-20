import { store } from "./store"
import type { LocationSource } from "./defaults"
import { coordsForTimezone, currentTimezone } from "./timezone-coords"

export type GeoFailure = "denied" | "unavailable" | "timeout" | "unsupported"

export type DeviceLocationResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: GeoFailure }

export type ResolvedLocation = {
  lat: number
  lon: number
  label: string | null
  source: LocationSource
}

export type GeocodeResult = { lat: number; lon: number; label: string }

const GEO_TIMEOUT = 10_000
const LS_DEVICE_FAILED = "sp:geo:deviceFailed"

/**
 * How long to stop retrying the device locator after it fails. On a de-Googled
 * Chromium the network locator is blocked permanently, so retrying on every
 * 5-minute refresh would just burn a 10s timeout and spam the console.
 */
const DEVICE_RETRY_BACKOFF = 6 * 3_600_000

export const GEO_FAILURE_TEXT: Record<GeoFailure, string> = {
  denied:
    "Location access is blocked for this extension. Allow it in your browser's site settings, or set a location manually below.",
  unavailable:
    "Your browser has no working location provider. De-Googled Chromium builds block the network locator entirely — set a location manually below.",
  timeout:
    "The location request timed out. Try again, or set a location manually below.",
  unsupported:
    "This browser doesn't expose a geolocation API. Set a location manually below.",
}

export function requestDeviceLocation(
  timeout = GEO_TIMEOUT
): Promise<DeviceLocationResult> {
  if (!navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: "unsupported" })
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: DeviceLocationResult) => {
      if (settled) return
      settled = true
      if (result.ok) clearDeviceFailure()
      else recordDeviceFailure()
      resolve(result)
    }

    // A blocked network locator can leave getCurrentPosition hanging past its
    // own timeout, so back it with a wall-clock one.
    const guard = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeout + 2000)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard)
        finish({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      (err) => {
        clearTimeout(guard)
        const reason: GeoFailure =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable"
        finish({ ok: false, reason })
      },
      { timeout, maximumAge: 600_000 }
    )
  })
}

function recordDeviceFailure(): void {
  try {
    localStorage.setItem(LS_DEVICE_FAILED, String(Date.now()))
  } catch { /* quota */ }
}

function clearDeviceFailure(): void {
  try {
    localStorage.removeItem(LS_DEVICE_FAILED)
  } catch { /* security */ }
}

export function deviceLocationRecentlyFailed(): boolean {
  try {
    const raw = localStorage.getItem(LS_DEVICE_FAILED)
    if (!raw) return false
    return Date.now() - Number(raw) < DEVICE_RETRY_BACKOFF
  } catch {
    return false
  }
}

export async function geolocationPermission(): Promise<PermissionState | "unknown"> {
  try {
    if (!navigator.permissions?.query) return "unknown"
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    })
    return status.state
  } catch {
    return "unknown"
  }
}

export async function searchCity(
  query: string,
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
    { signal }
  )
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`)

  const json = await res.json()
  return ((json.results ?? []) as Record<string, unknown>[]).map((r) => ({
    lat: r.latitude as number,
    lon: r.longitude as number,
    label: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
  }))
}

export function guessFromTimezone(): ResolvedLocation | null {
  const tz = currentTimezone()
  if (!tz) return null
  const guess = coordsForTimezone(tz)
  if (!guess) return null
  return { lat: guess.lat, lon: guess.lon, label: guess.label, source: "timezone" }
}

export function setLocation(
  lat: number,
  lon: number,
  label: string | null,
  source: LocationSource
): void {
  const unchanged =
    store.local.get("weatherLat") === lat &&
    store.local.get("weatherLon") === lon &&
    store.local.get("weatherLocationLabel") === label &&
    store.local.get("weatherLocationSource") === source
  if (unchanged) return

  store.local.set("weatherLat", lat)
  store.local.set("weatherLon", lon)
  store.local.set("weatherLocationLabel", label)
  store.local.set("weatherLocationSource", source)
}

export function clearLocation(): void {
  store.local.delete("weatherLat")
  store.local.delete("weatherLon")
  store.local.delete("weatherLocationLabel")
  store.local.delete("weatherLocationSource")
  clearDeviceFailure()
}

export function getStoredLocation(): ResolvedLocation | null {
  const lat = store.local.get("weatherLat")
  const lon = store.local.get("weatherLon")
  if (lat === null || lon === null) return null
  return {
    lat,
    lon,
    label: store.local.get("weatherLocationLabel"),
    source: store.local.get("weatherLocationSource") ?? "device",
  }
}

/**
 * The fallback chain: an explicit manual pick always wins, then the device
 * locator, then whatever was last stored, then a timezone estimate. Returns
 * `null` only when every source is exhausted — which means an unmapped timezone
 * and no stored coordinates, and the UI should ask for a city.
 */
export async function resolveLocation(): Promise<ResolvedLocation | null> {
  const stored = getStoredLocation()
  if (stored?.source === "manual") return stored

  if (!deviceLocationRecentlyFailed()) {
    const device = await requestDeviceLocation()
    if (device.ok) {
      setLocation(device.lat, device.lon, null, "device")
      return { lat: device.lat, lon: device.lon, label: null, source: "device" }
    }
  }

  if (stored) return stored

  const guess = guessFromTimezone()
  if (guess) {
    setLocation(guess.lat, guess.lon, guess.label, "timezone")
    return guess
  }

  return null
}
