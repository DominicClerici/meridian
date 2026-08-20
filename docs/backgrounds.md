# Backgrounds

The page background: an animated mesh gradient tinted to the theme color, a photo from Unsplash, or an uploaded image.

**Files:** `src/background.ts` · `src/mesh-bg.ts` · `src/color.ts` · `src/unsplash.ts` (82) · `src/idb.ts` (58). UI lives in `settings.ts` — see [settings-ui.md](settings-ui.md#appearance).

## The three sources

`bgSource` (sync) is `"color" | "unsplash" | "upload"`.

**Color** renders the WebGL mesh gradient in `mesh-bg.ts`, seeded from the `--page-bg` the theme cascade resolves for the current `bgColor` and mode. See [the mesh gradient](#the-mesh-gradient) below.

**Unsplash and upload** both work the same way — the image bytes live in IndexedDB, the metadata lives in `store.local`:

| | Blob (IndexedDB `sp-images`/`backgrounds`) | Metadata (`store.local`) |
|---|---|---|
| Unsplash | key `"unsplash"` | `bgUnsplashMeta` |
| Upload | key `"upload"` | `bgUploadMeta` |

```ts
type BgImageMeta = {
  id, url, authorName, authorUrl, downloadUrl, cachedAt
}
```

Blobs go to IndexedDB because they're megabytes — far past what `browser.storage.local` should hold. Metadata goes to the store because it's small and needs reactivity. **The two are only correlated by convention**; nothing enforces that a non-null meta implies a stored blob.

Uploads never sync across devices (the settings UI says so), and neither do Unsplash photos — only the metadata does, and it's in the `local` namespace anyway.

## Application

```
applyBackground()          // index.ts, module body, before first paint
  ├─ source "color"   → startMesh()
  ├─ source "unsplash"→ loadFromSlot("unsplash") → then refreshDaily() if stale
  └─ source "upload"  → loadFromSlot("upload")
                         └─ returned false? → startMesh()
```

`loadFromSlot()` reads the metadata, pulls the blob from IndexedDB, revokes the previous object URL, creates a new one, and sets `backgroundImage` / `backgroundSize: cover` / `backgroundPosition: center` on `<html>` as inline styles. It **returns `false`** if either half is missing, and the caller falls back to the mesh — so a half-deleted image slot degrades to a themed background rather than a bare color.

`stopMesh()` is called only once a blob is confirmed, so a failed image load never leaves the page blank.

Because IndexedDB is async, the background paints a frame or two after the page — the theme color shows first. That's the tradeoff for not storing the image somewhere synchronously readable.

`subscribeBackground()` re-runs the right branch whenever `bgSource` changes.

**Object URL hygiene:** a single module-level `currentObjectUrl` is revoked before every replacement (`revokeCurrentUrl`), so switching backgrounds repeatedly doesn't leak.

## The mesh gradient

`mesh-bg.ts` renders a full-screen WebGL canvas — `#mesh-bg`, inserted as `<body>`'s first child at `z-index: -1`. That sits above the `--page-bg` propagated from `html` but below every positioned element in `#app`, so **if anything fails the flat color is still there**. `startMesh()` returns early without inserting the canvas when the context or shader fails, and the page looks exactly as it did before this feature existed.

### Deriving a palette from one color

The theme gives exactly one hex (`--page-bg`); a mesh needs several. `color.ts` converts it to OKLCH and generates five stops plus a base fill by rotating hue, offsetting lightness, and scaling chroma:

| Stop | Δhue | Δlightness | ×chroma |
|---|---|---|---|
| 1 | −42° | +0.11 | 0.95 |
| 2 | −15° | −0.07 | 1.20 |
| 3 | +20° | +0.06 | 1.05 |
| 4 | +48° | −0.05 | 0.85 |
| 5 | +78° | +0.09 | 0.70 |

All three deltas are scaled by `INTENSITY` (0.65).

**Light and dark need very different treatment.** A dark `--page-bg` is nearly achromatic (`#152a4a` is C ≈ 0.065), so its stops are boosted by `1 + 2.6 × INTENSITY`; a light one is already vivid and gets only `1 + 0.15 × INTENSITY`. Without that split, dark themes render as flat mud.

OKLCH rather than HSL because hue rotation in HSL changes perceived lightness — the stops would come out unevenly bright. `oklchToRgb()` gamut-fits by **reducing chroma until the color fits sRGB** instead of clipping channels, since clipping shifts hue and would break the harmony.

### The shader

Sixteen orbs, each carrying **its own color**, weight-blended:

```glsl
float w = exp(-d2 / (rad*rad*1.9));   // gaussian falloff per orb
acc  += w * palette(i % 5);
wsum += w;
vec3 col = mix(c0, acc/wsum, clamp(wsum*1.45, 0., 1.));
```

Blending per-orb colors is what makes it read as a mesh. The obvious alternative — merging orbs into one distance field with `smin` and coloring by depth — produces concentric rings around a single silhouette no matter how many orbs you add.

Supporting details:

- **Golden-angle spiral placement** (`fi * 2.39996`) gives even coverage at any orb count with no grid for the eye to lock onto.
- **Radius and drift amplitude scale by `1/√N`**, so the count subdivides the field instead of piling on paint.
- **The whole field is domain-warped by fBm** before sampling, so no orb ever reads as a circle.
- **Output is dithered** by ±0.006. These gradients are low-frequency enough to band visibly on 8-bit displays without it.

### Motion and cost

Drift is time-based; the cursor adds a parallax offset of `CURSOR_STRENGTH` (0.68), eased at 0.06/frame toward the pointer.

| Condition | Behaviour |
|---|---|
| `prefers-reduced-motion: reduce` | `uTime` pinned to 0, cursor pinned to centre, **one frame drawn and the rAF loop stops** |
| `document.hidden` | rAF cancelled; resumes on `visibilitychange` |
| Image background active | `stopMesh()` — loop cancelled and canvas `hidden` |

The backing buffer is CSS pixels, ignoring DPR and capped at `MAX_BUFFER_WIDTH` (2560). The imagery is entirely low-frequency, so rendering below native and letting the compositor upscale is free visually and much cheaper on 4K displays.

### Reacting to theme changes

A `MutationObserver` on `<html>` watching `data-mode`, `data-bg`, and `data-theme` recomputes the palette and cross-fades to it over 450 ms.

This is deliberately an observer rather than store subscriptions. `bgColor: "auto"` follows the accent, and `mode: "auto"` flips from a `matchMedia` listener in `theme.ts` with no store write at all — watching the resolved attributes catches every path with one mechanism instead of mirroring `theme.ts`'s resolution logic.

## Attribution

Unsplash's API terms require crediting the photographer and linking back with a `utm_source` parameter. `renderAttribution()` builds a fixed bottom-right span — "Photo by *Name* on Unsplash" — with both links carrying `?utm_source=startpage&utm_medium=referral`. It's removed for uploads and when switching to color.

`triggerDownload(downloadUrl)` (`unsplash.ts:80`) pings the photo's `download_location` endpoint, fire-and-forget. Unsplash requires this whenever a photo is actually used — it's how photographers get download counts. Called from `setUnsplashPhoto`.

## Daily refresh

With `unsplashDaily` on, a new photo is fetched once per day from the chosen topic.

`isStale(cachedAt)` compares `toDateString()` values, so "stale" means *a different calendar day*, not 24 hours elapsed — a photo fetched at 23:50 refreshes ten minutes later.

`refreshDaily()` no-ops unless daily is on, an API key is set, and the current photo is stale. `refreshDailyNow()` skips the staleness check for the settings Refresh button. Both call `getRandomPhoto(topic)` then `setUnsplashPhoto(photo)`.

## The Unsplash client

`unsplash.ts` — three calls, all requiring `unsplashApiKey` (sync setting, set in Settings → Advanced). `getApiKey()` throws when it's empty, so every call fails loudly if unconfigured.

| Function | Endpoint |
|---|---|
| `searchPhotos(query, { page? })` | `/search/photos` — landscape, 20 per page |
| `getRandomPhoto(topic)` | `/photos/random` — landscape, filtered by topic |
| `triggerDownload(url)` | the photo's `download_location` |

`TOPICS` (`unsplash.ts:13`) lists seven Unsplash topic slugs: Wallpapers, Nature, Architecture, Textures, Travel, Minimal, Abstract.

**Sizing.** `setUnsplashPhoto` appends `w`/`h` from `window.screen`, plus `fit=crop&auto=format&q=80`, to the photo's `raw` URL — so the downloaded image matches the display, not the original resolution.

## Setting a background

**From Unsplash search** — pick a thumbnail in the settings grid → `setUnsplashPhoto(photo)`: fetch the sized image, store the blob, write the metadata, set `bgSource = "unsplash"`, ping the download endpoint, and apply immediately without a round trip through IndexedDB. Also turns `unsplashDaily` off, since picking a specific photo contradicts rotating daily.

**From upload** — `setUploadedPhoto(file)`: store the `File` (a `Blob`) as-is, write placeholder metadata with `id: "upload"`, turn off `unsplashDaily`, set `bgSource = "upload"`, and apply.

**Back to color** — `switchToColor()`: revoke the URL, strip the inline styles, remove the attribution, restart the mesh, turn off daily, set `bgSource = "color"`. The blobs stay in IndexedDB, so switching back is instant.

## Refactor candidates

- **Old blobs are never deleted.** `idbDelete` is exported and called from nowhere. Every new upload and every daily photo overwrites its slot, so the DB doesn't grow unboundedly — but switching to color leaves both images resident forever with no way to clear them.
- **Blob and metadata can desync.** Nothing is transactional across IndexedDB and the store. `settings.ts:641` already works around it by handling "metadata exists, blob doesn't" by hand. `loadFromSlot` now at least reports the mismatch so the caller can fall back to the mesh, but one `saveBackground(slot, blob, meta)` that writes both, and a load path that repairs the mismatch, would close it properly.
- **Mesh tuning constants are hard-coded.** `ORB_COUNT`, `INTENSITY` and `CURSOR_STRENGTH` are module constants in `mesh-bg.ts`. Exposing intensity (or a "flat / mesh" switch) would need a `SyncSettings` key and an appearance control.
- **The +78° stop swings far on warm hues.** Amber (H ≈ 85°) reaches green at the widest stop. Harmonious, but further from "tinted to that color" than the cooler palettes are.
- **Uploads are stored at original resolution.** A 12MP phone photo goes into IndexedDB untouched, while Unsplash photos are fetched pre-sized to the screen. Downscaling on upload via a canvas would match the two.
- **No file-size or type validation on upload.** `accept="image/*"` on the input is the only check; a 50MB file is accepted silently.
- **`isStale` is calendar-day based**, so a photo picked just before midnight is replaced minutes later.
- **The API key lives in `store.sync`**, meaning it's written to `browser.storage.sync` and synced to every device signed into the browser profile.
- **`refreshDaily` only runs at page load.** A tab left open past midnight keeps yesterday's photo until it's reloaded.
- **Background styles are inline on `<html>`.** They fight the `--page-bg` rule in the base layer rather than composing with it; a `data-bg-source` attribute and a CSS rule would be inspectable and themeable.
- **Failures are silent.** A failed Unsplash fetch, a failed IndexedDB write, and a missing blob all end in an empty `catch` — the user sees the old background and no explanation.
- **`mapPhoto(raw: any)`** (`unsplash.ts:33`) reaches five levels into an untyped response; a malformed payload throws inside a `.map`.
