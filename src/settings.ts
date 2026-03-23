import { store } from "./store"
import type { SyncSettings } from "./defaults"

const BG_CLASSES: Record<SyncSettings["bgColor"], string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
}

export function applyBgColor(color: SyncSettings["bgColor"]): void {
  const cls = BG_CLASSES[color]
  if (!cls) return
  document.body.classList.remove("bg-red-500", "bg-green-500", "bg-blue-500")
  document.body.classList.add(cls)
}

export function initSettings(): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement
  const openBtn = document.getElementById("settings-open") as HTMLButtonElement
  const closeBtn = document.getElementById(
    "settings-close"
  ) as HTMLButtonElement
  const colorBtns = dialog.querySelectorAll<HTMLButtonElement>("[data-color]")

  openBtn.addEventListener("click", () => dialog.showModal())
  closeBtn.addEventListener("click", () => dialog.close())

  colorBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color as SyncSettings["bgColor"]
      store.sync.set("bgColor", color)
    })
  })

  function updateActiveButton(color: SyncSettings["bgColor"]): void {
    colorBtns.forEach((btn) => {
      const isActive = btn.dataset.color === color
      btn.setAttribute("aria-pressed", String(isActive))
    })
  }

  updateActiveButton(store.sync.get("bgColor"))
  store.sync.subscribe("bgColor", updateActiveButton)

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
}
