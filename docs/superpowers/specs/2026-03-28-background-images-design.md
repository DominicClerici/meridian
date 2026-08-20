# Background Images Design

Custom background images for the startpage via Unsplash API or local file upload.

## Decisions

- No overlay or readability adjustments — contrast analysis deferred to a future session
- Users provide their own Unsplash API key (no shipped key)
- Unsplash features gated with a message when no key is set; upload always available
- IndexedDB for image blob caching (avoids bloating localStorage and blocking the synchronous boot path)
- Attribution: small fixed text in bottom-right corner, Unsplash photos only

## Data Model

### Sync Settings (new keys in `SyncSettings`)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `bgType` | `"color" \| "image"` | `"color"` | Whether background is a solid color or image |
| `bgImageSource` | `"unsplash" \| "upload"` | `"unsplash"` | Which image source is active |
| `unsplashDaily` | `boolean` | `false` | Rotate image daily from a topic |
| `unsplashTopic` | `string` | `"wallpapers"` | Unsplash topic slug for daily rotation |
| `unsplashApiKey` | `string` | `""` | User-provided Unsplash API key |

### Local Settings (new keys in `LocalSettings`)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `bgImageMeta` | `BgImageMeta \| null` | `null` | Cached metadata for the current background image |

```ts
type BgImageMeta = {
  id: string            // unsplash photo ID or "upload"
  url: string           // source URL (for re-fetching / attribution)
  authorName: string    // photographer name
  authorUrl: string     // photographer profile URL
  downloadUrl: string   // unsplash download tracking URL
  cachedAt: number      // timestamp for daily rotation staleness check
}
```

### IndexedDB (separate from store)

- Database: `sp-images`
- Object store: `backgrounds`
- Single key: `"current"` → `Blob` (the cached image file)

Image bytes never touch localStorage or `browser.storage`. Only lightweight metadata goes through the store.

## Module Architecture

### `src/idb.ts` — IndexedDB helper

Minimal helper for blob storage:

- `idbGet(key: string): Promise<Blob | null>`
- `idbSet(key: string, blob: Blob): Promise<void>`
- `idbDelete(key: string): Promise<void>`

Hardcoded to the `sp-images` database and `backgrounds` object store. No over-abstraction.

### `src/unsplash.ts` — Unsplash API client

- `searchPhotos(query: string, opts?: { page?: number }): Promise<UnsplashPhoto[]>` — calls `GET /search/photos` with `orientation=landscape`, returns typed results
- `getRandomPhoto(topic: string): Promise<UnsplashPhoto>` — calls `GET /photos/random` with topic filter
- `triggerDownload(downloadUrl: string): Promise<void>` — hits the download tracking endpoint (API requirement, fire-and-forget)
- `TOPICS: { slug: string; label: string }[]` — hardcoded curated list: Nature, Architecture, Wallpapers, Minimal, Textures, Travel, Abstract

All functions read the API key from `store.sync.get("unsplashApiKey")` and throw if missing.

```ts
type UnsplashPhoto = {
  id: string
  urls: { raw: string; small: string; thumb: string }
  author: string
  authorUrl: string
  downloadUrl: string
}
```

### `src/background.ts` — Orchestrator

- `applyBackground(): void` — called at boot, after `applyTheme()`:
  1. Read `bgType`. If `"color"`, do nothing (CSS handles it).
  2. If `"image"`, read `bgImageMeta` from store (synchronous from cache).
  3. Load blob from IndexedDB → `URL.createObjectURL()` → set `document.documentElement.style.backgroundImage`.
  4. Render attribution element if Unsplash source.
  5. If `unsplashDaily` and `cachedAt` is before today, async refresh: fetch new random photo, cache, update meta, swap.
- `setUnsplashPhoto(photo: UnsplashPhoto): Promise<void>` — downloads full-res image (raw URL with Imgix params sized to screen), caches blob in IndexedDB, updates `bgImageMeta` in store, triggers download tracking, applies immediately.
- `setUploadedPhoto(file: File): Promise<void>` — reads file as blob, caches in IndexedDB, updates `bgImageMeta`, applies.
- `clearBackground(): void` — removes IndexedDB entry, clears `bgImageMeta`, removes attribution, resets `backgroundImage` style.
- `subscribeBackground(): void` — listens for `bgType` changes to toggle between color and image mode.

## Page Load Sequence

```
applyTheme()          // existing — sets color bg via CSS custom property (instant)
subscribeTheme()      // existing
applyBackground()     // NEW — if image mode, overlays image on color bg
  ├─ read bgImageMeta from store cache (sync, instant)
  ├─ load blob from IndexedDB (~1-10ms async)
  ├─ URL.createObjectURL(blob) → set backgroundImage on <html>
  ├─ render attribution <span> if unsplash source
  └─ if daily mode & stale: async fetch new photo, swap when ready
```

The solid color background renders first (zero-delay from existing theme system), then the image loads on top from local IndexedDB within milliseconds. Color acts as a natural placeholder — no flash.

## Settings UI

### Appearance Tab

**Background Type toggle** replaces the current "Background Color" section. A row of two buttons ("Color" / "Image") styled like the existing mode selector.

- **Color selected**: existing `bgColor` swatch group appears below (no change from current behavior)
- **Image selected**: swatches disappear, replaced by two accordions:

**Unsplash accordion** (visual "active" indicator when `bgImageSource === "unsplash"`):

- Top row: Checkbox "Refresh daily" + Topic select dropdown (enabled only when checkbox is on). Hardcoded options: Nature, Architecture, Wallpapers, Minimal, Textures, Travel, Abstract.
- Search area: Text input "Search photos..." + 3-column thumbnail grid using `small` URLs (400px). Click a thumbnail to apply as background.
- When `unsplashDaily` is true: search area gets `opacity: 0.4` and `pointer-events: none`.
- When no API key is set: controls replaced with muted text "Add your Unsplash API key in Advanced settings to enable."

**Upload accordion** (visual "active" indicator when `bgImageSource === "upload"`):

- File input button ("Choose image"), accepts image types only.
- Muted note below: "Local images do not sync across devices."
- File is applied and cached immediately on selection.

**Active source indication**: the accordion trigger for the active source gets accent-colored left border or text.

### Advanced Tab

First real setting: a row with label "Unsplash API key" and a password-type text input with show/hide toggle. Stored as `unsplashApiKey` in sync storage.

## Attribution & Unsplash Compliance

**Attribution element:**
- `<span>` with `position: fixed; bottom: 8px; right: 8px`
- Text: "Photo by [Name] on Unsplash" — Name links to `authorUrl`, "Unsplash" links to `unsplash.com`
- ~11px, semi-transparent (`text-page-foreground/60`)
- Only rendered for Unsplash images; hidden for uploads
- Created/destroyed by `background.ts`

**Download tracking:**
- Fired when user clicks a search result thumbnail (before caching)
- Fired when daily rotation fetches a new random photo
- Fire-and-forget — does not block UI

**Image sizing:**
- Cache/display: `raw` URL with `?w={screenWidth}&h={screenHeight}&fit=crop&auto=format&q=80`
- Search thumbnails: `small` URL (400px wide)
- Applied via `background-size: cover; background-position: center` on `<html>`

## File Summary

| File | Change |
|------|--------|
| `src/defaults.ts` | Add `bgType`, `bgImageSource`, `unsplashDaily`, `unsplashTopic`, `unsplashApiKey` to `SyncSettings`; add `bgImageMeta` to `LocalSettings` |
| `src/idb.ts` | New — IndexedDB get/set/delete for blobs |
| `src/unsplash.ts` | New — Unsplash API client (search, random, download tracking, topics list) |
| `src/background.ts` | New — orchestrator (apply, cache, rotate, attribution, subscribe) |
| `src/settings.ts` | Modify `buildAppearanceTab()` for bg type toggle + accordion UI; add API key to Advanced tab |
| `src/index.ts` | Import and call `applyBackground()` + `subscribeBackground()` at boot |
| `src/theme.ts` | No changes — color bg continues to work via existing `data-bg` attribute |
| `src/styles.css` | Minimal — attribution element styling if needed beyond inline |
