type ButtonVariant = "primary" | "outline" | "ghost" | "destructive" | "destructive-outline" | "override"

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-accent text-accent bg-transparent hover:bg-accent/10",
  ghost: "text-foreground bg-transparent hover:bg-surface",
  destructive: "bg-danger text-danger-foreground hover:bg-danger-hover",
  "destructive-outline": "border border-danger text-danger bg-transparent hover:bg-danger/10",
  override: "",
}

export function createButton(
  label: string,
  variant: ButtonVariant,
  opts?: { icon?: string; onClick?: () => void; className?: string }
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${BUTTON_CLASSES[variant]} ${opts?.className ?? ""}`.trim()

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

export function createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string
  name?: string
  onChange?: (value: string) => void
}): HTMLSelectElement {
  const el = document.createElement("select")
  el.className = "text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground outline-none focus:border-accent transition-colors"

  for (const opt of opts.options) {
    const option = document.createElement("option")
    option.value = opt.value
    option.textContent = opt.label
    el.appendChild(option)
  }

  if (opts.value) el.value = opts.value
  if (opts.name) el.name = opts.name
  if (opts.onChange) {
    el.addEventListener("change", () => opts.onChange!(el.value))
  }

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
  opts?: { defaultOpen?: boolean; labelClass?: string; variant?: "compact" | "settings" }
): { container: HTMLElement; content: HTMLElement; toggle: () => void } {
  const isSettings = opts?.variant === "settings"
  const container = document.createElement("div")
  if (isSettings) container.className = "border-b border-input-border/15 last:border-b-0"

  const trigger = document.createElement("button")
  trigger.className = isSettings
    ? `w-full text-left text-sm font-medium px-6 py-3 flex items-center gap-2 transition-colors hover:bg-surface/50 ${opts?.labelClass ?? ""}`
    : `w-full text-left text-xs font-medium px-1 py-1.5 flex items-center gap-1.5 transition-colors ${opts?.labelClass ?? ""}`

  const chevron = document.createElement("span")
  chevron.textContent = "\u25BC"
  chevron.className = isSettings
    ? "text-[11px] transition-transform opacity-40"
    : "text-[10px] transition-transform opacity-50"
  trigger.appendChild(chevron)

  const labelSpan = document.createElement("span")
  labelSpan.textContent = label
  trigger.appendChild(labelSpan)

  const content = document.createElement("div")
  content.className = isSettings
    ? "flex flex-col gap-3 px-6 py-4"
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

let popoverZIndex = 100

export function createPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  opts?: { onClose?: () => void; parentPopover?: HTMLElement }
): { el: HTMLDivElement; close: () => void } {
  const popover = document.createElement("div")
  popover.className = "fixed bg-popover text-popover-foreground rounded-theme p-3 flex flex-col gap-2 border border-white/[0.08] glass-surface popover-enter"
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
