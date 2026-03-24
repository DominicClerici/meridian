# Spotify Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating Spotify player widget that shows current playback state with controls for premium users, authenticated via PKCE OAuth.

**Architecture:** Single file `src/spotify.ts` handles OAuth (PKCE via `browser.identity`), Spotify API calls, 5-second polling, and DOM rendering of a floating card. Settings stored across `store.sync` (enabled toggle) and `store.local` (tokens). Settings UI wired in `src/settings.ts` with HTML in `src/index.html`.

**Tech Stack:** Vanilla TypeScript, Tailwind CSS v4 utilities, Spotify Web API, browser.identity API

**Spec:** `docs/superpowers/specs/2026-03-23-spotify-widget-design.md`

---

## File Map

| File               | Action | Responsibility                                                              |
| ------------------ | ------ | --------------------------------------------------------------------------- |
| `src/defaults.ts`  | Modify | Add `spotifyEnabled` to `SyncSettings`, add 3 token keys to `LocalSettings` |
| `src/browser.d.ts` | Modify | Add `identity` types to `BrowserAPI` interface                              |
| `manifest.json`    | Modify | Add `"identity"` permission                                                 |
| `src/spotify.ts`   | Create | OAuth, API calls, polling, floating card rendering                          |
| `src/index.html`   | Modify | Add Spotify settings fieldset to the settings dialog                        |
| `src/settings.ts`  | Modify | Wire Spotify enable toggle + connect/disconnect buttons                     |
| `src/index.ts`     | Modify | Import and call `initSpotify()`                                             |

---

### Task 1: Add storage keys, types, and permissions

**Files:**

- Modify: `src/defaults.ts:4-19` (SyncSettings type), `src/defaults.ts:21-26` (LocalSettings type), `src/defaults.ts:28-43` (syncDefaults), `src/defaults.ts:45-50` (localDefaults)
- Modify: `src/browser.d.ts:25-27` (BrowserAPI interface)
- Modify: `manifest.json:9-12` (permissions array)

- [ ] **Step 1: Add `spotifyEnabled` to `SyncSettings` and its default**

In `src/defaults.ts`, add to the `SyncSettings` type (after line 18):

```ts
spotifyEnabled: boolean
```

Add to `syncDefaults` (after line 42):

```ts
spotifyEnabled: true,
```

- [ ] **Step 2: Add token keys to `LocalSettings` and their defaults**

In `src/defaults.ts`, add to the `LocalSettings` type (after line 25):

```ts
spotifyAccessToken: string | null
spotifyRefreshToken: string | null
spotifyTokenExpiry: number | null
```

Add to `localDefaults` (after line 49):

```ts
spotifyAccessToken: null,
spotifyRefreshToken: null,
spotifyTokenExpiry: null,
```

- [ ] **Step 3: Add `identity` types to `browser.d.ts`**

In `src/browser.d.ts`, add a new interface before `BrowserAPI` (before line 25):

```ts
interface BrowserIdentity {
  launchWebAuthFlow(details: {
    url: string
    interactive: boolean
  }): Promise<string>
  getRedirectURL(): string
}
```

Add to the `BrowserAPI` interface (after line 26):

```ts
identity: BrowserIdentity
```

- [ ] **Step 4: Add `identity` permission to manifest**

In `manifest.json`, add `"identity"` to the permissions array:

```json
"permissions": [
  "storage",
  "geolocation",
  "identity"
]
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors (new keys are unused but that's fine — no `noUnusedLocals` in tsconfig).

- [ ] **Step 6: Commit**

```bash
git add src/defaults.ts src/browser.d.ts manifest.json
git commit -m "feat(spotify): add storage keys, browser identity types, and permission"
```

---

### Task 2: OAuth — PKCE authentication flow

**Files:**

- Create: `src/spotify.ts`

This task creates the file with the OAuth constants, PKCE helpers, and the `authenticate()` function. No UI yet — just the auth logic.

- [ ] **Step 1: Create `src/spotify.ts` with constants and PKCE helpers**

```ts
import { store } from "./store"

const CLIENT_ID = "acd29601607e4e1c8896ab4c1ab534d7"
const SCOPES =
  "user-read-playback-state user-modify-playback-state user-read-currently-playing"
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

function getRedirectURL(): string {
  const api = globalThis.browser ?? globalThis.chrome
  return api!.identity.getRedirectURL()
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

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
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
    responseUrl = await api.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    })
  } catch {
    return false
  }

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
    store.local.set(
      "spotifyTokenExpiry",
      Date.now() + tokenData.expires_in * 1000
    )
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Add token refresh and disconnect functions**

Append to `src/spotify.ts`:

```ts
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
  if (expiry && Date.now() > expiry - 60_000) {
    return refreshAccessToken()
  }
  return true
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/spotify.ts
git commit -m "feat(spotify): add PKCE OAuth flow and token management"
```

---

### Task 3: Spotify API layer — player state, premium check, controls

**Files:**

- Modify: `src/spotify.ts`

- [ ] **Step 1: Add types and API helper**

Add after the `ensureValidToken` function in `src/spotify.ts`:

```ts
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
```

- [ ] **Step 2: Add premium check function**

Append to `src/spotify.ts`:

```ts
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
```

- [ ] **Step 3: Add player state fetch function**

Append to `src/spotify.ts`:

```ts
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
```

- [ ] **Step 4: Add player control functions**

Append to `src/spotify.ts`:

```ts
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
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/spotify.ts
git commit -m "feat(spotify): add API layer for player state, premium check, and controls"
```

---

### Task 4: Polling with visibility handling

**Files:**

- Modify: `src/spotify.ts`

- [ ] **Step 1: Add polling logic**

Append to `src/spotify.ts`:

```ts
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
```

- [ ] **Step 2: Add visibility handling**

Append to `src/spotify.ts`:

```ts
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
```

- [ ] **Step 3: Add renderCard stub**

Append a placeholder to `src/spotify.ts` that will be replaced in Task 5:

```ts
let cardEl: HTMLElement | null = null
let controlsDisabled = false
let loadingAction: string | null = null

function renderCard(): void {}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/spotify.ts
git commit -m "feat(spotify): add polling with visibility-based pause"
```

---

### Task 5: Floating card UI

**Files:**

- Modify: `src/spotify.ts`

- [ ] **Step 1: Replace renderCard stub and add card rendering**

In `src/spotify.ts`, replace the `cardEl`, `controlsDisabled`, `loadingAction`, and `renderCard` stub from Task 4 with the full implementation. The `loadingAction` variable tracks which button should show a spinner during re-renders. Event delegation is used via a single click listener on `cardEl` registered once at creation.

```ts
let cardEl: HTMLElement | null = null
let controlsDisabled = false
let loadingAction: string | null = null

const SPINNER_SVG = `<svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`

function escapeHtml(str: string): string {
  const div = document.createElement("div")
  div.textContent = str
  return div.innerHTML
}

function btnIcon(action: string, isPlaying: boolean): string {
  if (loadingAction === action) return SPINNER_SVG
  switch (action) {
    case "previous":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>`
    case "next":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`
    default:
      return isPlaying
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
  }
}

function renderCard(): void {
  if (!store.sync.get("spotifyEnabled") || !currentPlayerState) {
    if (cardEl) {
      cardEl.remove()
      cardEl = null
    }
    return
  }

  const isNew = !cardEl
  if (isNew) {
    cardEl = document.createElement("div")
    cardEl.className =
      "fixed bottom-4 right-4 bg-black/70 backdrop-blur-sm text-white rounded-xl p-3 flex gap-3 items-center shadow-lg"
    cardEl.style.width = "320px"
    cardEl.style.zIndex = "50"
    cardEl.addEventListener("click", handleControlClick)
    document.body.appendChild(cardEl)
  }

  const { track, isPlaying } = currentPlayerState
  const playPauseAction = isPlaying ? "pause" : "play"

  const albumHtml = track.albumArt
    ? `<img src="${track.albumArt}" alt="Album art" class="w-20 h-20 rounded-lg object-cover shrink-0">`
    : `<div class="w-20 h-20 rounded-lg bg-white/10 shrink-0"></div>`

  const controlsHtml = isPremium
    ? `<div class="flex items-center gap-2 mt-2">
        <button data-spotify-action="previous" class="p-1 rounded hover:bg-white/20 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Previous track">${btnIcon("previous", isPlaying)}</button>
        <button data-spotify-action="${playPauseAction}" class="p-1 rounded hover:bg-white/20 transition-colors" ${
        controlsDisabled ? "disabled" : ""
      } aria-label="${isPlaying ? "Pause" : "Play"}">${btnIcon(
        playPauseAction,
        isPlaying
      )}</button>
        <button data-spotify-action="next" class="p-1 rounded hover:bg-white/20 transition-colors" ${
          controlsDisabled ? "disabled" : ""
        } aria-label="Next track">${btnIcon("next", isPlaying)}</button>
      </div>`
    : ""

  cardEl!.innerHTML = `
    ${albumHtml}
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium truncate">${escapeHtml(track.name)}</div>
      <div class="text-xs text-white/70 truncate">${escapeHtml(
        track.artists
      )}</div>
      ${controlsHtml}
    </div>
  `
}
```

- [ ] **Step 2: Add control click handler with loading state**

Append to `src/spotify.ts`. Uses event delegation — the handler is registered once on `cardEl`, not per-button:

```ts
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
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/spotify.ts
git commit -m "feat(spotify): add floating card UI with playback controls"
```

---

### Task 6: Settings UI — HTML and wiring

**Files:**

- Modify: `src/index.html:144-164` (after weather fieldset, before close button)
- Modify: `src/settings.ts:137-172` (after weather section)

- [ ] **Step 1: Add Spotify fieldset to `index.html`**

In `src/index.html`, add after the weather `</fieldset>` (after line 164) and before the close button (line 165):

```html
<fieldset id="settings-spotify" class="border-0 p-0 m-0 mt-4">
  <legend class="text-sm font-medium mb-2">Spotify</legend>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input type="checkbox" id="settings-spotify-enabled" class="rounded" />
      <label for="settings-spotify-enabled" class="text-sm"
        >Enable Spotify widget</label
      >
    </div>
    <div id="settings-spotify-connect-row">
      <button
        id="settings-spotify-connect"
        type="button"
        class="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600"
      >
        Connect Spotify
      </button>
    </div>
    <div id="settings-spotify-disconnect-row" hidden>
      <button
        id="settings-spotify-disconnect"
        type="button"
        class="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600"
      >
        Disconnect
      </button>
    </div>
  </div>
</fieldset>
```

- [ ] **Step 2: Export `authenticate` and `clearTokens` from `spotify.ts`**

In `src/spotify.ts`, change `authenticate` and `clearTokens` to exported functions:

```ts
export async function authenticate(): Promise<boolean> {
```

```ts
export function clearTokens(): void {
```

- [ ] **Step 3: Wire Spotify settings in `settings.ts`**

In `src/settings.ts`, add the import at the top (after the existing store import on line 1):

```ts
import {
  authenticate as spotifyAuthenticate,
  clearTokens as spotifyClearTokens,
} from "./spotify"
```

Then append before the closing `}` of `initSettings()` (before line 172):

```ts
const spotifyEnabled = document.getElementById(
  "settings-spotify-enabled"
) as HTMLInputElement
const spotifyConnectRow = document.getElementById(
  "settings-spotify-connect-row"
) as HTMLElement
const spotifyDisconnectRow = document.getElementById(
  "settings-spotify-disconnect-row"
) as HTMLElement
const spotifyConnect = document.getElementById(
  "settings-spotify-connect"
) as HTMLButtonElement
const spotifyDisconnect = document.getElementById(
  "settings-spotify-disconnect"
) as HTMLButtonElement

spotifyEnabled.checked = store.sync.get("spotifyEnabled")

function updateSpotifyAuthUI(): void {
  const hasToken = store.local.get("spotifyAccessToken") !== null
  spotifyConnectRow.hidden = hasToken
  spotifyDisconnectRow.hidden = !hasToken
}
updateSpotifyAuthUI()

spotifyEnabled.addEventListener("change", () =>
  store.sync.set("spotifyEnabled", spotifyEnabled.checked)
)
spotifyConnect.addEventListener("click", async () => {
  spotifyConnect.disabled = true
  spotifyConnect.textContent = "Connecting..."
  const success = await spotifyAuthenticate()
  spotifyConnect.disabled = false
  spotifyConnect.textContent = "Connect Spotify"
  if (success) updateSpotifyAuthUI()
})
spotifyDisconnect.addEventListener("click", () => {
  spotifyClearTokens()
  updateSpotifyAuthUI()
})

store.sync.subscribe("spotifyEnabled", (v) => {
  spotifyEnabled.checked = v
})
store.local.subscribe("spotifyAccessToken", () => updateSpotifyAuthUI())
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/settings.ts src/spotify.ts
git commit -m "feat(spotify): add settings UI with connect/disconnect flow"
```

---

### Task 7: Integration — wire `initSpotify` and finalize

**Files:**

- Modify: `src/spotify.ts` (add `initSpotify` export)
- Modify: `src/index.ts:1-22` (add import and call)

- [ ] **Step 1: Add `initSpotify` export to `spotify.ts`**

Append to `src/spotify.ts`:

```ts
export function initSpotify(): void {
  setupVisibilityHandler()

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
```

- [ ] **Step 2: Wire `initSpotify` in `index.ts`**

In `src/index.ts`, add the import (after line 8):

```ts
import { initSpotify } from "./spotify"
```

Add the call after `initWeather()` (after line 21):

```ts
initSpotify()
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Build the extension**

Run: `./build.sh`
Expected: Clean build, no errors. `dist/` contains the bundled output.

- [ ] **Step 5: Commit**

```bash
git add src/spotify.ts src/index.ts
git commit -m "feat(spotify): wire initSpotify into app entrypoint"
```

---

## Summary of Commits

1. `feat(spotify): add storage keys, browser identity types, and permission`
2. `feat(spotify): add PKCE OAuth flow and token management`
3. `feat(spotify): add API layer for player state, premium check, and controls`
4. `feat(spotify): add polling with visibility-based pause`
5. `feat(spotify): add floating card UI with playback controls`
6. `feat(spotify): add settings UI with connect/disconnect flow`
7. `feat(spotify): wire initSpotify into app entrypoint`
