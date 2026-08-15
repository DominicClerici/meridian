/**
 * The rounded rectangle Apple draws.
 *
 * A CSS `border-radius` corner is a quarter circle bolted onto two straight
 * edges: curvature jumps from zero to 1/r at the join, and the eye reads that
 * discontinuity as a seam. Apple's corner (`CALayer.cornerCurve = .continuous`)
 * instead eases curvature in and out, so the corner starts further back along
 * the edge and the join disappears.
 *
 * The shape is not a superellipse — it is the piecewise cubic Bezier fit Figma
 * reverse-engineered in "Desperately seeking squircles". Each corner is three
 * pieces: a Bezier ramping curvature up, a circular arc of reduced sweep through
 * the apex, and a mirrored Bezier ramping it back down.
 *
 * `smoothing` is how much of the corner is given over to the ramps — 0 leaves a
 * plain quarter circle, and Apple sits around 0.6.
 *
 * Most of the app never touches this: `corner-shape` in styles.css rounds every
 * box natively, which a path cannot do without measuring. Reach for this when a
 * shape has to be drawn rather than styled — SVG, canvas, or a mask.
 */

const DEG = Math.PI / 180

/** Where UIKit's continuous curve lands on Figma's smoothing scale. */
export const APPLE_SMOOTHING = 0.9

interface Corner {
  /** Control-point offsets along the edge, from figure 11.1 of the article. */
  a: number
  b: number
  c: number
  d: number
  /** How far back along each edge the corner reaches: (1 + smoothing) * r. */
  p: number
  /** The chord of the shortened arc, on both axes. */
  arc: number
  radius: number
}

function corner(radius: number, smoothing: number, budget: number): Corner {
  // Spreading the curve costs edge length, and a short edge cannot pay for it —
  // past this point the ramps would run into each other.
  const spread = Math.max(0, Math.min(smoothing, budget / radius - 1))
  const p = Math.min((1 + spread) * radius, budget)

  const sweep = 90 * (1 - spread)
  const arc = Math.sin((sweep / 2) * DEG) * radius * Math.SQRT2

  const alpha = (90 - sweep) / 2
  const beta = 45 * spread
  const c = radius * Math.tan((alpha / 2) * DEG) * Math.cos(beta * DEG)
  const d = c * Math.tan(beta * DEG)
  const b = (p - arc - c - d) / 3

  return { a: 2 * b, b, c, d, p, arc, radius }
}

export interface SquircleParams {
  width: number
  height: number
  /** The nominal corner radius — the same number a `border-radius` would take. */
  radius: number
  smoothing?: number
  /** Origin of the box, for insetting the path a stroke is centred on. */
  x?: number
  y?: number
}

/**
 * An SVG path for one rounded rectangle. Only the opening move is absolute, so
 * the four corners are the same four segments mirrored.
 */
export function squirclePath({ width, height, radius, smoothing = APPLE_SMOOTHING, x = 0, y = 0 }: SquircleParams): string {
  if (width <= 0 || height <= 0) return ""

  const budget = Math.min(width, height) / 2
  const r = Math.min(Math.max(radius, 0), budget)
  if (r === 0) {
    return `M ${n(x)} ${n(y)} h ${n(width)} v ${n(height)} h ${n(-width)} Z`
  }

  const { a, b, c, d, p, arc } = corner(r, smoothing, budget)
  // What is left of each edge once both of its corners have taken their reach.
  const side = n(width - 2 * p)
  const rise = n(height - 2 * p)

  return [
    `M ${n(x + width - p)} ${n(y)}`,
    `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)}`,
    `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`,
    `l 0 ${rise}`,
    `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)}`,
    `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`,
    `l ${-side} 0`,
    `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)}`,
    `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`,
    `l 0 ${-rise}`,
    `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)}`,
    `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`,
    "Z",
  ].join(" ")
}

/** How far back along an edge a corner of this radius reaches. */
export function cornerReach(radius: number, smoothing = APPLE_SMOOTHING): number {
  return (1 + smoothing) * radius
}

/** An `svg+xml` data URI of the filled shape, for `mask-image` or `background-image`. */
export function squircleDataUri(params: SquircleParams & { fill?: string }): string {
  const { width, height, fill = "#000" } = params
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${squirclePath(params)}" fill="${fill}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const tracked = new Map<Element, { radius: number; smoothing: number }>()
let observer: ResizeObserver | null = null

function clip(el: HTMLElement, radius: number, smoothing: number): void {
  const { width, height } = el.getBoundingClientRect()
  el.style.clipPath = `path("${squirclePath({ width, height, radius, smoothing })}")`
}

/**
 * Clips an element to the true curve, re-cut whenever it resizes.
 *
 * Only for what `corner-shape` cannot style: a clip halves the border it cuts
 * through and takes the box's own shadow with it, so prefer the CSS route and
 * keep this for elements that are pure fill.
 */
export function applySquircle(el: HTMLElement, opts: { radius: number; smoothing?: number }): () => void {
  const entry = { radius: opts.radius, smoothing: opts.smoothing ?? APPLE_SMOOTHING }
  tracked.set(el, entry)

  observer ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const config = tracked.get(target)
      if (config) clip(target as HTMLElement, config.radius, config.smoothing)
    }
  })

  observer.observe(el)
  clip(el, entry.radius, entry.smoothing)

  return () => {
    tracked.delete(el)
    observer?.unobserve(el)
    el.style.clipPath = ""
  }
}

function n(value: number): number {
  return Math.round(value * 1000) / 1000
}
