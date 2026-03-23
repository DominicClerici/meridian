import { store } from "./store"
import type { SyncSettings } from "./defaults"

const SIZE_MAP: Record<SyncSettings["clockSize"], string> = {
  small: "3rem",
  medium: "5rem",
  large: "8rem",
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_SHORT = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."]
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function ordinal(day: number): string {
  if (day > 3 && day < 21) return day + "th"
  switch (day % 10) {
    case 1: return day + "st"
    case 2: return day + "nd"
    case 3: return day + "rd"
    default: return day + "th"
  }
}

function formatDate(now: Date, fmt: SyncSettings["clockDateFormat"]): string {
  const month = now.getMonth()
  const day = now.getDate()
  const year = now.getFullYear()
  const mm = String(month + 1).padStart(2, "0")
  const dd = String(day).padStart(2, "0")

  switch (fmt) {
    case "long": return `${MONTHS_LONG[month]} ${ordinal(day)}`
    case "short": return `${MONTHS_SHORT[month]} ${ordinal(day)}`
    case "abbr": return `${MONTHS_ABBR[month]} ${day}`
    case "numeric": return `${mm}/${dd}/${year}`
    case "numericShort": return `${mm}/${dd}`
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

let intervalId: ReturnType<typeof setInterval> | null = null
let colonVisible = true

function renderClock(): void {
  const el = document.getElementById("clock")
  if (!el) return

  const enabled = store.sync.get("clockEnabled")
  if (!enabled) {
    el.hidden = true
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    return
  }

  el.hidden = false
  const now = new Date()
  const showSeconds = store.sync.get("clockShowSeconds")
  const is24h = store.sync.get("clock24Hour")
  const showAmPm = !is24h && store.sync.get("clockShowAmPm")
  const showDate = store.sync.get("clockShowDate")
  const dateFormat = store.sync.get("clockDateFormat")
  const size = store.sync.get("clockSize")

  let hours = now.getHours()
  let ampm = ""
  if (!is24h) {
    ampm = hours >= 12 ? "PM" : "AM"
    hours = hours % 12 || 12
  }

  const colonOpacity = colonVisible ? "1" : "0.5"
  const colon = `<span style="opacity:${colonOpacity}">:</span>`

  let timeHtml = `${is24h ? pad(hours) : hours}${colon}${pad(now.getMinutes())}`
  if (showSeconds) {
    timeHtml += `${colon}${pad(now.getSeconds())}`
  }
  if (showAmPm) {
    timeHtml += ` <span style="font-size:0.4em;vertical-align:super">${ampm}</span>`
  }

  let html = `<div style="font-size:${SIZE_MAP[size]};line-height:1">${timeHtml}</div>`
  if (showDate) {
    html += `<div class="text-white/70 mt-1" style="font-size:${size === "small" ? "0.875rem" : size === "medium" ? "1.125rem" : "1.5rem"}">${formatDate(now, dateFormat)}</div>`
  }

  el.innerHTML = html

  if (intervalId === null) {
    intervalId = setInterval(() => {
      colonVisible = !colonVisible
      renderClock()
    }, 1000)
  }
}

export function initClock(): void {
  renderClock()

  const keys: (keyof SyncSettings)[] = [
    "clockEnabled", "clockShowSeconds", "clock24Hour",
    "clockShowAmPm", "clockShowDate", "clockDateFormat", "clockSize",
  ]
  for (const key of keys) {
    store.sync.subscribe(key, () => renderClock())
  }
}
