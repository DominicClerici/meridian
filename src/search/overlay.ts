import { icon } from "../icons/registry"
import { wantsNewTab } from "../navigate"
import { showToast } from "../components"
import { emptyState } from "./empty"
import { parseInput } from "./input"
import { createList } from "./list"
import type { ListHandle, Row } from "./list"
import { offeredSources, runSearch } from "./registry"
import type { SearchRun, SearchUpdate } from "./registry"
import { recordPick, recordQuery } from "./recents"
import type { Candidate, Ranked, RunMode, SearchSource, Unavailable } from "./types"

/**
 * The palette itself.
 *
 * It is a native `<dialog>` opened with `showModal()`, which buys the whole of
 * the hard part: the top layer (so it can't land behind a popover or a card),
 * a real backdrop to blur, inertness for the page behind it, and focus
 * containment. What is left is the morph from the resting bar, and the
 * keyboard.
 */

const OPEN_MS = 220
const CLOSE_MS = 150
const EASE = "cubic-bezier(.2,.9,.24,1)"

let dialog: HTMLDialogElement
let frame: HTMLElement
let pill: HTMLButtonElement
let input: HTMLInputElement
let hint: HTMLElement
let panel: HTMLElement
let list: ListHandle
let notice: HTMLElement
let footer: HTMLElement

let isOpen = false
let scope: SearchSource | null = null
let rows: Row[] = []
let active = 0
let run: SearchRun | null = null
let mode: "results" | "actions" = "results"
let pointerMoved = false
/** What the last `schedule()` was for, so progressive updates for the same
    query don't move the selection but a new query resets it to the top. */
let lastKey = ""
/** Set while a render is the first of an open, which is the only staggered one. */
let fresh = false

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/* ── Construction ───────────────────────────────────────────────────────── */

export function buildPalette(): void {
  dialog = document.createElement("dialog")
  dialog.className = "palette"
  dialog.id = "palette"

  frame = document.createElement("div")
  frame.className = "palette-frame"

  const inputRow = document.createElement("div")
  inputRow.className = "palette-input-row"

  const glass = icon("search", { size: 17, class: "palette-glyph" })
  inputRow.appendChild(glass)

  pill = document.createElement("button")
  pill.className = "palette-pill"
  pill.type = "button"
  pill.hidden = true
  pill.addEventListener("click", () => {
    setScope(null)
    input.focus()
  })
  inputRow.appendChild(pill)

  input = document.createElement("input")
  input.className = "palette-input"
  input.type = "text"
  input.autocomplete = "off"
  input.spellcheck = false
  input.setAttribute("role", "combobox")
  input.setAttribute("aria-expanded", "true")
  input.setAttribute("aria-label", "Search")
  inputRow.appendChild(input)

  hint = document.createElement("span")
  hint.className = "palette-hint"
  inputRow.appendChild(hint)

  frame.appendChild(inputRow)

  panel = document.createElement("div")
  panel.className = "palette-panel"

  list = createList()
  panel.appendChild(list.el)

  notice = document.createElement("div")
  notice.className = "palette-notice"
  notice.hidden = true
  panel.appendChild(notice)

  footer = document.createElement("div")
  footer.className = "palette-footer"
  panel.appendChild(footer)

  frame.appendChild(panel)
  dialog.appendChild(frame)
  document.body.appendChild(dialog)

  input.addEventListener("input", () => {
    pointerMoved = false
    schedule()
  })
  // On the dialog, not the input: it catches keys wherever focus is inside the
  // palette, including on the scope pill and the notice's button.
  dialog.addEventListener("keydown", onKeydown)

  list.el.addEventListener("pointermove", () => {
    pointerMoved = true
  })
  list.el.addEventListener("mouseover", (e) => {
    if (!pointerMoved) return
    const index = indexFrom(e.target as Element)
    if (index !== null && index !== active) setActive(index)
  })
  list.el.addEventListener("click", (e) => {
    const index = indexFrom(e.target as Element)
    if (index === null) return
    setActive(index)
    if ((e.target as Element).closest(".palette-row-more")) enterActions()
    else activate(wantsNewTab(e) ? "newTab" : "default")
  })
  list.el.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return
    const index = indexFrom(e.target as Element)
    if (index === null) return
    e.preventDefault()
    setActive(index)
    activate("newTab")
  })

  // A click on the dialog itself is a click on the backdrop: the frame stops
  // its own clicks from reaching here.
  dialog.addEventListener("mousedown", (e) => {
    if (e.target === dialog) closePalette()
  })

  // Esc is handled in `onKeydown`, which runs first; this only stops the
  // browser from closing the dialog outright behind it.
  dialog.addEventListener("cancel", (e) => e.preventDefault())
}

function indexFrom(target: Element | null): number | null {
  const row = target?.closest(".palette-row") as HTMLElement | null
  if (!row?.dataset.index) return null
  return Number(row.dataset.index)
}

/* ── Open and close ─────────────────────────────────────────────────────── */

export function isPaletteOpen(): boolean {
  return isOpen
}

export function openPalette(seed = ""): void {
  if (isOpen) {
    input.focus()
    return
  }

  isOpen = true
  mode = "results"
  setScope(null)
  input.value = seed
  notice.hidden = true
  lastKey = "\u0000reset"
  active = 0

  dialog.showModal()
  input.focus()
  input.setSelectionRange(seed.length, seed.length)

  fresh = true
  schedule()
  morphIn()
}

export function closePalette(): void {
  if (!isOpen) return
  isOpen = false
  run?.cancel()
  run = null

  const finish = () => {
    if (isOpen) return
    dialog.close()
    dialog.classList.remove("is-open")
    document.getElementById("search-bar")?.classList.remove("is-lifted")
  }

  dialog.classList.remove("is-open")

  const bar = restingBar()
  if (!bar || reduceMotion()) {
    frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100 })
    setTimeout(finish, 100)
    return
  }

  const target = geometry(bar)
  panel.style.height = "0px"
  frame.animate(
    [
      { translate: "0px 0px", width: `${frame.getBoundingClientRect().width}px`, opacity: 1 },
      { translate: `${target.dx}px ${target.dy}px`, width: `${target.width}px`, opacity: 0.6 },
    ],
    { duration: CLOSE_MS, easing: EASE }
  )
  // A timer, not the animation's `finished` promise: a paused document timeline
  // (a backgrounded tab) never settles that promise, and a palette that cannot
  // be closed is a far worse failure than one that closes without its animation.
  setTimeout(finish, CLOSE_MS)
}

function restingBar(): HTMLElement | null {
  const bar = document.getElementById("search-bar")
  if (!bar || bar.hidden || bar.offsetParent === null) return null
  return bar
}

/** Where the frame has to start (or end) to sit exactly over the resting bar. */
function geometry(bar: HTMLElement): { dx: number; dy: number; width: number } {
  const barRect = bar.getBoundingClientRect()
  const frameRect = frame.getBoundingClientRect()
  return {
    // Centres, not edges: the frame is centred with translateX(-50%), so its
    // own width animating doesn't move the point this is measured against.
    dx: barRect.left + barRect.width / 2 - (frameRect.left + frameRect.width / 2),
    dy: barRect.top - frameRect.top,
    width: barRect.width,
  }
}

function morphIn(): void {
  requestAnimationFrame(() => dialog.classList.add("is-open"))

  const bar = restingBar()
  if (!bar || reduceMotion()) {
    frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 })
    return
  }

  bar.classList.add("is-lifted")
  const from = geometry(bar)
  frame.animate(
    [
      { translate: `${from.dx}px ${from.dy}px`, width: `${from.width}px` },
      { translate: "0px 0px", width: `${frame.getBoundingClientRect().width}px` },
    ],
    { duration: OPEN_MS, easing: EASE }
  )
}

/* ── Query lifecycle ────────────────────────────────────────────────────── */

function setScope(next: SearchSource | null): void {
  scope = next
  if (!next) {
    pill.hidden = true
    input.placeholder = "Search or run a command"
    return
  }
  pill.hidden = false
  pill.replaceChildren(
    icon(next.glyph, { size: 13 }),
    document.createTextNode(next.label),
    icon("close", { size: 11, class: "palette-pill-x" })
  )
  input.placeholder = `Search ${next.label.toLowerCase()}…`
}

function schedule(): void {
  const raw = input.value
  const parsed = parseInput(raw, scope)

  const key = `${parsed.scope?.id ?? ""}\u0000${parsed.picker ?? ""}\u0000${parsed.text}`
  if (key !== lastKey) {
    lastKey = key
    active = 0
  }

  if (parsed.picker !== null) {
    run?.cancel()
    run = null
    renderPicker(parsed.picker)
    return
  }

  if (!parsed.text.trim() && !parsed.scope) {
    run?.cancel()
    run = null
    render(emptyState(rerun).map(asRow), null)
    return
  }

  run?.cancel()
  run = runSearch({
    text: parsed.text,
    raw,
    bang: parsed.bang,
    scope: parsed.scope,
    onUpdate: apply,
  })
}

function rerun(text: string): void {
  input.value = text
  input.setSelectionRange(text.length, text.length)
  schedule()
}

function apply(update: SearchUpdate): void {
  hint.classList.toggle("is-busy", update.pending)
  render(update.rows.map(asRow), update.notice)
}

function asRow(row: Ranked): Row {
  return { kind: "result", row }
}

/**
 * The source picker: `@` on its own lists everything, and each further
 * character filters it. Picking one locks the scope rather than typing the rest
 * of the token, so the pill and the text stay in step.
 */
function renderPicker(partial: string): void {
  const term = partial.toLowerCase()
  const matches = offeredSources().filter(
    (s) => !term || s.token.startsWith(term) || s.label.toLowerCase().includes(term)
  )

  render(
    matches.map((source) => ({
      kind: "result" as const,
      row: {
        candidate: {
          id: `picker:${source.id}`,
          title: source.label,
          subtitle: `@${source.token}`,
          detail: source.available() ? undefined : "not connected",
          icon: () => icon(source.glyph, { size: 16 }),
          keepOpen: true,
          run: () => {
            setScope(source)
            input.value = ""
            schedule()
          },
        },
        source,
        group: "Search in",
        score: 0,
      },
    })),
    null
  )
}

function render(next: Row[], message: Unavailable | null): void {
  rows = next
  list.render(next, { stagger: fresh })
  fresh = false

  // An empty panel with no explanation reads as a bug. If nothing matched and
  // no source had something better to say, say it plainly.
  if (!message && next.length === 0 && input.value.trim()) {
    message = { message: "No results." }
  }

  if (message) {
    notice.hidden = false
    notice.replaceChildren(document.createTextNode(message.message))
    if (message.action) {
      const button = document.createElement("button")
      button.className = "palette-notice-action"
      button.type = "button"
      button.textContent = message.action.label
      button.addEventListener("click", () => {
        message.action!.run()
        if (!message.action!.keepOpen) closePalette()
        // A permission prompt is native and takes as long as it takes; this is
        // a re-query once the answer has had a chance to land.
        else setTimeout(schedule, 600)
      })
      notice.appendChild(button)
    }
  } else {
    notice.hidden = true
  }

  active = Math.min(active, next.length - 1)
  if (active < 0) active = 0
  setActive(active)
  updateFooter()
  resize()
}

function setActive(index: number): void {
  active = index
  list.setActive(index)
  const candidate = currentCandidate()
  hint.replaceChildren()
  if (candidate) {
    const key = document.createElement("kbd")
    key.textContent = "⏎"
    hint.appendChild(key)
  }
}

function currentCandidate(): Candidate | null {
  const row = rows[active]
  if (!row) return null
  return row.kind === "result" ? row.row.candidate : null
}

function resize(): void {
  const empty = rows.length === 0 && notice.hidden
  panel.classList.toggle("is-empty", empty)
  panel.style.height = empty ? "0px" : `${contentHeight()}px`
}

/** The list caps itself, so the panel is exactly its parts and never taller. */
function contentHeight(): number {
  const noticeHeight = notice.hidden ? 0 : notice.offsetHeight
  return list.contentHeight() + noticeHeight + footer.offsetHeight
}

function updateFooter(): void {
  const parts: string[] = []
  if (mode === "actions") parts.push("← back", "⏎ run")
  else {
    const candidate = currentCandidate()
    if (candidate?.actions?.length) parts.push("→ actions")
    const row = rows[active]
    if (row?.kind === "result" && row.row.source?.token) parts.push("⇥ scope")
    parts.push("⌘⏎ new tab", "⌘C copy")
  }
  footer.textContent = parts.join("   ·   ")
}

/* ── Running a result ───────────────────────────────────────────────────── */

function activate(runMode: RunMode): void {
  const row = rows[active]
  if (!row) return

  if (row.kind === "action") {
    row.action.run()
    if (row.action.keepOpen) leaveActions()
    else closePalette()
    return
  }

  const candidate = row.row.candidate
  const parsed = parseInput(input.value, scope)
  recordQuery(parsed.text)
  recordPick(candidate.id, parsed.text)

  candidate.run(runMode)
  if (!candidate.keepOpen) closePalette()
}

function enterActions(): void {
  const candidate = currentCandidate()
  if (!candidate?.actions?.length) return
  mode = "actions"
  active = 0
  render(
    candidate.actions.map((action) => ({ kind: "action" as const, action })),
    null
  )
}

function leaveActions(): void {
  if (mode !== "actions") return
  mode = "results"
  active = 0
  schedule()
}

/* ── Keyboard ───────────────────────────────────────────────────────────── */

function escape(): void {
  if (mode === "actions") {
    leaveActions()
    return
  }
  if (input.value) {
    input.value = ""
    schedule()
    return
  }
  if (scope) {
    setScope(null)
    schedule()
    return
  }
  closePalette()
}

function move(delta: number): void {
  if (!rows.length) return
  pointerMoved = false
  setActive((active + delta + rows.length) % rows.length)
}

function onKeydown(e: KeyboardEvent): void {
  const meta = e.metaKey || e.ctrlKey

  if (e.key === "Escape") {
    e.preventDefault()
    escape()
    return
  }

  if (e.key === "k" && meta) {
    e.preventDefault()
    closePalette()
    return
  }

  if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
    e.preventDefault()
    move(1)
    return
  }

  if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
    e.preventDefault()
    move(-1)
    return
  }

  if (e.key === "Home" && !meta) {
    e.preventDefault()
    setActive(0)
    return
  }

  if (e.key === "End" && !meta) {
    e.preventDefault()
    setActive(Math.max(0, rows.length - 1))
    return
  }

  if (e.key === "Enter") {
    e.preventDefault()
    activate(meta ? "newTab" : "default")
    return
  }

  if (e.key === "ArrowRight" && mode === "results") {
    // Only when the caret is at the end, so arrowing through text still works.
    if (input.selectionStart !== input.value.length) return
    const candidate = currentCandidate()
    if (!candidate?.actions?.length) return
    e.preventDefault()
    enterActions()
    return
  }

  if (e.key === "ArrowLeft") {
    if (mode === "actions") {
      e.preventDefault()
      leaveActions()
      return
    }
    if (scope && input.selectionStart === 0) {
      e.preventDefault()
      setScope(null)
      schedule()
    }
    return
  }

  if (e.key === "Tab" && mode === "results") {
    const row = rows[active]
    const target = row?.kind === "result" ? row.row.source : null
    if (!target?.token) return
    e.preventDefault()
    setScope(target)
    input.value = ""
    schedule()
    return
  }

  if (e.key === "Backspace" && scope && !input.value) {
    e.preventDefault()
    setScope(null)
    schedule()
    return
  }

  if (e.key === "c" && meta && !input.selectionStart) {
    const candidate = currentCandidate()
    if (!candidate) return
    e.preventDefault()
    const value = candidate.copyValue ?? candidate.subtitle ?? candidate.title
    navigator.clipboard?.writeText(value)
    showToast("Copied")
    return
  }

  if (meta && e.key >= "1" && e.key <= "9") {
    const index = Number(e.key) - 1
    if (index >= rows.length) return
    e.preventDefault()
    setActive(index)
    activate("default")
  }
}
