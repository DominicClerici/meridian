import type { Tab } from "./shortcuts"
import type { Todo } from "./todos"

export type DomainHeatmap = {
  [domain: string]: number[][]
}

export type RecommendationData = {
  heatmap: DomainHeatmap
  builtAt: number
}

export const ACCENT_COLORS = ["rose", "coral", "amber", "teal", "sky", "violet", "slate", "stone", "zinc", "graphite"] as const
export type AccentColor = (typeof ACCENT_COLORS)[number]

export type BgImageMeta = {
  id: string
  url: string
  authorName: string
  authorUrl: string
  downloadUrl: string
  cachedAt: number
}

export type SyncSettings = {
  theme: "modern";
  accentColor: AccentColor | "random";
  bgColor: AccentColor | "auto";
  mode: "light" | "dark" | "auto";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  clock24Hour: boolean;
  clockShowAmPm: boolean;
  clockShowDate: boolean;
  clockDateFormat: "long" | "short" | "abbr" | "numeric" | "numericShort";
  clockSize: "small" | "medium" | "large";
  todoEnabled: boolean;
  todoShowBadges: boolean;
  weatherEnabled: boolean;
  weatherUnit: "f" | "c";
  spotifyEnabled: boolean;
  recommendationsEnabled: boolean;
  calendarEnabled: boolean;
  bgSource: "color" | "unsplash" | "upload";
  unsplashDaily: boolean;
  unsplashTopic: string;
  unsplashApiKey: string;
};

export type LocalSettings = {
  shortcuts: Tab[]
  todos: Todo[]
  weatherLat: number | null
  weatherLon: number | null
  spotifyAccessToken: string | null
  spotifyRefreshToken: string | null
  spotifyTokenExpiry: number | null
  recommendationData: RecommendationData | null
  calendarConnected: boolean
  bgUnsplashMeta: BgImageMeta | null
  bgUploadMeta: BgImageMeta | null
}

export const syncDefaults: SyncSettings = {
  theme: "modern",
  accentColor: "sky",
  bgColor: "auto",
  mode: "auto",
  searchEngine: "google",
  debounceSearch: false,
  clockEnabled: true,
  clockShowSeconds: false,
  clock24Hour: false,
  clockShowAmPm: true,
  clockShowDate: false,
  clockDateFormat: "long",
  clockSize: "medium",
  todoEnabled: true,
  todoShowBadges: true,
  weatherEnabled: true,
  weatherUnit: "f",
  spotifyEnabled: true,
  recommendationsEnabled: false,
  calendarEnabled: false,
  bgSource: "color",
  unsplashDaily: false,
  unsplashTopic: "wallpapers",
  unsplashApiKey: "",
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
  todos: [],
  weatherLat: null,
  weatherLon: null,
  spotifyAccessToken: null,
  spotifyRefreshToken: null,
  spotifyTokenExpiry: null,
  recommendationData: null,
  calendarConnected: false,
  bgUnsplashMeta: null,
  bgUploadMeta: null,
}
