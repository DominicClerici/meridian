import { store } from "./store"
import type { SyncSettings, WorldClock } from "./defaults"
import { ACCENT_COLORS, LAYOUT_MODES, MAX_WORLD_CLOCKS } from "./defaults"
import {
  authenticate as spotifyAuthenticate,
  clearTokens as spotifyClearTokens,
} from "./spotify"
import {
  authenticate as calendarAuthenticate,
  disconnect as calendarDisconnect,
} from "./calendar"
import {
  authenticate as mailAuthenticate,
  disconnect as mailDisconnect,
} from "./mail"
import {
  createAccordion,
  createButton,
  createCheckbox,
  createDialog,
  createInput,
  createSelect,
  createTooltip,
} from "./components"
import { icon, getIconSvg } from "./icons/registry"
import { canEditLayout, startLayoutEdit } from "./layout-edit"
import { searchPhotos, TOPICS } from "./unsplash"
import {
  setUnsplashPhoto,
  setUploadedPhoto,
  switchToColor,
  reapplyUpload,
  refreshDailyNow,
} from "./background"
import { idbGet } from "./idb"
import type { UnsplashPhoto } from "./unsplash"
import {
  GEO_FAILURE_TEXT,
  getStoredLocation,
  requestDeviceLocation,
  searchCity,
  setLocation,
} from "./location"
import type { GeocodeResult } from "./location"
import { refreshWeather } from "./weather"
import { probeCapabilities } from "./capabilities"
import type { Capability } from "./capabilities"
import { getRedirectUri } from "./google-auth"
import {
  authenticateDevice as githubAuthenticate,
  cancelDeviceFlow as githubCancelFlow,
  connectWithToken as githubConnectWithToken,
  clearTokens as githubClearTokens,
} from "./github-auth"
import {
  authenticateOAuth as linearAuthenticate,
  connectWithApiKey as linearConnectWithApiKey,
  disconnect as linearDisconnect,
  getClientId as linearGetClientId,
} from "./linear-auth"
import { GITHUB_SECTIONS, LINEAR_SECTIONS } from "./defaults"
import type { GithubSection, LinearSection, MailCategory, MailCountSource } from "./defaults"
import { MAIL_CATEGORIES } from "./defaults"
import { onSettingsTick } from "./world-clocks"
import {
  displayTime,
  searchZones,
  utcOffsetLabel,
  zoneInfo,
  zoneOffsetMinutes,
  zoneTime,
} from "./timezones"
import type { ZoneInfo } from "./timezones"

const TABS = [
  { id: "general", label: "General", iconName: "tabGeneral" },
  { id: "shortcuts", label: "Shortcuts", iconName: "tabShortcuts" },
  { id: "appearance", label: "Appearance", iconName: "tabAppearance" },
  { id: "widgets", label: "Widgets", iconName: "tabWidgets" },
  { id: "advanced", label: "Advanced", iconName: "tabAdvanced" },
]

function settingsRow(
  label: string,
  control: HTMLElement,
  opts?: { hidden?: boolean }
): HTMLElement {
  const row = document.createElement("div")
  row.className =
    "flex items-center justify-between py-3 border-b border-input-border/10 last:border-b-0"
  if (opts?.hidden) row.hidden = true

  const labelEl = document.createElement("span")
  labelEl.className = "text-sm text-foreground"
  labelEl.textContent = label

  row.appendChild(labelEl)
  row.appendChild(control)
  return row
}

let selectTabFn: ((tabId: string) => void) | null = null

function selectTab(tabId: string): void {
  selectTabFn?.(tabId)
}

let openDialogFn: (() => void) | null = null
let closeDialogFn: (() => void) | null = null
/** Re-checked on open: which widgets are on decides whether there is anything
    to rearrange, and that is settled two tabs away. */
let refreshRearrangeFn: (() => void) | null = null

/** Accordions that something outside settings can deep-link to, by id. */
const sectionHooks: Record<string, () => void> = {}

/**
 * Open the dialog, optionally on a given tab and scrolled to a given section.
 * Widgets use this to point at their own settings from an inline link.
 */
export function openSettings(tabId?: string, sectionId?: string): void {
  openDialogFn?.()
  if (tabId) selectTab(tabId)
  if (sectionId) {
    requestAnimationFrame(() => sectionHooks[sectionId]?.())
  }
}

/** Closes the dialog, for a flow that continues on the page behind it. */
export function closeSettings(): void {
  closeDialogFn?.()
}

/** Buttons from `createButton` put the label in the last span; icons come first. */
function setButtonLabel(btn: HTMLButtonElement, text: string): void {
  const spans = btn.querySelectorAll("span")
  const target = spans[spans.length - 1]
  if (target) target.textContent = text
}

function statusText(): HTMLParagraphElement {
  const el = document.createElement("p")
  el.className = "text-xs text-muted mt-1"
  el.hidden = true
  return el
}

function showStatus(el: HTMLParagraphElement, text: string, isError: boolean): void {
  el.textContent = text
  el.className = isError ? "text-xs text-danger mt-1" : "text-xs text-muted mt-1"
  el.hidden = false
}

/* ── World clocks ───────────────────────────────────────────────────────── */

function readWorldClocks(): WorldClock[] {
  return store.sync.get("worldClocks")
}

function writeWorldClocks(clocks: WorldClock[]): void {
  store.sync.set("worldClocks", clocks.slice(0, MAX_WORLD_CLOCKS))
}

/** A city and its current time, for one row of the picker. */
function pickerOption(
  zone: ZoneInfo,
  alreadyAdded: boolean,
  onPick: () => void
): HTMLButtonElement {
  const option = document.createElement("button")
  option.type = "button"
  option.className = "wc-picker-option"
  option.dataset.zone = zone.id
  option.disabled = alreadyAdded

  const names = document.createElement("div")
  names.className = "wc-picker-names"
  const city = document.createElement("div")
  city.className = "wc-picker-city"
  city.textContent = zone.city
  const region = document.createElement("div")
  region.className = "wc-picker-region"
  region.textContent = alreadyAdded
    ? `${zone.region || zone.id} · already added`
    : zone.region || zone.id
  names.append(city, region)

  const side = document.createElement("div")
  side.className = "wc-picker-side"
  const time = document.createElement("div")
  time.className = "wc-picker-time"
  const offset = document.createElement("div")
  offset.className = "wc-picker-offset"
  side.append(time, offset)

  option.append(names, side)

  onSettingsTick(option, (now) => {
    const t = zoneTime(zone.id, now)
    const shown = displayTime(t, {
      hour24: store.sync.get("clock24Hour"),
      seconds: false,
    })
    time.textContent = shown.meridiem ? `${shown.time} ${shown.meridiem}` : shown.time
    offset.textContent = utcOffsetLabel(zoneOffsetMinutes(zone.id, now))
  })

  if (!alreadyAdded) option.addEventListener("click", onPick)
  return option
}

/**
 * The Add-clock control. It is one slot that swaps between a button and a live
 * search panel rather than a popover, so it can't detach from the row it
 * belongs to when the settings panel scrolls.
 */
function buildWorldClockPicker(opts: {
  onAdd: (zone: ZoneInfo) => void
  canAdd: () => boolean
}): { el: HTMLElement; refresh: () => void; collapse: () => void } {
  const host = document.createElement("div")
  host.className = "mt-1"

  const addBtn = createButton("Add clock", "outline", {
    icon: getIconSvg("plus"),
    onClick: () => expand(),
  })
  addBtn.className += " self-start"

  const picker = document.createElement("div")
  picker.className = "wc-picker"
  picker.hidden = true

  const search = createInput({
    placeholder: "Search cities and timezones…",
    className: "wc-picker-search",
  }) as HTMLInputElement

  const results = document.createElement("div")
  results.className = "wc-picker-results"
  picker.append(search, results)

  host.append(addBtn, picker)

  let highlighted = 0
  let shown: ZoneInfo[] = []

  function paintHighlight(): void {
    const options = [...results.querySelectorAll<HTMLElement>(".wc-picker-option")]
    options.forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === highlighted))
    })
    options[highlighted]?.scrollIntoView({ block: "nearest" })
  }

  function renderResults(): void {
    const taken = new Set(readWorldClocks().map((c) => c.timezone))
    shown = searchZones(search.value)
    results.replaceChildren()

    if (shown.length === 0) {
      const empty = document.createElement("div")
      empty.className = "text-xs text-muted px-2 py-3"
      empty.textContent = "No timezone matches that."
      results.appendChild(empty)
      return
    }

    for (const zone of shown) {
      results.appendChild(
        pickerOption(zone, taken.has(zone.id), () => {
          opts.onAdd(zone)
          if (opts.canAdd()) {
            search.value = ""
            renderResults()
            highlighted = 0
            paintHighlight()
            search.focus()
          } else {
            collapse()
          }
        })
      )
    }
    highlighted = Math.min(highlighted, shown.length - 1)
    paintHighlight()
  }

  function expand(): void {
    addBtn.hidden = true
    picker.hidden = false
    search.value = ""
    highlighted = 0
    renderResults()
    search.focus()
    // The list opens at the foot of a scrolling panel, so it starts out below
    // the fold more often than not.
    picker.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  function collapse(): void {
    picker.hidden = true
    addBtn.hidden = false
    results.replaceChildren()
  }

  search.addEventListener("input", () => {
    highlighted = 0
    renderResults()
  })

  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      collapse()
      addBtn.focus()
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const step = e.key === "ArrowDown" ? 1 : -1
      highlighted = Math.max(0, Math.min(shown.length - 1, highlighted + step))
      paintHighlight()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const option = results.querySelectorAll<HTMLButtonElement>(".wc-picker-option")[
        highlighted
      ]
      if (option && !option.disabled) option.click()
    }
  })

  function refresh(): void {
    addBtn.disabled = !opts.canAdd()
    addBtn.style.opacity = addBtn.disabled ? "0.45" : ""
    addBtn.style.cursor = addBtn.disabled ? "not-allowed" : ""
    if (addBtn.disabled && !picker.hidden) collapse()
    if (!picker.hidden) renderResults()
  }

  return { el: host, refresh, collapse }
}

function buildWorldClocksSection(): HTMLElement {
  const section = document.createElement("div")

  const heading = document.createElement("div")
  heading.className =
    "flex items-baseline justify-between gap-3 mt-6 mb-1 pt-4 border-t border-input-border/10"
  const title = document.createElement("h3")
  title.className = "text-[11px] uppercase tracking-wider text-muted"
  title.textContent = "World clocks"
  const count = document.createElement("span")
  count.className = "text-[11px] text-muted tabular-nums shrink-0"
  heading.append(title, count)
  section.appendChild(heading)

  const blurb = document.createElement("p")
  blurb.className = "text-xs text-muted mb-2"
  blurb.textContent =
    "Extra timezones beside your clock. They follow the 24-hour and seconds settings above."
  section.appendChild(blurb)

  const list = document.createElement("div")
  list.className = "flex flex-col"
  section.appendChild(list)

  const empty = document.createElement("p")
  empty.className = "text-xs text-muted py-2"
  empty.textContent = "No world clocks yet."
  section.appendChild(empty)

  const picker = buildWorldClockPicker({
    canAdd: () => readWorldClocks().length < MAX_WORLD_CLOCKS,
    onAdd: (zone) => {
      const clocks = readWorldClocks()
      if (clocks.length >= MAX_WORLD_CLOCKS) return
      if (clocks.some((c) => c.timezone === zone.id)) return
      writeWorldClocks([
        ...clocks,
        { id: crypto.randomUUID(), timezone: zone.id, label: zone.city },
      ])
    },
  })
  section.appendChild(picker.el)

  let dragId: string | null = null

  function clearDropMarks(): void {
    for (const row of list.querySelectorAll(".wc-settings-row")) {
      row.classList.remove("is-drop-target")
    }
  }

  function buildRow(clock: WorldClock): HTMLElement {
    const zone = zoneInfo(clock.timezone)

    const row = document.createElement("div")
    row.className = "wc-settings-row"
    row.dataset.id = clock.id
    row.draggable = true

    const grip = icon("dragHandle", { size: 12 })
    grip.classList.add("wc-settings-grip")
    row.appendChild(grip)

    const label = document.createElement("input")
    label.className = "wc-settings-label"
    label.value = clock.label
    label.setAttribute("aria-label", `Name for ${zone.city}`)
    label.maxLength = 24
    // While the field has focus, selecting text inside it must not drag the row.
    label.addEventListener("focus", () => {
      row.draggable = false
    })
    const commit = (): void => {
      const next = label.value.trim() || zone.city
      label.value = next
      if (next === clock.label) return
      writeWorldClocks(
        readWorldClocks().map((c) => (c.id === clock.id ? { ...c, label: next } : c))
      )
    }
    label.addEventListener("change", commit)
    label.addEventListener("blur", () => {
      row.draggable = true
    })
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter") label.blur()
      if (e.key === "Escape") {
        label.value = clock.label
        label.blur()
      }
    })
    row.appendChild(label)

    const zoneLabel = document.createElement("span")
    zoneLabel.className = "wc-settings-zone"
    row.appendChild(zoneLabel)

    const time = document.createElement("span")
    time.className = "wc-settings-time"
    row.appendChild(time)

    onSettingsTick(row, (now) => {
      const t = zoneTime(clock.timezone, now)
      const shown = displayTime(t, {
        hour24: store.sync.get("clock24Hour"),
        seconds: store.sync.get("clockShowSeconds"),
      })
      time.textContent = shown.meridiem ? `${shown.time} ${shown.meridiem}` : shown.time
      zoneLabel.textContent = `${zone.city} · ${utcOffsetLabel(
        zoneOffsetMinutes(clock.timezone, now)
      )}`
    })

    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "wc-settings-remove"
    remove.setAttribute("aria-label", `Remove ${clock.label}`)
    remove.appendChild(icon("trash", { size: 13 }))
    remove.addEventListener("click", () => {
      writeWorldClocks(readWorldClocks().filter((c) => c.id !== clock.id))
    })
    row.appendChild(remove)

    return row
  }

  function render(): void {
    const clocks = readWorldClocks()
    list.replaceChildren(...clocks.map(buildRow))
    empty.hidden = clocks.length > 0
    count.textContent = `${clocks.length} / ${MAX_WORLD_CLOCKS}`
    picker.refresh()
  }

  list.addEventListener("dragstart", (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".wc-settings-row")
    if (!row) return
    dragId = row.dataset.id!
    row.classList.add("is-dragging")
    e.dataTransfer!.effectAllowed = "move"
  })

  list.addEventListener("dragend", (e: DragEvent) => {
    ;(e.target as HTMLElement)
      .closest<HTMLElement>(".wc-settings-row")
      ?.classList.remove("is-dragging")
    dragId = null
    clearDropMarks()
  })

  list.addEventListener("dragover", (e: DragEvent) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = "move"
    clearDropMarks()
    const row = (e.target as HTMLElement).closest<HTMLElement>(".wc-settings-row")
    if (row && row.dataset.id !== dragId) row.classList.add("is-drop-target")
  })

  list.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault()
    const row = (e.target as HTMLElement).closest<HTMLElement>(".wc-settings-row")
    const toId = row?.dataset.id
    if (!dragId || !toId || toId === dragId) return

    const clocks = readWorldClocks()
    const from = clocks.findIndex((c) => c.id === dragId)
    const to = clocks.findIndex((c) => c.id === toId)
    if (from === -1 || to === -1) return
    const next = [...clocks]
    next.splice(to, 0, ...next.splice(from, 1))
    writeWorldClocks(next)
  })

  render()
  store.sync.subscribe("worldClocks", render)
  // The rows print the time in the main clock's format, so a change there has
  // to redraw them the way it redraws the chips on the page.
  store.sync.subscribe("clock24Hour", render)
  store.sync.subscribe("clockShowSeconds", render)

  return section
}

function buildGeneralTab(): void {
  const panel = document.querySelector('[data-settings-tab="general"]')!
  panel.className = "settings-panel px-6 pb-6"

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const clockEnabled = createCheckbox("", store.sync.get("clockEnabled"), (v) =>
    store.sync.set("clockEnabled", v)
  )
  wrapper.appendChild(settingsRow("Show clock", clockEnabled))

  const clockSeconds = createCheckbox(
    "",
    store.sync.get("clockShowSeconds"),
    (v) => store.sync.set("clockShowSeconds", v)
  )
  wrapper.appendChild(settingsRow("Show seconds", clockSeconds))

  const clock24h = createCheckbox("", store.sync.get("clock24Hour"), (v) => {
    store.sync.set("clock24Hour", v)
    ampmRow.hidden = v
  })
  wrapper.appendChild(settingsRow("24-hour format", clock24h))

  const clockAmPm = createCheckbox("", store.sync.get("clockShowAmPm"), (v) =>
    store.sync.set("clockShowAmPm", v)
  )
  const ampmRow = settingsRow("Show AM/PM", clockAmPm, {
    hidden: store.sync.get("clock24Hour"),
  })
  wrapper.appendChild(ampmRow)

  const clockDate = createCheckbox("", store.sync.get("clockShowDate"), (v) => {
    store.sync.set("clockShowDate", v)
    dateFormatRow.hidden = !v
  })
  wrapper.appendChild(settingsRow("Show date", clockDate))

  const clockDateFormat = createSelect({
    options: [
      { value: "long", label: "January 24th" },
      { value: "short", label: "Jan. 24th" },
      { value: "abbr", label: "Jan 24" },
      { value: "numeric", label: "01/24/2024" },
      { value: "numericShort", label: "01/24" },
    ],
    value: store.sync.get("clockDateFormat"),
    onChange: (v) =>
      store.sync.set("clockDateFormat", v as SyncSettings["clockDateFormat"]),
  })
  const dateFormatRow = settingsRow("Date format", clockDateFormat, {
    hidden: !store.sync.get("clockShowDate"),
  })
  wrapper.appendChild(dateFormatRow)

  const clockSize = createSelect({
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    value: store.sync.get("clockSize"),
    onChange: (v) =>
      store.sync.set("clockSize", v as SyncSettings["clockSize"]),
  })
  wrapper.appendChild(settingsRow("Size", clockSize))

  panel.appendChild(wrapper)
  panel.appendChild(buildWorldClocksSection())

  const sc = (el: HTMLLabelElement, v: boolean) => (el as any).setChecked(v)
  store.sync.subscribe("clockEnabled", (v) => {
    sc(clockEnabled, v)
  })
  store.sync.subscribe("clockShowSeconds", (v) => {
    sc(clockSeconds, v)
  })
  store.sync.subscribe("clock24Hour", (v) => {
    sc(clock24h, v)
    ampmRow.hidden = v
  })
  store.sync.subscribe("clockShowAmPm", (v) => {
    sc(clockAmPm, v)
  })
  store.sync.subscribe("clockShowDate", (v) => {
    sc(clockDate, v)
    dateFormatRow.hidden = !v
  })
  store.sync.subscribe("clockDateFormat", (v) => {
    clockDateFormat.value = v
  })
  store.sync.subscribe("clockSize", (v) => {
    clockSize.value = v
  })
}

const SWATCH_BG: Record<string, string> = {
  rose: "bg-swatch-rose",
  coral: "bg-swatch-coral",
  amber: "bg-swatch-amber",
  teal: "bg-swatch-teal",
  sky: "bg-swatch-sky",
  violet: "bg-swatch-violet",
  slate: "bg-swatch-slate",
  stone: "bg-swatch-stone",
  zinc: "bg-swatch-zinc",
  graphite: "bg-swatch-graphite",
}

function buildSwatchGroup(storeKey: "accentColor" | "bgColor"): HTMLElement {
  const isAccent = storeKey === "accentColor"
  const specialValue = isAccent ? "random" : "auto"

  const container = document.createElement("div")
  container.className = "flex gap-2.5 items-center flex-wrap"

  const buttons: HTMLButtonElement[] = []

  const specialBtn = document.createElement("button")
  specialBtn.className =
    "w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-input-border/50 text-muted"
  specialBtn.dataset.color = specialValue
  specialBtn.innerHTML = getIconSvg(isAccent ? "randomAccent" : "autoBg")
  specialBtn.addEventListener("click", () =>
    store.sync.set(storeKey, specialValue as any)
  )
  specialBtn.addEventListener("mouseenter", () => {
    if (store.sync.get(storeKey) !== specialValue)
      specialBtn.style.transform = "scale(1.1)"
  })
  specialBtn.addEventListener("mouseleave", () => {
    specialBtn.style.transform = ""
  })

  createTooltip(
    specialBtn,
    isAccent ? "Changes color daily" : "Matches accent color"
  )

  buttons.push(specialBtn)
  container.appendChild(specialBtn)

  for (const color of ACCENT_COLORS) {
    const btn = document.createElement("button")
    btn.className = `w-6 h-6 rounded-full ${SWATCH_BG[color]} flex items-center justify-center cursor-pointer transition-all duration-150`
    btn.dataset.color = color

    btn.addEventListener("click", () => store.sync.set(storeKey, color))
    btn.addEventListener("mouseenter", () => {
      if (store.sync.get(storeKey) !== color) btn.style.transform = "scale(1.1)"
    })
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = ""
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (const btn of buttons) {
      const color = btn.dataset.color!
      const isSelected = color === val
      const isSpecial = color === "random" || color === "auto"

      if (isSelected) {
        if (isSpecial) {
          btn.style.outline = "2px solid var(--accent)"
          btn.style.outlineOffset = "2px"
          btn.style.borderColor = "var(--accent)"
          btn.style.color = "var(--accent)"
        } else {
          btn.innerHTML = getIconSvg("swatchCheck")
          btn.style.outline = "2px solid"
          btn.style.outlineOffset = "2px"
          btn.style.outlineColor = `var(--swatch-${val})`
        }
        btn.style.transform = ""
      } else {
        if (isSpecial) {
          btn.style.outline = ""
          btn.style.outlineOffset = ""
          btn.style.borderColor = ""
          btn.style.color = ""
        } else {
          btn.innerHTML = ""
          btn.style.outline = ""
          btn.style.outlineOffset = ""
          btn.style.outlineColor = ""
        }
      }
    }
  }

  updateSelected(store.sync.get(storeKey))
  store.sync.subscribe(storeKey, updateSelected)

  return container
}

function buildLayoutSelector(): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col gap-2"

  const container = document.createElement("div")
  container.className = "grid grid-cols-3 gap-2"

  const META: Record<
    SyncSettings["layout"],
    { label: string; hint: string; preview: string }
  > = {
    default: {
      label: "Default",
      hint: "Search on top, widget cards beneath",
      preview: `<span class="lp-bar"></span>
        <div class="lp-row">
          <span class="lp-fill"></span><span class="lp-fill"></span><span class="lp-fill"></span>
        </div>`,
    },
    dashboard: {
      label: "Dashboard",
      hint: "Cards across the top, three-column grid below",
      preview: `<div class="lp-row" style="flex:0 0 7px">
          <span class="lp-fill"></span><span class="lp-fill"></span><span class="lp-fill"></span>
        </div>
        <div class="lp-row">
          <span class="lp-fill" style="flex:2"></span><span class="lp-fill"></span>
        </div>`,
    },
    immersive: {
      label: "Immersive",
      hint: "Everything behind triggers and popovers",
      preview: `<div class="lp-row" style="align-items:center;justify-content:center">
          <span class="lp-bar" style="flex:0 0 60%"></span>
        </div>`,
    },
  }

  const buttons: HTMLButtonElement[] = []

  for (const mode of LAYOUT_MODES) {
    const meta = META[mode]
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className =
      "flex flex-col items-center gap-2 p-2 border rounded-theme transition-colors text-xs font-medium"
    btn.title = meta.hint

    const preview = document.createElement("div")
    preview.className = "layout-preview"
    preview.innerHTML = meta.preview
    btn.appendChild(preview)

    const label = document.createElement("span")
    label.textContent = meta.label
    btn.appendChild(label)

    btn.addEventListener("click", () => store.sync.set("layout", mode))
    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    LAYOUT_MODES.forEach((mode, i) => {
      const btn = buttons[i]
      const selected = mode === val
      btn.setAttribute("aria-pressed", String(selected))
      btn.style.borderColor = "var(--accent)"
      btn.style.background = selected ? "var(--accent)" : "transparent"
      btn.style.color = selected ? "var(--accent-foreground)" : "var(--accent)"
    })
  }

  // Rearranging only means something where cards are packed by hand, so the
  // action rides with the Default preview rather than sitting on its own row.
  const rearrange = createButton("Rearrange widgets", "outline", {
    icon: icon("dragHandle", { size: 14 }),
    onClick: () => {
      closeSettings()
      startLayoutEdit()
    },
    className: "w-full justify-center disabled:opacity-40 disabled:pointer-events-none",
  })
  rearrange.title = "Drag widget cards into the arrangement you want"

  function updateRearrange(mode: string): void {
    rearrange.hidden = mode !== "default"
    rearrange.disabled = !canEditLayout()
  }
  refreshRearrangeFn = () => updateRearrange(store.sync.get("layout"))

  updateSelected(store.sync.get("layout"))
  updateRearrange(store.sync.get("layout"))
  store.sync.subscribe("layout", (v) => {
    updateSelected(v)
    updateRearrange(v)
  })

  wrapper.appendChild(container)
  wrapper.appendChild(rearrange)
  return wrapper
}

function buildModeSelector(): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-2"

  const modes: SyncSettings["mode"][] = ["light", "dark", "auto"]
  const buttons: HTMLButtonElement[] = []

  for (const mode of modes) {
    const modeIconName =
      mode === "light" ? "modeLight" : mode === "dark" ? "modeDark" : "modeAuto"
    const btn = createButton(
      mode.charAt(0).toUpperCase() + mode.slice(1),
      "override",
      {
        icon: icon(modeIconName),
      }
    )
    btn.className +=
      " flex-1 justify-center py-2 border rounded-theme transition-colors"

    btn.addEventListener("click", () => {
      store.sync.set("mode", mode)
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (let i = 0; i < modes.length; i++) {
      const btn = buttons[i]
      const isSelected = modes[i] === val

      btn.style.background = ""
      btn.style.color = ""
      btn.style.borderColor = ""

      if (isSelected) {
        if (modes[i] === "light") {
          btn.style.background = "var(--mode-light-bg)"
          btn.style.color = "var(--mode-light-fg)"
          btn.style.borderColor = "var(--mode-light-fg)"
        } else if (modes[i] === "dark") {
          btn.style.background = "var(--mode-dark-bg)"
          btn.style.color = "var(--mode-dark-fg)"
          btn.style.borderColor = "var(--mode-dark-fg)"
        } else {
          btn.style.background = "var(--accent)"
          btn.style.color = "var(--accent-foreground)"
          btn.style.borderColor = "var(--accent)"
        }
      } else {
        btn.style.borderColor = "var(--accent)"
        btn.style.color = "var(--accent)"
        btn.style.background = "transparent"
      }
    }
  }

  updateSelected(store.sync.get("mode"))
  store.sync.subscribe("mode", updateSelected)

  return container
}

function buildColorAccordion(defaultOpen: boolean): {
  container: HTMLElement
  content: HTMLElement
} {
  const acc = createAccordion("Color", {
    variant: "settings",
    defaultOpen,
  })
  const swatches = buildSwatchGroup("bgColor")

  for (const btn of swatches.querySelectorAll(
    "button"
  ) as NodeListOf<HTMLButtonElement>) {
    btn.addEventListener("click", () => {
      if (store.sync.get("bgSource") !== "color") {
        switchToColor()
      }
    })
  }

  acc.content.appendChild(swatches)
  return acc
}

function buildUnsplashAccordion(defaultOpen: boolean): {
  container: HTMLElement
  content: HTMLElement
} {
  const acc = createAccordion("Unsplash", {
    variant: "settings",
    defaultOpen,
  })

  const hasKey = (): boolean => store.sync.get("unsplashApiKey") !== ""

  const noKeyMsg = document.createElement("p")
  noKeyMsg.className = "text-xs text-muted"
  noKeyMsg.innerHTML = `Add your Unsplash API key in the <strong>Advanced</strong> tab to enable.`

  const controls = document.createElement("div")
  controls.className = "flex flex-col gap-3"

  const dailyRow = document.createElement("div")
  dailyRow.className = "flex items-center gap-2"

  const dailyCheck = createCheckbox(
    "",
    store.sync.get("unsplashDaily"),
    (v) => {
      store.sync.set("unsplashDaily", v)
      updateDailyState()
      if (v) {
        const meta = store.local.get("bgUnsplashMeta")
        if (!meta || isStale(meta.cachedAt)) {
          refreshDailyNow().catch(() => {})
        } else {
          store.sync.set("bgSource", "unsplash")
        }
      }
    }
  )
  dailyRow.appendChild(dailyCheck)

  const dailyLabel = document.createElement("span")
  dailyLabel.className = "text-sm font-medium text-foreground"
  dailyLabel.textContent = "Refresh daily"
  dailyRow.appendChild(dailyLabel)

  const fromLabel = document.createElement("span")
  fromLabel.className = "text-xs text-accent"
  fromLabel.textContent = "from"
  dailyRow.appendChild(fromLabel)

  const topicSelect = createSelect({
    options: TOPICS.map((t) => ({ value: t.slug, label: t.label })),
    value: store.sync.get("unsplashTopic"),
    onChange: (v) => {
      store.sync.set("unsplashTopic", v)
      if (store.sync.get("unsplashDaily")) {
        refreshDailyNow().catch(() => {})
      }
    },
    width: "120px",
  })
  dailyRow.appendChild(topicSelect)

  const spacer = document.createElement("div")
  spacer.className = "flex-1"
  dailyRow.appendChild(spacer)

  const refreshBtn = createButton("Refresh", "ghost", {
    onClick: () => {
      refreshDailyNow().catch(() => {})
    },
  })
  dailyRow.appendChild(refreshBtn)

  controls.appendChild(dailyRow)

  const searchArea = document.createElement("div")
  searchArea.className = "flex flex-col gap-2 transition-opacity"
  searchArea.style.containerType = "inline-size"

  const searchRow = document.createElement("div")
  searchRow.className = "relative"
  const searchInput = createInput({ placeholder: "Search photos..." })
  searchRow.appendChild(searchInput)

  const clearBtn = document.createElement("button")
  clearBtn.className =
    "absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors cursor-pointer"
  clearBtn.appendChild(icon("close", { size: 14 }))
  clearBtn.hidden = true
  clearBtn.addEventListener("click", () => {
    ;(searchInput as HTMLInputElement).value = ""
    clearBtn.hidden = true
    hasResults = false
    renderEmpty()
  })
  searchRow.appendChild(clearBtn)
  searchArea.appendChild(searchRow)

  const gridScroll = document.createElement("div")
  gridScroll.className = "rounded-theme"
  gridScroll.style.height = `calc((100cqi - 12px) / 3 * 10 / 16 * 2 + 6px)`
  gridScroll.style.overflow = "hidden"
  searchArea.appendChild(gridScroll)

  const grid = document.createElement("div")
  grid.className = "grid grid-cols-3 gap-1.5 p-1"
  gridScroll.appendChild(grid)

  let searchTimeout: number | null = null
  let hasResults = false

  function renderEmpty(): void {
    grid.innerHTML = ""
    gridScroll.style.overflow = "hidden"
    const wrapper = document.createElement("div")
    wrapper.className = "col-span-3 relative grid grid-cols-3 gap-1.5"
    for (let i = 0; i < 6; i++) {
      const box = document.createElement("div")
      box.className = "aspect-[16/10] rounded bg-input-border/15"
      wrapper.appendChild(box)
    }
    const overlay = document.createElement("div")
    overlay.className =
      "absolute inset-0 flex items-center justify-center text-xs text-muted"
    overlay.textContent = "Search with Unsplash..."
    wrapper.appendChild(overlay)
    grid.appendChild(wrapper)
  }
  renderEmpty()

  function doSearch(): void {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = window.setTimeout(async () => {
      const query = (searchInput as HTMLInputElement).value.trim()
      clearBtn.hidden = !query
      if (!query) {
        hasResults = false
        renderEmpty()
        return
      }
      try {
        const photos = await searchPhotos(query)
        renderGrid(photos)
      } catch {
        grid.innerHTML = `<p class="text-xs text-danger col-span-3 flex items-center justify-center">Search failed. Check your API key.</p>`
      }
    }, 500)
  }

  searchInput.addEventListener("input", doSearch)

  function renderGrid(photos: UnsplashPhoto[]): void {
    grid.innerHTML = ""
    hasResults = true
    gridScroll.style.overflow = "auto"
    for (const photo of photos) {
      const thumb = document.createElement("button")
      thumb.className =
        "aspect-[16/10] rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all"
      thumb.style.background = `url(${photo.urls.small}) center/cover`

      thumb.addEventListener("click", async () => {
        thumb.style.opacity = "0.5"
        thumb.style.pointerEvents = "none"
        try {
          store.sync.set("unsplashDaily", false)
          await setUnsplashPhoto(photo)
        } catch {
          // restore on failure
        }
        thumb.style.opacity = ""
        thumb.style.pointerEvents = ""
      })

      grid.appendChild(thumb)
    }
  }

  controls.appendChild(searchArea)

  function isStale(cachedAt: number): boolean {
    return new Date(cachedAt).toDateString() !== new Date().toDateString()
  }

  function updateDailyState(): void {
    const daily = store.sync.get("unsplashDaily")
    searchArea.style.opacity = daily ? "0.4" : ""
    searchArea.style.pointerEvents = daily ? "none" : ""
    topicSelect.style.opacity = daily ? "" : "0.4"
    topicSelect.style.pointerEvents = daily ? "" : "none"
    refreshBtn.style.opacity = daily ? "" : "0.4"
    refreshBtn.style.pointerEvents = daily ? "" : "none"
  }
  updateDailyState()

  function updateVisibility(): void {
    const key = hasKey()
    noKeyMsg.hidden = key
    controls.hidden = !key
  }
  updateVisibility()
  store.sync.subscribe("unsplashApiKey", () => updateVisibility())
  store.sync.subscribe("unsplashDaily", (v) => {
    ;(dailyCheck as any).setChecked(v)
    updateDailyState()
  })
  store.sync.subscribe("unsplashTopic", (v) => {
    topicSelect.value = v
  })

  acc.content.appendChild(noKeyMsg)
  acc.content.appendChild(controls)

  return acc
}

function buildUploadAccordion(defaultOpen: boolean): {
  container: HTMLElement
  content: HTMLElement
} {
  const acc = createAccordion("Upload", {
    variant: "settings",
    defaultOpen,
  })

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = "image/*"
  fileInput.hidden = true
  acc.content.appendChild(fileInput)

  function getPreviewWidth(): number {
    const ratio = window.innerWidth / window.innerHeight
    return Math.min(Math.round(180 * ratio), 550)
  }

  const previewBox = document.createElement("button")
  previewBox.className =
    "rounded-theme overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-accent"
  previewBox.style.height = "180px"
  previewBox.style.width = `${getPreviewWidth()}px`
  previewBox.style.maxWidth = "100%"
  acc.content.appendChild(previewBox)

  const placeholder = document.createElement("div")
  placeholder.className =
    "w-full h-full flex items-center justify-center border-2 border-dashed border-input-border/40 rounded-theme text-muted"
  placeholder.appendChild(icon("plus", { size: 24 }))
  previewBox.appendChild(placeholder)

  let hasImage = false
  let previewUrl: string | null = null

  previewBox.addEventListener("click", () => {
    if (hasImage) {
      reapplyUpload()
    } else {
      fileInput.click()
    }
  })

  const updateBtn = createButton("Update image", "outline", {
    icon: icon("bgUpload"),
    onClick: () => fileInput.click(),
  })
  updateBtn.className += " mt-2"
  updateBtn.hidden = true
  acc.content.appendChild(updateBtn)

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    updateBtn.disabled = true
    try {
      await setUploadedPhoto(file)
      loadPreview()
    } catch {
      // silently fail
    }
    updateBtn.disabled = false
    fileInput.value = ""
  })

  function loadPreview(): void {
    const meta = store.local.get("bgUploadMeta")
    if (!meta) {
      hasImage = false
      placeholder.hidden = false
      previewBox.style.backgroundImage = ""
      updateBtn.hidden = true
      return
    }
    idbGet("upload").then((blob) => {
      if (!blob) {
        hasImage = false
        placeholder.hidden = false
        previewBox.style.backgroundImage = ""
        updateBtn.hidden = true
        return
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      previewUrl = URL.createObjectURL(blob)
      previewBox.style.background = `url(${previewUrl}) center/cover`
      placeholder.hidden = true
      hasImage = true
      updateBtn.hidden = false
    })
  }
  loadPreview()

  let resizeTimer: number | null = null
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      previewBox.style.width = `${getPreviewWidth()}px`
    }, 300)
  })

  const note = document.createElement("p")
  note.className = "text-xs text-muted mt-2"
  note.textContent = "Local images do not sync across devices."
  acc.content.appendChild(note)

  return acc
}

function buildAppearanceTab(): void {
  const panel = document.querySelector('[data-settings-tab="appearance"]')!
  panel.className = "settings-panel px-6 pb-6 flex flex-col gap-6"

  function section(labelText: string, child: HTMLElement): HTMLElement {
    const el = document.createElement("div")
    el.className = "flex flex-col gap-3"
    const lbl = document.createElement("span")
    lbl.className = "text-muted text-xs font-medium"
    lbl.textContent = labelText
    el.appendChild(lbl)
    el.appendChild(child)
    return el
  }

  const themeSelect = createSelect({
    options: [{ value: "modern", label: "Modern" }],
    value: store.sync.get("theme"),
    onChange: (v) => store.sync.set("theme", v as SyncSettings["theme"]),
  })
  store.sync.subscribe("theme", (v) => {
    themeSelect.value = v
  })

  const themeRow = document.createElement("div")
  themeRow.className = "flex items-center justify-between"
  const themeLbl = document.createElement("span")
  themeLbl.className = "text-sm text-foreground"
  themeLbl.textContent = "Theme"
  themeRow.appendChild(themeLbl)
  themeRow.appendChild(themeSelect)
  panel.appendChild(themeRow)

  panel.appendChild(section("Layout", buildLayoutSelector()))
  panel.appendChild(section("Accent Color", buildSwatchGroup("accentColor")))
  panel.appendChild(section("Mode", buildModeSelector()))

  const bgWrapper = document.createElement("div")
  bgWrapper.className = "flex flex-col gap-0"

  const bgLabel = document.createElement("span")
  bgLabel.className = "text-muted text-xs font-medium mb-3"
  bgLabel.textContent = "Background"
  bgWrapper.appendChild(bgLabel)

  const source = store.sync.get("bgSource")
  const colorAcc = buildColorAccordion(source === "color")
  const unsplashAcc = buildUnsplashAccordion(source === "unsplash")
  const uploadAcc = buildUploadAccordion(source === "upload")

  bgWrapper.appendChild(colorAcc.container)
  bgWrapper.appendChild(unsplashAcc.container)
  bgWrapper.appendChild(uploadAcc.container)

  function updateActiveIndicator(): void {
    const source = store.sync.get("bgSource")
    const accMap: [string, { container: HTMLElement }][] = [
      ["color", colorAcc],
      ["unsplash", unsplashAcc],
      ["upload", uploadAcc],
    ]
    for (const [key, acc] of accMap) {
      const trigger = acc.container.querySelector("button") as HTMLElement
      if (!trigger) continue
      trigger.style.borderLeft = source === key ? "3px solid var(--accent)" : ""
      trigger.style.paddingLeft = source === key ? "21px" : ""
    }
  }

  updateActiveIndicator()
  store.sync.subscribe("bgSource", () => updateActiveIndicator())

  panel.appendChild(bgWrapper)
}

function describeLocation(): string {
  const loc = getStoredLocation()
  if (!loc) return "Not set"

  const name = loc.label ?? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`
  const origin =
    loc.source === "device"
      ? "from your device"
      : loc.source === "manual"
        ? "set manually"
        : "estimated from your timezone"
  return `${name} · ${origin}`
}

/**
 * Device location, then a city search. The device path can fail permanently on
 * browsers with no location provider, so the manual path is always visible
 * rather than hidden behind a failure.
 */
function buildLocationControls(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-2 py-3"

  const header = document.createElement("div")
  header.className = "flex items-center justify-between gap-3"
  const label = document.createElement("span")
  label.className = "text-sm text-foreground shrink-0"
  label.textContent = "Location"
  const value = document.createElement("span")
  value.className = "text-sm text-muted text-right truncate min-w-0"
  header.appendChild(label)
  header.appendChild(value)
  wrap.appendChild(header)

  const status = statusText()

  function update(): void {
    value.textContent = describeLocation()
  }
  update()

  const deviceBtn = createButton("Use device location", "outline", {
    onClick: async () => {
      deviceBtn.disabled = true
      setButtonLabel(deviceBtn, "Locating…")
      status.hidden = true

      const result = await requestDeviceLocation()

      deviceBtn.disabled = false
      setButtonLabel(deviceBtn, "Use device location")

      if (result.ok) {
        setLocation(result.lat, result.lon, null, "device")
        refreshWeather()
        update()
        showStatus(status, "Location updated from your device.", false)
      } else {
        showStatus(status, GEO_FAILURE_TEXT[result.reason], true)
      }
    },
  })
  deviceBtn.className += " self-start"
  wrap.appendChild(deviceBtn)

  const searchInput = createInput({
    placeholder: "Or search for a city…",
  }) as HTMLInputElement
  wrap.appendChild(searchInput)

  const results = document.createElement("div")
  results.className = "flex flex-col gap-0.5"
  wrap.appendChild(results)
  wrap.appendChild(status)

  function renderResults(hits: GeocodeResult[]): void {
    results.replaceChildren()
    if (hits.length === 0) {
      showStatus(status, "No matching city found.", false)
      return
    }
    status.hidden = true

    for (const hit of hits) {
      const item = document.createElement("button")
      item.className =
        "text-left text-sm px-2 py-1.5 rounded-theme text-foreground hover:bg-surface transition-colors"
      item.textContent = hit.label
      item.addEventListener("click", () => {
        setLocation(hit.lat, hit.lon, hit.label, "manual")
        refreshWeather()
        update()
        searchInput.value = ""
        results.replaceChildren()
        showStatus(status, `Weather now uses ${hit.label}.`, false)
      })
      results.appendChild(item)
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchAbort: AbortController | null = null

  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchAbort?.abort()

    const query = searchInput.value.trim()
    if (query.length < 2) {
      results.replaceChildren()
      return
    }

    searchTimer = setTimeout(async () => {
      const controller = new AbortController()
      searchAbort = controller
      try {
        renderResults(await searchCity(query, controller.signal))
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        results.replaceChildren()
        showStatus(status, "City search failed — check your connection.", true)
      }
    }, 300)
  })

  store.local.subscribe("weatherLocationSource", update)

  return wrap
}

function createSpotifyButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className =
    "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors text-white"
  btn.style.background = "#1DB954"

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#1aa34a"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#1DB954"
  })

  const icon = document.createElement("div")
  icon.style.cssText =
    "width: 16px; height: 16px; background: #1ed760; border-radius: 2px; flex-shrink: 0;"
  btn.appendChild(icon)

  const label = document.createElement("span")
  label.textContent = "Connect Spotify"
  btn.appendChild(label)

  btn.addEventListener("click", onClick)
  return btn
}

function createGoogleButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className =
    "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors"
  btn.style.cssText =
    "background: #ffffff; color: #3c4043; border: 1px solid #dadce0;"

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#f8f9fa"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#ffffff"
  })

  const icon = document.createElement("div")
  icon.style.cssText =
    "width: 16px; height: 16px; background: #4285F4; border-radius: 2px; flex-shrink: 0;"
  btn.appendChild(icon)

  const label = document.createElement("span")
  label.textContent = "Sign in with Google"
  btn.appendChild(label)

  btn.addEventListener("click", onClick)
  return btn
}

function buildWidgetsTab(): void {
  const panel = document.querySelector('[data-settings-tab="widgets"]')!

  // --- Search ---
  const searchAcc = createAccordion("Search", {
    variant: "settings",
    defaultOpen: false,
  })

  const searchEngine = createSelect({
    options: [
      { value: "google", label: "Google" },
      { value: "bing", label: "Bing" },
      { value: "yahoo", label: "Yahoo" },
      { value: "duckduckgo", label: "DuckDuckGo" },
      { value: "ecosia", label: "Ecosia" },
      { value: "qwant", label: "Qwant" },
      { value: "startpage", label: "Startpage" },
    ],
    value: store.sync.get("searchEngine"),
    onChange: (v) =>
      store.sync.set("searchEngine", v as SyncSettings["searchEngine"]),
  })
  searchAcc.content.appendChild(settingsRow("Search Engine", searchEngine))
  store.sync.subscribe("searchEngine", (v) => {
    searchEngine.value = v
  })

  const debounce = createCheckbox("", store.sync.get("debounceSearch"), (v) =>
    store.sync.set("debounceSearch", v)
  )
  searchAcc.content.appendChild(
    settingsRow("Debounce shortcut search", debounce)
  )
  const debounceHint = document.createElement("span")
  debounceHint.className = "text-muted text-xs -mt-2 mb-1 block px-1"
  debounceHint.textContent = "Enable this if the search lags when you type"
  searchAcc.content.appendChild(debounceHint)
  store.sync.subscribe("debounceSearch", (v) => {
    ;(debounce as any).setChecked(v)
  })

  const openNewTab = createCheckbox(
    "",
    store.sync.get("searchOpenInNewTab"),
    (v) => store.sync.set("searchOpenInNewTab", v)
  )
  searchAcc.content.appendChild(
    settingsRow("Open results in new tab", openNewTab)
  )
  store.sync.subscribe("searchOpenInNewTab", (v) => {
    ;(openNewTab as any).setChecked(v)
  })

  panel.appendChild(searchAcc.container)

  // --- Todo ---
  const todoAcc = createAccordion("Todo", {
    variant: "settings",
    defaultOpen: false,
  })

  const todoEnabled = createCheckbox("", store.sync.get("todoEnabled"), (v) =>
    store.sync.set("todoEnabled", v)
  )
  todoAcc.content.appendChild(settingsRow("Enable todo widget", todoEnabled))
  store.sync.subscribe("todoEnabled", (v) => {
    ;(todoEnabled as any).setChecked(v)
  })

  const todoBadges = createCheckbox("", store.sync.get("todoShowBadges"), (v) =>
    store.sync.set("todoShowBadges", v)
  )
  todoAcc.content.appendChild(settingsRow("Show badges and progress ring", todoBadges))
  store.sync.subscribe("todoShowBadges", (v) => {
    ;(todoBadges as any).setChecked(v)
  })

  const clearRow = document.createElement("div")
  clearRow.className = "flex justify-end"
  const clearBtn = createButton("Clear all todos", "destructive", {
    onClick: () => {
      if (confirm("Delete every todo, including the archive? This can't be undone."))
        store.local.set("todos", [])
    },
  })
  clearRow.appendChild(clearBtn)
  todoAcc.content.appendChild(clearRow)

  panel.appendChild(todoAcc.container)

  // --- Notepad ---
  const notepadAcc = createAccordion("Notepad", {
    variant: "settings",
    defaultOpen: false,
  })

  const notepadEnabled = createCheckbox(
    "",
    store.sync.get("notepadEnabled"),
    (v) => store.sync.set("notepadEnabled", v)
  )
  notepadAcc.content.appendChild(
    settingsRow("Enable notepad widget", notepadEnabled)
  )
  store.sync.subscribe("notepadEnabled", (v) => {
    ;(notepadEnabled as any).setChecked(v)
  })

  const notepadFont = createSelect({
    options: [
      { value: "sans", label: "Sans" },
      { value: "mono", label: "Monospace" },
    ],
    value: store.sync.get("notepadFont"),
    onChange: (v) =>
      store.sync.set("notepadFont", v as SyncSettings["notepadFont"]),
  })
  notepadAcc.content.appendChild(settingsRow("Typeface", notepadFont))
  store.sync.subscribe("notepadFont", (v) => {
    notepadFont.value = v
  })

  const notepadHint = document.createElement("span")
  notepadHint.className = "text-muted text-xs -mt-1 mb-1 block px-1"
  notepadHint.textContent =
    "The note is saved on this device only — it is too big for synced storage."
  notepadAcc.content.appendChild(notepadHint)

  const notepadClearRow = document.createElement("div")
  notepadClearRow.className = "flex justify-end"
  notepadClearRow.appendChild(
    createButton("Clear note", "destructive", {
      onClick: () => {
        if (store.local.get("notepadBody") === "") return
        if (confirm("Erase the note? This can't be undone from here.")) {
          store.local.set("notepadBody", "")
          store.local.set("notepadUpdatedAt", null)
        }
      },
    })
  )
  notepadAcc.content.appendChild(notepadClearRow)

  panel.appendChild(notepadAcc.container)

  // --- Weather ---
  const weatherAcc = createAccordion("Weather", {
    variant: "settings",
    defaultOpen: false,
  })

  const weatherEnabled = createCheckbox(
    "",
    store.sync.get("weatherEnabled"),
    (v) => store.sync.set("weatherEnabled", v)
  )
  weatherAcc.content.appendChild(settingsRow("Enable weather", weatherEnabled))
  store.sync.subscribe("weatherEnabled", (v) => {
    ;(weatherEnabled as any).setChecked(v)
  })

  const weatherUnit = createSelect({
    options: [
      { value: "f", label: "Fahrenheit" },
      { value: "c", label: "Celsius" },
    ],
    value: store.sync.get("weatherUnit"),
    onChange: (v) =>
      store.sync.set("weatherUnit", v as SyncSettings["weatherUnit"]),
  })
  weatherAcc.content.appendChild(settingsRow("Temperature unit", weatherUnit))
  store.sync.subscribe("weatherUnit", (v) => {
    weatherUnit.value = v
  })

  const weatherMetric = createSelect({
    options: [
      { value: "temperature", label: "Real Temperature" },
      { value: "apparent", label: "Feels Like" },
      { value: "humidity", label: "Humidity" },
      { value: "wind", label: "Wind Speed + Gusts" },
      { value: "uv", label: "UV Index" },
      { value: "precipitation", label: "Precipitation" },
      { value: "aqi", label: "Air Quality" },
    ],
    value: store.sync.get("weatherMetric"),
    onChange: (v) =>
      store.sync.set("weatherMetric", v as SyncSettings["weatherMetric"]),
  })
  weatherAcc.content.appendChild(settingsRow("Metric", weatherMetric))
  store.sync.subscribe("weatherMetric", (v) => {
    weatherMetric.value = v
  })

  weatherAcc.content.appendChild(buildLocationControls())
  panel.appendChild(weatherAcc.container)

  sectionHooks["weather"] = () => {
    if (weatherAcc.content.hidden) weatherAcc.toggle()
    weatherAcc.container.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  // --- Spotify ---
  const spotifyAcc = createAccordion("Spotify", {
    variant: "settings",
    defaultOpen: false,
  })

  const spotifyEnabled = createCheckbox(
    "",
    store.sync.get("spotifyEnabled"),
    (v) => store.sync.set("spotifyEnabled", v)
  )
  spotifyAcc.content.appendChild(
    settingsRow("Enable Spotify widget", spotifyEnabled)
  )
  store.sync.subscribe("spotifyEnabled", (v) => {
    ;(spotifyEnabled as any).setChecked(v)
  })

  const spotifyHideWhenIdle = createCheckbox(
    "",
    store.sync.get("spotifyHideWhenIdle"),
    (v) => store.sync.set("spotifyHideWhenIdle", v)
  )
  spotifyAcc.content.appendChild(
    settingsRow("Hide when nothing is playing", spotifyHideWhenIdle)
  )
  store.sync.subscribe("spotifyHideWhenIdle", (v) => {
    ;(spotifyHideWhenIdle as any).setChecked(v)
  })

  const spotifyConnectRow = document.createElement("div")
  const spotifyStatus = statusText()
  const spotifyBtn = createSpotifyButton(async () => {
    spotifyBtn.disabled = true
    setButtonLabel(spotifyBtn, "Connecting…")
    spotifyStatus.hidden = true

    const result = await spotifyAuthenticate()

    spotifyBtn.disabled = false
    setButtonLabel(spotifyBtn, "Connect Spotify")

    if (result.ok) updateSpotifyUI()
    else showStatus(spotifyStatus, result.error, true)
  })
  spotifyConnectRow.appendChild(spotifyBtn)
  spotifyConnectRow.appendChild(spotifyStatus)

  const spotifyDisconnectRow = document.createElement("div")
  spotifyDisconnectRow.hidden = true
  const spotifyDisconnectBtn = createButton(
    "Disconnect",
    "destructive-outline",
    {
      onClick: () => {
        spotifyClearTokens()
        updateSpotifyUI()
      },
    }
  )
  spotifyDisconnectRow.appendChild(spotifyDisconnectBtn)

  function updateSpotifyUI(): void {
    const hasToken = store.local.get("spotifyAccessToken") !== null
    spotifyConnectRow.hidden = hasToken
    spotifyDisconnectRow.hidden = !hasToken
  }
  updateSpotifyUI()
  store.local.subscribe("spotifyAccessToken", () => updateSpotifyUI())

  spotifyAcc.content.appendChild(spotifyConnectRow)
  spotifyAcc.content.appendChild(spotifyDisconnectRow)
  panel.appendChild(spotifyAcc.container)

  // --- Google Calendar ---
  const calendarAcc = createAccordion("Google Calendar", {
    variant: "settings",
    defaultOpen: false,
  })

  const calendarEnabled = createCheckbox(
    "",
    store.sync.get("calendarEnabled"),
    (v) => store.sync.set("calendarEnabled", v)
  )
  calendarAcc.content.appendChild(
    settingsRow("Enable Google Calendar", calendarEnabled)
  )
  store.sync.subscribe("calendarEnabled", (v) => {
    ;(calendarEnabled as any).setChecked(v)
  })

  const calConnectRow = document.createElement("div")
  const calStatus = statusText()
  const calBtn = createGoogleButton(async () => {
    calBtn.disabled = true
    setButtonLabel(calBtn, "Signing in…")
    calStatus.hidden = true

    const result = await calendarAuthenticate()

    calBtn.disabled = false
    setButtonLabel(calBtn, "Sign in with Google")

    if (result.ok) {
      updateCalendarUI()
      return
    }

    showStatus(calStatus, result.error, true)
    if (result.needsClientId) {
      const link = document.createElement("button")
      link.className = "underline text-accent ml-1"
      link.textContent = "Open Advanced settings"
      link.addEventListener("click", () => selectTab("advanced"))
      calStatus.appendChild(link)
    }
  })
  calConnectRow.appendChild(calBtn)
  calConnectRow.appendChild(calStatus)

  const calDisconnectRow = document.createElement("div")
  calDisconnectRow.hidden = true
  const calDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: async () => {
      await calendarDisconnect()
      updateCalendarUI()
    },
  })
  calDisconnectRow.appendChild(calDisconnectBtn)

  function updateCalendarUI(): void {
    const connected = store.local.get("calendarConnected")
    calConnectRow.hidden = connected
    calDisconnectRow.hidden = !connected
  }
  updateCalendarUI()
  store.local.subscribe("calendarConnected", () => updateCalendarUI())

  calendarAcc.content.appendChild(calConnectRow)
  calendarAcc.content.appendChild(calDisconnectRow)
  panel.appendChild(calendarAcc.container)

  // --- Gmail ---
  const mailAcc = createAccordion("Gmail", {
    variant: "settings",
    defaultOpen: false,
  })

  const mailEnabled = createCheckbox("", store.sync.get("mailEnabled"), (v) =>
    store.sync.set("mailEnabled", v)
  )
  mailAcc.content.appendChild(settingsRow("Enable Gmail widget", mailEnabled))
  store.sync.subscribe("mailEnabled", (v) => {
    ;(mailEnabled as any).setChecked(v)
  })

  const mailConnectRow = document.createElement("div")
  const mailStatus = statusText()
  const mailBtn = createGoogleButton(async () => {
    mailBtn.disabled = true
    setButtonLabel(mailBtn, "Signing in…")
    mailStatus.hidden = true

    const result = await mailAuthenticate()

    mailBtn.disabled = false
    setButtonLabel(mailBtn, "Sign in with Google")

    if (result.ok) {
      updateMailUI()
      return
    }

    showStatus(mailStatus, result.error, true)
    if (result.needsClientId) {
      const link = document.createElement("button")
      link.className = "underline text-accent ml-1"
      link.textContent = "Open Advanced settings"
      link.addEventListener("click", () => selectTab("advanced"))
      mailStatus.appendChild(link)
    }
  })
  mailConnectRow.appendChild(mailBtn)
  mailConnectRow.appendChild(mailStatus)

  const mailDisconnectRow = document.createElement("div")
  mailDisconnectRow.hidden = true
  const mailAccount = statusText()
  const mailDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: async () => {
      await mailDisconnect()
      updateMailUI()
    },
  })
  mailDisconnectRow.appendChild(mailAccount)
  mailDisconnectRow.appendChild(mailDisconnectBtn)

  function updateMailUI(): void {
    const connected = store.local.get("mailConnected")
    mailConnectRow.hidden = connected
    mailDisconnectRow.hidden = !connected
    const address = store.local.get("mailAddress")
    if (address) showStatus(mailAccount, `Signed in as ${address}`, false)
    else mailAccount.hidden = true
  }
  updateMailUI()
  store.local.subscribe("mailConnected", () => updateMailUI())
  store.local.subscribe("mailAddress", () => updateMailUI())

  mailAcc.content.appendChild(mailConnectRow)
  mailAcc.content.appendChild(mailDisconnectRow)

  const mailCount = createSelect({
    options: [
      { value: "primary", label: "Primary" },
      { value: "inbox", label: "All inbox" },
      { value: "important", label: "Important" },
      { value: "starred", label: "Starred" },
    ],
    value: store.sync.get("mailCountSource"),
    onChange: (v) => store.sync.set("mailCountSource", v as MailCountSource),
  })
  mailAcc.content.appendChild(settingsRow("Badge counts", mailCount))
  store.sync.subscribe("mailCountSource", (v) => {
    mailCount.value = v
  })

  const MAIL_CATEGORY_LABELS: Record<MailCategory, string> = {
    primary: "Primary",
    social: "Social",
    promotions: "Promotions",
    updates: "Updates",
    forums: "Forums",
  }
  for (const category of MAIL_CATEGORIES) {
    const box = createCheckbox("", store.sync.get("mailCategories").includes(category), (v) => {
      const next = MAIL_CATEGORIES.filter((c) =>
        c === category ? v : store.sync.get("mailCategories").includes(c)
      )
      store.sync.set("mailCategories", next)
    })
    mailAcc.content.appendChild(settingsRow(`Show ${MAIL_CATEGORY_LABELS[category]} inbox`, box))
    store.sync.subscribe("mailCategories", (v) => {
      ;(box as any).setChecked(v.includes(category))
    })
  }

  const mailSnippets = createCheckbox("", store.sync.get("mailShowSnippets"), (v) =>
    store.sync.set("mailShowSnippets", v)
  )
  mailAcc.content.appendChild(settingsRow("Show preview text", mailSnippets))
  store.sync.subscribe("mailShowSnippets", (v) => {
    ;(mailSnippets as any).setChecked(v)
  })

  const mailRows = createSelect({
    options: [
      { value: "8", label: "8" },
      { value: "12", label: "12" },
      { value: "20", label: "20" },
      { value: "30", label: "30" },
    ],
    value: String(store.sync.get("mailMaxRows")),
    onChange: (v) => store.sync.set("mailMaxRows", Number(v)),
  })
  mailAcc.content.appendChild(settingsRow("Messages to load", mailRows))
  store.sync.subscribe("mailMaxRows", (v) => {
    mailRows.value = String(v)
  })

  panel.appendChild(mailAcc.container)

  // --- GitHub ---
  const githubAcc = createAccordion("GitHub", {
    variant: "settings",
    defaultOpen: false,
  })

  const githubEnabled = createCheckbox("", store.sync.get("githubEnabled"), (v) =>
    store.sync.set("githubEnabled", v)
  )
  githubAcc.content.appendChild(settingsRow("Enable GitHub widget", githubEnabled))
  store.sync.subscribe("githubEnabled", (v) => {
    ;(githubEnabled as any).setChecked(v)
  })

  githubAcc.content.appendChild(buildGithubAccountRow())

  const SECTION_LABELS: Record<GithubSection, string> = {
    reviews: "Needs your review",
    mine: "Your pull requests",
    mentions: "Mentions & notifications",
    issues: "Assigned issues",
  }
  for (const section of GITHUB_SECTIONS) {
    const box = createCheckbox("", store.sync.get("githubSections").includes(section), (v) => {
      const next = GITHUB_SECTIONS.filter((s) =>
        s === section ? v : store.sync.get("githubSections").includes(s)
      )
      store.sync.set("githubSections", next)
    })
    githubAcc.content.appendChild(settingsRow(SECTION_LABELS[section], box))
    store.sync.subscribe("githubSections", (v) => {
      ;(box as any).setChecked(v.includes(section))
    })
  }

  const githubHideBots = createCheckbox("", store.sync.get("githubHideBots"), (v) =>
    store.sync.set("githubHideBots", v)
  )
  githubAcc.content.appendChild(settingsRow("Hide pull requests from bots", githubHideBots))
  store.sync.subscribe("githubHideBots", (v) => {
    ;(githubHideBots as any).setChecked(v)
  })

  const githubContributions = createCheckbox("", store.sync.get("githubShowContributions"), (v) =>
    store.sync.set("githubShowContributions", v)
  )
  githubAcc.content.appendChild(settingsRow("Show contribution graph", githubContributions))
  store.sync.subscribe("githubShowContributions", (v) => {
    ;(githubContributions as any).setChecked(v)
  })

  const githubOrg = createInput({ placeholder: "All organizations" }) as HTMLInputElement
  githubOrg.value = store.sync.get("githubOrgFilter")
  githubOrg.style.width = "200px"
  githubOrg.addEventListener("change", () => {
    store.sync.set("githubOrgFilter", githubOrg.value.trim())
  })
  store.sync.subscribe("githubOrgFilter", (v) => {
    githubOrg.value = v
  })
  githubAcc.content.appendChild(settingsRow("Only this organization", githubOrg))

  const githubIgnored = createInput({ placeholder: "owner/repo, owner/repo" }) as HTMLInputElement
  githubIgnored.value = store.sync.get("githubIgnoredRepos").join(", ")
  githubIgnored.style.width = "200px"
  githubIgnored.addEventListener("change", () => {
    const repos = githubIgnored.value
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
    store.sync.set("githubIgnoredRepos", repos)
  })
  store.sync.subscribe("githubIgnoredRepos", (v) => {
    githubIgnored.value = v.join(", ")
  })
  githubAcc.content.appendChild(settingsRow("Ignore these repos", githubIgnored))

  panel.appendChild(githubAcc.container)

  sectionHooks["github"] = () => {
    if (githubAcc.content.hidden) githubAcc.toggle()
    githubAcc.container.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  // --- Linear ---
  const linearAcc = createAccordion("Linear", {
    variant: "settings",
    defaultOpen: false,
  })

  const linearEnabled = createCheckbox("", store.sync.get("linearEnabled"), (v) =>
    store.sync.set("linearEnabled", v)
  )
  linearAcc.content.appendChild(settingsRow("Enable Linear widget", linearEnabled))
  store.sync.subscribe("linearEnabled", (v) => {
    ;(linearEnabled as any).setChecked(v)
  })

  linearAcc.content.appendChild(buildLinearAccountRow())

  const LINEAR_SECTION_LABELS: Record<LinearSection, string> = {
    inbox: "Inbox (unread notifications)",
    due: "Due & overdue",
    progress: "In progress",
    todo: "Up next",
  }
  for (const section of LINEAR_SECTIONS) {
    const box = createCheckbox("", store.sync.get("linearSections").includes(section), (v) => {
      const next = LINEAR_SECTIONS.filter((sec) =>
        sec === section ? v : store.sync.get("linearSections").includes(sec)
      )
      store.sync.set("linearSections", next)
    })
    linearAcc.content.appendChild(settingsRow(LINEAR_SECTION_LABELS[section], box))
    store.sync.subscribe("linearSections", (v) => {
      ;(box as any).setChecked(v.includes(section))
    })
  }

  const linearCycle = createCheckbox("", store.sync.get("linearShowCycle"), (v) =>
    store.sync.set("linearShowCycle", v)
  )
  linearAcc.content.appendChild(settingsRow("Show active cycle burndown", linearCycle))
  store.sync.subscribe("linearShowCycle", (v) => {
    ;(linearCycle as any).setChecked(v)
  })

  const linearLink = createCheckbox("", store.sync.get("linearLinkGithub"), (v) =>
    store.sync.set("linearLinkGithub", v)
  )
  linearAcc.content.appendChild(settingsRow("Cross-link issues and pull requests", linearLink))
  store.sync.subscribe("linearLinkGithub", (v) => {
    ;(linearLink as any).setChecked(v)
  })

  const linkHelp = document.createElement("p")
  linkHelp.className = "text-xs text-muted -mt-1 mb-1 leading-relaxed"
  linkHelp.textContent =
    "Badges a Linear issue with its pull request and check status, and a pull request with its Linear issue. Uses what both widgets have already fetched — no extra requests."
  linearAcc.content.appendChild(linkHelp)

  const linearTeam = createInput({ placeholder: "All teams" }) as HTMLInputElement
  linearTeam.value = store.sync.get("linearTeamFilter")
  linearTeam.style.width = "200px"
  linearTeam.addEventListener("change", () => {
    store.sync.set("linearTeamFilter", linearTeam.value.trim().toUpperCase())
  })
  store.sync.subscribe("linearTeamFilter", (v) => {
    linearTeam.value = v
  })
  linearAcc.content.appendChild(settingsRow("Only this team (key, e.g. ENG)", linearTeam))

  panel.appendChild(linearAcc.container)

  sectionHooks["linear"] = () => {
    if (linearAcc.content.hidden) linearAcc.toggle()
    linearAcc.container.scrollIntoView({ block: "start", behavior: "smooth" })
  }
}

/**
 * Connect / connected / disconnect for Linear. The API key is the field in
 * front, because it is the path that works without registering anything; OAuth
 * sits behind the button beside it and needs the client ID from Advanced. The
 * same two doors the widget's own connect panel offers.
 */
function buildLinearAccountRow(): HTMLElement {
  const wrap = document.createElement("div")

  const connectRow = document.createElement("div")
  const status = statusText()

  const keyInput = createInput({ type: "password", placeholder: "lin_api_…" }) as HTMLInputElement
  keyInput.style.width = "200px"

  const saveBtn = createButton("Connect", "primary", {
    icon: icon("linear", { size: 14 }),
    onClick: async () => {
      saveBtn.disabled = true
      setButtonLabel(saveBtn, "Checking…")
      const result = await linearConnectWithApiKey(keyInput.value)
      saveBtn.disabled = false
      setButtonLabel(saveBtn, "Connect")
      if (result.ok) {
        keyInput.value = ""
        update()
      } else {
        showStatus(status, result.error, true)
      }
    },
  })

  const oauthBtn = createButton("Use OAuth", "outline", {
    onClick: async () => {
      if (!linearGetClientId()) {
        showStatus(status, "Add a Linear client ID under Advanced first, or connect with an API key.", true)
        return
      }
      oauthBtn.disabled = true
      setButtonLabel(oauthBtn, "Connecting…")
      const result = await linearAuthenticate()
      oauthBtn.disabled = false
      setButtonLabel(oauthBtn, "Use OAuth")
      if (result.ok) update()
      else showStatus(status, result.error, true)
    },
  })

  const right = document.createElement("div")
  right.className = "flex items-center gap-1 min-w-0"
  right.append(keyInput, saveBtn, oauthBtn)
  connectRow.appendChild(settingsRow("Personal API key", right))
  connectRow.appendChild(status)

  const help = document.createElement("p")
  help.className = "text-xs text-muted mt-1 mb-2 leading-relaxed"
  help.innerHTML =
    `Create a key under ` +
    `<a href="https://linear.app/settings/account/security" target="_blank" rel="noopener" class="underline text-accent">Linear → Security &amp; access</a> ` +
    `with <strong>Read</strong> and <strong>Write</strong> — write is what lets a row change an issue’s status and clear a notification — and access to every team you want on the card. ` +
    `It is stored in this browser only. OAuth is the narrower-scoped alternative and needs a client ID under Advanced.`
  connectRow.appendChild(help)

  const connectedRow = document.createElement("div")
  connectedRow.className = "flex items-center gap-2 py-3"
  connectedRow.hidden = true

  const account = document.createElement("span")
  account.className = "flex-1 min-w-0 truncate text-sm text-foreground"
  connectedRow.appendChild(account)

  const disconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: async () => {
      await linearDisconnect()
      update()
    },
  })
  connectedRow.appendChild(disconnectBtn)

  function update(): void {
    const user = store.local.get("linearUser")
    const connected = store.local.get("linearToken") !== null
    connectRow.hidden = connected
    connectedRow.hidden = !connected
    if (user) {
      const kind = store.local.get("linearTokenType") === "oauth" ? "OAuth" : "API key"
      const org = user.orgName ? ` · ${user.orgName}` : ""
      account.textContent = `Connected as ${user.displayName || user.name}${org} (${kind})`
    }
  }
  update()
  store.local.subscribe("linearToken", () => update())

  wrap.appendChild(connectRow)
  wrap.appendChild(connectedRow)
  return wrap
}

/**
 * Connect / connected / disconnect, plus the device code while one is pending.
 * The same flow the widget runs inline — settings is the second door to it, for
 * someone who got here before they ever saw the card.
 */
function buildGithubAccountRow(): HTMLElement {
  const wrap = document.createElement("div")

  const connectRow = document.createElement("div")
  const status = statusText()

  const codeBox = document.createElement("div")
  codeBox.className = "flex items-center gap-2 mt-2"
  codeBox.hidden = true

  const connectBtn = createButton("Connect GitHub", "primary", {
    icon: icon("github", { size: 15 }),
    onClick: async () => {
      connectBtn.disabled = true
      setButtonLabel(connectBtn, "Connecting…")
      status.hidden = true

      const result = await githubAuthenticate({
        onCode: (code) => {
          codeBox.hidden = false
          codeBox.replaceChildren()

          const value = document.createElement("code")
          value.className = "font-mono text-base tracking-[0.16em] text-foreground"
          value.textContent = code.userCode
          codeBox.appendChild(value)

          const hint = document.createElement("span")
          hint.className = "text-xs text-muted"
          hint.textContent = "Enter this at github.com/login/device"
          codeBox.appendChild(hint)

          window.open(code.verificationUri, "_blank", "noopener,noreferrer")
        },
      })

      connectBtn.disabled = false
      setButtonLabel(connectBtn, "Connect GitHub")
      codeBox.hidden = true

      if (result.ok) update()
      else showStatus(status, result.error, true)
    },
  })
  connectRow.appendChild(connectBtn)
  connectRow.appendChild(codeBox)
  connectRow.appendChild(status)

  const connectedRow = document.createElement("div")
  connectedRow.className = "flex items-center gap-2 py-3"
  connectedRow.hidden = true

  const account = document.createElement("span")
  account.className = "flex-1 min-w-0 truncate text-sm text-foreground"
  connectedRow.appendChild(account)

  const disconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: () => {
      githubCancelFlow()
      githubClearTokens()
      update()
    },
  })
  connectedRow.appendChild(disconnectBtn)

  function update(): void {
    const user = store.local.get("githubUser")
    const connected = store.local.get("githubToken") !== null
    connectRow.hidden = connected
    connectedRow.hidden = !connected
    if (user) {
      const kind = store.local.get("githubTokenType") === "pat" ? "token" : "OAuth"
      account.textContent = `Connected as @${user.login} (${kind})`
    }
  }
  update()
  store.local.subscribe("githubToken", () => update())

  wrap.appendChild(connectRow)
  wrap.appendChild(connectedRow)
  return wrap
}

function buildNav(): { refreshIndicator: () => void } {
  const nav = document.getElementById("settings-nav")!
  const title = document.getElementById("settings-title")!
  const panels = document.getElementById("settings-panels")!

  const indicator = document.createElement("div")
  indicator.className = "settings-nav-indicator"
  nav.appendChild(indicator)

  let activeIndex = 0
  let activePanel = panels.querySelector(
    '[data-settings-tab="general"]'
  ) as HTMLElement
  let switching = false

  const navButtons: HTMLButtonElement[] = []

  function indicatorTop(index: number): number {
    return 12 + index * 52 + 14
  }

  indicator.style.transform = `translateY(${indicatorTop(0)}px)`

  TABS.forEach((tab, index) => {
    const btn = document.createElement("button")
    btn.className = `relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors ${
      index === 0
        ? "text-accent"
        : "text-muted hover:text-foreground hover:bg-surface"
    }`
    btn.appendChild(icon(tab.iconName, { size: 22 }))
    btn.setAttribute("aria-label", tab.label)
    if (index === 0) btn.setAttribute("aria-selected", "true")

    const tooltip = document.createElement("span")
    tooltip.className = "settings-tooltip"
    tooltip.textContent = tab.label
    btn.appendChild(tooltip)

    let hoverTimer: number | null = null
    btn.addEventListener("mouseenter", () => {
      hoverTimer = window.setTimeout(() => {
        tooltip.classList.add("visible")
      }, 400)
    })
    btn.addEventListener("mouseleave", () => {
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer)
        hoverTimer = null
      }
      tooltip.classList.remove("visible")
    })

    btn.addEventListener("click", () => {
      if (index === activeIndex || switching) return
      switchTab(tab.id, index)
    })

    nav.appendChild(btn)
    navButtons.push(btn)
  })

  function switchTab(tabId: string, index: number): void {
    switching = true

    const newPanel = panels.querySelector(
      `[data-settings-tab="${tabId}"]`
    ) as HTMLElement
    const oldPanel = activePanel

    navButtons[activeIndex].className =
      "relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors text-muted hover:text-foreground hover:bg-surface"
    navButtons[activeIndex].removeAttribute("aria-selected")
    navButtons[index].className =
      "relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors text-accent"
    navButtons[index].setAttribute("aria-selected", "true")

    const titleFadeOut = title.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 50,
      easing: "ease-in",
      fill: "forwards",
    })

    setTimeout(() => {
      titleFadeOut.cancel()
      title.textContent = TABS[index].label
      const titleFadeIn = title.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 50,
        easing: "ease-out",
        fill: "forwards",
      })
      titleFadeIn.onfinish = () => {
        titleFadeIn.cancel()
        title.style.opacity = ""
      }
    }, 25)
    activeIndex = index
    indicator.style.transform = `translateY(${indicatorTop(index)}px)`

    oldPanel.style.position = "absolute"
    oldPanel.style.inset = "0"
    oldPanel.style.overflow = "hidden"

    newPanel.removeAttribute("hidden")
    newPanel.style.opacity = "0"

    panels.scrollTop = 0

    const fadeOut = oldPanel.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 50,
      easing: "ease-in",
      fill: "forwards",
    })

    setTimeout(() => {
      const fadeIn = newPanel.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 50,
        easing: "ease-out",
        fill: "forwards",
      })

      fadeIn.onfinish = () => {
        oldPanel.setAttribute("hidden", "")
        oldPanel.style.cssText = ""
        fadeOut.cancel()
        fadeIn.cancel()
        newPanel.style.opacity = ""
        activePanel = newPanel
        switching = false
      }
    }, 25)
  }

  selectTabFn = (tabId: string) => {
    const index = TABS.findIndex((t) => t.id === tabId)
    if (index === -1 || index === activeIndex || switching) return
    switchTab(tabId, index)
  }

  return {
    refreshIndicator: () => {
      indicator.style.transform = `translateY(${indicatorTop(activeIndex)}px)`
    },
  }
}

function buildShortcutsPanel(): HTMLDivElement {
  const panel = document.createElement("div")
  panel.dataset.settingsTab = "shortcuts"
  panel.className = "settings-panel flex flex-col h-full"
  panel.hidden = true

  // Everything above the footer is built by shortcut-settings.ts; this is only
  // the shell it mounts into, plus the two settings that belong to the panel
  // rather than to any one shortcut.
  const host = document.createElement("div")
  host.id = "sc-panel"
  host.className = "flex-1 flex min-h-0"
  panel.appendChild(host)

  const footer = document.createElement("div")
  footer.className =
    "flex items-center justify-between gap-4 px-6 py-2.5 shrink-0 border-t border-input-border/15"

  const recsRow = document.createElement("div")
  recsRow.className = "flex items-center gap-2 min-w-0"

  const recsInput = document.createElement("input")
  recsInput.type = "checkbox"
  recsInput.id = "settings-recommendations-enabled"
  recsInput.className = "rounded accent-accent shrink-0"
  recsRow.appendChild(recsInput)

  const recsLabel = document.createElement("label")
  recsLabel.htmlFor = "settings-recommendations-enabled"
  recsLabel.className = "text-sm truncate"
  recsLabel.textContent = "Show smart suggestions in dock"
  recsRow.appendChild(recsLabel)

  footer.appendChild(recsRow)

  const openInRow = document.createElement("div")
  openInRow.className = "flex items-center gap-2 shrink-0"

  const openInLabel = document.createElement("span")
  openInLabel.className = "text-sm text-muted"
  openInLabel.textContent = "Open shortcuts in"
  openInRow.appendChild(openInLabel)

  const openInSelect = createSelect({
    options: [
      { value: "current", label: "Current tab" },
      { value: "new", label: "New tab" },
    ],
    value: store.sync.get("shortcutsOpenIn"),
    width: "130px",
    onChange: (v) => store.sync.set("shortcutsOpenIn", v as "current" | "new"),
  })
  openInRow.appendChild(openInSelect)

  footer.appendChild(openInRow)
  panel.appendChild(footer)

  return panel
}

function buildAdvancedPanel(): HTMLDivElement {
  const panel = document.createElement("div")
  panel.dataset.settingsTab = "advanced"
  panel.className = "settings-panel pb-6 px-6"
  panel.hidden = true

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const keyInput = createInput({
    type: "password",
    placeholder: "Paste your API key",
  })
  keyInput.value = store.sync.get("unsplashApiKey")
  keyInput.style.width = "220px"
  keyInput.addEventListener("change", () => {
    store.sync.set(
      "unsplashApiKey",
      (keyInput as HTMLInputElement).value.trim()
    )
  })
  store.sync.subscribe("unsplashApiKey", (v) => {
    ;(keyInput as HTMLInputElement).value = v
  })

  const keyRow = document.createElement("div")
  keyRow.className =
    "flex items-center justify-between py-3 border-b border-input-border/10"

  const keyLabel = document.createElement("span")
  keyLabel.className = "text-sm text-foreground"
  keyLabel.textContent = "Unsplash API key"

  const inputWrapper = document.createElement("div")
  inputWrapper.className = "flex items-center gap-1"
  inputWrapper.appendChild(keyInput)

  const toggleBtn = createButton("", "ghost", {
    onClick: () => {
      const inp = keyInput as HTMLInputElement
      const isPassword = inp.type === "password"
      inp.type = isPassword ? "text" : "password"
      toggleBtn.querySelector("span")!.innerHTML = isPassword ? "Hide" : "Show"
    },
  })
  const toggleLabel = document.createElement("span")
  toggleLabel.className = "text-xs"
  toggleLabel.innerHTML = "Show"
  toggleBtn.appendChild(toggleLabel)
  inputWrapper.appendChild(toggleBtn)

  keyRow.appendChild(keyLabel)
  keyRow.appendChild(inputWrapper)
  wrapper.appendChild(keyRow)

  const helpText = document.createElement("p")
  helpText.className = "text-xs text-muted mt-2"
  helpText.innerHTML = `Get a free key at <a href="https://unsplash.com/developers" target="_blank" rel="noopener" class="underline text-accent">unsplash.com/developers</a>`
  wrapper.appendChild(helpText)

  wrapper.appendChild(buildGoogleAuthSection())
  wrapper.appendChild(buildSpotifyAuthSection())
  wrapper.appendChild(buildGithubAuthSection())
  wrapper.appendChild(buildLinearAuthSection())
  wrapper.appendChild(buildCapabilityPanel())

  panel.appendChild(wrapper)
  return panel
}

function sectionHeading(text: string): HTMLElement {
  const h = document.createElement("h3")
  h.className =
    "text-[11px] uppercase tracking-wider text-muted mt-6 mb-1 pt-4 border-t border-input-border/10"
  h.textContent = text
  return h
}

/**
 * A client-ID field, the extension's redirect URI to register against it, and
 * the instructions. Both services need exactly this and for the same reason:
 * the built-in credentials only work on browsers whose redirect URI can be on
 * their allowlist, so everywhere else the user brings their own app. Always
 * shown, so the setup path is discoverable before sign-in fails rather than
 * only after. See `docs/browser-compat.md`.
 */
function buildOAuthSection(opts: {
  heading: string
  clientIdKey: "googleClientId" | "spotifyClientId" | "githubClientId" | "linearClientId"
  placeholder: string
  help: string
}): HTMLElement {
  const section = document.createElement("div")
  section.appendChild(sectionHeading(opts.heading))

  const clientInput = createInput({ placeholder: opts.placeholder }) as HTMLInputElement
  clientInput.value = store.sync.get(opts.clientIdKey)
  clientInput.style.width = "220px"
  clientInput.addEventListener("change", () => {
    store.sync.set(opts.clientIdKey, clientInput.value.trim())
  })
  store.sync.subscribe(opts.clientIdKey, (v) => {
    clientInput.value = v
  })

  const clientRow = document.createElement("div")
  clientRow.className =
    "flex items-center justify-between py-3 border-b border-input-border/10"
  const clientLabel = document.createElement("span")
  clientLabel.className = "text-sm text-foreground"
  clientLabel.textContent = "OAuth client ID"
  clientRow.appendChild(clientLabel)
  clientRow.appendChild(clientInput)
  section.appendChild(clientRow)

  // One URI per browser, not per service — every flow redirects to the same place.
  const redirect = getRedirectUri()
  if (redirect) {
    const redirectRow = document.createElement("div")
    redirectRow.className =
      "flex items-center justify-between gap-3 py-3 border-b border-input-border/10"

    const redirectLabel = document.createElement("span")
    redirectLabel.className = "text-sm text-foreground shrink-0"
    redirectLabel.textContent = "Redirect URI"

    const redirectValue = document.createElement("code")
    redirectValue.className = "text-xs text-muted truncate min-w-0"
    redirectValue.textContent = redirect

    const copyBtn = createButton("Copy", "ghost", {
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(redirect)
          setButtonLabel(copyBtn, "Copied")
          setTimeout(() => setButtonLabel(copyBtn, "Copy"), 1500)
        } catch {
          setButtonLabel(copyBtn, "Press Ctrl+C")
        }
      },
    })
    copyBtn.classList.add("shrink-0")

    const right = document.createElement("div")
    right.className = "flex items-center gap-1 min-w-0"
    right.appendChild(redirectValue)
    right.appendChild(copyBtn)

    redirectRow.appendChild(redirectLabel)
    redirectRow.appendChild(right)
    section.appendChild(redirectRow)
  }

  const help = document.createElement("p")
  help.className = "text-xs text-muted mt-2 leading-relaxed"
  help.innerHTML = opts.help
  section.appendChild(help)

  return section
}

function buildGoogleAuthSection(): HTMLElement {
  return buildOAuthSection({
    heading: "Google sign-in",
    clientIdKey: "googleClientId",
    placeholder: "…apps.googleusercontent.com",
    help:
      `Shared by the Calendar and Gmail widgets. Leave this blank if "Sign in with Google" already works — it's only needed when your browser has no Google account service. ` +
      `In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" class="underline text-accent">Google Cloud Console</a>, ` +
      `enable the Calendar API and the Gmail API, create an OAuth client of type <strong>Web application</strong>, add the redirect URI above, and paste the client ID here. ` +
      `Each widget asks for its own permission the first time you connect it, so connecting only the calendar never requests mail access.`,
  })
}

function buildSpotifyAuthSection(): HTMLElement {
  return buildOAuthSection({
    heading: "Spotify sign-in",
    clientIdKey: "spotifyClientId",
    placeholder: "32-character client ID",
    help:
      `Leave this blank if "Connect Spotify" already works — it's only needed on browsers whose redirect URI can't be registered on the built-in app, such as Firefox. ` +
      `In the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener" class="underline text-accent">Spotify Developer Dashboard</a>, ` +
      `create an app, tick <strong>Web API</strong>, add the redirect URI above, and paste the client ID here. Changing this disconnects the current session.`,
  })
}

/**
 * GitHub is the one service here that doesn't sign in through a redirect: the
 * device flow trades a code the user types on github.com for a token, so the
 * same client ID works on every browser and the callback URL registered against
 * it is never used. The token field below is the way in with no App at all.
 */
function buildGithubAuthSection(): HTMLElement {
  const section = buildOAuthSection({
    heading: "GitHub sign-in",
    clientIdKey: "githubClientId",
    placeholder: "Ov23li… client ID",
    help:
      `Leave this blank if "Connect GitHub" already works. To use your own app, create an ` +
      `<a href="https://github.com/settings/developers" target="_blank" rel="noopener" class="underline text-accent">OAuth App</a>, ` +
      `tick <strong>Enable Device Flow</strong>, and paste the client ID here — no secret needed. ` +
      `GitHub's form requires a callback URL but the device flow never uses it; the redirect URI above is a safe thing to put there. ` +
      `Changing this disconnects the current session.`,
  })

  // Only a GitHub App with expiring user tokens needs this; GitHub's refresh
  // endpoint asks for a secret even from a public client. Hidden until there is
  // a refresh token to use it on, so the ordinary OAuth App setup never sees it.
  const secretInput = createInput({ type: "password", placeholder: "client secret" }) as HTMLInputElement
  secretInput.value = store.local.get("githubClientSecret")
  secretInput.style.width = "220px"
  secretInput.addEventListener("change", () => {
    store.local.set("githubClientSecret", secretInput.value.trim())
  })
  const secretRow = settingsRow("Client secret (expiring tokens)", secretInput)
  secretRow.hidden = store.local.get("githubRefreshToken") === null
  store.local.subscribe("githubRefreshToken", (v) => {
    secretRow.hidden = v === null
  })
  section.appendChild(secretRow)

  const tokenInput = createInput({ type: "password", placeholder: "ghp_… or github_pat_…" }) as HTMLInputElement
  tokenInput.style.width = "220px"

  const status = statusText()
  const saveBtn = createButton("Use token", "outline", {
    onClick: async () => {
      saveBtn.disabled = true
      setButtonLabel(saveBtn, "Checking…")
      const result = await githubConnectWithToken(tokenInput.value)
      saveBtn.disabled = false
      setButtonLabel(saveBtn, "Use token")
      if (result.ok) {
        tokenInput.value = ""
        showStatus(status, "Connected.", false)
      } else {
        showStatus(status, result.error, true)
      }
    },
  })

  const right = document.createElement("div")
  right.className = "flex items-center gap-1 min-w-0"
  right.appendChild(tokenInput)
  right.appendChild(saveBtn)
  section.appendChild(settingsRow("Personal access token", right))
  section.appendChild(status)

  const tokenHelp = document.createElement("p")
  tokenHelp.className = "text-xs text-muted mt-2 leading-relaxed"
  tokenHelp.innerHTML =
    `An alternative to signing in: create a ` +
    `<a href="https://github.com/settings/tokens" target="_blank" rel="noopener" class="underline text-accent">personal access token</a> ` +
    `with <code>repo</code>, <code>read:org</code> and <code>notifications</code>. A token without <code>notifications</code> hides the mentions section. ` +
    `The token is stored in this browser only, and never synced.`
  section.appendChild(tokenHelp)

  return section
}

/**
 * Linear is the one service here whose easy path is not OAuth. A personal API
 * key needs no app at all, so it lives in Settings → Widgets next to the
 * widget it powers; this section exists for the narrower-scoped alternative,
 * which does need a registered app because Linear checks the redirect URI
 * against its allowlist. See `docs/linear.md`.
 */
function buildLinearAuthSection(): HTMLElement {
  return buildOAuthSection({
    heading: "Linear sign-in",
    clientIdKey: "linearClientId",
    placeholder: "OAuth application client ID",
    help:
      `Optional. The Linear widget connects with a personal API key under <strong>Widgets → Linear</strong>, which needs none of this. ` +
      `To sign in with OAuth instead, create an application under ` +
      `<a href="https://linear.app/settings/api/applications/new" target="_blank" rel="noopener" class="underline text-accent">Linear → API → Applications</a>, ` +
      `add the redirect URI above as a callback URL, tick <strong>public client</strong> so it can use PKCE, and paste the client ID here — no secret needed. ` +
      `Changing this disconnects the current OAuth session.`,
  })
}

const CAPABILITY_STYLE: Record<Capability["state"], { label: string; className: string }> = {
  available: { label: "Available", className: "text-accent" },
  degraded: { label: "Needs setup", className: "text-muted" },
  unavailable: { label: "Unavailable", className: "text-danger" },
  unknown: { label: "Not checked", className: "text-muted" },
}

/**
 * Reports what the browser actually provides rather than guessing which browser
 * it is — the same capability can be missing for several unrelated reasons.
 */
function buildCapabilityPanel(): HTMLElement {
  const section = document.createElement("div")
  section.appendChild(sectionHeading("Browser capabilities"))

  const list = document.createElement("div")
  list.className = "flex flex-col"
  section.appendChild(list)

  const checkBtn = createButton("Re-check", "outline", {
    icon: getIconSvg("refresh"),
    onClick: () => run(true),
  })
  checkBtn.className += " self-start mt-2"
  section.appendChild(checkBtn)

  function render(capabilities: Capability[]): void {
    list.replaceChildren()

    for (const cap of capabilities) {
      const row = document.createElement("div")
      row.className = "py-2.5 border-b border-input-border/10 last:border-b-0"

      const top = document.createElement("div")
      top.className = "flex items-center justify-between gap-3"

      const name = document.createElement("span")
      name.className = "text-sm text-foreground"
      name.textContent = cap.label

      const style = CAPABILITY_STYLE[cap.state]
      const badge = document.createElement("span")
      badge.className = `text-xs shrink-0 ${style.className}`
      badge.textContent = style.label

      top.appendChild(name)
      top.appendChild(badge)
      row.appendChild(top)

      const detail = document.createElement("p")
      detail.className = "text-xs text-muted mt-0.5"
      detail.textContent = cap.detail
      row.appendChild(detail)

      list.appendChild(row)
    }
  }

  async function run(force: boolean): Promise<void> {
    checkBtn.disabled = true
    setButtonLabel(checkBtn, force ? "Checking…" : "Re-check")
    try {
      render(await probeCapabilities(force))
    } finally {
      checkBtn.disabled = false
      setButtonLabel(checkBtn, "Re-check")
    }
  }

  run(false)
  store.sync.subscribe("googleClientId", () => run(false))

  return section
}

export function initSettings(): void {
  const { dialog, body, open, close } = createDialog()
  dialog.id = "settings-dialog"
  dialog.setAttribute("aria-labelledby", "settings-title")

  body.className = "flex w-[900px] h-[600px] max-w-[95vw] max-h-[85vh]"

  const nav = document.createElement("nav")
  nav.id = "settings-nav"
  nav.className =
    "relative flex flex-col items-center w-16 shrink-0 py-3 gap-1 border-r"
  nav.setAttribute("aria-label", "Settings sections")
  nav.style.background = "color-mix(in srgb, var(--panel) 10%, transparent)"
  body.appendChild(nav)

  const main = document.createElement("div")
  main.className = "flex-1 flex flex-col min-w-0"

  const header = document.createElement("div")
  header.className =
    "flex items-center justify-between px-6 h-14 shrink-0 border-b border-input-border/10"

  const title = document.createElement("h2")
  title.id = "settings-title"
  title.className = "text-base font-semibold tracking-tight"
  title.textContent = "General"
  header.appendChild(title)

  const closeBtn = document.createElement("button")
  closeBtn.id = "settings-close"
  closeBtn.className =
    "w-8 h-8 flex items-center justify-center rounded-theme text-muted hover:text-foreground hover:bg-surface transition-colors"
  closeBtn.setAttribute("aria-label", "Close settings")
  closeBtn.appendChild(icon("close"))
  closeBtn.addEventListener("click", close)
  header.appendChild(closeBtn)
  main.appendChild(header)

  const panels = document.createElement("div")
  panels.id = "settings-panels"
  panels.className = "relative flex-1 overflow-y-auto"

  const generalPanel = document.createElement("div")
  generalPanel.dataset.settingsTab = "general"
  generalPanel.className = "settings-panel"
  panels.appendChild(generalPanel)

  panels.appendChild(buildShortcutsPanel())

  const appearancePanel = document.createElement("div")
  appearancePanel.dataset.settingsTab = "appearance"
  appearancePanel.className = "settings-panel"
  appearancePanel.hidden = true
  panels.appendChild(appearancePanel)

  const widgetsPanel = document.createElement("div")
  widgetsPanel.dataset.settingsTab = "widgets"
  widgetsPanel.className = "settings-panel"
  widgetsPanel.hidden = true
  panels.appendChild(widgetsPanel)

  panels.appendChild(buildAdvancedPanel())

  main.appendChild(panels)
  body.appendChild(main)

  const navResult = buildNav()

  openDialogFn = () => {
    if (!dialog.open) open()
    refreshRearrangeFn?.()
    requestAnimationFrame(() => navResult.refreshIndicator())
  }
  closeDialogFn = () => {
    if (dialog.open) close()
  }

  const openBtn = document.getElementById("settings-open") as HTMLButtonElement
  openBtn.addEventListener("click", () => openDialogFn!())

  buildGeneralTab()
  buildAppearanceTab()
  buildWidgetsTab()

  const recsEnabled = document.getElementById(
    "settings-recommendations-enabled"
  ) as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () =>
    store.sync.set("recommendationsEnabled", recsEnabled.checked)
  )
  store.sync.subscribe("recommendationsEnabled", (v) => {
    recsEnabled.checked = v
  })
}
