import { createInput } from "./components"
import { icon as glyph } from "./icons/registry"
import { idbSetIn, idbDeleteIn, ICON_STORE } from "./idb"
import { ACCENT_COLORS } from "./defaults"
import {
  ICON_GLYPHS,
  renderIcon,
  suggestMonogram,
  swatchColor,
  forgetImage,
  type IconTarget,
} from "./shortcut-icon"
import type { IconSpec } from "./shortcuts"
import type { AccentColor } from "./defaults"

/**
 * The one icon editor, shared by the item detail pane and the tab rail. It
 * replaces the two near-identical swatch widgets that used to live in
 * `shortcut-settings.ts` and `settings.ts`.
 *
 * `null` means "no explicit icon" — the item falls back to the default for its
 * kind, which is what makes an icon clearable. The old API could move an item
 * from default to a colour but never back.
 */

type Mode = "default" | "color" | "glyph" | "image"

const MAX_UPLOAD_BYTES = 512 * 1024

const MODE_LABELS: Record<Mode, string> = {
  default: "Default",
  color: "Color",
  glyph: "Icon",
  image: "Upload",
}

function modeOf(spec: IconSpec | null | undefined): Mode {
  if (!spec) return "default"
  if (spec.type === "color" || spec.type === "mono") return "color"
  if (spec.type === "glyph") return "glyph"
  if (spec.type === "image") return "image"
  return "default"
}

export type IconPicker = {
  el: HTMLElement
  getIcon: () => IconSpec | null
  setIcon: (spec: IconSpec | null) => void
  /** Keeps the preview honest while the name or URL is being edited. */
  setTarget: (target: IconTarget) => void
}

export function createIconPicker(opts: {
  target: IconTarget
  value?: IconSpec | null
  onChange: (spec: IconSpec | null) => void
}): IconPicker {
  let target = opts.target
  let spec: IconSpec | null = opts.value ?? null
  let mode: Mode = modeOf(spec)

  // Remembered per mode so flipping between tabs doesn't discard the colour you
  // picked or the glyph you chose.
  let color: AccentColor = spec?.type === "color" || spec?.type === "mono"
    ? spec.color
    : spec?.type === "glyph" && spec.color
      ? spec.color
      : "sky"
  let mono: string = spec?.type === "mono" ? spec.text : ""
  let glyphName: string = spec?.type === "glyph" ? spec.name : "link"
  let imageKey: string | null = spec?.type === "image" ? spec.key : null

  const root = document.createElement("div")
  root.className = "flex flex-col gap-2.5"

  // --- preview + mode tabs -------------------------------------------------

  const head = document.createElement("div")
  head.className = "flex items-center gap-3"

  const preview = document.createElement("div")
  preview.className = "sc-icon-preview shrink-0"
  head.appendChild(preview)

  const modeBar = document.createElement("div")
  modeBar.className = "sc-segment flex-1 min-w-0"
  const modeButtons = new Map<Mode, HTMLButtonElement>()

  for (const m of ["default", "color", "glyph", "image"] as Mode[]) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "sc-segment-btn"
    btn.textContent = MODE_LABELS[m]
    btn.addEventListener("click", () => {
      mode = m
      commit()
    })
    modeButtons.set(m, btn)
    modeBar.appendChild(btn)
  }
  head.appendChild(modeBar)
  root.appendChild(head)

  // --- swatch row (shared by colour and glyph modes) -----------------------

  const swatchRow = document.createElement("div")
  swatchRow.className = "sc-swatch-row"
  const swatchButtons = new Map<string, HTMLButtonElement>()

  for (const c of ACCENT_COLORS) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "sc-swatch"
    btn.style.background = swatchColor(c)
    // The selected ring is drawn with `currentColor`, matching how the
    // Appearance tab's swatches read.
    btn.style.color = swatchColor(c)
    btn.title = c
    btn.setAttribute("aria-label", c)
    btn.addEventListener("click", () => {
      color = c
      commit()
    })
    swatchButtons.set(c, btn)
    swatchRow.appendChild(btn)
  }

  // --- colour mode: the monogram field ------------------------------------

  const monoRow = document.createElement("div")
  monoRow.className = "flex items-center gap-2"

  const monoLabel = document.createElement("span")
  monoLabel.className = "text-xs text-muted shrink-0"
  monoLabel.textContent = "Letters"
  monoRow.appendChild(monoLabel)

  const monoInput = createInput({ placeholder: suggestMonogram(target.name), className: "!w-16" }) as HTMLInputElement
  monoInput.maxLength = 2
  monoInput.addEventListener("input", () => {
    mono = monoInput.value
    commit({ keepFocus: true })
  })
  monoRow.appendChild(monoInput)

  const monoHint = document.createElement("span")
  monoHint.className = "text-xs text-muted truncate"
  monoHint.textContent = "Blank uses the first letter"
  monoRow.appendChild(monoHint)

  // --- glyph mode: the glyph grid -----------------------------------------

  const glyphGrid = document.createElement("div")
  glyphGrid.className = "sc-glyph-grid"
  const glyphButtons = new Map<string, HTMLButtonElement>()

  for (const name of ICON_GLYPHS) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "sc-glyph-btn"
    btn.title = name
    btn.setAttribute("aria-label", name)
    btn.appendChild(glyph(name, { size: 15 }))
    btn.addEventListener("click", () => {
      glyphName = name
      commit()
    })
    glyphButtons.set(name, btn)
    glyphGrid.appendChild(btn)
  }

  // --- image mode ----------------------------------------------------------

  const imageRow = document.createElement("div")
  imageRow.className = "flex flex-col gap-1.5"

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
  fileInput.className = "sc-file-input"

  const imageError = document.createElement("span")
  imageError.className = "text-xs text-danger"
  imageError.hidden = true

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ""
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      imageError.textContent = `That image is ${Math.round(file.size / 1024)} KB — the limit is 512 KB.`
      imageError.hidden = false
      return
    }
    imageError.hidden = true

    const previousKey = imageKey
    const key = crypto.randomUUID()
    try {
      await idbSetIn(ICON_STORE, key, file)
    } catch {
      imageError.textContent = "Couldn't save that image."
      imageError.hidden = false
      return
    }
    imageKey = key
    mode = "image"
    commit()
    // Only after the new key is committed, so a failure can't strand the item
    // pointing at a blob that's already gone.
    if (previousKey) {
      forgetImage(previousKey)
      idbDeleteIn(ICON_STORE, previousKey).catch(() => {})
    }
  })

  const fileLabel = document.createElement("label")
  fileLabel.className = "sc-file-label"
  fileLabel.appendChild(glyph("bgUpload", { size: 13 }))
  const fileText = document.createElement("span")
  fileText.textContent = "Choose image…"
  fileLabel.appendChild(fileText)
  fileLabel.appendChild(fileInput)

  imageRow.appendChild(fileLabel)
  imageRow.appendChild(imageError)

  const hint = document.createElement("span")
  hint.className = "text-xs text-muted"
  hint.textContent = "PNG, JPEG, WebP or SVG up to 512 KB. Stored on this device only."
  imageRow.appendChild(hint)

  // --- body ----------------------------------------------------------------

  const body = document.createElement("div")
  body.className = "flex flex-col gap-2"
  root.appendChild(body)

  function buildSpec(): IconSpec | null {
    if (mode === "default") return null
    if (mode === "color") {
      const text = mono.trim()
      return text ? { type: "mono", text, color } : { type: "color", color }
    }
    if (mode === "glyph") return { type: "glyph", name: glyphName, color }
    if (mode === "image" && imageKey) return { type: "image", key: imageKey }
    return null
  }

  function paint(): void {
    for (const [m, btn] of modeButtons) {
      btn.setAttribute("aria-pressed", String(m === mode))
    }

    body.replaceChildren()
    if (mode === "color") {
      body.appendChild(swatchRow)
      body.appendChild(monoRow)
      monoInput.placeholder = suggestMonogram(target.name)
    } else if (mode === "glyph") {
      body.appendChild(swatchRow)
      body.appendChild(glyphGrid)
    } else if (mode === "image") {
      body.appendChild(imageRow)
    }

    for (const [c, btn] of swatchButtons) {
      btn.setAttribute("aria-pressed", String(c === color))
    }
    for (const [name, btn] of glyphButtons) {
      btn.setAttribute("aria-pressed", String(name === glyphName))
    }

    preview.replaceChildren(renderIcon(spec ?? undefined, target, { size: 34 }))
  }

  function commit(opts2?: { keepFocus?: boolean }): void {
    spec = buildSpec()
    const active = opts2?.keepFocus ? document.activeElement : null
    paint()
    if (active instanceof HTMLElement && active.isConnected) active.focus()
    opts.onChange(spec)
  }

  monoInput.value = mono
  paint()

  return {
    el: root,
    getIcon: () => spec,
    setIcon: (next) => {
      spec = next
      mode = modeOf(next)
      if (next?.type === "color" || next?.type === "mono") color = next.color
      if (next?.type === "mono") mono = next.text
      if (next?.type === "glyph") {
        glyphName = next.name
        if (next.color) color = next.color
      }
      imageKey = next?.type === "image" ? next.key : null
      monoInput.value = mono
      paint()
    },
    setTarget: (next) => {
      target = next
      paint()
    },
  }
}
