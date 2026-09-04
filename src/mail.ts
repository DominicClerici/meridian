import { store } from "./store"
import { icon } from "./icons/registry"
import { createPopover, createButton, createInput, createMenu } from "./components"
import { registerCard, refreshCard, refreshCards } from "./layout"
import { openSettings } from "./settings"
import { MAIL_CATEGORIES } from "./defaults"
import type { MailCategory } from "./defaults"
import { authenticate as googleAuthenticate, releaseGoogle } from "./google-auth"
import {
  fetchMailData,
  searchMail,
  markRead,
  archiveMessage,
  setStarred,
  countFor,
  countForCategory,
  categoryLabelId,
  effectiveCountSource,
  inboxUnread,
  hasCategories,
  threadUrl,
  inboxUrl,
  composeUrl,
  MailAuthError,
} from "./gmail-api"
import type { MailCounts, MailMessage } from "./gmail-api"

const LS_DATA = "sp:mail:data"

const COOLDOWN = 60_000
const REFRESH_INTERVAL = 300_000
const SEARCH_DEBOUNCE = 350
const SEARCH_LIMIT = 20

type State = "loading" | "loaded" | "error" | "not-connected"

/** The "All" pseudo-tab is not a category — it is the absence of one. */
type Tab = MailCategory | "all"

const CATEGORY_LABELS: Record<MailCategory, string> = {
  primary: "Primary",
  social: "Social",
  promotions: "Promotions",
  updates: "Updates",
  forums: "Forums",
}

/**
 * One entry per tab. Switching tabs renders whatever is held instantly and
 * refreshes behind it, the way the calendar serves a stale week — the click is
 * never waiting on the network.
 */
type TabCache = { messages: MailMessage[]; fetchedAt: number }

let currentState: State = "loading"
let counts: MailCounts = {}
const tabCache = new Map<Tab, TabCache>()
let errorMessage = ""
let refreshIntervalId: ReturnType<typeof setInterval> | null = null
let mailPopoverClose: (() => void) | null = null
let inFlight: Promise<void> | null = null

/**
 * A filter, not a navigation position — so unlike the calendar's `offset` it
 * deliberately survives the popover closing and reopening. Reset only when the
 * tab it points at stops existing.
 */
let activeTab: Tab = "primary"

/** Search is a mode the whole body enters, so it lives beside `activeTab`. */
let searchQuery = ""
let searchResults: MailMessage[] | null = null
let searchState: "idle" | "searching" | "error" = "idle"
let searchSeq = 0
/**
 * A newer query has been typed than the results on screen answer. Set on the
 * keystroke rather than when the debounce fires, because the whole point is
 * that the list stops claiming to be an answer the moment it stops being one.
 */
let searchPending = false
/** Where the caret was when the body was last rebuilt out from under it. */
let searchCaret = 0

type LiveBody = { root: HTMLElement; rebuild: () => void }
const liveBodies = new Set<LiveBody>()

export function isConnected(): boolean {
  return store.local.get("mailConnected")
}

// ---------------------------------------------------------------- cache

type Persisted = { counts: MailCounts; tabs: Record<string, TabCache> }

/** Hydrates the whole cache — every tab, not just the active one — so switching
    tabs on a fresh page paints from disk instead of a skeleton. */
function loadCache(): void {
  try {
    const raw = localStorage.getItem(LS_DATA)
    if (!raw) return
    const parsed = JSON.parse(raw) as Persisted
    counts = parsed.counts ?? {}
    for (const [tab, entry] of Object.entries(parsed.tabs ?? {})) {
      if (entry?.messages) tabCache.set(tab as Tab, entry)
    }
  } catch {
    // Corrupt or absent — the next fetch rebuilds it.
  }
}

function writeCache(): void {
  try {
    const tabs: Record<string, TabCache> = {}
    for (const [tab, entry] of tabCache) tabs[tab] = entry
    localStorage.setItem(LS_DATA, JSON.stringify({ counts, tabs } satisfies Persisted))
  } catch {
    // Quota or private mode — the widget still works, it just refetches.
  }
}

function clearCache(): void {
  localStorage.removeItem(LS_DATA)
  tabCache.clear()
  counts = {}
  lastAttempt.clear()
}

/**
 * Per tab, and on the last *attempt* rather than the last success — a failing
 * fetch that gated on the cached timestamp would spin error → render → refetch.
 * Keyed by tab so switching to a cold one isn't blocked by the active one's
 * cooldown.
 */
const lastAttempt = new Map<Tab, number>()

function isCooldownActive(tab: Tab): boolean {
  return Date.now() - (lastAttempt.get(tab) ?? 0) < COOLDOWN
}

/**
 * The tab actually in force. `activeTab` is what the user picked, but on a cold
 * start nothing is known about the mailbox yet — and on one with inbox tabs
 * turned off "Primary" resolves to a `CATEGORY_PERSONAL` query that matches
 * nothing, which would render as a false "Inbox zero". Everything that reads
 * the current tab goes through here so the fetch, the highlight and the empty
 * state can never disagree about which tab that is.
 */
function effectiveTab(): Tab {
  const available = tabs()
  if (available.length === 0) return "all"
  if (available.includes(activeTab)) return activeTab
  return available.includes("primary") ? "primary" : "all"
}

function currentEntry(): TabCache | undefined {
  return tabCache.get(effectiveTab())
}

function currentMessages(): MailMessage[] {
  return currentEntry()?.messages ?? []
}

// ---------------------------------------------------------------- fetching

export function refreshMail(force = false): Promise<void> {
  if (!store.sync.get("mailEnabled") || !isConnected()) return Promise.resolve()
  if (inFlight) return inFlight

  const tab = effectiveTab()
  if (!force && isCooldownActive(tab)) return Promise.resolve()

  lastAttempt.set(tab, Date.now())
  if (currentState !== "loaded") setState("loading")

  // Cleared before each `setState` rather than in a `finally`: the footer reads
  // it to choose between "Refreshing…" and a timestamp, and a finally would run
  // after the render it is meant to describe.
  inFlight = (async () => {
    try {
      const next = await fetchMailData(
        store.sync.get("mailMaxRows"),
        tab === "all" ? null : tab
      )
      counts = next.counts
      tabCache.set(tab, { messages: next.messages, fetchedAt: next.fetchedAt })
      writeCache()
      errorMessage = ""
      inFlight = null
      setState("loaded")

      // The counts that just landed are the first thing that can say whether
      // this mailbox sorts into tabs at all, so the tab we fetched may not be
      // the one now in force. Converges after one extra request: the follow-up
      // refreshes the same counts, and the resolver then agrees with itself.
      const resolved = effectiveTab()
      if (resolved !== tab && !tabCache.has(resolved)) void refreshMail()
    } catch (err: unknown) {
      inFlight = null
      if (err instanceof MailAuthError) {
        errorMessage = err.message
        markDisconnected()
        return
      }
      errorMessage = err instanceof Error ? err.message : "Couldn't reach Gmail."
      setState("error")
    }
  })()

  return inFlight
}

function markDisconnected(): void {
  store.local.set("mailConnected", false)
  clearCache()
  setState("not-connected")
}

function setState(next: State): void {
  currentState = next
  notifyDataChanged()
}

function notifyDataChanged(): void {
  renderTrigger()
  for (const body of [...liveBodies]) {
    if (body.root.isConnected) body.rebuild()
    else liveBodies.delete(body)
  }
  // Only the tile: the card's body is a live body above, and re-rendering it
  // here would rebuild the same DOM a second time.
  refreshCard("mail-summary")
}

function startRefreshInterval(): void {
  if (refreshIntervalId !== null) return
  refreshIntervalId = setInterval(() => {
    if (document.visibilityState === "visible") void refreshMail()
  }, REFRESH_INTERVAL)
}

function stopRefreshInterval(): void {
  if (refreshIntervalId === null) return
  clearInterval(refreshIntervalId)
  refreshIntervalId = null
}

// ---------------------------------------------------------------- auth

export async function authenticate() {
  // The flag is set only after consent lands. `authenticate("mail")` already
  // folds Gmail into the scope set it asks for, so flipping it early would only
  // wake the store subscriber into a fetch against a token that has no Gmail
  // scope yet — which fails, and disconnects the widget the user just connected.
  const outcome = await googleAuthenticate("mail")
  if (outcome.ok) store.local.set("mailConnected", true)
  return outcome
}

export async function disconnect(): Promise<void> {
  store.local.set("mailConnected", false)
  store.local.set("mailAddress", null)
  await releaseGoogle()
  clearCache()
}

// ---------------------------------------------------------------- helpers

/**
 * Absolute within the day, relative beyond it — the same split every mail
 * client makes, because "14:02" answers "when today" and "3d" answers "how long
 * ago" and neither answers the other.
 */
function messageTime(ts: number): string {
  if (!ts) return ""
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: !store.sync.get("clock24Hour"),
    })
  }

  const days = Math.floor((now.getTime() - ts) / 86_400_000)
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" })
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
}

function relativeTime(ts: number): string {
  if (!ts) return ""
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function openUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

/** A stable hue per sender, so the same correspondent keeps the same chip
    colour between sessions and the list gains a second thing to scan by. */
function senderHue(address: string): number {
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

function initialOf(message: MailMessage): string {
  const source = message.from.trim() || message.fromAddress
  const letter = source.match(/\p{L}|\p{N}/u)
  return letter ? letter[0].toUpperCase() : "?"
}

/** Tabs the user enabled, dropped entirely when the mailbox has no categories. */
function tabs(): Tab[] {
  const chosen = store.sync.get("mailCategories")
  const categories = MAIL_CATEGORIES.filter((c) => chosen.includes(c))
  if (categories.length === 0 || !hasCategories(counts)) return []
  return ["all", ...categories]
}

/** No filtering: each tab holds exactly what was fetched for it. */
function visibleMessages(): MailMessage[] {
  return searchResults ?? currentMessages()
}

function countForTab(tab: Tab): number {
  return tab === "all" ? inboxUnread(counts) : countForCategory(counts, tab)
}

/**
 * Applies a local edit across every tab holding the message, not just the
 * visible one — archiving from All must not leave a ghost row in Promotions.
 * The fetch timestamps are untouched: an edit is not a refresh.
 */
function editMessage(id: string, edit: (m: MailMessage) => MailMessage | null): void {
  for (const [tab, entry] of tabCache) {
    const next: MailMessage[] = []
    let changed = false
    for (const message of entry.messages) {
      if (message.id !== id) {
        next.push(message)
        continue
      }
      changed = true
      const replacement = edit(message)
      if (replacement) next.push(replacement)
    }
    if (changed) tabCache.set(tab, { ...entry, messages: next })
  }
  if (searchResults) {
    const next: MailMessage[] = []
    for (const message of searchResults) {
      if (message.id !== id) {
        next.push(message)
        continue
      }
      const replacement = edit(message)
      if (replacement) next.push(replacement)
    }
    searchResults = next
  }
  writeCache()
}

function removeMessage(id: string): void {
  editMessage(id, () => null)
}

function patchMessage(id: string, patch: Partial<MailMessage>): void {
  editMessage(id, (m) => ({ ...m, ...patch }))
}

/** An unread count one lower, so the tab chips and the badge move with the row
    rather than waiting for the next refresh to catch up. */
function decrementCounts(message: MailMessage): void {
  const next = { ...counts }
  const bump = (key: string) => {
    if (next[key]) next[key] = Math.max(0, next[key] - 1)
  }
  bump("INBOX")
  if (message.important) bump("IMPORTANT")
  if (message.starred) bump("STARRED")
  if (message.category) bump(categoryLabelId(message.category))
  counts = next
}

// ---------------------------------------------------------------- rows

function actionButton(
  name: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button")
  button.className =
    "p-1 rounded-[5px] text-popover-foreground/45 hover:text-popover-foreground/90 hover:bg-popover-foreground/[0.10] transition-colors disabled:opacity-40"
  button.title = label
  button.setAttribute("aria-label", label)
  button.appendChild(icon(name, { size: 14 }))
  button.addEventListener("click", (e) => {
    // Every row is a link; without this the action also navigates to Gmail.
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return button
}

function buildRow(message: MailMessage, onChange: () => void): HTMLElement {
  const row = document.createElement("a")
  row.href = threadUrl(message.threadId)
  row.target = "_blank"
  row.rel = "noopener noreferrer"
  row.dataset.mailRow = ""
  row.className =
    "group relative flex items-start gap-2.5 px-1.5 py-2 -mx-1.5 rounded-theme transition-colors hover:bg-popover-foreground/[0.06] focus-visible:bg-popover-foreground/[0.06] outline-none"

  // Read and unread are told apart by weight and colour alone. A dot said the
  // same thing a third time, and charged the whole list an indent for it.
  const avatar = document.createElement("span")
  avatar.className =
    "w-6 h-6 rounded-full shrink-0 mt-px flex items-center justify-center text-[11px] font-semibold"
  const hue = senderHue(message.fromAddress)
  avatar.style.backgroundColor = `oklch(0.62 0.13 ${hue} / 0.28)`
  avatar.style.color = `oklch(0.86 0.09 ${hue})`
  if (!message.unread) avatar.style.filter = "grayscale(50%)"
  avatar.textContent = initialOf(message)
  avatar.title = message.fromAddress
  row.appendChild(avatar)

  const main = document.createElement("span")
  main.className = "flex-1 min-w-0 flex flex-col gap-0.5"

  const senderLine = document.createElement("span")
  senderLine.className = "flex items-center gap-1.5 min-w-0"

  // A read row drops to the preview line's own colour, top to bottom: nothing
  // in it is worth a second glance, so nothing in it outranks the preview.
  const sender = document.createElement("span")
  sender.className = `truncate min-w-0 text-[13px] leading-snug ${
    message.unread ? "font-semibold text-popover-foreground/90" : "text-popover-foreground/35"
  }`
  sender.textContent = message.from
  senderLine.appendChild(sender)

  if (message.starred) {
    senderLine.appendChild(icon("starFilled", { size: 11, class: "shrink-0 text-warning/80" }))
  }
  if (message.hasAttachment) {
    senderLine.appendChild(
      icon("paperclip", { size: 11, class: "shrink-0 text-popover-foreground/30" })
    )
  }
  main.appendChild(senderLine)

  const subject = document.createElement("span")
  subject.className = `truncate min-w-0 text-[12.5px] leading-snug ${
    message.unread ? "text-popover-foreground/75" : "text-popover-foreground/35"
  }`
  subject.textContent = message.subject
  main.appendChild(subject)

  if (store.sync.get("mailShowSnippets") && message.snippet) {
    const snippet = document.createElement("span")
    snippet.className = "truncate min-w-0 text-[11px] leading-snug text-popover-foreground/35"
    snippet.textContent = message.snippet
    main.appendChild(snippet)
  }

  row.appendChild(main)

  // The time and the action rail share one slot, the way Gmail's own list does:
  // overlaying them would put buttons on top of a timestamp, and giving them
  // separate slots would leave a permanent gap for controls nobody can see.
  const trailing = document.createElement("span")
  trailing.className = "relative shrink-0 flex items-start pt-0.5"

  const time = document.createElement("span")
  time.className =
    "text-[11px] tabular-nums text-popover-foreground/35 group-hover:opacity-0 transition-opacity"
  time.textContent = messageTime(message.date)
  trailing.appendChild(time)

  const actions = document.createElement("span")
  actions.className =
    "absolute -top-0.5 right-0 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity"

  if (message.unread) {
    actions.appendChild(
      actionButton("mailOpen", "Mark as read", () => markReadAction(message))
    )
  }

  actions.appendChild(
    actionButton("archive", "Archive", () =>
      optimisticRemove(message, () => archiveMessage(message.id))
    )
  )

  actions.appendChild(
    actionButton(message.starred ? "starFilled" : "star", message.starred ? "Unstar" : "Star", () => {
      const next = !message.starred
      patchMessage(message.id, { starred: next })
      notifyDataChanged()
      void setStarred(message.id, next).then((ok) => {
        if (ok) return
        patchMessage(message.id, { starred: !next })
        notifyDataChanged()
      })
    })
  )

  actions.appendChild(
    actionButton("externalLink", "Open in Gmail", () => openUrl(threadUrl(message.threadId)))
  )

  trailing.appendChild(actions)
  row.appendChild(trailing)
  return row
}

/**
 * The row goes now and the network catches up. A failed call refetches rather
 * than splicing the row back: the list may have moved on underneath, and the
 * server's answer is the only honest thing to restore.
 */
function optimisticRemove(message: MailMessage, run: () => Promise<boolean>): void {
  removeMessage(message.id)
  if (message.unread) decrementCounts(message)
  notifyDataChanged()
  void run().then((ok) => {
    if (!ok) void refreshMail(true)
  })
}

/**
 * In the unread list, marking read is what makes a row stop belonging — so it
 * leaves. In search results the row is there because it matched the query, not
 * because it was unread, so only the dot clears.
 */
function markReadAction(message: MailMessage): void {
  if (!searchResults) {
    optimisticRemove(message, () => markRead(message.id))
    return
  }
  patchMessage(message.id, { unread: false })
  decrementCounts(message)
  notifyDataChanged()
  void markRead(message.id).then((ok) => {
    if (!ok) void refreshMail(true)
  })
}

// ---------------------------------------------------------------- header

function inboxLabel(tab: Tab): string {
  return tab === "all" ? "All" : CATEGORY_LABELS[tab]
}

function countBadge(count: number, muted: boolean): HTMLElement | null {
  if (count <= 0) return null
  const badge = document.createElement("span")
  badge.className = `tabular-nums text-[10px] ${
    muted ? "text-popover-foreground/30" : "text-popover-foreground/45"
  }`
  badge.textContent = count > 99 ? "99+" : String(count)
  return badge
}

/** Keeps an unselected item's label on the same left edge as the selected one's. */
function glyphSpacer(size: number): HTMLElement {
  const span = document.createElement("span")
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  return span
}

/**
 * A strip put every inbox on screen at once, which is what a row with nothing
 * else on it can afford. The row also has to hold search, so the set moves into
 * a menu and the row keeps only the answer — which inbox is in force.
 */
function buildInboxPicker(onChange: () => void): HTMLElement {
  const available = tabs()
  const current = effectiveTab()

  // A mailbox with inbox tabs turned off has one list and nothing to pick
  // between; a disabled-looking control would only invite a click that can't
  // go anywhere.
  if (available.length === 0) {
    const label = document.createElement("span")
    label.className = "min-w-0 truncate text-[12.5px] font-medium text-popover-foreground/70"
    label.textContent = "Inbox"
    return label
  }

  const button = document.createElement("button")
  button.className =
    "flex items-center gap-1 min-w-0 -ml-1.5 px-1.5 py-1 rounded-theme text-popover-foreground/75 hover:text-popover-foreground hover:bg-popover-foreground/[0.08] transition-colors"
  button.title = "Switch inbox"

  const label = document.createElement("span")
  label.className = "truncate min-w-0 text-[12.5px] font-medium"
  label.textContent = inboxLabel(current)
  button.appendChild(label)

  const badge = countBadge(countForTab(current), false)
  if (badge) button.appendChild(badge)

  button.appendChild(icon("chevronDown", { size: 12, class: "shrink-0 opacity-50" }))

  button.addEventListener("click", (e) => {
    e.stopPropagation()
    createMenu(
      button,
      available.map((tab) => ({
        label: inboxLabel(tab),
        icon:
          tab === current ? icon("check", { size: 13, class: "text-accent" }) : glyphSpacer(13),
        trailing: countBadge(countForTab(tab), true) ?? undefined,
        onClick: () => {
          if (tab === current) return
          activeTab = tab
          // Render first, ask second: the cached list for this tab paints now
          // and the refresh lands underneath it.
          onChange()
          void refreshMail()
        },
      }))
    )
  })

  return button
}

function buildHeader(onChange: () => void, searching: boolean): HTMLElement {
  const header = document.createElement("div")
  header.className =
    "flex items-center gap-1 pb-2 mb-1 border-b border-popover-foreground/[0.07] shrink-0"

  if (searching) {
    const field = createInput({
      placeholder: "Search all mail…",
      tone: "popover",
      className: "flex-1 min-w-0",
    }) as HTMLInputElement
    // Padding and font size are base utilities on the component; only an inline
    // style beats them. See `docs/components.md`.
    field.style.paddingBlock = "4px"
    field.style.fontSize = "12.5px"
    field.value = searchQuery

    let timer: ReturnType<typeof setTimeout> | null = null

    const ask = (query: string): void => {
      if (timer) clearTimeout(timer)
      timer = null
      void runSearch(query)
    }

    field.addEventListener("input", () => {
      searchQuery = field.value
      searchCaret = field.selectionStart ?? field.value.length
      if (timer) clearTimeout(timer)

      // An empty field asks the server nothing, so there is no answer to wait
      // for and no reason to sit on the debounce.
      if (!searchQuery.trim()) {
        searchPending = false
        ask("")
        return
      }

      // On the keystroke, not on the debounce: what is on screen answers the
      // previous query, and it stops being an answer the moment this one lands.
      searchPending = true
      paintSearchPending()
      timer = setTimeout(() => ask(searchQuery), SEARCH_DEBOUNCE)
    })
    field.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        exitSearch(onChange)
      }
      if (e.key === "Enter") ask(searchQuery)
    })

    header.appendChild(field)

    const cancel = document.createElement("button")
    cancel.className =
      "shrink-0 p-1 rounded-[5px] text-popover-foreground/40 hover:text-popover-foreground/80 transition-colors"
    cancel.title = "Close search"
    cancel.appendChild(icon("close", { size: 13 }))
    cancel.addEventListener("click", () => exitSearch(onChange))
    header.appendChild(cancel)

    // Results landing rebuilds the body, which replaces this element. Opening
    // search is an intent to type, so focus and caret are restored rather than
    // lost mid-word to an answer arriving.
    queueMicrotask(() => {
      if (!field.isConnected || document.activeElement === field) return
      field.focus()
      const at = Math.min(searchCaret, field.value.length)
      field.setSelectionRange(at, at)
    })
  } else {
    header.appendChild(buildInboxPicker(onChange))

    const search = document.createElement("button")
    search.className =
      "shrink-0 ml-auto p-1 rounded-[5px] text-popover-foreground/40 hover:text-popover-foreground/80 hover:bg-popover-foreground/[0.08] transition-colors"
    search.title = "Search all mail"
    search.appendChild(icon("search", { size: 14 }))
    search.addEventListener("click", () => {
      searchResults = []
      searchState = "idle"
      searchPending = false
      onChange()
    })
    header.appendChild(search)
  }

  return header
}

function exitSearch(onChange: () => void): void {
  searchQuery = ""
  searchResults = null
  searchState = "idle"
  searchPending = false
  searchCaret = 0
  // Bumping the sequence orphans any answer still in flight, so a slow search
  // can't repopulate a list the user just dismissed.
  searchSeq++
  onChange()
}

/**
 * Sequenced rather than cancelled: a debounced search can have two requests in
 * flight, and the slower one must not overwrite the newer answer.
 */
async function runSearch(query: string): Promise<void> {
  const trimmed = query.trim()
  const seq = ++searchSeq

  if (!trimmed) {
    searchResults = []
    searchState = "idle"
    searchPending = false
    notifyDataChanged()
    return
  }

  // Deliberately no full redraw here: a rebuild mid-debounce would replace the
  // field the user is still typing into. The list was already put into its
  // pending look on the keystroke; the one redraw comes with the answer.
  searchState = "searching"

  try {
    const results = await searchMail(trimmed, SEARCH_LIMIT)
    if (seq !== searchSeq) return
    searchResults = results
    searchState = "idle"
  } catch (err) {
    if (seq !== searchSeq) return
    searchResults = []
    searchState = "error"
    if (err instanceof MailAuthError) markDisconnected()
  }
  searchPending = false
  notifyDataChanged()
}

// ------------------------------------------------------- pending search

/**
 * Results that no longer answer the query in the box. They stay — replacing
 * them with a spinner would throw away the only thing on screen worth looking
 * at — but they stop being clickable, since acting on a stale row is the one
 * mistake this state exists to prevent.
 */
function fadeList(list: HTMLElement): void {
  list.style.opacity = "0.5"
  list.style.pointerEvents = "none"
}

/**
 * The immediate half of a search, applied without a rebuild — a rebuild would
 * replace the input the keystroke came from. A list of results fades; a status
 * view has nothing to keep, so it swaps for the next one outright.
 */
function paintSearchPending(): void {
  for (const body of [...liveBodies]) {
    if (!body.root.isConnected) {
      liveBodies.delete(body)
      continue
    }
    const list = body.root.querySelector<HTMLElement>("[data-mail-list]")
    if (!list) continue
    if (list.querySelector("[data-mail-row]")) fadeList(list)
    else list.replaceChildren(buildSearchState())
  }
}

// ---------------------------------------------------------------- states

type SearchStatus = "prompt" | "searching" | "no-matches" | "error"

const SEARCH_COPY: Record<SearchStatus, { heading: string; sub: string }> = {
  prompt: {
    heading: "Search your mail",
    sub: "Type to search every message, not just what's unread.",
  },
  searching: {
    heading: "Searching…",
    sub: "Looking through every message in your mailbox.",
  },
  "no-matches": {
    heading: "No matches",
    sub: "Gmail's search operators work here — from:, has:attachment, older_than:7d.",
  },
  error: {
    heading: "Search failed",
    sub: "Gmail didn't answer that one. Try it again.",
  },
}

/**
 * `searchPending` outranks `searchState` because it is set a debounce earlier:
 * the view has to say "searching" from the keystroke, not from the request.
 */
function searchStatus(): SearchStatus {
  if (!searchQuery.trim()) return "prompt"
  if (searchPending || searchState === "searching") return "searching"
  if (searchState === "error") return "error"
  return "no-matches"
}

function buildSearchState(): HTMLElement {
  const kind = searchStatus()
  const wrap = document.createElement("div")
  wrap.className = "flex flex-1 flex-col items-center justify-center gap-2 px-4 py-7 text-center"

  wrap.appendChild(
    kind === "searching"
      ? icon("spinner", { size: 22, class: "text-popover-foreground/30" })
      : kind === "error"
        ? icon("alertTriangle", { size: 22, class: "text-warning/70" })
        : icon("search", { size: 24, class: "text-popover-foreground/15" })
  )

  const copy = SEARCH_COPY[kind]

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/60"
  heading.textContent = copy.heading
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[250px] text-[11px] leading-relaxed text-popover-foreground/35"
  sub.textContent = copy.sub
  wrap.appendChild(sub)

  return wrap
}

function buildInboxZero(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-1 flex-col items-center justify-center gap-2 px-4 py-7 text-center"

  wrap.appendChild(icon("mailOpen", { size: 26, class: "text-popover-foreground/15" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/60"
  heading.textContent = "Inbox zero"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[250px] text-[11px] leading-relaxed text-popover-foreground/35"
  const tab = effectiveTab()
  const scope = tab === "all" ? "your inbox" : CATEGORY_LABELS[tab]
  sub.textContent = `Nothing unread in ${scope}.`
  wrap.appendChild(sub)

  return wrap
}

function buildError(onChange: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center"
  wrap.appendChild(icon("alertTriangle", { size: 22, class: "text-warning/70" }))

  const message = document.createElement("p")
  message.className = "max-w-[260px] text-[12px] leading-relaxed text-popover-foreground/55"
  message.textContent = errorMessage || "Couldn't reach Gmail."
  wrap.appendChild(message)

  wrap.appendChild(
    createButton("Try again", "outline", {
      tone: "popover",
      onClick: () => {
        void refreshMail(true)
        onChange()
      },
    })
  )
  return wrap
}

function buildSkeleton(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col flex-1 min-h-0 gap-3 py-1 overflow-hidden"
  wrap.dataset.loading = "true"
  for (let i = 0; i < 4; i++) {
    const row = document.createElement("div")
    row.className = "flex items-start gap-2.5"

    const dot = document.createElement("span")
    dot.className = "w-6 h-6 rounded-full bg-popover-foreground/[0.07] shrink-0 animate-pulse"

    const lines = document.createElement("span")
    lines.className = "flex-1 flex flex-col gap-1.5"
    const a = document.createElement("span")
    a.className = "h-2.5 rounded bg-popover-foreground/[0.07] animate-pulse"
    a.style.width = `${45 - i * 6}%`
    const b = document.createElement("span")
    b.className = "h-2.5 rounded bg-popover-foreground/[0.05] animate-pulse"
    b.style.width = `${80 - i * 9}%`
    lines.append(a, b)

    row.append(dot, lines)
    wrap.appendChild(row)
  }
  return wrap
}

function buildConnectPanel(onChange: () => void): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className =
    "flex flex-1 flex-col items-center justify-center gap-2.5 px-4 py-6 text-center"

  wrap.appendChild(icon("mail", { size: 30, class: "text-popover-foreground/25" }))

  const heading = document.createElement("p")
  heading.className = "text-[13px] font-medium text-popover-foreground/70"
  heading.textContent = "Connect Gmail"
  wrap.appendChild(heading)

  const sub = document.createElement("p")
  sub.className = "max-w-[265px] text-[11px] leading-relaxed text-popover-foreground/40"
  sub.textContent = store.local.get("calendarConnected")
    ? "Uses the Google account your calendar is already signed in to — it just needs mail permission added."
    : "Read, triage and search your inbox without leaving this tab."
  wrap.appendChild(sub)

  const status = document.createElement("p")
  status.className = "max-w-[270px] text-[11px] leading-relaxed text-warning/80"
  // An auth failure drops the widget back to this panel, and the reason is the
  // most useful thing on screen — "the Gmail API isn't enabled on your project"
  // is not something the user can work out from a Connect button.
  status.hidden = !errorMessage
  status.textContent = errorMessage

  const connect = createButton("Connect Gmail", "primary", {
    tone: "popover",
    icon: icon("mail", { size: 15 }),
    onClick: async () => {
      connect.disabled = true
      status.hidden = true
      errorMessage = ""

      const result = await authenticate()

      connect.disabled = false
      if (result.ok) {
        void refreshMail(true)
        onChange()
        return
      }

      status.hidden = false
      status.textContent = result.error
      if (result.needsClientId) {
        const link = document.createElement("button")
        link.className = "underline text-accent ml-1"
        link.textContent = "Open Advanced settings"
        link.addEventListener("click", () => openSettings("advanced"))
        status.appendChild(link)
      }
      onChange()
    },
  })
  wrap.appendChild(connect)
  wrap.appendChild(status)

  return wrap
}

// ---------------------------------------------------------------- footer

function buildFooter(onChange: () => void): HTMLElement {
  const footer = document.createElement("div")
  footer.className =
    "flex items-center gap-2 pt-2.5 mt-1 border-t border-popover-foreground/[0.07] text-[11px] text-popover-foreground/35 shrink-0"

  const stamp = document.createElement("span")
  stamp.className = "flex-1 min-w-0 truncate"
  const last = currentEntry()?.fetchedAt ?? 0
  const address = store.local.get("mailAddress")
  stamp.textContent = inFlight
    ? "Refreshing…"
    : address
      ? address
      : !last
        ? ""
        : `Updated ${relativeTime(last)} ago`
  if (address && last) stamp.title = `Updated ${relativeTime(last)} ago`
  footer.appendChild(stamp)

  const compose = document.createElement("button")
  compose.className = "shrink-0 hover:text-popover-foreground/70 transition-colors"
  compose.title = "Compose"
  compose.appendChild(icon("compose", { size: 13 }))
  compose.addEventListener("click", () => openUrl(composeUrl()))
  footer.appendChild(compose)

  const open = document.createElement("button")
  open.className = "shrink-0 hover:text-popover-foreground/70 transition-colors"
  open.title = "Open Gmail"
  open.appendChild(icon("externalLink", { size: 13 }))
  open.addEventListener("click", () => openUrl(inboxUrl()))
  footer.appendChild(open)

  const refresh = document.createElement("button")
  refresh.className =
    "shrink-0 hover:text-popover-foreground/70 transition-colors disabled:opacity-40"
  refresh.title = "Refresh"
  refresh.disabled = inFlight !== null
  refresh.appendChild(icon("refresh", { size: 13 }))
  refresh.addEventListener("click", () => {
    void refreshMail(true)
    onChange()
  })
  footer.appendChild(refresh)

  return footer
}

// ---------------------------------------------------------------- body

export function buildMailBody(): { el: HTMLElement; rebuild: () => void; dispose: () => void } {
  const root = document.createElement("div")
  // Fixed, not capped. Opening search swaps the header and can empty the list,
  // and a widget that resizes under the click that opened it is the one thing
  // a search field must not do.
  root.className = "flex flex-col min-w-0 h-[410px]"

  function rebuild(): void {
    root.replaceChildren()

    if (!isConnected()) {
      root.appendChild(buildConnectPanel(rebuild))
      return
    }
    // A tab with no entry at all has never been fetched, and "Inbox zero" would
    // be a claim we can't make — a fetch that came back empty leaves an entry
    // with no messages, which is a different thing. A tab that *does* hold a
    // list paints it and refreshes underneath, so switching never flashes.
    if (!currentEntry() && !searchResults && currentState !== "error") {
      root.appendChild(buildHeader(rebuild, false))
      root.appendChild(buildSkeleton())
      return
    }

    const searching = searchResults !== null
    root.appendChild(buildHeader(rebuild, searching))

    // Only the list scrolls. Burying the footer under twelve rows means the
    // controls the widget has are the ones nobody finds.
    const list = document.createElement("div")
    list.dataset.mailList = ""
    // duration-75: long enough to read as a change, short enough not to sit
    // between the user and their next keystroke.
    list.className =
      "flex flex-col flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden transition-opacity duration-75"

    if (currentState === "error" && !searching) {
      list.appendChild(buildError(rebuild))
    } else {
      const messages = visibleMessages()
      if (messages.length === 0) {
        list.appendChild(searching ? buildSearchState() : buildInboxZero())
      } else {
        for (const message of messages) list.appendChild(buildRow(message, rebuild))
        // A rebuild can land mid-debounce — an optimistic action, a background
        // refresh — and must not hand the stale rows their clicks back.
        if (searching && searchPending) fadeList(list)
      }
    }
    root.appendChild(list)

    if (currentState !== "error") root.appendChild(buildFooter(rebuild))
  }

  rebuild()

  const entry: LiveBody = { root, rebuild }
  liveBodies.add(entry)

  return {
    el: root,
    rebuild,
    dispose: () => {
      liveBodies.delete(entry)
    },
  }
}

/**
 * The Dashboard tile: the count, and who the newest one is from. At 118px a row
 * cannot say anything useful, but "7 unread, newest from Stripe" reads from
 * across the room and is the reason to click through.
 */
export function buildMailTile(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "flex flex-col gap-0.5 min-w-0"

  const source = effectiveCountSource(counts, store.sync.get("mailCountSource"))
  const count = countFor(counts, source)

  const value = document.createElement("span")
  value.className = `text-[26px] leading-none font-semibold tabular-nums ${
    count ? "text-popover-foreground/90" : "text-popover-foreground/25"
  }`
  value.textContent = count > 999 ? "999+" : String(count)
  wrap.appendChild(value)

  const caption = document.createElement("span")
  caption.className = "text-[10px] uppercase tracking-[0.08em] text-popover-foreground/35 truncate"
  caption.textContent = {
    primary: "unread · primary",
    inbox: "unread · inbox",
    important: "unread · important",
    starred: "unread · starred",
  }[source]
  wrap.appendChild(caption)

  const newest = currentMessages()[0]
  if (newest) {
    const from = document.createElement("span")
    from.className = "text-[11px] text-popover-foreground/45 truncate"
    from.textContent = `from ${newest.from}`
    from.title = newest.subject
    wrap.appendChild(from)
  }

  return wrap
}

// ---------------------------------------------------------------- trigger

function renderTrigger(): void {
  const trigger = document.getElementById("mail-trigger") as HTMLButtonElement | null
  if (!trigger) return

  if (!store.sync.get("mailEnabled")) {
    trigger.hidden = true
    closeMailPopover()
    return
  }
  trigger.hidden = false

  const badge = document.getElementById("mail-badge") as HTMLElement | null
  if (!badge) return

  const count =
    isConnected() && currentState === "loaded"
      ? countFor(counts, store.sync.get("mailCountSource"))
      : 0
  badge.hidden = count === 0
  badge.textContent = count > 99 ? "99+" : String(count)
  trigger.title = isConnected()
    ? `${count} unread message${count === 1 ? "" : "s"}`
    : "Connect Gmail"
}

function closeMailPopover(): void {
  mailPopoverClose?.()
  mailPopoverClose = null
}

function showMailPopover(anchor: HTMLElement): void {
  closeMailPopover()

  const body = buildMailBody()
  body.el.style.width = "420px"
  void refreshMail()

  const { close } = createPopover(anchor, body.el, {
    onClose: () => {
      mailPopoverClose = null
      body.dispose()
    },
  })
  mailPopoverClose = close
}

// ---------------------------------------------------------------- cards

let cardBody: ReturnType<typeof buildMailBody> | null = null

registerCard({
  id: "mail",
  title: "Mail",
  order: 50,
  regions: { default: "grid", dashboard: "side" },
  enabledKey: "mailEnabled",
  render: () => {
    cardBody = buildMailBody()
    void refreshMail()
    return cardBody.el
  },
  onUnmount: () => {
    cardBody?.dispose()
    cardBody = null
  },
})

registerCard({
  id: "mail-summary",
  title: "Mail",
  order: 50,
  regions: { dashboard: "top" },
  enabledKey: "mailEnabled",
  // The tile has no way to connect, so it stays out of the row until there is
  // something to count. The side card is where a new user signs in.
  isEnabled: () => isConnected(),
  render: buildMailTile,
  renderTile: buildMailTile,
  tileTitle: () => "Mail",
})

// ---------------------------------------------------------------- init

/** Every message any category tab has pulled down, newest first and deduped. */
export function mailSnapshot(): MailMessage[] {
  const seen = new Set<string>()
  const out: MailMessage[] = []
  for (const entry of tabCache.values()) {
    for (const message of entry.messages) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      out.push(message)
    }
  }
  return out.sort((a, b) => b.date - a.date)
}

export function initMail(): void {
  const trigger = document.getElementById("mail-trigger") as HTMLButtonElement | null

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation()
    if (mailPopoverClose) closeMailPopover()
    else showMailPopover(trigger)
  })

  // A new tab is the common case, but a long-lived one coming back into focus
  // is the case the 5-minute interval handles badly.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && store.sync.get("mailEnabled") && isConnected()) {
      void refreshMail()
    }
  })

  store.sync.subscribe("mailEnabled", (enabled) => {
    if (enabled && isConnected()) {
      void refreshMail()
      startRefreshInterval()
    } else {
      closeMailPopover()
      stopRefreshInterval()
    }
    renderTrigger()
  })

  store.local.subscribe("mailConnected", (connected) => {
    refreshCards()
    if (connected && store.sync.get("mailEnabled")) {
      currentState = "loading"
      void refreshMail(true)
      startRefreshInterval()
    } else {
      stopRefreshInterval()
      clearCache()
      currentState = "not-connected"
      notifyDataChanged()
    }
  })

  // Presentation only — no refetch, the data already answers these.
  for (const key of ["mailCategories", "mailShowSnippets"] as const) {
    store.sync.subscribe(key, () => notifyDataChanged())
  }
  store.sync.subscribe("mailCountSource", () => notifyDataChanged())
  // This one changes the request itself, and every tab's list is now the wrong
  // length — drop them all rather than leaving inactive tabs at the old count.
  store.sync.subscribe("mailMaxRows", () => {
    tabCache.clear()
    lastAttempt.clear()
    void refreshMail(true)
  })

  if (!store.sync.get("mailEnabled")) {
    renderTrigger()
    return
  }
  if (!isConnected()) {
    currentState = "not-connected"
    renderTrigger()
    return
  }

  loadCache()
  if (tabCache.size > 0) currentState = "loaded"
  renderTrigger()
  void refreshMail()
  startRefreshInterval()
}
