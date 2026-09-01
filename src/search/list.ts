import { icon } from "../icons/registry"
import type { Ranked, RowAction } from "./types"

/**
 * The result list.
 *
 * The old renderer rebuilt every row from scratch on every keystroke *and* on
 * every arrow key, re-creating each icon element as it went — which is why
 * moving the selection made favicons flash. Here rows are keyed by candidate
 * id and reused across renders, and the selection is a single element that
 * slides, so arrowing through results touches no row at all.
 */

const RAIL_CLASS = "palette-rail"

/**
 * Set here rather than in CSS so the panel's height maths and the list's own
 * cap can't drift apart — reserving a taller panel than the list can fill
 * leaves dead space under the footer.
 */
export const LIST_MAX_HEIGHT = 360

export type Row =
  | { kind: "result"; row: Ranked }
  | { kind: "action"; action: RowAction }

export type ListHandle = {
  el: HTMLElement
  /** Renders `rows`, preserving element identity for ids seen last time. */
  render(rows: Row[], opts?: { stagger?: boolean }): void
  setActive(index: number): void
  /** Natural height of the content, for the panel's height animation. */
  contentHeight(): number
  count(): number
}

function rowId(row: Row): string {
  return row.kind === "result" ? row.row.candidate.id : `action:${row.action.id}`
}

/** Wraps matched characters so the reason a row is here is visible. */
function highlight(text: string, positions: number[] | undefined): DocumentFragment {
  const fragment = document.createDocumentFragment()
  if (!positions?.length) {
    fragment.appendChild(document.createTextNode(text))
    return fragment
  }

  const marked = new Set(positions)
  let buffer = ""
  let bufferMarked = false

  const flush = () => {
    if (!buffer) return
    if (bufferMarked) {
      const mark = document.createElement("mark")
      mark.className = "palette-mark"
      mark.textContent = buffer
      fragment.appendChild(mark)
    } else {
      fragment.appendChild(document.createTextNode(buffer))
    }
    buffer = ""
  }

  for (let i = 0; i < text.length; i++) {
    const isMarked = marked.has(i)
    if (isMarked !== bufferMarked) {
      flush()
      bufferMarked = isMarked
    }
    buffer += text[i]
  }
  flush()
  return fragment
}

export function createList(): ListHandle {
  const el = document.createElement("div")
  el.className = "palette-list"
  el.setAttribute("role", "listbox")
  el.style.maxHeight = `${LIST_MAX_HEIGHT}px`

  const rail = document.createElement("div")
  rail.className = RAIL_CLASS
  rail.hidden = true
  el.appendChild(rail)

  const pool = new Map<string, HTMLElement>()
  let items: HTMLElement[] = []
  let current: Row[] = []
  let active = -1

  function iconKey(row: Ranked): string {
    return row.candidate.iconKey ?? ""
  }

  function buildResult(row: Ranked): HTMLElement {
    const node = document.createElement("div")
    node.className = "palette-row"
    node.setAttribute("role", "option")

    const iconWrap = document.createElement("span")
    iconWrap.className = "palette-row-icon"
    iconWrap.appendChild(row.candidate.icon())
    node.appendChild(iconWrap)

    const text = document.createElement("span")
    text.className = "palette-row-text"

    const title = document.createElement("span")
    title.className = "palette-row-title"
    text.appendChild(title)

    const sub = document.createElement("span")
    sub.className = "palette-row-sub"
    text.appendChild(sub)

    node.appendChild(text)

    const detail = document.createElement("span")
    detail.className = "palette-row-detail"
    node.appendChild(detail)

    const chevron = icon("chevronRight", { size: 12, class: "palette-row-more" })
    node.appendChild(chevron)

    return node
  }

  function fillResult(node: HTMLElement, row: Ranked): void {
    if (node.dataset.iconKey !== undefined && node.dataset.iconKey !== iconKey(row)) {
      const wrap = node.querySelector(".palette-row-icon") as HTMLElement
      wrap.replaceChildren(row.candidate.icon())
    }
    node.dataset.iconKey = iconKey(row)

    const title = node.querySelector(".palette-row-title") as HTMLElement
    title.replaceChildren(highlight(row.candidate.title, row.positions))

    const sub = node.querySelector(".palette-row-sub") as HTMLElement
    sub.textContent = row.candidate.subtitle ?? ""
    sub.hidden = !row.candidate.subtitle

    const detail = node.querySelector(".palette-row-detail") as HTMLElement
    detail.textContent = row.candidate.detail ?? ""
    detail.hidden = !row.candidate.detail

    const more = node.querySelector(".palette-row-more") as HTMLElement
    more.hidden = !row.candidate.actions?.length
  }

  function buildAction(action: RowAction): HTMLElement {
    const node = document.createElement("div")
    node.className = "palette-row"
    node.setAttribute("role", "option")
    if (action.destructive) node.classList.add("is-destructive")

    const iconWrap = document.createElement("span")
    iconWrap.className = "palette-row-icon"
    if (action.glyph) iconWrap.appendChild(icon(action.glyph, { size: 16 }))
    node.appendChild(iconWrap)

    const text = document.createElement("span")
    text.className = "palette-row-text"
    const title = document.createElement("span")
    title.className = "palette-row-title"
    title.textContent = action.label
    text.appendChild(title)
    node.appendChild(text)

    return node
  }

  function heading(label: string): HTMLElement {
    const node = document.createElement("div")
    node.className = "palette-group"
    node.textContent = label
    return node
  }

  return {
    el,

    render(rows: Row[], opts): void {
      const children: HTMLElement[] = [rail]
      const next: HTMLElement[] = []
      const nextPool = new Map<string, HTMLElement>()
      let lastGroup: string | null = null
      let created = 0

      rows.forEach((row, index) => {
        if (row.kind === "result" && row.row.group && row.row.group !== lastGroup) {
          children.push(heading(row.row.group))
          lastGroup = row.row.group
        }
        if (row.kind === "result" && !row.row.group) lastGroup = null

        const id = rowId(row)
        let node = pool.get(id)
        const fresh = !node
        if (!node) {
          node = row.kind === "result" ? buildResult(row.row) : buildAction(row.action)
        }
        if (row.kind === "result") fillResult(node, row.row)

        node.dataset.index = String(index)
        if (fresh && opts?.stagger && created < 8) {
          node.style.animationDelay = `${created * 15}ms`
          node.classList.add("is-entering")
          created++
        } else {
          node.style.animationDelay = ""
          node.classList.remove("is-entering")
        }

        nextPool.set(id, node)
        next.push(node)
        children.push(node)
      })

      pool.clear()
      for (const [id, node] of nextPool) pool.set(id, node)
      items = next
      current = rows

      el.replaceChildren(...children)
      // The rail's stored position belongs to the list that just went away.
      if (active >= rows.length) active = rows.length - 1
      this.setActive(active)
    },

    setActive(index: number): void {
      active = index
      for (const node of items) node.classList.remove("is-active")

      const node = items[index]
      if (!node) {
        rail.hidden = true
        return
      }

      node.classList.add("is-active")
      node.setAttribute("aria-selected", "true")
      rail.hidden = false
      rail.style.transform = `translateY(${node.offsetTop}px)`
      rail.style.height = `${node.offsetHeight}px`

      const top = node.offsetTop
      const bottom = top + node.offsetHeight
      if (top < el.scrollTop) el.scrollTop = top - 4
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight + 4
      }
    },

    contentHeight(): number {
      return Math.min(el.scrollHeight, LIST_MAX_HEIGHT)
    },

    count(): number {
      return current.length
    },
  }
}
