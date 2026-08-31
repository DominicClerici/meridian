import { store } from "./store"
import { getLayout, refreshCard, refreshCards, registerCard } from "./layout"
import { getIconSvg } from "./icons/registry"

/**
 * The extension's own Spotify app. Its redirect allowlist is fixed, and the
 * only redirect URI that can be on it is the `chromiumapp.org` one Chromium
 * hands out — Firefox's `identity.getRedirectURL()` returns a host containing a
 * UUID regenerated per *installation*, which cannot be registered ahead of
 * time. So Firefox users bring their own Spotify app; see `docs/spotify.md`.
 */
const BUNDLED_CLIENT_ID = "acd29601607e4e1c8896ab4c1ab534d7"
const BUNDLED_REDIRECT_HOST = ".chromiumapp.org"

const SCOPES =
  "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private"
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

function getRedirectURL(): string | null {
  try {
    const api = globalThis.browser ?? globalThis.chrome
    return api?.identity?.getRedirectURL() ?? null
  } catch {
    return null
  }
}

/**
 * Whether the bundled app could have this browser's redirect URI registered.
 * Keyed off the URI itself rather than the browser name — that URI is the thing
 * that has to match the registration, so it is the real test.
 */
export function bundledClientUsable(): boolean {
  const redirect = getRedirectURL()
  if (!redirect) return false
  try {
    return new URL(redirect).hostname.endsWith(BUNDLED_REDIRECT_HOST)
  } catch {
    return false
  }
}

/** The user's own client ID if set, else the bundled one where it can work. */
function getClientId(): string | null {
  const own = store.sync.get("spotifyClientId").trim()
  if (own) return own
  return bundledClientUsable() ? BUNDLED_CLIENT_ID : null
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

export type SpotifyAuthOutcome =
  | { ok: true }
  | { ok: false; error: string; needsClientId?: boolean }

export async function authenticate(): Promise<SpotifyAuthOutcome> {
  const api = globalThis.browser ?? globalThis.chrome
  if (!api?.identity?.launchWebAuthFlow) {
    return { ok: false, error: "This browser doesn't support the extension auth flow." }
  }

  const redirectUri = getRedirectURL()
  if (!redirectUri) {
    return { ok: false, error: "Could not determine the extension's redirect URL." }
  }

  const clientId = getClientId()
  if (!clientId) {
    return {
      ok: false,
      error:
        "This browser's redirect URL can't be registered on the built-in Spotify app. " +
        "Add your own Spotify client ID under Settings \u2192 Advanced to connect.",
      needsClientId: true,
    }
  }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier))

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  })

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`

  let responseUrl: string
  try {
    responseUrl = await api.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: /did not approve|cancel/i.test(msg)
        ? "Sign-in was cancelled."
        : `Sign-in failed: ${msg}`,
    }
  }

  if (!responseUrl) {
    return { ok: false, error: "The Spotify window closed before completing." }
  }

  const returned = new URL(responseUrl)
  const authError = returned.searchParams.get("error")
  if (authError) return { ok: false, error: `Spotify returned: ${authError}` }

  const code = returned.searchParams.get("code")
  if (!code) {
    return { ok: false, error: "Spotify didn't return an authorization code." }
  }

  let tokenRes: Response
  try {
    tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't reach Spotify to exchange the code: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  if (!tokenRes.ok) {
    let detail = `HTTP ${tokenRes.status}`
    try {
      const body = await tokenRes.json()
      if (body?.error_description) detail = body.error_description
      else if (body?.error) detail = body.error
    } catch { /* non-JSON error body */ }
    return { ok: false, error: `Spotify rejected the token exchange: ${detail}` }
  }

  try {
    const tokenData = await tokenRes.json()
    store.local.set("spotifyAccessToken", tokenData.access_token)
    store.local.set("spotifyRefreshToken", tokenData.refresh_token)
    store.local.set(
      "spotifyTokenExpiry",
      Date.now() + tokenData.expires_in * 1000
    )
    return { ok: true }
  } catch {
    return { ok: false, error: "Spotify returned a token response we couldn't read." }
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = store.local.get("spotifyRefreshToken")
  if (!refreshToken) return false

  const clientId = getClientId()
  if (!clientId) return false

  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        clearTokens()
      }
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

export function clearTokens(): void {
  store.local.delete("spotifyAccessToken")
  store.local.delete("spotifyRefreshToken")
  store.local.delete("spotifyTokenExpiry")
}

async function ensureValidToken(): Promise<boolean> {
  const token = store.local.get("spotifyAccessToken")
  if (!token) {
    return store.local.get("spotifyRefreshToken") ? refreshAccessToken() : false
  }

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

async function spotifyFetch(
  url: string,
  options?: RequestInit
): Promise<Response | null> {
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
        artists: data.item.artists
          .map((a: { name: string }) => a.name)
          .join(", "),
        albumArt: data.item.album?.images?.[0]?.url ?? null,
      },
      isPlaying: data.is_playing,
    }
  } catch {
    currentPlayerState = null
  }
}

async function playerPlay(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
  })
  return res !== null && (res.ok || res.status === 204)
}

async function playerPause(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
  })
  return res !== null && (res.ok || res.status === 204)
}

async function playerNext(): Promise<boolean> {
  const res = await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
    method: "POST",
  })
  return res !== null && (res.ok || res.status === 204)
}

async function playerPrevious(): Promise<boolean> {
  const res = await spotifyFetch(
    "https://api.spotify.com/v1/me/player/previous",
    { method: "POST" }
  )
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
let cardVisible = false
let controlsDisabled = false
let loadingAction: string | null = null

function escapeHtml(str: string): string {
  const div = document.createElement("div")
  div.textContent = str
  return div.innerHTML
}

function btnIcon(action: string, isPlaying: boolean): string {
  if (loadingAction === action) return getIconSvg("spinner")
  switch (action) {
    case "previous":
      return getIconSvg("skipBack")
    case "next":
      return getIconSvg("skipForward")
    default:
      return isPlaying ? getIconSvg("pause") : getIconSvg("play")
  }
}

/**
 * The now-playing row (art, track, controls). Shared by the floating card in the
 * immersive layout and the grid card in the others.
 */
export function buildSpotifyBody(): HTMLElement {
  const body = document.createElement("div")
  body.className = "flex gap-3 items-center min-w-0"

  if (!currentPlayerState) {
    body.innerHTML = `<div class="text-sm opacity-60">Nothing playing</div>`
    return body
  }

  const { track, isPlaying } = currentPlayerState
  const playPauseAction = isPlaying ? "pause" : "play"

  const albumHtml = track.albumArt
    ? `<img src="${track.albumArt}" alt="Album art" class="w-20 h-20 rounded-lg object-cover shrink-0">`
    : `<div class="w-20 h-20 rounded-lg bg-page-foreground/10 shrink-0"></div>`

  const controlsHtml = isPremium
    ? `<div class="flex items-center gap-2 mt-2">
        <button data-spotify-action="previous" class="p-1 rounded hover:bg-page-foreground/20 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Previous track">${btnIcon("previous", isPlaying)}</button>
        <button data-spotify-action="${playPauseAction}" class="p-1 rounded hover:bg-page-foreground/20 transition-colors" ${
        controlsDisabled ? "disabled" : ""
      } aria-label="${isPlaying ? "Pause" : "Play"}">${btnIcon(
        playPauseAction,
        isPlaying
      )}</button>
        <button data-spotify-action="next" class="p-1 rounded hover:bg-page-foreground/20 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Next track">${btnIcon("next", isPlaying)}</button>
      </div>`
    : ""

  body.innerHTML = `
    ${albumHtml}
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium truncate">${escapeHtml(track.name)}</div>
      <div class="text-xs opacity-70 truncate">${escapeHtml(track.artists)}</div>
      ${controlsHtml}
    </div>
  `
  body.addEventListener("click", handleControlClick)
  return body
}

/**
 * The Dashboard top-row form. Same controls as the card, but laid out to a
 * tile's fixed height: small art, one line of title, one of artist, and the
 * transport underneath. The text column is capped so a long track name widens
 * the tile only so far before it truncates.
 */
export function buildSpotifyTile(): HTMLElement {
  const body = document.createElement("div")
  body.className = "flex gap-3 items-center min-w-0"

  if (!currentPlayerState) {
    body.innerHTML = `<div class="text-sm opacity-60">Nothing playing</div>`
    return body
  }

  const { track, isPlaying } = currentPlayerState
  const playPauseAction = isPlaying ? "pause" : "play"

  const albumHtml = track.albumArt
    ? `<img src="${track.albumArt}" alt="Album art" class="w-14 h-14 rounded-theme-sm object-cover shrink-0">`
    : `<div class="w-14 h-14 rounded-theme-sm bg-page-foreground/10 shrink-0"></div>`

  const controlsHtml = isPremium
    ? `<div class="flex items-center gap-1 -ml-1 mt-1">
        <button data-spotify-action="previous" class="p-1 rounded-theme-sm hover:bg-page-foreground/15 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Previous track">${btnIcon("previous", isPlaying)}</button>
        <button data-spotify-action="${playPauseAction}" class="p-1 rounded-theme-sm hover:bg-page-foreground/15 transition-colors" ${
        controlsDisabled ? "disabled" : ""
      } aria-label="${isPlaying ? "Pause" : "Play"}">${btnIcon(
        playPauseAction,
        isPlaying
      )}</button>
        <button data-spotify-action="next" class="p-1 rounded-theme-sm hover:bg-page-foreground/15 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Next track">${btnIcon("next", isPlaying)}</button>
      </div>`
    : ""

  body.innerHTML = `
    ${albumHtml}
    <div class="min-w-0 max-w-[190px]">
      <div class="text-[13px] font-medium truncate">${escapeHtml(track.name)}</div>
      <div class="text-[11px] opacity-60 truncate">${escapeHtml(track.artists)}</div>
      ${controlsHtml}
    </div>
  `
  body.addEventListener("click", handleControlClick)
  return body
}

function removeFloatingCard(): void {
  if (cardEl) {
    cardEl.remove()
    cardEl = null
  }
}

function renderCard(): void {
  const shouldShow =
    store.sync.get("spotifyEnabled") && currentPlayerState !== null

  if (getLayout() !== "immersive") {
    removeFloatingCard()
    if (shouldShow !== cardVisible) {
      cardVisible = shouldShow
      refreshCards()
    } else {
      refreshCard("spotify")
    }
    return
  }

  cardVisible = shouldShow
  if (!shouldShow) {
    removeFloatingCard()
    return
  }

  if (!cardEl) {
    cardEl = document.createElement("div")
    cardEl.className =
      "fixed bottom-4 right-4 w-[320px] z-50 bg-page-overlay/70 backdrop-blur-sm text-page-foreground rounded-xl p-3 shadow-lg"
    document.body.appendChild(cardEl)
  }

  cardEl.replaceChildren(buildSpotifyBody())
}

registerCard({
  id: "spotify",
  title: "Now Playing",
  order: 15,
  regions: { default: "grid", dashboard: "top" },
  enabledKey: "spotifyEnabled",
  isEnabled: () => currentPlayerState !== null,
  render: buildSpotifyBody,
  renderTile: buildSpotifyTile,
})

async function handleControlClick(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-spotify-action]"
  )
  if (!btn || controlsDisabled) return

  const action = btn.dataset.spotifyAction!
  controlsDisabled = true
  loadingAction = action
  renderCard()

  let success = false
  switch (action) {
    case "play":
      success = await playerPlay()
      break
    case "pause":
      success = await playerPause()
      break
    case "next":
      success = await playerNext()
      break
    case "previous":
      success = await playerPrevious()
      break
  }

  if (success) {
    await new Promise((r) => setTimeout(r, 300))
    await fetchPlayerState()
  }

  controlsDisabled = false
  loadingAction = null
  renderCard()
}

export function initSpotify(): void {
  setupVisibilityHandler()

  store.sync.subscribe("layout", () => renderCard())

  // A refresh token belongs to the app that issued it. Pointing at a different
  // client would fail its next refresh with an opaque 400, so drop the session
  // and make the user reconnect against the new app deliberately.
  store.sync.subscribe("spotifyClientId", () => {
    if (store.local.get("spotifyAccessToken")) clearTokens()
  })

  store.sync.subscribe("spotifyEnabled", (enabled) => {
    if (enabled && store.local.get("spotifyAccessToken")) {
      startPolling()
    } else {
      stopPolling()
      if (cardEl) {
        cardEl.remove()
        cardEl = null
      }
    }
  })

  store.local.subscribe("spotifyAccessToken", (token) => {
    if (token) {
      ;(async () => {
        await checkPremium()
        startPolling()
      })()
    } else {
      stopPolling()
      currentPlayerState = null
      renderCard()
    }
  })

  if (!store.sync.get("spotifyEnabled")) return
  if (!store.local.get("spotifyAccessToken")) return
  ;(async () => {
    const valid = await ensureValidToken()
    if (!valid) return

    await checkPremium()
    startPolling()
  })()
}
