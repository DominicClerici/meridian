import { store } from "./store"
import type { SyncSettings } from "./defaults"
import { ACCENT_COLORS, LAYOUT_MODES } from "./defaults"
import {
  authenticate as spotifyAuthenticate,
  clearTokens as spotifyClearTokens,
} from "./spotify"
import {
  authenticate as calendarAuthenticate,
  disconnect as calendarDisconnect,
} from "./calendar"
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

  updateSelected(store.sync.get("layout"))
  store.sync.subscribe("layout", updateSelected)

  return container
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
  todoAcc.content.appendChild(settingsRow("Show badges", todoBadges))
  store.sync.subscribe("todoShowBadges", (v) => {
    ;(todoBadges as any).setChecked(v)
  })

  const clearRow = document.createElement("div")
  clearRow.className = "flex justify-end"
  const clearBtn = createButton("Clear all todos", "destructive", {
    onClick: () => {
      if (confirm("Are you sure you want to clear all todos?"))
        store.local.set("todos", [])
    },
  })
  clearRow.appendChild(clearBtn)
  todoAcc.content.appendChild(clearRow)

  panel.appendChild(todoAcc.container)

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

  weatherAcc.content.appendChild(buildLocationControls())
  panel.appendChild(weatherAcc.container)

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

  const tabBar = document.createElement("div")
  tabBar.id = "sc-tab-bar"
  tabBar.className = "flex items-center gap-1.5 px-6 pt-4 pb-3 shrink-0"
  panel.appendChild(tabBar)

  const itemList = document.createElement("div")
  itemList.id = "sc-item-list"
  itemList.className = "flex-1 overflow-y-auto px-6"
  panel.appendChild(itemList)

  const controlBar = document.createElement("div")
  controlBar.id = "sc-control-bar"
  controlBar.className =
    "flex items-center justify-between px-6 py-3 shrink-0 border-t border-input-border/15"
  panel.appendChild(controlBar)

  const recsRow = document.createElement("div")
  recsRow.className =
    "flex items-center gap-2 px-6 pb-4 pt-1 border-t border-input-border/15"

  const recsInput = document.createElement("input")
  recsInput.type = "checkbox"
  recsInput.id = "settings-recommendations-enabled"
  recsInput.className = "rounded accent-accent shrink-0"
  recsRow.appendChild(recsInput)

  const recsLabel = document.createElement("label")
  recsLabel.htmlFor = "settings-recommendations-enabled"
  recsLabel.className = "text-sm"
  recsLabel.textContent = "Show smart suggestions in dock"
  recsRow.appendChild(recsLabel)

  panel.appendChild(recsRow)

  const openInRow = document.createElement("div")
  openInRow.className =
    "flex items-center justify-between px-6 pb-4 pt-1 border-t border-input-border/15"

  const openInLabel = document.createElement("span")
  openInLabel.className = "text-sm"
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

  panel.appendChild(openInRow)

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
 * Only needed where `identity.getAuthToken` doesn't work — de-Googled Chromium
 * builds, and any non-Chrome browser. Always shown so the setup path is
 * discoverable before sign-in fails rather than only after.
 */
function buildGoogleAuthSection(): HTMLElement {
  const section = document.createElement("div")
  section.appendChild(sectionHeading("Google Calendar sign-in"))

  const clientInput = createInput({
    placeholder: "…apps.googleusercontent.com",
  }) as HTMLInputElement
  clientInput.value = store.sync.get("googleClientId")
  clientInput.style.width = "220px"
  clientInput.addEventListener("change", () => {
    store.sync.set("googleClientId", clientInput.value.trim())
  })
  store.sync.subscribe("googleClientId", (v) => {
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
  help.innerHTML =
    `Leave this blank if "Sign in with Google" already works — it's only needed when your browser has no Google account service. ` +
    `In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" class="underline text-accent">Google Cloud Console</a>, ` +
    `enable the Calendar API, create an OAuth client of type <strong>Web application</strong>, add the redirect URI above, and paste the client ID here.`
  section.appendChild(help)

  return section
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

  body.className = "flex w-[725px] h-[480px] max-h-[80vh]"

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

  const openBtn = document.getElementById("settings-open") as HTMLButtonElement
  openBtn.addEventListener("click", () => {
    open()
    requestAnimationFrame(() => navResult.refreshIndicator())
  })

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
