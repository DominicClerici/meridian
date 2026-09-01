import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { searchTracks, spotifySnapshot } from "../../spotify"
import type { SpotifySearchResult } from "../../spotify"
import type { Candidate, QueryContext, SearchSource } from "../types"

function albumArt(url: string | null): HTMLElement {
  if (!url) return icon("musicNote", { size: 16 })
  const img = document.createElement("img")
  img.src = url
  img.width = 16
  img.height = 16
  img.className = "shrink-0 rounded-[3px] w-4 h-4 object-cover"
  img.addEventListener("error", () => img.replaceWith(icon("musicNote", { size: 16 })), {
    once: true,
  })
  return img
}

function candidate(track: SpotifySearchResult): Candidate {
  return {
    id: `spotify:${track.id}`,
    title: track.name,
    subtitle: track.artists,
    haystack: [track.artists],
    prematched: true,
    icon: () => albumArt(track.albumArt),
    copyValue: track.url,
    run: (mode) => navigate(track.url, "search", mode === "newTab" ? "newTab" : "default"),
  }
}

export const spotifySource: SearchSource = {
  id: "spotify",
  label: "Spotify",
  token: "sp",
  glyph: "spotify",
  weight: 1,
  limit: 3,
  scopedLimit: 15,
  // Track search is a network call per keystroke; blending it into every query
  // would spend a request on searches that were never about music.
  scopedOnly: true,
  debounce: 220,
  available: () => store.sync.get("spotifyEnabled") && spotifySnapshot().connected,
  unavailable: () => ({
    message: store.sync.get("spotifyEnabled")
      ? "Spotify isn't connected."
      : "The Spotify widget is turned off.",
  }),
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (!query) return []
    return searchTracks(query, ctx.limit)
      .then((tracks) => (ctx.signal.aborted ? [] : tracks.map(candidate)))
      .catch(() => [])
  },
  idle(): Candidate[] {
    const { track, playing } = spotifySnapshot()
    if (!track) return []
    return [
      {
        id: "spotify:now-playing",
        title: track.name,
        subtitle: track.artists,
        detail: playing ? "playing" : "paused",
        icon: () => albumArt(track.albumArt),
        run: () => {},
        keepOpen: true,
      },
    ]
  },
}
