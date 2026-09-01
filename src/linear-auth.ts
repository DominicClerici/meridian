import { store } from "./store"
import type { LinearUser } from "./defaults"

/**
 * Linear has two ways in and they are not equally easy, so the widget leads
 * with the easy one.
 *
 * A **personal API key** (Linear → Settings → Security & access) is a paste and
 * nothing else: no app to register, no redirect URI, identical on every
 * browser. That is the default path.
 *
 * **OAuth** is the better-scoped path — it can ask for read-only, and its
 * tokens expire — but Linear checks the redirect URI against an app's
 * allowlist, and there is no bundled app here whose allowlist could already
 * contain this browser's URI. So OAuth only works once the user registers their
 * own app and pastes its client ID in Settings → Advanced. Linear supports
 * PKCE with `client_secret` optional, which is what makes it possible from a
 * browser extension at all.
 */
const BUNDLED_CLIENT_ID = ""

const AUTH_URL = "https://linear.app/oauth/authorize"
const TOKEN_URL = "https://api.linear.app/oauth/token"
const REVOKE_URL = "https://api.linear.app/oauth/revoke"
export const GRAPHQL_URL = "https://api.linear.app/graphql"

/** `write` is what lets a row change an issue's status and clear a notification. */
const SCOPES = "read,write"

/** Refreshed this far before the token actually dies, so a fetch never races it. */
const EXPIRY_MARGIN = 120_000

export type LinearAuthOutcome =
  | { ok: true }
  | { ok: false; error: string; needsClientId?: boolean }

export class LinearAuthError extends Error {}
export class LinearApiError extends Error {}

export function isConnected(): boolean {
  return store.local.get("linearToken") !== null
}

export function getClientId(): string {
  return store.sync.get("linearClientId").trim() || BUNDLED_CLIENT_ID
}

/** Writes never go out on a read-only OAuth token; an API key carries both. */
export function canWrite(): boolean {
  return isConnected()
}

export function clearTokens(): void {
  store.local.set("linearToken", null)
  store.local.set("linearTokenType", null)
  store.local.set("linearRefreshToken", null)
  store.local.set("linearTokenExpiry", null)
  store.local.set("linearUser", null)
}

// ---------------------------------------------------------------- API key

const VIEWER_QUERY = `
query { viewer { id name displayName avatarUrl url organization { name urlKey } } }
`

/**
 * The primary path. The key is validated against `viewer` before it is stored,
 * so a typo fails here rather than as a broken widget three seconds later.
 */
export async function connectWithApiKey(key: string): Promise<LinearAuthOutcome> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, error: "Paste an API key first." }

  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      // An API key goes in raw. Linear reserves `Bearer` for OAuth tokens and
      // rejects the key outright if it arrives with that prefix.
      headers: { "Content-Type": "application/json", Authorization: trimmed },
      body: JSON.stringify({ query: VIEWER_QUERY }),
    })
  } catch {
    return { ok: false, error: "Couldn't reach Linear. Check your connection." }
  }

  if (res.status === 401 || res.status === 400) {
    return { ok: false, error: "Linear rejected that key." }
  }
  if (!res.ok) return { ok: false, error: `Linear answered ${res.status}.` }

  const body = await res.json().catch(() => null)
  const viewer = body?.data?.viewer
  if (!viewer?.id) {
    return { ok: false, error: body?.errors?.[0]?.message ?? "Linear wouldn't say who that key belongs to." }
  }

  storeAccount(viewer)
  store.local.set("linearTokenType", "apiKey")
  store.local.set("linearRefreshToken", null)
  store.local.set("linearTokenExpiry", null)
  // Last, so the widget's subscriber wakes on a token whose account already exists.
  store.local.set("linearToken", trimmed)
  return { ok: true }
}

// ---------------------------------------------------------------- OAuth

function getRedirectURL(): string | null {
  try {
    const api = globalThis.browser ?? globalThis.chrome
    return api?.identity?.getRedirectURL() ?? null
  } catch {
    return null
  }
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
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain))
}

export async function authenticateOAuth(): Promise<LinearAuthOutcome> {
  const api = globalThis.browser ?? globalThis.chrome
  if (!api?.identity?.launchWebAuthFlow) {
    return { ok: false, error: "This browser doesn't support the extension auth flow. Use an API key instead." }
  }

  const redirectUri = getRedirectURL()
  if (!redirectUri) {
    return { ok: false, error: "Could not determine the extension's redirect URL." }
  }

  const clientId = getClientId()
  if (!clientId) {
    return {
      ok: false,
      needsClientId: true,
      error: "No Linear client ID configured. Add one in Settings → Advanced, or connect with an API key.",
    }
  }

  const codeVerifier = generateCodeVerifier()
  const state = generateCodeVerifier().slice(0, 32)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Linear takes scopes comma-separated, not space-separated like everyone else.
    scope: SCOPES,
    state,
    actor: "user",
    code_challenge_method: "S256",
    code_challenge: base64UrlEncode(await sha256(codeVerifier)),
  })

  let responseUrl: string
  try {
    responseUrl = await api.identity.launchWebAuthFlow({
      url: `${AUTH_URL}?${params.toString()}`,
      interactive: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: /did not approve|cancel/i.test(msg) ? "Sign-in was cancelled." : `Sign-in failed: ${msg}`,
    }
  }

  if (!responseUrl) return { ok: false, error: "The Linear window closed before completing." }

  const returned = new URL(responseUrl)
  const authError = returned.searchParams.get("error")
  if (authError) return { ok: false, error: `Linear returned: ${authError}` }
  if (returned.searchParams.get("state") !== state) {
    return { ok: false, error: "The sign-in response didn't match the request. Try again." }
  }

  const code = returned.searchParams.get("code")
  if (!code) return { ok: false, error: "Linear didn't return an authorization code." }

  let tokenRes: Response
  try {
    tokenRes = await fetch(TOKEN_URL, {
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
  } catch {
    return { ok: false, error: "Couldn't reach Linear to exchange the code." }
  }

  if (!tokenRes.ok) {
    let detail = `HTTP ${tokenRes.status}`
    try {
      const body = await tokenRes.json()
      detail = body?.error_description ?? body?.error ?? detail
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, error: `Linear rejected the token exchange: ${detail}` }
  }

  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenData?.access_token) {
    return { ok: false, error: "Linear returned a token response we couldn't read." }
  }

  const viewer = await fetchViewer(`Bearer ${tokenData.access_token}`)
  if (!viewer) {
    return { ok: false, error: "Signed in, but Linear wouldn't say who. Try again." }
  }

  storeAccount(viewer)
  store.local.set("linearTokenType", "oauth")
  store.local.set("linearRefreshToken", tokenData.refresh_token ?? null)
  store.local.set("linearTokenExpiry", Date.now() + (tokenData.expires_in ?? 86400) * 1000)
  store.local.set("linearToken", tokenData.access_token)
  return { ok: true }
}

/**
 * OAuth access tokens last 24 hours. Without a refresh token there is nothing
 * to do but drop the session — returning false here surfaces the connect panel
 * rather than looping on 401s.
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = store.local.get("linearRefreshToken")
  const clientId = getClientId()
  if (!refreshToken || !clientId) return false

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) clearTokens()
      return false
    }
    const data = await res.json()
    if (!data?.access_token) return false

    store.local.set("linearToken", data.access_token)
    if (data.refresh_token) store.local.set("linearRefreshToken", data.refresh_token)
    store.local.set("linearTokenExpiry", Date.now() + (data.expires_in ?? 86400) * 1000)
    return true
  } catch {
    return false
  }
}

export async function disconnect(): Promise<void> {
  const token = store.local.get("linearToken")
  const type = store.local.get("linearTokenType")
  // Best effort, and only meaningful for OAuth — an API key is revoked in
  // Linear's own settings, not through this endpoint.
  if (token && type === "oauth") {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      /* the local token is going away regardless */
    }
  }
  clearTokens()
}

// ---------------------------------------------------------------- requests

function storeAccount(viewer: any): void {
  const account: LinearUser = {
    id: viewer.id,
    name: viewer.name ?? "",
    displayName: viewer.displayName ?? viewer.name ?? "",
    avatarUrl: viewer.avatarUrl ?? null,
    url: viewer.url ?? "https://linear.app",
    orgName: viewer.organization?.name ?? "",
    orgUrlKey: viewer.organization?.urlKey ?? "",
  }
  store.local.set("linearUser", account)
}

async function fetchViewer(authHeader: string): Promise<any | null> {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ query: VIEWER_QUERY }),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.data?.viewer ?? null
  } catch {
    return null
  }
}

async function authHeader(): Promise<string> {
  const type = store.local.get("linearTokenType")

  if (type === "oauth") {
    const expiry = store.local.get("linearTokenExpiry")
    if (expiry !== null && Date.now() > expiry - EXPIRY_MARGIN) {
      if (!(await refreshAccessToken())) {
        throw new LinearAuthError("Linear signed you out. Reconnect to keep going.")
      }
    }
  }

  const token = store.local.get("linearToken")
  if (!token) throw new LinearAuthError("Not connected to Linear.")
  return type === "oauth" ? `Bearer ${token}` : token
}

/**
 * Every authenticated call goes through here. Linear answers a dead credential
 * with 401 or 400, and neither is recoverable once the refresh above has
 * already been tried — so the token is dropped and the widget re-prompts.
 */
export async function linearRequest<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data: T | null; errors?: any[] }> {
  const header = await authHeader()

  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: header },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    })
  } catch {
    throw new LinearApiError("Couldn't reach Linear. Check your connection.")
  }

  if (res.status === 401 || res.status === 403) {
    clearTokens()
    throw new LinearAuthError("Linear signed you out. Reconnect to keep going.")
  }
  if (res.status === 429) {
    throw new LinearApiError(rateLimitMessage(res))
  }
  if (!res.ok && res.status !== 200) {
    // A GraphQL error arrives as 400 with a usable body; only read it as a
    // transport failure once the body turns out not to be one.
    const body = await res.json().catch(() => null)
    if (!body?.errors) throw new LinearApiError(`Linear answered ${res.status}.`)
    return { data: body.data ?? null, errors: body.errors }
  }

  const body = await res.json().catch(() => null)
  if (!body) throw new LinearApiError("Linear returned a response we couldn't read.")
  if (!body.data && body.errors?.length) {
    throw new LinearApiError(body.errors[0]?.message ?? "Linear rejected the query.")
  }
  return { data: body.data ?? null, errors: body.errors }
}

function rateLimitMessage(res: Response): string {
  const reset = Number(res.headers.get("x-ratelimit-requests-reset")) || 0
  if (reset) {
    const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000))
    return `Linear rate limit reached. Resets in ${mins} min.`
  }
  return "Linear rate limit reached. Try again shortly."
}
