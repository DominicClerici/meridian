# Spotify Widget Design

## Overview

A floating player card that shows the user's current Spotify playback state. Displays track title, artist, album art, and playback controls (premium only). Polls every 5 seconds. Hidden when nothing is playing. Uses Spotify's Authorization Code + PKCE flow via `browser.identity.launchWebAuthFlow` for authentication with no backend required.

## Storage

New keys in `SyncSettings` (in `src/defaults.ts`):

| Key | Type | Default |
|-----|------|---------|
| `spotifyEnabled` | `boolean` | `true` |
| `spotifyAccessToken` | `string \| null` | `null` |
| `spotifyRefreshToken` | `string \| null` | `null` |
| `spotifyTokenExpiry` | `number \| null` | `null` |

The Client ID is a hardcoded constant in `spotify.ts`, not stored.

## OAuth Flow

Uses Authorization Code + PKCE via `browser.identity.launchWebAuthFlow`.

### Steps

1. User clicks "Connect Spotify" in settings dialog.
2. Generate random `code_verifier` (128 chars), derive `code_challenge` (SHA-256, base64url).
3. Call `browser.identity.launchWebAuthFlow({ url, interactive: true })` targeting Spotify's `/authorize` endpoint.
4. Scopes requested: `user-read-playback-state user-modify-playback-state user-read-currently-playing`.
5. Spotify redirects to `https://<extension-id>.chromiumapp.org/` with an auth code.
6. Exchange auth code + code_verifier for tokens via `POST /api/token` (no client secret — PKCE).
7. Store `accessToken`, `refreshToken`, `tokenExpiry` in `store.sync`.

### Token Refresh

- On page load: if `spotifyTokenExpiry` is past or near-expiry, use the refresh token to get a new access token.
- On 401 during polling: attempt refresh, retry once. If refresh fails, clear all tokens (user sees "Connect Spotify" in settings).
- Refresh tokens are long-lived (no expiry unless revoked or 6 months inactive).

### Disconnect

Clears `spotifyAccessToken`, `spotifyRefreshToken`, `spotifyTokenExpiry` from the store.

### Manifest Change

Add `"identity"` to the `permissions` array in `manifest.json`.

## Player State & Polling

### Fetching

- `GET /v1/me/player` — returns current track, playback state, device info.
- 204 response or no active device = nothing playing = hide widget.

### Polling

- On page load (if enabled + authenticated): fetch immediately.
- Poll every 5 seconds via `setInterval`.
- Stop polling when `spotifyEnabled` toggled off or tokens cleared.
- After a control action resolves: fetch immediately instead of waiting for next tick.

### Error Handling

- 401: attempt token refresh, retry once. If refresh fails, clear tokens, stop polling.
- Other errors: silently skip that poll cycle.

### Premium Detection

- Call `GET /v1/me` once after authentication to check `product === "premium"`.
- Stored in a local variable (not persisted). Re-checked each page load.
- Non-premium users: playback controls are hidden entirely.

## Player Controls

Three buttons (premium only): Previous, Play/Pause, Next.

### On Press

1. Disable all three control buttons immediately.
2. Replace the pressed button's icon with a loading spinner.
3. Fire the API call (`PUT /v1/me/player/pause`, `PUT /v1/me/player/play`, `POST /v1/me/player/next`, `POST /v1/me/player/previous`).
4. On resolve: fetch player state immediately, re-render widget, re-enable controls.
5. On failure: re-enable controls, restore original icon. No error UI — next poll tick picks up changes.

## Widget UI

### Floating Card

- Fixed position, bottom-right corner with padding.
- ~320px wide.
- Album art (80-100px).
- Track title (truncated if long).
- Artist name (truncated if long).
- Controls row (previous / play-pause / next) — premium only.

### Visibility

- Hidden if `spotifyEnabled` is false.
- Hidden if not authenticated (no access token).
- Hidden if nothing is playing (204 / no active device).
- Shown only when there is an active playback state.

### DOM

- No trigger button in the top-right widgets bar.
- Card created/destroyed dynamically in `spotify.ts` (not pre-built in `index.html`).

## Settings UI

Added to the settings dialog as a new "Spotify" section:

- Enable/disable checkbox.
- If not authenticated: "Connect Spotify" button (triggers OAuth flow).
- If authenticated: "Disconnect" button (clears tokens).

## Architecture

Single file: `src/spotify.ts`. Follows the same pattern as `weather.ts` — combines auth, API, polling, and DOM rendering. Exported `initSpotify()` function called from `src/index.ts` on DOMContentLoaded.

## Files Modified

| File | Change |
|------|--------|
| `src/spotify.ts` | New file — auth, API, polling, rendering |
| `src/defaults.ts` | Add 4 new `SyncSettings` keys |
| `src/settings.ts` | Wire Spotify enable toggle + connect/disconnect buttons |
| `src/index.html` | Add Spotify settings section to the dialog |
| `src/index.ts` | Import and call `initSpotify()` |
| `manifest.json` | Add `"identity"` permission |
