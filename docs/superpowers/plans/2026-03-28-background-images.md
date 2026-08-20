# Background Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom background images to the startpage via Unsplash API search/daily-rotation or local file upload.

**Architecture:** Three new modules (`idb.ts`, `unsplash.ts`, `background.ts`) plus store key additions and settings UI changes. Image blobs are cached in IndexedDB (outside the store) for fast boot without bloating localStorage. The existing color background acts as a placeholder during the async image load.

**Tech Stack:** TypeScript, Unsplash API v1, IndexedDB, existing store/component system.

**Spec:** `docs/superpowers/specs/2026-03-28-background-images-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/defaults.ts` | Modify | Add 5 sync keys + 1 local key + `BgImageMeta` type |
| `src/idb.ts` | Create | IndexedDB get/set/delete for blobs |
| `src/unsplash.ts` | Create | Unsplash API client (search, random, download tracking, topics list) |
| `src/background.ts` | Create | Orchestrator — apply image at boot, cache, rotate daily, attribution, subscribe |
| `src/icons/modern.ts` | Modify | Add `image` and `upload` icons for the settings UI |
| `src/settings.ts` | Modify | Background type toggle, Unsplash/Upload accordions, API key in Advanced tab |
| `src/index.ts` | Modify | Import and call `applyBackground()` + `subscribeBackground()` |

---

### Task 1: Add Store Keys

**Files:**
- Modify: `src/defaults.ts`

- [ ] **Step 1: Add BgImageMeta type and new sync/local keys**

Add the `BgImageMeta` type export and extend both settings interfaces with the new keys. Place the type before the `SyncSettings` type:

```ts
export type BgImageMeta = {
  id: string
  url: string
  authorName: string
  authorUrl: string
  downloadUrl: string
  cachedAt: number
}
```

Add to `SyncSettings`:

```ts
bgType: "color" | "image"
bgImageSource: "unsplash" | "upload"
unsplashDaily: boolean
unsplashTopic: string
unsplashApiKey: string
```

Add to `LocalSettings`:

```ts
bgImageMeta: BgImageMeta | null
```

- [ ] **Step 2: Add default values**

Add to `syncDefaults`:

```ts
bgType: "color",
bgImageSource: "unsplash",
unsplashDaily: false,
unsplashTopic: "wallpapers",
unsplashApiKey: "",
```

Add to `localDefaults`:

```ts
bgImageMeta: null,
```

- [ ] **Step 3: Build and verify**

Run: `./build.sh`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add store keys for background image settings"
```

---

### Task 2: Create IndexedDB Helper

**Files:**
- Create: `src/idb.ts`

- [ ] **Step 1: Write idb.ts**

```ts
const DB_NAME = "sp-images"
const STORE_NAME = "backgrounds"
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function idbGet(key: string): Promise<Blob | null> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const req = tx.objectStore(STORE_NAME).get(key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbSet(key: string, blob: Blob): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const req = tx.objectStore(STORE_NAME).put(blob, key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbDelete(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const req = tx.objectStore(STORE_NAME).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build. The module is self-contained — no imports from project code.

- [ ] **Step 3: Commit**

```bash
git add src/idb.ts
git commit -m "feat: add IndexedDB helper for background image blob caching"
```

---

### Task 3: Create Unsplash API Client

**Files:**
- Create: `src/unsplash.ts`

- [ ] **Step 1: Write unsplash.ts**

```ts
import { store } from "./store"

const API_BASE = "https://api.unsplash.com"

export type UnsplashPhoto = {
  id: string
  urls: { raw: string; small: string; thumb: string }
  author: string
  authorUrl: string
  downloadUrl: string
}

export const TOPICS: { slug: string; label: string }[] = [
  { slug: "wallpapers", label: "Wallpapers" },
  { slug: "nature", label: "Nature" },
  { slug: "architecture-interior", label: "Architecture" },
  { slug: "textures-patterns", label: "Textures" },
  { slug: "travel", label: "Travel" },
  { slug: "film", label: "Film" },
  { slug: "street-photography", label: "Street" },
]

function getApiKey(): string {
  const key = store.sync.get("unsplashApiKey")
  if (!key) throw new Error("Unsplash API key not set")
  return key
}

function headers(): HeadersInit {
  return { Authorization: `Client-ID ${getApiKey()}` }
}

function mapPhoto(raw: any): UnsplashPhoto {
  return {
    id: raw.id,
    urls: {
      raw: raw.urls.raw,
      small: raw.urls.small,
      thumb: raw.urls.thumb,
    },
    author: raw.user.name,
    authorUrl: raw.user.links.html,
    downloadUrl: raw.links.download_location,
  }
}

export async function searchPhotos(
  query: string,
  opts?: { page?: number }
): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({
    query,
    orientation: "landscape",
    per_page: "20",
  })
  if (opts?.page) params.set("page", String(opts.page))

  const res = await fetch(`${API_BASE}/search/photos?${params}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status}`)
  const data = await res.json()
  return (data.results as any[]).map(mapPhoto)
}

export async function getRandomPhoto(topic: string): Promise<UnsplashPhoto> {
  const params = new URLSearchParams({
    topics: topic,
    orientation: "landscape",
  })

  const res = await fetch(`${API_BASE}/photos/random?${params}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Unsplash random failed: ${res.status}`)
  const data = await res.json()
  return mapPhoto(data)
}

export function triggerDownload(downloadUrl: string): void {
  fetch(downloadUrl, { headers: headers() }).catch(() => {})
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/unsplash.ts
git commit -m "feat: add Unsplash API client for search, random, and download tracking"
```

---

### Task 4: Create Background Orchestrator

**Files:**
- Create: `src/background.ts`

- [ ] **Step 1: Write background.ts**

```ts
import { store } from "./store"
import type { BgImageMeta } from "./defaults"
import type { UnsplashPhoto } from "./unsplash"
import { getRandomPhoto, triggerDownload } from "./unsplash"
import { idbGet, idbSet, idbDelete } from "./idb"

const root = document.documentElement
let attributionEl: HTMLElement | null = null
let currentObjectUrl: string | null = null

function revokeCurrentUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
}

function applyImageStyle(objectUrl: string): void {
  root.style.backgroundImage = `url(${objectUrl})`
  root.style.backgroundSize = "cover"
  root.style.backgroundPosition = "center"
}

function removeImageStyle(): void {
  root.style.backgroundImage = ""
  root.style.backgroundSize = ""
  root.style.backgroundPosition = ""
}

function renderAttribution(meta: BgImageMeta): void {
  removeAttribution()
  if (meta.id === "upload") return

  const el = document.createElement("span")
  el.id = "bg-attribution"
  el.style.cssText = "position:fixed;bottom:8px;right:8px;font-size:11px;z-index:10;opacity:0.6"
  el.className = "text-page-foreground"

  el.innerHTML = `Photo by <a href="${meta.authorUrl}?utm_source=startpage&utm_medium=referral" target="_blank" rel="noopener" style="text-decoration:underline">${meta.authorName}</a> on <a href="https://unsplash.com/?utm_source=startpage&utm_medium=referral" target="_blank" rel="noopener" style="text-decoration:underline">Unsplash</a>`

  document.body.appendChild(el)
  attributionEl = el
}

function removeAttribution(): void {
  if (attributionEl) {
    attributionEl.remove()
    attributionEl = null
  }
}

function isStale(cachedAt: number): boolean {
  const cached = new Date(cachedAt).toDateString()
  const today = new Date().toDateString()
  return cached !== today
}

async function loadAndApply(): Promise<void> {
  const meta = store.local.get("bgImageMeta")
  if (!meta) return

  const blob = await idbGet("current")
  if (!blob) return

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(blob)
  applyImageStyle(currentObjectUrl)
  renderAttribution(meta)
}

async function refreshDaily(): Promise<void> {
  if (!store.sync.get("unsplashDaily")) return
  if (!store.sync.get("unsplashApiKey")) return

  const meta = store.local.get("bgImageMeta")
  if (meta && !isStale(meta.cachedAt)) return

  try {
    const topic = store.sync.get("unsplashTopic")
    const photo = await getRandomPhoto(topic)
    await setUnsplashPhoto(photo)
  } catch {
    // Network error or API issue — keep existing image
  }
}

export function applyBackground(): void {
  if (store.sync.get("bgType") !== "image") return

  const meta = store.local.get("bgImageMeta")
  if (!meta) return

  loadAndApply()

  if (store.sync.get("unsplashDaily") && isStale(meta.cachedAt)) {
    refreshDaily()
  }
}

export async function setUnsplashPhoto(photo: UnsplashPhoto): Promise<void> {
  const w = window.screen.width
  const h = window.screen.height
  const imgUrl = `${photo.urls.raw}&w=${w}&h=${h}&fit=crop&auto=format&q=80`

  const res = await fetch(imgUrl)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const blob = await res.blob()

  await idbSet("current", blob)

  const meta: BgImageMeta = {
    id: photo.id,
    url: photo.urls.raw,
    authorName: photo.author,
    authorUrl: photo.authorUrl,
    downloadUrl: photo.downloadUrl,
    cachedAt: Date.now(),
  }
  store.local.set("bgImageMeta", meta)
  store.sync.set("bgImageSource", "unsplash")

  triggerDownload(photo.downloadUrl)

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(blob)
  applyImageStyle(currentObjectUrl)
  renderAttribution(meta)
}

export async function setUploadedPhoto(file: File): Promise<void> {
  await idbSet("current", file)

  const meta: BgImageMeta = {
    id: "upload",
    url: "",
    authorName: "",
    authorUrl: "",
    downloadUrl: "",
    cachedAt: Date.now(),
  }
  store.local.set("bgImageMeta", meta)
  store.sync.set("bgImageSource", "upload")

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(file)
  applyImageStyle(currentObjectUrl)
  removeAttribution()
}

export function clearBackground(): void {
  revokeCurrentUrl()
  removeImageStyle()
  removeAttribution()
  idbDelete("current").catch(() => {})
  store.local.set("bgImageMeta", null)
}

export function subscribeBackground(): void {
  store.sync.subscribe("bgType", (val) => {
    if (val === "color") {
      revokeCurrentUrl()
      removeImageStyle()
      removeAttribution()
    } else {
      loadAndApply()
    }
  })
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat: add background orchestrator with caching, daily rotation, and attribution"
```

---

### Task 5: Wire Into Boot Sequence

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports and boot calls**

Add the import at the top of `src/index.ts` alongside the other imports:

```ts
import { applyBackground, subscribeBackground } from "./background"
```

Add the two calls right after the existing `subscribeTheme()` call (line 18), before the DOMContentLoaded listener:

```ts
applyBackground()
subscribeBackground()
```

The boot sequence should now read:

```ts
applyTheme()
subscribeTheme()
applyBackground()
subscribeBackground()
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build. Loading the extension with default settings (`bgType: "color"`) should behave identically to before — `applyBackground()` exits early when bgType is color.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire background module into boot sequence"
```

---

### Task 6: Add Icons for Settings UI

**Files:**
- Modify: `src/icons/modern.ts`

- [ ] **Step 1: Add `bgImage` and `bgUpload` icons**

Add these two entries to the `icons` object in `src/icons/modern.ts`. Place them after the `randomAccent` entry. These are Lucide icons (consistent with the existing set):

```ts
bgImage: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,

bgUpload: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/icons/modern.ts
git commit -m "feat: add image and upload icons for background settings"
```

---

### Task 7: Build Advanced Tab — API Key Setting

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Replace the empty Advanced panel builder**

Replace the `buildAdvancedPanel()` function (which currently shows "No advanced settings yet") with one that has the Unsplash API key input. Import `createInput` at the top if not already imported (check the existing import from `./components` — it already imports `createInput`).

Replace the entire `buildAdvancedPanel()` function:

```ts
function buildAdvancedPanel(): HTMLDivElement {
  const panel = document.createElement("div")
  panel.dataset.settingsTab = "advanced"
  panel.className = "settings-panel pb-6 px-6"
  panel.hidden = true

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const keyInput = createInput({ type: "password", placeholder: "Paste your API key" })
  keyInput.value = store.sync.get("unsplashApiKey")
  keyInput.style.width = "220px"
  keyInput.addEventListener("change", () => {
    store.sync.set("unsplashApiKey", (keyInput as HTMLInputElement).value.trim())
  })
  store.sync.subscribe("unsplashApiKey", (v) => { (keyInput as HTMLInputElement).value = v })

  const keyRow = document.createElement("div")
  keyRow.className = "flex items-center justify-between py-3 border-b border-input-border/10"

  const keyLabel = document.createElement("span")
  keyLabel.className = "text-sm text-foreground"
  keyLabel.textContent = "Unsplash API key"

  keyRow.appendChild(keyLabel)
  keyRow.appendChild(keyInput)
  wrapper.appendChild(keyRow)

  const helpText = document.createElement("p")
  helpText.className = "text-xs text-muted mt-2"
  helpText.innerHTML = `Get a free key at <a href="https://unsplash.com/developers" target="_blank" rel="noopener" class="underline text-accent">unsplash.com/developers</a>`
  wrapper.appendChild(helpText)

  panel.appendChild(wrapper)
  return panel
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Clean build. Opening settings → Advanced tab should show the API key input instead of the empty state.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add Unsplash API key input to Advanced settings tab"
```

---

### Task 8: Build Appearance Tab — Background Type Toggle & Image Accordions

**Files:**
- Modify: `src/settings.ts`

This is the largest task. It modifies `buildAppearanceTab()` to add the Color/Image toggle and the two image source accordions.

- [ ] **Step 1: Add imports**

At the top of `src/settings.ts`, add the imports needed. The `icon` import already exists. Add the new module imports:

```ts
import { searchPhotos, TOPICS } from "./unsplash"
import { setUnsplashPhoto, setUploadedPhoto, clearBackground } from "./background"
import type { UnsplashPhoto } from "./unsplash"
```

- [ ] **Step 2: Build the background type toggle helper**

Add this new function before `buildAppearanceTab()`:

```ts
function buildBgTypeSelector(): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-2"

  const types: ["color", "image"] = ["color", "image"]
  const buttons: HTMLButtonElement[] = []

  for (const type of types) {
    const btn = createButton(type.charAt(0).toUpperCase() + type.slice(1), "override", {
      icon: type === "image" ? icon("bgImage") : undefined,
    })
    btn.className += " flex-1 justify-center py-2 border rounded-theme transition-colors"

    btn.addEventListener("click", () => {
      store.sync.set("bgType", type)
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (let i = 0; i < types.length; i++) {
      const isSelected = types[i] === val
      buttons[i].style.background = isSelected ? "var(--accent)" : "transparent"
      buttons[i].style.color = isSelected ? "var(--accent-foreground)" : "var(--accent)"
      buttons[i].style.borderColor = "var(--accent)"
    }
  }

  updateSelected(store.sync.get("bgType"))
  store.sync.subscribe("bgType", updateSelected)

  return container
}
```

- [ ] **Step 3: Build the Unsplash accordion content helper**

Add this function after `buildBgTypeSelector()`:

```ts
function buildUnsplashAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Unsplash", { variant: "settings", defaultOpen: true })

  const hasKey = (): boolean => store.sync.get("unsplashApiKey") !== ""

  const noKeyMsg = document.createElement("p")
  noKeyMsg.className = "text-xs text-muted"
  noKeyMsg.innerHTML = `Add your Unsplash API key in the <strong>Advanced</strong> tab to enable.`

  const controls = document.createElement("div")
  controls.className = "flex flex-col gap-3"

  // --- Daily row ---
  const dailyRow = document.createElement("div")
  dailyRow.className = "flex items-center justify-between"

  const dailyCheck = createCheckbox("Refresh daily", store.sync.get("unsplashDaily"), (v) => {
    store.sync.set("unsplashDaily", v)
    updateSearchDisabled()
  })
  dailyRow.appendChild(dailyCheck)

  const topicSelect = createSelect({
    options: TOPICS.map((t) => ({ value: t.slug, label: t.label })),
    value: store.sync.get("unsplashTopic"),
    onChange: (v) => store.sync.set("unsplashTopic", v),
    width: "140px",
  })
  dailyRow.appendChild(topicSelect)

  controls.appendChild(dailyRow)

  // --- Search area ---
  const searchArea = document.createElement("div")
  searchArea.className = "flex flex-col gap-2 transition-opacity"

  const searchInput = createInput({ placeholder: "Search photos..." })
  searchArea.appendChild(searchInput)

  const grid = document.createElement("div")
  grid.className = "grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto rounded-theme"
  searchArea.appendChild(grid)

  let searchTimeout: number | null = null

  searchInput.addEventListener("input", () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = window.setTimeout(async () => {
      const query = (searchInput as HTMLInputElement).value.trim()
      if (!query) { grid.innerHTML = ""; return }
      try {
        const photos = await searchPhotos(query)
        renderGrid(photos)
      } catch {
        grid.innerHTML = `<p class="text-xs text-danger col-span-3">Search failed. Check your API key.</p>`
      }
    }, 500)
  })

  function renderGrid(photos: UnsplashPhoto[]): void {
    grid.innerHTML = ""
    for (const photo of photos) {
      const thumb = document.createElement("button")
      thumb.className = "aspect-[16/10] rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all"
      thumb.style.background = `url(${photo.urls.small}) center/cover`

      thumb.addEventListener("click", async () => {
        thumb.style.opacity = "0.5"
        thumb.style.pointerEvents = "none"
        try {
          await setUnsplashPhoto(photo)
          store.sync.set("bgType", "image")
          store.sync.set("bgImageSource", "unsplash")
        } catch {
          // restore on failure
        }
        thumb.style.opacity = ""
        thumb.style.pointerEvents = ""
      })

      grid.appendChild(thumb)
    }
  }

  controls.appendChild(searchArea)

  function updateSearchDisabled(): void {
    const daily = store.sync.get("unsplashDaily")
    searchArea.style.opacity = daily ? "0.4" : ""
    searchArea.style.pointerEvents = daily ? "none" : ""
    topicSelect.style.opacity = daily ? "" : "0.4"
    topicSelect.style.pointerEvents = daily ? "" : "none"
  }
  updateSearchDisabled()

  // --- Visibility ---
  function updateVisibility(): void {
    const key = hasKey()
    noKeyMsg.hidden = key
    controls.hidden = !key
  }
  updateVisibility()
  store.sync.subscribe("unsplashApiKey", () => updateVisibility())
  store.sync.subscribe("unsplashDaily", (v) => {
    (dailyCheck as any).setChecked(v)
    updateSearchDisabled()
  })
  store.sync.subscribe("unsplashTopic", (v) => { topicSelect.value = v })

  acc.content.appendChild(noKeyMsg)
  acc.content.appendChild(controls)

  return acc
}
```

- [ ] **Step 4: Build the Upload accordion content helper**

Add this function after the Unsplash one:

```ts
function buildUploadAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Upload", { variant: "settings", defaultOpen: false })

  const fileBtn = createButton("Choose image", "outline", {
    icon: icon("bgUpload"),
  })

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = "image/*"
  fileInput.hidden = true

  fileBtn.addEventListener("click", () => fileInput.click())

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    fileBtn.querySelector("span:last-child")!.textContent = "Uploading..."
    fileBtn.disabled = true
    try {
      await setUploadedPhoto(file)
      store.sync.set("bgType", "image")
      store.sync.set("bgImageSource", "upload")
    } catch {
      // silently fail
    }
    fileBtn.disabled = false
    fileBtn.querySelector("span:last-child")!.textContent = "Choose image"
    fileInput.value = ""
  })

  acc.content.appendChild(fileBtn)
  acc.content.appendChild(fileInput)

  const note = document.createElement("p")
  note.className = "text-xs text-muted mt-1"
  note.textContent = "Local images do not sync across devices."
  acc.content.appendChild(note)

  return acc
}
```

- [ ] **Step 5: Rewrite buildAppearanceTab()**

Replace the entire `buildAppearanceTab()` function. The new version adds the bg type toggle and conditionally shows swatches or image accordions:

```ts
function buildAppearanceTab(): void {
  const panel = document.querySelector('[data-settings-tab="appearance"]')!
  panel.className = "settings-panel px-6 pb-6 flex flex-col gap-6"

  function section(labelText: string, child: HTMLElement): HTMLElement {
    const el = document.createElement("div")
    el.className = "flex flex-col gap-3"
    const lbl = document.createElement("span")
    lbl.className = "text-muted text-xs font-medium"
    lbl.textContent = labelText
    el.appendChild(lbl)
    el.appendChild(child)
    return el
  }

  const themeSelect = createSelect({
    options: [{ value: "modern", label: "Modern" }],
    value: store.sync.get("theme"),
    onChange: (v) => store.sync.set("theme", v as SyncSettings["theme"]),
  })
  store.sync.subscribe("theme", (v) => { themeSelect.value = v })

  const themeRow = document.createElement("div")
  themeRow.className = "flex items-center justify-between"
  const themeLbl = document.createElement("span")
  themeLbl.className = "text-sm text-foreground"
  themeLbl.textContent = "Theme"
  themeRow.appendChild(themeLbl)
  themeRow.appendChild(themeSelect)
  panel.appendChild(themeRow)

  panel.appendChild(section("Accent Color", buildSwatchGroup("accentColor")))

  // --- Background section ---
  const bgWrapper = document.createElement("div")
  bgWrapper.className = "flex flex-col gap-3"

  const bgLabel = document.createElement("span")
  bgLabel.className = "text-muted text-xs font-medium"
  bgLabel.textContent = "Background"
  bgWrapper.appendChild(bgLabel)

  bgWrapper.appendChild(buildBgTypeSelector())

  // Color swatches (shown when bgType is "color")
  const colorSection = document.createElement("div")
  colorSection.appendChild(buildSwatchGroup("bgColor"))

  // Image controls (shown when bgType is "image")
  const imageSection = document.createElement("div")
  imageSection.className = "flex flex-col gap-0"

  const unsplashAcc = buildUnsplashAccordion()
  const uploadAcc = buildUploadAccordion()

  function updateActiveIndicator(): void {
    const source = store.sync.get("bgImageSource")
    const unsplashTrigger = unsplashAcc.container.querySelector("button") as HTMLElement
    const uploadTrigger = uploadAcc.container.querySelector("button") as HTMLElement
    if (unsplashTrigger) {
      unsplashTrigger.style.borderLeft = source === "unsplash" ? "3px solid var(--accent)" : ""
      unsplashTrigger.style.paddingLeft = source === "unsplash" ? "21px" : ""
    }
    if (uploadTrigger) {
      uploadTrigger.style.borderLeft = source === "upload" ? "3px solid var(--accent)" : ""
      uploadTrigger.style.paddingLeft = source === "upload" ? "21px" : ""
    }
  }

  imageSection.appendChild(unsplashAcc.container)
  imageSection.appendChild(uploadAcc.container)
  updateActiveIndicator()
  store.sync.subscribe("bgImageSource", () => updateActiveIndicator())

  bgWrapper.appendChild(colorSection)
  bgWrapper.appendChild(imageSection)

  function updateBgType(val: string): void {
    colorSection.hidden = val !== "color"
    imageSection.hidden = val !== "image"
  }
  updateBgType(store.sync.get("bgType"))
  store.sync.subscribe("bgType", updateBgType)

  panel.appendChild(bgWrapper)
  panel.appendChild(section("Mode", buildModeSelector()))
}
```

- [ ] **Step 6: Build and verify**

Run: `./build.sh`
Expected: Clean build. The appearance tab should now show the Color/Image toggle. Clicking "Color" shows swatches; clicking "Image" shows the Unsplash and Upload accordions.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add background type toggle and image source accordions to appearance tab"
```

---

### Task 9: Manual Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Build the extension**

Run: `./build.sh`

- [ ] **Step 2: Load in browser and test Color mode**

Load the extension in Chrome/Firefox. Verify:
- Default state: "Color" is selected, swatches visible, page has normal color background
- Switching accent/bg colors still works as before

- [ ] **Step 3: Test API key flow**

- Go to Advanced tab, paste an Unsplash API key
- Go to Appearance tab, click "Image"
- Verify: Color swatches disappear, Unsplash and Upload accordions appear
- Verify: Unsplash accordion shows search controls (not the "add API key" message)

- [ ] **Step 4: Test Unsplash search**

- Type a query in the search input (e.g. "mountains")
- Verify: Thumbnail grid populates after ~500ms
- Click a thumbnail
- Verify: Background image appears on the page, attribution shows in bottom-right

- [ ] **Step 5: Test daily rotation toggle**

- Check "Refresh daily"
- Verify: Search area dims, topic select becomes active
- Uncheck "Refresh daily"
- Verify: Search area un-dims, topic select dims

- [ ] **Step 6: Test upload**

- Open Upload accordion, click "Choose image", select a local image
- Verify: Background changes to the uploaded image, no attribution shown
- Verify: Upload accordion now has the active indicator

- [ ] **Step 7: Test switching back to Color mode**

- Click "Color" in the background type toggle
- Verify: Image background disappears, color background returns, attribution removed

- [ ] **Step 8: Test page reload**

- With an image background set, reload the page
- Verify: Image loads from IndexedDB cache without visible delay (color bg shows briefly, then image overlays)

- [ ] **Step 9: Commit any fixes**

If any issues found during testing, fix and commit:

```bash
git add -A
git commit -m "fix: address issues found during background images integration testing"
```
