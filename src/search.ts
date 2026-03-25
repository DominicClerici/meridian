import { store } from "./store"
import { searchEngineProvider } from "./search-provider-engine"
import { shortcutsProvider } from "./search-provider-shortcuts"

export type SearchResult = {
  label: string
  description?: string
  action: () => void
  icon?: string
}

export type SearchProvider = {
  id: string
  order: number
  maxResults: number
  debounced?: boolean
  query(input: string): SearchResult[]
}

const providers: SearchProvider[] = []

export function registerProvider(provider: SearchProvider): void {
  providers.push(provider)
}

let activeIndex = 0
let currentResults: SearchResult[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function queryProviders(input: string, skipDebounced: boolean): SearchResult[] {
  const sorted = [...providers].sort((a, b) => a.order - b.order)
  const results: SearchResult[] = []
  for (const p of sorted) {
    if (skipDebounced && p.debounced) continue
    results.push(...p.query(input))
  }
  return results
}

function render(resultsEl: HTMLElement): void {
  resultsEl.innerHTML = ""
  for (let i = 0; i < currentResults.length; i++) {
    const r = currentResults[i]
    const div = document.createElement("div")
    div.className =
      "px-3 py-2 cursor-pointer text-page-foreground text-sm flex items-center gap-2" +
      (i === activeIndex ? " bg-page-foreground/20" : " hover:bg-page-foreground/10")
    div.dataset.index = String(i)

    const labelSpan = document.createElement("span")
    labelSpan.className = "truncate"
    labelSpan.textContent = r.label
    div.appendChild(labelSpan)

    if (r.description) {
      const descSpan = document.createElement("span")
      descSpan.className = "text-page-foreground/50 text-xs truncate ml-auto"
      descSpan.textContent = r.description
      div.appendChild(descSpan)
    }

    div.addEventListener("click", () => r.action())
    resultsEl.appendChild(div)
  }
}

function updateVisibility(
  input: HTMLInputElement,
  resultsEl: HTMLElement
): void {
  const show =
    document.activeElement === input && currentResults.length > 0
  resultsEl.hidden = !show
}

export function initSearch(): void {
  registerProvider(searchEngineProvider)
  registerProvider(shortcutsProvider)

  const input = document.getElementById("search-input") as HTMLInputElement
  const resultsEl = document.getElementById("search-results") as HTMLElement
  const wrapper = document.getElementById("search-wrapper") as HTMLElement

  function runQuery(): void {
    const value = input.value
    const useDebounce = store.sync.get("debounceSearch")
    const hasDebounced = providers.some((p) => p.debounced)

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    if (useDebounce && hasDebounced) {
      currentResults = queryProviders(value, true)
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)

      debounceTimer = setTimeout(() => {
        debounceTimer = null
        currentResults = queryProviders(value, false)
        activeIndex = 0
        render(resultsEl)
        updateVisibility(input, resultsEl)
      }, 400)
    } else {
      currentResults = queryProviders(value, false)
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)
    }
  }

  input.addEventListener("input", runQuery)

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      input.value = ""
      currentResults = []
      activeIndex = 0
      render(resultsEl)
      updateVisibility(input, resultsEl)
      return
    }

    if (currentResults.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % currentResults.length
      render(resultsEl)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      activeIndex =
        (activeIndex - 1 + currentResults.length) % currentResults.length
      render(resultsEl)
    } else if (e.key === "Enter") {
      e.preventDefault()
      currentResults[activeIndex]?.action()
    }
  })

  input.addEventListener("focus", () => {
    updateVisibility(input, resultsEl)
  })

  document.addEventListener("mousedown", (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node)) {
      resultsEl.hidden = true
    }
  })
}
