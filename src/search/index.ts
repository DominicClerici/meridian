import { store } from "../store"
import { registerSource } from "./registry"
import { buildPalette, closePalette, isPaletteOpen, openPalette } from "./overlay"
import { answersSource } from "./sources/answers"
import { bookmarksSource, primeBookmarks } from "./sources/bookmarks"
import { calendarSource } from "./sources/calendar"
import { commandsSource } from "./sources/commands"
import { engineSource, navigationSource, suggestionsSource } from "./sources/engine"
import { githubSource } from "./sources/github"
import { historySource } from "./sources/history"
import { linearSource } from "./sources/linear"
import { mailSource } from "./sources/mail"
import { notesSource } from "./sources/notes"
import { shortcutsSource } from "./sources/shortcuts"
import { spotifySource } from "./sources/spotify"
import { primeTabs, tabsSource } from "./sources/tabs"
import { todosSource } from "./sources/todos"

export { openPalette, closePalette, isPaletteOpen }
export { clearSearchHistory, hasSearchHistory } from "./recents"
export { SUGGEST_ORIGINS } from "./sources/engine"

/**
 * Registration order is not result order — `registry.ts` ranks — but it is the
 * order the `@` picker lists sources in, so it runs roughly most- to
 * least-used.
 */
const SOURCES = [
  answersSource,
  navigationSource,
  commandsSource,
  shortcutsSource,
  tabsSource,
  historySource,
  bookmarksSource,
  todosSource,
  notesSource,
  calendarSource,
  mailSource,
  linearSource,
  githubSource,
  spotifySource,
  suggestionsSource,
  engineSource,
]

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/** Settings is a modal dialog of its own; its keystrokes are not ours. */
function otherDialogOpen(): boolean {
  for (const el of document.querySelectorAll("dialog[open]")) {
    if (el.id !== "palette") return true
  }
  return false
}

/** One character, no modifiers — the test for "they started typing a query". */
function isPrintable(e: KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    e.key !== " " &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  )
}

function onGlobalKey(e: KeyboardEvent): void {
  if (isPaletteOpen()) return

  if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    openPalette()
    return
  }

  if (otherDialogOpen() || isTypingTarget(e.target)) return

  if (e.key === "/") {
    e.preventDefault()
    openPalette()
    return
  }

  if (store.sync.get("searchTypeAnywhere") && isPrintable(e)) {
    e.preventDefault()
    openPalette(e.key)
  }
}

export function initSearch(): void {
  for (const source of SOURCES) registerSource(source)

  buildPalette()

  // Both are permission probes, not queries: they settle `available()` so the
  // first keystroke doesn't have to wait on a round trip to find out.
  primeBookmarks()
  primeTabs()

  const bar = document.getElementById("search-bar") as HTMLButtonElement | null
  bar?.addEventListener("click", () => openPalette())

  if (bar && store.sync.get("searchAutofocus")) {
    // Focused, not opened: a new tab shouldn't dim itself before you have typed
    // anything. The first keystroke is what promotes it to the palette.
    bar.focus({ preventScroll: true })
  }

  document.addEventListener("keydown", onGlobalKey)
}
