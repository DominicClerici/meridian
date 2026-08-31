# Spotify

**File:** `src/spotify.ts` (544 lines). **API:** Spotify Web API. **Auth:** OAuth 2.0 with PKCE, entirely in the browser — no backend.

The one widget with no trigger button: when something is playing it renders a card — floating bottom-right in the Immersive layout, in the grid elsewhere — and when nothing is playing it renders nothing at all.

## Auth

PKCE (Proof Key for Code Exchange) is what makes a public client safe without a server holding a secret.

**`authenticate()`** (`spotify.ts:33`):

1. Generate a 96-byte random `code_verifier`, base64url-encoded.
2. `code_challenge = base64url(SHA-256(verifier))`, via `crypto.subtle`.
3. Open `accounts.spotify.com/authorize` through `browser.identity.launchWebAuthFlow` with `response_type=code`, `code_challenge_method=S256`, the resolved client ID (below), and the extension's own redirect URL from `identity.getRedirectURL()`.
4. Pull `code` out of the returned URL.
5. `POST /api/token` with the code and the original verifier — Spotify hashes the verifier and checks it against the challenge it stored.
6. Store `access_token`, `refresh_token`, and `Date.now() + expires_in * 1000` in `store.local`.

Every failure path returns `{ ok: false, error }` with a message naming what actually went wrong — cancelled, unreachable, or a rejected exchange (Spotify's `error_description` is read out of the response body when there is one). Settings renders the string under the connect button.

The token exchange depends on `host_permissions` covering `accounts.spotify.com`; without it the `POST /api/token` is an ordinary CORS request from a `chrome-extension://` origin and can be refused outright. See [architecture.md](architecture.md#manifest).

Scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `user-read-private`.

### Which client ID

Two, resolved by `getClientId()` on every auth and refresh:

1. **`spotifyClientId`** from `store.sync`, if the user has set one.
2. **`BUNDLED_CLIENT_ID`** — the extension's own app, public by design in PKCE — but only where `bundledClientUsable()` says the browser's redirect URI could be on its allowlist.

That last test is the whole point. A Spotify app's redirect URIs are fixed at registration and accept no wildcards, and `identity.getRedirectURL()` differs per browser: Chromium hands out `https://<extension-id>.chromiumapp.org/`, which is stable and registered; Firefox hands out `https://<uuid>.extensions.allizom.org/`, where the UUID is regenerated per *installation* and so can never be registered ahead of time. `bundledClientUsable()` checks the redirect URI's host rather than sniffing the browser — that URI is the thing that has to match the registration, so it is the real test.

With neither available, `authenticate()` returns `{ ok: false, needsClientId: true }` and a message pointing at Settings → Advanced, where **Spotify sign-in** offers the client-ID field, the redirect URI with a copy button, and the dashboard link. `summarizeSpotify()` in `capabilities.ts` reports it as *Needs setup* before the user ever presses connect.

Changing `spotifyClientId` calls `clearTokens()` (subscribed in `initSpotify()`). A refresh token belongs to the app that issued it, so pointing at a different client would otherwise fail its next refresh with an opaque 400.

Worth noting this isn't only a Firefox concern: a Spotify app in development mode is capped at 25 manually-listed users, so a shared bundled client ID doesn't scale past a handful of installs regardless of browser.

**Token lifecycle.** `ensureValidToken()` refreshes when the token is within 60s of expiry, or when there's no access token but a refresh token exists. `refreshAccessToken()` also handles rotation (Spotify may return a new refresh token) and calls `clearTokens()` on a 400 or 401, which is what forces a re-login when a refresh token is revoked.

`spotifyFetch()` wraps every API call: ensure a valid token, attach the bearer header, and on a 401 refresh once and retry exactly once.

## Playback

**Polling.** `poll()` fetches `/me/player` and re-renders, every `POLL_INTERVAL = 5000`ms. A `visibilitychange` handler stops polling when the tab is hidden and restarts it when visible — the only widget in the app that does this.

**Rate limiting.** A 429 reads the `Retry-After` header (defaulting to 5s) into `retryAfterUntil`, and `fetchPlayerState()` returns early until that passes.

**No content.** A 204, a non-ok response, or a payload with no `item` all set `currentPlayerState = null`, which removes the card.

**Premium gating.** `checkPremium()` reads `/me` once after connecting and sets `isPremium = data.product === "premium"`. Playback control endpoints are premium-only, so free accounts get the card with track info but no transport buttons. `isPremium` **defaults to `true`**, so the buttons show until proven otherwise.

**Controls.** `playerPlay/Pause/Next/Previous` are PUT/POST calls treating both `ok` and 204 as success. `handleControlClick` is a single delegated listener on the card reading `data-spotify-action`; it disables all controls, swaps the pressed button's icon for a spinner, awaits the call, waits 300ms for Spotify's state to settle, refetches, and re-renders.

## The card

`buildSpotifyBody()` renders the row itself: 80px album art, track name, artists, and — for premium — previous / play-pause / next. `buildSpotifyTile()` is the same row at tile scale for the Dashboard's top row — 56px art, tighter type, a capped text column so a long track name widens the tile only so far before it truncates ([layouts.md](layouts.md#the-tile-row)).

Where that row goes depends on the [layout](layouts.md). In **Immersive** it goes in the floating card `renderCard()` creates lazily on the first render with content and removes when there's nothing playing or the widget is disabled — fixed bottom-right, 320px, `bg-page-overlay/70` with a backdrop blur. In the other layouts there is no floating card; the same body is mounted as a registered card, gated on `currentPlayerState !== null`. `renderCard()` branches on `getLayout()` and `initSpotify()` subscribes to `layout`, so a switch moves the player without a reload.

Rendered by assigning a template string to `innerHTML`. Track name and artists are run through `escapeHtml()` (`spotify.ts:316`) first, using the textContent-then-read-innerHTML trick. The album art URL is **not** escaped, and is interpolated straight into a `src` attribute.

## Init

`initSpotify()` installs the visibility handler, subscribes to `spotifyEnabled` and to `spotifyAccessToken` (so connecting or disconnecting in settings starts or stops polling immediately), then — if enabled and a token exists — validates the token, checks premium, and starts polling.

## Refactor candidates

- **Album art is interpolated into `src` unescaped** (`spotify.ts:356`) while the adjacent text fields are escaped. The URL comes from the Spotify API so it isn't an attack path in practice, but the inconsistency is exactly the kind that survives a refactor and stops being true.
- **The whole body is `innerHTML` string templating.** Every other widget builds DOM with `createElement`. Rebuilding the entire card every 5 seconds also destroys and recreates the `<img>`, which is why album art can flicker.
- **`isPremium` defaults to `true`.** If `/me` fails, a free account sees transport buttons that silently do nothing.
- **`checkPremium()` runs once per connect** and is never rechecked, so upgrading or downgrading an account needs a reconnect.
- **Polling only — no push.** Five seconds of latency on every state change, and a request every five seconds even when nothing is playing.
- **The floating card can't be dismissed or moved.** In Immersive it's fixed bottom-right with `z-50`, on top of whatever is there.
- **`retryAfterUntil` gates `fetchPlayerState` but not the control calls**, so pressing next during a rate-limit window still fires a request.
- **No error state in the UI.** Weather and calendar both have one; here a failure is indistinguishable from nothing playing.
