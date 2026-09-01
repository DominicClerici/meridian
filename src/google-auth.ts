import { store } from "./store"
import type { GoogleAuthMethod, GoogleFeature } from "./defaults"

/**
 * What each feature needs, and the only place a scope is named. The token is
 * always issued for the union of the *connected* features' scopes, never for
 * everything this file knows about — connecting the calendar must not ask for
 * mail, which is the whole reason this is a map rather than a constant.
 */
const FEATURE_SCOPES: Record<GoogleFeature, readonly string[]> = {
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  mail: ["https://www.googleapis.com/auth/gmail.modify"],
}

const FEATURE_LABELS: Record<GoogleFeature, string> = {
  calendar: "Calendar",
  mail: "Gmail",
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"

/**
 * `getAuthToken` brokers against the browser profile's signed-in Google
 * account. On builds with Google sign-in removed the interactive flow starts a
 * sign-in that has no UI to complete, so the call never settles — every path
 * through it is raced against a clock.
 */
const NATIVE_PROBE_TIMEOUT = 4_000
const NATIVE_INTERACTIVE_TIMEOUT = 120_000

const LS_NATIVE_PROBE = "sp:google:nativeProbe"

export type NativeProbe = "available" | "unavailable"

export type AuthOutcome =
  | { ok: true }
  | { ok: false; error: string; needsClientId?: boolean }

/** `brokerDead` separates "the broker isn't there" from "the user said no". */
type NativeOutcome = AuthOutcome | { ok: false; error: string; brokerDead: true }

function getApi() {
  return globalThis.browser ?? globalThis.chrome
}

export function nativeApiPresent(): boolean {
  try {
    return typeof getApi()?.identity?.getAuthToken === "function"
  } catch {
    return false
  }
}

export function webAuthAvailable(): boolean {
  try {
    return typeof getApi()?.identity?.launchWebAuthFlow === "function"
  } catch {
    return false
  }
}

export function getRedirectUri(): string | null {
  try {
    return getApi()?.identity?.getRedirectURL() ?? null
  } catch {
    return null
  }
}

const TIMED_OUT = Symbol("timed-out")

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) =>
      setTimeout(() => resolve(TIMED_OUT), ms)
    ),
  ])
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === "string") return e
  return "Unknown error"
}

function cacheNativeProbe(result: NativeProbe): void {
  try {
    localStorage.setItem(LS_NATIVE_PROBE, result)
  } catch { /* quota */ }
}

export function cachedNativeProbe(): NativeProbe | null {
  try {
    const raw = localStorage.getItem(LS_NATIVE_PROBE)
    return raw === "available" || raw === "unavailable" ? raw : null
  } catch {
    return null
  }
}

/**
 * Does the native token broker answer at all? A rejection counts as available —
 * "not signed in" is a real answer. Only silence means the broker isn't there.
 */
export async function probeNativeBroker(force = false): Promise<NativeProbe> {
  if (!force) {
    const cached = cachedNativeProbe()
    if (cached) return cached
  }

  if (!nativeApiPresent()) {
    cacheNativeProbe("unavailable")
    return "unavailable"
  }

  let call: Promise<unknown>
  try {
    call = getApi()!.identity.getAuthToken({ interactive: false })
  } catch {
    cacheNativeProbe("unavailable")
    return "unavailable"
  }

  const answered = call.then(
    () => true,
    () => true
  )
  const raced = await withTimeout(answered, NATIVE_PROBE_TIMEOUT)
  const result: NativeProbe = raced === TIMED_OUT ? "unavailable" : "available"
  cacheNativeProbe(result)
  return result
}

/** The features holding a connection right now. The union of these is what any
    token gets issued for. */
function connectedFeatures(): GoogleFeature[] {
  const out: GoogleFeature[] = []
  if (store.local.get("calendarConnected")) out.push("calendar")
  if (store.local.get("mailConnected")) out.push("mail")
  return out
}

/** The scope set a token must cover for `feature` plus everything already connected. */
function scopeSetFor(feature: GoogleFeature): string[] {
  const set = new Set<string>()
  for (const f of [...connectedFeatures(), feature]) {
    for (const scope of FEATURE_SCOPES[f]) set.add(scope)
  }
  return [...set]
}

/**
 * Does the token in hand actually carry what `feature` needs? A connected
 * feature whose scope was never granted is a different problem from a missing
 * token, and only this distinguishes them.
 */
export function hasScopesFor(feature: GoogleFeature): boolean {
  const granted = store.local.get("googleGrantedScopes")
  return FEATURE_SCOPES[feature].every((scope) => granted.includes(scope))
}

function storeToken(
  token: string,
  expiresInSeconds: number,
  method: GoogleAuthMethod,
  granted: string[]
): void {
  store.local.set("googleAccessToken", token)
  store.local.set("googleTokenExpiry", Date.now() + expiresInSeconds * 1000)
  store.local.set("googleAuthMethod", method)
  store.local.set("googleGrantedScopes", granted)
}

async function nativeAuthenticate(
  interactive: boolean,
  scopes: string[]
): Promise<NativeOutcome> {
  if (!nativeApiPresent()) {
    return {
      ok: false,
      error: "This browser has no native Google token broker.",
      brokerDead: true,
    }
  }

  let call: Promise<GetAuthTokenResult>
  try {
    call = getApi()!.identity.getAuthToken({ interactive, scopes })
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }

  let raced: GetAuthTokenResult | typeof TIMED_OUT
  try {
    raced = await withTimeout(
      call,
      interactive ? NATIVE_INTERACTIVE_TIMEOUT : NATIVE_PROBE_TIMEOUT
    )
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }

  if (raced === TIMED_OUT) {
    cacheNativeProbe("unavailable")
    return {
      ok: false,
      error:
        "Your browser's Google account service never responded — it's disabled or removed in this build.",
      brokerDead: true,
    }
  }

  const token = raced?.token
  if (!token) return { ok: false, error: "No token was returned." }

  // Native tokens are ~1h; renew a little early rather than trusting the clock.
  // Older Chromiums answer without `grantedScopes`; the broker grants the whole
  // request or errors, so what we asked for is the honest fallback.
  storeToken(token, 3_000, "native", raced.grantedScopes ?? scopes)
  return { ok: true }
}

function googleErrorText(code: string): string {
  switch (code) {
    case "access_denied":
      return "You declined the permission request."
    case "interaction_required":
    case "login_required":
    case "consent_required":
      return "Google needs you to sign in again."
    case "invalid_client":
      return "Google rejected the client ID. Check that it's an OAuth client of type \"Web application\" and that the redirect URI is registered."
    case "redirect_uri_mismatch":
      return "Google rejected the redirect URI. Register the extension's redirect URL on the OAuth client."
    default:
      return `Google returned an error: ${code}`
  }
}

async function webAuthenticate(
  interactive: boolean,
  scopes: string[]
): Promise<AuthOutcome> {
  const api = getApi()
  if (!api?.identity?.launchWebAuthFlow) {
    return { ok: false, error: "This browser doesn't support the web auth flow." }
  }

  const clientId = store.sync.get("googleClientId").trim()
  if (!clientId) {
    return {
      ok: false,
      error:
        "This browser can't use Chrome's built-in Google sign-in. Add a Google OAuth client ID under Settings → Advanced to sign in.",
      needsClientId: true,
    }
  }

  const redirectUri = getRedirectUri()
  if (!redirectUri) {
    return { ok: false, error: "Could not determine the extension's redirect URL." }
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    include_granted_scopes: "true",
    prompt: interactive ? "consent" : "none",
  })

  let responseUrl: string
  try {
    responseUrl = await api.identity.launchWebAuthFlow({
      url: `${AUTH_ENDPOINT}?${params.toString()}`,
      interactive,
    })
  } catch (e) {
    const msg = errorText(e)
    if (!interactive) return { ok: false, error: msg }
    return {
      ok: false,
      error: /did not approve|cancel/i.test(msg)
        ? "Sign-in was cancelled."
        : `Sign-in failed: ${msg}`,
    }
  }

  if (!responseUrl) {
    return { ok: false, error: "The sign-in window closed before completing." }
  }

  // The implicit flow returns the token in the fragment, not the query string.
  const parsed = new URL(responseUrl)
  const result = new URLSearchParams(parsed.hash.replace(/^#/, ""))

  const err = result.get("error") ?? parsed.searchParams.get("error")
  if (err) return { ok: false, error: googleErrorText(err) }

  const token = result.get("access_token")
  if (!token) return { ok: false, error: "Google didn't return an access token." }

  // `include_granted_scopes` means the token can come back with more than was
  // asked for, so the response is the authority on what it carries.
  const grantedRaw = result.get("scope")
  const granted = grantedRaw ? grantedRaw.split(" ").filter(Boolean) : scopes
  storeToken(token, Number(result.get("expires_in") ?? 3600), "web", granted)
  return { ok: true }
}

export function currentMethod(): GoogleAuthMethod | null {
  return store.local.get("googleAuthMethod")
}

/**
 * A grant that came back without what was asked for. The redirect flow reports
 * a partial consent plainly; the native broker on a stripped Chromium can
 * ignore the scope override entirely and hand back the manifest's token, so the
 * only reliable check is what the token says it carries afterwards.
 */
function verifyGrant(outcome: AuthOutcome, feature: GoogleFeature): AuthOutcome {
  if (!outcome.ok || hasScopesFor(feature)) return outcome
  return {
    ok: false,
    error: `Google signed you in but didn't grant ${FEATURE_LABELS[feature]} access. Approve the ${FEATURE_LABELS[feature]} permission when the consent screen asks, or add your own OAuth client ID under Settings → Advanced.`,
  }
}

/**
 * Interactive sign-in for one feature. Prefers the native broker, falls back to
 * the web flow. The scope set is the union with whatever is already connected,
 * so approving mail never silently drops calendar off the same token.
 */
export async function authenticate(feature: GoogleFeature): Promise<AuthOutcome> {
  const scopes = scopeSetFor(feature)
  const probe = await probeNativeBroker()

  if (probe === "available") {
    const native = await nativeAuthenticate(true, scopes)
    // Only a dead broker justifies opening a second window — a declined or
    // failed consent is the user's answer, not a reason to ask again.
    if (native.ok || !("brokerDead" in native)) return verifyGrant(native, feature)
    if (!webAuthAvailable()) return native
  }

  return verifyGrant(await webAuthenticate(true, scopes), feature)
}

/**
 * A non-expired token that covers `feature`, renewing silently when possible.
 * Null if sign-in is needed — including when the token is live but was issued
 * before this feature was connected, which a silent renew usually repairs.
 */
export async function getValidToken(feature: GoogleFeature): Promise<string | null> {
  const token = store.local.get("googleAccessToken")
  const expiry = store.local.get("googleTokenExpiry")
  if (token && expiry && Date.now() < expiry - 60_000 && hasScopesFor(feature)) return token

  const method = currentMethod()
  if (!method) return null

  const scopes = scopeSetFor(feature)
  const renewed =
    method === "native"
      ? await nativeAuthenticate(false, scopes)
      : await webAuthenticate(false, scopes)
  if (!renewed.ok || !hasScopesFor(feature)) return null
  return store.local.get("googleAccessToken")
}

/** Drop the current token so the next call re-authenticates. Used on a 401. */
export async function invalidateToken(): Promise<void> {
  const token = store.local.get("googleAccessToken")
  if (token && currentMethod() === "native") {
    try {
      await getApi()?.identity?.removeCachedAuthToken({ token })
    } catch { /* broker gone */ }
  }
  store.local.delete("googleAccessToken")
  store.local.delete("googleTokenExpiry")
  // The record describes the token that just went away. Leaving it would let
  // `hasScopesFor` vouch for a token nobody holds.
  store.local.set("googleGrantedScopes", [])
}

/**
 * Give up one feature's claim on the shared account. Calendar and Mail sign in
 * once between them, so revoking is only correct once *nothing* is left —
 * otherwise disconnecting mail would sign the calendar out too.
 *
 * Callers clear their own connected flag first; this reads that flag back.
 */
export async function releaseGoogle(): Promise<void> {
  if (connectedFeatures().length > 0) return
  await revoke()
}

export async function revoke(): Promise<void> {
  const token = store.local.get("googleAccessToken")
  await invalidateToken()

  if (token) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: "POST",
      })
    } catch { /* offline, or already revoked */ }
  }

  store.local.delete("googleAuthMethod")
  store.local.set("googleGrantedScopes", [])
}
