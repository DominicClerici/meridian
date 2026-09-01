/**
 * Masonry packer for the Default layout's card region.
 *
 * The region behaves as N independently-packed columns rather than a CSS grid:
 * every card is absolutely positioned, so a short card never leaves a row-sized
 * hole beneath it. Cards may span more than one column, which is why this is
 * hand-packed instead of `columns` or a flex row of column elements — a spanning
 * card has to sit across two columns' height cursors at once.
 *
 * The card order is one linear list, packed directly at whatever column count
 * the viewport calls for. That is what makes drag-to-rearrange honest: the
 * arrangement the user drags at three columns is the arrangement that order
 * produces at three columns.
 */

const GAP = 16

/** How much closer a rival slot must be before the drag snaps out of its
    current one. Without it a card flickers between two equidistant slots. */
const SNAP_STICKINESS = 28

/** Column count by viewport width, widest first. */
const BREAKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [1700, 4],
  [1100, 3],
  [640, 2],
]

function columnsForWidth(width: number): number {
  for (const [min, cols] of BREAKPOINTS) {
    if (width >= min) return cols
  }
  return 1
}

export type GridItem = { id: string; el: HTMLElement; span: number }

type Entry = {
  id: string
  el: HTMLElement
  span: number
  height: number
  placed: boolean
}

type Placement = { col: number; span: number; top: number }

/**
 * Greedy shortest-column packing. A card takes the position whose top edge is
 * highest; for a spanning card that top is the lowest point of the columns it
 * covers. Ties go to the leftmost candidate.
 */
function pack(order: Entry[], cols: number): Placement[] {
  const cursors = new Array<number>(cols).fill(0)

  return order.map((entry) => {
    const span = Math.min(entry.span, cols)
    let bestCol = 0
    let bestTop = Infinity

    for (let start = 0; start + span <= cols; start++) {
      let top = 0
      for (let c = start; c < start + span; c++) top = Math.max(top, cursors[c])
      if (top < bestTop - 0.5) {
        bestTop = top
        bestCol = start
      }
    }

    for (let c = bestCol; c < bestCol + span; c++) {
      cursors[c] = bestTop + entry.height + GAP
    }
    return { col: bestCol, span, top: bestTop }
  })
}

/**
 * A card lifted out of the grid. The card itself stays in the order — that is
 * what makes the other cards move aside — but is rendered invisible while an
 * outline marks the slot it would drop into. See `docs/layouts.md`.
 */
export type CardDragSession = {
  /** Viewport rect of the card at the moment it was lifted. */
  startRect: DOMRect
  /** Re-aims the drop slot at a viewport point (the floating card's centre). */
  hover: (x: number, y: number) => void
  /** Viewport rect the card would occupy if dropped right now. */
  targetRect: () => DOMRect
  /** Accepts the previewed order and fades the outline out. */
  drop: () => void
  /** Puts the card back where it was lifted from. */
  cancel: () => void
  /** Reveals the card again and tears the outline down. */
  finish: () => void
}

export type CardGrid = {
  setItems: (items: GridItem[]) => void
  getOrder: () => string[]
  /** Restores a previous arrangement — the rearrange mode's undo. */
  setOrder: (ids: string[]) => void
  /** Column count the grid is currently packed at. */
  getColumns: () => number
  beginDrag: (id: string) => CardDragSession | null
  destroy: () => void
}

export function createCardGrid(container: HTMLElement): CardGrid {
  let entries: Entry[] = []
  let frame = 0
  let destroyed = false

  let cols = columnsForWidth(window.innerWidth)
  let colWidth = 0

  let dragEntry: Entry | null = null
  let outline: HTMLElement | null = null

  const cardObserver = new ResizeObserver((observed) => {
    // Our own width pass triggers this; only a height we did not just record is
    // new information, and skipping the rest keeps the observer from looping.
    const changed = observed.some((o) => {
      const entry = entries.find((e) => e.el === o.target)
      return entry ? Math.abs(entry.el.offsetHeight - entry.height) > 0.5 : false
    })
    if (changed) schedule()
  })

  const containerObserver = new ResizeObserver(() => schedule())
  containerObserver.observe(container)

  window.addEventListener("resize", schedule)

  function schedule(): void {
    if (destroyed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      layout()
    })
  }

  function widthFor(span: number): number {
    const n = Math.min(span, cols)
    return colWidth * n + GAP * (n - 1)
  }

  function layout(): void {
    if (destroyed) return

    cols = columnsForWidth(window.innerWidth)
    const width = container.clientWidth
    if (!entries.length || width <= 0) {
      container.style.height = ""
      return
    }

    colWidth = (width - GAP * (cols - 1)) / cols

    for (const entry of entries) {
      entry.el.style.width = `${widthFor(entry.span)}px`
    }
    for (const entry of entries) {
      entry.height = entry.el.offsetHeight
    }

    const placements = pack(entries, cols)

    let bottom = 0
    entries.forEach((entry, i) => {
      const p = placements[i]
      entry.el.style.transform = `translate(${p.col * (colWidth + GAP)}px, ${p.top}px)`
      if (!entry.placed) {
        entry.placed = true
        // Skip the transition on the first placement, or every card would slide
        // in from the container's top-left corner on mount.
        void entry.el.offsetHeight
        entry.el.classList.add("card-grid-item-placed")
      }
      bottom = Math.max(bottom, p.top + entry.height)

      if (entry === dragEntry && outline) {
        outline.style.width = `${widthFor(entry.span)}px`
        outline.style.height = `${entry.height}px`
        outline.style.transform = entry.el.style.transform
      }
    })

    container.style.height = `${bottom}px`
  }

  /** Local placement of the dragged card, expressed in viewport coordinates. */
  function placementRect(p: Placement, height: number): DOMRect {
    const rect = container.getBoundingClientRect()
    const w = widthFor(p.span)
    return new DOMRect(rect.left + p.col * (colWidth + GAP), rect.top + p.top, w, height)
  }

  function beginDrag(id: string): CardDragSession | null {
    if (dragEntry) return null
    const entry = entries.find((e) => e.id === id)
    if (!entry) return null

    const startIndex = entries.indexOf(entry)
    const startRect = entry.el.getBoundingClientRect()

    dragEntry = entry
    entry.el.classList.add("is-card-dragging")

    outline = document.createElement("div")
    outline.className = "card-drop-outline"
    outline.style.width = `${startRect.width}px`
    outline.style.height = `${startRect.height}px`
    outline.style.transform = entry.el.style.transform
    container.appendChild(outline)
    // Flush at opacity 0 so the fade-in transitions rather than snapping.
    void outline.offsetHeight
    outline.classList.add("is-visible")

    function currentPlacement(): Placement {
      return pack(entries, cols)[entries.indexOf(entry!)]
    }

    return {
      startRect,

      hover(x, y) {
        if (!dragEntry) return
        const rect = container.getBoundingClientRect()
        const others = entries.filter((e) => e !== entry)
        const from = entries.indexOf(entry!)

        let bestIndex = from
        let bestScore = Infinity

        for (let k = 0; k <= others.length; k++) {
          const candidate = [...others.slice(0, k), entry!, ...others.slice(k)]
          const p = pack(candidate, cols)[k]
          const cx = rect.left + p.col * (colWidth + GAP) + widthFor(p.span) / 2
          const cy = rect.top + p.top + entry!.height / 2
          const score =
            Math.hypot(cx - x, cy - y) - (k === from ? SNAP_STICKINESS : 0)
          if (score < bestScore) {
            bestScore = score
            bestIndex = k
          }
        }

        if (bestIndex === from) return
        entries.splice(from, 1)
        entries.splice(bestIndex, 0, entry!)
        layout()
      },

      targetRect() {
        return placementRect(currentPlacement(), entry.height)
      },

      drop() {
        outline?.classList.remove("is-visible")
      },

      cancel() {
        const at = entries.indexOf(entry)
        if (at !== startIndex) {
          entries.splice(at, 1)
          entries.splice(startIndex, 0, entry)
          layout()
        }
        outline?.classList.remove("is-visible")
      },

      finish() {
        entry.el.classList.remove("is-card-dragging")
        outline?.remove()
        outline = null
        dragEntry = null
      },
    }
  }

  return {
    setItems(items) {
      cardObserver.disconnect()
      entries = items.map((item) => ({
        id: item.id,
        el: item.el,
        span: Math.max(1, item.span),
        height: 0,
        placed: false,
      }))
      for (const entry of entries) {
        entry.el.classList.add("card-grid-item")
        cardObserver.observe(entry.el)
      }
      layout()
    },

    getOrder() {
      return entries.map((e) => e.id)
    },

    setOrder(ids) {
      const byId = new Map(entries.map((e) => [e.id, e] as const))
      const named = ids.map((id) => byId.get(id)).filter((e): e is Entry => !!e)
      const rest = entries.filter((e) => !named.includes(e))
      entries = [...named, ...rest]
      layout()
    },

    getColumns() {
      return cols
    },

    beginDrag,

    destroy() {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      cardObserver.disconnect()
      containerObserver.disconnect()
      window.removeEventListener("resize", schedule)
      outline?.remove()
      outline = null
      dragEntry = null
      container.style.height = ""
    },
  }
}
