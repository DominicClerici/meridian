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
  { slug: "minimalism", label: "Minimal" },
  { slug: "experimental", label: "Abstract" },
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
