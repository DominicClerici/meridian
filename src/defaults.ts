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

/** The datapoint the weather widget charts. See `docs/weather.md`. */
export type WeatherMetric =
  | "temperature"
  | "apparent"
  | "humidity"
  | "wind"
  | "uv"
  | "precipitation"
  | "aqi"

/** Typeface the notepad writes in. See `docs/notepad.md`. */
export type NotepadFont = "sans" | "mono"

/** A note longer than this stops being a scratchpad. Enforced on the textarea,
    and surfaced as a counter once the note is close to it. */
export const MAX_NOTE_LENGTH = 50_000

/** Which Google OAuth path the calendar is using. See `docs/calendar.md`. */
export type GoogleAuthMethod = "native" | "web"

/**
 * A feature that signs in through the shared Google account. Each one declares
 * its own scopes, and the token carries the union of the *connected* features'
 * needs — so a calendar-only user is never asked for mail. See `docs/mail.md`.
 */
export type GoogleFeature = "calendar" | "mail"

/**
 * Gmail's inbox tabs, in the order they render. These map onto the
 * `CATEGORY_*` labels; a mailbox with tabs turned off reports zero for all of
 * them, which is what makes the "All" tab the fallback. See `docs/mail.md`.
 */
export const MAIL_CATEGORIES = ["primary", "social", "promotions", "updates", "forums"] as const
export type MailCategory = (typeof MAIL_CATEGORIES)[number]

/** What the mail trigger badge and the Dashboard tile count. */
export type MailCountSource = "primary" | "inbox" | "important" | "starred"

/**
 * The last track Spotify reports as played, cached so a new tab can draw the
 * idle state before the API answers. See `docs/spotify.md`.
 */
export type SpotifyRecentTrack = {
  name: string
  artists: string
  albumArt: string | null
  url: string | null
  playedAt: number
}

/**
 * One extra clock face for another timezone. The label is the user's own — it
 * defaults to the zone's city but is editable, so "Asia/Tokyo" can read "Kenji"
 * or "HQ". See `docs/world-clocks.md`.
 */
export type WorldClock = {
  id: string
  /** IANA zone id, e.g. `Asia/Tokyo`. */
  timezone: string
  label: string
}

/** More than a handful stops being a glance and starts being a table. */
export const MAX_WORLD_CLOCKS = 5

/** How the GitHub widget got its token. See `docs/github.md`. */
export type GithubTokenType = "oauth" | "pat"

/** The signed-in GitHub account, cached so the card can name it offline. */
export type GithubUser = {
  login: string
  name: string | null
  avatarUrl: string
}

/**
 * A section of the GitHub card. The order here is the order they render in, and
 * it is deliberate: what other people are waiting on comes before what you are
 * waiting on, which comes before anything merely addressed to you.
 */
export const GITHUB_SECTIONS = ["reviews", "mine", "mentions", "issues"] as const
export type GithubSection = (typeof GITHUB_SECTIONS)[number]

/** How the Linear widget got its token. See `docs/linear.md`. */
export type LinearTokenType = "apiKey" | "oauth"

/** The signed-in Linear account, cached so the card can name it offline. */
export type LinearUser = {
  id: string
  name: string
  displayName: string
  avatarUrl: string | null
  url: string
  orgName: string
  orgUrlKey: string
}

/**
 * A section of the Linear card, in render order. Same principle as the GitHub
 * card: what is late comes before what is in flight, which comes before what
 * has not been started.
 */
export const LINEAR_SECTIONS = ["inbox", "due", "progress", "todo"] as const
export type LinearSection = (typeof LINEAR_SECTIONS)[number]

/**
 * Everything the command palette can find. The ids are stable: they key the
 * per-source toggles, the `@token` scopes, and the learned ranking. See
 * `docs/search.md`.
 */
export const SEARCH_SOURCES = [
  "answers",
  "navigation",
  "commands",
  "shortcuts",
  "tabs",
  "history",
  "bookmarks",
  "todos",
  "notes",
  "calendar",
  "mail",
  "linear",
  "github",
  "spotify",
  "suggestions",
  "engine",
] as const
export type SearchSourceId = (typeof SEARCH_SOURCES)[number]

export type RecentQuery = { text: string; at: number }

/**
 * What the palette has learned from what you actually pick.
 *
 * `picks` is a decayed frequency per candidate id; `byQuery` remembers the one
 * result a given query ended in, which is what makes the second search for
 * something land on it directly.
 */
export type SearchLearning = {
  picks: Record<string, number>
  byQuery: Record<string, string>
}

export type SyncSettings = {
  theme: "modern";
  layout: LayoutMode;
  /** Exact arrangements of the Default layout's card region, keyed by column
      count: one ordered stack of card ids per column, a spanning card listed
      in each column it covers. Counts with no entry derive from the nearest. */
  cardLayouts: Record<string, string[][]>;
  /** Pre-column-stack arrangement — a flat card order. Only read as the seed
      for a derived layout when `cardLayouts` is empty. */
  cardOrder: string[];
  accentColor: AccentColor | "random";
  bgColor: AccentColor | "auto";
  mode: "light" | "dark" | "auto";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  searchOpenInNewTab: boolean;
  /** Sources the palette should not query. Stored as a *disabled* list rather
      than a map of every source, so a source added in a later version is on by
      default without a migration. */
  searchDisabledSources: SearchSourceId[];
  /** Live query suggestions from the search engine. Off: it is a network call
      that sends keystrokes to the engine, and it needs an optional host grant. */
  searchSuggestions: boolean;
  /** Any printable key on the page opens the palette with that character. */
  searchTypeAnywhere: boolean;
  /** Focus the resting bar as soon as a new tab paints. */
  searchAutofocus: boolean;
  /** Remember recent queries and learn from which results get picked. */
  searchRecents: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  clock24Hour: boolean;
  clockShowAmPm: boolean;
  clockShowDate: boolean;
  clockDateFormat: "long" | "short" | "abbr" | "numeric" | "numericShort";
  clockSize: "small" | "medium" | "large";
  /** Extra timezones shown alongside the main clock, in display order. */
  worldClocks: WorldClock[];
  todoEnabled: boolean;
  todoShowBadges: boolean;
  notepadEnabled: boolean;
  notepadFont: NotepadFont;
  weatherEnabled: boolean;
  weatherUnit: "f" | "c";
  weatherMetric: WeatherMetric;
  spotifyEnabled: boolean;
  spotifyClientId: string;
  recommendationsEnabled: boolean;
  shortcutsOpenIn: "current" | "new";
  calendarEnabled: boolean;
  googleClientId: string;
  githubEnabled: boolean;
  githubClientId: string;
  /** Which sections the card renders, in `GITHUB_SECTIONS` order. */
  githubSections: GithubSection[];
  /** Collapse PRs opened by bots (dependabot, renovate) into a single row. */
  githubHideBots: boolean;
  githubShowContributions: boolean;
  /** Only surface items from this org. Empty means every org. */
  githubOrgFilter: string;
  /** `owner/name` repos to drop entirely. */
  githubIgnoredRepos: string[];
  linearEnabled: boolean;
  linearClientId: string;
  /** Which sections the card renders, in `LINEAR_SECTIONS` order. */
  linearSections: LinearSection[];
  /** The active-cycle burndown under the sections. */
  linearShowCycle: boolean;
  /** Only surface issues from this team key (e.g. `ENG`). Empty means all. */
  linearTeamFilter: string;
  /** Cross-badge Linear issues and GitHub PRs that reference each other. */
  linearLinkGithub: boolean;
  mailEnabled: boolean;
  /** Which unread count the trigger badge and the Dashboard tile report. */
  mailCountSource: MailCountSource;
  /** Category tabs the body offers, in `MAIL_CATEGORIES` order. */
  mailCategories: MailCategory[];
  /** The preview line under each subject. Off makes the list twice as dense. */
  mailShowSnippets: boolean;
  /** How many messages a fetch asks for, and the list renders. */
  mailMaxRows: number;
  bgSource: "color" | "unsplash" | "upload";
  unsplashDaily: boolean;
  unsplashTopic: string;
  unsplashApiKey: string;
};

export type LocalSettings = {
  shortcuts: Tab[]
  todos: Todo[]
  /** The notepad's one freeform note. Local, not sync: `storage.sync` caps an
      item at 8KB, which a scratchpad would quietly hit. */
  notepadBody: string
  notepadUpdatedAt: number | null
  weatherLat: number | null
  weatherLon: number | null
  weatherLocationSource: LocationSource | null
  weatherLocationLabel: string | null
  spotifyAccessToken: string | null
  spotifyRefreshToken: string | null
  spotifyTokenExpiry: number | null
  spotifyRecentTrack: SpotifyRecentTrack | null
  recommendationData: RecommendationData | null
  calendarConnected: boolean
  mailConnected: boolean
  googleAuthMethod: GoogleAuthMethod | null
  googleAccessToken: string | null
  googleTokenExpiry: number | null
  /**
   * The scopes the current token actually carries, as Google reported them.
   * Read before every call so a feature can tell "not connected" from
   * "connected, but this permission was never granted".
   */
  googleGrantedScopes: string[]
  /** The signed-in mailbox, cached so rows can deep-link to the right account. */
  mailAddress: string | null
  githubToken: string | null
  githubTokenType: GithubTokenType | null
  /** Only issued when the app has expiring user tokens turned on — a plain
      OAuth App leaves both this and the expiry null. See `docs/github.md`. */
  githubRefreshToken: string | null
  githubTokenExpiry: number | null
  /** A GitHub App's client secret, needed *only* to refresh an expiring token —
      GitHub's refresh endpoint requires one even for a public client. `local`,
      never `sync`: it is a credential, and it belongs to this browser. */
  githubClientSecret: string
  /** Scopes the token actually carries, so the UI can explain a 403 instead of
      silently dropping a section. Space-separated, as GitHub returns them. */
  githubScopes: string
  githubUser: GithubUser | null
  linearToken: string | null
  linearTokenType: LinearTokenType | null
  /** OAuth only — an API key never expires and has nothing to refresh. */
  linearRefreshToken: string | null
  linearTokenExpiry: number | null
  linearUser: LinearUser | null
  bgUnsplashMeta: BgImageMeta | null
  bgUploadMeta: BgImageMeta | null
  /** Which widget the Dashboard's side carousel was left on. */
  dashboardWidget: string | null
  /** Newest first, capped at `MAX_RECENT_QUERIES`. Local, never synced. */
  searchRecentQueries: RecentQuery[]
  searchLearning: SearchLearning
  /** Derived card arrangements for column counts the user never arranged,
      pinned so a reload lands on the same one. `sig` names the saved layouts
      and card set they were derived from; a mismatch throws them away. */
  cardLayoutCache: { sig: string; layouts: Record<string, string[][]> }
  /** Last measured card heights by `id@columns`, the floor under a card whose
      body is still loading. */
  cardHeights: Record<string, number>
}

/** Enough to fill an empty palette twice over; more is a history, not a hint. */
export const MAX_RECENT_QUERIES = 20

export const syncDefaults: SyncSettings = {
  theme: "modern",
  layout: "default",
  cardLayouts: {},
  cardOrder: [],
  accentColor: "sky",
  bgColor: "auto",
  mode: "auto",
  searchEngine: "google",
  searchOpenInNewTab: false,
  searchDisabledSources: [],
  searchSuggestions: false,
  searchTypeAnywhere: true,
  searchAutofocus: true,
  searchRecents: true,
  clockEnabled: true,
  clockShowSeconds: false,
  clock24Hour: false,
  clockShowAmPm: true,
  clockShowDate: false,
  clockDateFormat: "long",
  clockSize: "medium",
  worldClocks: [],
  todoEnabled: true,
  todoShowBadges: true,
  notepadEnabled: true,
  notepadFont: "sans",
  weatherEnabled: true,
  weatherUnit: "f",
  weatherMetric: "apparent",
  spotifyEnabled: true,
  spotifyClientId: "",
  shortcutsOpenIn: "current",
  recommendationsEnabled: false,
  calendarEnabled: false,
  googleClientId: "",
  githubEnabled: false,
  githubClientId: "",
  githubSections: ["reviews", "mine", "mentions", "issues"],
  githubHideBots: true,
  githubShowContributions: true,
  githubOrgFilter: "",
  githubIgnoredRepos: [],
  linearEnabled: false,
  linearClientId: "",
  linearSections: ["inbox", "due", "progress", "todo"],
  linearShowCycle: true,
  linearTeamFilter: "",
  linearLinkGithub: true,
  mailEnabled: false,
  mailCountSource: "primary",
  mailCategories: ["primary", "social", "promotions", "updates"],
  mailShowSnippets: true,
  mailMaxRows: 12,
  bgSource: "color",
  unsplashDaily: false,
  unsplashTopic: "wallpapers",
  unsplashApiKey: "",
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
  todos: [],
  notepadBody: "",
  notepadUpdatedAt: null,
  weatherLat: null,
  weatherLon: null,
  weatherLocationSource: null,
  weatherLocationLabel: null,
  spotifyAccessToken: null,
  spotifyRefreshToken: null,
  spotifyTokenExpiry: null,
  spotifyRecentTrack: null,
  recommendationData: null,
  calendarConnected: false,
  mailConnected: false,
  googleAuthMethod: null,
  googleAccessToken: null,
  googleTokenExpiry: null,
  googleGrantedScopes: [],
  mailAddress: null,
  githubToken: null,
  githubTokenType: null,
  githubRefreshToken: null,
  githubTokenExpiry: null,
  githubClientSecret: "",
  githubScopes: "",
  githubUser: null,
  linearToken: null,
  linearTokenType: null,
  linearRefreshToken: null,
  linearTokenExpiry: null,
  linearUser: null,
  bgUnsplashMeta: null,
  bgUploadMeta: null,
  dashboardWidget: null,
  searchRecentQueries: [],
  searchLearning: { picks: {}, byQuery: {} },
  cardLayoutCache: { sig: "", layouts: {} },
  cardHeights: {},
}
