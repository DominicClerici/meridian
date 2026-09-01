import { store } from "./store"
import type { GithubUser } from "./defaults"

/**
 * The extension's own OAuth App. Device flow needs no secret and no redirect
 * URI, so unlike Spotify this one client works identically in every browser —
 * there is nothing browser-specific to register. Empty until an App exists;
 * until then `authenticate()` reports `needsClientId` and the PAT path in
 * Settings → Advanced is the way in. See `docs/github.md`.
 */
const BUNDLED_CLIENT_ID = "Ov23licYLWl4o15AVlWq"

const DEVICE_CODE_URL = "https://github.com/login/device/code"
const TOKEN_URL = "https://github.com/login/oauth/access_token"
export const API_ROOT = "https://api.github.com"

/**
 * `repo` is what makes private-repo PRs visible at all; `read:org` is required
 * for review requests routed through a team rather than named directly.
 */
const SCOPES = "repo read:org notifications read:user"

/** GitHub rejects any API request without one, and blocks a browser UA string. */
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
}

let activeFlow: AbortController | null = null

export type AuthOutcome =
  | { ok: true }
  | { ok: false; error: string; needsClientId?: boolean }

export type DeviceCode = {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
  deviceCode: string
}

export function getClientId(): string {
  return store.sync.get("githubClientId").trim() || BUNDLED_CLIENT_ID
}

export function isConnected(): boolean {
  return store.local.get("githubToken") !== null
}

export function hasScope(scope: string): boolean {
  // A fine-grained PAT reports no scopes at all, so an empty string can't be
  // read as "missing" — it means "unknowable", and the call has to be tried.
  const scopes = store.local.get("githubScopes")
  if (!scopes) return true
  return scopes.split(/[,\s]+/).includes(scope)
}

export function clearTokens(): void {
  store.local.set("githubRefreshToken", null)
  store.local.set("githubTokenExpiry", null)
  store.local.set("githubTokenType", null)
  store.local.set("githubScopes", "")
  store.local.set("githubUser", null)
  // Last, mirroring finishConnect: the widget wakes on this key, so everything
  // it reads on waking has to already be gone.
  store.local.set("githubToken", null)
}

/**
 * Step one of the device flow: ask GitHub for a code pair. The user code is
 * what the person types at github.com/login/device; the device code is what we
 * poll with and never show.
 */
export async function requestDeviceCode(): Promise<
  { ok: true; code: DeviceCode } | { ok: false; error: string; needsClientId?: boolean }
> {
  const clientId = getClientId()
  if (!clientId) {
    return {
      ok: false,
      needsClientId: true,
      error: "No GitHub client ID configured. Add one in Settings → Advanced, or connect with a personal access token.",
    }
  }

  let res: Response
  try {
    res = await fetch(DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
    })
  } catch {
    return { ok: false, error: "Couldn't reach GitHub. Check your connection." }
  }

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.device_code) {
    const detail = data?.error_description ?? data?.error
    // The one failure worth naming: an App without the box ticked answers 400
    // `device_flow_disabled`, and nothing about that is guessable from the UI.
    if (data?.error === "device_flow_disabled") {
      return {
        ok: false,
        error: "This OAuth App doesn't have device flow enabled. Tick “Enable Device Flow” on its GitHub settings page.",
      }
    }
    return { ok: false, error: detail ? `GitHub rejected the request: ${detail}` : "GitHub rejected the request." }
  }

  return {
    ok: true,
    code: {
      userCode: data.user_code,
      verificationUri: data.verification_uri ?? "https://github.com/login/device",
      expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
      interval: Math.max(data.interval ?? 5, 1),
      deviceCode: data.device_code,
    },
  }
}

/**
 * Step two: poll until the user approves. Resolves once — on success, on a
 * terminal error, or when `signal` aborts because the popover closed.
 *
 * `slow_down` is not an error: GitHub uses it to widen its own polling window,
 * and ignoring it escalates to a hard rejection.
 */
export async function pollForToken(code: DeviceCode, signal: AbortSignal): Promise<AuthOutcome> {
  const clientId = getClientId()
  let interval = code.interval

  while (!signal.aborted) {
    await sleep(interval * 1000, signal)
    if (signal.aborted) return { ok: false, error: "Cancelled." }

    if (Date.now() > code.expiresAt) {
      return { ok: false, error: "The code expired. Try connecting again." }
    }

    let data: any
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: code.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })
      data = await res.json()
    } catch {
      return { ok: false, error: "Couldn't reach GitHub. Check your connection." }
    }

    if (data.access_token) {
      return finishConnect({
        token: data.access_token,
        type: "oauth",
        scopes: data.scope ?? SCOPES,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in ?? null,
      })
    }

    switch (data.error) {
      case "authorization_pending":
        break
      case "slow_down":
        interval = Math.max(data.interval ?? interval + 5, interval + 1)
        break
      case "expired_token":
        return { ok: false, error: "The code expired. Try connecting again." }
      case "access_denied":
        return { ok: false, error: "Access was denied on GitHub." }
      default:
        return { ok: false, error: data.error_description ?? "GitHub rejected the sign-in." }
    }
  }

  return { ok: false, error: "Cancelled." }
}

/** The fallback path: a token the user pasted, validated before it is stored. */
export async function connectWithToken(token: string): Promise<AuthOutcome> {
  const trimmed = token.trim()
  if (!trimmed) return { ok: false, error: "Paste a token first." }

  let res: Response
  try {
    res = await fetch(`${API_ROOT}/user`, {
      headers: { ...API_HEADERS, Authorization: `Bearer ${trimmed}` },
    })
  } catch {
    return { ok: false, error: "Couldn't reach GitHub. Check your connection." }
  }

  if (res.status === 401) return { ok: false, error: "GitHub rejected that token." }
  if (!res.ok) return { ok: false, error: `GitHub answered ${res.status}.` }

  return finishConnect({
    token: trimmed,
    type: "pat",
    scopes: res.headers.get("x-oauth-scopes") ?? "",
    user: await res.json(),
  })
}

async function finishConnect(opts: {
  token: string
  type: "oauth" | "pat"
  scopes: string
  user?: any
  refreshToken?: string | null
  expiresIn?: number | null
}): Promise<AuthOutcome> {
  const profile = opts.user ?? (await fetchViewer(opts.token))
  if (!profile) {
    clearTokens()
    return { ok: false, error: "Signed in, but GitHub wouldn't say who. Try again." }
  }

  const account: GithubUser = {
    login: profile.login,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url ?? "",
  }
  store.local.set("githubTokenType", opts.type)
  store.local.set("githubScopes", opts.scopes)
  store.local.set("githubUser", account)
  store.local.set("githubRefreshToken", opts.refreshToken ?? null)
  // A null expiry is the signal that this token never needs refreshing, which is
  // every OAuth App token and every PAT — `ensureValidToken()` returns on it.
  store.local.set("githubTokenExpiry", opts.expiresIn ? Date.now() + opts.expiresIn * 1000 : null)
  // The token goes in last on purpose: the widget wakes on that key, and waking
  // it before the account exists means a first render with no login and no scopes.
  store.local.set("githubToken", opts.token)
  return { ok: true }
}

async function fetchViewer(token: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_ROOT}/user`, {
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Refresh this far before the stated expiry, so a request in flight can't
    straddle it. Same margin Spotify uses. */
const EXPIRY_MARGIN = 60_000

let refreshInFlight: Promise<boolean> | null = null

/**
 * Refreshing rotates the refresh token, which invalidates the one just used —
 * so two parallel calls must share one request. The GraphQL query and the
 * notifications call run concurrently on every tick, which makes this the
 * ordinary case rather than a race worth ignoring.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/**
 * Only ever called for a token that came with an expiry — which means a GitHub
 * App with expiring user tokens turned on. A plain OAuth App token and a PAT
 * both store a null expiry and never reach the network here.
 *
 * GitHub's refresh endpoint wants a `client_secret` even from a public client,
 * which a browser extension has no safe way to hold. `githubClientSecret` is
 * sent when the user has supplied one for their own app; without it the request
 * is still made, and a rejection lands on the same path as any other dead
 * refresh — clear and re-prompt. See `docs/github.md`.
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = store.local.get("githubRefreshToken")
  const clientId = getClientId()
  if (!refreshToken || !clientId) return false

  const params: Record<string, string> = {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }
  const secret = store.local.get("githubClientSecret").trim()
  if (secret) params.client_secret = secret

  let data: any
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    })
    data = await res.json()
  } catch {
    // A network failure says nothing about the token. Keep it and let the
    // caller's own error handling report the outage.
    return false
  }

  if (!data.access_token) {
    // A refresh token GitHub rejects is dead, and retrying it forever would
    // leave the widget silently stale. Anything else may yet recover.
    if (data.error === "bad_refresh_token" || data.error === "invalid_grant") clearTokens()
    return false
  }

  store.local.set("githubTokenExpiry", data.expires_in ? Date.now() + data.expires_in * 1000 : null)
  if (data.refresh_token) store.local.set("githubRefreshToken", data.refresh_token)
  store.local.set("githubToken", data.access_token)
  return true
}

async function ensureValidToken(): Promise<void> {
  const expiry = store.local.get("githubTokenExpiry")
  if (expiry === null) return
  if (Date.now() < expiry - EXPIRY_MARGIN) return
  await refreshOnce()
}

/**
 * Every authenticated call goes through here. A 401 after a refresh has been
 * tried means the token was revoked rather than merely expired, and the only
 * correct move is to drop it and re-prompt.
 */
export async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  await ensureValidToken()

  const token = store.local.get("githubToken")
  if (!token) throw new GithubAuthError("Not connected to GitHub.")

  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`
  let res = await send(url, init, token)

  // A 401 we didn't see coming — a clock that disagrees with GitHub's, or an
  // expiry that arrived while this request was in flight. Worth exactly one
  // refresh and one retry.
  if (res.status === 401 && store.local.get("githubRefreshToken")) {
    if (await refreshOnce()) {
      const refreshed = store.local.get("githubToken")
      if (refreshed) res = await send(url, init, refreshed)
    }
  }

  if (res.status === 401) {
    clearTokens()
    throw new GithubAuthError("GitHub signed you out. Reconnect to keep going.")
  }
  return res
}

function send(url: string, init: RequestInit | undefined, token: string): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...API_HEADERS, ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  }).catch(() => {
    // A dead connection surfaces as a bare "Failed to fetch", which tells the
    // user nothing about which of the two things went wrong.
    throw new GithubNetworkError("Couldn't reach GitHub. Check your connection.")
  })
}

export class GithubAuthError extends Error {}

export class GithubNetworkError extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(id)
      resolve()
    }, { once: true })
  })
}

/**
 * The whole device flow as one call: fetch a code, hand it to the UI, then poll
 * until the user approves. Only one can be in flight — a second Connect click,
 * or a closed popover, aborts the first rather than leaving it polling.
 */
export async function authenticateDevice(opts: {
  onCode: (code: DeviceCode) => void
}): Promise<AuthOutcome> {
  cancelDeviceFlow()

  const requested = await requestDeviceCode()
  if (!requested.ok) return requested

  opts.onCode(requested.code)

  const controller = new AbortController()
  activeFlow = controller
  try {
    return await pollForToken(requested.code, controller.signal)
  } finally {
    if (activeFlow === controller) activeFlow = null
  }
}

export function cancelDeviceFlow(): void {
  activeFlow?.abort()
  activeFlow = null
}
