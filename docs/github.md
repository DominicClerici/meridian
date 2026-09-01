# GitHub

**Files:** `src/github-auth.ts` (auth + transport), `src/github-api.ts` (queries + normalization), `src/github.ts` (the widget). **APIs:** GitHub GraphQL v4 and REST v3. **Auth:** OAuth 2.0 device flow, or a personal access token.

A triage surface, not a feed. The question it answers in two seconds is *is anything blocking someone, or blocked on me?* — which is why it groups by **why an item needs you** rather than sorting everything by date.

## Auth

### The device flow

GitHub does not support PKCE, and a redirect flow would need a client secret. The device flow needs neither: the page asks for a code, the user types it on github.com, and the page polls until it's approved. Nothing secret ever lives in the extension, and — unlike Spotify — **there is no redirect URI**, so the same client ID works identically in Chromium, Firefox and de-Googled builds. There is no browser-specific fallback to write.

`authenticateDevice()` (`github-auth.ts`) is the whole flow:

1. `requestDeviceCode()` — `POST github.com/login/device/code` with the client ID and scopes. Returns a `user_code` (shown), a `device_code` (never shown), a `verification_uri`, an expiry and a polling `interval`.
2. The caller renders the code and opens `verification_uri` in a tab. It opens the tab itself: a code with no page to type it into is where people give up.
3. `pollForToken()` — `POST github.com/login/oauth/access_token` every `interval` seconds until GitHub answers with a token.

`slow_down` is **not** an error: GitHub uses it to widen its own polling window, and ignoring it escalates to a hard rejection. `authorization_pending` is the normal answer while the user is still typing. `expired_token`, `access_denied` and anything else are terminal.

Only one flow runs at a time. `activeFlow` holds an `AbortController`; a second Connect click, a closed popover or an unmounted card aborts the first through `cancelDeviceFlow()` rather than leaving it polling forever.

**Scopes:** `repo read:org notifications read:user`. `read:org` is not optional — a review request routed through a *team* is invisible without it, and that is most review requests in an org.

### Which client ID

`getClientId()` resolves `store.sync.githubClientId` first, then `BUNDLED_CLIENT_ID` in `github-auth.ts`.

`BUNDLED_CLIENT_ID` is a registered OAuth App, so **Connect GitHub** works out of the box; `githubClientId` is only for someone pointing the widget at their own app. If it were ever emptied, `requestDeviceCode()` returns `{ needsClientId: true }` and the card points at Settings → Advanced.

> **Registering a replacement:** create an [OAuth App](https://github.com/settings/developers) and **tick “Enable Device Flow”**. GitHub's form requires an *Authorization callback URL* even though the device flow never uses one — any valid URL works, and Settings → Advanced shows the extension's own redirect URI as a sensible thing to put there. No client secret is needed. Register an **OAuth App, not a GitHub App**: a GitHub App's user-to-server tokens only see repos where the app is *installed*, which would silently reduce a widget whose whole premise is "everything across all your orgs" to a subset.

An App without device flow enabled answers `400 device_flow_disabled`, which is unguessable from the UI, so `requestDeviceCode()` special-cases it into a sentence naming the checkbox.

### The token path

`connectWithToken()` is the fallback, and the only way in with no App at all. It validates against `GET /user` before storing anything, and reads `x-oauth-scopes` off the response so the UI can explain a missing scope instead of rendering an empty section as *all clear*.

`hasScope()` treats an **empty** scope string as unknowable rather than missing — a fine-grained PAT reports no scopes at all, so the call has to be tried.

### Token lifecycle

**The common case has no lifecycle at all.** An OAuth App token and a PAT both store `githubTokenExpiry: null`, and `ensureValidToken()` returns on that before touching the network. Everything below is dead code for them.

**Expiring tokens** exist only on a GitHub App with *Expire user authorization tokens* enabled: the access token lasts 8 hours and arrives with a refresh token good for 6 months. `finishConnect()` stores both when the token response carries them.

`githubFetch()` then runs three guards in order:

1. **`ensureValidToken()`** — refreshes when within `EXPIRY_MARGIN` (60s) of the stated expiry, so a request can't straddle it.
2. **One retry on a 401** — for an expiry we didn't predict: a clock that disagrees with GitHub's, or a token that lapsed mid-flight. Exactly one refresh, one retry.
3. **`clearTokens()`** — a 401 that survives a refresh means revoked, not expired, and re-prompting is the only correct move.

**Refreshing rotates the refresh token**, which invalidates the one just used — so `refreshOnce()` holds a single `refreshInFlight` promise that concurrent callers share. This is not a theoretical race: the GraphQL query and the notifications call run in parallel on *every* tick, so an expired token means two simultaneous refresh attempts, and the second would kill the session with the first one's discarded token.

Failure is graded rather than uniform. A network error keeps the token — an outage says nothing about its validity, and the caller's own error handling reports it. Only `bad_refresh_token` / `invalid_grant` clear the session, because a refresh token GitHub rejects will never work again and retrying it forever leaves the widget silently stale.

> **The client-secret problem.** GitHub's refresh endpoint asks for a `client_secret` even from a public client, which a browser extension has no safe way to hold. `githubClientSecret` (`store.local`, never synced) is sent when the user has supplied one for their own app; without it the request still goes out and a rejection lands on the same path as any other dead refresh. This is the concrete reason to prefer an OAuth App: its tokens don't expire, so none of this runs.

`finishConnect()` writes `githubToken` **last**, after the account, scopes, refresh token and expiry; `clearTokens()` writes it last too, in reverse. The widget wakes on that key, so everything it reads on waking must already be in place — or already gone.

The widget's own subscriber tracks **connectedness, not the token value**: a rotation rewrites the key without the session changing, and treating that as a fresh sign-in would drop the card back to a skeleton and refetch every eight hours.

## Fetching

Two requests, in parallel:

**One GraphQL query** (`github-api.ts`) covers review requests, your PRs, assigned issues and the contribution calendar. REST would need a search call plus one call per PR for check status, and authenticated search is capped at 30 requests/minute; GraphQL returns `reviewDecision`, `mergeable` and `statusCheckRollup` inline for free.

| Search | Query |
|---|---|
| `reviews` | `is:open is:pr archived:false review-requested:@me` |
| `mine` | `is:open is:pr archived:false author:@me` |
| `issues` | `is:open is:issue archived:false assignee:@me` |

An org filter appends ` org:NAME` to all three. A disabled issues section still sends a query — `search` rejects an empty string, and a query that matches nothing costs less than a second round trip.

**One REST call**, `GET /notifications?all=false`, because notifications exist nowhere else. Threads with reason `review_requested` are dropped: they have their own section, and showing them twice makes the card look busier than the work is.

**Partial answers survive.** A GraphQL response can carry `data` *and* `errors`; the sections that resolved are kept and the ones that didn't are recorded in `data.degraded`, which the card renders as a note under the section header. Silently showing an empty section would read as good news.

`subjectUrl()` rewrites a notification's API URL into a web one (`api.github.com/repos/…/pulls/1` → `github.com/…/pull/1`) — the REST payload has no `html_url` for the subject, so there is no other way to a clickable row.

### Timers

| Cooldown | Refresh interval | Tab hidden |
|---|---|---|
| 60s | 300s | paused |

The cooldown guards on the last **attempt**, not the last success. Gating on the cached timestamp instead lets a failed fetch render an error, which re-renders the card, which refetches — a tight retry loop against an API that is already refusing.

Unlike weather and calendar, this widget stops polling when the tab is hidden and catches up on `visibilitychange` ([widgets.md](widgets.md#refactor-candidates)).

## Data

`GithubItem` is one shape for all four sections; `mapPullRequest`, `mapIssue` and `mapNotification` normalize into it.

`mapRollup()` collapses `statusCheckRollup` into `success | failure | pending` plus a `ciDetail` naming up to three failed checks, which becomes the CI mark's tooltip.

**`urgency()`** ranks your own PRs, because within *your pull requests* the difference between blocked and merely open is the entire point:

| Rank | State |
|---|---|
| 5 | Merge conflicts |
| 4 | Changes requested |
| 3 | CI failing |
| 2 | Approved, ready to merge |
| 1 | Open |
| 0 | Draft |

**`actionableCount()`** is what the trigger badge shows: review requests + your PRs at urgency ≥ 3 + unread mentions. Not a total — a badge that counts your own drafts is a badge nobody reads.

### Filtering

The ignore-list and bot muting are applied by `filterData()` at **render** time, never before caching. The cache holds what GitHub said, so unmuting bots brings them straight back instead of waiting out the next fetch. `github.ts` keeps both: `rawData` (as fetched, as cached) and `data` (`filterData(rawData)`, what the UI reads); `applyFilters()` re-derives the second from the first, and every filter setting subscribes to it.

GitHub search can express neither filter without one qualifier per repo, which is the other reason they aren't in the query.

## UI

`buildGithubBody()` is the one body, used by the popover and both cards. Its shape:

```
┌───────────────────────────────┐
│ NEEDS YOUR REVIEW          3  │  ← scrolls
│  ◐ Fix race in scheduler   ✓  │
│    acme/core #482 · 2h        │
│ YOUR PULL REQUESTS         4  │
│  ⑂ Rework token  CHANGES   ✗  │
│    acme/api #91 · 4h ●○○      │
├───────────────────────────────┤
│  ▪▪▫▪▫▫▪▪▫▪▪▫  (12 weeks)     │  ← pinned
│  1,284 contributions this year │
│  Updated 2m ago    @you   ↻   │
└───────────────────────────────┘
```

**Only the list scrolls.** The contribution strip and the footer sit outside it: burying the refresh button under four sections of rows means the one control the widget has is the one nobody finds.

Sections render in `GITHUB_SECTIONS` order — reviews, mine, mentions, issues — which is deliberate: what other people are waiting on, then what you are blocked on, then what is merely addressed to you. An empty section is omitted entirely rather than showing "nothing here" four times; when *every* section is empty the body shows one **You're all clear**. A section past `ROWS_COLLAPSED` (4) rows collapses behind *Show N more*, remembered in `expanded` for the life of the page.

**Rows** are `<a>` elements, so middle-click and ⌘-click work. Each carries a lead glyph (author avatar for reviews, a PR/issue/at glyph elsewhere), the title, a meta line of `repo #number · age`, and a trailing CI mark. Your own PRs add a state chip — `CONFLICTS`, `CHANGES`, `READY`, `DRAFT` — and approval pips (`●●○` = 2 of 3). Mentions add a reason chip and a **mark as read** button that appears on hover.

Marking read is the widget's one write. It `PATCH`es the thread, drops the row from `rawData`, rewrites the cache **without touching the timestamp** — a local edit is not a refresh and shouldn't read as one — and calls `notifyDataChanged()` rather than just rebuilding its own body, since one fewer mention changes the trigger badge and the Dashboard tile too.

### Three hosts

| Layout | Where | What |
|---|---|---|
| Immersive | `#github-trigger` + popover (380px) | badge = `actionableCount()` |
| Default | grid card | the full body |
| Dashboard | `side` carousel **and** `top` tile | full body, plus a number row |

Dashboard needs **two registrations** — `github` (`{ default: "grid", dashboard: "side" }`) and `github-summary` (`{ dashboard: "top" }`) — because a `CardDef` allows one region per layout mode. The tile is one number per enabled section and nothing else; at 118px there is no room for a row that says anything useful, and a count is the part of this widget that reads from across a room. It gates on `isConnected()`, so it stays out of the row until there is something to count; the side card is where a new user signs in.

`notifyDataChanged()` refreshes only `github-summary`. The grid/side card's body is a live body that rebuilds itself, and calling `refreshCard` on it too would build the same DOM twice.

### Connecting from the widget

The not-connected body is the device flow inline — the GitHub mark, a sentence, and a **Connect GitHub** button that swaps for the code, a copy button, an *Open github.com/login/device* button and a cancel. The widget is a way in, not a dead box pointing at Settings.

## Settings

**Widgets → GitHub:** enable, connect/disconnect (with the account and which credential it used), the four section toggles, hide-bots, contribution graph, an org filter and a repo ignore-list.

**Advanced → GitHub sign-in:** the client-ID field with the App instructions, and the personal-access-token field.

Only `githubOrgFilter` changes the query, so only it clears the cache and refetches; the rest re-derive from `rawData`. Changing `githubClientId` clears an OAuth token — a token belongs to the app that issued it.

## Storage

Settings keys are inventoried in [storage.md](storage.md#key-inventory). Two raw localStorage caches, outside the store:

| Key | Holds |
|---|---|
| `sp:github:data` | the last unfiltered `GithubData`, so a new tab draws on its first frame |
| `sp:github:lastFetch` | the last **successful** fetch, for the footer's *Updated 2m ago* |

`githubRefreshToken`, `githubTokenExpiry` and `githubClientSecret` are all `store.local` and all null/empty unless the app issues expiring tokens.

## The Linear cross-link

When the Linear widget is connected and `linearLinkGithub` is on, a pull request row carries a `● ENG-401` chip in its Linear issue's own status color. This card publishes every PR it fetched into `issue-links.ts` and reads the reverse lookup back out; it never imports `linear.ts`, and `linear.ts` never imports this. The join key is the pull request URL, normalized to `owner/repo#number`.

`publishLinks()` is called from `applyFilters()` rather than from the fetch, so one call covers the fetch, the cache load, a mark-read and every filter subscription — and it publishes *filtered* data, so a repo dropped by `githubIgnoredRepos` doesn't resurface in the Linear card. See [linear.md](linear.md#the-github-cross-link).

## Refactor candidates

- **A refresh that needs a secret is a half-answer.** The refresh path is complete and tested, but GitHub wants a `client_secret` a public client can't hold, so it only works for a user who pastes their own app's secret. There is no public-client refresh on GitHub to fall back to.
- **No pagination.** Each search is capped at 25 nodes and notifications at 25 threads; someone with more than that in one bucket silently sees a truncated list with no indication.
- **The contribution strip is 12 fixed-width weeks**, so it under-fills a wide popover and can't grow with the card.
- **`expanded` is page-local.** Expanding a section is forgotten on the next new tab, unlike every other piece of widget state.
- **Rate limiting is reported, not respected.** `rateLimitMessage()` explains a 403, but nothing backs the refresh interval off afterwards — the next tick fires on schedule and fails the same way.
- **A `<button>` inside an `<a>`.** The mark-as-read control is nested inside the row link. It works because the DOM is built, not parsed, but it is invalid markup and one `innerHTML` refactor away from breaking.
- **Notifications aren't reconciled with the other sections.** A comment on a PR that is already in *your pull requests* appears twice, once per source.
- **Four sections, one query budget.** Turning a section off still fetches its data in the GraphQL query (only issues is stubbed out), so the disabled sections cost the same as the enabled ones.
