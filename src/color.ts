export type Rgb = [number, number, number]
export type Oklch = { L: number; C: number; H: number }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export function parseCssColor(css: string): Rgb | null {
  const s = css.trim()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ]
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
    if (parts.length < 3) return null
    const vals = parts.map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255))
    if (vals.some(Number.isNaN)) return null
    return [vals[0], vals[1], vals[2]]
  }

  return null
}

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

function oklabToRgb(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const inGamut = ([r, g, b]: Rgb): boolean =>
  r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && b >= -0.001 && b <= 1.001

/**
 * Reduces chroma until the colour fits sRGB rather than clipping channels —
 * clipping shifts hue, which would break the harmony of a derived palette.
 */
export function oklchToRgb({ L, C, H }: Oklch): Rgb {
  const lightness = clamp01(L)
  const rad = (H * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let chroma = Math.max(0, C)
  let rgb = oklabToRgb(lightness, chroma * cos, chroma * sin)

  for (let i = 0; i < 28 && !inGamut(rgb); i++) {
    chroma *= 0.94
    rgb = oklabToRgb(lightness, chroma * cos, chroma * sin)
  }

  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])]
}
