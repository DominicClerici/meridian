import { store } from "./store"

const CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID"
const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

function getRedirectURL(): string {
  const api = globalThis.browser ?? globalThis.chrome
  return api!.identity.getRedirectURL()
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(96)
  crypto.getRandomValues(array)
  return base64UrlEncode(array.buffer)
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  return crypto.subtle.digest("SHA-256", encoder.encode(plain))
}

async function authenticate(): Promise<boolean> {
  const api = globalThis.browser ?? globalThis.chrome
  if (!api?.identity) return false

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier))
  const redirectUri = getRedirectURL()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  })

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`

  let responseUrl: string
  try {
    responseUrl = await api.identity.launchWebAuthFlow({ url: authUrl, interactive: true })
  } catch {
    return false
  }

  if (!responseUrl) return false
  const code = new URL(responseUrl).searchParams.get("code")
  if (!code) return false

  try {
    const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })

    if (!tokenRes.ok) return false

    const tokenData = await tokenRes.json()
    store.local.set("spotifyAccessToken", tokenData.access_token)
    store.local.set("spotifyRefreshToken", tokenData.refresh_token)
    store.local.set("spotifyTokenExpiry", Date.now() + tokenData.expires_in * 1000)
    return true
  } catch {
    return false
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = store.local.get("spotifyRefreshToken")
  if (!refreshToken) return false

  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) {
      clearTokens()
      return false
    }

    const data = await res.json()
    store.local.set("spotifyAccessToken", data.access_token)
    if (data.refresh_token) {
      store.local.set("spotifyRefreshToken", data.refresh_token)
    }
    store.local.set("spotifyTokenExpiry", Date.now() + data.expires_in * 1000)
    return true
  } catch {
    return false
  }
}

function clearTokens(): void {
  store.local.delete("spotifyAccessToken")
  store.local.delete("spotifyRefreshToken")
  store.local.delete("spotifyTokenExpiry")
}

async function ensureValidToken(): Promise<boolean> {
  const token = store.local.get("spotifyAccessToken")
  if (!token) return false

  const expiry = store.local.get("spotifyTokenExpiry")
  if (!expiry || Date.now() > expiry - 60_000) {
    return refreshAccessToken()
  }
  return true
}

type SpotifyTrack = {
  name: string
  artists: string
  albumArt: string | null
}

type PlayerState = {
  track: SpotifyTrack
  isPlaying: boolean
}

let isPremium = true

async function spotifyFetch(url: string, options?: RequestInit): Promise<Response | null> {
  const valid = await ensureValidToken()
  if (!valid) return null

  const token = store.local.get("spotifyAccessToken")
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })

  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) return null
    const newToken = store.local.get("spotifyAccessToken")
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${newToken}`,
        ...options?.headers,
      },
    })
  }

  return res
}

async function checkPremium(): Promise<void> {
  try {
    const res = await spotifyFetch("https://api.spotify.com/v1/me")
    if (res && res.ok) {
      const data = await res.json()
      isPremium = data.product === "premium"
    }
  } catch {
    // default isPremium stays true
  }
}

let currentPlayerState: PlayerState | null = null
let retryAfterUntil = 0

async function fetchPlayerState(): Promise<void> {
  if (Date.now() < retryAfterUntil) return

  try {
    const res = await spotifyFetch("https://api.spotify.com/v1/me/player")
    if (!res) {
      currentPlayerState = null
      return
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || 5)
      retryAfterUntil = Date.now() + retryAfter * 1000
      return
    }

    if (res.status === 204 || !res.ok) {
      currentPlayerState = null
      return
    }

    const data = await res.json()
    if (!data.item) {
      currentPlayerState = null
      return
    }

    currentPlayerState = {
      track: {
        name: data.item.name,
        artists: data.item.artists.map((a: { name: string }) => a.name).join(", "),
        albumArt: data.item.album?.images?.[0]?.url ?? null,
      },
      isPlaying: data.is_playing,
    }
  } catch {
    currentPlayerState = null
  }
}

async function playerPlay(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/play", { method: "PUT" })
  return res !== null && (res.ok || res.status === 204)
}

async function playerPause(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/pause", { method: "PUT" })
  return res !== null && (res.ok || res.status === 204)
}

async function playerNext(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/next", { method: "POST" })
  return res !== null && (res.ok || res.status === 204)
}

async function playerPrevious(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/previous", { method: "POST" })
  return res !== null && (res.ok || res.status === 204)
}

const POLL_INTERVAL = 5000
let pollIntervalId: ReturnType<typeof setInterval> | null = null

function startPolling(): void {
  stopPolling()
  poll()
  pollIntervalId = setInterval(poll, POLL_INTERVAL)
}

function stopPolling(): void {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId)
    pollIntervalId = null
  }
}

async function poll(): Promise<void> {
  await fetchPlayerState()
  renderCard()
}

function setupVisibilityHandler(): void {
  document.addEventListener("visibilitychange", () => {
    if (!store.sync.get("spotifyEnabled")) return
    if (!store.local.get("spotifyAccessToken")) return

    if (document.hidden) {
      stopPolling()
    } else {
      startPolling()
    }
  })
}

let cardEl: HTMLElement | null = null
let controlsDisabled = false
let loadingAction: string | null = null

function renderCard(): void {}
