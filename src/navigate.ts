import { store } from "./store"
import { normalizeUrl } from "./url"

/**
 * The one place a URL becomes a navigation.
 *
 * Before this module the dock and both search providers each inlined their own
 * `newTab ? window.open : location.href`, and they disagreed about which
 * setting decided it — opening the same shortcut from the dock and from search
 * could behave differently. The surface names that disagreement instead of
 * hiding it: they are genuinely two preferences, read here at call time.
 */

export type OpenMode = "default" | "newTab" | "currentTab"

export type NavSurface = "dock" | "search"

/**
 * Read at action time, never at query time. A result rendered before the
 * setting changed still opens the way the setting says now.
 */
export function opensInNewTab(surface: NavSurface): boolean {
  return surface === "dock"
    ? store.sync.get("shortcutsOpenIn") === "new"
    : store.sync.get("searchOpenInNewTab")
}

export function navigate(url: string, surface: NavSurface, mode: OpenMode = "default"): void {
  const href = normalizeUrl(url)
  if (!href) return
  const newTab =
    mode === "newTab" || (mode === "default" && opensInNewTab(surface))
  if (newTab) window.open(href, "_blank", "noopener")
  else window.location.href = href
}

/** True for the clicks and keystrokes every browser treats as "open elsewhere". */
export function wantsNewTab(e: MouseEvent | KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || (e instanceof MouseEvent && e.button === 1)
}
