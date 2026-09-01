# Linear

API-key-first auth, one GraphQL round trip, the grouped card, inline status changes, and the pull-request cross-link with the [GitHub widget](github.md).

**Files:** `linear.ts` (widget) · `linear-api.ts` (query, mapping, mutations) · `linear-auth.ts` (credentials, transport) · `issue-links.ts` (the GitHub join)

## Shape

The same six-piece widget pattern as GitHub and Calendar ([widgets.md](widgets.md#the-pattern)): a trigger with a badge, a state machine, one popover handle, a localStorage cache, a cooldown plus a refresh interval, and `e.stopPropagation()` on the trigger. Two cards are registered — `linear` (Default grid, Dashboard side) and `linear-summary` (Dashboard top tile) — both gated on `linearEnabled`, the tile additionally on being connected.

| | |
|---|---|
| Cooldown | 60s |
| Refresh interval | 300s, paused while the tab is hidden |
| Rows per section before collapsing | 4 |
| Cache keys | `sp:linear:data`, `sp:linear:lastFetch` |
| Card order | 45 — immediately after GitHub's 40 |

## Connecting

Linear has two doors and they are not equally wide, so the widget leads with the wide one.

**A personal API key is the default path.** Linear → Settings → Account → Security & access → *New API key*, paste it into the card's own connect panel or Settings → Widgets → Linear. No app to register, no redirect URI, identical behavior in every browser. The key is validated against `viewer` before it is stored, so a typo fails at the field instead of as a broken widget. It goes in `store.local` and never syncs.

Two things about the key matter, because Linear scopes them granularly and neither failure is loud:

- **It needs Write, not just Read.** Read fills the card, but the status menu and the inbox's mark-as-read both go out as mutations. A read-only key renders everything correctly and then silently reverts every status change — `updateIssueState()` returns null and `moveIssue()` puts the old state back.
- **It needs the teams you care about.** A key scoped to one team makes `assignee.isMe` return only that team's issues, which looks identical to having no other work.

**OAuth is the narrower-scoped alternative** and lives in Settings → Advanced. Linear supports PKCE with `client_secret` optional, which is the only reason a browser extension can use it at all — but Linear still checks `redirect_uri` against a registered app's allowlist, and there is no bundled app here whose allowlist could already contain this browser's URI (`BUNDLED_CLIENT_ID` is empty). So OAuth needs the user to create their own application, tick *public client*, add the extension's redirect URI, and paste the client ID. Until then the card's "Set up OAuth instead" link opens Advanced rather than starting a flow that cannot finish.

The two are stored the same way and differ only in the header `linearRequest()` sends: an API key goes in **raw**, because Linear reserves `Bearer` for OAuth tokens and rejects a key that arrives with the prefix.

| | API key | OAuth |
|---|---|---|
| Endpoint | `https://api.linear.app/graphql` | same |
| Header | `Authorization: <key>` | `Authorization: Bearer <token>` |
| Lifetime | until revoked in Linear | 24h, refreshed from `linearRefreshToken` |
| Scopes | full workspace | `read,write` (comma-separated — Linear is unusual here) |

`authHeader()` refreshes an OAuth token 120s before its stated expiry so a request can never straddle it. A 401 or 403 from any call clears the credentials and re-prompts; there is nothing left to refresh by then.

## The query

One round trip fills the whole card — four aliased selections plus the viewer:

```
viewer                     who we are
active: issues(...)        assignee.isMe, state.type in triage/unstarted/started
due:    issues(...)        assignee.isMe, not completed/canceled, dueDate <= today+2
notifications(first: 50)   @include(if: $wantInbox)
teams(first: 25)           states for the status menu, activeCycle @include(if: $wantCycle)
```

**Why two issue selections rather than one.** A single broad search ordered by `updatedAt` lets a large stale backlog crowd out the overdue item that is the entire reason to look at the card. `active` guarantees the work in flight; `due` guarantees the deadlines, from any state including backlog. They overlap, and the merge resolves it.

**Why `teams` is unconditional.** It carries the workflow states the inline status menu offers. The active cycle rides along on the same selection behind `@include`, so showing the burndown costs no extra request.

**Attachments are conditional.** `attachments(first: 6)` is behind `@include(if: $wantLinks)` — six per issue across fifty issues is real query complexity to spend when the cross-link is switched off.

Everything the card draws comes from this one query. There is no second request anywhere in the read path.

## Bucketing and ranking

`due` wins the overlap outright. An issue that is both overdue and in progress reads as *late*, not as *busy*, and letting it appear twice would also double it in the trigger badge. What `due` claims is removed from the rest; what remains splits on `state.type === "started"` into **In progress** and **Up next**.

The inbox is cut client-side: `NotificationFilter` has no `readAt` field, so unread-and-not-snoozed is decided after the fetch.

`urgency()` exists because Linear's own `priority` cannot carry the ranking alone — it puts "no priority" at 0, *below* Low, and it knows nothing about a date that has already passed:

| | |
|---|---|
| 6 | overdue |
| 5 | SLA breaching within 24h |
| 4 | due today |
| 3 | priority 1 (Urgent) |
| 2 | due tomorrow, or priority 2 (High) |
| 1 | started |
| 0 | everything else |

The trigger badge counts `inbox.length + due.length` — things where something is actually waiting on you.

## The row

```
◐  ▮▮ Ship the billing webhook retry path              [◐] [⑂]
   ENG-401 · 3d overdue · ⑂#1842 ✗ · backend
```

**The status glyph is drawn, not iconified**, because the color is data — it comes from `state.color`. `stateGlyph()` renders each `state.type` the way Linear does: a dashed ring for backlog, an empty ring for unstarted, a half-filled pie for started, a filled circle with a check for completed, a filled circle with a bar for canceled. The started wedge is a stroked circle at half radius with a dash pattern — a stroke that thick fills inward, drawing a pie without any arc maths.

**Only Urgent and High get a priority glyph.** Below that it is noise on every row.

**The meta line has a budget.** A 380px card cannot hold identifier, age, PR chip, project and labels at once, and a project truncated to `B…` is worse than no project. So the pull request and the labels — the compact, color-coded ones — win the space, and the project fills in only when the row is quiet enough to read it. Labels drop from two to one when a PR chip is present.

**Hover reveals two controls**, both links inside a link, so both stop the click before the row navigates:

- **Status** opens `createMenu` with that team's workflow states in position order, the current one disabled. Selecting one applies the change locally *before* the network confirms it — a status change is the only interaction here with visible latency, and waiting on a round trip to redraw a dot makes the card feel remote. A rejected mutation reverts. Moving an issue to completed or canceled takes it out of every section the card renders, so that case forces a refetch, which is what actually removes the row.
- **Copy branch name** puts `issue.branchName` on the clipboard — one click, then `git checkout -b <paste>`.

Anything that edits `data` calls `notifyDataChanged()`, not the body's own `rebuild()`. A status change moves an issue between sections and a cleared notification empties the inbox; both change the trigger badge and the Dashboard tile, and a local rebuild would leave those counts drifting from the rows.

## The cycle burndown

`Cycle.scopeHistory` and `completedIssueCountHistory` are daily arrays from the cycle's first day, which is exactly a burn-up: scope as a faint filled area, completed as an accent line climbing into it. Two series in 34px, no axes and no labels — the shape of the gap is the whole message. The SVG uses `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"` so it stretches to whatever width the card has without thickening its lines; it is a shape, not a measurement.

Which team's cycle: the pinned one if `linearTeamFilter` is set, otherwise the team the user actually has the most open issues in. A workspace can expose a dozen teams the user never touches.

The caption reads `ENG · Cycle 12 · 3d left … 62%`.

## The GitHub cross-link

A Linear issue stores its pull request as an attachment, and a GitHub PR is the thing that attachment points at — so the two cards can badge each other for free. `issue-links.ts` is where they meet, and it is deliberately tiny: **it imports nothing**, and neither widget imports the other. A direct import either way would make two unrelated widgets refuse to build without each other.

Both sides publish into the index and read out of it:

| | publishes | reads |
|---|---|---|
| `linear.ts` | every PR URL an issue claims → `{identifier, stateName, stateColor, …}` | `githubRefForPr()` for the `⑂#1842` chip and its CI mark |
| `github.ts` | every PR it fetched → `{number, repo, ci, isDraft, …}` | `linearRefForPr()` for the `● ENG-401` chip in its own state color |

**The join key is the pull request URL**, normalized to `owner/repo#number`. GitHub hands out the same PR under several spellings — the API's `/pulls/` form, a `#issuecomment` deep link, a trailing slash, mixed case in the owner — and Linear stores whichever one the person pasted, so every lookup goes through `normalizePrUrl()` or the two maps never meet. Matching on `ENG-123` scraped from a branch name or PR title would look like it worked until someone renamed a branch.

`onLinksChanged(cb)` reports *which* side changed, and each widget ignores its own source: re-rendering on your own publish is redundant — you are already re-rendering for the fetch that produced it — and doing it anyway is how two widgets that refresh each other end up in a loop.

GitHub publishes from `applyFilters()` rather than from the fetch, so one call covers the fetch, the cache load, a mark-read and every filter subscription — and it publishes *filtered* data, because a repo the user ignored in the GitHub card should not resurface in the Linear one.

The Linear chip renders from the attachment URL even when the GitHub card is off or still loading — the attachment alone proves the PR exists. When GitHub *has* it, the check state comes along.

## Settings

Seven keys, all `sync`, in Widgets → Linear except the client ID:

| Key | Effect |
|---|---|
| `linearEnabled` | Hides the trigger and both cards, closes the popover, stops the interval |
| `linearSections` | Which of `inbox` · `due` · `progress` · `todo` render, in that order |
| `linearShowCycle` | The burndown, and whether `activeCycle` is asked for at all |
| `linearTeamFilter` | Team key (`ENG`). Empty means all teams |
| `linearLinkGithub` | The cross-link both ways, and whether attachments are fetched |
| `linearClientId` | OAuth application client ID (Advanced) |

Section choices re-render from the cache. `linearTeamFilter`, `linearShowCycle` and `linearLinkGithub` all change the query itself, so those clear the cache and refetch. Changing `linearClientId` disconnects an OAuth session; an API key is unaffected.

`store.local` holds `linearToken`, `linearTokenType`, `linearRefreshToken`, `linearTokenExpiry` and `linearUser` — see [storage.md](storage.md#key-inventory).

## Refactor candidates

- **The widget pattern is copy-pasted a fourth time.** `isCooldownActive` / `getCached` / `setCached` / `startRefreshInterval` / `stopRefreshInterval` / `closePopover` / the enable-subscription are now written out in weather, calendar, github *and* here, near-identically. This file is the strongest argument yet for the `createWidget({ trigger, enabledKey, fetch, render, cooldown, interval })` helper that [widgets.md](widgets.md#refactor-candidates) has been asking for.
- **`linear.ts` and `github.ts` are structurally the same file.** Section headers with a count and a "show n more", the row/meta/chip layout, the skeleton, the empty state, the error panel, the footer with its timestamp and refresh button — all duplicated with different nouns. A shared `buildTriageCard({ sections, buildRow })` would collapse both.
- **`relativeTime()` exists in both**, character for character, alongside a third variant in `todo.ts`.
- **The status menu can only change status.** `IssueUpdateInput` also takes `assigneeId`, `priority`, `dueDate` and `cycleId`, and the row has the team's data to offer all four. Priority in particular is one click away and currently read-only.
- **No quick-create.** `issueCreate` needs only `issues:create`, and a new tab is the natural place to capture a thought. It was deliberately left out of the first cut to keep the settings surface small.
- **Only the first pull request is badged.** An issue with three PRs shows `#1842 +2`; the other two are unreachable from the card.
- **The inbox cannot snooze.** `notificationUpdate` takes `snoozedUntilAt` and the row already has the mutation path; only read/unread is wired.
- **`canWrite()` always returns true when connected.** A read-only OAuth token would fail the status mutation at the network instead of hiding the control, because Linear does not report granted scopes back on the token response.
- **The burndown ignores `endsAt` for its x-axis**, so a cycle whose history is shorter than its length draws as if it were already over.
