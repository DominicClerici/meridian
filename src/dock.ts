/**
 * The dock — the row of shortcuts, in all three layouts.
 *
 * One element population, three presentations. `layout.ts` moves `#dock-wrapper`
 * between frames and this module reads the mode back to decide how the row
 * behaves: a magnifying glass shelf pinned to the bottom in Immersive, a bare
 * two-row block under the search bar in Default, a captioned three-row block in
 * the Dashboard column.
 *
 * The row is laid out here rather than by the browser. `relayout()` picks the
 * fewest rows that fit and assigns every tile an explicit grid cell, so the dock
 * only grows downward once it has to and only scrolls once even that isn't
 * enough. That also gives the drag engine and the fisheye a stable, predictable
 * geometry to work against — both of them displace tiles with transforms, which
 * would be meaningless if the browser were free to reflow the row underneath.
 */

import { store } from "./store"
import { closeAllPopovers, createPopover } from "./components"
import { getRecommendations } from "./recommendations"
import { renderIcon } from "./shortcut-icon"
import { normalizeUrl, urlHost } from "./url"
import { locate } from "./shortcuts"
import { initDockDrag, dockDragSuppressedClick } from "./dock-drag"
import { clearMagnify, initMagnify, refreshMagnify, suspendMagnify } from "./dock-magnify"
import { openDockMenu } from "./dock-menu"
import type { MenuHost } from "./dock-menu"
import type { LayoutMode } from "./defaults"
import type { Tab, Folder, TabItem } from "./shortcuts"

type ModeSpec = {
  /** Grid column width. Every tile is exactly this wide, in every row. */
  tile: number
  gap: number
  maxRows: number
  magnify: boolean
  /**
   * Slack at each end of the row for the fisheye to spread into. Without it the
   * tiles under the cursor push their neighbours past the scroller and the edge
   * fades cut in on a row that fits perfectly well at rest.
   */
  spread: number
  /**
   * Reading width for the row, or `null` to take whatever the frame gives.
   * Lives here rather than in the stylesheet because the layout pass has to
   * know it: `getComputedStyle` hands back a percentage max-width verbatim, so
   * a CSS cap can be read but not measured against.
   */
  maxWidth: (frame: number) => number | null
  /** Dashboard prints the name under the tile; the floating docks float it. */
  captions: boolean
}

const MODES: Record<LayoutMode, ModeSpec> = {
  immersive: {
    tile: 58, gap: 10, maxRows: 1, magnify: true, spread: 46, captions: false,
    maxWidth: () => Math.min(window.innerWidth * 0.86, 920),
  },
  default: {
    tile: 54, gap: 10, maxRows: 2, magnify: false, spread: 0, captions: false,
    maxWidth: () => 760,
  },
  dashboard: {
    tile: 68, gap: 8, maxRows: 3, magnify: false, spread: 0, captions: true,
    maxWidth: () => null,
  },
}

/** Width of `.dock-divider` plus the gap on either side of it. */
const DIVIDER_SPAN = 17
const SWAP_MS = 130
/** Long enough to cover layout.ts's fade-out and beat at 60fps, then give up. */
const MOVE_WAIT_FRAMES = 45

let wrapperEl: HTMLElement
let dockEl: HTMLElement
let scrollEl: HTMLElement
let groupsEl: HTMLElement
let suggestionsEl: HTMLElement
let dividerEl: HTMLElement
let itemsEl: HTMLElement
let tabsEl: HTMLElement
let indicatorEl: HTMLElement
let tipEl: HTMLElement

let activeTabId: string | null = null
let dragging = false
let swapping = false
let relayoutFrame = 0

function getTabs(): Tab[] {
  return store.local.get("shortcuts") ?? []
}

function save(tabs: Tab[]): void {
  store.local.set("shortcuts", tabs)
}

function mode(): LayoutMode {
  return store.sync.get("layout")
}

function spec(): ModeSpec {
  return MODES[mode()] ?? MODES.default
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Shortcuts saved before URLs were normalized still hold bare hostnames, which
 * `location.href` would resolve against the extension page. Normalizing here
 * covers them without a migration.
 */
function navigate(url: string, newTab?: boolean): void {
  const href = normalizeUrl(url)
  if (!href) return
  if (newTab || store.sync.get("shortcutsOpenIn") === "new") {
    window.open(href, "_blank", "noopener")
  } else {
    window.location.href = href
  }
}

function getActiveTabDomains(tab: Tab): Set<string> {
  const domains = new Set<string>()
  const add = (url: string) => {
    const host = urlHost(url)
    if (host) domains.add(host)
  }
  for (const item of tab.items) {
    if (item.type === "shortcut") add(item.url)
    else for (const child of item.children) add(child.url)
  }
  return domains
}

// ------------------------------------------------------------------ tooltip

/**
 * One tooltip, reused. It has to be a child of `<body>` rather than of the
 * tile: the scroller clips its overflow, and in the Immersive dock the tile it
 * belongs to is being scaled out from under it.
 */
function showTip(anchor: HTMLElement, text: string): void {
  if (spec().captions || dragging) return
  tipEl.textContent = text
  tipEl.dataset.show = "true"
  const r = anchor.getBoundingClientRect()
  const t = tipEl.getBoundingClientRect()
  const x = Math.min(
    Math.max(6, r.left + r.width / 2 - t.width / 2),
    window.innerWidth - t.width - 6
  )
  tipEl.style.left = `${x}px`
  tipEl.style.top = `${r.top - t.height - 10}px`
}

function hideTip(): void {
  tipEl.dataset.show = "false"
}

// -------------------------------------------------------------------- tiles

function itemIcon(item: TabItem): HTMLElement {
  return renderIcon(item.icon, {
    kind: item.type === "folder" ? "folder" : "shortcut",
    name: item.name,
    url: item.type === "shortcut" ? item.url : undefined,
  })
}

/**
 * A favicon is already a square logo on its own ground; a glyph or a monogram
 * is a mark that needs one. Publishing which of the three `renderIcon` produced
 * lets the stylesheet give only the second kind a plate — without it, folders
 * on the immersive shelf are outlines floating on the wallpaper.
 */
function mount(host: HTMLElement, icon: HTMLElement): void {
  host.dataset.icon = icon.classList.contains("sc-icon-img") ? "img" : "mark"
  host.appendChild(icon)
}

function tileShell(name: string): { btn: HTMLButtonElement; glyph: HTMLElement } {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "dock-item"
  btn.setAttribute("aria-label", name)

  const glyph = document.createElement("span")
  glyph.className = "dock-item-glyph"
  btn.appendChild(glyph)

  const label = document.createElement("span")
  label.className = "dock-item-name"
  label.textContent = name
  btn.appendChild(label)

  btn.addEventListener("mouseenter", () => showTip(btn, name))
  btn.addEventListener("mouseleave", hideTip)
  btn.addEventListener("focus", () => showTip(btn, name))
  btn.addEventListener("blur", hideTip)

  return { btn, glyph }
}

function createDockItem(item: TabItem): HTMLElement {
  const { btn, glyph } = tileShell(item.name)
  btn.dataset.dockId = item.id
  btn.dataset.kind = item.type
  mount(glyph, itemIcon(item))

  btn.addEventListener("click", () => {
    // A drag ends in a click on the tile it started from. Letting that through
    // would navigate every time a shortcut was reordered.
    if (dockDragSuppressedClick()) return
    hideTip()
    if (item.type === "shortcut") navigate(item.url)
    else openFolderPopover(btn, item)
  })

  btn.addEventListener("auxclick", (e) => {
    if (e.button !== 1 || item.type !== "shortcut") return
    e.preventDefault()
    hideTip()
    navigate(item.url, true)
  })
  // Middle-click otherwise starts the browser's autoscroll cursor.
  btn.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault()
  })

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    hideTip()
    // A right-click is not an outside click, so a folder popover opened from a
    // neighbouring tile would otherwise stay up behind the menu.
    closeAllPopovers()
    openDockMenu(menuHost, btn, item)
  })

  return btn
}

function createSuggestionItem(rec: { name: string; url: string }): HTMLElement {
  const { btn, glyph } = tileShell(rec.name)
  btn.classList.add("dock-suggestion")
  mount(glyph, renderIcon({ type: "favicon" }, { kind: "shortcut", name: rec.name, url: rec.url }))
  btn.addEventListener("click", () => {
    hideTip()
    navigate(rec.url)
  })
  btn.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return
    e.preventDefault()
    navigate(rec.url, true)
  })
  return btn
}

// ------------------------------------------------------------------ folders

function openFolderPopover(anchor: HTMLElement, folder: Folder): void {
  hideTip()
  closeAllPopovers()

  const content = document.createElement("div")
  content.className = "dock-folder"
  let closePopover: (() => void) | null = null

  const header = document.createElement("div")
  header.className = "dock-folder-head"
  header.appendChild(
    renderIcon(folder.icon, { kind: "folder", name: folder.name }, { size: 16 })
  )
  const headerName = document.createElement("span")
  headerName.className = "dock-folder-title"
  headerName.textContent = folder.name
  header.appendChild(headerName)
  const count = document.createElement("span")
  count.className = "dock-folder-count"
  count.textContent = String(folder.children.length)
  header.appendChild(count)
  content.appendChild(header)

  const grid = document.createElement("div")
  grid.className = "dock-folder-grid"

  if (folder.children.length === 0) {
    const empty = document.createElement("div")
    empty.className = "dock-folder-empty"
    empty.textContent = "Nothing in here yet"
    grid.appendChild(empty)
  } else {
    for (const child of folder.children) {
      const item = document.createElement("button")
      item.type = "button"
      item.className = "dock-folder-item"

      const tile = document.createElement("span")
      tile.className = "dock-folder-item-glyph"
      tile.appendChild(
        renderIcon(child.icon, { kind: "shortcut", name: child.name, url: child.url }, { size: 26 })
      )
      item.appendChild(tile)

      const name = document.createElement("span")
      name.className = "dock-folder-item-name"
      name.textContent = child.name
      item.appendChild(name)

      item.addEventListener("click", (e) => {
        e.stopPropagation()
        navigate(child.url)
        closePopover?.()
      })
      item.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return
        e.preventDefault()
        e.stopPropagation()
        navigate(child.url, true)
      })

      grid.appendChild(item)
    }
  }

  content.appendChild(grid)

  const { close } = createPopover(anchor, content, { modal: true, position: "above-center" })
  closePopover = close
}

// --------------------------------------------------------------------- tabs

function renderTabs(tabs: Tab[]): void {
  for (const stale of tabsEl.querySelectorAll("[data-dock-tab]")) stale.remove()

  if (tabs.length < 2) {
    tabsEl.hidden = true
    indicatorEl.hidden = true
    return
  }
  tabsEl.hidden = false

  const from = tabs.findIndex((t) => t.id === activeTabId)
  for (const [index, t] of tabs.entries()) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "dock-tab-btn"
    btn.dataset.dockTab = t.id
    if (t.icon) {
      btn.appendChild(renderIcon(t.icon, { kind: "tab", name: t.name }, { size: 12 }))
    }
    const label = document.createElement("span")
    label.textContent = t.name
    btn.appendChild(label)
    btn.setAttribute("aria-selected", String(t.id === activeTabId))
    btn.addEventListener("click", () => selectTab(t.id, index > from ? 1 : -1))
    tabsEl.appendChild(btn)
  }

  moveIndicator()
}

/**
 * The active pill's underline is one element that slides, rather than a border
 * on each pill — that is the whole reason switching tabs reads as one movement
 * instead of two independent state changes.
 */
function moveIndicator(): void {
  const active = tabsEl.querySelector<HTMLElement>('[aria-selected="true"]')
  if (!active) {
    indicatorEl.hidden = true
    return
  }
  indicatorEl.hidden = false
  indicatorEl.style.width = `${active.offsetWidth}px`
  indicatorEl.style.transform = `translateX(${active.offsetLeft}px)`
}

function selectTab(id: string, direction: 1 | -1): void {
  if (id === activeTabId || swapping) return

  if (reducedMotion()) {
    activeTabId = id
    render()
    return
  }

  swapping = true
  groupsEl.classList.add(direction > 0 ? "is-out-left" : "is-out-right")
  activeTabId = id
  // The pills and their indicator move immediately; only the icons wait, so the
  // press is acknowledged on the frame it happens.
  for (const pill of tabsEl.querySelectorAll<HTMLElement>("[data-dock-tab]")) {
    pill.setAttribute("aria-selected", String(pill.dataset.dockTab === id))
  }
  moveIndicator()

  window.setTimeout(() => {
    groupsEl.classList.remove("is-out-left", "is-out-right")
    render()
    groupsEl.classList.add(direction > 0 ? "is-in-right" : "is-in-left")
    window.setTimeout(() => {
      groupsEl.classList.remove("is-in-right", "is-in-left")
      swapping = false
    }, SWAP_MS * 2)
  }, SWAP_MS)
}

// ------------------------------------------------------------------- layout

/**
 * Assigns explicit grid cells, fewest rows first.
 *
 * The row count is chosen for the two groups together, so the suggestions and
 * the shortcuts always sit on the same number of rows and the divider between
 * them spans the full height. Once even `maxRows` can't hold everything the
 * dock stops growing and starts scrolling.
 */
function relayout(): void {
  if (wrapperEl.hidden) return

  const s = spec()
  dockEl.style.setProperty("--dock-tile", `${s.tile}px`)
  dockEl.style.setProperty("--dock-gap", `${s.gap}px`)
  dockEl.style.setProperty("--dock-spread", `${s.spread}px`)

  const nSug = suggestionsEl.hidden ? 0 : suggestionsEl.childElementCount
  const nItems = itemsEl.childElementCount
  const width = availableWidth(s)
  dockEl.style.maxWidth = `${width}px`
  const available = width - s.spread * 2

  let rows = s.maxRows
  for (let r = 1; r <= s.maxRows; r++) {
    const cols = Math.ceil(nSug / r) + Math.ceil(nItems / r)
    const width =
      cols * s.tile + Math.max(0, cols - 1) * s.gap + (nSug > 0 ? DIVIDER_SPAN : 0)
    if (width <= available) {
      rows = r
      break
    }
  }

  placeGroup(suggestionsEl, rows)
  placeGroup(itemsEl, rows)
  updateFades()

  if (s.magnify) refreshMagnify(magnifyCells())
  else clearMagnify()
}

/**
 * How wide the row is allowed to get.
 *
 * Measured from the frame that holds the dock, never from the dock itself: the
 * dock is shrink-to-fit, so its own width is a result of the last layout pass
 * and reading it back would let one wrapped row keep the next pass wrapped.
 */
function availableWidth(s: ModeSpec): number {
  const frame = wrapperEl.parentElement?.clientWidth || window.innerWidth
  const cap = s.maxWidth(frame)
  return cap === null ? frame : Math.min(frame, cap)
}

function placeGroup(host: HTMLElement, rows: number): void {
  const count = host.childElementCount
  const cols = Math.max(1, Math.ceil(count / rows))
  host.style.gridTemplateRows = `repeat(${rows}, auto)`
  host.style.gridTemplateColumns = `repeat(${cols}, var(--dock-tile))`
  for (let i = 0; i < count; i++) {
    const child = host.children[i] as HTMLElement
    child.style.gridRow = String(Math.floor(i / cols) + 1)
    child.style.gridColumn = String((i % cols) + 1)
  }
}

function magnifyCells(): { el: HTMLElement; scalable: boolean }[] {
  const cells: { el: HTMLElement; scalable: boolean }[] = []
  for (const el of suggestionsEl.children) cells.push({ el: el as HTMLElement, scalable: true })
  if (!dividerEl.hidden) cells.push({ el: dividerEl, scalable: false })
  for (const el of itemsEl.children) cells.push({ el: el as HTMLElement, scalable: true })
  return cells
}

/** The only cue that the row is cut off, so it has to track scroll position. */
function updateFades(): void {
  const overflow = scrollEl.scrollWidth - scrollEl.clientWidth
  if (overflow <= 1) {
    delete dockEl.dataset.fade
    return
  }
  const left = scrollEl.scrollLeft > 2
  const right = scrollEl.scrollLeft < overflow - 2
  dockEl.dataset.fade = left && right ? "both" : left ? "left" : right ? "right" : "none"
}

function scheduleRelayout(): void {
  if (relayoutFrame) return
  relayoutFrame = requestAnimationFrame(() => {
    relayoutFrame = 0
    relayout()
    moveIndicator()
  })
}

// ------------------------------------------------------------------- render

function render(): void {
  hideTip()
  const tabs = getTabs()

  if (tabs.length === 0) {
    wrapperEl.hidden = true
    clearMagnify()
    return
  }
  wrapperEl.hidden = false

  if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id
  }
  const tab = tabs.find((t) => t.id === activeTabId)!

  renderTabs(tabs)

  suggestionsEl.replaceChildren()
  const recs = getRecommendations(getActiveTabDomains(tab))
  const hasRecs = recs.length > 0
  suggestionsEl.hidden = !hasRecs
  dividerEl.hidden = !hasRecs
  for (const rec of recs) suggestionsEl.appendChild(createSuggestionItem(rec))

  itemsEl.replaceChildren()
  for (const item of tab.items) itemsEl.appendChild(createDockItem(item))

  relayout()
}

// --------------------------------------------------------------------- host

const menuHost: MenuHost = {
  getTabs,
  save,
  getActiveTabId: () => activeTabId,
  navigate: (url, newTab) => navigate(url, newTab),
  openFolder: (anchor, id) => {
    const found = locate(getTabs(), id)
    if (found?.item.type === "folder") openFolderPopover(anchor, found.item)
  },
}

export function initDock(): void {
  wrapperEl = document.getElementById("dock-wrapper")!
  dockEl = document.getElementById("dock")!
  scrollEl = document.getElementById("dock-scroll")!
  groupsEl = document.getElementById("dock-groups")!
  suggestionsEl = document.getElementById("dock-suggestions")!
  dividerEl = document.getElementById("dock-divider")!
  itemsEl = document.getElementById("dock-items")!
  tabsEl = document.getElementById("dock-tabs")!
  indicatorEl = document.getElementById("dock-tabs-indicator")!

  tipEl = document.createElement("span")
  tipEl.className = "dock-tip"
  tipEl.dataset.show = "false"
  document.body.appendChild(tipEl)

  render()

  initMagnify(scrollEl, groupsEl)
  initDockDrag({
    itemsEl,
    tabsEl,
    getTabs,
    save,
    getActiveTabId: () => activeTabId,
    setDragging: (on) => {
      dragging = on
      suspendMagnify(on)
      if (on) hideTip()
    },
  })

  scrollEl.addEventListener("scroll", updateFades, { passive: true })
  new ResizeObserver(scheduleRelayout).observe(scrollEl)
  window.addEventListener("resize", scheduleRelayout)
  // The Dashboard's column and the Default frame's head both change width
  // without the window doing so — a card appearing beside them is enough.
  new ResizeObserver(scheduleRelayout).observe(document.documentElement)

  store.local.subscribe("shortcuts", () => render())
  store.sync.subscribe("recommendationsEnabled", () => render())
  store.sync.subscribe("layout", onLayoutChange)
}

/**
 * A layout switch moves the wrapper into a frame of a different width and
 * changes every size token the row is measured against — but `layout.ts` fades
 * out, waits, and only then rebuilds the frame, so the store notification
 * arrives while the dock is still in the old one. Wait for the move rather than
 * relayouting against a frame that is about to be discarded.
 */
function onLayoutChange(): void {
  hideTip()
  const before = wrapperEl.parentElement
  let frames = 0
  const wait = (): void => {
    if (wrapperEl.parentElement !== before || frames++ > MOVE_WAIT_FRAMES) {
      scheduleRelayout()
      return
    }
    requestAnimationFrame(wait)
  }
  wait()
}
