import { oklchToRgb, parseCssColor, rgbToOklch, type Rgb } from "./color"

const ORB_COUNT = 16
const INTENSITY = 0.65
const CURSOR_STRENGTH = 0.68

const CURSOR_EASE = 0.06
const PALETTE_FADE_MS = 450
const MAX_BUFFER_WIDTH = 2560

/** Hue rotation, lightness offset and chroma scale for each of the five stops. */
const STOP_SHAPE = [
  { dh: -42, dl: 0.11, cm: 0.95 },
  { dh: -15, dl: -0.07, cm: 1.2 },
  { dh: 20, dl: 0.06, cm: 1.05 },
  { dh: 48, dl: -0.05, cm: 0.85 },
  { dh: 78, dl: 0.09, cm: 0.7 },
]

type Palette = { base: Rgb; stops: Rgb[] }

/**
 * Turns the single `--page-bg` hex into six harmonised stops.
 *
 * A dark page background is nearly achromatic (C ~ 0.04), so its stops have to
 * gain a lot of chroma to be visible at all; a light one is already vivid and
 * only needs spreading. Hence the very different chroma boosts per mode.
 */
function derivePalette(baseCss: string, mode: "light" | "dark"): Palette | null {
  const rgb = parseCssColor(baseCss)
  if (!rgb) return null

  const { L, C, H } = rgbToOklch(rgb)
  const dark = mode === "dark"
  const chromaBoost = dark ? 1 + 2.6 * INTENSITY : 1 + 0.15 * INTENSITY
  const lightAmp = dark ? 0.9 : 1
  const hueAmp = dark ? 1 : 0.85

  const stops = STOP_SHAPE.map((s) =>
    oklchToRgb({
      L: L + s.dl * INTENSITY * 1.7 * lightAmp,
      C: C * chromaBoost * s.cm,
      H: H + s.dh * INTENSITY * hueAmp,
    })
  )

  const base = oklchToRgb({
    L: L - (dark ? 0.03 : 0.06) * INTENSITY,
    C: C * (dark ? 1 : 0.9),
    H,
  })

  return { base, stops }
}

const VERTEX_SRC = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAGMENT_SRC = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uCursor;
uniform vec3  c0, c1, c2, c3, c4, c5;

const float N = ${ORB_COUNT.toFixed(1)};

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.3; a *= 0.5; }
  return v;
}

vec3 palette(int i) {
  if (i == 0) return c1;
  if (i == 1) return c2;
  if (i == 2) return c3;
  if (i == 3) return c4;
  return c5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(ar, 1.0) * 2.0;

  float t = uTime * 0.10;
  p += uCursor * 0.20;

  // Warp the whole field so no orb ever reads as a circle.
  p += 0.22 * (vec2(fbm(p * 1.05 + t * 0.55), fbm(p * 1.05 + 11.3 - t * 0.45)) - 0.5);

  float inv = 1.0 / sqrt(N);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${ORB_COUNT}; i++) {
    float fi = float(i);
    float h1 = hash(vec2(fi, 1.7));
    float h2 = hash(vec2(fi, 5.3));
    float h3 = hash(vec2(fi, 9.1));

    // Golden-angle spiral: even coverage at any count, with no grid to lock onto.
    float ang = fi * 2.39996323;
    float rr = sqrt((fi + 0.5) / N);
    vec2 home = vec2(cos(ang), sin(ang)) * rr * vec2(ar * 1.30, 1.30);

    float rad = inv * 1.55 * (0.72 + h1 * 0.62);
    float amp = inv * 1.05 * (0.45 + h2 * 0.75);
    float spd = 0.42 + h3 * 0.95;

    vec2 c = home + amp * vec2(cos(t * spd + h1 * 6.2831), sin(t * spd * 0.83 + h2 * 6.2831));

    float d2 = dot(p - c, p - c);
    float w = exp(-d2 / (rad * rad * 1.9));

    acc += w * palette(int(mod(fi, 5.0)));
    wsum += w;
  }

  // Weight-blending each orb's own colour is what makes this read as a mesh
  // instead of one silhouette; the base shows through where coverage is thin.
  vec3 col = mix(c0, acc / max(wsum, 0.0001), clamp(wsum * 1.45, 0.0, 1.0));

  col *= 0.94 + 0.13 * fbm(p * 0.85 + t * 0.4);

  float vig = 1.0 - smoothstep(0.42, 1.05, length((uv - vec2(0.5, 0.45)) * vec2(1.15, 1.0)) * 1.6);
  col *= mix(0.84, 1.0, vig);

  // Dither, or these very low-frequency gradients band badly on 8-bit displays.
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;

  gl_FragColor = vec4(col, 1.0);
}
`

const root = document.documentElement

let canvas: HTMLCanvasElement | null = null
let gl: WebGLRenderingContext | null = null
let uniforms: {
  uRes: WebGLUniformLocation | null
  uTime: WebGLUniformLocation | null
  uCursor: WebGLUniformLocation | null
  colors: (WebGLUniformLocation | null)[]
} | null = null

let rafId = 0
let running = false
let observer: MutationObserver | null = null
let startedAt = 0

let fromPalette: Palette | null = null
let toPalette: Palette | null = null
let fadeStart = 0

let cursorX = 0
let cursorY = 0
let targetX = 0
let targetY = 0

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

function compile(context: WebGLRenderingContext, src: string, type: number): WebGLShader | null {
  const shader = context.createShader(type)
  if (!shader) return null
  context.shaderSource(shader, src)
  context.compileShader(shader)
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    context.deleteShader(shader)
    return null
  }
  return shader
}

function createContext(target: HTMLCanvasElement): boolean {
  const context = target.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  })
  if (!context) return false

  const vert = compile(context, VERTEX_SRC, context.VERTEX_SHADER)
  const frag = compile(context, FRAGMENT_SRC, context.FRAGMENT_SHADER)
  if (!vert || !frag) return false

  const program = context.createProgram()
  if (!program) return false
  context.attachShader(program, vert)
  context.attachShader(program, frag)
  context.linkProgram(program)
  if (!context.getProgramParameter(program, context.LINK_STATUS)) return false
  context.useProgram(program)

  const buffer = context.createBuffer()
  context.bindBuffer(context.ARRAY_BUFFER, buffer)
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW)
  const aPos = context.getAttribLocation(program, "aPos")
  context.enableVertexAttribArray(aPos)
  context.vertexAttribPointer(aPos, 2, context.FLOAT, false, 0, 0)

  gl = context
  uniforms = {
    uRes: context.getUniformLocation(program, "uRes"),
    uTime: context.getUniformLocation(program, "uTime"),
    uCursor: context.getUniformLocation(program, "uCursor"),
    colors: ["c0", "c1", "c2", "c3", "c4", "c5"].map((n) => context.getUniformLocation(program, n)),
  }
  return true
}

function currentPalette(): Palette | null {
  const mode = root.getAttribute("data-mode") === "light" ? "light" : "dark"
  const bg = getComputedStyle(root).getPropertyValue("--page-bg")
  return derivePalette(bg, mode)
}

function refreshPalette(animate: boolean): void {
  const next = currentPalette()
  if (!next) return

  if (animate && toPalette) {
    fromPalette = blended(performance.now())
    fadeStart = performance.now()
  } else {
    fromPalette = next
    fadeStart = 0
  }
  toPalette = next
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function blended(now: number): Palette | null {
  if (!toPalette) return null
  if (!fromPalette || !fadeStart) return toPalette

  const t = Math.min(1, (now - fadeStart) / PALETTE_FADE_MS)
  if (t >= 1) return toPalette

  return {
    base: lerpRgb(fromPalette.base, toPalette.base, t),
    stops: toPalette.stops.map((s, i) => lerpRgb(fromPalette!.stops[i], s, t)),
  }
}

function resize(): void {
  if (!canvas || !gl) return

  const scale = Math.min(1, MAX_BUFFER_WIDTH / Math.max(1, window.innerWidth))
  const w = Math.max(1, Math.round(window.innerWidth * scale))
  const h = Math.max(1, Math.round(window.innerHeight * scale))

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    gl.viewport(0, 0, w, h)
  }
}

function render(now: number): void {
  if (!gl || !uniforms || !canvas) return

  resize()

  const palette = blended(now)
  if (!palette) return

  const time = reducedMotion.matches ? 0 : (now - startedAt) / 1000

  if (reducedMotion.matches) {
    cursorX = 0
    cursorY = 0
  } else {
    cursorX += (targetX - cursorX) * CURSOR_EASE
    cursorY += (targetY - cursorY) * CURSOR_EASE
  }

  gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)
  gl.uniform1f(uniforms.uTime, time)
  gl.uniform2f(uniforms.uCursor, cursorX * CURSOR_STRENGTH, -cursorY * CURSOR_STRENGTH)

  const colors = [palette.base, ...palette.stops]
  for (let i = 0; i < colors.length; i++) {
    gl.uniform3fv(uniforms.colors[i], colors[i])
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3)
  canvas.style.opacity = "1"
}

function frame(now: number): void {
  if (!running) return
  render(now)

  // Nothing moves under reduced motion, so one frame is the whole animation.
  if (reducedMotion.matches) return
  rafId = requestAnimationFrame(frame)
}

function onPointerMove(e: PointerEvent): void {
  targetX = (e.clientX / window.innerWidth) * 2 - 1
  targetY = (e.clientY / window.innerHeight) * 2 - 1
}

function onVisibility(): void {
  if (!running) return
  if (document.hidden) {
    cancelAnimationFrame(rafId)
    rafId = 0
  } else if (!rafId) {
    rafId = requestAnimationFrame(frame)
  }
}

function tick(): void {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(frame)
}

/** Renders the animated mesh. Falls back silently to the flat `--page-bg`. */
export function startMesh(): void {
  if (running) return

  if (!canvas) {
    const el = document.createElement("canvas")
    el.id = "mesh-bg"
    el.setAttribute("aria-hidden", "true")
    if (!createContext(el)) return
    canvas = el
    document.body.insertBefore(el, document.body.firstChild)

    observer = new MutationObserver(() => refreshPalette(true))
    observer.observe(root, { attributeFilter: ["data-mode", "data-bg", "data-theme"] })

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    document.addEventListener("visibilitychange", onVisibility)
    reducedMotion.addEventListener("change", tick)
    window.addEventListener("resize", tick, { passive: true })
  }

  running = true
  canvas.hidden = false
  startedAt = performance.now()
  refreshPalette(false)
  tick()
}

export function stopMesh(): void {
  running = false
  cancelAnimationFrame(rafId)
  rafId = 0
  if (canvas) {
    canvas.hidden = true
    canvas.style.opacity = "0"
  }
}
