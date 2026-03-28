import { store } from "./store"
import type { SyncSettings } from "./defaults"
import { ACCENT_COLORS } from "./defaults"
import { authenticate as spotifyAuthenticate, clearTokens as spotifyClearTokens } from "./spotify"
import { authenticate as calendarAuthenticate, disconnect as calendarDisconnect } from "./calendar"
import { createAccordion, createButton, createCheckbox, createDialog, createInput, createSelect, createTooltip } from "./components"
import { icon, getIconSvg } from "./icons/registry"
import { searchPhotos, TOPICS } from "./unsplash"
import { setUnsplashPhoto, setUploadedPhoto, clearBackground } from "./background"
import type { UnsplashPhoto } from "./unsplash"

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
  row.className = "flex items-center justify-between py-3 border-b border-input-border/10 last:border-b-0"
  if (opts?.hidden) row.hidden = true

  const labelEl = document.createElement("span")
  labelEl.className = "text-sm text-foreground"
  labelEl.textContent = label

  row.appendChild(labelEl)
  row.appendChild(control)
  return row
}

function buildGeneralTab(): void {
  const panel = document.querySelector('[data-settings-tab="general"]')!
  panel.className = "settings-panel px-6 pb-6"

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const clockEnabled = createCheckbox("", store.sync.get("clockEnabled"), (v) => store.sync.set("clockEnabled", v))
  wrapper.appendChild(settingsRow("Show clock", clockEnabled))

  const clockSeconds = createCheckbox("", store.sync.get("clockShowSeconds"), (v) => store.sync.set("clockShowSeconds", v))
  wrapper.appendChild(settingsRow("Show seconds", clockSeconds))

  const clock24h = createCheckbox("", store.sync.get("clock24Hour"), (v) => {
    store.sync.set("clock24Hour", v)
    ampmRow.hidden = v
  })
  wrapper.appendChild(settingsRow("24-hour format", clock24h))

  const clockAmPm = createCheckbox("", store.sync.get("clockShowAmPm"), (v) => store.sync.set("clockShowAmPm", v))
  const ampmRow = settingsRow("Show AM/PM", clockAmPm, { hidden: store.sync.get("clock24Hour") })
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
    onChange: (v) => store.sync.set("clockDateFormat", v as SyncSettings["clockDateFormat"]),
  })
  const dateFormatRow = settingsRow("Date format", clockDateFormat, { hidden: !store.sync.get("clockShowDate") })
  wrapper.appendChild(dateFormatRow)

  const clockSize = createSelect({
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    value: store.sync.get("clockSize"),
    onChange: (v) => store.sync.set("clockSize", v as SyncSettings["clockSize"]),
  })
  wrapper.appendChild(settingsRow("Size", clockSize))

  panel.appendChild(wrapper)

  const sc = (el: HTMLLabelElement, v: boolean) => (el as any).setChecked(v)
  store.sync.subscribe("clockEnabled", (v) => { sc(clockEnabled, v) })
  store.sync.subscribe("clockShowSeconds", (v) => { sc(clockSeconds, v) })
  store.sync.subscribe("clock24Hour", (v) => {
    sc(clock24h, v)
    ampmRow.hidden = v
  })
  store.sync.subscribe("clockShowAmPm", (v) => { sc(clockAmPm, v) })
  store.sync.subscribe("clockShowDate", (v) => {
    sc(clockDate, v)
    dateFormatRow.hidden = !v
  })
  store.sync.subscribe("clockDateFormat", (v) => { clockDateFormat.value = v })
  store.sync.subscribe("clockSize", (v) => { clockSize.value = v })
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

function buildSwatchGroup(
  storeKey: "accentColor" | "bgColor"
): HTMLElement {
  const isAccent = storeKey === "accentColor"
  const specialValue = isAccent ? "random" : "auto"

  const container = document.createElement("div")
  container.className = "flex gap-2.5 items-center flex-wrap"

  const buttons: HTMLButtonElement[] = []

  const specialBtn = document.createElement("button")
  specialBtn.className = "w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-input-border/50 text-muted"
  specialBtn.dataset.color = specialValue
  specialBtn.innerHTML = getIconSvg(isAccent ? "randomAccent" : "autoBg")
  specialBtn.addEventListener("click", () => store.sync.set(storeKey, specialValue as any))
  specialBtn.addEventListener("mouseenter", () => {
    if (store.sync.get(storeKey) !== specialValue) specialBtn.style.transform = "scale(1.1)"
  })
  specialBtn.addEventListener("mouseleave", () => { specialBtn.style.transform = "" })

  createTooltip(specialBtn, isAccent ? "Changes color daily" : "Matches accent color")

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
    btn.addEventListener("mouseleave", () => { btn.style.transform = "" })

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

function buildModeSelector(): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-2"

  const modes: SyncSettings["mode"][] = ["light", "dark", "auto"]
  const buttons: HTMLButtonElement[] = []

  for (const mode of modes) {
    const modeIconName = mode === "light" ? "modeLight" : mode === "dark" ? "modeDark" : "modeAuto"
    const btn = createButton(mode.charAt(0).toUpperCase() + mode.slice(1), "override", {
      icon: icon(modeIconName),
    })
    btn.className += " flex-1 justify-center py-2 border rounded-theme transition-colors"

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

function buildBgTypeSelector(): HTMLElement {
  const container = document.createElement("div")
  container.className = "flex gap-2"

  const types: ["color", "image"] = ["color", "image"]
  const buttons: HTMLButtonElement[] = []

  for (const type of types) {
    const btn = createButton(type.charAt(0).toUpperCase() + type.slice(1), "override", {
      icon: type === "image" ? icon("bgImage") : undefined,
    })
    btn.className += " flex-1 justify-center py-2 border rounded-theme transition-colors"

    btn.addEventListener("click", () => {
      store.sync.set("bgType", type)
    })

    buttons.push(btn)
    container.appendChild(btn)
  }

  function updateSelected(val: string): void {
    for (let i = 0; i < types.length; i++) {
      const isSelected = types[i] === val
      buttons[i].style.background = isSelected ? "var(--accent)" : "transparent"
      buttons[i].style.color = isSelected ? "var(--accent-foreground)" : "var(--accent)"
      buttons[i].style.borderColor = "var(--accent)"
    }
  }

  updateSelected(store.sync.get("bgType"))
  store.sync.subscribe("bgType", updateSelected)

  return container
}

function buildUnsplashAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Unsplash", { variant: "settings", defaultOpen: true })

  const hasKey = (): boolean => store.sync.get("unsplashApiKey") !== ""

  const noKeyMsg = document.createElement("p")
  noKeyMsg.className = "text-xs text-muted"
  noKeyMsg.innerHTML = `Add your Unsplash API key in the <strong>Advanced</strong> tab to enable.`

  const controls = document.createElement("div")
  controls.className = "flex flex-col gap-3"

  // --- Daily row ---
  const dailyRow = document.createElement("div")
  dailyRow.className = "flex items-center justify-between"

  const dailyCheck = createCheckbox("Refresh daily", store.sync.get("unsplashDaily"), (v) => {
    store.sync.set("unsplashDaily", v)
    updateSearchDisabled()
  })
  dailyRow.appendChild(dailyCheck)

  const topicSelect = createSelect({
    options: TOPICS.map((t) => ({ value: t.slug, label: t.label })),
    value: store.sync.get("unsplashTopic"),
    onChange: (v) => store.sync.set("unsplashTopic", v),
    width: "140px",
  })
  dailyRow.appendChild(topicSelect)

  controls.appendChild(dailyRow)

  // --- Search area ---
  const searchArea = document.createElement("div")
  searchArea.className = "flex flex-col gap-2 transition-opacity"

  const searchInput = createInput({ placeholder: "Search photos..." })
  searchArea.appendChild(searchInput)

  const grid = document.createElement("div")
  grid.className = "grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto rounded-theme"
  searchArea.appendChild(grid)

  let searchTimeout: number | null = null

  searchInput.addEventListener("input", () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = window.setTimeout(async () => {
      const query = (searchInput as HTMLInputElement).value.trim()
      if (!query) { grid.innerHTML = ""; return }
      try {
        const photos = await searchPhotos(query)
        renderGrid(photos)
      } catch {
        grid.innerHTML = `<p class="text-xs text-danger col-span-3">Search failed. Check your API key.</p>`
      }
    }, 500)
  })

  function renderGrid(photos: UnsplashPhoto[]): void {
    grid.innerHTML = ""
    for (const photo of photos) {
      const thumb = document.createElement("button")
      thumb.className = "aspect-[16/10] rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all"
      thumb.style.background = `url(${photo.urls.small}) center/cover`

      thumb.addEventListener("click", async () => {
        thumb.style.opacity = "0.5"
        thumb.style.pointerEvents = "none"
        try {
          await setUnsplashPhoto(photo)
          store.sync.set("bgType", "image")
          store.sync.set("bgImageSource", "unsplash")
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

  function updateSearchDisabled(): void {
    const daily = store.sync.get("unsplashDaily")
    searchArea.style.opacity = daily ? "0.4" : ""
    searchArea.style.pointerEvents = daily ? "none" : ""
    topicSelect.style.opacity = daily ? "" : "0.4"
    topicSelect.style.pointerEvents = daily ? "" : "none"
  }
  updateSearchDisabled()

  function updateVisibility(): void {
    const key = hasKey()
    noKeyMsg.hidden = key
    controls.hidden = !key
  }
  updateVisibility()
  store.sync.subscribe("unsplashApiKey", () => updateVisibility())
  store.sync.subscribe("unsplashDaily", (v) => {
    (dailyCheck as any).setChecked(v)
    updateSearchDisabled()
  })
  store.sync.subscribe("unsplashTopic", (v) => { topicSelect.value = v })

  acc.content.appendChild(noKeyMsg)
  acc.content.appendChild(controls)

  return acc
}

function buildUploadAccordion(): { container: HTMLElement; content: HTMLElement } {
  const acc = createAccordion("Upload", { variant: "settings", defaultOpen: false })

  const fileBtn = createButton("Choose image", "outline", {
    icon: icon("bgUpload"),
  })

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = "image/*"
  fileInput.hidden = true

  fileBtn.addEventListener("click", () => fileInput.click())

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    fileBtn.querySelector("span:last-child")!.textContent = "Uploading..."
    fileBtn.disabled = true
    try {
      await setUploadedPhoto(file)
      store.sync.set("bgType", "image")
      store.sync.set("bgImageSource", "upload")
    } catch {
      // silently fail
    }
    fileBtn.disabled = false
    fileBtn.querySelector("span:last-child")!.textContent = "Choose image"
    fileInput.value = ""
  })

  acc.content.appendChild(fileBtn)
  acc.content.appendChild(fileInput)

  const note = document.createElement("p")
  note.className = "text-xs text-muted mt-1"
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
  store.sync.subscribe("theme", (v) => { themeSelect.value = v })

  const themeRow = document.createElement("div")
  themeRow.className = "flex items-center justify-between"
  const themeLbl = document.createElement("span")
  themeLbl.className = "text-sm text-foreground"
  themeLbl.textContent = "Theme"
  themeRow.appendChild(themeLbl)
  themeRow.appendChild(themeSelect)
  panel.appendChild(themeRow)

  panel.appendChild(section("Accent Color", buildSwatchGroup("accentColor")))

  // --- Background section ---
  const bgWrapper = document.createElement("div")
  bgWrapper.className = "flex flex-col gap-3"

  const bgLabel = document.createElement("span")
  bgLabel.className = "text-muted text-xs font-medium"
  bgLabel.textContent = "Background"
  bgWrapper.appendChild(bgLabel)

  bgWrapper.appendChild(buildBgTypeSelector())

  // Color swatches (shown when bgType is "color")
  const colorSection = document.createElement("div")
  colorSection.appendChild(buildSwatchGroup("bgColor"))

  // Image controls (shown when bgType is "image")
  const imageSection = document.createElement("div")
  imageSection.className = "flex flex-col gap-0"

  const unsplashAcc = buildUnsplashAccordion()
  const uploadAcc = buildUploadAccordion()

  function updateActiveIndicator(): void {
    const source = store.sync.get("bgImageSource")
    const unsplashTrigger = unsplashAcc.container.querySelector("button") as HTMLElement
    const uploadTrigger = uploadAcc.container.querySelector("button") as HTMLElement
    if (unsplashTrigger) {
      unsplashTrigger.style.borderLeft = source === "unsplash" ? "3px solid var(--accent)" : ""
      unsplashTrigger.style.paddingLeft = source === "unsplash" ? "21px" : ""
    }
    if (uploadTrigger) {
      uploadTrigger.style.borderLeft = source === "upload" ? "3px solid var(--accent)" : ""
      uploadTrigger.style.paddingLeft = source === "upload" ? "21px" : ""
    }
  }

  imageSection.appendChild(unsplashAcc.container)
  imageSection.appendChild(uploadAcc.container)
  updateActiveIndicator()
  store.sync.subscribe("bgImageSource", () => updateActiveIndicator())

  bgWrapper.appendChild(colorSection)
  bgWrapper.appendChild(imageSection)

  function updateBgType(val: string): void {
    colorSection.hidden = val !== "color"
    imageSection.hidden = val !== "image"
  }
  updateBgType(store.sync.get("bgType"))
  store.sync.subscribe("bgType", updateBgType)

  panel.appendChild(bgWrapper)
  panel.appendChild(section("Mode", buildModeSelector()))
}

function createSpotifyButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors text-white"
  btn.style.background = "#1DB954"

  btn.addEventListener("mouseenter", () => { btn.style.background = "#1aa34a" })
  btn.addEventListener("mouseleave", () => { btn.style.background = "#1DB954" })

  const icon = document.createElement("div")
  icon.style.cssText = "width: 16px; height: 16px; background: #1ed760; border-radius: 2px; flex-shrink: 0;"
  btn.appendChild(icon)

  const label = document.createElement("span")
  label.textContent = "Connect Spotify"
  btn.appendChild(label)

  btn.addEventListener("click", onClick)
  return btn
}

function createGoogleButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors"
  btn.style.cssText = "background: #ffffff; color: #3c4043; border: 1px solid #dadce0;"

  btn.addEventListener("mouseenter", () => { btn.style.background = "#f8f9fa" })
  btn.addEventListener("mouseleave", () => { btn.style.background = "#ffffff" })

  const icon = document.createElement("div")
  icon.style.cssText = "width: 16px; height: 16px; background: #4285F4; border-radius: 2px; flex-shrink: 0;"
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
  const searchAcc = createAccordion("Search", { variant: "settings", defaultOpen: false })

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
    onChange: (v) => store.sync.set("searchEngine", v as SyncSettings["searchEngine"]),
  })
  searchAcc.content.appendChild(settingsRow("Search Engine", searchEngine))
  store.sync.subscribe("searchEngine", (v) => { searchEngine.value = v })

  const debounce = createCheckbox("", store.sync.get("debounceSearch"), (v) => store.sync.set("debounceSearch", v))
  searchAcc.content.appendChild(settingsRow("Debounce shortcut search", debounce))
  store.sync.subscribe("debounceSearch", (v) => { (debounce as any).setChecked(v) })

  panel.appendChild(searchAcc.container)

  // --- Todo ---
  const todoAcc = createAccordion("Todo", { variant: "settings", defaultOpen: false })

  const todoEnabled = createCheckbox("", store.sync.get("todoEnabled"), (v) => store.sync.set("todoEnabled", v))
  todoAcc.content.appendChild(settingsRow("Enable todo widget", todoEnabled))
  store.sync.subscribe("todoEnabled", (v) => { (todoEnabled as any).setChecked(v) })

  const todoBadges = createCheckbox("", store.sync.get("todoShowBadges"), (v) => store.sync.set("todoShowBadges", v))
  todoAcc.content.appendChild(settingsRow("Show badges", todoBadges))
  store.sync.subscribe("todoShowBadges", (v) => { (todoBadges as any).setChecked(v) })

  const clearRow = document.createElement("div")
  clearRow.className = "flex justify-end"
  const clearBtn = createButton("Clear all todos", "destructive", {
    onClick: () => { if (confirm("Are you sure you want to clear all todos?")) store.local.set("todos", []) },
  })
  clearRow.appendChild(clearBtn)
  todoAcc.content.appendChild(clearRow)

  panel.appendChild(todoAcc.container)

  // --- Weather ---
  const weatherAcc = createAccordion("Weather", { variant: "settings", defaultOpen: false })

  const weatherEnabled = createCheckbox("", store.sync.get("weatherEnabled"), (v) => store.sync.set("weatherEnabled", v))
  weatherAcc.content.appendChild(settingsRow("Enable weather", weatherEnabled))
  store.sync.subscribe("weatherEnabled", (v) => { (weatherEnabled as any).setChecked(v) })

  const weatherUnit = createSelect({
    options: [
      { value: "f", label: "Fahrenheit" },
      { value: "c", label: "Celsius" },
    ],
    value: store.sync.get("weatherUnit"),
    onChange: (v) => store.sync.set("weatherUnit", v as SyncSettings["weatherUnit"]),
  })
  weatherAcc.content.appendChild(settingsRow("Temperature unit", weatherUnit))
  store.sync.subscribe("weatherUnit", (v) => { weatherUnit.value = v })

  const locationRow = document.createElement("div")
  const grantBtn = createButton("Grant location access", "primary", {
    onClick: () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          store.local.set("weatherLat", pos.coords.latitude)
          store.local.set("weatherLon", pos.coords.longitude)
          locationRow.hidden = true
        },
        () => { locationHelp.hidden = false },
        { timeout: 10000 }
      )
    },
  })
  locationRow.appendChild(grantBtn)

  const locationHelp = document.createElement("p")
  locationHelp.className = "text-xs text-muted mt-1"
  locationHelp.textContent = "Location access was denied. Please enable it in your browser settings for this extension."
  locationHelp.hidden = true
  locationRow.appendChild(locationHelp)

  locationRow.hidden = store.local.get("weatherLat") !== null
  store.local.subscribe("weatherLat", () => { locationRow.hidden = store.local.get("weatherLat") !== null })

  weatherAcc.content.appendChild(locationRow)
  panel.appendChild(weatherAcc.container)

  // --- Spotify ---
  const spotifyAcc = createAccordion("Spotify", { variant: "settings", defaultOpen: false })

  const spotifyEnabled = createCheckbox("", store.sync.get("spotifyEnabled"), (v) => store.sync.set("spotifyEnabled", v))
  spotifyAcc.content.appendChild(settingsRow("Enable Spotify widget", spotifyEnabled))
  store.sync.subscribe("spotifyEnabled", (v) => { (spotifyEnabled as any).setChecked(v) })

  const spotifyConnectRow = document.createElement("div")
  const spotifyBtn = createSpotifyButton(async () => {
    spotifyBtn.disabled = true
    spotifyBtn.querySelector("span")!.textContent = "Connecting..."
    const success = await spotifyAuthenticate()
    spotifyBtn.disabled = false
    spotifyBtn.querySelector("span")!.textContent = "Connect Spotify"
    if (success) updateSpotifyUI()
  })
  spotifyConnectRow.appendChild(spotifyBtn)

  const spotifyDisconnectRow = document.createElement("div")
  spotifyDisconnectRow.hidden = true
  const spotifyDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: () => { spotifyClearTokens(); updateSpotifyUI() },
  })
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
  const calendarAcc = createAccordion("Google Calendar", { variant: "settings", defaultOpen: false })

  const calendarEnabled = createCheckbox("", store.sync.get("calendarEnabled"), (v) => store.sync.set("calendarEnabled", v))
  calendarAcc.content.appendChild(settingsRow("Enable Google Calendar", calendarEnabled))
  store.sync.subscribe("calendarEnabled", (v) => { (calendarEnabled as any).setChecked(v) })

  const calConnectRow = document.createElement("div")
  const calBtn = createGoogleButton(async () => {
    calBtn.disabled = true
    calBtn.querySelector("span")!.textContent = "Signing in..."
    const success = await calendarAuthenticate()
    calBtn.disabled = false
    calBtn.querySelector("span")!.textContent = "Sign in with Google"
    if (success) updateCalendarUI()
  })
  calConnectRow.appendChild(calBtn)

  const calDisconnectRow = document.createElement("div")
  calDisconnectRow.hidden = true
  const calDisconnectBtn = createButton("Disconnect", "destructive-outline", {
    onClick: async () => { await calendarDisconnect(); updateCalendarUI() },
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
  let activePanel = panels.querySelector('[data-settings-tab="general"]') as HTMLElement
  let switching = false

  const navButtons: HTMLButtonElement[] = []

  function indicatorTop(index: number): number {
    return 12 + index * 52 + 14
  }

  indicator.style.transform = `translateY(${indicatorTop(0)}px)`

  TABS.forEach((tab, index) => {
    const btn = document.createElement("button")
    btn.className = `relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors ${
      index === 0 ? "text-accent" : "text-muted hover:text-foreground hover:bg-surface"
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

    const newPanel = panels.querySelector(`[data-settings-tab="${tabId}"]`) as HTMLElement
    const oldPanel = activePanel

    navButtons[activeIndex].className =
      "relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors text-muted hover:text-foreground hover:bg-surface"
    navButtons[activeIndex].removeAttribute("aria-selected")
    navButtons[index].className =
      "relative w-12 h-12 flex items-center justify-center rounded-theme transition-colors text-accent"
    navButtons[index].setAttribute("aria-selected", "true")

    const titleFadeOut = title.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 50, easing: "ease-in", fill: "forwards" }
    )

    setTimeout(() => {
      titleFadeOut.cancel()
      title.textContent = TABS[index].label
      const titleFadeIn = title.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 50, easing: "ease-out", fill: "forwards" }
      )
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

    const fadeOut = oldPanel.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 50, easing: "ease-in", fill: "forwards" }
    )

    setTimeout(() => {
      const fadeIn = newPanel.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 50, easing: "ease-out", fill: "forwards" }
      )

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
  controlBar.className = "flex items-center justify-between px-6 py-3 shrink-0 border-t border-input-border/15"
  panel.appendChild(controlBar)

  const recsRow = document.createElement("div")
  recsRow.className = "flex items-center gap-2 px-6 pb-4 pt-1 border-t border-input-border/15"

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

  return panel
}

function buildAdvancedPanel(): HTMLDivElement {
  const panel = document.createElement("div")
  panel.dataset.settingsTab = "advanced"
  panel.className = "settings-panel pb-6 px-6"
  panel.hidden = true

  const wrapper = document.createElement("div")
  wrapper.className = "flex flex-col"

  const keyInput = createInput({ type: "password", placeholder: "Paste your API key" })
  keyInput.value = store.sync.get("unsplashApiKey")
  keyInput.style.width = "220px"
  keyInput.addEventListener("change", () => {
    store.sync.set("unsplashApiKey", (keyInput as HTMLInputElement).value.trim())
  })
  store.sync.subscribe("unsplashApiKey", (v) => { (keyInput as HTMLInputElement).value = v })

  const keyRow = document.createElement("div")
  keyRow.className = "flex items-center justify-between py-3 border-b border-input-border/10"

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

  panel.appendChild(wrapper)
  return panel
}

export function initSettings(): void {
  const { dialog, body, open, close } = createDialog()
  dialog.id = "settings-dialog"
  dialog.setAttribute("aria-labelledby", "settings-title")

  body.className = "flex w-[725px] h-[480px] max-h-[80vh]"

  const nav = document.createElement("nav")
  nav.id = "settings-nav"
  nav.className = "relative flex flex-col items-center w-16 shrink-0 py-3 gap-1 border-r"
  nav.setAttribute("aria-label", "Settings sections")
  nav.style.background = "color-mix(in srgb, var(--panel) 10%, transparent)"
  body.appendChild(nav)

  const main = document.createElement("div")
  main.className = "flex-1 flex flex-col min-w-0"

  const header = document.createElement("div")
  header.className = "flex items-center justify-between px-6 h-14 shrink-0 border-b border-input-border/10"

  const title = document.createElement("h2")
  title.id = "settings-title"
  title.className = "text-base font-semibold tracking-tight"
  title.textContent = "General"
  header.appendChild(title)

  const closeBtn = document.createElement("button")
  closeBtn.id = "settings-close"
  closeBtn.className = "w-8 h-8 flex items-center justify-center rounded-theme text-muted hover:text-foreground hover:bg-surface transition-colors"
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

  const recsEnabled = document.getElementById("settings-recommendations-enabled") as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () => store.sync.set("recommendationsEnabled", recsEnabled.checked))
  store.sync.subscribe("recommendationsEnabled", (v) => { recsEnabled.checked = v })
}
