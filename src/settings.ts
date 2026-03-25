import { store } from "./store"
import type { SyncSettings } from "./defaults"
import { authenticate as spotifyAuthenticate, clearTokens as spotifyClearTokens } from "./spotify"
import { authenticate as calendarAuthenticate, disconnect as calendarDisconnect } from "./calendar"

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

export function initSettings(): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement
  const openBtn = document.getElementById("settings-open") as HTMLButtonElement
  const closeBtn = document.getElementById(
    "settings-close"
  ) as HTMLButtonElement

  openBtn.addEventListener("click", () => dialog.showModal())
  closeBtn.addEventListener("click", () => dialog.close())

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
