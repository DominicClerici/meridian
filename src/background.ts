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
  store.sync.set("unsplashDaily", false)
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
  store.sync.set("unsplashDaily", false)
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
