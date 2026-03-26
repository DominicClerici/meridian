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

export type SelectElement = HTMLDivElement & { value: string }

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`

const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`

export function createSelect(opts: {
  options: { value: string; label: string }[]
  value?: string
  name?: string
  onChange?: (value: string) => void
}): SelectElement {
  let currentValue = opts.value ?? opts.options[0]?.value ?? ""
  let expanded = false
  let highlightIndex = -1
  let openAnim: Animation | null = null
  let closeAnim: Animation | null = null
  let dragging = false

  const container = document.createElement("div") as SelectElement
  container.className = "relative font-body"
  container.setAttribute("role", "combobox")
  container.setAttribute("aria-expanded", "false")
  container.setAttribute("aria-haspopup", "listbox")
  container.dataset.value = currentValue
  if (opts.name) container.dataset.name = opts.name

  const trigger = document.createElement("button")
  trigger.type = "button"
  trigger.className = "select__trigger flex items-center justify-between gap-2 w-full text-sm rounded-theme px-2 py-1.5 border border-input-border bg-input text-foreground outline-none transition-colors hover:border-accent focus-visible:border-accent cursor-pointer"

  const valueSpan = document.createElement("span")
  valueSpan.className = "select__value truncate"

  const arrow = document.createElement("span")
  arrow.className = "select__arrow shrink-0 text-muted transition-transform duration-100 [&>svg]:block"
  arrow.innerHTML = CHEVRON_SVG

  trigger.appendChild(valueSpan)
  trigger.appendChild(arrow)

  const list = document.createElement("ul")
  list.setAttribute("role", "listbox")
  list.tabIndex = -1
  list.className = "select__list absolute left-0 right-0 top-full z-50 border border-input-border border-t-0 bg-popover text-popover-foreground overflow-auto"
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

      li.className = "flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer transition-colors"

      const check = document.createElement("span")
      check.className = "shrink-0 w-3.5 text-accent [&>svg]:block"
      check.innerHTML = opt.value === currentValue ? CHECK_SVG : ""

      const label = document.createElement("span")
      label.className = "truncate"
      label.textContent = opt.label

      li.appendChild(check)
      li.appendChild(label)

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

  function setHighlight(index: number): void {
    if (highlightIndex >= 0 && highlightIndex < items.length) {
      items[highlightIndex].classList.remove("bg-surface")
    }
    highlightIndex = index
    if (index >= 0 && index < items.length) {
      items[index].classList.add("bg-surface")
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
      const check = items[i].firstElementChild as HTMLElement
      check.innerHTML = isSelected ? CHECK_SVG : ""
    }

    opts.onChange?.(val)
  }

  function open(): void {
    if (expanded) return
    expanded = true
    container.setAttribute("aria-expanded", "true")

    if (closeAnim) {
      closeAnim.cancel()
      closeAnim = null
    }

    trigger.classList.remove("rounded-theme")
    trigger.classList.add("rounded-t-theme")
    list.classList.add("rounded-b-theme")

    list.style.display = ""
    list.style.opacity = "0"
    list.style.transform = "translateY(-4px)"

    arrow.style.transform = "rotate(180deg)"

    const idx = opts.options.findIndex((o) => o.value === currentValue)
    setHighlight(idx)

    openAnim = list.animate(
      [
        { opacity: 0, transform: "translateY(-4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 100, easing: "ease-out", fill: "forwards" }
    )
    openAnim.onfinish = () => {
      if (!openAnim) return
      openAnim = null
      list.style.opacity = "1"
      list.style.transform = "translateY(0)"
    }

    setTimeout(() => document.addEventListener("mousedown", onClickOutside), 0)
  }

  function close(): void {
    if (!expanded) return
    expanded = false
    dragging = false
    container.setAttribute("aria-expanded", "false")

    if (openAnim) {
      openAnim.cancel()
      openAnim = null
    }

    arrow.style.transform = ""

    closeAnim = list.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-4px)" },
      ],
      { duration: 75, easing: "ease-in", fill: "forwards" }
    )
    closeAnim.onfinish = () => {
      if (!closeAnim) return
      closeAnim = null
      list.style.display = "none"
      list.style.opacity = ""
      list.style.transform = ""

      trigger.classList.remove("rounded-t-theme")
      trigger.classList.add("rounded-theme")
      list.classList.remove("rounded-b-theme")

      setHighlight(-1)
    }

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
        const check = items[i].firstElementChild as HTMLElement
        check.innerHTML = isSelected ? CHECK_SVG : ""
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
  onChange: (checked: boolean) => void
): HTMLLabelElement {
  const wrapper = document.createElement("label")
  wrapper.className = "inline-flex items-center gap-2 cursor-pointer group"

  const input = document.createElement("input")
  input.type = "checkbox"
  input.checked = checked
  input.className = "sr-only peer"

  const box = document.createElement("span")
  box.className = "relative shrink-0 w-[18px] h-[18px] rounded-[4px] border transition-all duration-150 " +
    "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-1 " +
    "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("width", "12")
  svg.setAttribute("height", "12")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "3")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.classList.add("absolute", "top-[3px]", "left-[3px]", "transition-all", "duration-150")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M20 6 9 17l-5-5")
  svg.appendChild(path)
  box.appendChild(svg)

  function applyState(isChecked: boolean) {
    if (isChecked) {
      box.classList.remove("bg-input", "border-input-border", "group-hover:border-accent/50")
      box.classList.add("bg-accent", "border-accent", "text-accent-foreground")
      svg.style.opacity = "1"
      svg.style.transform = "scale(1)"
    } else {
      box.classList.remove("bg-accent", "border-accent", "text-accent-foreground")
      box.classList.add("bg-input", "border-input-border", "group-hover:border-accent/50")
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
