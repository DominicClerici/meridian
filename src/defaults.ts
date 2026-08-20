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

export const LAYOUT_MODES = ["default", "dashboard", "immersive"] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

/** How the weather widget arrived at its coordinates. See `docs/weather.md`. */
export type LocationSource = "device" | "manual" | "timezone"

/** Which Google OAuth path the calendar is using. See `docs/calendar.md`. */
export type GoogleAuthMethod = "native" | "web"

export type SyncSettings = {
  theme: "modern";
  layout: LayoutMode;
  accentColor: AccentColor | "random";
  bgColor: AccentColor | "auto";
  mode: "light" | "dark" | "auto";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
  searchOpenInNewTab: boolean;
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
  shortcutsOpenIn: "current" | "new";
  calendarEnabled: boolean;
  googleClientId: string;
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
  weatherLocationSource: LocationSource | null
  weatherLocationLabel: string | null
  spotifyAccessToken: string | null
  spotifyRefreshToken: string | null
  spotifyTokenExpiry: number | null
  recommendationData: RecommendationData | null
  calendarConnected: boolean
  googleAuthMethod: GoogleAuthMethod | null
  googleAccessToken: string | null
  googleTokenExpiry: number | null
  bgUnsplashMeta: BgImageMeta | null
  bgUploadMeta: BgImageMeta | null
}

export const syncDefaults: SyncSettings = {
  theme: "modern",
  layout: "default",
  accentColor: "sky",
  bgColor: "auto",
  mode: "auto",
  searchEngine: "google",
  debounceSearch: false,
  searchOpenInNewTab: false,
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
  shortcutsOpenIn: "current",
  recommendationsEnabled: false,
  calendarEnabled: false,
  googleClientId: "",
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
  weatherLocationSource: null,
  weatherLocationLabel: null,
  spotifyAccessToken: null,
  spotifyRefreshToken: null,
  spotifyTokenExpiry: null,
  recommendationData: null,
  calendarConnected: false,
  googleAuthMethod: null,
  googleAccessToken: null,
  googleTokenExpiry: null,
  bgUnsplashMeta: null,
  bgUploadMeta: null,
}
