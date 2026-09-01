# Browser compatibility

Two axes of trouble. **Chromium forks** remove browser *services* the extension
leans on — that's the first half of this doc. **Firefox** keeps the services but
differs on API *conventions* and CSS support — that's [the second](#firefox).

The motivating case for the first half is **ungoogled-chromium**, but nothing
there is specific to it: Brave, Vivaldi, a Chrome profile with enterprise
policy, and Firefox all trip some subset of the same wires.

## What a de-Googled build actually changes

Ungoogled-chromium rewrites Google domains in Chromium's *own source* at build
time to a sentinel TLD (`www.googleapis.com` → `www.9oo91eapis.qjz9zk`) and
blocks anything that reaches for one. It also ships no Google API keys and
removes browser sign-in.

The consequence that matters, and the one that is easy to get backwards:

> **Domain substitution only touches Chromium's compiled-in URLs, not extension
> code.** A `fetch("https://www.googleapis.com/calendar/v3/…")` from
> `calendar.ts` goes out completely normally. Only the browser's *internal*
> requests — the network location provider, GAIA, sync — are rewritten and
> blocked.

So the Calendar API is fine. What breaks is narrower than it first looks:

| Service | Status | Why |
|---|---|---|
| `navigator.geolocation` | Permanently broken | The network locator posts to `googleapis.com`, which is substituted and blocked. No API key either, and on Linux there's no OS provider to fall back to. Returns `POSITION_UNAVAILABLE` regardless of the permission state. |
| `identity.getAuthToken` | Hangs | Brokers against the profile's signed-in Google account. With sign-in removed, the interactive flow starts a sign-in that has no UI to complete, so the callback never fires — no rejection, no console error. |
| `identity.launchWebAuthFlow` | Works | Pure Chromium. No GAIA, no API key, no signed-in profile. |
| `fetch` to Google APIs | Works | Not subject to substitution, per above. |

## Detection

**Don't sniff the browser.** Ungoogled-chromium reports as stock Chrome on
purpose — the UA string and `navigator.userAgentData` brands both match — and
probing `googleapis.com` with `fetch` reports "all good" while the platform is
broken. Both approaches produce confident wrong answers.

**Probe the capability instead.** Two signals do the whole job:

- **Permission vs. provider.** `navigator.permissions.query({name:"geolocation"})`
  returning `granted` while `getCurrentPosition` returns `POSITION_UNAVAILABLE`
  is proof that the *provider* is broken rather than the permission.
  `location.ts` records the failure in `sp:geo:deviceFailed`.
- **Answer vs. silence.** `probeNativeBroker()` (`google-auth.ts`) races
  `getAuthToken({interactive:false})` against a 4s clock. A *rejection* counts
  as available — "not signed in" is a real answer. Only silence means the broker
  isn't there. Cached in `sp:google:nativeProbe`.

Both results are memos about the browser, not about the user, so they're probed
once and cached rather than re-run per page load.

`capabilities.ts` composes these into the report rendered in
Settings → Advanced. It deliberately reports capabilities rather than naming a
browser, because the same capability goes missing for several unrelated reasons.

## Location

`location.ts` owns a four-step chain, tried in order by `resolveLocation()`:

1. **A manual pick always wins.** If `weatherLocationSource === "manual"` the
   stored coordinates are returned without touching the device locator — an
   explicit choice is never silently overridden.
2. **The device locator**, unless it failed within the last 6 hours
   (`DEVICE_RETRY_BACKOFF`). Where the provider is blocked this fails *every*
   time, and retrying on each 5-minute refresh would burn a 10s timeout and spam
   the console for nothing.
3. **Whatever was last stored**, from any source.
4. **A timezone estimate** — `Intl.DateTimeFormat().resolvedOptions().timeZone`
   looked up in the ~140-entry table in `timezone-coords.ts`. Zero network, zero
   permission, accurate to the right metro area, which is all a temperature
   reading needs.

`null` comes back only when the timezone is unmapped *and* nothing is stored;
the widget then asks for a city.

A timezone estimate is labelled as one — `approximateNote()` in `weather.ts`
renders "Approximate — estimated from your timezone (Denver)" under the chart.
It's good enough to show, but it isn't what the user asked for, so it says so.

**Manual entry** is a city search against
`geocoding-api.open-meteo.com` — same vendor as the forecast itself, no API key.
It's always visible in settings rather than appearing only after a failure, so
the path exists before it's needed.

`requestDeviceLocation()` wraps `getCurrentPosition` with its own wall-clock
guard on top of the `timeout` option, because a blocked provider can leave the
call hanging past its own deadline. It maps the three `PositionError` codes onto
distinct messages in `GEO_FAILURE_TEXT` — "denied" and "no provider" need
different fixes and must not be reported as the same thing.

## Google sign-in

`google-auth.ts` presents one interface over two mechanisms, for two features.

**Scopes are per feature, not per extension.** Calendar and Mail share one
token, issued for the union of whatever is *connected* — so connecting only the
calendar never puts Gmail on the consent screen, and disconnecting one revokes
nothing while the other is still signed in. The registry and the reasoning are
in [mail.md](mail.md#the-shared-google-account); everything below applies to
both features equally.

**`authenticate(feature)`** probes the native broker, then:

- Broker available → `getAuthToken({interactive:true})`, raced against a 2-minute
  clock. If that fails for any reason *other* than the broker going silent, that
  failure is returned as-is — a declined consent is the user's answer, not a
  reason to open a second window.
- Broker unavailable, or it went silent mid-flow → the redirect flow.

**The redirect flow** is `launchWebAuthFlow` against Google's OAuth endpoint
using `response_type=token` (implicit). It needs no client secret and no token
exchange; the token comes back in the URL *fragment*. Renewal is the same call
with `prompt=none` and `interactive:false`, which succeeds whenever the auth
partition still holds a Google session.

It does require the user to supply their own OAuth client, because a
Chrome-Extension-type client can't register redirect URIs. Settings → Advanced
has the field, shows the extension's redirect URI with a copy button, and links
to the console. `summarizeGoogle()` in `capabilities.ts` reports
`Needs setup` until a client ID is present — one row for both the Calendar and
Gmail widgets, since they share the path and the client ID.

**The native broker can ignore the scope override.** `getAuthToken({scopes})` is
documented to override `manifest.json`, and on a stripped Chromium it can hand
back the manifest's token while reporting success. `verifyGrant()` therefore
checks `hasScopesFor()` *after* a successful sign-in rather than trusting the
outcome, so a partial grant is reported at the point the user can act on it
instead of surfacing later as an unexplained 403.

**Why implicit rather than PKCE:** Google's Web-application clients still expect
a `client_secret` at the token endpoint, and the client types that accept PKCE
without one (Desktop app) only allow `localhost` redirect URIs — not
`chromiumapp.org`. Implicit avoids embedding a secret. The cost is no refresh
token and a ~1h lifetime, which is invisible behind a 5-minute refresh interval.

## Firefox

Firefox has every service Chromium forks strip out. What it differs on is
conventions, and the failures are quieter for it.

### The history and bookmarks APIs

The single sharpest edge in the codebase. `globalThis.browser ?? globalThis.chrome`
resolves to `browser` on Firefox — and `browser.*` is **promise-only**. It never
invokes a trailing callback, and its argument validation throws on the extra
parameter. Chrome's `chrome.*` is the mirror image: callback-first, returns
nothing.

Written the Chrome way, `history.search(query, cb)` on Firefox produces a
promise that never settles or a synchronous throw — so the import dialog hangs
on its spinner and the recommendation heatmap silently never builds.

`ext-call.ts` calls with a callback *and* takes the return value, so whichever
one answers wins:

```ts
try { returned = fn(arg, callback) } catch { returned = fn(arg) }
return isThenable(returned) ? returned : viaCallback
```

Behaviour detection, not a `browser`-is-defined check — a fork that defines
`browser` with callback semantics still works. All `history`, `bookmarks`,
`tabs` and `permissions` access goes through `history-api.ts` /
`bookmarks-api.ts` / `tabs-api.ts`, which share it; don't reach for
`api.history` directly.

`storage` and `identity` need no such treatment: Chrome has returned promises
from both since MV3, so the plain `browser ?? chrome` alias is enough.

## Optional permissions

`bookmarks` and `tabs` are declared in `optional_permissions` in **both**
manifests rather than `permissions`. Two reasons:

- On Chrome, growing a `permissions` array **disables the extension** until the
  user re-approves it in the extensions page. Importing bookmarks is a thing
  most people do once, if ever; making everyone re-authorise a new-tab page
  over it is a bad trade.
- It keeps the install prompt honest. A startpage asking for full bookmark
  access at install time reads badly, and deservedly.

The cost is that the request has to happen inside a **user gesture**. Chrome
rejects a `permissions.request()` that isn't synchronous with a click, so
`pickSource()` in `shortcut-import.ts` calls `requestBookmarks()` first and
awaits nothing before it. Declining is an ordinary outcome, not an error: the
dialog returns to the source list with an explanation.

The command palette asks the same way, from the button on the notice it shows
when you scope to `@bm` or `@tab` without the grant. See
[search.md](search.md#permissions).

`tabs` has a wrinkle the others don't: **`tabs.query` succeeds without it**. It
just omits `url` and `title`, which is the entire payload tab search needs. So
`tabs-api.ts` checks `permissions.contains` rather than inferring the grant from
the API being present — a check that reads as redundant and isn't.

### Optional host permissions

`optional_host_permissions` carries the four search-suggestion endpoints
(`suggestqueries.google.com`, `api.bing.com`, `duckduckgo.com`,
`ac.ecosia.org`). They are requested by the **Engine suggestions** checkbox in
Widgets → Search, under the same user-gesture rule, through
`requestOrigins()` in `ext-call.ts`. The setting only flips on if the grant
comes back — an enabled checkbox that silently can't fetch would be worse than
an unchecked one.

`bookmarksSupported()` distinguishes the third state — a browser with no
`permissions` API at all — so the source card can be disabled with a reason
rather than failing after it's picked. See
[shortcut-import.md](shortcut-import.md#the-permission-request).

### The manifest

Firefox builds from `manifest.firefox.json` (`./build.sh --firefox` → `dist-firefox/`),
which differs from the Chrome manifest in three keys and nothing else:

| Key | Chrome | Firefox |
|---|---|---|
| `key` | Pins the extension ID | Absent — not implemented, AMO flags it |
| `oauth2` | Configures `identity.getAuthToken` | Absent — same |
| `browser_specific_settings.gecko.id` | Absent — Chrome warns | `startpage@meridian` |

The add-on ID is the load-bearing one. Firefox refuses `storage.sync` for an
add-on without an explicit ID, and hard-errors for temporary installs. Because
`store.ts` catches storage failures and falls back to localStorage-only mode,
dropping it doesn't break anything *visibly* — it just silently stops every
`store.sync` key from syncing across devices or propagating between tabs.

See [architecture.md](architecture.md#why-two-files-rather-than-one-generated)
for why these are two literal files rather than one generated at build time.

### The redirect URI

`identity.getRedirectURL()` returns different hosts per browser:

| Chrome | `https://<extension-id>.chromiumapp.org/` |
| Firefox | `https://<per-install-uuid>.extensions.allizom.org/` |

One value per browser, not per service — every flow redirects to the same
place. Firefox's UUID is regenerated per *installation*, so it can't be
registered ahead of time on any OAuth client, and it changes again each time the
add-on is reloaded temporarily.

Both services handle this the same way: a **user-supplied client ID** with the
redirect URI shown next to it to register. `buildOAuthSection()` in `settings.ts`
renders both, and `capabilities.ts` reports each as *Needs setup* before the
user ever presses connect.

- **Google** has no bundled fallback for this flow at all — the `oauth2` client
  in the manifest only works through `getAuthToken`.
- **Spotify** has a bundled app, used only where `bundledClientUsable()`
  confirms the browser's redirect URI could be on its allowlist (i.e. the host
  ends in `.chromiumapp.org`). Everywhere else `authenticate()` returns
  `needsClientId: true` rather than letting Spotify answer `INVALID_CLIENT`.

Note the test is on the redirect URI's host, not the browser's identity —
consistent with [Detection](#detection) above. The URI is the thing that has to
match the registration, so it is the real test rather than a proxy for one.

### GitHub is the exception

The GitHub widget sidesteps this section entirely: the **device flow has no
redirect URI**, so there is nothing per-browser to register and one client ID
works on Chromium, Firefox and de-Googled builds alike. It never touches
`identity` at all. See [github.md](github.md#the-device-flow).

What it needs instead is the **host permission**, and needs it more than the
other services do. `github.com/login/device/code` and
`github.com/login/oauth/access_token` send no `Access-Control-Allow-Origin`, so
unlike Open-Meteo or Spotify these calls cannot succeed on CORS alone — they
work only because `host_permissions` lets an extension page bypass the check.
On Firefox, where MV3 host permissions are optional-until-granted, a user who
hasn't granted `https://github.com/*` gets a sign-in that fails at the token
exchange. The personal-access-token path is the fallback there, since
`api.github.com` is only ever reached with a token already in hand.

### CSS

| Feature | Firefox | Handling |
|---|---|---|
| `::-webkit-scrollbar` | Not supported | Every webkit scrollbar block is paired with `scrollbar-width` / `scrollbar-color`. `thin` is the narrowest Firefox offers, so the exact 4px/6px widths are WebKit-only. |
| `corner-shape: squircle` | Not supported | `@supports`-guarded in `styles.css`; `--corner-shape` stays `round`. Corners are plain quarter-circles on Firefox. |
| `backdrop-filter` | Supported (103+) | `-webkit-` prefix kept for older WebKit only. |

### Not a problem

- **`fetch` and host permissions.** Firefox MV3 treats `host_permissions` as
  optional-until-granted, but most endpoints the extension calls (open-meteo,
  Spotify, googleapis, Unsplash) send `Access-Control-Allow-Origin`, so the
  requests succeed on CORS alone. **`github.com/login/*` does not** — see
  [GitHub is the exception](#github-is-the-exception).
- **`chrome_url_overrides.newtab`**, `<dialog>`/`::backdrop`, `color-mix`,
  `:has()`, Resize/MutationObserver, WAAPI, IndexedDB, `crypto.subtle` — all
  supported on both.
- **Geolocation** prompts on `moz-extension://` where Chrome grants silently
  from the manifest. The fallback chain above already covers a refusal.

## The general rule

All three original bugs presented the same way: a control that froze or did
nothing, with nothing in the console. That's the failure mode to design against.

- **Every platform-brokered call gets a timeout.** `getAuthToken` has no
  contract that says it must settle, and on some builds it doesn't.
- **Every async button gets three terminal states** — success, actionable
  failure, unknown failure with the detail attached. `spotify.ts:authenticate()`
  used to have five `return false` paths that were indistinguishable from each
  other; it now returns `{ ok: false, error }` and settings renders the string.
- **Say what's wrong, not what you guessed.** "Your browser has no working
  location provider" is true and actionable on every browser. "Permission
  denied" was neither.
