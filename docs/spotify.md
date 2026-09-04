# Spotify

**File:** `src/spotify.ts` (1037 lines). **API:** Spotify Web API. **Auth:** OAuth 2.0 with PKCE, entirely in the browser — no backend.

The one widget with no trigger button: when something is playing it renders a card — floating bottom-right in the Immersive layout, in the grid elsewhere. When nothing is playing, the grid and tile cards stay up in the idle state below — an enabled card is always on the page, so the grid never reflows around it — while the Immersive floating card hides (`floatingWanted()`).

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

Scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `user-read-recently-played`, `user-read-private`.

`user-read-recently-played` was added after the first release, and a refresh token keeps the scopes it was issued with — so a session created before it exists gets a 403 from `/me/player/recently-played` forever. `fetchRecentTrack()` latches that into `recentScopeMissing`, stops asking, and the idle card offers a **Reconnect to see recent plays** button instead of failing invisibly.

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

**Controls.** `playerPlay/Pause/Next/Previous` all go through `control()`, which treats `ok` and 204 as success and reports a 404 as `{ noDevice: true }` — Spotify's answer when the account has no active device. That is the ordinary case for the idle card's resume button, since by definition nothing has been playing, so it surfaces as "No active device" rather than as a click that does nothing. `handleControlClick` is a single delegated listener on the card reading `data-spotify-action`; it disables all controls, swaps the pressed button's icon for a spinner, awaits the call, waits 300ms for Spotify's state to settle, refetches, and re-renders.

**Hints.** `setHint()` parks a one-line message under the body and clears it six seconds later. It is the widget's only transient feedback channel — a failed control, a rejected sign-in.

## The idle card

Idle, the grid and tile cards stay mounted with nothing to report. `buildIdleBody(size)` gives them something, picking one of three states in order of how much there is to say:

1. **Last played** — `lastPlayedRow()`, the now-playing row turned down: same shape and rhythm, album art at `opacity-45 saturate-50` (both released on hover), a `LAST PLAYED` eyebrow, and *artist · 2h ago*. The track name links to Spotify; premium accounts also get a round resume button carrying `data-spotify-action="play"`, so it rides the same delegated handler as the transport.
2. **Nothing playing** — a music glyph and a line, once there is a session but no history to show.
3. **Not connected** — the Spotify mark and a **Connect Spotify** button calling `authenticate()` directly, so the widget is a way in and not just a dead box. On success the `spotifyAccessToken` subscriber restarts polling and re-renders, which discards the button along with the rest of the body.

`cardTitle` swaps the header between *Now Playing* and *Spotify* to match ([layouts.md](layouts.md#the-card-registry)).

### Three sizes

`IDLE_SCALES` holds one literal set of class names per host — the Tailwind scanner reads source text, so these can never be interpolated:

| Size | Host | Art |
|---|---|---|
| `card` | the grid card | 64px |
| `tile` | the Dashboard's 118px tile | 44px |
| `mini` | the Immersive floating card | 36px |

`mini` also changes the floating card itself: idle it drops its fixed 320px width, tightens its padding, and sits at `opacity-55` until hovered. Playing, it is a card worth the space; idle, it is a box over someone's wallpaper doing nothing.

### Last played

The API is the source of truth — `GET /me/player/recently-played?limit=1`, at most once a minute (`RECENT_MAX_AGE`), and **only when the idle body would actually be drawn** (`idleBodyWanted()` — any layout but Immersive, whose floating card hides instead), so the Immersive layout adds no requests at all. `poll()` resets the timer whenever something is playing, since that track becomes the last-played entry the moment it stops.

The result is cached in `store.local.spotifyRecentTrack` purely so a new tab draws the row on its first frame instead of after a round trip. `clearTokens()` deletes it — it describes an account, not a browser.

## The card

`buildSpotifyBody()` renders the row itself: 80px album art, track name, artists, and — for premium — previous / play-pause / next. `buildSpotifyTile()` is the same row at tile scale for the Dashboard's top row — 56px art, tighter type, a capped text column so a long track name widens the tile only so far before it truncates ([layouts.md](layouts.md#the-tile-row)).

Where that row goes depends on the [layout](layouts.md). In **Immersive** it goes in the floating card `renderCard()` creates lazily on the first render with content and removes when there's nothing playing or the widget is disabled — fixed bottom-right, 320px, `bg-page-overlay/70` with a backdrop blur. In the other layouts there is no floating card; the same body is mounted as a registered card, gated on `currentPlayerState !== null`. `renderCard()` branches on `getLayout()` and `initSpotify()` subscribes to `layout`, so a switch moves the player without a reload.

Rendered by assigning a template string to `innerHTML`. Track name and artists are run through `escapeHtml()` first, using the textContent-then-read-innerHTML trick. The album art URL is **not** escaped, and is interpolated straight into a `src` attribute.

## Init

`initSpotify()` installs the visibility handler, subscribes to `spotifyEnabled` and `spotifyAccessToken` (so connecting or disconnecting in settings starts or stops polling immediately), places the card, then — if enabled and a token exists — validates the token, checks premium, and starts polling.

The card is placed **before** those two token checks, not after: the idle body has something to say without a session, so returning early would leave the Immersive floating card unplaced for a user who has never connected.

`spotifyEnabled` is subscribed twice — once by `registerCard` via `enabledKey`, once here. `registerCard` runs at module evaluation, so its handler goes first and has already remounted the grid card by the time this one runs; this one only has the floating card left to place, and syncs `cardVisible` so the next `renderCard()` doesn't remount everything a second time.

## Refactor candidates

- **Album art is interpolated into `src` unescaped** (`spotify.ts:356`) while the adjacent text fields are escaped. The URL comes from the Spotify API so it isn't an attack path in practice, but the inconsistency is exactly the kind that survives a refactor and stops being true.
- **The whole body is `innerHTML` string templating.** Every other widget builds DOM with `createElement`. Rebuilding the entire card every 5 seconds also destroys and recreates the `<img>`, which is why album art can flicker.
- **`isPremium` defaults to `true`.** If `/me` fails, a free account sees transport buttons that silently do nothing.
- **`checkPremium()` runs once per connect** and is never rechecked, so upgrading or downgrading an account needs a reconnect.
- **Polling only — no push.** Five seconds of latency on every state change, and a request every five seconds even when nothing is playing.
- **`recentScopeMissing` only resets on a reconnect.** A user who grants the scope elsewhere still sees the reconnect prompt for the life of the tab.
- **The floating card can't be dismissed or moved.** In Immersive it's fixed bottom-right with `z-50`, on top of whatever is there.
- **`retryAfterUntil` gates `fetchPlayerState` but not the control calls**, so pressing next during a rate-limit window still fires a request.
- **No error state in the UI.** `setHint()` covers control failures, but a failed `/me/player` fetch still reads as nothing playing — weather and calendar both distinguish the two.
- **The idle body builds DOM, the playing body builds strings.** `buildIdleBody` and friends use `createElement`; `buildSpotifyBody`/`buildSpotifyTile` are still `innerHTML` templates beside them. Converting the playing bodies would settle the file on one style and retire `escapeHtml`.
