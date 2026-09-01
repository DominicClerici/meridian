/**
 * The notepad — one freeform note, autosaved, shared by every host.
 *
 * There is deliberately no editor model here: the note is a plain string in a
 * `<textarea>`, so what the user typed is exactly what is stored. The only
 * assistance is list continuation on Enter, and it goes through `execCommand`
 * so the browser's own undo stack survives — a scratchpad where Ctrl+Z does
 * nothing feels broken. See `docs/notepad.md`.
 */

import { store } from "./store"
import { icon } from "./icons/registry"
import { createButton, createMenu, createPopover } from "./components"
import type { MenuItem } from "./components"
import { MAX_NOTE_LENGTH } from "./defaults"
import type { NotepadFont } from "./defaults"
import { registerCard } from "./layout"

/** Long enough that a burst of typing lands as one write, short enough that
    closing the tab a beat later has already saved. */
const SAVE_DEBOUNCE_MS = 500
const SAVED_FLASH_MS = 1800
const FLASH_MS = 3000
const CONFIRM_MS = 6000

/** The editor grows with the note between these, then scrolls. */
const MIN_EDITOR_PX = 132
const MAX_EDITOR_PX = 340

/** The word count gives way to a character counter once the cap is in sight,
    so the limit is visible before it is hit rather than after. */
const COUNTER_THRESHOLD = Math.round(MAX_NOTE_LENGTH * 0.9)

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

function noteText(): string {
  const raw = store.local.get("notepadBody")
  return typeof raw === "string" ? raw : ""
}

/* ── Save ───────────────────────────────────────────────────────────────── */

type Status = "idle" | "saving" | "saved"

let status: Status = "idle"
let flash: string | null = null
let pending: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null

function setStatus(next: Status): void {
  status = next
  if (savedTimer !== null) clearTimeout(savedTimer)
  savedTimer = next === "saved" ? setTimeout(() => setStatus("idle"), SAVED_FLASH_MS) : null
  paintAll()
}

function setFlash(text: string): void {
  flash = text
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flash = null
    paintAll()
  }, FLASH_MS)
  paintAll()
}

function queueSave(text: string): void {
  pending = text
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS)
  setStatus("saving")
}

function flush(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pending === null) return
  const text = pending
  pending = null
  if (text === noteText()) {
    setStatus("idle")
    return
  }
  // Timestamp first: the `notepadBody` subscription repaints every body, and it
  // would otherwise read the previous edit time.
  store.local.set("notepadUpdatedAt", Date.now())
  store.local.set("notepadBody", text)
  setStatus("saved")
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

function editedLabel(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 45_000) return "Edited just now"
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `Edited ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Edited ${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `Edited ${days}d ago`
  return `Edited ${new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length
}

function countLabel(text: string): string {
  if (text.length >= COUNTER_THRESHOLD) {
    return `${text.length.toLocaleString()} / ${MAX_NOTE_LENGTH.toLocaleString()} characters`
  }
  const words = countWords(text)
  if (words === 0) return ""
  return `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`
}

/* ── List continuation ──────────────────────────────────────────────────── */

const BULLET_RE = /^([ \t]*)([-*+•])([ \t]+)(\[[ xX]\][ \t]+)?/
const NUMBER_RE = /^([ \t]*)(\d+)([.)])([ \t]+)/

/** The marker the caret's line opens with, and the one its successor should. */
function listPrefix(lineToCaret: string): { marker: string; next: string } | null {
  const bullet = BULLET_RE.exec(lineToCaret)
  if (bullet) {
    const [marker, indent, glyph, gap, box] = bullet
    return { marker, next: `${indent}${glyph}${gap}${box ? "[ ] " : ""}` }
  }
  const numbered = NUMBER_RE.exec(lineToCaret)
  if (numbered) {
    const [marker, indent, digits, delim, gap] = numbered
    return { marker, next: `${indent}${Number(digits) + 1}${delim}${gap}` }
  }
  return null
}

/**
 * Both edits go through `execCommand` first. It is deprecated, but it is still
 * the only way to change a textarea's value and have the browser record the
 * change on its undo stack; the manual path is the fallback for when it isn't.
 */
function replaceSelection(editor: HTMLTextAreaElement, text: string): void {
  editor.focus()
  let handled = false
  try {
    handled = document.execCommand("insertText", false, text)
  } catch {
    handled = false
  }
  if (handled) return
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end")
  editor.dispatchEvent(new Event("input", { bubbles: true }))
}

function deleteSelection(editor: HTMLTextAreaElement): void {
  editor.focus()
  let handled = false
  try {
    handled = document.execCommand("delete")
  } catch {
    handled = false
  }
  if (handled) return
  editor.setRangeText("", editor.selectionStart, editor.selectionEnd, "end")
  editor.dispatchEvent(new Event("input", { bubbles: true }))
}

function continueList(editor: HTMLTextAreaElement, e: KeyboardEvent): void {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
  if (editor.selectionStart !== editor.selectionEnd) return

  const value = editor.value
  const caret = editor.selectionStart
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1
  const parsed = listPrefix(value.slice(lineStart, caret))
  if (!parsed) return

  const nextBreak = value.indexOf("\n", caret)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const rest = value.slice(lineStart + parsed.marker.length, lineEnd)

  e.preventDefault()
  if (rest.trim() === "") {
    // An empty item means the list is over: clear the marker instead of laying
    // down another one the user would only have to delete.
    editor.setSelectionRange(lineStart, lineEnd)
    deleteSelection(editor)
  } else {
    replaceSelection(editor, `\n${parsed.next}`)
  }
}

/* ── Live bodies ────────────────────────────────────────────────────────── */

type LiveBody = {
  root: HTMLElement
  paint: () => void
  sync: () => void
  applyFont: () => void
  dispose: () => void
}

const liveBodies = new Set<LiveBody>()
let clockTimer: ReturnType<typeof setInterval> | null = null

function sweep(): LiveBody[] {
  for (const body of [...liveBodies]) {
    if (!body.root.isConnected) {
      body.dispose()
      liveBodies.delete(body)
    }
  }
  if (liveBodies.size === 0 && clockTimer !== null) {
    clearInterval(clockTimer)
    clockTimer = null
  }
  return [...liveBodies]
}

function paintAll(): void {
  for (const body of sweep()) body.paint()
}

function syncAll(): void {
  for (const body of sweep()) body.sync()
}

/** Keeps "Edited 4m ago" honest without re-rendering anything else. */
function startClock(): void {
  if (clockTimer !== null) return
  clockTimer = setInterval(() => {
    if (status === "idle" && flash === null) paintAll()
  }, 60_000)
}

const FONT_CLASS: Record<NotepadFont, string> = {
  sans: "font-body",
  mono: "font-mono",
}

function currentFont(): NotepadFont {
  const value = store.sync.get("notepadFont")
  return value === "mono" ? "mono" : "sans"
}

/* ── Body ───────────────────────────────────────────────────────────────── */

/**
 * The whole widget. One builder for all three hosts: the immersive popover, the
 * Default grid card and the Dashboard carousel slide. Everything that varies
 * with width is a container query on `root`, never a viewport one — the same
 * markup fills a 340px popover and a card twice as wide.
 */
export function buildNotepadBody(): { el: HTMLElement; rebuild: () => void } {
  const root = document.createElement("div")
  root.className = "notepad @container flex flex-col min-w-0"

  const editor = document.createElement("textarea")
  editor.className =
    "notepad-editor w-full min-w-0 resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.65] text-popover-foreground/90 outline-none placeholder:text-popover-foreground/25"
  editor.rows = 1
  editor.placeholder = "Jot something down…"
  editor.spellcheck = true
  editor.maxLength = MAX_NOTE_LENGTH
  editor.setAttribute("aria-label", "Notepad")
  editor.value = noteText()
  root.appendChild(editor)

  const footer = document.createElement("div")
  footer.className = "notepad-footer flex items-center gap-2 min-w-0 mt-2 pt-1.5"
  root.appendChild(footer)

  const count = document.createElement("span")
  count.className = "flex-1 min-w-0 truncate text-[11px] tabular-nums text-popover-foreground/35"

  const statusEl = document.createElement("span")
  statusEl.className = "flex shrink-0 items-center gap-1 text-[11px] text-popover-foreground/40"

  const menuBtn = document.createElement("button")
  menuBtn.type = "button"
  menuBtn.className =
    "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-theme-xs text-popover-foreground/45 transition-colors hover:bg-popover-foreground/[0.09] hover:text-popover-foreground"
  menuBtn.setAttribute("aria-label", "Notepad actions")
  menuBtn.title = "Notepad actions"
  menuBtn.appendChild(icon("moreVertical", { size: 14 }))
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    openMenu()
  })

  function restFooter(): void {
    footer.replaceChildren(count, statusEl, menuBtn)
  }

  function renderStatus(): void {
    const message = flash
    statusEl.replaceChildren()
    if (message !== null) {
      statusEl.append(message)
      return
    }
    if (status === "saving") {
      statusEl.append("Saving…")
      return
    }
    if (status === "saved") {
      statusEl.appendChild(icon("check", { size: 11 }))
      statusEl.append("Saved")
      return
    }
    const ts = store.local.get("notepadUpdatedAt")
    if (typeof ts === "number" && ts > 0 && editor.value !== "") {
      statusEl.append(editedLabel(ts))
    }
  }

  function paint(): void {
    const text = editor.value
    count.textContent = countLabel(text)
    count.classList.toggle("text-warning", text.length >= COUNTER_THRESHOLD)
    renderStatus()
  }

  function resize(): void {
    editor.style.height = "auto"
    const natural = editor.scrollHeight
    editor.style.height = `${Math.min(Math.max(natural, MIN_EDITOR_PX), MAX_EDITOR_PX)}px`
    editor.style.overflowY = natural > MAX_EDITOR_PX ? "auto" : "hidden"
  }

  function applyFont(): void {
    editor.classList.remove(FONT_CLASS.sans, FONT_CLASS.mono)
    editor.classList.add(FONT_CLASS[currentFont()])
    resize()
  }

  function sync(): void {
    // The focused editor is the source of the write that triggered this; the
    // debounce will carry its value out. Overwriting it would eat keystrokes.
    if (document.activeElement !== editor && editor.value !== noteText()) {
      editor.value = noteText()
      resize()
    }
    paint()
  }

  function openMenu(): void {
    const text = editor.value
    const items: MenuItem[] = [
      {
        label: "Copy text",
        icon: icon("copy", { size: 13 }),
        disabled: text.trim() === "",
        hint: "The note is empty",
        onClick: () => {
          navigator.clipboard.writeText(text).then(
            () => setFlash("Copied"),
            () => setFlash("Copy failed")
          )
        },
      },
      "separator",
      {
        label: "Clear note",
        icon: icon("trash", { size: 13 }),
        danger: true,
        disabled: text === "",
        hint: "The note is already empty",
        onClick: askClear,
      },
    ]
    createMenu(menuBtn, items)
  }

  /**
   * An inline confirm rather than `confirm()`, which would take the click the
   * popover's outside-click handler is listening for and close the widget. The
   * clear itself runs through the editor, so Ctrl+Z brings the note back.
   */
  function askClear(): void {
    let timer: ReturnType<typeof setTimeout> | null = null

    function dismiss(): void {
      if (timer !== null) clearTimeout(timer)
      restFooter()
      paint()
    }

    const label = document.createElement("span")
    label.className = "flex-1 min-w-0 truncate text-[11px] text-popover-foreground/60"
    label.textContent = "Clear this note?"

    const cancel = createButton("Cancel", "ghost", { tone: "popover", onClick: dismiss })
    const confirm = createButton("Clear", "destructive", {
      tone: "popover",
      onClick: () => {
        editor.focus()
        editor.setSelectionRange(0, editor.value.length)
        deleteSelection(editor)
        dismiss()
        setFlash(`Cleared — ${IS_MAC ? "⌘Z" : "Ctrl+Z"} to undo`)
      },
    })
    for (const btn of [cancel, confirm]) {
      btn.classList.add("shrink-0")
      btn.style.padding = "3px 9px"
      btn.style.fontSize = "11.5px"
    }

    footer.replaceChildren(label, cancel, confirm)
    timer = setTimeout(dismiss, CONFIRM_MS)
  }

  editor.addEventListener("input", () => {
    resize()
    queueSave(editor.value)
  })

  editor.addEventListener("blur", flush)

  editor.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      pending = editor.value
      flush()
      setStatus("saved")
      return
    }
    continueList(editor, e)
  })

  // Width is what changes the wrapped height, and it is also the one dimension
  // this observer isn't itself setting — so watching it can't feed back.
  let lastWidth = -1
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth
    if (width === lastWidth) return
    lastWidth = width
    resize()
  })
  observer.observe(root)

  restFooter()
  applyFont()
  paint()

  const body: LiveBody = {
    root,
    paint,
    sync,
    applyFont,
    dispose: () => observer.disconnect(),
  }
  sweep()
  liveBodies.add(body)
  startClock()

  return { el: root, rebuild: sync }
}

/* ── Trigger (immersive) ────────────────────────────────────────────────── */

let openPopoverClose: (() => void) | null = null

function updateTrigger(): void {
  const badge = document.getElementById("notepad-badge")
  if (badge) badge.hidden = noteText().trim() === ""
}

function closePopover(): void {
  openPopoverClose?.()
}

function showPopover(anchor: HTMLElement): void {
  closePopover()

  const content = document.createElement("div")
  content.className = "flex flex-col w-[340px]"

  const header = document.createElement("div")
  header.className = "flex items-center justify-between border-b border-popover-foreground/[0.08] pb-2 mb-2"
  const heading = document.createElement("h2")
  heading.className = "text-sm font-semibold uppercase tracking-wider text-popover-foreground/70"
  heading.textContent = "Notepad"
  header.appendChild(heading)
  content.appendChild(header)

  const built = buildNotepadBody()
  content.appendChild(built.el)

  const { close } = createPopover(anchor, content, {
    onClose: () => {
      openPopoverClose = null
      flush()
    },
  })
  openPopoverClose = close

  // Opened from its own trigger, the notepad is only ever opened to write in.
  requestAnimationFrame(() => built.el.querySelector("textarea")?.focus())
}

/* ── Hosts ──────────────────────────────────────────────────────────────── */

registerCard({
  id: "notepad",
  title: "Notepad",
  order: 50,
  regions: { default: "grid", dashboard: "side" },
  enabledKey: "notepadEnabled",
  render: () => buildNotepadBody().el,
  onUnmount: flush,
})

// Module scope, not `initNotepad`: a card body can be built during
// `applyLayout()`, which runs before DOMContentLoaded. See
// docs/layouts.md#boot-ordering.
store.local.subscribe("notepadBody", () => {
  updateTrigger()
  syncAll()
})
store.sync.subscribe("notepadFont", () => {
  for (const body of sweep()) body.applyFont()
})

// A tab is far more likely to be closed or hidden than to be sat on, so both
// are flush points — otherwise the last half-second of typing is lost.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flush()
})
window.addEventListener("pagehide", flush)

export function initNotepad(): void {
  const trigger = document.getElementById("notepad-trigger") as HTMLButtonElement | null
  if (!trigger) return

  trigger.hidden = !store.sync.get("notepadEnabled")
  updateTrigger()

  trigger.addEventListener("click", (e) => {
    e.stopPropagation()
    if (openPopoverClose) closePopover()
    else showPopover(trigger)
  })

  store.sync.subscribe("notepadEnabled", (val) => {
    trigger.hidden = !val
    if (!val) closePopover()
  })
}
