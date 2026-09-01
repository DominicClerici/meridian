/**
 * World clocks — extra timezones shown alongside the main clock.
 *
 * Two hosts, from one data list (`store.sync.worldClocks`):
 *  - Default and Immersive get the `#world-clocks` singleton row, a strip of
 *    compact chips under the main clock. Immersive drops the chip backgrounds.
 *  - Dashboard gets one tile per clock in the top row, registered and torn down
 *    with the list.
 *
 * See `docs/world-clocks.md`.
 */

import { store } from "./store"
import type { WorldClock } from "./defaults"
import { batchCards, getLayout, registerCard, unregisterCard } from "./layout"
import {
  dayOffset,
  dayOffsetLabel,
  dayOffsetMarker,
  displayTime,
  isDaytime,
  isValidTimezone,
  relativeOffsetLabel,
  relativeOffsetMinutes,
  shortOffsetLabel,
  utcOffsetLabel,
  zoneDateLabel,
  zoneInfo,
  zoneOffsetMinutes,
  zoneTime,
} from "./timezones"
import type { ZoneTime } from "./timezones"

const CARD_PREFIX = "world-clock:"
const HOVER_DELAY_MS = 90

/* ── The shared tick ────────────────────────────────────────────────────── */

type Ticker = (now: Date) => void

const tickers = new Set<Ticker>()
let tickTimer: ReturnType<typeof setTimeout> | null = null

/**
 * One timer for every clock on the page, re-aimed at the next second boundary
 * after each run so the readings never drift within their tick — unlike the
 * main clock's plain 1000ms interval.
 */
function scheduleTick(): void {
  if (tickTimer !== null || tickers.size === 0) return
  if (document.hidden) return
  const delay = 1000 - (Date.now() % 1000)
  tickTimer = setTimeout(() => {
    tickTimer = null
    const now = new Date()
    for (const ticker of [...tickers]) ticker(now)
    scheduleTick()
  }, delay)
}

function stopTick(): void {
  if (tickTimer === null) return
  clearTimeout(tickTimer)
  tickTimer = null
}

/**
 * Registers a per-second callback that unregisters itself once `owner` leaves
 * the document. Every host here is rebuilt by something it doesn't control —
 * a layout switch, `refreshCards()`, a settings re-render — so tying the
 * subscription's life to the node's is the only teardown that can't be missed.
 */
export function onTick(owner: HTMLElement, run: (now: Date) => void): void {
  const ticker: Ticker = (now) => {
    if (!owner.isConnected) {
      tickers.delete(ticker)
      if (tickers.size === 0) stopTick()
      return
    }
    run(now)
  }
  tickers.add(ticker)
  scheduleTick()
  run(new Date())
}

/** `onTick` under the name the settings dialog imports it by. */
export const onSettingsTick = onTick

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTick()
    return
  }
  // Catch up before the next boundary — a tab hidden for an hour would
  // otherwise show the time it was hidden at for up to a second.
  const now = new Date()
  for (const ticker of [...tickers]) ticker(now)
  scheduleTick()
})

/* ── Data ───────────────────────────────────────────────────────────────── */

export function getWorldClocks(): WorldClock[] {
  return store.sync.get("worldClocks").filter((c) => isValidTimezone(c.timezone))
}

function formatOpts(): { hour24: boolean; seconds: boolean } {
  return {
    hour24: store.sync.get("clock24Hour"),
    seconds: store.sync.get("clockShowSeconds"),
  }
}

/* ── The analog face ────────────────────────────────────────────────────── */

const SVG_NS = "http://www.w3.org/2000/svg"

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value))
  }
  return node
}

type ClockFace = { el: SVGSVGElement; update: (t: ZoneTime) => void }

/**
 * A dial that reads the same time the digits do. Hands are placed by attribute
 * on each tick with no CSS transition: interpolating them would spin the hand
 * the long way round every time it crosses twelve.
 */
function createClockFace(size: number): ClockFace {
  const svg = svgEl("svg", { viewBox: "0 0 100 100", width: size, height: size })
  svg.classList.add("wc-face")
  svg.setAttribute("aria-hidden", "true")

  svg.appendChild(svgEl("circle", { cx: 50, cy: 50, r: 46, class: "wc-face-rim" }))

  for (let i = 0; i < 12; i++) {
    const major = i % 3 === 0
    const angle = (i * 30 * Math.PI) / 180
    const outer = 40
    const inner = major ? 32 : 36
    svg.appendChild(
      svgEl("line", {
        x1: 50 + Math.sin(angle) * inner,
        y1: 50 - Math.cos(angle) * inner,
        x2: 50 + Math.sin(angle) * outer,
        y2: 50 - Math.cos(angle) * outer,
        class: major ? "wc-tick wc-tick-major" : "wc-tick",
      })
    )
  }

  const hour = svgEl("line", { x1: 50, y1: 50, x2: 50, y2: 26, class: "wc-hand wc-hand-hour" })
  const minute = svgEl("line", { x1: 50, y1: 50, x2: 50, y2: 14, class: "wc-hand wc-hand-minute" })
  const second = svgEl("line", { x1: 50, y1: 56, x2: 50, y2: 12, class: "wc-hand wc-hand-second" })
  svg.append(hour, minute, second)
  svg.appendChild(svgEl("circle", { cx: 50, cy: 50, r: 3, class: "wc-face-pin" }))

  function update(t: ZoneTime): void {
    // Continuous, not stepped: the hour hand should sit between numerals at
    // half past, the way a real one does.
    const hourAngle = ((t.hour % 12) + t.minute / 60 + t.second / 3600) * 30
    const minuteAngle = (t.minute + t.second / 60) * 6
    hour.setAttribute("transform", `rotate(${hourAngle} 50 50)`)
    minute.setAttribute("transform", `rotate(${minuteAngle} 50 50)`)
    second.setAttribute("transform", `rotate(${t.second * 6} 50 50)`)
    svg.dataset.daylight = String(isDaytime(t))
  }

  return { el: svg, update }
}

/* ── A time readout ─────────────────────────────────────────────────────── */

type Readout = { el: HTMLElement; update: (t: ZoneTime) => void }

function createReadout(className: string): Readout {
  const el = document.createElement("div")
  el.className = className

  const digits = document.createElement("span")
  const meridiem = document.createElement("span")
  meridiem.className = "wc-meridiem"
  el.append(digits, meridiem)

  function update(t: ZoneTime): void {
    const { time, meridiem: suffix } = displayTime(t, formatOpts())
    digits.textContent = time
    meridiem.textContent = suffix
    meridiem.hidden = !suffix
  }

  return { el, update }
}

/* ── The hover card ─────────────────────────────────────────────────────── */

let openHoverCard: { el: HTMLElement; chip: HTMLElement; close: () => void } | null = null

function closeHoverCard(): void {
  openHoverCard?.close()
}

function buildHoverCard(clock: WorldClock): HTMLElement {
  const zone = zoneInfo(clock.timezone)

  const card = document.createElement("div")
  card.className = "world-clock-hovercard glass-surface"
  card.setAttribute("role", "tooltip")

  const top = document.createElement("div")
  top.className = "wc-hover-top"

  const face = createClockFace(64)
  top.appendChild(face.el)

  const stack = document.createElement("div")
  stack.className = "wc-hover-stack"
  const readout = createReadout("wc-hover-time")
  const dateLine = document.createElement("div")
  dateLine.className = "wc-hover-date"
  stack.append(readout.el, dateLine)
  top.appendChild(stack)
  card.appendChild(top)

  const rule = document.createElement("div")
  rule.className = "wc-hover-rule"
  card.appendChild(rule)

  const place = document.createElement("div")
  place.className = "wc-hover-place"
  place.textContent = clock.label
  card.appendChild(place)

  const zoneLine = document.createElement("div")
  zoneLine.className = "wc-hover-zone"
  card.appendChild(zoneLine)

  const relative = document.createElement("div")
  relative.className = "wc-hover-relative"
  card.appendChild(relative)

  onTick(card, (now) => {
    const t = zoneTime(clock.timezone, now)
    face.update(t)
    readout.update(t)

    dateLine.textContent = zoneDateLabel(clock.timezone, now)

    const utc = utcOffsetLabel(zoneOffsetMinutes(clock.timezone, now))
    // The label is the user's own text, so the city it stands for is worth
    // naming here even when they match.
    zoneLine.textContent =
      zone.city === clock.label
        ? `${clock.timezone} · ${utc}`
        : `${zone.city} · ${clock.timezone} · ${utc}`

    relative.textContent = relativeOffsetLabel(
      relativeOffsetMinutes(clock.timezone, now)
    )
  })

  return card
}

/** Places the card centred over the chip, flipping below if the top is tight. */
function positionHoverCard(card: HTMLElement, chip: HTMLElement): void {
  const anchor = chip.getBoundingClientRect()
  const box = card.getBoundingClientRect()
  const margin = 8

  let top = anchor.top - box.height - 10
  card.dataset.placement = "above"
  if (top < margin) {
    top = anchor.bottom + 10
    card.dataset.placement = "below"
  }

  let left = anchor.left + anchor.width / 2 - box.width / 2
  left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin))

  card.style.top = `${top}px`
  card.style.left = `${left}px`
}

function showHoverCard(chip: HTMLElement, clock: WorldClock): void {
  if (openHoverCard?.chip === chip) return
  closeHoverCard()

  const card = buildHoverCard(clock)
  document.body.appendChild(card)
  positionHoverCard(card, chip)
  // Measured at its natural size first, then released into the entry animation.
  requestAnimationFrame(() => card.classList.add("is-visible"))

  chip.setAttribute("aria-describedby", "world-clock-hovercard")
  card.id = "world-clock-hovercard"

  openHoverCard = {
    el: card,
    chip,
    close: () => {
      openHoverCard = null
      chip.removeAttribute("aria-describedby")
      card.classList.remove("is-visible")
      card.addEventListener("transitionend", () => card.remove(), { once: true })
      // A card that never gets a transition (reduced motion) still has to go.
      setTimeout(() => card.remove(), 300)
    },
  }
}

/* ── The compact chip row ───────────────────────────────────────────────── */

function buildChip(clock: WorldClock): HTMLElement {
  const chip = document.createElement("button")
  chip.type = "button"
  chip.className = "world-clock-chip"
  chip.dataset.clockId = clock.id

  const head = document.createElement("div")
  head.className = "wc-chip-head"

  const label = document.createElement("span")
  label.className = "wc-chip-label"
  label.textContent = clock.label

  const offset = document.createElement("span")
  offset.className = "wc-chip-offset"
  head.append(label, offset)

  const readout = createReadout("wc-chip-time")

  const marker = document.createElement("span")
  marker.className = "wc-chip-day"
  readout.el.appendChild(marker)

  chip.append(head, readout.el)

  onTick(chip, (now) => {
    const t = zoneTime(clock.timezone, now)
    readout.update(t)
    offset.textContent = shortOffsetLabel(relativeOffsetMinutes(clock.timezone, now))

    const day = dayOffsetMarker(dayOffset(clock.timezone, now))
    marker.textContent = day ?? ""
    marker.hidden = day === null

    const { time, meridiem } = displayTime(t, formatOpts())
    chip.setAttribute(
      "aria-label",
      `${clock.label}, ${time}${meridiem ? ` ${meridiem}` : ""}`
    )
  })

  let hoverTimer: ReturnType<typeof setTimeout> | null = null
  const cancelHover = (): void => {
    if (hoverTimer !== null) clearTimeout(hoverTimer)
    hoverTimer = null
  }

  chip.addEventListener("pointerenter", () => {
    cancelHover()
    hoverTimer = setTimeout(() => showHoverCard(chip, clock), HOVER_DELAY_MS)
  })
  chip.addEventListener("pointerleave", () => {
    cancelHover()
    if (openHoverCard?.chip === chip) closeHoverCard()
  })
  chip.addEventListener("focus", () => showHoverCard(chip, clock))
  chip.addEventListener("blur", () => {
    if (openHoverCard?.chip === chip) closeHoverCard()
  })
  chip.addEventListener("click", () => {
    if (openHoverCard?.chip === chip) closeHoverCard()
    else showHoverCard(chip, clock)
  })

  return chip
}

function renderRow(): void {
  const row = document.getElementById("world-clocks")
  if (!row) return

  closeHoverCard()

  // The Dashboard shows tiles instead, and the row is parked — parked nodes are
  // still in the document, so leaving chips in it would tick a hidden clock on
  // every open tab.
  const clocks = getLayout() === "dashboard" ? [] : getWorldClocks()
  row.replaceChildren(...clocks.map(buildChip))
  row.hidden = clocks.length === 0
}

/* ── The Dashboard tiles ────────────────────────────────────────────────── */

function buildTile(clock: WorldClock): HTMLElement {
  const body = document.createElement("div")
  body.className = "wc-tile"

  const face = createClockFace(46)
  body.appendChild(face.el)

  const stack = document.createElement("div")
  stack.className = "wc-tile-stack"
  const readout = createReadout("wc-tile-time")
  const meta = document.createElement("div")
  meta.className = "wc-tile-meta"
  stack.append(readout.el, meta)
  body.appendChild(stack)

  onTick(body, (now) => {
    const t = zoneTime(clock.timezone, now)
    face.update(t)
    readout.update(t)

    const parts = [shortOffsetLabel(relativeOffsetMinutes(clock.timezone, now))]
    const day = dayOffsetLabel(dayOffset(clock.timezone, now))
    if (day) parts.push(day)
    meta.textContent = parts.join(" · ")
  })

  return body
}

let registeredIds: string[] = []

/**
 * Brings the Dashboard's tiles in line with the stored list. Registration order
 * decides where they land in the top row, so the whole set is torn down and
 * rebuilt rather than diffed — five cards is cheaper than getting order right.
 */
function syncCards(): void {
  const clocks = getWorldClocks()

  batchCards(() => {
    for (const id of registeredIds) unregisterCard(id)
    registeredIds = []

    clocks.forEach((clock, index) => {
      const id = CARD_PREFIX + clock.id
      registerCard({
        id,
        title: clock.label,
        // After the built-in widgets, so adding a clock never pushes weather
        // or Spotify out of the row's leading position.
        order: 100 + index,
        regions: { dashboard: "top" },
        render: () => buildTile(clock),
        tileTitle: () => clock.label,
      })
      registeredIds.push(id)
    })
  })
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

export function initWorldClocks(): void {
  renderRow()
  syncCards()

  store.sync.subscribe("worldClocks", () => {
    renderRow()
    syncCards()
  })

  // A switch into or out of the Dashboard moves the clocks between the chip row
  // and the tile row; the tiles rebuild themselves, the row does not.
  store.sync.subscribe("layout", renderRow)

  // The chips follow the main clock's format, so a change there redraws them.
  store.sync.subscribe("clock24Hour", renderRow)
  store.sync.subscribe("clockShowSeconds", renderRow)

  window.addEventListener("resize", closeHoverCard)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHoverCard()
  })
}
