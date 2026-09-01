import { store } from "./store"
import type { LayoutMode, SyncSettings } from "./defaults"
import { createCard, closeAllPopovers } from "./components"
import { createCardGrid } from "./card-grid"
import type { CardGrid, GridItem } from "./card-grid"
import { createCardCarousel } from "./card-carousel"
import type { CardCarousel, CarouselItem } from "./card-carousel"

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
  /** Title that tracks the card's state — falls back to the static `title`. */
  cardTitle?: () => string
  render: () => HTMLElement
  /**
   * Compact form for tile regions (the Dashboard's top row), where a card is a
   * fixed-height glance rather than a full panel. Falls back to `render`.
   */
  renderTile?: () => HTMLElement
  /** Header text for the tile form, when the card title is too generic for a
      glance — the weather tile names its city, the way the mock does. */
  tileTitle?: () => string
  actions?: () => HTMLElement | null
  onUnmount?: () => void
}

const FADE_MS = 250
const PAUSE_MS = 100

/** Where the settings button sits in every layout but the Dashboard. */
const CORNER_SETTINGS = "absolute top-4 left-4 z-40 w-12 h-12 justify-center"

const SINGLETONS = {
  widgets: "widgets",
  clock: "clock",
  worldClocks: "world-clocks",
  search: "search-wrapper",
  dock: "dock-wrapper",
  settings: "settings-open",
} as const

export type SlotName = keyof typeof SINGLETONS

type Mounted = { host: HTMLElement; title: HTMLElement | null; tile: boolean }

const cards: CardDef[] = []
const mountedBodies = new Map<string, Mounted>()
const baseClasses = new Map<SlotName, string>()

let stageEl: HTMLElement
let parkingEl: HTMLElement
let currentMode: LayoutMode | null = null
let switching = false
let cardGrids: CardGrid[] = []
let cardCarousels: CardCarousel[] = []
let packedGrid: CardGrid | null = null

export function getLayout(): LayoutMode {
  return store.sync.get("layout")
}

const enabledSubs = new Map<string, () => void>()
let batchDepth = 0

export function registerCard(def: CardDef): void {
  cards.push(def)
  if (def.enabledKey) {
    enabledSubs.set(def.id, store.sync.subscribe(def.enabledKey, () => refreshCards()))
  }
  if (currentMode && batchDepth === 0) refreshCards()
}

/**
 * Drops a card registered at runtime. Cards that exist for the life of the page
 * never call this; the world clocks do, because the user adds and removes them.
 */
export function unregisterCard(id: string): void {
  const index = cards.findIndex((c) => c.id === id)
  if (index === -1) return
  cards.splice(index, 1)
  enabledSubs.get(id)?.()
  enabledSubs.delete(id)
  if (currentMode && batchDepth === 0) refreshCards()
}

/**
 * Runs a set of register/unregister calls as one change. Without it, replacing
 * five world clocks would rebuild every card on the page ten times.
 */
export function batchCards(fn: () => void): void {
  batchDepth++
  try {
    fn()
  } finally {
    batchDepth--
  }
  if (currentMode) refreshCards()
}

function cardVisible(def: CardDef): boolean {
  if (def.enabledKey && !store.sync.get(def.enabledKey)) return false
  return def.isEnabled ? def.isEnabled() : true
}

/** Re-renders one card's body if it is mounted in the current layout. */
export function refreshCard(id: string): void {
  const mounted = mountedBodies.get(id)
  if (!mounted) return
  const def = cards.find((c) => c.id === id)
  if (!def) return
  reclaimSingletons(mounted.host)
  mounted.host.replaceChildren(renderFor(def, mounted.tile))
  if (mounted.title) mounted.title.textContent = titleFor(def, mounted.tile)
}

function titleFor(def: CardDef, tile: boolean): string {
  if (tile && def.tileTitle) return def.tileTitle()
  return def.cardTitle?.() ?? def.title
}

function titleEl(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>(".widget-card-title")
}

function renderFor(def: CardDef, tile: boolean): HTMLElement {
  return tile && def.renderTile ? def.renderTile() : def.render()
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

  root.appendChild(slot("settings", CORNER_SETTINGS))

  const widgets = el("div", "absolute top-4 right-4")
  widgets.appendChild(slot("widgets"))
  root.appendChild(widgets)

  // Same trick as the dashboard's `.dash-aligner`: centring inside a box that
  // spans the top 4/5 of the stage puts the block's midpoint at 2/5 of the
  // viewport height, with no measuring.
  const center = el(
    "div",
    "absolute inset-x-0 top-0 bottom-[20%] flex items-center justify-center pointer-events-none"
  )
  // Wider than the search bar so a full set of world clocks stays on one line;
  // the search bar keeps its own cap and is centred inside it.
  const col = el(
    "div",
    "w-full max-w-3xl flex flex-col items-center pointer-events-auto"
  )
  col.appendChild(slot("clock", "text-center mb-4"))
  col.appendChild(slot("worldClocks", "justify-center mb-5"))
  col.appendChild(slot("search", "max-w-lg"))
  center.appendChild(col)
  root.appendChild(center)

  const dockRow = el(
    "div",
    "absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none"
  )
  dockRow.appendChild(slot("dock", "items-center"))
  root.appendChild(dockRow)

  return root
}

function frameDefault(): HTMLElement {
  const root = el("div", "absolute inset-0")

  const scroll = el("div", "absolute inset-0 overflow-y-auto px-6 pt-[10vh] pb-16")

  // The head stays at reading width while the card region gets its own, wider
  // cap — four columns need room the search bar has no use for.
  // The clock and its world clocks are one block, so they sit in a tighter
  // nested column than the gap the search bar wants below them.
  const head = el("div", "mx-auto w-full max-w-5xl flex flex-col items-center gap-8")
  head.dataset.editDim = "true"
  const timeBlock = el("div", "flex flex-col items-center gap-4")
  timeBlock.appendChild(slot("clock", "text-center"))
  timeBlock.appendChild(slot("worldClocks", "justify-center"))
  head.appendChild(timeBlock)

  // The search bar and the dock are one block: the dock hangs off the bar with
  // a tighter gap than the one separating the pair from the clock above.
  const searchBlock = el("div", "w-full flex flex-col items-center gap-5")
  searchBlock.appendChild(slot("search", "max-w-lg"))
  searchBlock.appendChild(slot("dock", "items-center"))
  head.appendChild(searchBlock)
  scroll.appendChild(head)

  const gridWrap = el("div", "mx-auto w-full max-w-[1600px] mt-8")
  const grid = region("grid", "relative w-full")
  grid.dataset.packed = "true"
  gridWrap.appendChild(grid)
  scroll.appendChild(gridWrap)

  root.appendChild(scroll)

  root.appendChild(slot("settings", CORNER_SETTINGS))

  return root
}

/**
 * The Dashboard.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ tile  tile  tile                             │   region "top"
 *   ├───────────────────────────────┬──────────────┤
 *   │ clock                         │              │
 *   │ search                        │   carousel   │   region "side"
 *   │ shortcuts                     │              │
 *   │ ⋯                             │   ‹  ●∘  ›   │
 *   │ settings          region main │              │
 *   └───────────────────────────────┴──────────────┘
 *
 * The two halves of the lower row stretch to a common height, which is what
 * puts the settings button on the carousel's bottom edge without either side
 * knowing the other's size.
 *
 * `.dash-aligner` is what sits the whole block high on the page rather than
 * flush to the top — see the rule in styles.css.
 */
function frameDashboard(): HTMLElement {
  const root = el("div", "absolute inset-0 overflow-y-auto")
  const aligner = el("div", "dash-aligner")
  const wrap = el("div", "mx-auto w-full max-w-7xl p-8 flex flex-col gap-8")

  const top = region("top", "flex flex-wrap items-stretch gap-3")
  top.dataset.variant = "tile"
  wrap.appendChild(top)

  const lower = el("div", "dash-lower")

  const main = el("div", "flex flex-col items-start gap-7 min-w-0")
  main.appendChild(slot("clock", "text-left"))
  main.appendChild(slot("search", "max-w-xl"))
  main.appendChild(slot("dock", "items-start"))
  main.appendChild(region("main", "w-full flex flex-col gap-4"))

  // Pinned to the bottom of the column rather than trailing the content above,
  // so it lines up with the foot of the carousel at any content height.
  main.appendChild(slot("settings", "mt-auto"))
  lower.appendChild(main)

  const side = region("side", "min-w-0")
  side.dataset.carousel = "true"
  lower.appendChild(side)

  wrap.appendChild(lower)
  aligner.appendChild(wrap)
  root.appendChild(aligner)
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
  for (const grid of cardGrids) grid.destroy()
  cardGrids = []
  packedGrid = null
  for (const carousel of cardCarousels) carousel.destroy()
  cardCarousels = []
  for (const id of mountedBodies.keys()) {
    cards.find((c) => c.id === id)?.onUnmount?.()
  }
  mountedBodies.clear()
  // Scoped to the cards, not the whole stage: refreshCards() rebuilds cards
  // without rebuilding the frame, and a frame-owned singleton parked here would
  // never be placed again.
  for (const node of stageEl.querySelectorAll<HTMLElement>("[data-card]")) {
    reclaimSingletons(node)
    node.remove()
  }
}

/**
 * Sorts the packed region's cards into the user's arrangement. Anything the
 * stored list doesn't name — a widget added since the last rearrange — keeps
 * its registration order and follows the cards that were placed by hand.
 */
function sortIdsByCardOrder(ids: string[]): string[] {
  const rank = new Map(store.sync.get("cardOrder").map((id, i) => [id, i] as const))
  const unplaced = Number.MAX_SAFE_INTEGER
  return [...ids].sort(
    (a, b) => (rank.get(a) ?? unplaced) - (rank.get(b) ?? unplaced)
  )
}

function applyCardOrder(items: GridItem[]): GridItem[] {
  const byId = new Map(items.map((item) => [item.id, item] as const))
  return sortIdsByCardOrder(items.map((item) => item.id)).map((id) => byId.get(id)!)
}

/** The Default layout's packed grid, for the rearrange mode. */
export function getPackedGrid(): CardGrid | null {
  return packedGrid
}

export function saveCardOrder(order: string[]): void {
  store.sync.set("cardOrder", order)
}

function mountCards(mode: LayoutMode): void {
  const ordered = [...cards].sort((a, b) => a.order - b.order)
  const packed = new Map<HTMLElement, GridItem[]>()
  const carouselled = new Map<HTMLElement, CarouselItem[]>()

  for (const def of ordered) {
    const target = def.regions[mode]
    if (!target) continue
    const host = stageEl.querySelector<HTMLElement>(`[data-region="${target}"]`)
    if (!host) continue
    if (!cardVisible(def)) continue

    const tile = host.dataset.variant === "tile"
    const body = renderFor(def, tile)
    const card = createCard({
      title: titleFor(def, tile),
      actions: def.actions?.() ?? null,
      body,
    })
    card.el.dataset.card = def.id
    if (tile) card.el.classList.add("widget-tile")
    const span = def.span?.[mode] ?? 1

    mountedBodies.set(def.id, { host: card.body, title: titleEl(card.el), tile })

    if (host.dataset.packed) {
      const items = packed.get(host) ?? []
      items.push({ id: def.id, el: card.el, span })
      packed.set(host, items)
      host.appendChild(card.el)
    } else if (host.dataset.carousel) {
      // The carousel owns placement: setItems() appends into its own viewport.
      const items = carouselled.get(host) ?? []
      items.push({ id: def.id, title: titleFor(def, tile), el: card.el })
      carouselled.set(host, items)
    } else {
      const spanClass = SPAN_CLASSES[span]
      if (spanClass) card.el.classList.add(spanClass)
      host.appendChild(card.el)
    }
  }

  for (const [host, items] of packed) {
    const grid = createCardGrid(host)
    grid.setItems(applyCardOrder(items))
    cardGrids.push(grid)
    packedGrid = grid
  }

  for (const host of stageEl.querySelectorAll<HTMLElement>("[data-carousel]")) {
    const carousel = createCardCarousel(host, {
      initialId: store.local.get("dashboardWidget"),
      onChange: (id) => store.local.set("dashboardWidget", id),
    })
    carousel.setItems(carouselled.get(host) ?? [])
    cardCarousels.push(carousel)
  }

  // A region with nothing in it would still take a gap from its parent flexbox.
  for (const host of stageEl.querySelectorAll<HTMLElement>("[data-region]")) {
    if (host.dataset.packed || host.dataset.carousel) continue
    host.hidden = host.childElementCount === 0
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
  // Fires for our own save too, so compare before rebuilding — a rearrange that
  // just committed is already on screen, and only another tab needs the remount.
  store.sync.subscribe("cardOrder", () => {
    const current = packedGrid?.getOrder()
    if (!current) return
    if (sortIdsByCardOrder(current).join() !== current.join()) refreshCards()
  })
}
