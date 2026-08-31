/**
 * Masonry packer for the Default layout's card region.
 *
 * The region behaves as N independently-packed columns rather than a CSS grid:
 * every card is absolutely positioned, so a short card never leaves a row-sized
 * hole beneath it. Cards may span more than one column, which is why this is
 * hand-packed instead of `columns` or a flex row of column elements — a spanning
 * card has to sit across two columns' height cursors at once.
 */

const GAP = 16
const MAX_COLUMNS = 4

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

export type GridItem = { el: HTMLElement; span: number }

type Entry = { el: HTMLElement; span: number; height: number; placed: boolean }

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
 * Flattens a placement back into a linear order for the next-narrower column
 * count: highest top edge first, and on a tie the rightmost card comes first, so
 * it lands above its left-hand neighbour once the two merge into one column.
 */
function flatten(order: Entry[], placements: Placement[]): Entry[] {
  return order
    .map((entry, i) => ({ entry, p: placements[i] }))
    .sort((a, b) => {
      const topDelta = Math.round(a.p.top) - Math.round(b.p.top)
      if (topDelta !== 0) return topDelta
      return b.p.col + b.p.span - (a.p.col + a.p.span)
    })
    .map((row) => row.entry)
}

export type CardGrid = {
  setItems: (items: GridItem[]) => void
  destroy: () => void
}

export function createCardGrid(container: HTMLElement): CardGrid {
  let entries: Entry[] = []
  let frame = 0
  let destroyed = false

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

  function layout(): void {
    if (destroyed) return

    const cols = columnsForWidth(window.innerWidth)
    const width = container.clientWidth
    if (!entries.length || width <= 0) {
      container.style.height = ""
      return
    }

    const colWidth = (width - GAP * (cols - 1)) / cols

    for (const entry of entries) {
      const span = Math.min(entry.span, cols)
      entry.el.style.width = `${colWidth * span + GAP * (span - 1)}px`
    }
    for (const entry of entries) {
      entry.height = entry.el.offsetHeight
    }

    // Narrower counts are derived by collapsing the widest arrangement one
    // column at a time, so the card order a user sees at 2 columns is the one
    // the 4-column layout would fold down to.
    let order = entries
    let placements = pack(order, MAX_COLUMNS)
    for (let k = MAX_COLUMNS - 1; k >= cols; k--) {
      order = flatten(order, placements)
      placements = pack(order, k)
    }

    let bottom = 0
    order.forEach((entry, i) => {
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
    })

    container.style.height = `${bottom}px`
  }

  return {
    setItems(items) {
      cardObserver.disconnect()
      entries = items.map((item) => ({
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
    destroy() {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      cardObserver.disconnect()
      containerObserver.disconnect()
      window.removeEventListener("resize", schedule)
      container.style.height = ""
    },
  }
}
