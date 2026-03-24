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
