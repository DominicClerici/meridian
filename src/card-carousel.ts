/**
 * Single-slot carousel for the Dashboard's side column.
 *
 * Unlike the packed grid, this region shows one card at a time: every slide is
 * absolutely positioned in a viewport whose height follows the active slide, so
 * cycling animates between two intrinsic heights instead of pinning every widget
 * to the tallest one. Chevrons fade in on hover; the dots below stay visible so
 * there is a standing hint that more widgets are behind this one.
 */

import { icon } from "./icons/registry"

export type CarouselItem = { id: string; title: string; el: HTMLElement }

export type CardCarousel = {
  setItems: (items: CarouselItem[]) => void
  destroy: () => void
}

export type CarouselOptions = {
  /** Slide to open on, when it is still present. */
  initialId?: string | null
  onChange?: (id: string) => void
}

export function createCardCarousel(
  container: HTMLElement,
  opts: CarouselOptions = {}
): CardCarousel {
  container.classList.add("card-carousel")
  container.setAttribute("role", "group")
  container.setAttribute("aria-roledescription", "carousel")

  const stage = document.createElement("div")
  stage.className = "card-carousel-stage"

  const viewport = document.createElement("div")
  viewport.className = "card-carousel-viewport"
  stage.appendChild(viewport)

  const prev = navButton("prev", () => step(-1))
  const next = navButton("next", () => step(1))
  stage.append(prev, next)

  const dots = document.createElement("div")
  dots.className = "card-carousel-dots"

  container.append(stage, dots)

  let items: CarouselItem[] = []
  let index = 0
  let destroyed = false
  let sized = false

  const slideObserver = new ResizeObserver(() => syncHeight())

  function syncHeight(): void {
    if (destroyed) return
    const active = items[index]
    if (!active) return
    const height = active.el.offsetHeight
    if (height <= 0) return
    // The first pass runs before the carousel has ever had a height, and
    // transitioning from 0 would read as the panel unfolding on every page load.
    if (!sized) {
      sized = true
      viewport.style.height = `${height}px`
      void viewport.offsetHeight
      viewport.classList.add("is-animated")
      return
    }
    viewport.style.height = `${height}px`
  }

  function step(delta: number): void {
    if (items.length < 2) return
    show((index + delta + items.length) % items.length, delta > 0)
  }

  /** `forward` is the travel direction, not derived from the indices — wrapping
      from the last slide to the first is still a forward move. */
  function show(nextIndex: number, forward: boolean): void {
    if (nextIndex === index || !items[nextIndex]) return
    const from = items[index]
    const to = items[nextIndex]

    if (from) {
      from.el.classList.remove("is-active", "is-exit-left", "is-exit-right")
      from.el.classList.add(forward ? "is-exit-left" : "is-exit-right")
    }
    to.el.classList.remove("is-exit-left", "is-exit-right")
    to.el.classList.add("is-enter", forward ? "is-enter-right" : "is-enter-left")
    void to.el.offsetHeight
    to.el.classList.remove("is-enter", "is-enter-right", "is-enter-left")
    to.el.classList.add("is-active")
    if (from) setInactive(from.el)
    setActive(to.el)

    index = nextIndex
    syncHeight()
    renderDots()
    opts.onChange?.(to.id)
  }

  function renderDots(): void {
    dots.replaceChildren()
    dots.hidden = items.length < 2
    items.forEach((item, i) => {
      const dot = document.createElement("button")
      dot.type = "button"
      dot.className = "card-carousel-dot"
      dot.setAttribute("aria-label", `Show ${item.title}`)
      if (i === index) dot.setAttribute("aria-current", "true")
      dot.addEventListener("click", () => show(i, i > index))
      dots.appendChild(dot)
    })
  }

  return {
    setItems(nextItems) {
      slideObserver.disconnect()
      viewport.replaceChildren()
      items = nextItems
      sized = false
      viewport.classList.remove("is-animated")
      viewport.style.height = ""

      container.hidden = items.length === 0
      prev.hidden = items.length < 2
      next.hidden = items.length < 2
      if (items.length === 0) {
        dots.hidden = true
        return
      }

      const wanted = items.findIndex((item) => item.id === opts.initialId)
      index = wanted >= 0 ? wanted : 0

      items.forEach((item, i) => {
        item.el.classList.add("card-carousel-slide")
        if (i === index) {
          item.el.classList.add("is-active")
          setActive(item.el)
        } else {
          setInactive(item.el)
        }
        viewport.appendChild(item.el)
        slideObserver.observe(item.el)
      })

      renderDots()
      syncHeight()
    },
    destroy() {
      destroyed = true
      slideObserver.disconnect()
      container.classList.remove("card-carousel")
      container.removeAttribute("role")
      container.removeAttribute("aria-roledescription")
      container.hidden = false
      stage.remove()
      dots.remove()
    },
  }
}

/* A slide at opacity 0 is still in the tab order and still read aloud, so the
   widgets behind the visible one are taken out of both. */
function setActive(slide: HTMLElement): void {
  slide.removeAttribute("inert")
  slide.removeAttribute("aria-hidden")
}

function setInactive(slide: HTMLElement): void {
  slide.setAttribute("inert", "")
  slide.setAttribute("aria-hidden", "true")
}

function navButton(dir: "prev" | "next", onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = `card-carousel-nav is-${dir}`
  btn.setAttribute("aria-label", dir === "prev" ? "Previous widget" : "Next widget")
  btn.appendChild(icon(dir === "prev" ? "chevronLeft" : "chevronRight", { size: 16 }))
  btn.addEventListener("click", onClick)
  return btn
}
