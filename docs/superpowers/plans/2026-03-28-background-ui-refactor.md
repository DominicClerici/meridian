# Background UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the appearance tab from a Color/Image toggle to three always-visible accordions with independent image persistence per source.

**Architecture:** Collapse `bgType`+`bgImageSource` into a single `bgSource` key. Split the single IndexedDB `"current"` slot into `"unsplash"` and `"upload"` slots so images persist independently when switching modes. Rewrite the appearance tab to show Color, Unsplash, and Upload as three accordions with Mode moved above them.

**Tech Stack:** TypeScript, existing store/component system, IndexedDB, Unsplash API.

**Spec:** `docs/superpowers/specs/2026-03-28-background-ui-refactor-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/defaults.ts` | Modify | Remove `bgType`, `bgImageSource`, `bgImageMeta`; add `bgSource`, `bgUnsplashMeta`, `bgUploadMeta` |
| `src/background.ts` | Rewrite | Split storage, new exports: `switchToColor`, `reapplyUpload`, `refreshDailyNow` |
| `src/settings.ts` | Modify | Remove `buildBgTypeSelector`; rewrite Unsplash/Upload/Appearance builders; add Color accordion |

---

### Task 1: Update Store Keys

**Files:**
- Modify: `src/defaults.ts`

- [ ] **Step 1: Replace store keys**

In `src/defaults.ts`, make these changes to `SyncSettings`:

Remove these two lines:
```ts
bgType: "color" | "image";
bgImageSource: "unsplash" | "upload";
```

Add in their place:
```ts
bgSource: "color" | "unsplash" | "upload";
```

In `LocalSettings`, remove:
```ts
bgImageMeta: BgImageMeta | null
```

Add in its place:
```ts
bgUnsplashMeta: BgImageMeta | null
bgUploadMeta: BgImageMeta | null
```

In `syncDefaults`, remove:
```ts
bgType: "color",
bgImageSource: "unsplash",
```

Add in their place:
```ts
bgSource: "color",
```

In `localDefaults`, remove:
```ts
bgImageMeta: null,
```

Add in its place:
```ts
bgUnsplashMeta: null,
bgUploadMeta: null,
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Build will fail because `background.ts` and `settings.ts` still reference the old keys. That's expected — we'll fix those in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/defaults.ts
git commit -m "refactor: collapse bgType/bgImageSource into bgSource, split bgImageMeta"
```

---

### Task 2: Rewrite Background Orchestrator

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Replace the entire file**

Replace all of `src/background.ts` with:

```ts
import { store } from "./store"
import type { BgImageMeta } from "./defaults"
import type { UnsplashPhoto } from "./unsplash"
import { getRandomPhoto, triggerDownload } from "./unsplash"
import { idbGet, idbSet } from "./idb"

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

  el.append("Photo by ")
  const authorLink = document.createElement("a")
  authorLink.href = `${meta.authorUrl}?utm_source=startpage&utm_medium=referral`
  authorLink.target = "_blank"
  authorLink.rel = "noopener"
  authorLink.style.textDecoration = "underline"
  authorLink.textContent = meta.authorName
  el.appendChild(authorLink)
  el.append(" on ")
  const unsplashLink = document.createElement("a")
  unsplashLink.href = "https://unsplash.com/?utm_source=startpage&utm_medium=referral"
  unsplashLink.target = "_blank"
  unsplashLink.rel = "noopener"
  unsplashLink.style.textDecoration = "underline"
  unsplashLink.textContent = "Unsplash"
  el.appendChild(unsplashLink)

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
  return new Date(cachedAt).toDateString() !== new Date().toDateString()
}

async function loadFromSlot(slot: "unsplash" | "upload"): Promise<void> {
  const metaKey = slot === "unsplash" ? "bgUnsplashMeta" : "bgUploadMeta"
  const meta = store.local.get(metaKey)
  if (!meta) return

  const blob = await idbGet(slot)
  if (!blob) return

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(blob)
  applyImageStyle(currentObjectUrl)
  if (slot === "unsplash") renderAttribution(meta)
  else removeAttribution()
}

async function refreshDaily(): Promise<void> {
  if (!store.sync.get("unsplashDaily")) return
  if (!store.sync.get("unsplashApiKey")) return

  const meta = store.local.get("bgUnsplashMeta")
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
  const source = store.sync.get("bgSource")
  if (source === "color") return

  if (source === "unsplash") {
    const meta = store.local.get("bgUnsplashMeta")
    if (!meta) return
    loadFromSlot("unsplash").then(() => {
      if (store.sync.get("unsplashDaily") && isStale(meta.cachedAt)) {
        refreshDaily()
      }
    })
  } else if (source === "upload") {
    loadFromSlot("upload")
  }
}

export async function setUnsplashPhoto(photo: UnsplashPhoto): Promise<void> {
  const w = window.screen.width
  const h = window.screen.height
  const sep = photo.urls.raw.includes("?") ? "&" : "?"
  const imgUrl = `${photo.urls.raw}${sep}w=${w}&h=${h}&fit=crop&auto=format&q=80`

  const res = await fetch(imgUrl)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const blob = await res.blob()

  await idbSet("unsplash", blob)

  const meta: BgImageMeta = {
    id: photo.id,
    url: photo.urls.raw,
    authorName: photo.author,
    authorUrl: photo.authorUrl,
    downloadUrl: photo.downloadUrl,
    cachedAt: Date.now(),
  }
  store.local.set("bgUnsplashMeta", meta)
  store.sync.set("bgSource", "unsplash")

  triggerDownload(photo.downloadUrl)

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(blob)
  applyImageStyle(currentObjectUrl)
  renderAttribution(meta)
}

export async function setUploadedPhoto(file: File): Promise<void> {
  await idbSet("upload", file)

  const meta: BgImageMeta = {
    id: "upload",
    url: "",
    authorName: "",
    authorUrl: "",
    downloadUrl: "",
    cachedAt: Date.now(),
  }
  store.local.set("bgUploadMeta", meta)
  store.sync.set("bgSource", "upload")

  revokeCurrentUrl()
  currentObjectUrl = URL.createObjectURL(file)
  applyImageStyle(currentObjectUrl)
  removeAttribution()
}

export function switchToColor(): void {
  revokeCurrentUrl()
  removeImageStyle()
  removeAttribution()
  store.sync.set("bgSource", "color")
}

export async function reapplyUpload(): Promise<void> {
  store.sync.set("bgSource", "upload")
  await loadFromSlot("upload")
}

export async function refreshDailyNow(): Promise<void> {
  if (!store.sync.get("unsplashApiKey")) return
  const topic = store.sync.get("unsplashTopic")
  const photo = await getRandomPhoto(topic)
  await setUnsplashPhoto(photo)
}

export function subscribeBackground(): void {
  store.sync.subscribe("bgSource", (val) => {
    if (val === "color") {
      revokeCurrentUrl()
      removeImageStyle()
      removeAttribution()
    } else if (val === "unsplash") {
      loadFromSlot("unsplash")
    } else if (val === "upload") {
      loadFromSlot("upload")
    }
  })
}
```

- [ ] **Step 2: Build and verify**

Run: `./build.sh`
Expected: Build may still fail due to `settings.ts` references to old keys. That's fine.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "refactor: split background storage into unsplash/upload slots, add switchToColor/reapplyUpload/refreshDailyNow"
```

---

### Task 3: Rewrite Appearance Tab & Accordion Builders

**Files:**
- Modify: `src/settings.ts`

This is the largest task. It replaces the Color/Image toggle with three always-visible accordions, moves Mode above Background, redesigns the daily refresh row, and adds upload preview.

- [ ] **Step 1: Update imports**

At the top of `src/settings.ts`, replace:
```ts
import { setUnsplashPhoto, setUploadedPhoto } from "./background"
```

With:
```ts
import { setUnsplashPhoto, setUploadedPhoto, switchToColor, reapplyUpload, refreshDailyNow } from "./background"
import { idbGet } from "./idb"
```

- [ ] **Step 2: Delete `buildBgTypeSelector()`**

Remove the entire `buildBgTypeSelector()` function (lines 264-298 in the current file). It is no longer needed — there is no Color/Image toggle.

- [ ] **Step 3: Add `buildColorAccordion()`**

Add this new function where `buildBgTypeSelector` used to be:

```ts
function buildColorAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Color", { variant: "settings", defaultOpen: true })
  const swatches = buildSwatchGroup("bgColor")

  const originalClickHandlers: Map<HTMLButtonElement, () => void> = new Map()
  for (const btn of swatches.querySelectorAll("button") as NodeListOf<HTMLButtonElement>) {
    const handler = () => {
      if (store.sync.get("bgSource") !== "color") {
        switchToColor()
      }
    }
    btn.addEventListener("click", handler)
  }

  acc.content.appendChild(swatches)
  return acc
}
```

- [ ] **Step 4: Rewrite `buildUnsplashAccordion()`**

Replace the entire `buildUnsplashAccordion()` function with the redesigned version. Key changes: new daily row layout ("Refresh daily" medium text, "from" accent text, topic select, right-aligned Refresh button), daily checkbox enables topic+refresh button, search dimmed when daily on, clicking search results sets `bgSource` to `"unsplash"`, enabling daily triggers fetch if needed.

```ts
function buildUnsplashAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Unsplash", { variant: "settings", defaultOpen: false })

  const hasKey = (): boolean => store.sync.get("unsplashApiKey") !== ""

  const noKeyMsg = document.createElement("p")
  noKeyMsg.className = "text-xs text-muted"
  noKeyMsg.innerHTML = `Add your Unsplash API key in the <strong>Advanced</strong> tab to enable.`

  const controls = document.createElement("div")
  controls.className = "flex flex-col gap-3"

  const dailyRow = document.createElement("div")
  dailyRow.className = "flex items-center gap-2"

  const dailyCheck = createCheckbox("", store.sync.get("unsplashDaily"), (v) => {
    store.sync.set("unsplashDaily", v)
    updateDailyState()
    if (v) {
      const meta = store.local.get("bgUnsplashMeta")
      if (!meta || isStale(meta.cachedAt)) {
        refreshDailyNow().catch(() => {})
      } else {
        store.sync.set("bgSource", "unsplash")
      }
    }
  })
  dailyRow.appendChild(dailyCheck)

  const dailyLabel = document.createElement("span")
  dailyLabel.className = "text-sm font-medium text-foreground"
  dailyLabel.textContent = "Refresh daily"
  dailyRow.appendChild(dailyLabel)

  const fromLabel = document.createElement("span")
  fromLabel.className = "text-xs text-accent"
  fromLabel.textContent = "from"
  dailyRow.appendChild(fromLabel)

  const topicSelect = createSelect({
    options: TOPICS.map((t) => ({ value: t.slug, label: t.label })),
    value: store.sync.get("unsplashTopic"),
    onChange: (v) => {
      store.sync.set("unsplashTopic", v)
      if (store.sync.get("unsplashDaily")) {
        refreshDailyNow().catch(() => {})
      }
    },
    width: "120px",
  })
  dailyRow.appendChild(topicSelect)

  const spacer = document.createElement("div")
  spacer.className = "flex-1"
  dailyRow.appendChild(spacer)

  const refreshBtn = createButton("Refresh", "ghost", {
    onClick: () => { refreshDailyNow().catch(() => {}) },
  })
  dailyRow.appendChild(refreshBtn)

  controls.appendChild(dailyRow)

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

  function isStale(cachedAt: number): boolean {
    return new Date(cachedAt).toDateString() !== new Date().toDateString()
  }

  function updateDailyState(): void {
    const daily = store.sync.get("unsplashDaily")
    searchArea.style.opacity = daily ? "0.4" : ""
    searchArea.style.pointerEvents = daily ? "none" : ""
    topicSelect.style.opacity = daily ? "" : "0.4"
    topicSelect.style.pointerEvents = daily ? "" : "none"
    refreshBtn.style.opacity = daily ? "" : "0.4"
    refreshBtn.style.pointerEvents = daily ? "" : "none"
  }
  updateDailyState()

  function updateVisibility(): void {
    const key = hasKey()
    noKeyMsg.hidden = key
    controls.hidden = !key
  }
  updateVisibility()
  store.sync.subscribe("unsplashApiKey", () => updateVisibility())
  store.sync.subscribe("unsplashDaily", (v) => {
    (dailyCheck as any).setChecked(v)
    updateDailyState()
  })
  store.sync.subscribe("unsplashTopic", (v) => { topicSelect.value = v })

  acc.content.appendChild(noKeyMsg)
  acc.content.appendChild(controls)

  return acc
}
```

- [ ] **Step 5: Rewrite `buildUploadAccordion()`**

Replace the entire `buildUploadAccordion()` function with the version that includes a persistent preview thumbnail:

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
      loadPreview()
    } catch {
      // silently fail
    }
    fileBtn.disabled = false
    fileBtn.querySelector("span:last-child")!.textContent = "Choose image"
    fileInput.value = ""
  })

  acc.content.appendChild(fileBtn)
  acc.content.appendChild(fileInput)

  const preview = document.createElement("button")
  preview.className = "w-20 aspect-[16/10] rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all mt-2"
  preview.hidden = true
  preview.addEventListener("click", () => { reapplyUpload() })
  acc.content.appendChild(preview)

  function loadPreview(): void {
    const meta = store.local.get("bgUploadMeta")
    if (!meta) { preview.hidden = true; return }
    idbGet("upload").then((blob) => {
      if (!blob) { preview.hidden = true; return }
      const url = URL.createObjectURL(blob)
      preview.style.background = `url(${url}) center/cover`
      preview.hidden = false
    })
  }
  loadPreview()

  const note = document.createElement("p")
  note.className = "text-xs text-muted mt-1"
  note.textContent = "Local images do not sync across devices."
  acc.content.appendChild(note)

  return acc
}
```

- [ ] **Step 6: Rewrite `buildAppearanceTab()`**

Replace the entire `buildAppearanceTab()` function. The new layout: Theme, Accent Color, Mode (moved up), then Background section with three accordions (Color, Unsplash, Upload). Active indicator based on `bgSource`.

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
  panel.appendChild(section("Mode", buildModeSelector()))

  const bgWrapper = document.createElement("div")
  bgWrapper.className = "flex flex-col gap-0"

  const bgLabel = document.createElement("span")
  bgLabel.className = "text-muted text-xs font-medium mb-3"
  bgLabel.textContent = "Background"
  bgWrapper.appendChild(bgLabel)

  const colorAcc = buildColorAccordion()
  const unsplashAcc = buildUnsplashAccordion()
  const uploadAcc = buildUploadAccordion()

  bgWrapper.appendChild(colorAcc.container)
  bgWrapper.appendChild(unsplashAcc.container)
  bgWrapper.appendChild(uploadAcc.container)

  function updateActiveIndicator(): void {
    const source = store.sync.get("bgSource")
    const accMap: [string, { container: HTMLElement }][] = [
      ["color", colorAcc],
      ["unsplash", unsplashAcc],
      ["upload", uploadAcc],
    ]
    for (const [key, acc] of accMap) {
      const trigger = acc.container.querySelector("button") as HTMLElement
      if (!trigger) continue
      trigger.style.borderLeft = source === key ? "3px solid var(--accent)" : ""
      trigger.style.paddingLeft = source === key ? "21px" : ""
    }
  }

  updateActiveIndicator()
  store.sync.subscribe("bgSource", () => updateActiveIndicator())

  panel.appendChild(bgWrapper)
}
```

- [ ] **Step 7: Build and verify**

Run: `./build.sh`
Expected: Clean build with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/settings.ts
git commit -m "refactor: replace bg type toggle with three accordions, redesign daily row, add upload preview"
```

---

### Task 4: Build and Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Build**

Run: `./build.sh`
Expected: Clean build.

- [ ] **Step 2: Test Color accordion**

Load extension. Verify:
- Three accordions visible: Color, Unsplash, Upload
- Mode selector is above the Background section
- Color accordion has bgColor swatches
- Clicking a swatch sets bgSource to "color" and Color accordion gets active indicator

- [ ] **Step 3: Test Unsplash accordion**

- Enter API key in Advanced tab
- In Unsplash accordion, search for "mountains"
- Click a thumbnail — background changes, Unsplash accordion gets active indicator, attribution visible
- Switch back to Color (click a swatch) — attribution disappears, color bg returns
- Switch back to Unsplash (search + click another thumbnail) — old image was preserved, new one replaces it

- [ ] **Step 4: Test daily refresh controls**

- Enable "Refresh daily" checkbox — topic select and Refresh button become active, search dims
- Verify image fetches immediately if none cached
- Click "Refresh" button — new image loads
- Change topic — new image loads from new topic
- Disable "Refresh daily" — search re-enables, topic/refresh button dim

- [ ] **Step 5: Test Upload accordion**

- Upload an image — background changes, Upload accordion gets active indicator
- Switch to Color — uploaded image disappears from background but preview thumbnail remains in Upload accordion
- Click the preview thumbnail — uploaded image re-applies as background
- Upload a different image — preview updates

- [ ] **Step 6: Test persistence**

- Set an unsplash daily image
- Switch to Upload, upload an image
- Switch to Color
- Reload the page — color background loads (correct, bgSource is "color")
- Switch to Unsplash via search — the daily image slot should still have the old image if less than 24h old
- Enable daily — reuses the cached image

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during background UI refactor testing"
```
