import { store } from "./store"
import type { SpotifyRecentTrack } from "./defaults"
import { getLayout, refreshCard, refreshCards, registerCard } from "./layout"
import { getIconSvg, icon } from "./icons/registry"

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
  "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-read-private"
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
  // Last played belongs to the account that was signed in, not to the browser.
  store.local.delete("spotifyRecentTrack")
  recentScopeMissing = false
  recentFetchedAt = 0
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

/* ── Last played ────────────────────────────────────────────────────────── */

/**
 * The idle card's one piece of content. Cached in `store.local` so a new tab
 * draws it on the first frame instead of after a round trip — the API stays the
 * source of truth, the cache only removes the flash of an emptier empty state.
 */
const RECENT_MAX_AGE = 60_000

let recentFetchedAt = 0

/**
 * `user-read-recently-played` was added to `SCOPES` after the first release, and
 * a refresh token keeps the scopes it was issued with. A 403 here means the
 * session predates the scope, so the idle card offers a reconnect instead of
 * asking again every minute.
 */
let recentScopeMissing = false

function getRecentTrack(): SpotifyRecentTrack | null {
  return store.local.get("spotifyRecentTrack")
}

async function fetchRecentTrack(): Promise<void> {
  if (recentScopeMissing) return
  if (Date.now() - recentFetchedAt < RECENT_MAX_AGE) return
  recentFetchedAt = Date.now()

  try {
    const res = await spotifyFetch(
      "https://api.spotify.com/v1/me/player/recently-played?limit=1"
    )
    if (!res) return
    if (res.status === 403) {
      recentScopeMissing = true
      return
    }
    if (!res.ok) return

    const data = await res.json()
    const played = data.items?.[0]
    if (!played?.track) return

    store.local.set("spotifyRecentTrack", {
      name: played.track.name,
      artists: (played.track.artists ?? [])
        .map((a: { name: string }) => a.name)
        .join(", "),
      albumArt: played.track.album?.images?.[0]?.url ?? null,
      url: played.track.external_urls?.spotify ?? null,
      playedAt: Date.parse(played.played_at) || Date.now(),
    })
  } catch {
    // Keep whatever is cached rather than blanking the card on a hiccup.
  }
}

function relativeTime(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/**
 * Spotify answers a transport call with 404 when the account has no active
 * device. That is the ordinary case for the idle card's resume button — nothing
 * has been playing — so it is reported rather than swallowed as a plain failure.
 */
type ControlResult = { ok: boolean; noDevice?: boolean }

async function control(url: string, method: string): Promise<ControlResult> {
  const res = await spotifyFetch(url, { method })
  if (!res) return { ok: false }
  if (res.status === 404) return { ok: false, noDevice: true }
  return { ok: res.ok || res.status === 204 }
}

function playerPlay(): Promise<ControlResult> {
  return control("https://api.spotify.com/v1/me/player/play", "PUT")
}

function playerPause(): Promise<ControlResult> {
  return control("https://api.spotify.com/v1/me/player/pause", "PUT")
}

function playerNext(): Promise<ControlResult> {
  return control("https://api.spotify.com/v1/me/player/next", "POST")
}

function playerPrevious(): Promise<ControlResult> {
  return control("https://api.spotify.com/v1/me/player/previous", "POST")
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

/** Whether the idle body will be drawn — the only thing last played is for. */
function idleBodyWanted(): boolean {
  return (
    store.sync.get("spotifyEnabled") && !store.sync.get("spotifyHideWhenIdle")
  )
}

async function poll(): Promise<void> {
  const wasPlaying = currentPlayerState !== null
  await fetchPlayerState()

  if (currentPlayerState) {
    // Whatever is playing becomes the last-played entry the moment it stops.
    recentFetchedAt = 0
  } else if (idleBodyWanted()) {
    if (wasPlaying) recentFetchedAt = 0
    await fetchRecentTrack()
  }

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
  if (!currentPlayerState) return buildIdleBody("card")

  const body = document.createElement("div")
  body.className = "flex gap-3 items-center min-w-0"

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
  if (!currentPlayerState) return buildIdleBody("tile")

  const body = document.createElement("div")
  body.className = "flex gap-3 items-center min-w-0"

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

/* ── Idle state ─────────────────────────────────────────────────────────── */

/**
 * With "Hide when nothing is playing" off the card stays put, so it needs
 * something worth looking at. Three states, in order of how much there is to
 * say: the last track played (dimmed, with a resume button), a plain "nothing
 * playing" note once there is no history to show, and a connect prompt when
 * there is no session at all.
 *
 * Three sizes, because the card has three hosts: the grid card, the Dashboard's
 * 118px tile, and the Immersive layout's floating corner card — which stays
 * deliberately slight, since idle it is a box sitting over someone's wallpaper
 * doing nothing.
 */
type IdleSize = "card" | "tile" | "mini"

type IdleScale = {
  art: number
  glyph: number
  eyebrow: string
  title: string
  meta: string
  button: string
  buttonIcon: number
  gap: string
}

/* Literal class names: the Tailwind scanner reads source text. */
const IDLE_SCALES: Record<IdleSize, IdleScale> = {
  card: {
    art: 64,
    glyph: 26,
    eyebrow: "text-[10px]",
    title: "text-sm",
    meta: "text-xs",
    button: "w-9 h-9",
    buttonIcon: 16,
    gap: "gap-3",
  },
  tile: {
    art: 44,
    glyph: 22,
    eyebrow: "text-[9px]",
    title: "text-[13px]",
    meta: "text-[11px]",
    button: "w-8 h-8",
    buttonIcon: 14,
    gap: "gap-2.5",
  },
  mini: {
    art: 36,
    glyph: 20,
    eyebrow: "text-[9px]",
    title: "text-[13px]",
    meta: "text-[11px]",
    button: "w-8 h-8",
    buttonIcon: 14,
    gap: "gap-2.5",
  },
}

let hint: string | null = null
let hintTimer: ReturnType<typeof setTimeout> | null = null

/** A transient line under the body — a failed control, a rejected sign-in. */
function setHint(message: string | null): void {
  hint = message
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = null
  if (!message) return
  hintTimer = setTimeout(() => {
    hint = null
    hintTimer = null
    renderCard()
  }, 6000)
}

function line(className: string, text: string): HTMLElement {
  const el = document.createElement("div")
  el.className = className
  el.textContent = text
  return el
}

function withHint(row: HTMLElement): HTMLElement {
  if (!hint) return row
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-1.5 min-w-0"
  wrap.appendChild(row)
  wrap.appendChild(line("text-[11px] leading-snug text-warning/90", hint))
  return wrap
}

function authAction(label: string): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className =
    "self-start mt-1 text-[11px] font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline"
  btn.textContent = label
  btn.addEventListener("click", async () => {
    btn.disabled = true
    btn.textContent = "Connecting…"
    const result = await authenticate()
    // On success the access-token subscriber restarts polling and re-renders,
    // which discards this button along with the rest of the body.
    if (result.ok) {
      recentScopeMissing = false
      recentFetchedAt = 0
      return
    }
    btn.disabled = false
    btn.textContent = label
    setHint(result.error)
    renderCard()
  })
  return btn
}

/** Glyph + two lines + an optional action. The card with nothing to show. */
function idleNote(
  s: IdleScale,
  glyph: string,
  title: string,
  meta: string,
  action?: HTMLElement
): HTMLElement {
  const row = document.createElement("div")
  row.className = `flex ${s.gap} items-center min-w-0`

  row.appendChild(
    icon(glyph, { size: s.glyph, class: "opacity-20 self-start mt-0.5" })
  )

  const col = document.createElement("div")
  col.className = "flex flex-col min-w-0 flex-1"
  col.appendChild(line(`${s.title} font-medium opacity-70`, title))
  col.appendChild(line(`${s.meta} opacity-40 leading-snug`, meta))
  if (action) col.appendChild(action)
  row.appendChild(col)

  return row
}

/**
 * The now-playing row, turned down: the same shape and rhythm, with the art
 * desaturated and an eyebrow saying what it is, so the card reads as a memory
 * rather than as something currently on.
 */
function lastPlayedRow(s: IdleScale, track: SpotifyRecentTrack): HTMLElement {
  const row = document.createElement("div")
  row.className = `group flex ${s.gap} items-center min-w-0`

  const art = document.createElement("div")
  art.className =
    "relative shrink-0 overflow-hidden rounded-theme-sm bg-page-foreground/10"
  art.style.width = `${s.art}px`
  art.style.height = `${s.art}px`
  if (track.albumArt) {
    const img = document.createElement("img")
    img.src = track.albumArt
    img.alt = ""
    img.className =
      "w-full h-full object-cover opacity-45 saturate-50 transition duration-500 group-hover:opacity-75 group-hover:saturate-100"
    art.appendChild(img)
  } else {
    art.appendChild(
      icon("musicNote", {
        size: Math.round(s.art * 0.4),
        class: "absolute inset-0 m-auto opacity-25",
      })
    )
  }
  row.appendChild(art)

  const col = document.createElement("div")
  col.className = "flex flex-col min-w-0 flex-1"

  col.appendChild(
    line(
      `${s.eyebrow} font-semibold uppercase tracking-[0.1em] opacity-35`,
      "Last played"
    )
  )

  const name = track.url
    ? document.createElement("a")
    : document.createElement("div")
  name.className = `${s.title} font-medium truncate opacity-80`
  name.textContent = track.name
  if (name instanceof HTMLAnchorElement) {
    name.href = track.url!
    name.target = "_blank"
    name.rel = "noopener"
    name.classList.add("hover:underline", "hover:opacity-100", "transition-opacity")
  }
  col.appendChild(name)

  const meta = [track.artists, relativeTime(track.playedAt)]
    .filter(Boolean)
    .join(" \u00b7 ")
  col.appendChild(line(`${s.meta} opacity-45 truncate`, meta))
  row.appendChild(col)

  if (isPremium) {
    const play = document.createElement("button")
    play.dataset.spotifyAction = "play"
    play.className =
      `shrink-0 inline-flex items-center justify-center rounded-full ${s.button} ` +
      "border border-page-foreground/15 opacity-60 transition-colors " +
      "hover:opacity-100 hover:bg-accent hover:border-accent hover:text-accent-foreground " +
      "disabled:opacity-30"
    play.disabled = controlsDisabled
    play.setAttribute("aria-label", `Resume ${track.name}`)
    play.innerHTML =
      loadingAction === "play" ? getIconSvg("spinner") : getIconSvg("play")
    const svg = play.querySelector("svg")
    if (svg) {
      svg.setAttribute("width", String(s.buttonIcon))
      svg.setAttribute("height", String(s.buttonIcon))
    }
    row.appendChild(play)
  }

  return row
}

function buildIdleBody(size: IdleSize): HTMLElement {
  const s = IDLE_SCALES[size]

  let row: HTMLElement
  if (!store.local.get("spotifyAccessToken")) {
    row = idleNote(
      s,
      "spotify",
      "Not connected",
      "Sign in to see what\u2019s playing.",
      authAction("Connect Spotify")
    )
  } else {
    const track = getRecentTrack()
    row = track
      ? lastPlayedRow(s, track)
      : idleNote(
          s,
          "musicNote",
          "Nothing playing",
          "Anything you play shows up here.",
          recentScopeMissing
            ? authAction("Reconnect to see recent plays")
            : undefined
        )
  }

  const body = withHint(row)
  body.addEventListener("click", handleControlClick)
  return body
}

function removeFloatingCard(): void {
  if (cardEl) {
    cardEl.remove()
    cardEl = null
  }
}

/**
 * Whether the widget has anything to draw. Playback always counts; with
 * "Hide when nothing is playing" off, the idle body counts too.
 */
function hasContent(): boolean {
  return currentPlayerState !== null || !store.sync.get("spotifyHideWhenIdle")
}

function renderCard(): void {
  const shouldShow = store.sync.get("spotifyEnabled") && hasContent()

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
    document.body.appendChild(cardEl)
  }

  // Idle it is a box over someone's wallpaper doing nothing, so it gives back
  // its width and most of its presence until the pointer is near it.
  const idle = currentPlayerState === null
  cardEl.className =
    "fixed bottom-4 right-4 z-50 bg-page-overlay/70 backdrop-blur-sm text-page-foreground rounded-xl shadow-lg transition-opacity duration-300 " +
    (idle
      ? "max-w-[300px] p-2.5 opacity-55 hover:opacity-100"
      : "w-[320px] p-3")

  cardEl.replaceChildren(idle ? buildIdleBody("mini") : buildSpotifyBody())
}

registerCard({
  id: "spotify",
  title: "Now Playing",
  order: 15,
  regions: { default: "grid", dashboard: "top" },
  enabledKey: "spotifyEnabled",
  isEnabled: hasContent,
  cardTitle: () => (currentPlayerState ? "Now Playing" : "Spotify"),
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

  let result: ControlResult = { ok: false }
  switch (action) {
    case "play":
      result = await playerPlay()
      break
    case "pause":
      result = await playerPause()
      break
    case "next":
      result = await playerNext()
      break
    case "previous":
      result = await playerPrevious()
      break
  }

  if (result.ok) {
    setHint(null)
    await new Promise((r) => setTimeout(r, 300))
    await fetchPlayerState()
  } else if (result.noDevice) {
    setHint("No active device — open Spotify on a device first.")
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
      if (!enabled) currentPlayerState = null
    }
    // registerCard's own `enabledKey` subscription has already remounted the
    // grid card by the time this runs; only the floating card is ours to place.
    cardVisible = enabled && hasContent()
    if (getLayout() === "immersive") renderCard()
  })

  store.sync.subscribe("spotifyHideWhenIdle", () => {
    renderCard()
    if (idleBodyWanted() && !currentPlayerState) {
      void fetchRecentTrack().then(renderCard)
    }
  })

  store.local.subscribe("spotifyAccessToken", (token) => {
    if (token) {
      recentScopeMissing = false
      recentFetchedAt = 0
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

  // The idle body has something to say without a session, so the card is placed
  // before the token checks below rather than after them.
  cardVisible = store.sync.get("spotifyEnabled") && hasContent()
  renderCard()

  if (!store.sync.get("spotifyEnabled")) return
  if (!store.local.get("spotifyAccessToken")) return
  ;(async () => {
    const valid = await ensureValidToken()
    if (!valid) return

    await checkPremium()
    startPolling()
  })()
}
