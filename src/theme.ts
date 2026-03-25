import { store } from "./store"
import type { SyncSettings } from "./defaults"

const root = document.documentElement

const ATTR_MAP: Record<string, string> = {
  theme: "data-theme",
  accentColor: "data-accent",
  bgColor: "data-bg",
}

let mql: MediaQueryList | null = null
let mqlHandler: (() => void) | null = null

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

export function applyTheme(): void {
  for (const [storeKey, attr] of Object.entries(ATTR_MAP)) {
    root.setAttribute(attr, store.sync.get(storeKey as keyof SyncSettings) as string)
  }
  applyMode(store.sync.get("mode"))
}

export function subscribeTheme(): void {
  for (const [storeKey, attr] of Object.entries(ATTR_MAP)) {
    store.sync.subscribe(storeKey as keyof SyncSettings, (val) => {
      root.setAttribute(attr, val as string)
    })
  }
  store.sync.subscribe("mode", applyMode)
}
