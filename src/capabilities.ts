import { store } from "./store"
import {
  deviceLocationRecentlyFailed,
  geolocationPermission,
  requestDeviceLocation,
} from "./location"
import {
  cachedNativeProbe,
  getRedirectUri,
  nativeApiPresent,
  probeNativeBroker,
  webAuthAvailable,
} from "./google-auth"
import { bundledClientUsable } from "./spotify"

export type CapabilityState = "available" | "unavailable" | "degraded" | "unknown"

export type Capability = {
  id: string
  label: string
  state: CapabilityState
  detail: string
}

const ACTIVE_PROBE_TIMEOUT = 6_000

async function probeLocation(force: boolean): Promise<Capability> {
  const base = { id: "location", label: "Device location" }

  if (!navigator.geolocation) {
    return { ...base, state: "unavailable", detail: "This browser exposes no geolocation API." }
  }

  const permission = await geolocationPermission()

  if (permission === "denied") {
    return {
      ...base,
      state: "unavailable",
      detail: "Blocked for this extension in your browser's site settings.",
    }
  }

  if (force) {
    const result = await requestDeviceLocation(ACTIVE_PROBE_TIMEOUT)
    if (result.ok) {
      return { ...base, state: "available", detail: "Returned a position." }
    }
    return {
      ...base,
      state: "unavailable",
      detail:
        result.reason === "denied"
          ? "Blocked for this extension in your browser's site settings."
          : "Permission is granted, but no position came back — the browser's network locator is blocked or absent.",
    }
  }

  if (deviceLocationRecentlyFailed()) {
    return {
      ...base,
      state: "unavailable",
      detail: "The last request returned no position. Re-check to try again.",
    }
  }

  if (permission === "prompt" || permission === "unknown") {
    return { ...base, state: "unknown", detail: "Not requested yet." }
  }

  return { ...base, state: "available", detail: "Permission granted." }
}

async function probeGoogleBroker(force: boolean): Promise<Capability> {
  const base = { id: "google-broker", label: "Browser Google account" }

  if (!nativeApiPresent()) {
    return { ...base, state: "unavailable", detail: "identity.getAuthToken is not implemented." }
  }

  if (!force && cachedNativeProbe() === null) {
    return { ...base, state: "unknown", detail: "Not probed yet." }
  }

  const probe = await probeNativeBroker(force)
  return probe === "available"
    ? { ...base, state: "available", detail: "The token broker responds." }
    : {
        ...base,
        state: "unavailable",
        detail: "The token broker never answers — Google sign-in is disabled in this build.",
      }
}

function probeWebAuth(): Capability {
  const base = { id: "web-auth", label: "Redirect sign-in" }

  if (!webAuthAvailable()) {
    return { ...base, state: "unavailable", detail: "identity.launchWebAuthFlow is not implemented." }
  }

  const redirect = getRedirectUri()
  return {
    ...base,
    state: "available",
    detail: redirect ? `Redirects to ${redirect}` : "Available.",
  }
}

function summarizeCalendar(broker: Capability, web: Capability): Capability {
  const base = { id: "calendar-auth", label: "Calendar sign-in" }

  if (broker.state === "available") {
    return { ...base, state: "available", detail: "Uses your browser's Google account." }
  }

  if (web.state !== "available") {
    return { ...base, state: "unavailable", detail: "No usable sign-in path in this browser." }
  }

  if (!store.sync.get("googleClientId").trim()) {
    return {
      ...base,
      state: "degraded",
      detail: "Needs a Google OAuth client ID — add one above to sign in.",
    }
  }

  return { ...base, state: "available", detail: "Uses the redirect flow with your own OAuth client." }
}

/**
 * The bundled Spotify app's redirect allowlist is fixed, so it only works where
 * the browser's redirect URI could be on it. Everywhere else the user supplies
 * their own app — same shape as the calendar's fallback.
 */
function summarizeSpotify(web: Capability): Capability {
  const base = { id: "spotify-auth", label: "Spotify sign-in" }

  if (web.state !== "available") {
    return { ...base, state: "unavailable", detail: "No usable sign-in path in this browser." }
  }

  if (store.sync.get("spotifyClientId").trim()) {
    return { ...base, state: "available", detail: "Uses your own Spotify app." }
  }

  if (!bundledClientUsable()) {
    return {
      ...base,
      state: "degraded",
      detail: "This browser's redirect URI isn't on the built-in app — add a Spotify client ID above to connect.",
    }
  }

  return { ...base, state: "available", detail: "Uses the built-in Spotify app." }
}

export async function probeCapabilities(force = false): Promise<Capability[]> {
  const [location, broker] = await Promise.all([
    probeLocation(force),
    probeGoogleBroker(force),
  ])
  const web = probeWebAuth()

  return [location, broker, web, summarizeCalendar(broker, web), summarizeSpotify(web)]
}
