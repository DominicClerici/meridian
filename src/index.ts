import { store } from "./store"
import { applyBgColor, initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search"
import { initClock } from "./clock"
import { initTodo } from "./todo"
import { initWeather } from "./weather"
import { initSpotify } from "./spotify"
import { initHistoryImport } from "./history-import"

applyBgColor(store.sync.get("bgColor"))
store.sync.subscribe("bgColor", applyBgColor)

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
})
