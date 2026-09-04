/**
 * Column-stack packer for the Default layout's card region.
 *
 * The region is N columns, each an ordered stack of cards. Every card is
 * absolutely positioned, so a short card never leaves a row-sized hole beneath
 * it; a card that spans two columns sits in both stacks and takes the lower of
 * the two cursors. This is hand-packed instead of `columns` or a flex row of
 * column elements because of those spanning cards.
 *
 * Column membership is explicit rather than derived from heights: a card that
 * grows when its data lands only pushes the cards below it in its own column,
 * and dragging a card to a slot puts it in exactly that slot. An arrangement is
 * exact at the column count it was made at; other counts derive from the
 * nearest one and are then held fixed until the count changes again.
 */

const GAP = 16

/** How much closer a rival slot must be before the drag snaps out of its
    current one. Without it a card flickers between two equidistant slots. */
const SNAP_STICKINESS = 28

/** A viewport still being sized reports its old width to the first pass and
    corrects itself up to a second later. Inside this window a column-count
    change snaps into place instead of sliding. */
const SETTLE_MS = 1500

/** How long the reveal waits on the web fonts before showing the grid anyway. */
const FONT_WAIT_MS = 300

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

/** One ordered stack of card ids per column. A spanning card appears in every
    column it covers, at the same relative position in each. */
export type Columns = string[][]

/** Exact arrangements keyed by column count. */
export type SavedLayouts = Record<string, Columns>

export type GridOptions = {
  /** Read on every arrangement, so a save made through this grid is seen by
      the next column count it packs at. */
  layouts: () => SavedLayouts
  /** A column count with no arrangement just had one derived for it. */
  onDerived?: (cols: number, columns: Columns) => void
  /** Last known height of a card at a column count, applied as a floor under
      a body that is still loading so the column doesn't reflow when it lands. */
  heightFor?: (id: string, cols: number) => number | undefined
  onMeasured?: (id: string, cols: number, height: number) => void
  /** Hold the region invisible until its first arrangement has settled. Only
      wanted on a page that hasn't painted the region yet: an in-place rebuild
      would blink instead. */
  hidden?: boolean
}

type Entry = {
  id: string
  el: HTMLElement
  span: number
  height: number
  placed: boolean
}

type Placement = { col: number; span: number; top: number }

type Packed = { placements: Map<string, Placement>; bottoms: number[] }

function clone(columns: Columns): Columns {
  return columns.map((col) => [...col])
}

function without(columns: Columns, id: string): Columns {
  return columns.map((col) => col.filter((other) => other !== id))
}

function sameColumns(a: Columns, b: Columns): boolean {
  return a.length === b.length && a.every((col, i) => col.join("\n") === b[i].join("\n"))
}

/**
 * Places every card in the stacks. A card is placed once it is at the head of
 * every column it covers, at the lowest of those columns' cursors; heads are
 * visited left to right so a tie goes to the leftmost card.
 */
function packColumns(columns: Columns, heights: Map<string, number>): Packed {
  const cols = columns.length
  const cursors = new Array<number>(cols).fill(0)
  const heads = new Array<number>(cols).fill(0)
  const placements = new Map<string, Placement>()
  const work = clone(columns)

  const covering = (id: string): number[] => {
    const covered: number[] = []
    work.forEach((col, c) => {
      if (col.includes(id)) covered.push(c)
    })
    return covered
  }

  for (;;) {
    let progressed = false
    for (let c = 0; c < cols; c++) {
      while (heads[c] < work[c].length) {
        const id = work[c][heads[c]]
        if (placements.has(id)) {
          heads[c]++
          continue
        }
        const covered = covering(id)
        if (!covered.every((cc) => work[cc][heads[cc]] === id)) break

        let top = 0
        for (const cc of covered) top = Math.max(top, cursors[cc])
        const height = heights.get(id) ?? 0
        placements.set(id, { col: covered[0], span: covered.length, top })
        for (const cc of covered) {
          cursors[cc] = top + height + GAP
          heads[cc]++
        }
        progressed = true
      }
    }
    if (progressed) continue

    // Two spanning cards listed in opposite orders in the columns they share
    // can never both reach the head. Force the leftmost waiting card through
    // rather than hang — the arrangement is corrupt, not the page.
    const stuck = work.findIndex((col, c) => heads[c] < col.length)
    if (stuck === -1) break
    const id = work[stuck][heads[stuck]]
    for (const col of work) {
      const at = col.indexOf(id)
      if (at !== -1) col.splice(at, 1)
    }
    work[stuck].splice(heads[stuck], 0, id)
  }

  const bottoms = cursors.map((cursor) => Math.max(0, cursor - GAP))
  return { placements, bottoms }
}

/**
 * A card lifted out of the grid. The card itself keeps a slot — that is what
 * makes the other cards move aside — but is rendered invisible while an
 * outline marks the slot it would drop into. See `docs/layouts.md`.
 */
export type CardDragSession = {
  /** Viewport rect of the card at the moment it was lifted. */
  startRect: DOMRect
  /** Re-aims the drop slot at a viewport point (the floating card's centre). */
  hover: (x: number, y: number) => void
  /** Viewport rect the card would occupy if dropped right now. */
  targetRect: () => DOMRect
  /** Accepts the previewed arrangement and fades the outline out. */
  drop: () => void
  /** Puts the card back where it was lifted from. */
  cancel: () => void
  /** Reveals the card again and tears the outline down. */
  finish: () => void
}

export type CardGrid = {
  setItems: (items: GridItem[]) => void
  /** The arrangement as packed right now, at `getColumns()` columns. */
  getLayout: () => Columns
  /** Restores a previous arrangement — the rearrange mode's undo. */
  setLayout: (columns: Columns) => void
  /** Column count the grid is currently packed at. */
  getColumns: () => number
  beginDrag: (id: string) => CardDragSession | null
  destroy: () => void
}

export function createCardGrid(container: HTMLElement, options: GridOptions): CardGrid {
  let entries: Entry[] = []
  let frame = 0
  let destroyed = false
  const created = performance.now()

  let cols = columnsForWidth(window.innerWidth)
  let colWidth = 0
  let columns: Columns = []
  /** Column count `columns` was arranged for; 0 until the first pass. */
  let arrangedAt = 0

  let dragEntry: Entry | null = null
  let outline: HTMLElement | null = null

  container.classList.add("card-grid")
  if (options.hidden) container.classList.add("is-settling")

  const cardObserver = new ResizeObserver((observed) => {
    // Our own width pass triggers this; only a height we did not just record is
    // new information, and skipping the rest keeps the observer from looping.
    const changed = observed.some((o) => {
      const entry = entries.find((e) => e.el === o.target)
      return entry ? Math.abs(entry.el.offsetHeight - entry.height) > 0.5 : false
    })
    if (changed) relayout()
  })

  const containerObserver = new ResizeObserver(() => relayout())
  containerObserver.observe(container)

  /**
   * Observer callbacks run after layout and before paint. While the grid is
   * still hidden, a body that just re-rendered for its real width is packed in
   * the same frame, so the reveal shows the corrected arrangement rather than
   * a slide toward it.
   */
  function relayout(): void {
    if (container.classList.contains("is-settling")) layout()
    else schedule()
  }

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

  function heightMap(): Map<string, number> {
    return new Map(entries.map((e) => [e.id, e.height] as const))
  }

  function entryFor(id: string): Entry | undefined {
    return entries.find((e) => e.id === id)
  }

  function spanAt(entry: Entry, count: number): number {
    return Math.min(entry.span, count)
  }

  /**
   * Fits a stored arrangement to the cards actually on the page: drops ids
   * that aren't mounted, makes every spanning card cover exactly its span of
   * adjacent columns, and appends anything the arrangement never named.
   */
  function reconcile(saved: Columns, count: number): Columns {
    const known = new Set(entries.map((e) => e.id))
    const fitted: Columns = saved.slice(0, count).map((col) => col.filter((id) => known.has(id)))
    while (fitted.length < count) fitted.push([])

    const missing: Entry[] = []
    for (const entry of entries) {
      const span = spanAt(entry, count)
      const present: number[] = []
      fitted.forEach((col, c) => {
        if (col.includes(entry.id)) present.push(c)
      })
      if (!present.length) {
        missing.push(entry)
        continue
      }
      const left = Math.min(present[0], count - span)
      const wanted = Array.from({ length: span }, (_, i) => left + i)
      if (present.length === wanted.length && present.every((c, i) => c === wanted[i])) continue

      const at = fitted[present[0]].indexOf(entry.id)
      for (const c of present) {
        if (!wanted.includes(c)) fitted[c].splice(fitted[c].indexOf(entry.id), 1)
      }
      for (const c of wanted) {
        if (!present.includes(c)) fitted[c].splice(Math.min(at, fitted[c].length), 0, entry.id)
      }
    }

    appendShortest(fitted, missing)
    return fitted
  }

  /** Adds cards to the bottom of whichever column(s) end highest. */
  function appendShortest(target: Columns, extra: Entry[]): void {
    if (!extra.length) return
    const count = target.length
    const { bottoms } = packColumns(target, heightMap())
    const cursors = bottoms.map((b, c) => (target[c].length ? b + GAP : 0))
    for (const entry of extra) {
      const span = spanAt(entry, count)
      let bestCol = 0
      let bestTop = Infinity
      for (let start = 0; start + span <= count; start++) {
        let top = 0
        for (let c = start; c < start + span; c++) top = Math.max(top, cursors[c])
        if (top < bestTop - 0.5) {
          bestTop = top
          bestCol = start
        }
      }
      for (let c = bestCol; c < bestCol + span; c++) {
        target[c].push(entry.id)
        cursors[c] = bestTop + entry.height + GAP
      }
    }
  }

  /** The cards in the order the eye reads them off the nearest saved
      arrangement — or, with none saved, the order they were handed over in. */
  function readingOrder(count: number): Entry[] {
    const layouts = options.layouts()
    const saved = Object.keys(layouts)
      .map(Number)
      .filter((n) => n > 0 && Array.isArray(layouts[n]))
    if (!saved.length) return entries

    const above = saved.filter((n) => n > count).sort((a, b) => a - b)[0]
    const below = saved.filter((n) => n < count).sort((a, b) => b - a)[0]
    const source = above ?? below
    const { placements } = packColumns(reconcile(layouts[source], source), heightMap())
    return [...entries].sort((a, b) => {
      const pa = placements.get(a.id)!
      const pb = placements.get(b.id)!
      return pa.top - pb.top || pa.col - pb.col
    })
  }

  function arrange(count: number): Columns {
    const saved = options.layouts()[count]
    if (Array.isArray(saved)) return reconcile(saved, count)

    const derived: Columns = Array.from({ length: count }, () => [])
    appendShortest(derived, readingOrder(count))
    options.onDerived?.(count, clone(derived))
    return derived
  }

  /** Floors a still-loading card at its last known height, so the column
      doesn't reflow when the body lands. Returns the cards it floored. */
  function applyLoadingFloors(): Set<Entry> {
    const floored = new Set<Entry>()
    for (const entry of entries) {
      const loading = entry.el.querySelector("[data-loading]") !== null
      const floor = loading ? options.heightFor?.(entry.id, cols) : undefined
      entry.el.style.minHeight = floor ? `${floor}px` : ""
      if (loading) floored.add(entry)
    }
    return floored
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
    const loading = applyLoadingFloors()
    for (const entry of entries) {
      entry.height = entry.el.offsetHeight
      if (!loading.has(entry)) options.onMeasured?.(entry.id, cols, entry.height)
    }

    let snap = false
    if (arrangedAt !== cols) {
      snap = arrangedAt !== 0 && performance.now() - created < SETTLE_MS
      columns = arrange(cols)
      arrangedAt = cols
    }
    if (snap) container.classList.add("is-snapping")

    const { placements, bottoms } = packColumns(columns, heightMap())

    for (const entry of entries) {
      const p = placements.get(entry.id)
      if (!p) continue
      entry.el.style.transform = `translate(${p.col * (colWidth + GAP)}px, ${p.top}px)`
      if (!entry.placed) {
        entry.placed = true
        // Skip the transition on the first placement, or every card would slide
        // in from the container's top-left corner on mount.
        void entry.el.offsetHeight
        entry.el.classList.add("card-grid-item-placed")
      }

      if (entry === dragEntry && outline) {
        outline.style.width = `${widthFor(entry.span)}px`
        outline.style.height = `${entry.height}px`
        outline.style.transform = entry.el.style.transform
      }
    }

    container.style.height = `${Math.max(...bottoms)}px`

    if (snap) {
      void container.offsetHeight
      requestAnimationFrame(() => container.classList.remove("is-snapping"))
    }
  }

  /**
   * Holds the grid invisible until the fonts are in and the viewport has
   * reported the same size two frames running, so the first thing on screen is
   * the arrangement that stays.
   */
  function reveal(): void {
    const fonts = document.fonts?.ready ?? Promise.resolve()
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS))
    void Promise.race([fonts, timeout]).then(() => {
      if (destroyed) return
      let last = ""
      let tries = 0
      const check = () => {
        if (destroyed) return
        const now = `${window.innerWidth}x${container.clientWidth}`
        if (now !== last && tries++ < 6) {
          last = now
          if (frame) {
            cancelAnimationFrame(frame)
            frame = 0
          }
          layout()
          requestAnimationFrame(check)
          return
        }
        container.classList.remove("is-settling")
      }
      requestAnimationFrame(check)
    })
  }

  /** Local placement of a card, expressed in viewport coordinates. */
  function placementRect(p: Placement, height: number): DOMRect {
    const rect = container.getBoundingClientRect()
    const w = widthFor(p.span)
    return new DOMRect(rect.left + p.col * (colWidth + GAP), rect.top + p.top, w, height)
  }

  /**
   * Inserts a card into column `col` at `index`. A spanning card also goes into
   * each further column it covers, above whichever cards there sit lower than
   * the slot it was given — measured against the stacks without it, so the
   * answer doesn't depend on where it is currently previewed.
   */
  function insertAt(others: Columns, entry: Entry, col: number, index: number, base: Packed): Columns {
    const next = clone(others)
    next[col].splice(index, 0, entry.id)
    const span = spanAt(entry, others.length)
    if (span === 1) return next

    const above = others[col][index - 1]
    const top = above ? base.placements.get(above)!.top + (entryFor(above)?.height ?? 0) : 0
    for (let c = col + 1; c < col + span; c++) {
      const j = others[c].filter((id) => base.placements.get(id)!.top < top).length
      next[c].splice(j, 0, entry.id)
    }
    return next
  }

  function beginDrag(id: string): CardDragSession | null {
    if (dragEntry) return null
    const entry = entryFor(id)
    if (!entry) return null

    const startColumns = clone(columns)
    const startRect = entry.el.getBoundingClientRect()
    const others = without(columns, id)
    const startCol = columns.findIndex((col) => col.includes(id))
    let current = { col: startCol, index: columns[startCol].indexOf(id) }

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
      return packColumns(columns, heightMap()).placements.get(id)!
    }

    return {
      startRect,

      hover(x, y) {
        if (!dragEntry) return
        const rect = container.getBoundingClientRect()
        const heights = heightMap()
        const base = packColumns(others, heights)
        const span = spanAt(entry!, cols)

        let best = current
        let bestScore = Infinity
        let bestColumns: Columns | null = null

        for (let c = 0; c + span <= cols; c++) {
          for (let i = 0; i <= others[c].length; i++) {
            const candidate = insertAt(others, entry!, c, i, base)
            const p = packColumns(candidate, heights).placements.get(id)!
            const cx = rect.left + p.col * (colWidth + GAP) + widthFor(p.span) / 2
            const cy = rect.top + p.top + entry!.height / 2
            const sticky = c === current.col && i === current.index ? SNAP_STICKINESS : 0
            const score = Math.hypot(cx - x, cy - y) - sticky
            if (score < bestScore) {
              bestScore = score
              best = { col: c, index: i }
              bestColumns = candidate
            }
          }
        }

        if (!bestColumns || (best.col === current.col && best.index === current.index)) return
        current = best
        if (sameColumns(bestColumns, columns)) return
        columns = bestColumns
        layout()
      },

      targetRect() {
        return placementRect(currentPlacement(), entry.height)
      },

      drop() {
        outline?.classList.remove("is-visible")
      },

      cancel() {
        if (!sameColumns(columns, startColumns)) {
          columns = startColumns
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
      arrangedAt = 0
      layout()
      reveal()
    },

    getLayout() {
      return clone(columns)
    },

    setLayout(next) {
      columns = reconcile(next, cols)
      arrangedAt = cols
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
      container.classList.remove("card-grid", "is-settling", "is-snapping")
    },
  }
}
