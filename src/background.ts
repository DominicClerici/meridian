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
