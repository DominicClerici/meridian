import { store } from "./store"
import { applyBgColor, initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search"

applyBgColor(store.sync.get("bgColor"))
store.sync.subscribe("bgColor", applyBgColor)

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
})
