import { store } from "../store"
import type { SyncSettings } from "../defaults"

export type IconOptions = {
  size?: number
  class?: string
}

export type AnimatedIconFactory = (
  span: HTMLSpanElement,
  opts?: IconOptions
) => void

export type IconThemeMap = Record<string, string | AnimatedIconFactory>

type ThemeName = SyncSettings["theme"]

const themes: Record<ThemeName, IconThemeMap> = {} as any

export function registerTheme(name: ThemeName, map: IconThemeMap): void {
  themes[name] = map
}

const cleanupMap = new WeakMap<HTMLElement, () => void>()
let observer: MutationObserver | null = null

function ensureObserver(): void {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.removedNodes) {
        if (node instanceof HTMLElement) unsubRemoved(node)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function unsubRemoved(el: HTMLElement): void {
  const unsub = cleanupMap.get(el)
  if (unsub) {
    unsub()
    cleanupMap.delete(el)
  }
  for (const child of el.querySelectorAll("[data-icon]")) {
    const u = cleanupMap.get(child as HTMLElement)
    if (u) {
      u()
      cleanupMap.delete(child as HTMLElement)
    }
  }
}

function applySize(span: HTMLSpanElement, size: number): void {
  const svg = span.querySelector("svg")
  if (svg) {
    svg.setAttribute("width", String(size))
    svg.setAttribute("height", String(size))
  }
}

export function icon(name: string, opts?: IconOptions): HTMLSpanElement {
  ensureObserver()

  const span = document.createElement("span")
  span.setAttribute("data-icon", name)
  span.className = `inline-flex items-center justify-center shrink-0${opts?.class ? ` ${opts.class}` : ""}`

  function render(themeName: string): void {
    const entry = themes[themeName as ThemeName]?.[name]
    if (!entry) return
    span.innerHTML = ""
    if (typeof entry === "function") {
      entry(span, opts)
    } else {
      span.innerHTML = entry
    }
    if (opts?.size) applySize(span, opts.size)
  }

  render(store.sync.get("theme"))

  const unsub = store.sync.subscribe("theme", render)
  cleanupMap.set(span, unsub)

  return span
}

export function getIconSvg(name: string): string {
  const theme = store.sync.get("theme")
  const entry = themes[theme]?.[name]
  if (typeof entry === "string") return entry
  return ""
}
