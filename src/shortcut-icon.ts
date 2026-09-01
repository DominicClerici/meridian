import { icon as glyph } from "./icons/registry"
import { urlHost } from "./url"
import { idbGetFrom, ICON_STORE } from "./idb"
import type { IconSpec } from "./shortcuts"

/**
 * Every icon in the shortcuts system is drawn here — the dock, the settings
 * grid, the icon picker and the import preview. Before this module the palette
 * had three disagreeing definitions and there were two favicon helpers that
 * behaved differently on a scheme-less URL.
 *
 * Colours are never resolved to hex in JS: a swatch is emitted as
 * `var(--swatch-<name>)` so the CSS tokens stay the only definition, and light
 * and dark mode keep their separate values for free.
 */

export type IconKind = "shortcut" | "folder" | "tab"

export type IconTarget = {
  kind: IconKind
  name: string
  url?: string
}

export type IconRenderOpts = {
  /** Inline pixel size. Omit to let CSS size it — that is what the dock does. */
  size?: number
  className?: string
}

/** Offered by the picker, in the order they appear there. */
export const ICON_GLYPHS = [
  "link", "globe", "folder", "star", "pin", "flag", "sparkle",
  "github", "linear", "spotify", "mail", "calendar", "notepad", "todoList",
  "search", "inbox", "archive", "musicNote", "play", "eye", "copy",
  "at", "branch", "checkCircle", "compose", "dueClock", "tab", "repeat",
] as const

export function swatchColor(name: string): string {
  return `var(--swatch-${name})`
}

/**
 * The one favicon helper. Normalizing through `urlHost` is what makes
 * `example.com` and `https://example.com` resolve identically — they used to
 * disagree between the dock and the settings list.
 */
export function faviconUrl(url: string, size = 64): string {
  const host = urlHost(url)
  return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=${size}` : ""
}

/** What an item with no explicit icon draws. */
export function defaultSpec(kind: IconKind): IconSpec {
  if (kind === "shortcut") return { type: "favicon" }
  if (kind === "folder") return { type: "folder" }
  return { type: "glyph", name: "tab" }
}

/** First character, matching what the legacy `color` icon has always shown. */
export function initial(name: string): string {
  return name.trim().charAt(0) || "?"
}

/** Default text for a new monogram: initials of the first two words. */
export function suggestMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// Blob URLs are cached rather than revoked: the same icon is drawn by the dock
// and the settings grid at once, and both live for the life of the page.
const blobUrls = new Map<string, Promise<string | null>>()

function imageUrl(key: string): Promise<string | null> {
  let pending = blobUrls.get(key)
  if (!pending) {
    pending = idbGetFrom(ICON_STORE, key)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null)
    blobUrls.set(key, pending)
  }
  return pending
}

/** Called after replacing an uploaded icon, so the next render refetches. */
export function forgetImage(key: string): void {
  const pending = blobUrls.get(key)
  blobUrls.delete(key)
  pending?.then((url) => url && URL.revokeObjectURL(url))
}

function sized(el: HTMLElement, opts?: IconRenderOpts): HTMLElement {
  if (opts?.className) el.className += ` ${opts.className}`
  if (opts?.size !== undefined) {
    el.style.width = `${opts.size}px`
    el.style.height = `${opts.size}px`
  }
  return el
}

function tile(text: string, color: string, opts?: IconRenderOpts): HTMLElement {
  const el = document.createElement("span")
  el.className = "sc-icon sc-icon-tile"
  el.style.background = swatchColor(color)
  el.textContent = text
  // The dock sizes its icons from CSS, so a font-size only follows an explicit
  // one; `.dock-item .sc-icon` supplies the other half.
  if (opts?.size !== undefined) el.style.fontSize = `${Math.max(9, Math.round(opts.size * 0.44))}px`
  return sized(el, opts)
}

// No `size` is passed to `icon()` — `.sc-icon-glyph > svg` makes the SVG fill
// the span, so one rule covers both the inline-sized and CSS-sized cases.
function glyphEl(name: string, color: string | undefined, opts?: IconRenderOpts): HTMLElement {
  const el = glyph(name)
  el.className += " sc-icon sc-icon-glyph"
  if (color) el.style.color = swatchColor(color)
  return sized(el, opts)
}

function image(src: string, opts?: IconRenderOpts): HTMLImageElement {
  const img = document.createElement("img")
  img.className = "sc-icon sc-icon-img"
  img.alt = ""
  img.loading = "lazy"
  img.src = src
  return sized(img, opts) as HTMLImageElement
}

/**
 * Builds the visual for one icon. The returned element carries `sc-icon` plus
 * a variant class, which is how the dock keeps sizing icons from CSS (so the
 * Dashboard layout can enlarge them) while the settings panel sizes inline.
 */
export function renderIcon(
  spec: IconSpec | undefined,
  target: IconTarget,
  opts?: IconRenderOpts
): HTMLElement {
  const effective = spec ?? defaultSpec(target.kind)

  switch (effective.type) {
    case "color":
      return tile(initial(target.name), effective.color, opts)

    case "mono":
      return tile(effective.text || initial(target.name), effective.color, opts)

    case "glyph":
      return glyphEl(effective.name, effective.color, opts)

    case "folder":
      return glyphEl("folder", undefined, opts)

    case "image": {
      const img = image("", opts)
      imageUrl(effective.key).then((url) => {
        if (url) img.src = url
        else img.replaceWith(renderIcon(defaultSpec(target.kind), target, opts))
      })
      return img
    }

    case "favicon":
    default: {
      const src = faviconUrl(target.url ?? "", opts?.size ? opts.size * 2 : 64)
      if (!src) return glyphEl("link", undefined, opts)
      const img = image(src, opts)
      img.addEventListener(
        "error",
        () => img.replaceWith(glyphEl("link", undefined, opts)),
        { once: true }
      )
      return img
    }
  }
}
