import { searchZones } from "../timezones"

/**
 * Instant answers: arithmetic, unit conversion, and clock times elsewhere.
 *
 * Everything here is pure and offline. The arithmetic goes through a real
 * tokenizer and a shunting-yard pass rather than `eval` or `new Function` — the
 * input is a string typed on a page that also holds OAuth tokens, and an
 * expression evaluator is not worth a script injection.
 */

export type Answer = {
  /** The big line. */
  value: string
  /** What was understood, echoed back so a misread is obvious. */
  label: string
  copy: string
}

/* ── Number formatting ──────────────────────────────────────────────────── */

function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "−∞"
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e15)) return n.toExponential(6)

  const rounded = Number(n.toPrecision(12))
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 })
}

/* ── Arithmetic ─────────────────────────────────────────────────────────── */

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: string }
  | { kind: "fn"; value: string }
  | { kind: "paren"; value: "(" | ")" }

const FUNCTIONS: Record<string, (n: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "^": 3,
  "u-": 4,
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const s = input.replace(/[_,]/g, "")

  while (i < s.length) {
    const c = s[i]

    if (c === " ") {
      i++
      continue
    }

    if (c >= "0" && c <= "9") {
      let j = i
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++
      const value = Number(s.slice(i, j))
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: "num", value })
      i = j
      continue
    }

    if (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9") {
      let j = i + 1
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++
      tokens.push({ kind: "num", value: Number(s.slice(i, j)) })
      i = j
      continue
    }

    if (/[a-z]/i.test(c)) {
      let j = i
      while (j < s.length && /[a-z0-9]/i.test(s[j])) j++
      const word = s.slice(i, j).toLowerCase()
      if (word in CONSTANTS) tokens.push({ kind: "num", value: CONSTANTS[word] })
      else if (word in FUNCTIONS) tokens.push({ kind: "fn", value: word })
      else return null
      i = j
      continue
    }

    if ("+-*/%^".includes(c)) {
      tokens.push({ kind: "op", value: c })
      i++
      continue
    }

    if (c === "×") {
      tokens.push({ kind: "op", value: "*" })
      i++
      continue
    }

    if (c === "÷") {
      tokens.push({ kind: "op", value: "/" })
      i++
      continue
    }

    if (c === "(" || c === ")") {
      tokens.push({ kind: "paren", value: c })
      i++
      continue
    }

    return null
  }

  return tokens.length ? tokens : null
}

/** Shunting-yard, with unary minus resolved from the previous token's kind. */
function toRpn(tokens: Token[]): Token[] | null {
  const output: Token[] = []
  const stack: Token[] = []
  let prev: Token | null = null

  for (const token of tokens) {
    if (token.kind === "num") {
      output.push(token)
    } else if (token.kind === "fn") {
      stack.push(token)
    } else if (token.kind === "op") {
      const unary =
        token.value === "-" &&
        (prev === null ||
          prev.kind === "op" ||
          (prev.kind === "paren" && prev.value === "("))
      const op = unary ? "u-" : token.value

      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.kind === "fn") {
          output.push(stack.pop()!)
          continue
        }
        if (top.kind !== "op") break
        const higher =
          PRECEDENCE[top.value] > PRECEDENCE[op] ||
          (PRECEDENCE[top.value] === PRECEDENCE[op] && op !== "^" && op !== "u-")
        if (!higher) break
        output.push(stack.pop()!)
      }
      stack.push({ kind: "op", value: op })
    } else if (token.value === "(") {
      stack.push(token)
    } else {
      let matched = false
      while (stack.length) {
        const top = stack.pop()!
        if (top.kind === "paren" && top.value === "(") {
          matched = true
          break
        }
        output.push(top)
      }
      if (!matched) return null
      if (stack[stack.length - 1]?.kind === "fn") output.push(stack.pop()!)
    }
    prev = token
  }

  while (stack.length) {
    const top = stack.pop()!
    if (top.kind === "paren") return null
    output.push(top)
  }
  return output
}

function evalRpn(rpn: Token[]): number | null {
  const stack: number[] = []

  for (const token of rpn) {
    if (token.kind === "num") {
      stack.push(token.value)
      continue
    }

    if (token.kind === "fn") {
      const a = stack.pop()
      if (a === undefined) return null
      stack.push(FUNCTIONS[token.value](a))
      continue
    }

    if (token.kind !== "op") return null

    if (token.value === "u-") {
      const a = stack.pop()
      if (a === undefined) return null
      stack.push(-a)
      continue
    }

    const b = stack.pop()
    const a = stack.pop()
    if (a === undefined || b === undefined) return null

    switch (token.value) {
      case "+": stack.push(a + b); break
      case "-": stack.push(a - b); break
      case "*": stack.push(a * b); break
      case "/": stack.push(a / b); break
      case "%": stack.push(a % b); break
      case "^": stack.push(a ** b); break
      default: return null
    }
  }

  return stack.length === 1 ? stack[0] : null
}

function calculate(expression: string): number | null {
  const tokens = tokenize(expression)
  if (!tokens) return null
  const rpn = toRpn(tokens)
  if (!rpn) return null
  const value = evalRpn(rpn)
  return value === null || Number.isNaN(value) ? null : value
}

/* ── Percentages ────────────────────────────────────────────────────────── */

/**
 * The four forms people actually type. Rewritten into arithmetic rather than
 * special-cased downstream, so `15% of 240 + 10` still parses as one expression.
 */
function percentAnswer(input: string): Answer | null {
  const of = input.match(/^([\d.,]+)\s*%\s*(?:of|de)\s+(.+)$/i)
  if (of) {
    const base = calculate(of[2])
    const pct = Number(of[1].replace(/,/g, ""))
    if (base === null || !Number.isFinite(pct)) return null
    const value = (pct / 100) * base
    return { value: fmt(value), label: `${fmt(pct)}% of ${fmt(base)}`, copy: String(value) }
  }

  const delta = input.match(/^(.+?)\s*([+-])\s*([\d.,]+)\s*%$/i)
  if (delta) {
    const base = calculate(delta[1])
    const pct = Number(delta[3].replace(/,/g, ""))
    if (base === null || !Number.isFinite(pct)) return null
    const value = base * (1 + (delta[2] === "+" ? pct : -pct) / 100)
    return {
      value: fmt(value),
      label: `${fmt(base)} ${delta[2]} ${fmt(pct)}%`,
      copy: String(value),
    }
  }

  const share = input.match(/^([\d.,]+)\s+(?:is what|as a?)\s*%\s*(?:of)\s+([\d.,]+)$/i)
  if (share) {
    const part = Number(share[1].replace(/,/g, ""))
    const whole = Number(share[2].replace(/,/g, ""))
    if (!whole) return null
    const value = (part / whole) * 100
    return {
      value: `${fmt(value)}%`,
      label: `${fmt(part)} of ${fmt(whole)}`,
      copy: String(value),
    }
  }

  return null
}

/* ── Units ──────────────────────────────────────────────────────────────── */

type UnitDef = { dim: string; factor: number }

const UNITS = new Map<string, UnitDef>()

function unit(dim: string, factor: number, names: string[]): void {
  for (const name of names) UNITS.set(name, { dim, factor })
}

unit("length", 1, ["m", "meter", "meters", "metre", "metres"])
unit("length", 1000, ["km", "kilometer", "kilometers", "kilometre", "kilometres"])
unit("length", 0.01, ["cm", "centimeter", "centimeters", "centimetre", "centimetres"])
unit("length", 0.001, ["mm", "millimeter", "millimeters", "millimetre", "millimetres"])
unit("length", 1e-6, ["um", "micrometer", "micrometers", "micron", "microns"])
unit("length", 1e-9, ["nm", "nanometer", "nanometers"])
unit("length", 1609.344, ["mi", "mile", "miles"])
unit("length", 0.9144, ["yd", "yard", "yards"])
unit("length", 0.3048, ["ft", "foot", "feet"])
unit("length", 0.0254, ["in", "inch", "inches"])
unit("length", 1852, ["nmi", "nauticalmile", "nauticalmiles"])

unit("mass", 1, ["kg", "kilo", "kilos", "kilogram", "kilograms"])
unit("mass", 0.001, ["g", "gram", "grams"])
unit("mass", 1e-6, ["mg", "milligram", "milligrams"])
unit("mass", 1000, ["t", "tonne", "tonnes", "metricton"])
unit("mass", 0.45359237, ["lb", "lbs", "pound", "pounds"])
unit("mass", 0.028349523125, ["oz", "ounce", "ounces"])
unit("mass", 6.35029318, ["st", "stone", "stones"])

unit("volume", 1, ["l", "liter", "liters", "litre", "litres"])
unit("volume", 0.001, ["ml", "milliliter", "milliliters", "millilitre", "millilitres"])
unit("volume", 3.785411784, ["gal", "gallon", "gallons"])
unit("volume", 0.946352946, ["qt", "quart", "quarts"])
unit("volume", 0.473176473, ["pt", "pint", "pints"])
unit("volume", 0.2365882365, ["cup", "cups"])
unit("volume", 0.0295735295625, ["floz", "fluidounce", "fluidounces"])
unit("volume", 0.0147867648, ["tbsp", "tablespoon", "tablespoons"])
unit("volume", 0.00492892159, ["tsp", "teaspoon", "teaspoons"])

unit("time", 1, ["s", "sec", "secs", "second", "seconds"])
unit("time", 0.001, ["ms", "millisecond", "milliseconds"])
unit("time", 60, ["min", "mins", "minute", "minutes"])
unit("time", 3600, ["h", "hr", "hrs", "hour", "hours"])
unit("time", 86400, ["d", "day", "days"])
unit("time", 604800, ["wk", "week", "weeks"])
unit("time", 2629800, ["mo", "month", "months"])
unit("time", 31557600, ["y", "yr", "year", "years"])

unit("data", 1, ["b", "byte", "bytes"])
unit("data", 0.125, ["bit", "bits"])
unit("data", 1e3, ["kb", "kilobyte", "kilobytes"])
unit("data", 1024, ["kib", "kibibyte", "kibibytes"])
unit("data", 1e6, ["mb", "megabyte", "megabytes"])
unit("data", 1048576, ["mib", "mebibyte", "mebibytes"])
unit("data", 1e9, ["gb", "gigabyte", "gigabytes"])
unit("data", 1073741824, ["gib", "gibibyte", "gibibytes"])
unit("data", 1e12, ["tb", "terabyte", "terabytes"])
unit("data", 1099511627776, ["tib", "tebibyte", "tebibytes"])

unit("speed", 1, ["mps", "m/s"])
unit("speed", 0.277777778, ["kmh", "kph", "km/h", "kmph"])
unit("speed", 0.44704, ["mph", "mi/h"])
unit("speed", 0.514444444, ["kn", "knot", "knots"])
unit("speed", 0.3048, ["fps", "ft/s"])

unit("angle", 1, ["deg", "degree", "degrees"])
unit("angle", 57.2957795131, ["rad", "radian", "radians"])
unit("angle", 0.9, ["grad", "gradian", "gradians"])

const TEMPERATURE = new Map<string, "c" | "f" | "k">([
  ["c", "c"], ["celsius", "c"], ["centigrade", "c"],
  ["f", "f"], ["fahrenheit", "f"],
  ["k", "k"], ["kelvin", "k"],
])

function toCelsius(value: number, from: "c" | "f" | "k"): number {
  if (from === "c") return value
  if (from === "f") return (value - 32) / 1.8
  return value - 273.15
}

function fromCelsius(value: number, to: "c" | "f" | "k"): number {
  if (to === "c") return value
  if (to === "f") return value * 1.8 + 32
  return value + 273.15
}

function normalizeUnit(raw: string): string {
  return raw.toLowerCase().replace(/[\s.]/g, "").replace(/^°/, "")
}

const CONVERSION = /^([-\d.,]+)\s*([a-z°/µ]+)\s+(?:in|to|as|into)\s+([a-z°/µ]+)$/i

function unitAnswer(input: string): Answer | null {
  const m = input.match(CONVERSION)
  if (!m) return null

  const amount = Number(m[1].replace(/,/g, ""))
  if (!Number.isFinite(amount)) return null

  const fromRaw = normalizeUnit(m[2])
  const toRaw = normalizeUnit(m[3])

  const fromTemp = TEMPERATURE.get(fromRaw)
  const toTemp = TEMPERATURE.get(toRaw)
  if (fromTemp && toTemp) {
    const value = fromCelsius(toCelsius(amount, fromTemp), toTemp)
    return {
      value: `${fmt(value)}°${toTemp.toUpperCase()}`,
      label: `${fmt(amount)}°${fromTemp.toUpperCase()}`,
      copy: String(value),
    }
  }

  const from = UNITS.get(fromRaw)
  const to = UNITS.get(toRaw)
  if (!from || !to || from.dim !== to.dim) return null

  const value = (amount * from.factor) / to.factor
  return {
    value: `${fmt(value)} ${m[3]}`,
    label: `${fmt(amount)} ${m[2]}`,
    copy: String(value),
  }
}

/* ── Time elsewhere ─────────────────────────────────────────────────────── */

const TIME_IN = /^(?:(?:what(?:'s| is)? the )?time|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)\s+in\s+(.+)$/i

function zoneAnswer(input: string): Answer | null {
  const m = input.match(TIME_IN)
  if (!m) return null

  const place = m[4].trim()
  if (place.length < 2) return null
  const zone = searchZones(place, 1)[0]
  if (!zone) return null

  const when = new Date()
  if (m[1]) {
    let hour = Number(m[1])
    const minute = m[2] ? Number(m[2]) : 0
    if (hour > 23 || minute > 59) return null
    const meridiem = m[3]?.toLowerCase()
    if (meridiem === "pm" && hour < 12) hour += 12
    if (meridiem === "am" && hour === 12) hour = 0
    when.setHours(hour, minute, 0, 0)
  }

  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: zone.id,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(when)

  const here = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(when)

  return {
    value,
    label: m[1] ? `${here} here · ${zone.city}` : zone.city,
    copy: value,
  }
}

/* ── Entry point ────────────────────────────────────────────────────────── */

/** A bare number or a plain word is not a calculation, however parseable. */
const HAS_OPERATION = /[-+*/^%×÷]|\b(sqrt|cbrt|abs|round|floor|ceil|ln|log2?|exp|sin|cos|tan|asin|acos|atan)\s*\(/i

export function evaluate(input: string): Answer | null {
  const trimmed = input.trim()
  if (trimmed.length < 3 || trimmed.length > 120) return null

  const percent = percentAnswer(trimmed)
  if (percent) return percent

  const units = unitAnswer(trimmed)
  if (units) return units

  const zone = zoneAnswer(trimmed)
  if (zone) return zone

  if (!HAS_OPERATION.test(trimmed)) return null
  const value = calculate(trimmed)
  if (value === null) return null

  return { value: fmt(value), label: trimmed, copy: String(value) }
}
