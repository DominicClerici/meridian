import { store } from "./store"
import type { SyncSettings } from "./defaults"
import { authenticate as spotifyAuthenticate, clearTokens as spotifyClearTokens } from "./spotify"
import { authenticate as calendarAuthenticate, disconnect as calendarDisconnect } from "./calendar"
import { createAccordion } from "./components"

const TABS = [
  {
    id: "general",
    label: "General",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3"/><circle cx="4" cy="14" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="20" cy="16" r="2"/></svg>`,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  },
  {
    id: "widgets",
    label: "Widgets",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  },
]

function wireButtonGroup(
  dialog: HTMLElement,
  settingAttr: string,
  storeKey: keyof SyncSettings
): void {
  const btns = dialog.querySelectorAll<HTMLButtonElement>(`[data-setting="${settingAttr}"]`)

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      store.sync.set(storeKey, btn.dataset.value as any)
    })
  })

  function updateActive(val: string): void {
    btns.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.value === val))
    })
  }

  updateActive(store.sync.get(storeKey) as string)
  store.sync.subscribe(storeKey, (val) => updateActive(val as string))
}

function buildNav(dialog: HTMLDialogElement): { refreshIndicator: () => void } {
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
    btn.innerHTML = tab.icon
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

function buildWidgetAccordions(): void {
  const widgetsPanel = document.querySelector('[data-settings-tab="widgets"]')!
  const sections = widgetsPanel.querySelectorAll<HTMLElement>("[data-widget-section]")

  sections.forEach((section) => {
    const label = section.getAttribute("data-widget-section")!
    const acc = createAccordion(label, { variant: "settings", defaultOpen: false })

    while (section.firstChild) {
      acc.content.appendChild(section.firstChild)
    }

    section.replaceWith(acc.container)
  })
}

function setupDialogBehavior(
  dialog: HTMLDialogElement,
  nav: { refreshIndicator: () => void }
): void {
  const openBtn = document.getElementById("settings-open") as HTMLButtonElement
  const closeBtn = document.getElementById("settings-close") as HTMLButtonElement

  function closeWithAnimation(): void {
    if (dialog.classList.contains("closing")) return
    dialog.classList.add("closing")

    let closed = false
    const done = () => {
      if (closed) return
      closed = true
      dialog.classList.remove("closing")
      dialog.close()
    }

    dialog.addEventListener("animationend", done, { once: true })
    setTimeout(done, 150)
  }

  openBtn.addEventListener("click", () => {
    dialog.showModal()
    requestAnimationFrame(() => nav.refreshIndicator())
  })

  closeBtn.addEventListener("click", closeWithAnimation)

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeWithAnimation()
  })

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault()
    closeWithAnimation()
  })
}

export function initSettings(): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement

  const nav = buildNav(dialog)
  buildWidgetAccordions()
  setupDialogBehavior(dialog, nav)

  wireButtonGroup(dialog, "bg", "bgColor")
  wireButtonGroup(dialog, "accent", "accentColor")
  wireButtonGroup(dialog, "mode", "mode")

  const themeSelect = document.getElementById("settings-theme") as HTMLSelectElement
  themeSelect.value = store.sync.get("theme")
  themeSelect.addEventListener("change", () => {
    store.sync.set("theme", themeSelect.value as SyncSettings["theme"])
  })
  store.sync.subscribe("theme", (val) => { themeSelect.value = val })

  const engineSelect = document.getElementById(
    "settings-search-engine"
  ) as HTMLSelectElement
  const debounceCheckbox = document.getElementById(
    "settings-debounce-search"
  ) as HTMLInputElement

  engineSelect.value = store.sync.get("searchEngine")
  engineSelect.addEventListener("change", () => {
    store.sync.set(
      "searchEngine",
      engineSelect.value as SyncSettings["searchEngine"]
    )
  })
  store.sync.subscribe("searchEngine", (val) => {
    engineSelect.value = val
  })

  debounceCheckbox.checked = store.sync.get("debounceSearch")
  debounceCheckbox.addEventListener("change", () => {
    store.sync.set("debounceSearch", debounceCheckbox.checked)
  })
  store.sync.subscribe("debounceSearch", (val) => {
    debounceCheckbox.checked = val
  })

  const clockEnabled = document.getElementById("settings-clock-enabled") as HTMLInputElement
  const clockSeconds = document.getElementById("settings-clock-seconds") as HTMLInputElement
  const clock24h = document.getElementById("settings-clock-24h") as HTMLInputElement
  const clockAmPm = document.getElementById("settings-clock-ampm") as HTMLInputElement
  const clockAmPmRow = document.getElementById("settings-clock-ampm-row") as HTMLElement
  const clockDate = document.getElementById("settings-clock-date") as HTMLInputElement
  const clockDateFormat = document.getElementById("settings-clock-date-format") as HTMLSelectElement
  const clockDateFormatRow = document.getElementById("settings-clock-date-format-row") as HTMLElement
  const clockSize = document.getElementById("settings-clock-size") as HTMLSelectElement

  clockEnabled.checked = store.sync.get("clockEnabled")
  clockSeconds.checked = store.sync.get("clockShowSeconds")
  clock24h.checked = store.sync.get("clock24Hour")
  clockAmPm.checked = store.sync.get("clockShowAmPm")
  clockDate.checked = store.sync.get("clockShowDate")
  clockDateFormat.value = store.sync.get("clockDateFormat")
  clockSize.value = store.sync.get("clockSize")
  clockAmPmRow.hidden = store.sync.get("clock24Hour")
  clockDateFormatRow.hidden = !store.sync.get("clockShowDate")

  clockEnabled.addEventListener("change", () => store.sync.set("clockEnabled", clockEnabled.checked))
  clockSeconds.addEventListener("change", () => store.sync.set("clockShowSeconds", clockSeconds.checked))
  clock24h.addEventListener("change", () => {
    store.sync.set("clock24Hour", clock24h.checked)
    clockAmPmRow.hidden = clock24h.checked
  })
  clockAmPm.addEventListener("change", () => store.sync.set("clockShowAmPm", clockAmPm.checked))
  clockDate.addEventListener("change", () => {
    store.sync.set("clockShowDate", clockDate.checked)
    clockDateFormatRow.hidden = !clockDate.checked
  })
  clockDateFormat.addEventListener("change", () => store.sync.set("clockDateFormat", clockDateFormat.value as SyncSettings["clockDateFormat"]))
  clockSize.addEventListener("change", () => store.sync.set("clockSize", clockSize.value as SyncSettings["clockSize"]))

  store.sync.subscribe("clockEnabled", (v) => { clockEnabled.checked = v })
  store.sync.subscribe("clockShowSeconds", (v) => { clockSeconds.checked = v })
  store.sync.subscribe("clock24Hour", (v) => {
    clock24h.checked = v
    clockAmPmRow.hidden = v
  })
  store.sync.subscribe("clockShowAmPm", (v) => { clockAmPm.checked = v })
  store.sync.subscribe("clockShowDate", (v) => {
    clockDate.checked = v
    clockDateFormatRow.hidden = !v
  })
  store.sync.subscribe("clockDateFormat", (v) => { clockDateFormat.value = v })
  store.sync.subscribe("clockSize", (v) => { clockSize.value = v })

  const recsEnabled = document.getElementById("settings-recommendations-enabled") as HTMLInputElement
  recsEnabled.checked = store.sync.get("recommendationsEnabled")
  recsEnabled.addEventListener("change", () => store.sync.set("recommendationsEnabled", recsEnabled.checked))
  store.sync.subscribe("recommendationsEnabled", (v) => { recsEnabled.checked = v })

  const todoEnabled = document.getElementById("settings-todo-enabled") as HTMLInputElement
  const todoBadges = document.getElementById("settings-todo-badges") as HTMLInputElement
  const todoClear = document.getElementById("settings-todo-clear") as HTMLButtonElement

  todoEnabled.checked = store.sync.get("todoEnabled")
  todoBadges.checked = store.sync.get("todoShowBadges")

  todoEnabled.addEventListener("change", () => store.sync.set("todoEnabled", todoEnabled.checked))
  todoBadges.addEventListener("change", () => store.sync.set("todoShowBadges", todoBadges.checked))
  todoClear.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all todos?")) {
      store.local.set("todos", [])
    }
  })

  store.sync.subscribe("todoEnabled", (v) => { todoEnabled.checked = v })
  store.sync.subscribe("todoShowBadges", (v) => { todoBadges.checked = v })

  const weatherEnabled = document.getElementById("settings-weather-enabled") as HTMLInputElement
  const weatherUnit = document.getElementById("settings-weather-unit") as HTMLSelectElement
  const weatherGrant = document.getElementById("settings-weather-grant") as HTMLButtonElement
  const weatherLocationRow = document.getElementById("settings-weather-location-row") as HTMLElement
  const weatherLocationHelp = document.getElementById("settings-weather-location-help") as HTMLElement

  weatherEnabled.checked = store.sync.get("weatherEnabled")
  weatherUnit.value = store.sync.get("weatherUnit")

  function updateWeatherLocationUI(): void {
    const hasCoords = store.local.get("weatherLat") !== null
    weatherLocationRow.hidden = hasCoords
  }
  updateWeatherLocationUI()

  weatherEnabled.addEventListener("change", () => store.sync.set("weatherEnabled", weatherEnabled.checked))
  weatherUnit.addEventListener("change", () => store.sync.set("weatherUnit", weatherUnit.value as SyncSettings["weatherUnit"]))
  weatherGrant.addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store.local.set("weatherLat", pos.coords.latitude)
        store.local.set("weatherLon", pos.coords.longitude)
        updateWeatherLocationUI()
        weatherLocationHelp.hidden = true
      },
      () => {
        weatherLocationHelp.hidden = false
      },
      { timeout: 10000 }
    )
  })

  store.sync.subscribe("weatherEnabled", (v) => { weatherEnabled.checked = v })
  store.sync.subscribe("weatherUnit", (v) => { weatherUnit.value = v })
  store.local.subscribe("weatherLat", () => updateWeatherLocationUI())

  const spotifyEnabled = document.getElementById("settings-spotify-enabled") as HTMLInputElement
  const spotifyConnectRow = document.getElementById("settings-spotify-connect-row") as HTMLElement
  const spotifyDisconnectRow = document.getElementById("settings-spotify-disconnect-row") as HTMLElement
  const spotifyConnect = document.getElementById("settings-spotify-connect") as HTMLButtonElement
  const spotifyDisconnect = document.getElementById("settings-spotify-disconnect") as HTMLButtonElement

  spotifyEnabled.checked = store.sync.get("spotifyEnabled")

  function updateSpotifyAuthUI(): void {
    const hasToken = store.local.get("spotifyAccessToken") !== null
    spotifyConnectRow.hidden = hasToken
    spotifyDisconnectRow.hidden = !hasToken
  }
  updateSpotifyAuthUI()

  spotifyEnabled.addEventListener("change", () => store.sync.set("spotifyEnabled", spotifyEnabled.checked))
  spotifyConnect.addEventListener("click", async () => {
    spotifyConnect.disabled = true
    spotifyConnect.textContent = "Connecting..."
    const success = await spotifyAuthenticate()
    spotifyConnect.disabled = false
    spotifyConnect.textContent = "Connect Spotify"
    if (success) updateSpotifyAuthUI()
  })
  spotifyDisconnect.addEventListener("click", () => {
    spotifyClearTokens()
    updateSpotifyAuthUI()
  })

  store.sync.subscribe("spotifyEnabled", (v) => { spotifyEnabled.checked = v })
  store.local.subscribe("spotifyAccessToken", () => updateSpotifyAuthUI())

  const calendarEnabled = document.getElementById("settings-calendar-enabled") as HTMLInputElement
  const calendarConnectRow = document.getElementById("settings-calendar-connect-row") as HTMLElement
  const calendarDisconnectRow = document.getElementById("settings-calendar-disconnect-row") as HTMLElement
  const calendarConnectBtn = document.getElementById("settings-calendar-connect") as HTMLButtonElement
  const calendarDisconnectBtn = document.getElementById("settings-calendar-disconnect") as HTMLButtonElement

  calendarEnabled.checked = store.sync.get("calendarEnabled")

  function updateCalendarAuthUI(): void {
    const connected = store.local.get("calendarConnected")
    calendarConnectRow.hidden = connected
    calendarDisconnectRow.hidden = !connected
  }
  updateCalendarAuthUI()

  calendarEnabled.addEventListener("change", () => store.sync.set("calendarEnabled", calendarEnabled.checked))
  calendarConnectBtn.addEventListener("click", async () => {
    calendarConnectBtn.disabled = true
    calendarConnectBtn.textContent = "Signing in..."
    const success = await calendarAuthenticate()
    calendarConnectBtn.disabled = false
    calendarConnectBtn.textContent = "Sign in with Google"
    if (success) updateCalendarAuthUI()
  })
  calendarDisconnectBtn.addEventListener("click", async () => {
    await calendarDisconnect()
    updateCalendarAuthUI()
  })

  store.sync.subscribe("calendarEnabled", (v) => { calendarEnabled.checked = v })
  store.local.subscribe("calendarConnected", () => updateCalendarAuthUI())
}
