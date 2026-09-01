import { store } from "../../store"
import { icon } from "../../icons/registry"
import { showToast } from "../../components"
import { openSettings } from "../../settings"
import { refreshDailyNow } from "../../background"
import { refreshGithub } from "../../github"
import { refreshLinear } from "../../linear"
import { refreshMail } from "../../mail"
import { spotifyControls, spotifySnapshot } from "../../spotify"
import { clearSearchHistory, hasSearchHistory } from "../recents"
import { ACCENT_COLORS, LAYOUT_MODES } from "../../defaults"
import type { AccentColor, LayoutMode, SyncSettings } from "../../defaults"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * The palette as a way of *doing* things, not only finding them.
 *
 * Every command is a plain object rather than a class or a decorator: the list
 * is meant to be read top to bottom and added to without ceremony. `available`
 * is what keeps "Pause Spotify" out of the list when nothing is playing.
 */
type Command = {
  id: string
  title: string
  subtitle?: string
  glyph: string
  /** Extra words that should find it — "dark" finding "Switch to dark mode". */
  keywords?: string[]
  available?(): boolean
  /** Leaves the palette open, for something with visible feedback in place. */
  keepOpen?: boolean
  run(): void
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const ENGINE_LABELS: Record<SyncSettings["searchEngine"], string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  qwant: "Qwant",
  startpage: "Startpage",
}

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  default: "Default",
  dashboard: "Dashboard",
  immersive: "Immersive",
}

/** Widgets that are a single boolean, which is most of them. */
const WIDGETS: { key: keyof SyncSettings; label: string; glyph: string }[] = [
  { key: "clockEnabled", label: "clock", glyph: "dueClock" },
  { key: "todoEnabled", label: "todos", glyph: "todoList" },
  { key: "notepadEnabled", label: "notepad", glyph: "notepad" },
  { key: "weatherEnabled", label: "weather", glyph: "wxPartly" },
  { key: "spotifyEnabled", label: "Spotify", glyph: "spotify" },
  { key: "calendarEnabled", label: "calendar", glyph: "calendar" },
  { key: "githubEnabled", label: "GitHub", glyph: "github" },
  { key: "linearEnabled", label: "Linear", glyph: "linear" },
  { key: "mailEnabled", label: "mail", glyph: "mail" },
  { key: "recommendationsEnabled", label: "suggestions", glyph: "sparkle" },
]

/** Settings sections worth jumping straight to. */
const SECTIONS: { tab: string; section?: string; label: string; glyph: string }[] = [
  { tab: "general", label: "General", glyph: "tabGeneral" },
  { tab: "shortcuts", label: "Shortcuts", glyph: "tabShortcuts" },
  { tab: "appearance", label: "Appearance", glyph: "tabAppearance" },
  { tab: "widgets", label: "Widgets", glyph: "tabWidgets" },
  { tab: "advanced", label: "Advanced", glyph: "tabAdvanced" },
  { tab: "widgets", section: "search", label: "Search", glyph: "search" },
  { tab: "widgets", section: "todo", label: "Todo", glyph: "todoList" },
  { tab: "widgets", section: "notepad", label: "Notepad", glyph: "notepad" },
  { tab: "widgets", section: "weather", label: "Weather", glyph: "wxPartly" },
  { tab: "widgets", section: "spotify", label: "Spotify", glyph: "spotify" },
  { tab: "widgets", section: "calendar", label: "Google Calendar", glyph: "calendar" },
  { tab: "widgets", section: "mail", label: "Gmail", glyph: "mail" },
  { tab: "widgets", section: "github", label: "GitHub", glyph: "github" },
  { tab: "widgets", section: "linear", label: "Linear", glyph: "linear" },
]

function buildCommands(): Command[] {
  const commands: Command[] = []

  /* Appearance */
  const mode = store.sync.get("mode")
  for (const value of ["light", "dark", "auto"] as const) {
    commands.push({
      id: `mode:${value}`,
      title: value === "auto" ? "Match system appearance" : `Switch to ${value} mode`,
      subtitle: "Appearance",
      glyph: value === "light" ? "modeLight" : value === "dark" ? "modeDark" : "modeAuto",
      keywords: [value, "theme"],
      available: () => mode !== value,
      run: () => store.sync.set("mode", value),
    })
  }

  for (const color of ACCENT_COLORS) {
    commands.push({
      id: `accent:${color}`,
      title: `Accent: ${capitalize(color)}`,
      subtitle: "Appearance",
      glyph: "swatchCheck",
      keywords: ["color", "accent"],
      run: () => store.sync.set("accentColor", color as AccentColor),
    })
  }
  commands.push({
    id: "accent:random",
    title: "Accent: Random each day",
    subtitle: "Appearance",
    glyph: "randomAccent",
    keywords: ["color"],
    run: () => store.sync.set("accentColor", "random"),
  })

  for (const layout of LAYOUT_MODES) {
    commands.push({
      id: `layout:${layout}`,
      title: `Layout: ${LAYOUT_LABELS[layout]}`,
      subtitle: "Appearance",
      glyph: "tabAppearance",
      available: () => store.sync.get("layout") !== layout,
      run: () => store.sync.set("layout", layout),
    })
  }

  commands.push({
    id: "bg:shuffle",
    title: "Shuffle wallpaper",
    subtitle: "Appearance",
    glyph: "bgImage",
    keywords: ["background", "photo", "unsplash"],
    available: () => store.sync.get("bgSource") === "unsplash",
    run: () => {
      refreshDailyNow()
      showToast("Fetching a new wallpaper…")
    },
  })

  /* Widgets */
  for (const widget of WIDGETS) {
    const on = store.sync.get(widget.key) as boolean
    commands.push({
      id: `widget:${String(widget.key)}`,
      title: `${on ? "Hide" : "Show"} ${widget.label}`,
      subtitle: "Widgets",
      glyph: widget.glyph,
      keywords: ["toggle", "widget"],
      run: () => store.sync.set(widget.key, !on as never),
    })
  }

  /* Search */
  for (const engine of Object.keys(ENGINE_LABELS) as (keyof typeof ENGINE_LABELS)[]) {
    commands.push({
      id: `engine:set:${engine}`,
      title: `Search engine: ${ENGINE_LABELS[engine]}`,
      subtitle: "Search",
      glyph: "search",
      available: () => store.sync.get("searchEngine") !== engine,
      run: () => store.sync.set("searchEngine", engine),
    })
  }

  const newTab = store.sync.get("searchOpenInNewTab")
  commands.push({
    id: "search:new-tab",
    title: newTab ? "Open results in the current tab" : "Open results in a new tab",
    subtitle: "Search",
    glyph: "tab",
    run: () => store.sync.set("searchOpenInNewTab", !newTab),
  })

  commands.push({
    id: "search:clear-history",
    title: "Clear search history",
    subtitle: "Search",
    glyph: "trash",
    keywords: ["recent", "forget"],
    available: hasSearchHistory,
    run: () => {
      clearSearchHistory()
      showToast("Search history cleared")
    },
  })

  /* Connected services */
  commands.push(
    {
      id: "refresh:github",
      title: "Refresh GitHub",
      subtitle: "GitHub",
      glyph: "refresh",
      available: () => store.sync.get("githubEnabled"),
      run: () => void refreshGithub(true),
    },
    {
      id: "refresh:linear",
      title: "Refresh Linear",
      subtitle: "Linear",
      glyph: "refresh",
      available: () => store.sync.get("linearEnabled"),
      run: () => void refreshLinear(true),
    },
    {
      id: "refresh:mail",
      title: "Refresh mail",
      subtitle: "Mail",
      glyph: "refresh",
      available: () => store.sync.get("mailEnabled"),
      run: () => void refreshMail(true),
    }
  )

  const spotify = spotifySnapshot()
  if (spotify.connected) {
    commands.push(
      {
        id: "spotify:toggle",
        title: spotify.playing ? "Pause Spotify" : "Play Spotify",
        subtitle: "Spotify",
        glyph: spotify.playing ? "pause" : "play",
        run: () => void (spotify.playing ? spotifyControls.pause() : spotifyControls.play()),
      },
      {
        id: "spotify:next",
        title: "Next track",
        subtitle: "Spotify",
        glyph: "skipForward",
        run: () => void spotifyControls.next(),
      },
      {
        id: "spotify:previous",
        title: "Previous track",
        subtitle: "Spotify",
        glyph: "skipBack",
        run: () => void spotifyControls.previous(),
      }
    )
  }

  /* Settings */
  for (const entry of SECTIONS) {
    commands.push({
      id: `settings:${entry.tab}:${entry.section ?? ""}`,
      title: `Settings: ${entry.label}`,
      subtitle: "Settings",
      glyph: entry.glyph,
      keywords: ["preferences", "options"],
      run: () => openSettings(entry.tab, entry.section),
    })
  }

  commands.push({
    id: "page:reload",
    title: "Reload the page",
    subtitle: "Page",
    glyph: "refresh",
    run: () => location.reload(),
  })

  return commands
}

function candidate(command: Command): Candidate {
  return {
    id: `command:${command.id}`,
    title: command.title,
    subtitle: command.subtitle,
    haystack: command.keywords,
    icon: () => icon(command.glyph, { size: 16 }),
    keepOpen: command.keepOpen,
    run: () => command.run(),
  }
}

export const commandsSource: SearchSource = {
  id: "commands",
  label: "Commands",
  token: "cmd",
  glyph: "sparkle",
  // Below the sources that hold *things*. A bare noun is nearly always a search
  // for something rather than an instruction — "mail" should find your Gmail
  // shortcut before it offers to hide the mail widget. `>` and `@cmd` are where
  // you go when you did mean the instruction, and there weight doesn't apply.
  weight: 0.98,
  limit: 3,
  scopedLimit: 40,
  available: () => true,
  query(ctx: QueryContext): Candidate[] {
    if (!ctx.text.trim() && !ctx.scoped) return []
    return buildCommands()
      .filter((c) => c.available?.() ?? true)
      .map(candidate)
  },
  idle(): Candidate[] {
    return buildCommands()
      .filter((c) => c.available?.() ?? true)
      .map(candidate)
  },
}
