/**
 * The immersive dock's fisheye.
 *
 * Every cell is scaled by its distance from the pointer and pushed sideways by
 * however much its neighbours grew, so the row spreads around the cursor
 * instead of tiles overlapping. The push is derived rather than measured: a
 * cell's displacement is the total extra width of everything to its left, plus
 * half its own, recentred on the row — which means the transforms can be
 * recomputed every frame without ever reading layout back.
 */

const MAX_SCALE = 1.55
/** Influence radius, in tile widths. */
const RANGE = 2.4
const SETTLE_MS = 220

export type MagnifyCell = {
  el: HTMLElement
  /** A divider grows nothing — it only rides the spread. */
  scalable: boolean
}

type Snap = { el: HTMLElement; w: number; c: number; scalable: boolean }

let originEl: HTMLElement | null = null
let source: MagnifyCell[] = []
let snaps: Snap[] = []
let unit = 56
let frame = 0
let settleTimer = 0
let pointerX: number | null = null
let active = false
let suspended = false

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** `originEl` is `position: relative`, so every cell's offsetLeft shares its space. */
function snapshot(): void {
  snaps = source.map((c) => ({
    el: c.el,
    w: c.el.offsetWidth,
    c: c.el.offsetLeft + c.el.offsetWidth / 2,
    scalable: c.scalable,
  }))
  const first = snaps.find((s) => s.scalable)
  if (first && first.w > 0) unit = first.w
}

function scaleFor(distance: number): number {
  const t = Math.min(1, distance / (RANGE * unit))
  const falloff = Math.cos((Math.PI / 2) * t) ** 2
  return 1 + (MAX_SCALE - 1) * falloff
}

function paint(): void {
  frame = 0
  if (pointerX === null) {
    for (const s of snaps) s.el.style.transform = ""
    return
  }

  const scales = snaps.map((s) => (s.scalable ? scaleFor(Math.abs(pointerX! - s.c)) : 1))
  const extra = snaps.map((s, i) => s.w * (scales[i] - 1))
  const total = extra.reduce((a, b) => a + b, 0)

  let before = 0
  for (let i = 0; i < snaps.length; i++) {
    const shift = before + extra[i] / 2 - total / 2
    before += extra[i]
    snaps[i].el.style.transform =
      `translateX(${shift.toFixed(2)}px) scale(${scales[i].toFixed(4)})`
  }
}

function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(paint)
}

/**
 * Tracking is transform-only while the pointer moves so the dock stays glued to
 * the cursor; the entry and exit get a transition so neither snaps.
 */
function settle(): void {
  if (!originEl) return
  originEl.classList.add("is-settling")
  clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => originEl?.classList.remove("is-settling"), SETTLE_MS)
}

function onEnter(e: PointerEvent): void {
  if (suspended || e.pointerType === "touch") return
  snapshot()
  active = true
  settle()
  onMove(e)
}

function onMove(e: PointerEvent): void {
  if (!active || suspended || !originEl) return
  pointerX = e.clientX - originEl.getBoundingClientRect().left
  schedule()
}

function onLeave(): void {
  if (!active) return
  active = false
  pointerX = null
  settle()
  schedule()
}

/**
 * Called by the renderer after every layout pass. Re-snapshots if the pointer is
 * still inside, so adding a shortcut mid-hover doesn't leave stale geometry.
 */
export function refreshMagnify(cells: MagnifyCell[]): void {
  source = cells
  if (active) {
    snapshot()
    schedule()
  }
}

export function clearMagnify(): void {
  for (const s of snaps) s.el.style.transform = ""
  source = []
  snaps = []
  pointerX = null
  active = false
}

/** Held off while a drag owns the transforms. */
export function suspendMagnify(on: boolean): void {
  suspended = on
  if (on) {
    active = false
    pointerX = null
    for (const s of snaps) s.el.style.transform = ""
  }
}

export function initMagnify(host: HTMLElement, origin: HTMLElement): void {
  originEl = origin
  if (reducedMotion()) return
  host.addEventListener("pointerenter", onEnter)
  host.addEventListener("pointermove", onMove)
  host.addEventListener("pointerleave", onLeave)
  host.addEventListener("scroll", () => {
    if (active) snapshot()
  })
}
