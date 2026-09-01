import { store } from "./store"
import { icon } from "./icons/registry"
import { renderIcon } from "./shortcut-icon"
import { normalizeUrl, urlHost, prettyUrl } from "./url"
import { historySearch, historyAvailable } from "./history-api"
import {
  bookmarksGetTree,
  bookmarksGranted,
  bookmarksSupported,
  requestBookmarks,
} from "./bookmarks-api"
import {
  createButton,
  createDialog,
  createInput,
  createSelect,
  showToast,
} from "./components"
import {
  addTab,
  allShortcutUrls,
  findTab,
  itemCapacity,
  makeShortcut,
  MAX_CHILDREN_PER_FOLDER,
  MAX_TABS,
  type IconSpec,
  type Shortcut,
  type Tab,
  type TabItem,
} from "./shortcuts"

/**
 * Import and export for the shortcuts tree.
 *
 * This replaces `history-import.ts`, which had been unreachable for some time:
 * it looked up `#sc-import-history` and `#sc-tab-select`, neither of which
 * existed anywhere in the app, so `initHistoryImport()` returned early and the
 * dialog markup in `index.html` was never opened by anything.
 *
 * The flow is source → pick → destination. Nothing is written until the last
 * step, so backing out of any of it leaves the tree untouched.
 */

type SourceId = "bookmarks" | "history" | "paste" | "html" | "restore"

type Candidate = {
  id: string
  name: string
  url: string
  /** Folder names from the source, outermost first. */
  path: string[]
  duplicate: boolean
  meta?: string
}

const MAX_CANDIDATES = 2000
const MAX_RENDERED = 300
const HISTORY_BATCH = 150
const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
const BLOCKED_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "moz-extension:", "brave:"]

const getTabs = (): Tab[] => store.local.get("shortcuts")
const save = (tabs: Tab[]): void => store.local.set("shortcuts", tabs)

// ------------------------------------------------------------------ sources

function usable(url: string): boolean {
  if (!url || BLOCKED_SCHEMES.some((s) => url.startsWith(s))) return false
  return Boolean(normalizeUrl(url))
}

function toCandidates(
  raw: { name: string; url: string; path: string[]; meta?: string }[]
): Candidate[] {
  const existing = new Set([...allShortcutUrls(getTabs())].map((u) => normalizeUrl(u) || u))
  const seen = new Set<string>()
  const out: Candidate[] = []

  for (const entry of raw) {
    if (out.length >= MAX_CANDIDATES) break
    if (!usable(entry.url)) continue
    const href = normalizeUrl(entry.url)
    if (seen.has(href)) continue
    seen.add(href)
    out.push({
      id: crypto.randomUUID(),
      name: entry.name.trim() || urlHost(href) || href,
      url: href,
      path: entry.path,
      duplicate: existing.has(href),
      meta: entry.meta,
    })
  }
  return out
}

function collectBookmarks(nodes: BookmarkTreeNode[], path: string[], out: { name: string; url: string; path: string[] }[]): void {
  for (const node of nodes) {
    if (node.url) {
      out.push({ name: node.title, url: node.url, path })
      continue
    }
    if (node.children) {
      // The unnamed root wrappers ("", id 0) shouldn't become folder names.
      const title = node.title.trim()
      collectBookmarks(node.children, title ? [...path, title] : path, out)
    }
  }
}

async function fromBookmarks(): Promise<Candidate[]> {
  const tree = await bookmarksGetTree()
  const raw: { name: string; url: string; path: string[] }[] = []
  collectBookmarks(tree, [], raw)
  return toCandidates(raw)
}

async function fromHistory(): Promise<Candidate[]> {
  const now = Date.now()
  const startTime = now - HISTORY_WINDOW_MS
  let endTime = now
  const map = new Map<string, { url: string; visits: number }>()

  while (endTime > startTime && map.size < MAX_CANDIDATES) {
    const results = await historySearch({
      text: "",
      startTime,
      endTime,
      maxResults: HISTORY_BATCH,
    })

    for (const item of results) {
      if (!item.url) continue
      const count = item.visitCount ?? 0
      const existing = map.get(item.url)
      if (!existing || count > existing.visits) map.set(item.url, { url: item.url, visits: count })
    }

    if (results.length < HISTORY_BATCH) break
    const last = results[results.length - 1]
    const next = (last.lastVisitTime ?? endTime) - 1
    if (next >= endTime) break
    endTime = next
  }

  const sorted = [...map.values()].sort((a, b) => b.visits - a.visits)
  return toCandidates(
    sorted.map((e) => ({
      name: urlHost(e.url),
      url: e.url,
      path: [],
      meta: `${e.visits} visit${e.visits === 1 ? "" : "s"}`,
    }))
  )
}

function fromPaste(text: string): Candidate[] {
  const raw = text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // "Name | https://…" and "Name <https://…>" both appear in the wild;
      // anything else is treated as a bare URL.
      const piped = line.match(/^(.*?)\s*[|\t]\s*(\S+)$/)
      if (piped) return { name: piped[1], url: piped[2], path: [] }
      const angled = line.match(/^(.*?)\s*<(\S+)>$/)
      if (angled) return { name: angled[1], url: angled[2], path: [] }
      return { name: "", url: line, path: [] }
    })
  return toCandidates(raw)
}

/**
 * The Netscape bookmarks format every browser exports. `<DT>` has no closing
 * tag, so a nested `<DL>` may be parsed either as a child of the `<DT>` or as
 * its next sibling depending on the source file — both are handled.
 */
function fromNetscapeHtml(html: string): Candidate[] {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const raw: { name: string; url: string; path: string[] }[] = []

  const walk = (list: Element, path: string[]): void => {
    for (const dt of Array.from(list.children)) {
      if (dt.tagName !== "DT") continue

      const heading = dt.querySelector(":scope > h3")
      if (heading) {
        const name = heading.textContent?.trim() || "Folder"
        const nested =
          dt.querySelector(":scope > dl") ??
          (dt.nextElementSibling?.tagName === "DL" ? dt.nextElementSibling : null)
        if (nested) walk(nested, [...path, name])
        continue
      }

      const anchor = dt.querySelector(":scope > a")
      if (anchor) {
        raw.push({
          name: anchor.textContent?.trim() ?? "",
          url: anchor.getAttribute("href") ?? "",
          path,
        })
      }
    }
  }

  for (const dl of Array.from(doc.querySelectorAll("dl"))) {
    if (!dl.closest("dt")) walk(dl, [])
  }
  return toCandidates(raw)
}

// ------------------------------------------------------------------ export

export function exportBackup(): void {
  const payload = {
    format: "meridian-shortcuts",
    version: 1,
    exportedAt: new Date().toISOString(),
    tabs: getTabs(),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.href = url
  link.download = `shortcuts-${new Date().toISOString().slice(0, 10)}.json`
  link.click()

  setTimeout(() => URL.revokeObjectURL(url), 2000)
  showToast("Backup downloaded")
}

/** A backup is user-supplied JSON, so nothing about its shape is assumed. */
type RawItem = {
  type?: string
  name?: unknown
  url?: unknown
  icon?: IconSpec
  children?: unknown[]
}

function parseBackup(text: string): Tab[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const tabs = (data as { tabs?: unknown })?.tabs
  if (!Array.isArray(tabs)) return null

  const clean: Tab[] = []
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue
    const t = tab as Partial<Tab>
    if (typeof t.name !== "string" || !Array.isArray(t.items)) continue

    const items: TabItem[] = []
    for (const item of t.items) {
      if (!item || typeof item !== "object") continue
      const i = item as RawItem
      if (i.type === "shortcut" && typeof i.url === "string") {
        const made = makeShortcut(String(i.name ?? ""), i.url, i.icon)
        if (made) items.push(made)
      } else if (i.type === "folder" && Array.isArray(i.children)) {
        const children: Shortcut[] = []
        for (const child of i.children) {
          const c = child as RawItem
          if (typeof c?.url !== "string") continue
          const made = makeShortcut(String(c.name ?? ""), c.url, c.icon)
          if (made) children.push(made)
        }
        items.push({
          type: "folder",
          id: crypto.randomUUID(),
          name: String(i.name ?? "Folder"),
          children: children.slice(0, MAX_CHILDREN_PER_FOLDER),
          ...(i.icon ? { icon: i.icon } : {}),
        })
      }
    }

    clean.push({
      id: crypto.randomUUID(),
      name: t.name,
      items,
      ...(t.icon ? { icon: t.icon } : {}),
    })
  }

  return clean.length > 0 ? clean : null
}

// ------------------------------------------------------------------- commit

type Destination =
  | { kind: "tab"; tabId: string }
  | { kind: "new-tab"; name: string }
  | { kind: "folder"; tabId: string; name: string }

function buildFolders(picked: Candidate[]): { loose: Candidate[]; folders: Map<string, Candidate[]> } {
  const loose: Candidate[] = []
  const folders = new Map<string, Candidate[]>()

  for (const candidate of picked) {
    // Folders can't nest, so everything below the first level collapses into it.
    const group = candidate.path[0]
    if (!group) {
      loose.push(candidate)
      continue
    }
    const bucket = folders.get(group)
    if (bucket) bucket.push(candidate)
    else folders.set(group, [candidate])
  }
  return { loose, folders }
}

function commitImport(
  picked: Candidate[],
  dest: Destination,
  keepFolders: boolean
): { added: number; skipped: number; message?: string } {
  let tabs = getTabs()

  let targetTabId: string
  if (dest.kind === "new-tab") {
    const result = addTab(tabs, dest.name || "Imported")
    if (!result.ok) return { added: 0, skipped: picked.length, message: result.reason }
    tabs = result.tabs
    targetTabId = tabs[tabs.length - 1].id
  } else {
    targetTabId = dest.tabId
    if (!findTab(tabs, targetTabId)) {
      return { added: 0, skipped: picked.length, message: "That tab no longer exists." }
    }
  }

  const newItems: TabItem[] = []
  const toShortcut = (c: Candidate): Shortcut | null => makeShortcut(c.name, c.url)

  if (dest.kind === "folder") {
    const children: Shortcut[] = []
    for (const c of picked) {
      if (children.length >= MAX_CHILDREN_PER_FOLDER) break
      const made = toShortcut(c)
      if (made) children.push(made)
    }
    newItems.push({
      type: "folder",
      id: crypto.randomUUID(),
      name: dest.name || "Imported",
      children,
    })
  } else if (keepFolders) {
    const { loose, folders } = buildFolders(picked)
    for (const c of loose) {
      const made = toShortcut(c)
      if (made) newItems.push(made)
    }
    for (const [name, group] of folders) {
      const children: Shortcut[] = []
      for (const c of group) {
        if (children.length >= MAX_CHILDREN_PER_FOLDER) break
        const made = toShortcut(c)
        if (made) children.push(made)
      }
      if (children.length > 0) {
        newItems.push({ type: "folder", id: crypto.randomUUID(), name, children })
      }
    }
  } else {
    for (const c of picked) {
      const made = toShortcut(c)
      if (made) newItems.push(made)
    }
  }

  const room = itemCapacity(tabs, targetTabId).free
  const fitting = newItems.slice(0, room)
  const skipped = newItems.length - fitting.length

  tabs = tabs.map((t) => (t.id === targetTabId ? { ...t, items: [...t.items, ...fitting] } : t))
  save(tabs)

  const added = fitting.reduce(
    (n, i) => n + (i.type === "folder" ? i.children.length : 1),
    0
  )
  return {
    added,
    skipped,
    message: skipped > 0 ? `${skipped} didn't fit — that tab is full.` : undefined,
  }
}

// ------------------------------------------------------------------ dialog

const SOURCES: { id: SourceId; title: string; blurb: string; glyph: string }[] = [
  {
    id: "bookmarks",
    title: "Browser bookmarks",
    blurb: "Pick from your saved bookmarks, folders and all.",
    glyph: "star",
  },
  {
    id: "history",
    title: "Browsing history",
    blurb: "Your most-visited sites over the last three months.",
    glyph: "repeat",
  },
  {
    id: "paste",
    title: "Paste a list",
    blurb: "One address per line. Names fill in from the site.",
    glyph: "copy",
  },
  {
    id: "html",
    title: "Bookmarks HTML file",
    blurb: "The bookmarks.html any browser can export.",
    glyph: "bgUpload",
  },
  {
    id: "restore",
    title: "Restore a backup",
    blurb: "A JSON file exported from here.",
    glyph: "archiveRestore",
  },
]

export function openImportDialog(preferredTabId?: string | null): void {
  const { dialog, body, open, close } = createDialog()
  dialog.classList.add("sc-import-dialog")
  body.className = "flex flex-col w-[620px] max-w-[92vw] h-[540px] max-h-[80vh]"

  let step: "source" | "pick" | "dest" = "source"
  let source: SourceId | null = null
  let candidates: Candidate[] = []
  let picked = new Set<string>()
  let filter = ""
  let hideDuplicates = true
  let keepFolders = true
  let busy = false
  let error = ""

  let destKind: Destination["kind"] = "tab"
  let destTabId = preferredTabId ?? getTabs()[0]?.id ?? ""
  let destName = "Imported"

  const header = document.createElement("div")
  header.className =
    "flex items-center gap-2 px-5 py-3.5 shrink-0 border-b border-input-border/15"
  body.appendChild(header)

  const content = document.createElement("div")
  content.className = "flex-1 min-h-0 overflow-y-auto px-5 py-4"
  body.appendChild(content)

  const footer = document.createElement("div")
  footer.className =
    "flex items-center gap-2 px-5 py-3 shrink-0 border-t border-input-border/15"
  body.appendChild(footer)

  // --- steps ---------------------------------------------------------------

  function renderHeader(): void {
    header.replaceChildren()

    if (step !== "source") {
      const back = createButton("", "ghost", { icon: icon("chevronLeft", { size: 14 }) })
      back.className += " !px-1.5"
      back.setAttribute("aria-label", "Back")
      back.addEventListener("click", () => {
        step = step === "dest" ? "pick" : "source"
        if (step === "source") {
          candidates = []
          picked.clear()
          error = ""
        }
        render()
      })
      header.appendChild(back)
    }

    const title = document.createElement("h3")
    title.className = "flex-1 min-w-0 text-sm font-semibold truncate"
    title.textContent =
      step === "source"
        ? "Import shortcuts"
        : step === "pick"
          ? SOURCES.find((s) => s.id === source)?.title ?? "Choose what to import"
          : "Where should they go?"
    header.appendChild(title)

    const closeBtn = createButton("", "ghost", { icon: icon("close", { size: 14 }) })
    closeBtn.className += " !px-1.5"
    closeBtn.setAttribute("aria-label", "Close")
    closeBtn.addEventListener("click", close)
    header.appendChild(closeBtn)
  }

  function renderSourceStep(): void {
    const list = document.createElement("div")
    list.className = "flex flex-col gap-2"

    for (const entry of SOURCES) {
      const card = document.createElement("button")
      card.type = "button"
      card.className = "sc-source-card"

      const glyph = icon(entry.glyph, { size: 18 })
      glyph.classList.add("shrink-0", "text-accent")
      card.appendChild(glyph)

      const text = document.createElement("span")
      text.className = "flex flex-col gap-0.5 flex-1 min-w-0 text-left"

      const title = document.createElement("span")
      title.className = "text-sm font-medium text-foreground"
      title.textContent = entry.title
      text.appendChild(title)

      const blurb = document.createElement("span")
      blurb.className = "text-xs text-muted"
      blurb.textContent = entry.blurb
      text.appendChild(blurb)

      card.appendChild(text)

      const chevron = icon("chevronRight", { size: 14 })
      chevron.classList.add("shrink-0", "text-muted")
      card.appendChild(chevron)

      if (entry.id === "history" && !historyAvailable()) {
        card.disabled = true
        blurb.textContent = "This browser doesn't expose reading history."
      }
      if (entry.id === "bookmarks" && !bookmarksSupported() && !globalThis.chrome?.bookmarks) {
        card.disabled = true
        blurb.textContent = "This browser doesn't expose bookmarks."
      }

      card.addEventListener("click", () => pickSource(entry.id, card))
      list.appendChild(card)
    }

    content.replaceChildren(list)

    if (error) {
      const errorEl = document.createElement("p")
      errorEl.className = "text-sm text-danger mt-3"
      errorEl.textContent = error
      content.appendChild(errorEl)
    }
  }

  /**
   * The permission request has to run synchronously inside this click — Chrome
   * refuses one that isn't tied to a user gesture — so nothing is awaited
   * before `requestBookmarks()`.
   */
  function pickSource(id: SourceId, anchor: HTMLElement): void {
    source = id
    error = ""

    if (id === "paste") {
      step = "pick"
      candidates = []
      render()
      return
    }

    if (id === "html" || id === "restore") {
      openFilePicker(id)
      return
    }

    if (id === "bookmarks") {
      requestBookmarks().then((granted) => {
        if (!granted) {
          error = "Bookmarks access was declined, so there's nothing to read."
          source = null
          render()
          return
        }
        loadCandidates(fromBookmarks())
      })
      anchor.blur()
      return
    }

    loadCandidates(fromHistory())
  }

  function loadCandidates(work: Promise<Candidate[]>): void {
    busy = true
    step = "pick"
    render()

    work
      .then((found) => {
        candidates = found
        picked = new Set(found.filter((c) => !c.duplicate).map((c) => c.id))
      })
      .catch(() => {
        error = "Couldn't read from that source."
        candidates = []
      })
      .finally(() => {
        busy = false
        render()
      })
  }

  function openFilePicker(kind: "html" | "restore"): void {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = kind === "html" ? ".html,.htm,text/html" : ".json,application/json"
    input.addEventListener("change", async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()

      if (kind === "restore") {
        const restored = parseBackup(text)
        if (!restored) {
          error = "That file isn't a shortcuts backup."
          source = null
          render()
          return
        }
        confirmRestore(restored)
        return
      }

      const found = fromNetscapeHtml(text)
      if (found.length === 0) {
        error = "No bookmarks found in that file."
        source = null
        render()
        return
      }
      candidates = found
      picked = new Set(found.filter((c) => !c.duplicate).map((c) => c.id))
      step = "pick"
      render()
    })
    input.click()
  }

  function confirmRestore(restored: Tab[]): void {
    step = "dest"
    content.replaceChildren()

    const note = document.createElement("div")
    note.className = "flex flex-col gap-3"

    const heading = document.createElement("p")
    heading.className = "text-sm text-foreground"
    const count = restored.reduce((n, t) => n + t.items.length, 0)
    heading.textContent = `This backup holds ${restored.length} tab${restored.length === 1 ? "" : "s"} and ${count} top-level item${count === 1 ? "" : "s"}.`
    note.appendChild(heading)

    const warn = document.createElement("p")
    warn.className = "text-xs text-muted"
    warn.textContent =
      "Replacing discards everything you have now. Merging appends the backup's tabs, up to the limit of six."
    note.appendChild(warn)

    content.appendChild(note)

    footer.replaceChildren()
    const spacer = document.createElement("div")
    spacer.className = "flex-1"
    footer.appendChild(spacer)

    const merge = createButton("Merge", "outline")
    merge.addEventListener("click", () => {
      const current = getTabs()
      const room = MAX_TABS - current.length
      if (room <= 0) {
        showToast(`You already have ${MAX_TABS} tabs.`, { variant: "danger" })
        return
      }
      const before = current
      save([...current, ...restored.slice(0, room)])
      close()
      showToast(`Merged ${Math.min(room, restored.length)} tab(s)`, {
        action: { label: "Undo", onClick: () => save(before) },
      })
    })
    footer.appendChild(merge)

    const replace = createButton("Replace everything", "destructive")
    replace.addEventListener("click", () => {
      const before = getTabs()
      save(restored.slice(0, MAX_TABS))
      close()
      showToast("Shortcuts restored", {
        action: { label: "Undo", onClick: () => save(before) },
      })
    })
    footer.appendChild(replace)

    renderHeader()
  }

  // --- pick step -----------------------------------------------------------

  function visibleCandidates(): Candidate[] {
    const q = filter.trim().toLowerCase()
    return candidates.filter((c) => {
      if (hideDuplicates && c.duplicate && !picked.has(c.id)) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
    })
  }

  function renderPickStep(): void {
    content.replaceChildren()

    if (source === "paste" && candidates.length === 0) {
      renderPasteStep()
      return
    }

    if (busy) {
      const loading = document.createElement("div")
      loading.className = "flex flex-col items-center justify-center gap-3 h-full text-muted"
      const spinner = icon("spinner", { size: 22 })
      loading.appendChild(spinner)
      const label = document.createElement("span")
      label.className = "text-sm"
      label.textContent = source === "history" ? "Reading your history…" : "Reading your bookmarks…"
      loading.appendChild(label)
      content.appendChild(loading)
      return
    }

    if (error) {
      const errorEl = document.createElement("p")
      errorEl.className = "text-sm text-danger"
      errorEl.textContent = error
      content.appendChild(errorEl)
      return
    }

    const controls = document.createElement("div")
    controls.className = "flex items-center gap-2 mb-3"

    const filterInput = createInput({ placeholder: "Filter", value: filter }) as HTMLInputElement
    filterInput.className += " !w-[180px]"
    filterInput.addEventListener("input", () => {
      filter = filterInput.value
      renderList()
      renderFooter()
    })
    controls.appendChild(filterInput)

    const dupeCount = candidates.filter((c) => c.duplicate).length
    if (dupeCount > 0) {
      const dupeToggle = document.createElement("label")
      dupeToggle.className = "flex items-center gap-1.5 text-xs text-muted cursor-pointer"
      const box = document.createElement("input")
      box.type = "checkbox"
      box.className = "rounded accent-accent"
      box.checked = hideDuplicates
      box.addEventListener("change", () => {
        hideDuplicates = box.checked
        renderList()
        renderFooter()
      })
      dupeToggle.appendChild(box)
      const dupeLabel = document.createElement("span")
      dupeLabel.textContent = `Hide ${dupeCount} already saved`
      dupeToggle.appendChild(dupeLabel)
      controls.appendChild(dupeToggle)
    }

    const spacer = document.createElement("div")
    spacer.className = "flex-1"
    controls.appendChild(spacer)

    const allBtn = createButton("Select all", "ghost")
    allBtn.addEventListener("click", () => {
      for (const c of visibleCandidates()) picked.add(c.id)
      renderList()
      renderFooter()
    })
    controls.appendChild(allBtn)

    const noneBtn = createButton("None", "ghost")
    noneBtn.addEventListener("click", () => {
      for (const c of visibleCandidates()) picked.delete(c.id)
      renderList()
      renderFooter()
    })
    controls.appendChild(noneBtn)

    content.appendChild(controls)

    const list = document.createElement("div")
    list.className = "flex flex-col gap-0.5"
    content.appendChild(list)

    function renderList(): void {
      list.replaceChildren()
      const visible = visibleCandidates()

      if (visible.length === 0) {
        const empty = document.createElement("p")
        empty.className = "text-sm text-muted py-6 text-center"
        empty.textContent = candidates.length === 0 ? "Nothing to import." : "No matches."
        list.appendChild(empty)
        return
      }

      for (const candidate of visible.slice(0, MAX_RENDERED)) {
        list.appendChild(createCandidateRow(candidate, renderFooter))
      }

      if (visible.length > MAX_RENDERED) {
        const more = document.createElement("p")
        more.className = "text-xs text-muted py-2 text-center"
        more.textContent = `Showing the first ${MAX_RENDERED} of ${visible.length}. Filter to narrow, or use Select all — it takes every match.`
        list.appendChild(more)
      }
    }

    renderList()
  }

  function createCandidateRow(candidate: Candidate, onToggle: () => void): HTMLElement {
    const row = document.createElement("label")
    row.className = "sc-import-row"

    const box = document.createElement("input")
    box.type = "checkbox"
    box.className = "rounded accent-accent shrink-0"
    box.checked = picked.has(candidate.id)
    box.addEventListener("change", () => {
      if (box.checked) picked.add(candidate.id)
      else picked.delete(candidate.id)
      onToggle()
    })
    row.appendChild(box)

    row.appendChild(
      renderIcon(
        { type: "favicon" },
        { kind: "shortcut", name: candidate.name, url: candidate.url },
        { size: 18 }
      )
    )

    const text = document.createElement("div")
    text.className = "flex flex-col min-w-0 flex-1"

    const name = document.createElement("span")
    name.className = "text-sm truncate"
    name.textContent = candidate.name
    text.appendChild(name)

    const sub = document.createElement("span")
    sub.className = "text-xs text-muted truncate"
    sub.textContent =
      (candidate.path.length ? `${candidate.path.join(" / ")} · ` : "") + prettyUrl(candidate.url)
    text.appendChild(sub)

    row.appendChild(text)

    if (candidate.meta) {
      const meta = document.createElement("span")
      meta.className = "text-xs text-muted shrink-0"
      meta.textContent = candidate.meta
      row.appendChild(meta)
    }

    if (candidate.duplicate) {
      const badge = document.createElement("span")
      badge.className = "sc-import-dupe"
      badge.textContent = "Saved"
      badge.title = "This address is already in your shortcuts"
      row.appendChild(badge)
    }

    return row
  }

  function renderPasteStep(): void {
    const wrap = document.createElement("div")
    wrap.className = "flex flex-col gap-2 h-full"

    const label = document.createElement("p")
    label.className = "text-xs text-muted"
    label.textContent =
      "One address per line. Add a name with \"Name | https://example.com\" if you want something other than the site's own."
    wrap.appendChild(label)

    const area = createInput({
      multiline: true,
      placeholder: "https://example.com\nDocs | https://docs.example.com",
    }) as HTMLTextAreaElement
    area.className += " flex-1 !h-auto font-mono text-xs"
    area.rows = 14
    wrap.appendChild(area)

    const parseBtn = createButton("Continue", "primary")
    parseBtn.addEventListener("click", () => {
      const found = fromPaste(area.value)
      if (found.length === 0) {
        showToast("No usable addresses in that list.", { variant: "danger" })
        return
      }
      candidates = found
      picked = new Set(found.filter((c) => !c.duplicate).map((c) => c.id))
      render()
    })

    content.replaceChildren(wrap)
    footer.replaceChildren()
    const spacer = document.createElement("div")
    spacer.className = "flex-1"
    footer.appendChild(spacer)
    footer.appendChild(parseBtn)
  }

  // --- destination step ----------------------------------------------------

  function renderDestStep(): void {
    content.replaceChildren()
    const tabs = getTabs()

    const wrap = document.createElement("div")
    wrap.className = "flex flex-col gap-4"

    const count = picked.size
    const summary = document.createElement("p")
    summary.className = "text-sm text-foreground"
    summary.textContent = `${count} shortcut${count === 1 ? "" : "s"} ready to import.`
    wrap.appendChild(summary)

    const options: { kind: Destination["kind"]; label: string; hint: string }[] = [
      { kind: "tab", label: "An existing tab", hint: "Append to a tab you already have." },
      { kind: "new-tab", label: "A new tab", hint: "Keeps them apart from what's there." },
      { kind: "folder", label: "A new folder", hint: "One folder inside an existing tab." },
    ]

    for (const option of options) {
      const row = document.createElement("label")
      row.className = "sc-dest-option"

      const radio = document.createElement("input")
      radio.type = "radio"
      radio.name = "sc-import-dest"
      radio.className = "accent-accent shrink-0 mt-0.5"
      radio.checked = destKind === option.kind
      radio.disabled = option.kind === "new-tab" && tabs.length >= MAX_TABS
      radio.addEventListener("change", () => {
        destKind = option.kind
        renderDestStep()
        renderFooter()
      })
      row.appendChild(radio)

      const text = document.createElement("div")
      text.className = "flex flex-col gap-1 flex-1 min-w-0"

      const title = document.createElement("span")
      title.className = "text-sm text-foreground"
      title.textContent = option.label
      text.appendChild(title)

      const hint = document.createElement("span")
      hint.className = "text-xs text-muted"
      hint.textContent =
        radio.disabled ? `You already have ${MAX_TABS} tabs.` : option.hint
      text.appendChild(hint)

      if (destKind === option.kind) {
        if (option.kind === "tab" || option.kind === "folder") {
          const select = createSelect({
            options: tabs.map((t) => ({ value: t.id, label: t.name })),
            value: destTabId,
            width: "180px",
            onChange: (v) => {
              destTabId = v
            },
          })
          text.appendChild(select)
        }
        if (option.kind === "new-tab" || option.kind === "folder") {
          const nameInput = createInput({
            value: destName,
            placeholder: option.kind === "folder" ? "Folder name" : "Tab name",
          }) as HTMLInputElement
          nameInput.className += " !w-[180px]"
          nameInput.addEventListener("input", () => {
            destName = nameInput.value
          })
          text.appendChild(nameInput)
        }
      }

      row.appendChild(text)
      wrap.appendChild(row)
    }

    const hasFolders = [...picked].some((id) => {
      const c = candidates.find((x) => x.id === id)
      return c && c.path.length > 0
    })

    if (hasFolders && destKind !== "folder") {
      const keep = document.createElement("label")
      keep.className = "flex items-start gap-2 pt-1 cursor-pointer"

      const box = document.createElement("input")
      box.type = "checkbox"
      box.className = "rounded accent-accent shrink-0 mt-0.5"
      box.checked = keepFolders
      box.addEventListener("change", () => {
        keepFolders = box.checked
      })
      keep.appendChild(box)

      const text = document.createElement("div")
      text.className = "flex flex-col gap-0.5"
      const title = document.createElement("span")
      title.className = "text-sm text-foreground"
      title.textContent = "Keep the folder structure"
      text.appendChild(title)
      const hint = document.createElement("span")
      hint.className = "text-xs text-muted"
      hint.textContent =
        "Folders can't nest here, so anything deeper collapses into its top-level folder."
      text.appendChild(hint)
      keep.appendChild(text)

      wrap.appendChild(keep)
    }

    content.appendChild(wrap)
  }

  // --- footer --------------------------------------------------------------

  function renderFooter(): void {
    if (step === "pick" && source === "paste" && candidates.length === 0) return
    footer.replaceChildren()

    const status = document.createElement("span")
    status.className = "flex-1 min-w-0 text-xs text-muted truncate"
    if (step === "pick") {
      status.textContent = `${picked.size} of ${candidates.length} selected`
    }
    footer.appendChild(status)

    const cancel = createButton("Cancel", "ghost", { onClick: close })
    footer.appendChild(cancel)

    if (step === "pick") {
      const next = createButton("Continue", "primary")
      next.disabled = picked.size === 0 || busy
      if (next.disabled) next.style.opacity = "0.5"
      next.addEventListener("click", () => {
        step = "dest"
        render()
      })
      footer.appendChild(next)
      return
    }

    if (step === "dest") {
      const go = createButton(`Import ${picked.size}`, "primary")
      go.addEventListener("click", () => {
        const chosen = candidates.filter((c) => picked.has(c.id))
        const dest: Destination =
          destKind === "new-tab"
            ? { kind: "new-tab", name: destName.trim() || "Imported" }
            : destKind === "folder"
              ? { kind: "folder", tabId: destTabId, name: destName.trim() || "Imported" }
              : { kind: "tab", tabId: destTabId }

        const before = getTabs()
        const result = commitImport(chosen, dest, keepFolders)
        close()

        if (result.added === 0) {
          showToast(result.message ?? "Nothing was imported.", { variant: "danger" })
          return
        }
        showToast(
          `Imported ${result.added} shortcut${result.added === 1 ? "" : "s"}` +
            (result.message ? ` — ${result.message}` : ""),
          { action: { label: "Undo", onClick: () => save(before) } }
        )
      })
      footer.appendChild(go)
    }
  }

  function render(): void {
    renderHeader()
    if (step === "source") {
      renderSourceStep()
      footer.replaceChildren()
      const spacer = document.createElement("div")
      spacer.className = "flex-1"
      footer.appendChild(spacer)
      footer.appendChild(createButton("Cancel", "ghost", { onClick: close }))
      return
    }
    if (step === "pick") {
      renderPickStep()
      renderFooter()
      return
    }
    renderDestStep()
    renderFooter()
  }

  render()
  open()
}
