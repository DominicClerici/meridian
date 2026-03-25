import { store } from "./store"
import { applyTheme, subscribeTheme } from "./theme"
import { initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search"
import { initClock } from "./clock"
import { initTodo } from "./todo"
import { initWeather } from "./weather"
import { initSpotify } from "./spotify"
import { initHistoryImport } from "./history-import"
import { initRecommendations } from "./recommendations"
import { initCalendar } from "./calendar"

applyTheme()
subscribeTheme()

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initHistoryImport()
  initSearch()
  initClock()
  initTodo()
  initWeather()
  initSpotify()
  initRecommendations()
  initCalendar()
})
