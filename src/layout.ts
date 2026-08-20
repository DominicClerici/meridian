import { store } from "./store"
import type { LayoutMode, SyncSettings } from "./defaults"
import { createCard, closeAllPopovers } from "./components"

export type { LayoutMode }

export type CardRegion = "top" | "main" | "side" | "grid"

export type CardDef = {
  id: string
  title: string
  order: number
  regions: Partial<Record<LayoutMode, CardRegion>>
  span?: Partial<Record<LayoutMode, number>>
  /** Setting that toggles the widget. Gates the card and rebuilds on change. */
  enabledKey?: keyof SyncSettings
  /** Extra gate beyond enabledKey — e.g. "only when there is something to show". */
  isEnabled?: () => boolean
  render: () => HTMLElement
  actions?: () => HTMLElement | null
  onUnmount?: () => void
}

const FADE_MS = 250
const PAUSE_MS = 100

const SINGLETONS = {
  widgets: "widgets",
  clock: "clock",
  search: "search-wrapper",
  dock: "dock-wrapper",
} as const

export type SlotName = keyof typeof SINGLETONS

const cards: CardDef[] = []
const mountedBodies = new Map<string, HTMLElement>()
const baseClasses = new Map<SlotName, string>()

let stageEl: HTMLElement
let parkingEl: HTMLElement
let currentMode: LayoutMode | null = null
let switching = false

export function getLayout(): LayoutMode {
  return store.sync.get("layout")
}

export function registerCard(def: CardDef): void {
  cards.push(def)
  if (def.enabledKey) {
    store.sync.subscribe(def.enabledKey, () => refreshCards())
  }
  if (currentMode) refreshCards()
}

function cardVisible(def: CardDef): boolean {
  if (def.enabledKey && !store.sync.get(def.enabledKey)) return false
  return def.isEnabled ? def.isEnabled() : true
}

/** Re-renders one card's body if it is mounted in the current layout. */
export function refreshCard(id: string): void {
  const host = mountedBodies.get(id)
  if (!host) return
  const def = cards.find((c) => c.id === id)
  if (!def) return
  reclaimSingletons(host)
  host.replaceChildren(def.render())
}

/** Rebuilds the whole card set in place — use when a card's enabled state flips. */
export function refreshCards(): void {
  if (!currentMode) return
  unmountCards()
  mountCards(currentMode)
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

/**
 * Pulls a shared singleton (search bar, dock, clock, widget triggers) out of
 * wherever it currently lives so the caller can place it. Element identity is
 * preserved across layout switches, which is what keeps every module's listeners,
 * subscriptions and drag state alive without a teardown path.
 */
function slot(name: SlotName, extraClass = ""): HTMLElement {
  const node = document.getElementById(SINGLETONS[name])!
  if (!baseClasses.has(name)) baseClasses.set(name, node.className)
  const base = baseClasses.get(name)!
  node.className = extraClass ? `${base} ${extraClass}` : base
  return node
}

/**
 * Lets a card body host a shared singleton (the clock in the dashboard top row,
 * for instance). Safe because build() parks every singleton before clearing the
 * stage, so the node is never destroyed with the frame that held it.
 */
export function adoptSlot(name: SlotName, extraClass = ""): HTMLElement {
  return slot(name, extraClass)
}

function parkSingletons(): void {
  for (const name of Object.keys(SINGLETONS) as SlotName[]) {
    parkingEl.appendChild(slot(name))
  }
}

/**
 * Moves any singleton living inside `scope` back to the parking area before
 * `scope` is torn down — without this, discarding a card that adopted the clock
 * would take the clock element with it.
 */
function reclaimSingletons(scope: HTMLElement): void {
  for (const name of Object.keys(SINGLETONS) as SlotName[]) {
    const node = document.getElementById(SINGLETONS[name])
    if (node && scope.contains(node)) parkingEl.appendChild(node)
  }
}

function region(name: CardRegion, className: string): HTMLElement {
  const node = el("div", className)
  node.dataset.region = name
  return node
}

function frameImmersive(): HTMLElement {
  const root = el("div", "absolute inset-0")

  const widgets = el("div", "absolute top-4 right-4")
  widgets.appendChild(slot("widgets"))
  root.appendChild(widgets)

  const center = el(
    "div",
    "absolute inset-0 flex items-center justify-center pointer-events-none"
  )
  const col = el("div", "w-full max-w-lg flex flex-col pointer-events-auto")
  col.appendChild(slot("clock", "text-center mb-4"))
  col.appendChild(slot("search"))
  center.appendChild(col)
  root.appendChild(center)

  const dockRow = el(
    "div",
    "absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none"
  )
  dockRow.appendChild(slot("dock"))
  root.appendChild(dockRow)

  return root
}

function frameDefault(): HTMLElement {
  const root = el("div", "absolute inset-0")

  const scroll = el("div", "absolute inset-0 overflow-y-auto px-6 pt-[10vh] pb-32")
  const col = el("div", "mx-auto w-full max-w-5xl flex flex-col items-center gap-8")
  col.appendChild(slot("clock", "text-center"))
  col.appendChild(slot("search"))
  col.appendChild(
    region("grid", "w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start")
  )
  scroll.appendChild(col)
  root.appendChild(scroll)

  const dockRow = el(
    "div",
    "absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none"
  )
  dockRow.appendChild(slot("dock"))
  root.appendChild(dockRow)

  return root
}

function frameDashboard(): HTMLElement {
  const root = el("div", "absolute inset-0 overflow-y-auto p-6")
  const wrap = el("div", "mx-auto w-full max-w-7xl flex flex-col gap-4")

  wrap.appendChild(
    region("top", "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 items-start")
  )

  const lower = el("div", "grid grid-cols-1 lg:grid-cols-3 gap-4 items-start")

  const main = el("div", "lg:col-span-2 flex flex-col gap-4")

  const searchRow = el("div", "flex justify-center")
  searchRow.appendChild(slot("search"))
  main.appendChild(searchRow)

  const dockRow = el("div", "flex justify-center")
  dockRow.appendChild(slot("dock"))
  main.appendChild(dockRow)

  main.appendChild(region("main", "flex flex-col gap-4"))
  lower.appendChild(main)

  lower.appendChild(region("side", "flex flex-col gap-4"))
  wrap.appendChild(lower)

  root.appendChild(wrap)
  return root
}

/* Literal class names: the Tailwind scanner reads source text, so these can
   never be interpolated. */
const SPAN_CLASSES: Record<number, string> = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
}

const FRAMES: Record<LayoutMode, () => HTMLElement> = {
  immersive: frameImmersive,
  default: frameDefault,
  dashboard: frameDashboard,
}

function unmountCards(): void {
  reclaimSingletons(stageEl)
  for (const id of mountedBodies.keys()) {
    cards.find((c) => c.id === id)?.onUnmount?.()
  }
  mountedBodies.clear()
  for (const node of stageEl.querySelectorAll<HTMLElement>("[data-card]")) {
    node.remove()
  }
}

function mountCards(mode: LayoutMode): void {
  const ordered = [...cards].sort((a, b) => a.order - b.order)

  for (const def of ordered) {
    const target = def.regions[mode]
    if (!target) continue
    const host = stageEl.querySelector<HTMLElement>(`[data-region="${target}"]`)
    if (!host) continue
    if (!cardVisible(def)) continue

    const body = def.render()
    const card = createCard({
      title: def.title,
      actions: def.actions?.() ?? null,
      body,
    })
    card.el.dataset.card = def.id
    const span = def.span?.[mode]
    const spanClass = span ? SPAN_CLASSES[span] : undefined
    if (spanClass) card.el.classList.add(spanClass)

    host.appendChild(card.el)
    mountedBodies.set(def.id, card.body)
  }
}

function build(mode: LayoutMode): void {
  unmountCards()
  parkSingletons()
  stageEl.replaceChildren()
  document.documentElement.setAttribute("data-layout", mode)
  stageEl.appendChild(FRAMES[mode]())
  currentMode = mode
  mountCards(mode)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function switchTo(mode: LayoutMode): Promise<void> {
  if (mode === currentMode || switching) return
  switching = true
  closeAllPopovers()

  if (prefersReducedMotion()) {
    build(mode)
    finishSwitch()
    return
  }

  stageEl.style.pointerEvents = "none"
  stageEl.classList.add("is-fading")
  await wait(FADE_MS)
  await wait(PAUSE_MS)

  build(mode)

  // Flush the swapped-in frame at opacity 0 so the fade-in actually transitions.
  void stageEl.offsetHeight
  stageEl.classList.remove("is-fading")
  await wait(FADE_MS)
  stageEl.style.pointerEvents = ""
  finishSwitch()
}

/** Picks up a mode chosen while a switch was already running. */
function finishSwitch(): void {
  switching = false
  const latest = getLayout()
  if (latest !== currentMode) void switchTo(latest)
}

/** Runs in the module body, before first paint, so the layout never flashes. */
export function applyLayout(): void {
  stageEl = document.getElementById("layout-stage")!
  parkingEl = document.getElementById("layout-parking")!
  build(getLayout())
}

export function subscribeLayout(): void {
  store.sync.subscribe("layout", (mode) => {
    void switchTo(mode)
  })
}
