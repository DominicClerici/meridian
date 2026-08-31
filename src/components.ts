import { icon, getIconSvg } from "./icons/registry"

type ButtonVariant = "primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override"

/**
 * Which surface a control is sitting on. `popover` covers the popover and the
 * widget card, which share the `--popover` palette (see styles.css) — that
 * palette is dark in both light and dark mode, so the page-level `--input` /
 * `--foreground` tokens would render a white box with near-black text on it.
 */
export type Tone = "default" | "popover"

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-accent text-accent bg-transparent hover:bg-accent/10",
  ghost: "text-foreground bg-transparent hover:bg-surface",
  destructive: "bg-danger text-danger-foreground hover:bg-danger-hover",
  "destructive-outline": "border border-danger text-danger bg-transparent hover:bg-danger/10",
  override: "",
}

const POPOVER_BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-popover-foreground/20 text-popover-foreground bg-transparent hover:bg-popover-foreground/[0.08]",
  ghost: "text-popover-foreground/60 bg-transparent hover:text-popover-foreground hover:bg-popover-foreground/[0.08]",
  destructive: "bg-danger text-danger-foreground hover:bg-danger-hover",
  "destructive-outline": "border border-danger/50 text-danger bg-transparent hover:bg-danger/10",
  override: "",
}

export function createButton(
  label: string,
  variant: ButtonVariant,
  opts?: { icon?: string | HTMLElement; onClick?: () => void; className?: string; tone?: Tone }
): HTMLButtonElement {
  const palette = opts?.tone === "popover" ? POPOVER_BUTTON_CLASSES : BUTTON_CLASSES
  const btn = document.createElement("button")
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${palette[variant]} ${opts?.className ?? ""}`.trim()

  if (opts?.icon) {
    if (opts.icon instanceof HTMLElement) {
      opts.icon.classList.add("shrink-0")
      btn.appendChild(opts.icon)
    } else {
      const iconSpan = document.createElement("span")
      iconSpan.className = "shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"
      iconSpan.innerHTML = opts.icon
      btn.appendChild(iconSpan)
    }
  }

  if (label) {
    const labelSpan = document.createElement("span")
    labelSpan.textContent = label
    btn.appendChild(labelSpan)
  }

  if (opts?.onClick) {
    btn.addEventListener("click", opts.onClick)
  }

  return btn
}

export function createInput(opts: {
  type?: string
  placeholder?: string
  value?: string
  name?: string
  multiline?: boolean
  rows?: number
  tone?: Tone
  className?: string
}): HTMLInputElement | HTMLTextAreaElement {
  const popover = opts.tone === "popover"
  const classes = popover
    ? "w-full text-sm rounded-theme px-2.5 py-2 border border-popover-foreground/[0.08] bg-popover-foreground/[0.06] text-popover-foreground placeholder:text-popover-foreground/30 outline-none focus:border-accent/60 transition-colors"
    : "w-full text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors"
  const extra = opts.className ? ` ${opts.className}` : ""

  if (opts.multiline) {
    const el = document.createElement("textarea")
    el.className = `${classes} resize-y${extra}`
    el.rows = opts.rows ?? 3
    if (opts.placeholder) el.placeholder = opts.placeholder
    if (opts.value) el.value = opts.value
    if (opts.name) el.name = opts.name
    return el
  }

  const el = document.createElement("input")
  el.type = opts.type ?? "text"
  el.className = classes + extra
  if (opts.placeholder) el.placeholder = opts.placeholder
  if (opts.value) el.value = opts.value
  if (opts.name) el.name = opts.name
  // Native date/time pickers paint their own chrome from the color scheme, not
  // from our classes, so a dark popover needs to be declared as such.
  if (popover) el.style.colorScheme = "dark"
  return el
}

export type SelectElement = HTMLDivElement & { value: string }


export function createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string
  name?: string
  width?: string
  variant?: "input" | "ghost"
  tone?: Tone
  onChange?: (value: string) => void
}): SelectElement {
  let currentValue = opts.value ?? opts.options[0]?.value ?? ""
  let expanded = false
  let highlightIndex = -1
  let dragging = false

  const container = document.createElement("div") as SelectElement
  container.className = "relative font-body"
  container.setAttribute("role", "combobox")
  container.setAttribute("aria-expanded", "false")
  container.setAttribute("aria-haspopup", "listbox")
  container.dataset.value = currentValue
  if (opts.name) container.dataset.name = opts.name

  const ghost = opts.variant === "ghost"
  const popoverTone = opts.tone === "popover"

  const trigger = document.createElement("button")
  trigger.type = "button"
  trigger.className = ghost
    ? "select__trigger flex items-center justify-start gap-1 min-w-0 text-sm rounded-theme px-1.5 py-0.5 border border-transparent bg-transparent text-current opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
    : popoverTone
      ? "select__trigger flex items-center justify-between gap-2 w-full text-sm rounded-theme px-2.5 py-2 border border-popover-foreground/[0.08] bg-popover-foreground/[0.06] text-popover-foreground outline-none transition-colors hover:border-accent/60 focus-visible:border-accent/60 cursor-pointer"
      : "select__trigger flex items-center justify-between gap-2 w-full text-sm rounded-theme px-3 py-1.5 border border-input-border bg-input text-foreground outline-none transition-colors hover:border-accent focus-visible:border-accent cursor-pointer"

  const valueSpan = document.createElement("span")
  valueSpan.className = "select__value truncate"

  const arrow = document.createElement("span")
  arrow.className = `select__arrow shrink-0${ghost ? "" : " text-muted"}`
  arrow.appendChild(icon("chevronDown"))

  trigger.appendChild(valueSpan)
  trigger.appendChild(arrow)

  const highlightClass = popoverTone ? "bg-popover-foreground/[0.1]" : "bg-surface"

  const list = document.createElement("ul")
  list.setAttribute("role", "listbox")
  list.tabIndex = -1
  list.className = `select__list absolute left-0 right-0 top-full z-50 border ${popoverTone ? "border-popover-foreground/[0.08]" : "border-input-border"} bg-popover text-popover-foreground overflow-auto${ghost ? " rounded-theme mt-1" : " border-t-0"}`
  list.style.maxHeight = "192px"
  list.style.display = "none"
  list.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)"

  const items: HTMLLIElement[] = []

  function labelFor(val: string): string {
    return opts.options.find((o) => o.value === val)?.label ?? val
  }

  function buildItems(): void {
    list.innerHTML = ""
    items.length = 0

    for (let i = 0; i < opts.options.length; i++) {
      const opt = opts.options[i]
      const li = document.createElement("li")
      li.setAttribute("role", "option")
      li.setAttribute("aria-selected", String(opt.value === currentValue))
      li.dataset.value = opt.value

      const isSelected = opt.value === currentValue
      li.className = `flex items-center justify-between gap-2 px-2 py-1.5 text-sm cursor-pointer transition-colors${isSelected ? " font-medium" : ""}`

      const label = document.createElement("span")
      label.className = "truncate"
      label.textContent = opt.label

      const check = document.createElement("span")
      check.className = "shrink-0 w-3.5 text-accent [&>svg]:block"
      check.innerHTML = isSelected ? getIconSvg("check") : ""

      li.appendChild(label)
      li.appendChild(check)

      li.addEventListener("mouseenter", () => {
        setHighlight(i)
      })

      li.addEventListener("mouseup", () => {
        selectOption(opt.value)
        close()
      })

      items.push(li)
      list.appendChild(li)
    }
  }

  buildItems()
  valueSpan.textContent = labelFor(currentValue)

  container.appendChild(trigger)
  container.appendChild(list)

  if (opts.width) {
    container.style.width = opts.width
  } else {
    const sizer = document.createElement("div")
    sizer.style.height = "0"
    sizer.style.overflow = "hidden"
    for (const opt of opts.options) {
      const row = document.createElement("div")
      row.className = "flex items-center gap-2 px-3 text-sm font-medium whitespace-nowrap"
      const text = document.createElement("span")
      text.textContent = opt.label
      row.appendChild(text)
      const spacer = document.createElement("span")
      spacer.className = "shrink-0"
      spacer.style.width = "12px"
      row.appendChild(spacer)
      sizer.appendChild(row)
    }
    container.appendChild(sizer)
  }

  function setHighlight(index: number): void {
    if (highlightIndex >= 0 && highlightIndex < items.length) {
      items[highlightIndex].classList.remove(highlightClass)
    }
    highlightIndex = index
    if (index >= 0 && index < items.length) {
      items[index].classList.add(highlightClass)
      items[index].scrollIntoView({ block: "nearest" })
    }
  }

  function selectOption(val: string): void {
    if (val === currentValue) return
    currentValue = val
    container.dataset.value = val
    valueSpan.textContent = labelFor(val)

    for (let i = 0; i < items.length; i++) {
      const isSelected = opts.options[i].value === val
      items[i].setAttribute("aria-selected", String(isSelected))
      const check = items[i].lastElementChild as HTMLElement
      check.innerHTML = isSelected ? getIconSvg("check") : ""
      if (isSelected) {
        items[i].classList.add("font-medium")
      } else {
        items[i].classList.remove("font-medium")
      }
    }

    opts.onChange?.(val)
  }

  function open(): void {
    if (expanded) return
    expanded = true
    container.setAttribute("aria-expanded", "true")

    if (!ghost) {
      trigger.classList.remove("rounded-theme")
      trigger.classList.add("rounded-t-theme")
      list.classList.add("rounded-b-theme")
    }

    list.style.display = ""
    arrow.style.transform = "rotate(180deg)"

    const idx = opts.options.findIndex((o) => o.value === currentValue)
    setHighlight(idx)

    setTimeout(() => document.addEventListener("mousedown", onClickOutside), 0)
  }

  function close(): void {
    if (!expanded) return
    expanded = false
    dragging = false
    container.setAttribute("aria-expanded", "false")

    arrow.style.transform = ""
    list.style.display = "none"

    if (!ghost) {
      trigger.classList.remove("rounded-t-theme")
      trigger.classList.add("rounded-theme")
      list.classList.remove("rounded-b-theme")
    }

    setHighlight(-1)

    document.removeEventListener("mousedown", onClickOutside)
  }

  function onClickOutside(e: MouseEvent): void {
    if (!container.contains(e.target as Node)) close()
  }

  // Mousedown on trigger opens list and starts drag mode
  trigger.addEventListener("mousedown", (e) => {
    e.preventDefault()
    if (expanded) {
      close()
      return
    }
    open()
    dragging = true

    function onMouseUp(ev: MouseEvent): void {
      document.removeEventListener("mouseup", onMouseUp)
      dragging = false
      const target = ev.target as HTMLElement
      const li = target.closest?.("[role=option]") as HTMLElement | null
      if (li && list.contains(li) && li.dataset.value) {
        selectOption(li.dataset.value)
        close()
      }
    }
    document.addEventListener("mouseup", onMouseUp)
  })

  trigger.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (!expanded) {
          open()
        } else {
          setHighlight(Math.min(highlightIndex + 1, items.length - 1))
        }
        break
      case "ArrowUp":
        e.preventDefault()
        if (!expanded) {
          open()
        } else {
          setHighlight(Math.max(highlightIndex - 1, 0))
        }
        break
      case "Home":
        e.preventDefault()
        if (expanded) setHighlight(0)
        break
      case "End":
        e.preventDefault()
        if (expanded) setHighlight(items.length - 1)
        break
      case "Enter":
      case " ":
        e.preventDefault()
        if (expanded && highlightIndex >= 0) {
          selectOption(opts.options[highlightIndex].value)
          close()
          trigger.focus()
        } else if (!expanded) {
          open()
        }
        break
      case "Escape":
        e.preventDefault()
        if (expanded) {
          close()
          trigger.focus()
        }
        break
      case "Tab":
        if (expanded) close()
        break
    }
  })

  Object.defineProperty(container, "value", {
    get(): string {
      return currentValue
    },
    set(val: string) {
      if (val === currentValue) return
      if (!opts.options.some((o) => o.value === val)) return
      currentValue = val
      container.dataset.value = val
      valueSpan.textContent = labelFor(val)

      for (let i = 0; i < items.length; i++) {
        const isSelected = opts.options[i].value === val
        items[i].setAttribute("aria-selected", String(isSelected))
        const check = items[i].lastElementChild as HTMLElement
        check.innerHTML = isSelected ? getIconSvg("check") : ""
        if (isSelected) {
          items[i].classList.add("font-medium")
        } else {
          items[i].classList.remove("font-medium")
        }
      }
    },
    enumerable: true,
    configurable: true,
  })

  return container
}

export function createCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  opts?: { tone?: Tone; className?: string; size?: number }
): HTMLLabelElement {
  // Appended, never assigned: the box is a `<span>` sized by width/height, so
  // dropping the wrapper's `inline-flex` collapses it to a 0px-wide line.
  const wrapper = document.createElement("label")
  wrapper.className = `inline-flex items-center gap-2 cursor-pointer group${opts?.className ? ` ${opts.className}` : ""}`

  const input = document.createElement("input")
  input.type = "checkbox"
  input.checked = checked
  input.className = "sr-only peer"

  const size = opts?.size ?? 18
  const uncheckedClasses = opts?.tone === "popover"
    ? ["bg-popover-foreground/[0.06]", "border-popover-foreground/30", "group-hover:border-accent/60"]
    : ["bg-input", "border-input-border", "group-hover:border-accent/50"]

  const box = document.createElement("span")
  box.className = "relative shrink-0 rounded-[4px] border transition-all duration-150 " +
    "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-1 " +
    "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
  box.style.width = `${size}px`
  box.style.height = `${size}px`

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("width", String(size - 6))
  svg.setAttribute("height", String(size - 6))
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "3")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.classList.add("absolute", "transition-all", "duration-150")
  svg.style.top = "3px"
  svg.style.left = "3px"

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M20 6 9 17l-5-5")
  svg.appendChild(path)
  box.appendChild(svg)

  function applyState(isChecked: boolean) {
    if (isChecked) {
      box.classList.remove(...uncheckedClasses)
      box.classList.add("bg-accent", "border-accent", "text-accent-foreground")
      svg.style.opacity = "1"
      svg.style.transform = "scale(1)"
    } else {
      box.classList.remove("bg-accent", "border-accent", "text-accent-foreground")
      box.classList.add(...uncheckedClasses)
      svg.style.opacity = "0"
      svg.style.transform = "scale(0.8)"
    }
  }

  applyState(checked)

  input.addEventListener("change", () => {
    applyState(input.checked)
    onChange(input.checked)
  })

  wrapper.appendChild(input)
  wrapper.appendChild(box)

  if (label) {
    const span = document.createElement("span")
    span.className = "text-sm text-foreground"
    span.textContent = label
    wrapper.appendChild(span)
  }

  ;(wrapper as any).setChecked = (v: boolean) => {
    input.checked = v
    applyState(v)
  }

  return wrapper
}

export function createAccordion(
  label: string,
  opts?: { defaultOpen?: boolean; labelClass?: string; variant?: "compact" | "settings" }
): { container: HTMLElement; content: HTMLElement; toggle: () => void } {
  const isSettings = opts?.variant === "settings"
  const container = document.createElement("div")
  if (isSettings) container.className = "border-b border-input-border/15 last:border-b-0"

  const trigger = document.createElement("button")
  trigger.className = isSettings
    ? `w-full text-left text-sm font-medium px-6 py-3 flex items-center gap-2 transition-colors hover:bg-surface/50 ${opts?.labelClass ?? ""}`
    : `w-full text-left text-xs font-medium px-1 py-1.5 flex items-center gap-1.5 transition-colors ${opts?.labelClass ?? ""}`

  const chevron = icon("chevronDown", { size: isSettings ? 11 : 10 })
  chevron.classList.add("transition-transform")
  chevron.style.opacity = isSettings ? "0.4" : "0.5"
  trigger.appendChild(chevron)

  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = isSettings
    ? "flex flex-col gap-3 px-6 pb-4"
    : "flex flex-col gap-0.5"

  let expanded = opts?.defaultOpen !== false
  let currentAnim: Animation | null = null

  if (!expanded) {
    content.hidden = true
    chevron.style.transform = "rotate(-90deg)"
  }

  function toggle() {
    if (currentAnim) {
      currentAnim.cancel()
      currentAnim = null
      content.style.height = ""
      content.style.opacity = ""
      content.style.overflow = ""
    }

    expanded = !expanded
    chevron.style.transform = expanded ? "" : "rotate(-90deg)"

    if (expanded) {
      content.hidden = false
      content.style.overflow = "hidden"
      const h = content.scrollHeight
      content.style.height = "0px"
      content.style.opacity = "0"

      const anim = content.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${h}px`, opacity: 1 },
        ],
        { duration: 200, easing: "ease-out", fill: "forwards" }
      )
      currentAnim = anim

      anim.onfinish = () => {
        if (currentAnim !== anim) return
        currentAnim = null
        content.style.height = ""
        content.style.opacity = ""
        content.style.overflow = ""
        anim.cancel()
      }
    } else {
      content.style.overflow = "hidden"
      const h = content.offsetHeight

      const anim = content.animate(
        [
          { height: `${h}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: 150, easing: "ease-in", fill: "forwards" }
      )
      currentAnim = anim

      anim.onfinish = () => {
        if (currentAnim !== anim) return
        currentAnim = null
        content.hidden = true
        content.style.height = ""
        content.style.opacity = ""
        content.style.overflow = ""
        anim.cancel()
      }
    }
  }

  trigger.addEventListener("click", toggle)

  container.appendChild(trigger)
  container.appendChild(content)
  return { container, content, toggle }
}

export function createCard(opts: {
  title: string
  icon?: HTMLElement | null
  actions?: HTMLElement | null
  body?: HTMLElement | null
}): { el: HTMLDivElement; header: HTMLDivElement; body: HTMLDivElement } {
  const card = document.createElement("div")
  card.className = "widget-card flex flex-col gap-2 rounded-theme-lg p-4"

  const header = document.createElement("div")
  header.className = "flex items-center gap-2 shrink-0"

  if (opts.icon) {
    opts.icon.classList.add("shrink-0", "opacity-60")
    header.appendChild(opts.icon)
  }

  const title = document.createElement("h2")
  title.className = "widget-card-title text-xs font-semibold uppercase tracking-wider opacity-60 flex-1 min-w-0 truncate"
  title.textContent = opts.title
  header.appendChild(title)

  if (opts.actions) header.appendChild(opts.actions)
  card.appendChild(header)

  const body = document.createElement("div")
  body.className = "widget-card-body flex flex-col min-w-0"
  if (opts.body) body.appendChild(opts.body)
  card.appendChild(body)

  return { el: card, header, body }
}

export function createDialog(opts?: {
  className?: string
}): {
  dialog: HTMLDialogElement
  body: HTMLDivElement
  open: () => void
  close: () => void
} {
  const dialog = document.createElement("dialog")
  dialog.className = `m-auto rounded-theme-lg p-0 border-none text-foreground overflow-hidden dialog-surface ${opts?.className ?? ""}`.trim()

  const body = document.createElement("div")
  dialog.appendChild(body)

  document.body.appendChild(dialog)

  let closing = false

  function open() {
    dialog.showModal()
  }

  function close() {
    if (closing) return
    closing = true
    dialog.classList.add("closing")

    let done = false
    const finish = () => {
      if (done) return
      done = true
      closing = false
      dialog.classList.remove("closing")
      dialog.close()
    }

    dialog.addEventListener("animationend", finish, { once: true })
    setTimeout(finish, 150)
  }

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close()
  })

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault()
    close()
  })

  return { dialog, body, open, close }
}

let popoverZIndex = 100

interface PopoverEntry {
  el: HTMLElement
  anchor: HTMLElement
  close: () => void
  modal: boolean
}

const popoverStack: PopoverEntry[] = []
let trapCleanup: (() => void) | null = null

const FOCUSABLE_SELECTOR =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

function getPopoverFocusable(container: HTMLElement, anchor: HTMLElement): HTMLElement[] {
  return [anchor, ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(el => el.offsetParent !== null)
}

function installFocusTrap() {
  trapCleanup?.()
  trapCleanup = null
  if (popoverStack.length === 0) return

  const top = popoverStack[popoverStack.length - 1]

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab") return
    const focusable = getPopoverFocusable(top.el, top.anchor)
    if (focusable.length === 0) return
    const idx = focusable.indexOf(document.activeElement as HTMLElement)
    let next: number
    if (e.shiftKey) {
      next = idx <= 0 ? focusable.length - 1 : idx - 1
    } else {
      next = idx === -1 || idx >= focusable.length - 1 ? 0 : idx + 1
    }
    e.preventDefault()
    focusable[next].focus()
  }

  function onFocusin(e: FocusEvent) {
    const target = e.target as HTMLElement
    if (top.el.contains(target) || target === top.anchor || top.anchor.contains(target)) return
    const focusable = getPopoverFocusable(top.el, top.anchor)
    if (focusable.length > 0) focusable[0].focus()
  }

  document.addEventListener("keydown", onKeydown)
  document.addEventListener("focusin", onFocusin)
  trapCleanup = () => {
    document.removeEventListener("keydown", onKeydown)
    document.removeEventListener("focusin", onFocusin)
  }
}

document.addEventListener("mousedown", (e: MouseEvent) => {
  if (popoverStack.length === 0) return
  const top = popoverStack[popoverStack.length - 1]
  const target = e.target as Node
  if (top.el.contains(target)) return
  if (top.modal) { e.preventDefault(); return }
  if (popoverStack.length < 2) return
  if (top.anchor.contains(target) || target === top.anchor) return
  const insideParent = popoverStack.slice(0, -1).some(p => p.el.contains(target))
  if (!insideParent) e.preventDefault()
}, true)

document.addEventListener("click", (e: MouseEvent) => {
  if (popoverStack.length === 0) return
  const top = popoverStack[popoverStack.length - 1]
  const target = e.target as Node
  if (top.el.contains(target)) return
  if (!top.modal && (top.anchor.contains(target) || target === top.anchor)) return
  const insideParent = popoverStack.slice(0, -1).some(p => p.el.contains(target))
  const isModal = top.modal
  top.close()
  if (isModal || (!insideParent && popoverStack.length > 0)) {
    e.stopPropagation()
    e.preventDefault()
  }
}, true)

export function closeAllPopovers(): void {
  while (popoverStack.length > 0) {
    popoverStack[popoverStack.length - 1].close()
  }
}

export function createPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  opts?: {
    onClose?: () => void
    modal?: boolean
    position?: "below-right" | "above-center"
    padding?: "default" | "none"
  }
): { el: HTMLDivElement; close: () => void } {
  const popover = document.createElement("div")
  const pad = opts?.padding === "none" ? "p-1 gap-0" : "p-3 gap-2"
  popover.className = `fixed bg-popover text-popover-foreground rounded-theme ${pad} flex flex-col border border-popover-foreground/[0.08] glass-surface popover-enter`
  popover.style.zIndex = String(popoverZIndex++)
  popover.appendChild(content)

  const dialogHost = anchor.closest("dialog") as HTMLDialogElement | null
  const container = dialogHost ?? document.body
  container.appendChild(popover)

  const rect = anchor.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()

  let ox = 0, oy = 0
  if (dialogHost) {
    popover.style.top = "0px"
    popover.style.left = "0px"
    const m = popover.getBoundingClientRect()
    ox = m.left
    oy = m.top
  }

  const availW = dialogHost ? dialogHost.clientWidth : window.innerWidth
  const availH = dialogHost ? dialogHost.clientHeight : window.innerHeight

  let top: number
  let left: number

  if (opts?.position === "above-center") {
    top = (rect.top - oy) - popoverRect.height - 4
    left = rect.left + rect.width / 2 - popoverRect.width / 2 - ox
    if (top < 8) top = rect.bottom + 4 - oy
  } else {
    top = rect.bottom + 4 - oy
    left = rect.right - popoverRect.width - ox
    if (top + popoverRect.height > availH - 8) {
      top = (rect.top - oy) - popoverRect.height - 4
    }
  }

  if (left < 8) left = 8
  if (left + popoverRect.width > availW - 8) left = availW - popoverRect.width - 8

  popover.style.top = `${top}px`
  popover.style.left = `${left}px`

  let closed = false

  function close() {
    if (closed) return
    closed = true
    const idx = popoverStack.findIndex(entry => entry.el === popover)
    if (idx !== -1) {
      while (popoverStack.length > idx + 1) {
        popoverStack[popoverStack.length - 1].close()
      }
      popoverStack.splice(idx, 1)
    }
    installFocusTrap()
    popover.remove()
    opts?.onClose?.()
  }

  popoverStack.push({ el: popover, anchor, close, modal: opts?.modal ?? false })
  installFocusTrap()

  return { el: popover, close }
}

export type MenuItem =
  | "separator"
  | {
      label: string
      icon?: HTMLElement
      onClick: () => void
      danger?: boolean
      disabled?: boolean
      /** Shown as a `title` when the item is disabled, to explain why. */
      hint?: string
    }

/**
 * A dropdown of actions anchored to a button. Built on `createPopover`, so it
 * inherits the stack, the focus trap and the click-outside dismissal; picking
 * an item closes it.
 */
export function createMenu(
  anchor: HTMLElement,
  items: MenuItem[],
  opts?: { onClose?: () => void }
): { close: () => void } {
  const list = document.createElement("div")
  list.className = "flex flex-col min-w-[168px]"
  list.setAttribute("role", "menu")

  // The popover measures itself when it mounts, so it is created last — with
  // the items already in place — or it would be positioned as an empty box.
  let closeRef: (() => void) | null = null
  const close = (): void => closeRef?.()

  for (const item of items) {
    if (item === "separator") {
      const sep = document.createElement("div")
      sep.className = "h-px my-1 bg-popover-foreground/10"
      list.appendChild(sep)
      continue
    }

    const btn = document.createElement("button")
    btn.type = "button"
    btn.setAttribute("role", "menuitem")
    btn.disabled = !!item.disabled
    btn.className = [
      "flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-theme-xs text-[13px] transition-colors",
      item.disabled
        ? "opacity-35 cursor-not-allowed"
        : item.danger
          ? "text-danger hover:bg-danger/15"
          : "text-popover-foreground/85 hover:bg-popover-foreground/[0.09] hover:text-popover-foreground",
    ].join(" ")
    if (item.disabled && item.hint) btn.title = item.hint

    if (item.icon) {
      item.icon.classList.add("shrink-0", "opacity-70")
      btn.appendChild(item.icon)
    }
    const label = document.createElement("span")
    label.className = "truncate"
    label.textContent = item.label
    btn.appendChild(label)

    if (!item.disabled) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        close()
        item.onClick()
      })
    }
    list.appendChild(btn)
  }

  closeRef = createPopover(anchor, list, { padding: "none", onClose: opts?.onClose }).close

  return { close }
}

export function createTooltip(
  anchor: HTMLElement,
  text: string,
  opts?: { delay?: number }
): HTMLSpanElement {
  const tip = document.createElement("span")
  tip.className = "tooltip-below"
  tip.textContent = text
  anchor.style.position = "relative"
  anchor.appendChild(tip)

  const delay = opts?.delay ?? 300
  let timer: number | null = null

  anchor.addEventListener("mouseenter", () => {
    timer = window.setTimeout(() => tip.classList.add("visible"), delay)
  })
  anchor.addEventListener("mouseleave", () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    tip.classList.remove("visible")
  })

  return tip
}
