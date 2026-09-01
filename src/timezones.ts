/**
 * IANA timezone catalogue, search, and the arithmetic the world clocks need:
 * a zone's wall-clock reading, its UTC offset, and how far it sits from the
 * viewer. See `docs/world-clocks.md`.
 */

import { currentTimezone, knownTimezones } from "./timezone-coords"

export type ZoneInfo = {
  id: string
  /** Last path segment, humanised — "New York", "São Paulo" stays as spelled. */
  city: string
  /** Everything before the city — "America", "America / Argentina". */
  region: string
}

export type ZoneTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * Queries that name a place the zone id doesn't. Matched by prefix, so "east"
 * finds Eastern time and "nyc" finds New York, without a country table.
 */
const ALIASES: Record<string, string[]> = {
  "America/New_York": ["nyc", "new york city", "eastern", "est", "edt", "usa", "united states", "manhattan", "boston", "washington dc", "miami", "atlanta", "philadelphia"],
  "America/Chicago": ["central time", "cst", "cdt", "texas", "dallas", "houston", "austin", "usa", "united states"],
  "America/Denver": ["mountain time", "mst", "mdt", "colorado", "boulder", "usa", "united states"],
  "America/Los_Angeles": ["la", "pacific time", "pst", "pdt", "california", "san francisco", "sf", "seattle", "portland", "san diego", "silicon valley", "usa", "united states"],
  "America/Phoenix": ["arizona", "usa"],
  "America/Anchorage": ["alaska", "usa"],
  "Pacific/Honolulu": ["hawaii", "usa", "hst"],
  "America/Toronto": ["canada", "ontario", "ottawa"],
  "America/Vancouver": ["canada", "british columbia"],
  "America/Mexico_City": ["mexico", "cdmx"],
  "America/Sao_Paulo": ["brazil", "brasil", "rio de janeiro"],
  "America/Argentina/Buenos_Aires": ["argentina"],
  "America/Bogota": ["colombia"],
  "America/Lima": ["peru"],
  "America/Santiago": ["chile"],
  "Europe/London": ["uk", "united kingdom", "england", "britain", "gmt", "bst", "great britain", "scotland", "edinburgh", "manchester"],
  "Europe/Dublin": ["ireland"],
  "Europe/Paris": ["france", "cet", "cest"],
  "Europe/Berlin": ["germany", "deutschland", "munich", "frankfurt", "hamburg", "cet"],
  "Europe/Amsterdam": ["netherlands", "holland"],
  "Europe/Brussels": ["belgium"],
  "Europe/Madrid": ["spain", "espana", "barcelona"],
  "Europe/Lisbon": ["portugal"],
  "Europe/Rome": ["italy", "italia", "milan"],
  "Europe/Zurich": ["switzerland", "geneva", "swiss"],
  "Europe/Vienna": ["austria"],
  "Europe/Stockholm": ["sweden"],
  "Europe/Oslo": ["norway"],
  "Europe/Copenhagen": ["denmark"],
  "Europe/Helsinki": ["finland"],
  "Europe/Warsaw": ["poland"],
  "Europe/Prague": ["czech", "czechia"],
  "Europe/Athens": ["greece"],
  "Europe/Istanbul": ["turkey", "turkiye"],
  "Europe/Moscow": ["russia"],
  "Europe/Kyiv": ["ukraine", "kiev"],
  "Africa/Lagos": ["nigeria"],
  "Africa/Cairo": ["egypt"],
  "Africa/Nairobi": ["kenya"],
  "Africa/Johannesburg": ["south africa", "cape town", "sast"],
  "Africa/Casablanca": ["morocco"],
  "Asia/Dubai": ["uae", "united arab emirates", "abu dhabi", "gulf"],
  "Asia/Riyadh": ["saudi arabia", "saudi"],
  "Asia/Jerusalem": ["israel", "tel aviv"],
  "Asia/Tehran": ["iran"],
  "Asia/Karachi": ["pakistan", "lahore"],
  "Asia/Kolkata": ["india", "calcutta", "mumbai", "bangalore", "bengaluru", "delhi", "new delhi", "chennai", "hyderabad", "ist"],
  "Asia/Dhaka": ["bangladesh"],
  "Asia/Bangkok": ["thailand"],
  "Asia/Ho_Chi_Minh": ["vietnam", "saigon", "hanoi"],
  "Asia/Jakarta": ["indonesia"],
  "Asia/Kuala_Lumpur": ["malaysia"],
  "Asia/Singapore": ["sgt"],
  "Asia/Manila": ["philippines"],
  "Asia/Hong_Kong": ["hk", "hkt"],
  "Asia/Taipei": ["taiwan"],
  "Asia/Shanghai": ["china", "beijing", "shenzhen", "guangzhou", "prc"],
  "Asia/Seoul": ["korea", "south korea", "kst"],
  "Asia/Tokyo": ["japan", "jst", "osaka", "kyoto"],
  "Australia/Sydney": ["australia", "nsw", "aedt", "aest"],
  "Australia/Melbourne": ["australia", "victoria"],
  "Australia/Brisbane": ["australia", "queensland"],
  "Australia/Perth": ["australia", "western australia"],
  "Pacific/Auckland": ["new zealand", "nz", "nzdt", "nzst"],
  UTC: ["gmt", "utc", "zulu", "coordinated universal time"],
}

/** What the picker offers before anything is typed. */
const POPULAR = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
]

function humanise(segment: string): string {
  return segment.replace(/_/g, " ")
}

function describe(id: string): ZoneInfo {
  const parts = id.split("/")
  return {
    id,
    city: humanise(parts[parts.length - 1]!),
    region: parts.slice(0, -1).map(humanise).join(" / "),
  }
}

let catalogue: ZoneInfo[] | null = null

/** Every zone the picker can offer, alphabetical by city. */
export function zoneCatalogue(): ZoneInfo[] {
  if (catalogue) return catalogue

  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  let ids: string[] = []
  try {
    ids = intl.supportedValuesOf?.("timeZone") ?? []
  } catch {
    ids = []
  }
  if (ids.length === 0) ids = knownTimezones()

  // `Etc/GMT+5` counts its offset backwards, which is a trap rather than a
  // feature in a city picker; plain UTC covers the same need honestly.
  const kept = ids.filter((id) => id === "UTC" || (id.includes("/") && !id.startsWith("Etc/")))
  if (!kept.includes("UTC")) kept.push("UTC")

  catalogue = kept
    .map(describe)
    .sort((a, b) => a.city.localeCompare(b.city))
  return catalogue
}

let byId: Map<string, ZoneInfo> | null = null

export function zoneInfo(id: string): ZoneInfo {
  if (!byId) byId = new Map(zoneCatalogue().map((z) => [z.id, z] as const))
  return byId.get(id) ?? describe(id)
}

export function isValidTimezone(id: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id })
    return true
  } catch {
    return false
  }
}

/* ── Search ─────────────────────────────────────────────────────────────── */

function normalise(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/** Lower is better. `null` means no match at all. */
function rank(zone: ZoneInfo, query: string): number | null {
  const city = normalise(zone.city)
  if (city === query) return 0
  if (city.startsWith(query)) return 1
  if (city.includes(query)) return 3

  for (const alias of ALIASES[zone.id] ?? []) {
    if (alias.startsWith(query)) return alias === query ? 2 : 4
  }

  const region = normalise(zone.region)
  if (region.startsWith(query)) return 5
  if (region.includes(query)) return 6
  if (normalise(zone.id).includes(query)) return 7
  return null
}

/**
 * Zones matching `query`, best first. An empty query answers with the popular
 * list rather than 400 rows — the viewer's own zone leads it, since "same as
 * mine" is a reasonable thing to add.
 */
export function searchZones(query: string, limit = 60): ZoneInfo[] {
  const trimmed = normalise(query.trim())

  if (!trimmed) {
    const local = currentTimezone()
    const ids = local && !POPULAR.includes(local) ? [local, ...POPULAR] : POPULAR
    return ids.filter(isValidTimezone).map(zoneInfo)
  }

  const scored: { zone: ZoneInfo; score: number }[] = []
  for (const zone of zoneCatalogue()) {
    const score = rank(zone, trimmed)
    if (score !== null) scored.push({ zone, score })
  }
  scored.sort((a, b) => a.score - b.score || a.zone.city.localeCompare(b.zone.city))
  return scored.slice(0, limit).map((s) => s.zone)
}

/* ── Time in a zone ─────────────────────────────────────────────────────── */

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(tz, fmt)
  }
  return fmt
}

/** The wall clock in `tz` at `at`, as numbers. Hours are 0–23. */
export function zoneTime(tz: string, at: Date): ZoneTime {
  const parts = partsFormatter(tz).formatToParts(at)
  const read = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  }
}

/**
 * The zone's offset from UTC in minutes. Derived by reading the wall clock and
 * re-interpreting it as UTC — the only way to get a *historical* offset right,
 * since DST rules change and a fixed table would go stale.
 */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const t = zoneTime(tz, at)
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** How far ahead of the viewer the zone is, in minutes. Negative is behind. */
export function relativeOffsetMinutes(tz: string, at: Date): number {
  return zoneOffsetMinutes(tz, at) + at.getTimezoneOffset()
}

/** Whole days between the zone's date and the viewer's. */
export function dayOffset(tz: string, at: Date): number {
  const there = zoneTime(tz, at)
  const a = Date.UTC(there.year, there.month - 1, there.day)
  const b = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())
  return Math.round((a - b) / 86_400_000)
}

/* ── Labels ─────────────────────────────────────────────────────────────── */

const MINUS = "−"

function hoursAndMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (!m) return `${h}h`
  return h ? `${h}h ${m}m` : `${m}m`
}

export function utcOffsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC"
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const tail = m ? `:${String(m).padStart(2, "0")}` : ""
  return `UTC${minutes < 0 ? MINUS : "+"}${h}${tail}`
}

/** Terse form for a chip or a tile: `+14h`, `−4h 30m`, `0h`. */
export function shortOffsetLabel(minutes: number): string {
  if (minutes === 0) return "0h"
  return `${minutes < 0 ? MINUS : "+"}${hoursAndMinutes(Math.abs(minutes))}`
}

/** Sentence form for the hover card: "14h ahead of you". */
export function relativeOffsetLabel(minutes: number): string {
  if (minutes === 0) return "Same time as you"
  const body = hoursAndMinutes(Math.abs(minutes))
  return `${body} ${minutes > 0 ? "ahead of" : "behind"} you`
}

export function dayOffsetLabel(days: number): string | null {
  if (days === 0) return null
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  return `${days > 0 ? "+" : MINUS}${Math.abs(days)} days`
}

/** The `+1` / `−1` marker a compact chip carries when the date differs. */
export function dayOffsetMarker(days: number): string | null {
  if (days === 0) return null
  return `${days > 0 ? "+" : MINUS}${Math.abs(days)}`
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(tz: string, withWeekday: boolean): Intl.DateTimeFormat {
  const key = `${tz}|${withWeekday}`
  let fmt = dateFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      ...(withWeekday ? { weekday: "long" as const } : {}),
      month: "short",
      day: "numeric",
    })
    dateFormatters.set(key, fmt)
  }
  return fmt
}

/**
 * The zone's own date: "Sunday, Aug 31" on the same day as the viewer,
 * "Tomorrow · Sep 1" otherwise. The day word replaces the weekday rather than
 * joining it — "Tomorrow · Tuesday, Sep 1" says one date three ways, and wraps.
 */
export function zoneDateLabel(tz: string, at: Date): string {
  const day = dayOffsetLabel(dayOffset(tz, at))
  if (!day) return dateFormatter(tz, true).format(at)
  return `${day} · ${dateFormatter(tz, false).format(at)}`
}

export type DisplayTime = {
  /** Already padded and joined — "1:47" or "13:47:09". */
  time: string
  /** "AM" / "PM", or "" in 24-hour mode. */
  meridiem: string
}

export function displayTime(
  t: ZoneTime,
  opts: { hour24: boolean; seconds: boolean }
): DisplayTime {
  const pad = (n: number): string => String(n).padStart(2, "0")
  const hour = opts.hour24 ? pad(t.hour) : String(t.hour % 12 || 12)
  let time = `${hour}:${pad(t.minute)}`
  if (opts.seconds) time += `:${pad(t.second)}`
  return { time, meridiem: opts.hour24 ? "" : t.hour >= 12 ? "PM" : "AM" }
}

/** Daylight at the destination, for the clock face's tint. */
export function isDaytime(t: ZoneTime): boolean {
  return t.hour >= 6 && t.hour < 18
}
