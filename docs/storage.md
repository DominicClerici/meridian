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
| `todoEnabled` | `boolean` | `true` | `todo.ts` |
| `todoShowBadges` | `boolean` | `true` | `todo.ts` |
| `weatherEnabled` | `boolean` | `true` | `weather.ts` |
| `weatherUnit` | `"f" \| "c"` | `"f"` | `weather.ts` |
| `spotifyEnabled` | `boolean` | `true` | `spotify.ts` |
| `recommendationsEnabled` | `boolean` | `false` | `recommendations.ts`, `dock.ts` |
| `shortcutsOpenIn` | `"current" \| "new"` | `"current"` | `dock.ts` |
| `calendarEnabled` | `boolean` | `false` | `calendar.ts` |
| `bgSource` | `"color" \| "unsplash" \| "upload"` | `"color"` | `background.ts` |
| `unsplashDaily` | `boolean` | `false` | `background.ts` |
| `unsplashTopic` | `string` (a `TOPICS` slug) | `"wallpapers"` | `unsplash.ts` |
| `unsplashApiKey` | `string` | `""` | `unsplash.ts` |

`AccentColor` is one of the ten in `ACCENT_COLORS` (`defaults.ts:13`): rose, coral, amber, teal, sky, violet, slate, stone, zinc, graphite.

### `store.local` — `LocalSettings`

| Key | Type | Default | Used by |
|---|---|---|---|
| `shortcuts` | `Tab[]` | `[]` | `shortcuts.ts` consumers — the whole dock/folder tree |
| `todos` | `Todo[]` | `[]` | `todo.ts`, `todos.ts` |
| `weatherLat` | `number \| null` | `null` | `weather.ts` |
| `weatherLon` | `number \| null` | `null` | `weather.ts` |
| `spotifyAccessToken` | `string \| null` | `null` | `spotify.ts` |
| `spotifyRefreshToken` | `string \| null` | `null` | `spotify.ts` |
| `spotifyTokenExpiry` | `number \| null` (epoch ms) | `null` | `spotify.ts` |
| `recommendationData` | `RecommendationData \| null` | `null` | `recommendations.ts` |
| `calendarConnected` | `boolean` | `false` | `calendar.ts` |
| `bgUnsplashMeta` | `BgImageMeta \| null` | `null` | `background.ts` |
| `bgUploadMeta` | `BgImageMeta \| null` | `null` | `background.ts` |

`RecommendationData` is `{ heatmap: { [domain: string]: number[][] }, builtAt: number }`.
`BgImageMeta` is `{ id, url, authorName, authorUrl, downloadUrl, cachedAt }`.

## Raw localStorage caches

Three modules bypass the store and write `localStorage` directly, for data that is a disposable cache rather than a setting. None of it is typed, mirrored, or cross-tab synced.

| Key | Written by | Contents |
|---|---|---|
| `sp:weather:lastFetch` | `weather.ts:58` | Epoch ms; enforces a 120s fetch cooldown |
| `sp:weather:cachedData` | `weather.ts:59` | Last current-conditions response |
| `sp:weather:hourlyData` | `weather.ts:60` | Last hourly forecast, for the chart |
| `sp:calendar:lastFetch` | `calendar.ts:32` | Epoch ms; 10s cooldown |
| `sp:calendar:calendarList` | `calendar.ts:29` | The user's calendar list |
| `sp:calendar:calendarListTs` | `calendar.ts:30` | Timestamp for the 1h TTL on the list |
| `sp:calendar:colors` | `calendar.ts:31` | Google's color-ID → hex map |
| `sp:calendar:events:<range>` | `calendar.ts:33` prefix | Cached events, keyed by date range |
| `sp:local:randomAccentDate` | `theme.ts:10` | `toDateString()` of the day the random accent was picked |
| `sp:local:randomAccentColor` | `theme.ts:11` | The accent picked that day |

Disconnecting Calendar clears every `sp:calendar:` key by prefix scan (`calendar.ts:152`).

Note that `theme.ts`'s two keys use the `sp:local:` prefix — the store's own namespace — without being store keys. They don't currently collide with anything in `LocalSettings`, but adding a `LocalSettings` key named `randomAccentDate` would silently clash.

## IndexedDB

`idb.ts` is a ~60-line promise wrapper over a single object store. Nothing else in the app uses IndexedDB.

| | |
|---|---|
| Database | `sp-images` (version 1) |
| Object store | `backgrounds` |
| Keys | `"unsplash"`, `"upload"` |
| Values | `Blob` |
| API | `idbGet(key)`, `idbSet(key, blob)`, `idbDelete(key)` |

The connection promise is memoized, so the DB opens at most once per page. Background images live here because they're megabytes of binary — far past what `browser.storage.local` should hold — while their *metadata* (author, source URL, cache timestamp) lives in `store.local` as `bgUnsplashMeta` / `bgUploadMeta`. The two must be kept in step; see [backgrounds.md](backgrounds.md).

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
