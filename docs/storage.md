# Storage

Everything the app persists, and the four layers it persists into.

| Layer | Module | Holds |
|---|---|---|
| The store (`browser.storage` + localStorage mirror) | `store.ts`, `defaults.ts` | All settings and structured user data |
| Raw `localStorage` | `weather.ts`, `calendar.ts`, `theme.ts` | Ephemeral API response caches and fetch timestamps |
| IndexedDB | `idb.ts` | Background image blobs |
| In-memory only | various | Everything else; lost on navigation |

## The store

A unified, typed, reactive key-value store over `browser.storage.sync`, `browser.storage.local`, and `localStorage`.

```
┌─────────────────────────────────────────────┐
│              In-Memory Cache                │
│   (synchronous reads, always up to date)    │
├──────────────────┬──────────────────────────┤
│   localStorage   │    browser.storage       │
│   (sync mirror)  │  (source of truth)       │
│   instant load   │  async reconciliation    │
└──────────────────┴──────────────────────────┘
```

On page load the cache is seeded synchronously from `localStorage`, so `get()` returns a real value with zero async delay — that's what lets `applyTheme()` run before the first paint without a flash. Then `init()` reconciles asynchronously against `browser.storage`, updating the cache and firing subscribers for anything that differs.

### Namespaces

| Namespace | Backed by | Typed against | Use for |
|---|---|---|---|
| `store.sync` | `browser.storage.sync` | `SyncSettings` | Preferences that follow the user across devices. ~100KB total, ~8KB per item. |
| `store.local` | `browser.storage.local` | `LocalSettings` | Device-local and larger data. ~5MB. |

Both expose the same four methods. The namespaces are typed independently, so `store.sync.get("todos")` is a compile error.

### API

```ts
import { store } from "./store"

store.sync.get("bgColor")            // synchronous, typed, safe before init()
store.sync.set("bgColor", "teal")    // cache → localStorage → browser.storage → subscribers
store.sync.delete("bgColor")         // resets to the default in defaults.ts
const unsub = store.sync.subscribe("bgColor", (val) => { /* ... */ })
await store.init()                   // once, at startup
```

**`get(key)`** — reads the in-memory cache. Never async, never throws, always returns something (the stored value, or the default).

**`set(key, value)`** — in this order: update cache (sync) → write `localStorage` (sync) → fire-and-forget `browser.storage` write (async) → notify subscribers. The value is readable via `get()` immediately; subscribers fire optimistically, before the async write lands.

**`delete(key)`** — resets the cache entry to its `defaults.ts` value, removes the key from both `localStorage` and `browser.storage`, then notifies subscribers with the default.

**`subscribe(key, callback)`** — returns an unsubscribe function. The callback fires on `set()`, on `delete()`, during `init()` reconciliation if the stored value differed, and on cross-tab changes. It receives **only the new value** — read the old one with `get()` first if you need it.

Subscribers are **not** called on registration. The standard pattern is to apply the current value manually, then subscribe:

```ts
function apply(color: SyncSettings["bgColor"]) { /* ... */ }
apply(store.sync.get("bgColor"))
store.sync.subscribe("bgColor", apply)
```

**`init()`** — reconciles both namespaces against `browser.storage`, then registers the `browser.storage.onChanged` listener for cross-tab sync. Must be awaited once at startup (`index.ts:27`). If `browser.storage` is unavailable — running the page outside an extension context, for instance — it resolves silently and the store runs in localStorage-only mode.

### Cross-tab sync

`browser.storage.onChanged` fires in every open tab. The handler updates the cache, mirrors into `localStorage`, and notifies subscribers. Echo suppression is a `JSON.stringify` comparison (`store.ts:122`): if the cache already holds the incoming value — because this tab is the one that wrote it — nothing fires. A `newValue` of `undefined` means the key was deleted elsewhere, and resets to the default.

### localStorage key format

```
sp:sync:<key>     e.g. sp:sync:accentColor
sp:local:<key>    e.g. sp:local:shortcuts
```

The `sp:` prefix (`store.ts:6`) is shared with the raw caches listed further down, so `sp:` is effectively the app's whole localStorage namespace.

### Error handling

The store never throws. Every storage call is guarded:

| Scenario | Behavior |
|---|---|
| `browser.storage` unavailable | Silent fallback to localStorage-only |
| `localStorage` quota exceeded | Write silently dropped; cache and subscribers unaffected |
| `localStorage` entry corrupted (bad JSON) | That key falls back to its default |
| `browser.storage` write rejects | Cache and localStorage already hold the value; retried on the next `set()` |
| `get()` before `init()` | Returns the localStorage value, or the default |

## Adding a setting

Two edits in `src/defaults.ts` — the store picks it up automatically.

```ts
export type SyncSettings = {
  // ...
  showClockBorder: boolean      // 1. add the key and its type
}

export const syncDefaults: SyncSettings = {
  // ...
  showClockBorder: false,       // 2. add its default
}
```

`store.sync.get("showClockBorder")` is now available and fully typed everywhere. To surface it in the UI, see [settings-ui.md](settings-ui.md#adding-a-setting).

Choosing a namespace: put it in `sync` if the user would expect it on their other machine, `local` if it's large, device-specific, or a credential.

## Key inventory

### `store.sync` — `SyncSettings`

| Key | Type | Default | Used by |
|---|---|---|---|
| `theme` | `"modern"` | `"modern"` | `theme.ts`, `icons/registry.ts` |
| `layout` | `"default" \| "dashboard" \| "immersive"` | `"default"` | `layout.ts` |
| `cardOrder` | `string[]` | `[]` | `layout.ts`, `layout-edit.ts` — card ids in the order the user dragged them in Default's grid. Empty means "registration order"; ids it omits sort after the ones it names |
| `accentColor` | `AccentColor \| "random"` | `"sky"` | `theme.ts` |
| `bgColor` | `AccentColor \| "auto"` | `"auto"` | `theme.ts` |
| `mode` | `"light" \| "dark" \| "auto"` | `"auto"` | `theme.ts` |
| `searchEngine` | 7 engines | `"google"` | `search-provider-engine.ts` |
| `debounceSearch` | `boolean` | `false` | `search.ts` |
| `searchOpenInNewTab` | `boolean` | `false` | `search.ts` |
| `clockEnabled` | `boolean` | `true` | `clock.ts` |
| `clockShowSeconds` | `boolean` | `false` | `clock.ts` |
| `clock24Hour` | `boolean` | `false` | `clock.ts` |
| `clockShowAmPm` | `boolean` | `true` | `clock.ts` |
| `clockShowDate` | `boolean` | `false` | `clock.ts` |
| `clockDateFormat` | `"long" \| "short" \| "abbr" \| "numeric" \| "numericShort"` | `"long"` | `clock.ts` |
| `clockSize` | `"small" \| "medium" \| "large"` | `"medium"` | `clock.ts` |
| `worldClocks` | `WorldClock[]` | `[]` | `world-clocks.ts`, `settings.ts` — extra timezones in display order, max 5 (`MAX_WORLD_CLOCKS`). Each is `{ id, timezone, label }`; an empty list is the off state, there is no `worldClocksEnabled` ([world-clocks.md](world-clocks.md)) |
| `todoEnabled` | `boolean` | `true` | `todo.ts` |
| `todoShowBadges` | `boolean` | `true` | `todo.ts` — badges *and* the trigger's progress ring |
| `notepadEnabled` | `boolean` | `true` | `notepad.ts` |
| `notepadFont` | `"sans" \| "mono"` | `"sans"` | `notepad.ts` — the typeface the note is written in |
| `weatherEnabled` | `boolean` | `true` | `weather.ts` |
| `weatherUnit` | `"f" \| "c"` | `"f"` | `weather.ts` |
| `spotifyEnabled` | `boolean` | `true` | `spotify.ts` |
| `spotifyHideWhenIdle` | `boolean` | `true` | `spotify.ts` — off keeps the card up with an idle body ([spotify.md](spotify.md#the-idle-card)) |
| `spotifyClientId` | `string` | `""` | `spotify.ts`, `capabilities.ts` — a user-supplied Spotify app, needed where the bundled one's redirect URI can't apply |
| `recommendationsEnabled` | `boolean` | `false` | `recommendations.ts`, `dock.ts` |
| `shortcutsOpenIn` | `"current" \| "new"` | `"current"` | `dock.ts` |
| `calendarEnabled` | `boolean` | `false` | `calendar.ts` |
| `githubEnabled` | `boolean` | `false` | `github.ts` |
| `githubClientId` | `string` | `""` | `github-auth.ts` — a user-supplied OAuth App, needed until `BUNDLED_CLIENT_ID` is filled in ([github.md](github.md#which-client-id)) |
| `githubSections` | `GithubSection[]` | all four | `github.ts` — which sections the card renders, in `GITHUB_SECTIONS` order |
| `githubHideBots` | `boolean` | `true` | `github.ts` — applied at render, not before caching, so unmuting needs no refetch |
| `githubShowContributions` | `boolean` | `true` | `github.ts` — also drops the calendar from the GraphQL query |
| `githubOrgFilter` | `string` | `""` | `github-api.ts` — appends ` org:NAME` to every search. The **only** GitHub setting that refetches |
| `githubIgnoredRepos` | `string[]` | `[]` | `github.ts` — `owner/name` repos dropped at render |
| `linearEnabled` | `boolean` | `false` | `linear.ts` — hides the trigger and both cards, closes the popover, stops the interval |
| `linearClientId` | `string` | `""` | `linear-auth.ts` — OAuth application client ID. Only needed for the OAuth path; the API key needs none ([linear.md](linear.md#connecting)) |
| `linearSections` | `LinearSection[]` | all four | `linear.ts` — which sections the card renders, in `LINEAR_SECTIONS` order |
| `linearShowCycle` | `boolean` | `true` | `linear.ts` — the burndown, and whether `activeCycle` is asked for at all. Refetches |
| `linearTeamFilter` | `string` | `""` | `linear-api.ts` — team key such as `ENG`. Empty means all teams. Refetches |
| `linearLinkGithub` | `boolean` | `true` | `linear.ts` + `github.ts` — the cross-badge both ways, and whether issue attachments are fetched at all. Refetches ([linear.md](linear.md#the-github-cross-link)) |
| `mailEnabled` | `boolean` | `false` | `mail.ts` |
| `mailCountSource` | `MailCountSource` | `"primary"` | `mail.ts` — which label's unread count the trigger badge and tile report. Falls back to `inbox` on a mailbox with no category tabs ([mail.md](mail.md#counts)) |
| `mailCategories` | `MailCategory[]` | all but `forums` | `mail.ts` — which tabs the body offers, in `MAIL_CATEGORIES` order |
| `mailShowSnippets` | `boolean` | `true` | `mail.ts` — the preview line under each subject |
| `mailMaxRows` | `number` | `12` | `mail.ts` — messages a fetch asks for. The **only** mail setting that refetches, and it drops every tab's cache ([mail.md](mail.md#the-tab-cache)) |
| `bgSource` | `"color" \| "unsplash" \| "upload"` | `"color"` | `background.ts` |
| `unsplashDaily` | `boolean` | `false` | `background.ts` |
| `unsplashTopic` | `string` (a `TOPICS` slug) | `"wallpapers"` | `unsplash.ts` |
| `unsplashApiKey` | `string` | `""` | `unsplash.ts` |

`AccentColor` is one of the ten in `ACCENT_COLORS` (`defaults.ts:13`): rose, coral, amber, teal, sky, violet, slate, stone, zinc, graphite.

### `store.local` — `LocalSettings`

| Key | Type | Default | Used by |
|---|---|---|---|
| `shortcuts` | `Tab[]` | `[]` | `shortcuts.ts` consumers — the whole dock/folder tree |
| `todos` | `Todo[]` | `[]` | `todo.ts`, `todos.ts` — one flat array holding active, archived and subtask todos alike; **read it through `normalizeTodos()`**, since stored records predate several fields ([todos.md](todos.md#data-model)) |
| `notepadBody` | `string` | `""` | `notepad.ts` — the one freeform note. **`local`, not `sync`**: `storage.sync` caps an item at 8KB and throttles writes, which a scratchpad hits. Capped at `MAX_NOTE_LENGTH` (50,000 chars) ([notepad.md](notepad.md#storage)) |
| `notepadUpdatedAt` | `number \| null` (epoch ms) | `null` | `notepad.ts` — drives the footer's *Edited 4m ago*. Written **before** `notepadBody`, since that key's subscription is what repaints |
| `weatherLat` | `number \| null` | `null` | `location.ts` |
| `weatherLon` | `number \| null` | `null` | `location.ts` |
| `weatherLocationSource` | `LocationSource \| null` | `null` | `location.ts` |
| `weatherLocationLabel` | `string \| null` | `null` | `location.ts` |
| `spotifyAccessToken` | `string \| null` | `null` | `spotify.ts` |
| `spotifyRefreshToken` | `string \| null` | `null` | `spotify.ts` |
| `spotifyTokenExpiry` | `number \| null` (epoch ms) | `null` | `spotify.ts` |
| `spotifyRecentTrack` | `SpotifyRecentTrack \| null` | `null` | `spotify.ts` — last played, cached so the idle card draws on the first frame. Cleared by `clearTokens()`, since it belongs to the account rather than the browser |
| `githubToken` | `string \| null` | `null` | `github-auth.ts` — the widget wakes on this key, so `finishConnect()` writes it **last**, after the account and scopes |
| `githubTokenType` | `GithubTokenType \| null` | `null` | `github-auth.ts` — `"oauth"` (device flow) or `"pat"`. Changing `githubClientId` only clears an `oauth` token |
| `githubScopes` | `string` | `""` | `github-auth.ts` — as GitHub returns them. **Empty means unknowable, not missing**: a fine-grained PAT reports none ([github.md](github.md#the-token-path)) |
| `githubUser` | `GithubUser \| null` | `null` | `github.ts` — `{ login, name, avatarUrl }`, so the footer names the account offline |
| `githubRefreshToken` | `string \| null` | `null` | `github-auth.ts` — only issued by a GitHub App with expiring tokens. **Rotated on every use**, so concurrent refreshes must share one request ([github.md](github.md#token-lifecycle)) |
| `githubTokenExpiry` | `number \| null` (epoch ms) | `null` | `github-auth.ts` — **`null` means "never expires"**, and is the short-circuit that keeps the whole refresh path off the network for OAuth App tokens and PATs |
| `githubClientSecret` | `string` | `""` | `github-auth.ts` — a GitHub App's secret, sent only on refresh. `local`, never `sync`: it is a credential and it belongs to this browser. Survives disconnect, like the client ID |
| `linearToken` | `string \| null` | `null` | `linear-auth.ts` — the widget wakes on this key, so it is written **last**, after the account. An API key raw, an OAuth token as a bearer |
| `linearTokenType` | `LinearTokenType \| null` | `null` | `linear-auth.ts` — `"apiKey"` or `"oauth"`. Decides the `Authorization` header format: Linear rejects an API key sent with a `Bearer` prefix |
| `linearRefreshToken` | `string \| null` | `null` | `linear-auth.ts` — OAuth only; an API key has nothing to refresh |
| `linearTokenExpiry` | `number \| null` (epoch ms) | `null` | `linear-auth.ts` — **`null` means "never expires"**, which is every API key. OAuth tokens last 24h and refresh 120s early |
| `linearUser` | `LinearUser \| null` | `null` | `linear-auth.ts` — id, display name, avatar, and the org's name and `urlKey`, so the footer can link the workspace offline |
| `recommendationData` | `RecommendationData \| null` | `null` | `recommendations.ts` |
| `calendarConnected` | `boolean` | `false` | `calendar.ts` |
| `mailConnected` | `boolean` | `false` | `mail.ts` — the widget wakes on this key, so `authenticate()` writes it only **after** consent lands |
| `googleAuthMethod` | `"native" \| "web" \| null` | `null` | `google-auth.ts` |
| `googleAccessToken` | `string \| null` | `null` | `google-auth.ts` |
| `googleTokenExpiry` | `number \| null` (epoch ms) | `null` | `google-auth.ts` |
| `googleGrantedScopes` | `string[]` | `[]` | `google-auth.ts` — what the current token actually carries, as Google reported it. Distinguishes "not signed in" from "signed in without this permission" ([mail.md](mail.md#the-shared-google-account)) |
| `mailAddress` | `string \| null` | `null` | `gmail-api.ts` — the signed-in mailbox, fetched once. Every row deep-links through it as `?authuser=`, so a multi-account browser opens the right one |
| `bgUnsplashMeta` | `BgImageMeta \| null` | `null` | `background.ts` |
| `bgUploadMeta` | `BgImageMeta \| null` | `null` | `background.ts` |
| `dashboardWidget` | `string \| null` | `null` | `layout.ts` — the card id the Dashboard's side carousel was last left on |

`RecommendationData` is `{ heatmap: { [domain: string]: number[][] }, builtAt: number }`.
`BgImageMeta` is `{ id, url, authorName, authorUrl, downloadUrl, cachedAt }`.
`LocationSource` is `"device" | "manual" | "timezone"` — see [browser-compat.md](browser-compat.md#location).

Both Google token keys are written by `google-auth.ts` regardless of which flow produced them, so `calendar.ts` reads one shape either way. `googleAuthMethod` is what `getValidToken()` uses to pick a silent-renewal path.

**One token, two features.** Calendar and Mail share the same access token. `googleGrantedScopes` records what it was issued for, and `connectedFeatures()` — read off `calendarConnected` and `mailConnected` — decides what the *next* token is issued for. That is what keeps a calendar-only user from ever being asked for mail access, and why disconnecting one feature revokes nothing while the other is still connected. See [mail.md](mail.md#the-shared-google-account).

## Raw localStorage caches

Several modules bypass the store and write `localStorage` directly, for data that is a disposable cache rather than a setting. None of it is typed, mirrored, or cross-tab synced.

| Key | Written by | Contents |
|---|---|---|
| `sp:weather:lastFetch` | `weather.ts` | Epoch ms; enforces a 120s fetch cooldown |
| `sp:weather:cachedData` | `weather.ts` | Last current-conditions response: `weatherCode`, `isDay`, and a `values` map keyed by API variable |
| `sp:weather:hourlyData` | `weather.ts` | 72-hour series for every charted variable, the daily aggregates, and the location's UTC offset and timezone — see [weather.md](weather.md#caching) |
| `sp:weather:aqiData` | `weather.ts` | 72-hour US AQI series and current reading from the separate air-quality host, fetched only while that metric is selected |
| `sp:calendar:calendarList` | `calendar.ts:42` | The user's calendar list |
| `sp:calendar:calendarListTs` | `calendar.ts:43` | Timestamp for the 1h TTL on the list |
| `sp:calendar:colors` | `calendar.ts:44` | Google's color-ID → hex map |
| `sp:calendar:week:<sunday>` | `calendar.ts:45` prefix | One week of events plus a timestamp; 5m TTL, pruned outside ±3 weeks ([calendar.md](calendar.md#the-week-cache)) |
| `sp:mail:data` | `mail.ts` | `{ counts, tabs }` — the label unread counts plus one `{ messages, fetchedAt }` entry **per tab**. Hydrated whole on load, so switching tabs paints from disk rather than a skeleton ([mail.md](mail.md#the-tab-cache)) |
| `sp:github:data` | `github.ts` | The last **unfiltered** `GithubData`. Filters run on read, so muting bots needs no refetch ([github.md](github.md#filtering)) |
| `sp:github:lastFetch` | `github.ts` | Epoch ms of the last **successful** fetch, for the footer's *Updated 2m ago*. The 60s cooldown guards on an in-memory `lastAttempt` instead, so a failing fetch can't retry-loop |
| `sp:linear:data` | `linear.ts` | The last **unfiltered** `LinearData` — sections, teams with their workflow states, and the active cycle. The team filter runs on read, so changing it re-renders without a refetch ([linear.md](linear.md#settings)) |
| `sp:linear:lastFetch` | `linear.ts` | Epoch ms of the last **successful** fetch, for the footer's *Updated 2m ago*. The 60s cooldown guards on an in-memory `lastAttempt` instead, so a failing fetch can't retry-loop |
| `sp:local:randomAccentDate` | `theme.ts:10` | `toDateString()` of the day the random accent was picked |
| `sp:local:randomAccentColor` | `theme.ts:11` | The accent picked that day |
| `sp:geo:deviceFailed` | `location.ts` | Epoch ms of the last device-locator failure; suppresses retries for 6h |
| `sp:google:nativeProbe` | `google-auth.ts` | `"available"` / `"unavailable"` — whether `identity.getAuthToken` answers at all |

The last two are capability memos rather than data caches: both record something about the *browser* that won't change between page loads, so probing for it once is enough. See [browser-compat.md](browser-compat.md).

Disconnecting Calendar clears every `sp:calendar:` key by prefix scan (`calendar.ts:153`). Disconnecting Mail removes `sp:mail:data` outright.

Note that `theme.ts`'s two keys use the `sp:local:` prefix — the store's own namespace — without being store keys. They don't currently collide with anything in `LocalSettings`, but adding a `LocalSettings` key named `randomAccentDate` would silently clash.

## IndexedDB

`idb.ts` is a ~60-line promise wrapper over a single object store. Nothing else in the app uses IndexedDB.

| | |
|---|---|
| Database | `sp-images` (version 2) |
| Object stores | `backgrounds`, `shortcut-icons` |
| Keys | `"unsplash"`, `"upload"` |
| Values | `Blob` |
| API | `idbGetFrom(store, key)`, `idbSetIn`, `idbDeleteIn`, `idbKeysIn(store)` |
| Shorthand | `idbGet` / `idbSet` / `idbDelete` still target `backgrounds` |

The connection promise is memoized, so the DB opens at most once per page. `onupgradeneeded` creates any missing store, so the version bump to 2 adds `shortcut-icons` to an existing database without touching the backgrounds already in it.

`shortcut-icons` holds uploaded shortcut, folder and tab icons, keyed by a UUID that the item's `{ type: "image", key }` icon points at. Nothing deletes these on the item's own delete path — `shortcut-settings.ts` sweeps the store against `collectImageKeys()` shortly after init instead, because an item can vanish through a dozen routes and each would otherwise have to remember to free the blob. See [shortcuts.md](shortcuts.md). Background images live here because they're megabytes of binary — far past what `browser.storage.local` should hold — while their *metadata* (author, source URL, cache timestamp) lives in `store.local` as `bgUnsplashMeta` / `bgUploadMeta`. The two must be kept in step; see [backgrounds.md](backgrounds.md).

## Type safety

The store is fully generic. TypeScript enforces key validity, value types, and namespace isolation:

```ts
store.sync.get("accentColor")            // AccentColor | "random"
store.sync.set("accentColor", "teal")    // ok
store.sync.set("accentColor", "purple")  // error: not in the union
store.sync.get("noSuchKey")              // error: key doesn't exist
store.local.get("accentColor")           // error: wrong namespace
```

Because esbuild strips types without checking them, none of that is enforced at build time — run `npx tsc --noEmit`.

## Refactor candidates

- **Reconciliation is one-way.** `reconcile()` (`store.ts:91`) only copies `browser.storage` → cache, and only for keys `browser.storage` already has. A value that exists in `localStorage` but not in `browser.storage` — first run after an update, or a failed write — is never backfilled, so it stays device-local forever and silently stops syncing.
- **`sync` quota is unguarded.** `browser.storage.sync` caps items at ~8KB, and `set()` swallows the rejection (`store.ts:65`). A setting that outgrows the cap fails silently and drifts between devices with no signal to the user or the developer.
- **Three parallel cache conventions.** Weather, calendar, and theme each hand-roll `localStorage` + timestamp + TTL + cooldown logic with their own key constants. A small typed cache helper (`cache.get(key, ttl)`) would replace all three, and would let the store own the `sp:` namespace outright.
- **`theme.ts` squats on `sp:local:`.** Its two random-accent keys are written under the store's own prefix but aren't store keys. Either move them into `LocalSettings` or give them their own prefix.
- **Blob and metadata can desync.** Nothing enforces that `bgUploadMeta` being non-null implies an `"upload"` blob in IndexedDB. `settings.ts:641` already has to handle "metadata says yes, blob says no" by hand.
- **`RecommendationData.heatmap` is unbounded.** It's stored as one `store.local` value holding every domain the history scan saw, each with a 7×24 matrix. Nothing caps its size.
