import { store } from "../../store"
import { icon } from "../../icons/registry"
import { navigate } from "../../navigate"
import { isConnected, mailSnapshot, refreshMail } from "../../mail"
import { archiveMessage, markRead, searchMail, setStarred, threadUrl } from "../../gmail-api"
import type { MailMessage } from "../../gmail-api"
import { relativeTime } from "./history"
import type { Candidate, QueryContext, SearchSource } from "../types"

function candidate(message: MailMessage): Candidate {
  const url = threadUrl(message.threadId)
  return {
    id: `mail:${message.id}`,
    title: message.subject || "(no subject)",
    subtitle: message.from,
    detail: relativeTime(message.date),
    haystack: [message.fromAddress, message.snippet],
    boost: message.unread ? 0.9 : 0.4,
    icon: () =>
      icon(message.unread ? "mail" : "mailOpen", {
        size: 16,
        class: message.unread ? "" : "opacity-55",
      }),
    copyValue: url,
    run: (mode) => navigate(url, "search", mode === "newTab" ? "newTab" : "default"),
    actions: [
      { id: "open", label: "Open in Gmail", glyph: "externalLink", run: () => navigate(url, "search") },
      {
        id: "read",
        label: "Mark as read",
        glyph: "mailOpen",
        run: () => {
          markRead(message.id).then(() => refreshMail(true))
        },
      },
      {
        id: "star",
        label: message.starred ? "Unstar" : "Star",
        glyph: message.starred ? "star" : "starFilled",
        run: () => {
          setStarred(message.id, !message.starred).then(() => refreshMail(true))
        },
      },
      {
        id: "archive",
        label: "Archive",
        glyph: "archive",
        destructive: true,
        run: () => {
          archiveMessage(message.id).then(() => refreshMail(true))
        },
      },
    ],
  }
}

export const mailSource: SearchSource = {
  id: "mail",
  label: "Mail",
  token: "mail",
  glyph: "mail",
  weight: 1,
  limit: 3,
  scopedLimit: 20,
  debounce: 200,
  available: () => store.sync.get("mailEnabled") && isConnected(),
  unavailable: () => ({
    message: store.sync.get("mailEnabled")
      ? "Gmail isn't connected."
      : "The mail widget is turned off.",
  }),
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    const query = ctx.text.trim()
    if (!ctx.scoped) return query ? mailSnapshot().map(candidate) : []
    if (!query) return mailSnapshot().map(candidate)

    // Gmail's own search understands `from:`, `has:attachment` and the rest —
    // passing the query straight through is strictly better than matching
    // locally against the handful of messages the card happens to hold.
    return searchMail(query, ctx.limit)
      .then((messages) => (ctx.signal.aborted ? [] : messages.map(candidate)))
      .catch(() => mailSnapshot().map(candidate))
  },
  idle(ctx: QueryContext): Candidate[] | Promise<Candidate[]> {
    return this.query({ ...ctx, text: "" })
  },
}
