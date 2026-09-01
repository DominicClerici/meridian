import "./icons/modern"
import { store } from "./store"
import { icon } from "./icons/registry"
import { applyTheme, subscribeTheme } from "./theme"
import { applyBackground, subscribeBackground } from "./background"
import { applyLayout, subscribeLayout } from "./layout"
import { initSettings } from "./settings"
import { initDock } from "./dock"
import { initShortcutSettings } from "./shortcut-settings"
import { initSearch } from "./search/index"
import { initClock } from "./clock"
import { initWorldClocks } from "./world-clocks"
import { initTodo } from "./todo"
import { initNotepad } from "./notepad"
import { initWeather } from "./weather"
import { initSpotify } from "./spotify"
import { initRecommendations } from "./recommendations"
import { initCalendar } from "./calendar"
import { initGithub } from "./github"
import { initLinear } from "./linear"
import { initMail } from "./mail"

applyTheme()
subscribeTheme()
applyBackground()
subscribeBackground()
applyLayout()
subscribeLayout()

document.getElementById("settings-open")!.prepend(icon("settings", { size: 24 }))
document.querySelector("#search-bar .search-bar-glyph")!.appendChild(icon("search", { size: 18 }))
document.getElementById("todo-trigger")!.prepend(icon("todoList", { size: 24 }))
document.getElementById("notepad-trigger")!.prepend(icon("notepad", { size: 24 }))
document.getElementById("github-trigger")!.prepend(icon("github", { size: 22 }))
document.getElementById("linear-trigger")!.prepend(icon("linear", { size: 21 }))
document.getElementById("mail-trigger")!.prepend(icon("mail", { size: 22 }))

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
  initClock()
  initWorldClocks()
  initTodo()
  initNotepad()
  initWeather()
  initSpotify()
  initRecommendations()
  initCalendar()
  initGithub()
  initLinear()
  initMail()
})
