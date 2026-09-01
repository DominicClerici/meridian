import { store } from "./store"
import { getValidToken, invalidateToken } from "./google-auth"
import { MAIL_CATEGORIES } from "./defaults"
import type { MailCategory, MailCountSource } from "./defaults"

const ROOT = "https://gmail.googleapis.com/gmail/v1/users/me"

/** Headers worth asking for. Anything not listed here isn't returned at all. */
const METADATA_HEADERS = ["From", "Subject", "Date"]

/** Gmail's own name for each inbox tab. */
const CATEGORY_LABEL: Record<MailCategory, string> = {
  primary: "CATEGORY_PERSONAL",
  social: "CATEGORY_SOCIAL",
  promotions: "CATEGORY_PROMOTIONS",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
}

/** The label whose unread count each count source reports. */
const COUNT_LABEL: Record<MailCountSource, string> = {
  primary: "CATEGORY_PERSONAL",
  inbox: "INBOX",
  important: "IMPORTANT",
  starred: "STARRED",
}

/** Labels the counts row asks for: every tab, plus the three non-tab sources. */
const COUNTED_LABELS = [
  "INBOX",
  "IMPORTANT",
  "STARRED",
  ...MAIL_CATEGORIES.map((c) => CATEGORY_LABEL[c]),
]

/**
 * A failure the widget answers by showing the connect panel rather than an
 * error. Separated from a network fault because the two want different UI: one
 * has a button that fixes it, the other has a retry.
 */
export class MailAuthError extends Error {}

export type MailMessage = {
  id: string
  threadId: string
  /** The sender's display name, or their address when the header carries none. */
  from: string
  fromAddress: string
  subject: string
  snippet: string
  date: number
  unread: boolean
  starred: boolean
  important: boolean
  hasAttachment: boolean
  category: MailCategory | null
}

export type MailCounts = Record<string, number>

export type MailData = {
  messages: MailMessage[]
  counts: MailCounts
  fetchedAt: number
}


// ---------------------------------------------------------------- transport

type GmailInit = { method?: string; body?: unknown }

/**
 * One request, with the 401 retry the calendar spells out inline. A 403 is
 * never retried: it means the token is fine but was issued without the Gmail
 * scope, which only a fresh consent fixes.
 */
async function gmail<T>(path: string, init?: GmailInit, retry = true): Promise<T> {
  const token = await getValidToken("mail")
  if (!token) throw new MailAuthError("Sign in to Google to see your mail.")

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (init?.body !== undefined) headers["Content-Type"] = "application/json"

  const res = await fetch(`${ROOT}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (res.status === 401) {
    if (!retry) throw new MailAuthError("Google signed you out.")
    await invalidateToken()
    return gmail<T>(path, init, false)
  }

  if (res.status === 403) {
    const detail = await res.text().catch(() => "")
    throw new MailAuthError(
      /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(detail)
        ? "This sign-in didn't include Gmail access. Disconnect and reconnect Gmail to grant it."
        : "Google refused the request. Check that the Gmail API is enabled on your OAuth project."
    )
  }

  if (!res.ok) throw new Error(`Gmail returned ${res.status}`)
  // `modify` answers 204 with an empty body.
  if (res.status === 204) return null as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------- headers

/**
 * RFC 2047 encoded-words. Gmail hands back raw header bytes, so a sender called
 * "Álvaro" arrives as `=?UTF-8?B?w4FsdmFybw==?=` and would render as mojibake.
 */
function decodeWords(raw: string): string {
  return raw.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        let bytes: Uint8Array
        if (encoding.toUpperCase() === "B") {
          const binary = atob(text)
          bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
        } else {
          // Quoted-printable, with the "_ means space" rule encoded words add.
          const decoded = text
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            )
          bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
        }
        return new TextDecoder(charset.toLowerCase()).decode(bytes)
      } catch {
        return whole
      }
    }
  )
}

type Header = { name: string; value: string }

function headerOf(headers: Header[], name: string): string {
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found ? found.value : ""
}

function parseFrom(raw: string): { name: string; address: string } {
  const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (angled) {
    const name = decodeWords(angled[1]).replace(/^"(.*)"$/, "$1").trim()
    const address = angled[2].trim().toLowerCase()
    return { name: name || address, address }
  }
  const address = raw.trim().replace(/^<|>$/g, "").toLowerCase()
  return { name: address, address }
}

function categoryOf(labelIds: string[]): MailCategory | null {
  for (const category of MAIL_CATEGORIES) {
    if (labelIds.includes(CATEGORY_LABEL[category])) return category
  }
  return null
}

type RawMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: { mimeType?: string; headers?: Header[] }
}

function normalize(raw: RawMessage): MailMessage {
  const headers = raw.payload?.headers ?? []
  const labelIds = raw.labelIds ?? []
  const { name, address } = parseFrom(headerOf(headers, "From"))

  return {
    id: raw.id,
    threadId: raw.threadId,
    from: name,
    fromAddress: address,
    subject: decodeWords(headerOf(headers, "Subject")).trim() || "(no subject)",
    snippet: decodeHtmlEntities(raw.snippet ?? ""),
    date: Number(raw.internalDate ?? 0) || Date.parse(headerOf(headers, "Date")) || 0,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    important: labelIds.includes("IMPORTANT"),
    // `format=metadata` returns no parts, so the top-level MIME type is all
    // there is to go on. `multipart/mixed` is what an attachment produces.
    hasAttachment: raw.payload?.mimeType === "multipart/mixed",
    category: categoryOf(labelIds),
  }
}

/** Snippets arrive HTML-escaped, and `&amp;` in a preview line reads as a typo. */
function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
}

// ---------------------------------------------------------------- fetching

type ListResponse = { messages?: { id: string; threadId: string }[] }
type LabelResponse = { id: string; messagesUnread?: number; threadsUnread?: number }

/**
 * Fetches the metadata for a set of ids in parallel, the way the calendar
 * fetches its calendars. A message that fails is dropped rather than failing
 * the batch — but a batch where *every* message failed is a real fault and
 * throws, so a bad refresh can't cache an empty inbox.
 */
async function fetchMessages(ids: { id: string }[]): Promise<MailMessage[]> {
  if (ids.length === 0) return []

  const query = METADATA_HEADERS.map((h) => `metadataHeaders=${h}`).join("&")
  const settled = await Promise.allSettled(
    ids.map((m) => gmail<RawMessage>(`/messages/${m.id}?format=metadata&${query}`))
  )

  const messages: MailMessage[] = []
  let authError: MailAuthError | null = null
  for (const result of settled) {
    if (result.status === "fulfilled") messages.push(normalize(result.value))
    else if (result.reason instanceof MailAuthError) authError = result.reason
  }

  if (messages.length === 0) {
    throw authError ?? new Error("Couldn't load any messages.")
  }
  return messages.sort((a, b) => b.date - a.date)
}

/**
 * Unread counts for every label the UI can show. `labels.list` omits the counts
 * entirely — only `labels.get` carries them — so this is one small request per
 * label, all in parallel. A label the mailbox doesn't have (categories are
 * absent when inbox tabs are off) resolves to zero rather than failing.
 */
async function fetchCounts(): Promise<MailCounts> {
  const settled = await Promise.allSettled(
    COUNTED_LABELS.map((id) => gmail<LabelResponse>(`/labels/${id}`))
  )

  const counts: MailCounts = {}
  for (let i = 0; i < COUNTED_LABELS.length; i++) {
    const result = settled[i]
    counts[COUNTED_LABELS[i]] =
      result.status === "fulfilled" ? (result.value?.messagesUnread ?? 0) : 0
  }
  return counts
}

/** The signed-in address, fetched once and remembered — it deep-links every row. */
async function ensureAddress(): Promise<void> {
  if (store.local.get("mailAddress")) return
  try {
    const profile = await gmail<{ emailAddress?: string }>("/profile")
    if (profile?.emailAddress) store.local.set("mailAddress", profile.emailAddress)
  } catch {
    // Not worth failing a refresh over; rows fall back to the default account.
  }
}

/**
 * The unread inbox for one tab, plus the counts behind every tab.
 *
 * `labelIds` are ANDed, so adding a category makes this exactly "unread, in the
 * inbox, in Promotions". Fetching per tab rather than slicing one global list is
 * what keeps a chip reading 41 from opening onto three rows: the count and the
 * list are then answering the same question.
 */
export async function fetchMailData(
  limit: number,
  category: MailCategory | null
): Promise<MailData> {
  await ensureAddress()

  const labels = ["INBOX", "UNREAD"]
  if (category) labels.push(CATEGORY_LABEL[category])
  const query = labels.map((id) => `labelIds=${id}`).join("&")

  const [list, counts] = await Promise.all([
    gmail<ListResponse>(`/messages?${query}&maxResults=${limit}`),
    fetchCounts(),
  ])

  return {
    messages: await fetchMessages(list?.messages ?? []),
    counts,
    fetchedAt: Date.now(),
  }
}

/**
 * Full-mailbox search. Unlike the unread list this one *does* use `q`, which is
 * what `gmail.modify` buys over the metadata scope — the same query language
 * the Gmail search box takes.
 */
export async function searchMail(query: string, limit: number): Promise<MailMessage[]> {
  const list = await gmail<ListResponse>(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`
  )
  const ids = list?.messages ?? []
  if (ids.length === 0) return []
  return fetchMessages(ids)
}

// ---------------------------------------------------------------- actions

/** True when the change stuck. Callers render optimistically and revert on false. */
async function modify(id: string, add: string[], remove: string[]): Promise<boolean> {
  try {
    await gmail(`/messages/${id}/modify`, {
      method: "POST",
      body: { addLabelIds: add, removeLabelIds: remove },
    })
    return true
  } catch {
    return false
  }
}

export function markRead(id: string): Promise<boolean> {
  return modify(id, [], ["UNREAD"])
}

/** Archiving is exactly "drop the INBOX label" — there is no archive endpoint. */
export function archiveMessage(id: string): Promise<boolean> {
  return modify(id, [], ["INBOX"])
}

export function setStarred(id: string, starred: boolean): Promise<boolean> {
  return starred ? modify(id, ["STARRED"], []) : modify(id, [], ["STARRED"])
}

// ---------------------------------------------------------------- reading

/**
 * "Primary" is meaningless on a mailbox with inbox tabs turned off — Gmail
 * reports zero for every category while the inbox plainly is not empty, and a
 * badge reading 0 over seven unread messages is worse than no badge at all.
 * Everything that renders the count resolves the source through here first, so
 * the number and its caption can never disagree.
 */
export function effectiveCountSource(
  counts: MailCounts,
  source: MailCountSource
): MailCountSource {
  if (source === "primary" && !hasCategories(counts)) return "inbox"
  return source
}

export function countFor(counts: MailCounts, source: MailCountSource): number {
  return counts[COUNT_LABEL[effectiveCountSource(counts, source)]] ?? 0
}

/** The Gmail label behind a category, for callers adjusting counts in place. */
export function categoryLabelId(category: MailCategory): string {
  return CATEGORY_LABEL[category]
}

export function countForCategory(counts: MailCounts, category: MailCategory): number {
  return counts[CATEGORY_LABEL[category]] ?? 0
}

export function inboxUnread(counts: MailCounts): number {
  return counts.INBOX ?? 0
}

/**
 * Whether this mailbox sorts into tabs at all. With them off Gmail reports zero
 * for every category while the inbox is plainly not empty, and a row of zeroed
 * tabs would be a lie — so the body drops to a single "All" list instead.
 */
export function hasCategories(counts: MailCounts): boolean {
  return MAIL_CATEGORIES.some((c) => (counts[CATEGORY_LABEL[c]] ?? 0) > 0)
}

const MAIL_ROOT = "https://mail.google.com/mail/"

/**
 * Gmail scopes a link to a mailbox two ways: the `/u/N/` path, where N is a
 * per-browser account *index* we have no way of knowing, or the `authuser`
 * query parameter, which takes the address itself and redirects to whichever
 * index that account happens to hold. Only the second is addressable from here.
 * The fragment survives the redirect, so the target still opens.
 */
function mailUrl(hash: string): string {
  const address = store.local.get("mailAddress")
  const query = address ? `?authuser=${encodeURIComponent(address)}` : ""
  return `${MAIL_ROOT}${query}#${hash}`
}

/** `all/` rather than `inbox/`, so a thread still opens after it's archived. */
export function threadUrl(threadId: string): string {
  return mailUrl(`all/${threadId}`)
}

export function inboxUrl(): string {
  return mailUrl("inbox")
}

export function composeUrl(): string {
  return mailUrl("inbox?compose=new")
}
