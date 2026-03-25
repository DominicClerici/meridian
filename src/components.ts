type ButtonVariant = "primary" | "outline" | "ghost"

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-accent text-accent bg-transparent hover:bg-accent/10",
  ghost: "text-foreground bg-transparent hover:bg-surface",
}

export function createButton(
  label: string,
  variant: ButtonVariant,
  opts?: { icon?: string; onClick?: () => void }
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${BUTTON_CLASSES[variant]}`

  if (opts?.icon) {
    const iconSpan = document.createElement("span")
    iconSpan.className = "shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"
    iconSpan.innerHTML = opts.icon
    btn.appendChild(iconSpan)
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
}): HTMLInputElement | HTMLTextAreaElement {
  const classes = "w-full text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors"

  if (opts.multiline) {
    const el = document.createElement("textarea")
    el.className = `${classes} resize-y`
    el.rows = opts.rows ?? 3
    if (opts.placeholder) el.placeholder = opts.placeholder
    if (opts.value) el.value = opts.value
    if (opts.name) el.name = opts.name
    return el
  }

  const el = document.createElement("input")
  el.type = opts.type ?? "text"
  el.className = classes
  if (opts.placeholder) el.placeholder = opts.placeholder
  if (opts.value) el.value = opts.value
  if (opts.name) el.name = opts.name
  return el
}

export function createCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLLabelElement {
  const wrapper = document.createElement("label")
  wrapper.className = "inline-flex items-center gap-2 cursor-pointer"

  const input = document.createElement("input")
  input.type = "checkbox"
  input.checked = checked
  input.className = "rounded accent-accent shrink-0"
  input.addEventListener("change", () => onChange(input.checked))

  wrapper.appendChild(input)

  if (label) {
    const span = document.createElement("span")
    span.className = "text-sm text-foreground"
    span.textContent = label
    wrapper.appendChild(span)
  }

  return wrapper
}

export function createAccordion(
  label: string,
  opts?: { defaultOpen?: boolean; labelClass?: string }
): { container: HTMLElement; content: HTMLElement; toggle: () => void } {
  const container = document.createElement("div")
  const trigger = document.createElement("button")
  trigger.className = `w-full text-left text-sm font-semibold px-2 py-1 flex items-center gap-1 text-foreground ${opts?.labelClass ?? ""}`

  const chevron = document.createElement("span")
  chevron.textContent = "\u25BC"
  chevron.className = "text-xs transition-transform"
  trigger.appendChild(chevron)

  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = "flex flex-col gap-1 px-1"

  let expanded = opts?.defaultOpen !== false

  if (!expanded) {
    content.hidden = true
    chevron.style.transform = "rotate(-90deg)"
  }

  function toggle() {
    expanded = !expanded
    content.hidden = !expanded
    chevron.style.transform = expanded ? "" : "rotate(-90deg)"
  }

  trigger.addEventListener("click", toggle)

  container.appendChild(trigger)
  container.appendChild(content)
  return { container, content, toggle }
}

let popoverZIndex = 100

export function createPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  opts?: { onClose?: () => void; parentPopover?: HTMLElement }
): { el: HTMLDivElement; close: () => void } {
  const popover = document.createElement("div")
  popover.className = "fixed bg-popover text-popover-foreground rounded-theme shadow-lg p-3 flex flex-col gap-2 backdrop-blur-sm border border-input-border/20"
  popover.style.zIndex = String(popoverZIndex++)
  popover.appendChild(content)

  document.body.appendChild(popover)

  const rect = anchor.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()

  let top = rect.bottom + 4
  let left = rect.right - popoverRect.width

  if (left < 8) left = 8
  if (left + popoverRect.width > window.innerWidth - 8) left = window.innerWidth - popoverRect.width - 8
  if (top + popoverRect.height > window.innerHeight - 8) {
    top = rect.top - popoverRect.height - 4
  }

  popover.style.top = `${top}px`
  popover.style.left = `${left}px`

  let closed = false

  function close() {
    if (closed) return
    closed = true
    popover.remove()
    document.removeEventListener("click", onClickOutside)
    opts?.onClose?.()
  }

  function onClickOutside(e: MouseEvent) {
    const target = e.target as Node
    if (popover.contains(target)) return
    if (anchor.contains(target) || target === anchor) return
    if (opts?.parentPopover?.contains(target)) return
    close()
  }

  setTimeout(() => document.addEventListener("click", onClickOutside), 0)

  return { el: popover, close }
}
