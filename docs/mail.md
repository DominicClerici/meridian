# Mail

**Files:** `src/mail.ts` (1330 lines), `src/gmail-api.ts` (409 lines), `src/google-auth.ts` (418 lines). **Trigger:** `#mail-trigger`. **API:** Gmail v1. **Auth:** the shared Google account — see [browser-compat.md](browser-compat.md#google-sign-in).

An unread inbox with triage in place: mark read, archive and star without leaving the tab. Follows the trigger/popover pattern in [widgets.md](widgets.md), with the same four states as the calendar and GitHub — `loading` · `loaded` · `error` · `not-connected`.

## The shared Google account

Calendar and Mail sign in **once between them**, to one token. What changed in `google-auth.ts` to make that work is a scope registry:

```ts
const FEATURE_SCOPES: Record<GoogleFeature, readonly string[]> = {
  calendar: ["…/auth/calendar.readonly"],
  mail: ["…/auth/gmail.modify"],
}
```

Every token is issued for `scopeSetFor(feature)` — the union of the **connected** features' scopes plus the one being connected — never for everything the map knows about. That is the whole point of the map: connecting only the calendar must never put Gmail on the consent screen. `connectedFeatures()` reads that set back off `calendarConnected` and `mailConnected`.

Three things follow from one token serving two features:

- **`authenticate(feature)`** requests the union. When mail is added to an account that already has calendar, `include_granted_scopes` (web) and the `scopes` override (native) both make it an *incremental* consent: one prompt, and calendar keeps working on the new token.
- **`getValidToken(feature)`** checks `hasScopesFor(feature)` as well as the expiry. A live token issued before this feature was connected is treated as needing renewal, not as valid — otherwise mail would fire a request with a calendar-only token and take a 403 for it.
- **`releaseGoogle()`** revokes **only when nothing is left**. Callers clear their own connected flag first and this reads it back; disconnecting mail while the calendar is connected therefore signs nothing out. Only the last feature to leave actually hits Google's revoke endpoint.

`googleGrantedScopes` is what the token *says* it carries, taken from Google's own response — the `scope` field of the redirect fragment, or `grantedScopes` from the native broker. It exists because "not connected" and "connected, but this permission was never granted" are different problems with different fixes, and nothing else distinguishes them.

**`verifyGrant()` is the backstop.** A stripped Chromium's broker can ignore the `scopes` override and hand back the manifest's calendar-only token while reporting success. Checking `hasScopesFor()` *after* a successful sign-in catches that and says so, instead of leaving the widget to fail later with a 403 nobody can act on.

### Why `gmail.modify`

`gmail.metadata` is the smaller scope, and it is genuinely crippled for this: it rejects the `q` parameter outright (no search of any kind — only `labelIds` filtering) and returns no snippet. `gmail.modify` buys the preview line, full Gmail search, and the three write actions.

It costs nothing extra in review terms. `gmail.metadata`, `gmail.readonly` and `gmail.modify` are **all** Google "restricted" scopes, subject to the same verification requirements. The choice between them is capability and consent wording, not review burden.

**Forking this needs your own Google OAuth client** with both the Calendar API and the Gmail API enabled on the project — the shipped `client_id` is bound to this extension's ID.

## Fetching

Everything goes through `gmail<T>(path, init)` in `gmail-api.ts`, which carries the auth, the 401 retry and the error taxonomy:

| Status | Meaning | Response |
|---|---|---|
| 401 | Token expired or withdrawn | `invalidateToken()`, then **one** retry with a fresh token |
| 403 | Token valid, permission absent | `MailAuthError` — never retried, since only a fresh consent fixes it. The message distinguishes a missing scope from a Gmail API that was never enabled on the project |
| other | Network or service fault | Plain `Error` → the `error` state, with a Retry |

`MailAuthError` exists so the widget can tell a fault that needs a **retry** from one that needs a **button**: the former renders the error panel, the latter drops to the connect panel, which shows the reason it is there rather than discarding it.

### One request per tab, not one global slice

`fetchMailData(limit, category)` builds a `labelIds` query, and Gmail ANDs them:

```
/messages?labelIds=INBOX&labelIds=UNREAD&labelIds=CATEGORY_PROMOTIONS
```

The list is fetched **for the tab being shown**, rather than fetching one global unread list and filtering it per tab. That is not an optimisation — it is what stops a picker reading `Promotions 41` from opening onto three rows. The counts come from the whole mailbox and the list from one query; only if they ask the same question can they agree.

Message metadata is then fetched **in parallel, one request per message**, exactly as the calendar fetches one request per calendar. A message that fails is dropped rather than failing the batch; a batch where *every* message failed throws, so a bad refresh can't cache an empty inbox.

### Counts

`users.labels.list` does **not** return counts — only `users.labels.get` carries `messagesUnread`. So the counts row is one small parallel request per label (INBOX, IMPORTANT, STARRED and the five categories), each 1 quota unit. A label the mailbox doesn't have resolves to zero rather than failing.

**A mailbox with inbox tabs turned off reports zero for every category** while plainly having unread mail. Two things fall out of that, and both route through one place so they cannot disagree:

- `effectiveCountSource()` — a `mailCountSource` of `primary` resolves to `inbox`. A badge reading 0 over seven unread messages is worse than no badge.
- `effectiveTab()` in `mail.ts` — the inbox picker becomes a plain `Inbox` label and the body falls back to a single "All" list, rather than querying a `CATEGORY_PERSONAL` that matches nothing and rendering a false *Inbox zero*.

The counts are also the **first thing** that can answer whether the mailbox has tabs at all, which a cold start doesn't know. So a fetch whose resolved tab has changed underneath it kicks one follow-up fetch. It converges after that: the follow-up refreshes the same counts, and the resolver then agrees with itself.

### The tab cache

`tabCache: Map<Tab, { messages, fetchedAt }>`, persisted whole under `sp:mail:data` alongside the counts. Switching tabs paints whatever is held **instantly** and refreshes underneath — the click is never waiting on the network, the same bargain the calendar's week cache makes.

A tab with **no entry at all** has never been fetched, and renders a skeleton. A tab whose fetch came back empty has an entry with no messages, and renders *Inbox zero*. Those are different claims and the body must not confuse them.

The cooldown (60s) is keyed **per tab**, so switching to a cold tab isn't blocked by the active one's cooldown, and it guards on the last *attempt* rather than the last success — a failing fetch that gated on the cached timestamp would spin error → render → refetch.

| Timer | Value |
|---|---|
| Cooldown | 60s, per tab |
| Refresh interval | 300s, paused while the tab is hidden |
| Search debounce | 350ms |

`initMail()` also refreshes on `visibilitychange`. A new tab is the common case, but a long-lived one coming back into focus is the case a 5-minute interval handles badly.

## Headers

Gmail returns **raw header bytes**, so two decoders sit between the API and the UI:

- **`decodeWords()`** — RFC 2047 encoded-words, both `B` (base64) and `Q` (quoted-printable, including the `_` means space rule). Without it a sender called "Álvaro" renders as `=?UTF-8?B?w4FsdmFybw==?=`.
- **`decodeHtmlEntities()`** — snippets arrive HTML-escaped, and `&amp;` in a preview line reads as a typo.

`format=metadata` returns no MIME parts, so **attachment detection is a heuristic**: a top-level `multipart/mixed` is what an attachment produces. It is only used to show or hide a paperclip.

## UI

`buildMailBody()` returns a header, a scrolling list and a footer, plus a `rebuild` closure. The immersive popover pins it to 420px wide; every layout gets the same **fixed 410px height** — `h-[410px]`, not a `max-h`.

Fixed rather than capped because the header swaps contents: opening search replaces the picker with an input, and the list under it can go from twelve rows to a single centred line of copy. Under a `max-h` that click resized the widget it was issued from, and in the card layouts it reflowed the masonry grid around it. The states that used to be content-height — the connect panel, the error panel, `Inbox zero`, every search state — are `flex-1` inside that box instead, so they centre in the space rather than pinning to the top of it.

Only the **list** scrolls — burying the footer under twelve rows means the controls the widget has are the ones nobody finds.

**Header.** The inbox picker on the left, the search button on the right. A strip of tabs put every inbox on screen at once, which is what a row with nothing else on it can afford; the row also has to hold the search field, so the set moved into a `createMenu` and the row keeps only the answer — the inbox in force, its unread count, and a chevron. The menu carries each inbox's count in the `trailing` slot and a check on the current one; unselected items get a spacer glyph so every label starts on the same left edge. A mailbox with inbox tabs turned off has nothing to pick between and gets a plain `Inbox` label rather than a control that can't go anywhere.

Clicking search swaps the whole row for an input; Escape or the close button returns.

**Rows.** An avatar circle whose hue is hashed from the sender's address (so the same correspondent keeps the same colour and the list gains a second thing to scan by), then sender / subject / snippet. Star and paperclip sit inline beside the sender.

**Read and unread** are told apart by weight and colour alone. Unread keeps the semibold sender and the brighter subject; read drops both to `/35` — the preview line's own colour, so nothing in a read row outranks its preview — and the avatar takes `grayscale(50%)`. There is no unread dot: it said a third time what the weight and the colour already say, and charged every row in the list an indent for it.

The time and the action rail **share one slot**, the way Gmail's own list does. Overlaying them would put buttons on top of a timestamp; separate slots would leave a permanent gap for controls nobody can see. On hover the time fades out and `✓ ⌂ ★ ↗` fade in.

Every row is an `<a>` to the thread, so every action button calls `preventDefault()` and `stopPropagation()` — without it the click both acts and navigates. Thread links use `#all/` rather than `#inbox/`, so a thread still opens after it has been archived, and carry `?authuser=<mailAddress>` so a multi-account browser opens the right mailbox. Not the `/mail/u/N/` path form — `N` is a per-browser account index the extension cannot know, and an address is not a legal value there.

**Actions are optimistic.** The row goes now and the network catches up; a failed call refetches rather than splicing the row back, because the list may have moved on underneath and the server's answer is the only honest thing to restore. `editMessage()` applies the edit across **every** tab holding that message, not just the visible one — archiving from All must not leave a ghost row in Promotions.

Marking read behaves differently in the two lists, and deliberately: in the unread list it is what makes a row stop belonging, so the row leaves; in search results the row is there because it matched a query, so it stays and only drops to the read styling.

`decrementCounts()` moves the picker's count and the badge with the row rather than waiting for the next refresh to catch up.

**Search** uses `q`, the same query language the Gmail search box takes, over the whole mailbox rather than just what's unread. It is sequenced rather than cancelled — a debounced search can have two requests in flight and the slower one must not overwrite the newer answer. Exiting bumps the sequence so a slow answer can't repopulate a list the user just dismissed. The body does **not** redraw mid-debounce, since that would replace the field being typed into; the one redraw comes with the answer, and focus plus caret are restored from `searchCaret`.

### The pending state

A 350ms debounce means the screen spends most of its time answering a query the user has already moved on from. `searchPending` is the flag for that gap: **set on the keystroke, not when the debounce fires**, and cleared only when an answer for the latest sequence lands.

It can't be rendered by a rebuild — a rebuild replaces the input the keystroke came from. So `paintSearchPending()` reaches into every live body and edits the list in place, and what it does depends on what is there:

| On screen | On the next keystroke |
|---|---|
| A list of results | Stays, but goes `opacity: 0.5` over 75ms and `pointer-events: none`. Replacing rows with a spinner would throw away the only thing worth looking at; leaving them clickable would let a click act on an answer to a question nobody is asking any more |
| A status view (*Search your mail*, *No matches*, *Search failed*) | Swapped outright for the searching state — a spinner and *Searching…* — since it has nothing worth keeping |

The four status views are one function. `searchStatus()` resolves them in order, and `searchPending` outranks `searchState` precisely because it is set a debounce earlier:

- empty field → `prompt`
- `searchPending` **or** a request in flight → `searching`
- a failed request → `error`
- otherwise → `no-matches`

Results, when they land, simply replace the list — there is no exit animation, because the answer arriving is the transition. A rebuild that lands mid-debounce for some other reason (an optimistic archive, a background refresh) re-applies the fade itself, so the stale rows never get their clicks back.

Clearing the field is the one input that skips the debounce: an empty query asks the server nothing, so there is no answer to wait for.

**Compose** and **Open Gmail** are plain URL links and need no scope at all.

**The tile** (Dashboard's top row) is the count, its caption, and who the newest message is from. At 118px a row can't say anything useful, but *7 unread, newest from Stripe* reads from across the room and is the reason to click through. Like GitHub's, it stays out of the row until connected — the side card is where a new user signs in.

## Settings

All `sync`, in the Widgets tab under **Gmail**. Connect/disconnect sits in the same accordion and names the signed-in address.

| Key | Effect |
|---|---|
| `mailEnabled` | Hides the trigger and card, closes the popover, stops the interval |
| `mailCountSource` | `primary` · `inbox` · `important` · `starred` — what the badge and tile count |
| `mailCategories` | Which inboxes the picker offers |
| `mailShowSnippets` | The preview line under each subject |
| `mailMaxRows` | Messages a fetch asks for. The **only** one that refetches, and it drops every tab's cache — the other tabs' lists are the wrong length now too |

Settings → Advanced holds the shared **Google sign-in** client ID, used by both this widget and the calendar.

## Refactor candidates

- **The widget pattern is copy-pasted a fourth time.** `mail.ts` carries its own `isCooldownActive` / `startRefreshInterval` / `stopRefreshInterval` / `closePopover` / enable-subscription, near-identical to the copies in `weather.ts`, `calendar.ts`, `github.ts` and `linear.ts`. The `createWidget()` helper [widgets.md](widgets.md#refactor-candidates) asks for would absorb all of it, and this file is now the strongest argument for writing it.
- **One request per message.** Gmail's `/batch/gmail/v1` endpoint would collapse a refresh from ~13 requests to 3. Parallel gets were chosen for legibility and because message metadata is small; a `mailMaxRows` of 30 makes the case for batching much stronger.
- **No `historyId` incremental sync.** `users.history.list` would turn the 5-minute refresh into a delta rather than a full re-list, and would make a 60s cooldown affordable.
- **Threads are ignored.** Everything is per-message, so a conversation with three unread replies is three rows. Gmail's own list is thread-shaped.
- **Attachment detection is a MIME-type guess** (`multipart/mixed`), with no filename or count. `format=full` would carry the parts, at a much larger response.
- **`activeTab`, `searchQuery` and `searchResults` are module-level globals** mutated from button handlers — the same shape `calendar.ts` is already criticised for, and the reason two mounted bodies can't hold different tabs.
- **The counts and the list can still disagree briefly.** `decrementCounts()` adjusts optimistically, but a message read in the Gmail web UI won't move the count until the next refresh.
- **No cross-tab sync.** `sp:mail:data` is raw `localStorage`, so a second new tab refetches rather than adopting what the first one just fetched — the calendar's week cache re-reads `localStorage` on a miss and this doesn't.
