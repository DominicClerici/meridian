# Background UI Refactor Design

Refactor the appearance tab background controls from a Color/Image toggle to three always-visible accordions (Color, Unsplash, Upload) with independent image persistence per source.

## Data Model Changes

### Sync Settings

**Remove:** `bgType`, `bgImageSource`

**Add:**

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `bgSource` | `"color" \| "unsplash" \| "upload"` | `"color"` | Which background source is active |

**Keep unchanged:** `unsplashDaily`, `unsplashTopic`, `unsplashApiKey`

### Local Settings

**Remove:** `bgImageMeta`

**Add:**

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `bgUnsplashMeta` | `BgImageMeta \| null` | `null` | Metadata for the unsplash image (manual pick or daily rotation) |
| `bgUploadMeta` | `BgImageMeta \| null` | `null` | Metadata for the uploaded image |

`BgImageMeta` type is unchanged (id, url, authorName, authorUrl, downloadUrl, cachedAt).

### IndexedDB

**Remove:** `"current"` key

**Add:**
- `"unsplash"` — blob for the unsplash image (manual pick or daily rotation)
- `"upload"` — blob for the uploaded image

Each source owns its own slot. Switching `bgSource` never deletes blobs from other sources.

### Persistence Rules

- Switching to color mode leaves both IndexedDB entries untouched.
- Re-enabling daily refresh checks `bgUnsplashMeta.cachedAt` — if same day, reuses existing image; if stale, fetches new.
- Changing the topic while daily is enabled immediately fetches a new image from that topic.
- Uploading a new image overwrites the `"upload"` slot. The preview always shows the most recent upload.

## Appearance Tab Layout

Top to bottom:

1. **Theme** selector row (unchanged)
2. **Accent Color** swatches (unchanged)
3. **Mode** selector (dark/light/auto) — moved up from the bottom, now above the background section
4. **Background** section label
5. Three accordions:

### Color Accordion

Active indicator when `bgSource === "color"`.

Contains the existing `bgColor` swatch group (auto/rose/coral/amber/teal/sky/violet/slate/stone/zinc/graphite). Clicking any swatch sets `bgSource: "color"`.

### Unsplash Accordion

Active indicator when `bgSource === "unsplash"`.

**Refresh daily row** (single flex line):
- Checkbox toggle (no label text on the checkbox itself)
- "Refresh daily" — `text-sm font-medium`
- "from" — `text-xs text-accent`
- Topic select dropdown (`width: 140px`)
- Right-aligned: "Refresh" button (ghost variant)

When `unsplashDaily` is false: the topic select and "Refresh" button are dimmed (`opacity: 0.4`, `pointer-events: none`). Enabling daily enables them and immediately fetches an image if none cached for today.

**Search area** below the daily row:
- Text input "Search photos..." + 3-column thumbnail grid (max-height 200px, scrollable).
- When `unsplashDaily` is true: search area gets `opacity: 0.4` and `pointer-events: none`.
- Clicking a search thumbnail sets `bgSource: "unsplash"`.

**No API key state**: Controls replaced with muted text pointing to Advanced tab. Same as current behavior.

Enabling the daily checkbox or clicking a search result sets `bgSource: "unsplash"`.

### Upload Accordion

Active indicator when `bgSource === "upload"`.

- "Choose image" button (outline variant with upload icon) + hidden file input.
- **Preview**: if `bgUploadMeta` exists, show a thumbnail of the uploaded image (~80px wide, landscape aspect ratio, rounded). Loaded from IndexedDB `"upload"` key on accordion render. Clicking the preview sets `bgSource: "upload"` (re-applies the cached upload without re-uploading).
- Note: "Local images do not sync across devices." (muted text)
- Uploading a file sets `bgSource: "upload"`.

### Active Source Indicator

Same pattern as current: accent-colored left border (`3px solid var(--accent)`) on the active accordion's trigger button.

## Background.ts Behavior Changes

### `applyBackground()`

Reads `bgSource`:
- `"color"` → do nothing (CSS handles it via `data-bg` attribute)
- `"unsplash"` → load blob from IndexedDB `"unsplash"` key → apply to `<html>` → render attribution. Then if `unsplashDaily` and `bgUnsplashMeta.cachedAt` is stale, async refresh.
- `"upload"` → load blob from IndexedDB `"upload"` key → apply to `<html>` → no attribution.

### `setUnsplashPhoto(photo)`

Same as before but writes to IndexedDB `"unsplash"` key and `bgUnsplashMeta`. Sets `bgSource: "unsplash"`.

### `setUploadedPhoto(file)`

Writes to IndexedDB `"upload"` key and `bgUploadMeta`. Sets `bgSource: "upload"`.

### `switchToColor()`

Replaces `clearBackground()`. Removes image style and attribution from `<html>`. Sets `bgSource: "color"`. Does NOT touch IndexedDB or metadata — both cached images are preserved.

### `reapplyUpload()`

Called when user clicks the upload preview. Loads from existing IndexedDB `"upload"` entry (no re-upload). Sets `bgSource: "upload"`. Applies image style. No attribution.

### `refreshDailyNow()`

Called when user clicks the "Refresh" button or changes the topic. Forces a new random photo fetch from the current `unsplashTopic` regardless of staleness. Writes to `"unsplash"` slot, updates `bgUnsplashMeta`, applies immediately.

### `subscribeBackground()`

Listens to `bgSource` changes:
- `"color"` → remove image style + attribution
- `"unsplash"` → load and apply from `"unsplash"` slot + render attribution
- `"upload"` → load and apply from `"upload"` slot, no attribution

### Daily Rotation on Boot

Unchanged logic but reads from `"unsplash"` key and `bgUnsplashMeta.cachedAt` instead of the old `"current"` / `bgImageMeta`.

## File Summary

| File | Change |
|------|--------|
| `src/defaults.ts` | Remove `bgType`, `bgImageSource`; add `bgSource`; remove `bgImageMeta`; add `bgUnsplashMeta`, `bgUploadMeta` |
| `src/background.ts` | Update all functions to use split storage; add `switchToColor`, `reapplyUpload`, `refreshDailyNow`; remove `clearBackground` |
| `src/settings.ts` | Rewrite `buildAppearanceTab()`: move Mode above Background, replace toggle+accordions with three accordions (Color, Unsplash, Upload); add upload preview; redesign daily refresh row; remove `buildBgTypeSelector()`; update imports |
| `src/index.ts` | No changes (boot sequence unchanged) |
| `src/unsplash.ts` | No changes |
| `src/idb.ts` | No changes |
