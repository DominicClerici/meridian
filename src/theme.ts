import { store } from "./store"
import type { SyncSettings } from "./defaults"
import { ACCENT_COLORS } from "./defaults"

const root = document.documentElement

let mql: MediaQueryList | null = null
let mqlHandler: (() => void) | null = null

const RANDOM_DATE_KEY = "sp:local:randomAccentDate"
const RANDOM_COLOR_KEY = "sp:local:randomAccentColor"

function resolveMode(mode: SyncSettings["mode"]): "light" | "dark" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return mode
}

function applyMode(mode: SyncSettings["mode"]): void {
  root.setAttribute("data-mode", resolveMode(mode))

  if (mqlHandler && mql) {
    mql.removeEventListener("change", mqlHandler)
    mqlHandler = null
    mql = null
  }

  if (mode === "auto") {
    mql = window.matchMedia("(prefers-color-scheme: dark)")
    mqlHandler = () => root.setAttribute("data-mode", resolveMode("auto"))
    mql.addEventListener("change", mqlHandler)
  }
}

function getRandomAccent(): string {
  const today = new Date().toDateString()
  const storedDate = localStorage.getItem(RANDOM_DATE_KEY)
  const storedColor = localStorage.getItem(RANDOM_COLOR_KEY)

  if (storedDate === today && storedColor && (ACCENT_COLORS as readonly string[]).includes(storedColor)) {
    return storedColor
  }

  const color = ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)]
  localStorage.setItem(RANDOM_DATE_KEY, today)
  localStorage.setItem(RANDOM_COLOR_KEY, color)
  return color
}

function resolveAccent(val: string): string {
  return val === "random" ? getRandomAccent() : val
}

function resolveBg(val: string): string {
  if (val === "auto") return resolveAccent(store.sync.get("accentColor"))
  return val
}

export function applyTheme(): void {
  root.setAttribute("data-theme", store.sync.get("theme"))
  const resolved = resolveAccent(store.sync.get("accentColor"))
  root.setAttribute("data-accent", resolved)
  root.setAttribute("data-bg", store.sync.get("bgColor") === "auto" ? resolved : store.sync.get("bgColor"))
  applyMode(store.sync.get("mode"))
}

export function subscribeTheme(): void {
  store.sync.subscribe("theme", (val) => {
    root.setAttribute("data-theme", val)
  })

  store.sync.subscribe("accentColor", (val) => {
    const resolved = resolveAccent(val)
    root.setAttribute("data-accent", resolved)
    if (store.sync.get("bgColor") === "auto") {
      root.setAttribute("data-bg", resolved)
    }
  })

  store.sync.subscribe("bgColor", (val) => {
    root.setAttribute("data-bg", resolveBg(val))
  })

  store.sync.subscribe("mode", applyMode)
}
