# Search

The command palette: the bar in the centre of the page, the overlay it opens
into, the sources it queries, and the ranking that orders them.

**Files:** `src/search/` (`index.ts`, `overlay.ts`, `list.ts`, `input.ts`,
`registry.ts`, `rank.ts`, `recents.ts`, `answers.ts`, `empty.ts`, `types.ts`,
and `sources/*.ts`), plus `src/navigate.ts`, `src/url.ts`, `src/tabs-api.ts`.

**DOM:** `#search-wrapper` → `#search-bar` (static, in `index.html`) and
`#palette`, a `<dialog>` built in JS and appended to `<body>`.

## Two elements, one object

The resting bar is a **button**, not an input. It holds no text and accepts no
typing; it exists to be a target and to mark where the palette comes from. The
palette is a native `<dialog>` opened with `showModal()`, which is what puts it
in the browser's top layer — above every popover, card and toast, without a
z-index — and what gives it a real `::backdrop` to blur, an inert page behind
it, and focus containment.

Both share `--palette-h` (52px), so opening animates **position and width
only**. Nothing scales, so no text is ever caught mid-distortion.

```
rest                              open
┌────────────────────────┐        ░░░ page: blurred 16px, dimmed ░░░
│ ⌕  Search or run …  ⌘K │   →    ┌──────────────────────────┐
└────────────────────────┘        │ ⌕ [Shortcuts ×] git    ⏎ │
  (#search-bar, in the slot)      ├──────────────────────────┤
                                  │ SHORTCUTS                │
                                  │ ● GitHub  github.com   › │
                                  │ ● GitLab  gitlab.com     │
                                  │ WEB                      │
                                  │ ⌕ git  Search Google     │
                                  ├──────────────────────────┤
                                  │ → actions · ⇥ scope · …  │
                                  └──────────────────────────┘
```

## Opening

| Trigger | Behaviour |
|---|---|
| Any printable key on the page | Opens seeded with that character (`searchTypeAnywhere`, on) |
| ⌘K / Ctrl+K | Opens empty; also closes |
| `/` | Opens empty |
| Click the bar | Opens empty |
| New tab | **Focuses** the bar, does not open it (`searchAutofocus`, on) |

Autofocus deliberately stops at focus. A new tab dimming itself before you have
typed anything would be hostile; the first keystroke is what promotes the bar to
the palette.

The global handler in `search/index.ts` stands down entirely when another
`<dialog>` is open (settings owns its own keys) or when the event target is an
input, textarea, select or contenteditable.

## The source contract

```ts
type SearchSource = {
  id: SearchSourceId          // stable: keys the toggle, the @token, the ranking
  label: string               // group heading, and the scope pill's text
  token: string               // "@hist"; "" means it can't be scoped to
  glyph: string
  weight: number              // multiplies the match score
  limit: number               // rows it may contribute to the blended list
  scopedLimit?: number
  scopedOnly?: boolean        // never blended — too slow or too noisy
  debounce?: number           // ms to wait before querying
  available(): boolean
  unavailable?(): Unavailable | null
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]>
  idle?(ctx: QueryContext): Candidate[] | Promise<Candidate[]>
}
```

`query()` **may return a promise**. That is the change that unlocked everything:
the previous engine required synchronous providers, which locked out history,
bookmarks, tab search and every network source by construction. Each source now
resolves independently and patches into the list as it lands, so cached sources
paint on the first frame while a network one is still in flight.

`debounce` costs nothing when you are not typing: each keystroke aborts the run
before it, so a debounced source only fires once you pause.

## Sources

| Source | `@token` | Blended | Scoped | Network when scoped |
|---|---|---|---|---|
| Answers | — | 1, pinned top | — | no |
| Go to (URL) | — | 1, pinned top | — | no |
| Commands | `@cmd` | 3 | 40 | no |
| Shortcuts | `@sc` | 4 | 24 | no |
| Open tabs | `@tab` | 3 | 25 | no |
| History | `@hist` | 5 | 25 | — |
| Bookmarks | `@bm` | 4 | 25 | no |
| Todos | `@todo` | 3 | 20 | no |
| Notes | `@note` | 2 | 15 | no |
| Calendar | `@cal` | 3 | 20 | yes |
| Mail | `@mail` | 3 | 20 | yes |
| Linear | `@lin` | 3 | 20 | yes |
| GitHub | `@gh` | 3 | 20 | yes |
| Spotify | `@sp` | scoped only | 15 | yes |
| Suggestions | — | 3 | — | yes, opt-in |
| Web | `@web` | 1, pinned bottom | — | no |

Blended results are whatever a widget already synced — instant, no network, no
rate limit. Scoping to a source is what authorizes it to make a real request:
Gmail's own query language, Linear's `searchIssues`, GitHub's search endpoint,
Google Calendar's `q` across ±1 year, Spotify's track search.

Sources under `search/sources/` import a small read-only accessor from the module
that owns the data (`githubSnapshot()`, `linearSnapshot()`, `mailSnapshot()`,
`calendarSnapshot()`, `spotifySnapshot()`). Search depends on those modules;
none of them depends on search, so there is no cycle.

### The web row is pinned last

It is always available, so it is the thing you fall back to — not the thing you
arrow past to reach the tab you already had open. When nothing else matches it
is the only row, so Enter still searches the web without a detour.

## Ranking

`rank.ts` is fzf's model. Find the tightest window of the haystack containing the
needle as a subsequence (forward pass for where it can end, backward pass from
there for where it can start), then score the characters inside it:

| Component | Value |
|---|---|
| Each matched character | +16 |
| At index 0 | +18 |
| After a separator (` -_./\:,()[]{}@#?&=+'"\|~*`) | +14 |
| At a camelCase boundary | +10 |
| Adjacent to the previous match | +12 |
| Gap before this match | −7, then −2.5 per extra character |

Normalized against a perfect prefix match of the same length, then multiplied by
**density** (`needle.length / span`, mapped to 0.6–1.0). Without density, `git`
scores `Graphite` nearly as well as `GitHub` — the characters are all there and
in order, they are just nowhere near each other.

Floors: an exact match is 1.0, a prefix match is at least 0.92, a match at any
word start is at least 0.78. A single character only counts at a boundary.
Anything below `MATCH_FLOOR` (0.32) is **dropped**, not shown weakly.

Final score: `match × source.weight + boost × 0.12 + learned`, where `boost` is
the source's own 0–1 confidence (recency, visit count, priority, proximity) and
`learned` comes from `recents.ts`.

### Grouping

Rows stay under their source's heading, and the *groups* are ordered by their
best row. Relevance stays global while the list still reads as sections rather
than a shuffled pile. Scoped to one source, headings are dropped — the pill in
the input already says it.

## Learned ranking

`recents.ts`, `local` only, never synced.

- **`byQuery`** — the one result a query ended in. Worth +0.45, which is what
  makes the second search for a thing land on it directly. Capped at 120 entries.
- **`picks`** — how often a result is chosen at all. Worth up to +0.2, halved
  across the board once the total passes 400 so the ratios survive but the
  numbers stay bounded.

Both are capped well below the range a match score moves through: learning breaks
ties, it never overrides relevance. `searchRecents: false` disables recording and
reading; **Clear search history** in settings empties both.

## Input grammar

`input.ts`, pure. Three prefixes, none of which collides with the start of a real
query.

| Typed | Means |
|---|---|
| `>` | Scope to Commands |
| `@` | Source picker; `@gh ` (with the space) commits the scope |
| `!g`, `!yt`, `!w`… | Re-target the web row — engine bangs and 10 destinations |

A committed scope becomes a **pill** in the input, and the raw token leaves the
text. `⇥` on a highlighted row locks the scope to that row's source. `⌫` on an
empty input, `←` at caret 0, or clicking the pill pops it.

## Keyboard

| Key | Effect |
|---|---|
| ↑ ↓ (wrapping), Ctrl+N / Ctrl+P, Home / End | Move the selection |
| ⏎ | Run the active result |
| ⌘⏎, middle-click | Run it in a new tab, whatever the setting says |
| → | Open the row's action menu · ← returns |
| ⇥ | Scope to the active row's source |
| ⌘C | Copy the row's `copyValue`, falling back to subtitle, then title |
| ⌘1–9 | Run the *n*th result |
| Esc | Clear the query → pop the scope → close |

Esc is staged, and the listener is on the **dialog**, not the input, so it works
wherever focus is inside the palette. The dialog's own `cancel` event is
`preventDefault`ed; `onKeydown` runs first and owns the behaviour.

## Rendering

`list.ts`. Rows are keyed by candidate id and **reused** across renders — the old
renderer rebuilt every row from scratch on every keystroke *and* on every arrow
key, re-creating each icon as it went, which is why moving the selection made
favicons flash. Icons are built once per id; a row whose icon encodes mutable
state declares an `iconKey` so it can be rebuilt when that changes.

The selection is a single `.palette-rail` element that translates between rows,
so arrowing through results touches no row at all. Matched characters are wrapped
in `<mark class="palette-mark">`.

The selection resets to the top when the query changes, and holds its place when
a late source patches in — the two are told apart by a key of scope + picker +
text.

`LIST_MAX_HEIGHT` (360px) is set from `list.ts`, not CSS, because the panel's
height maths reads the same constant. Two copies of that number silently drift,
and the symptom is dead space under the footer.

## Motion

| Moment | Animation |
|---|---|
| Open | Frame translates and widens from the bar's rect, 220ms `cubic-bezier(.2,.9,.24,1)` |
| Backdrop | `blur(0→16px)` + scrim, 200ms |
| Panel | Height springs to the measured content, 220ms |
| Rows | Fade + 4px rise, 15ms stagger, capped at 8 rows, first render of an open only |
| Selection | Rail translates, 120ms |
| Close | Reverses in 150ms |

The morph measures **centres, not edges**: the frame is centred with
`translateX(-50%)`, so animating its own width doesn't move the point the offset
is measured against. It animates the `translate` property, leaving that
`transform` alone.

Closing is driven by a `setTimeout`, not the animation's `finished` promise. A
paused document timeline (a backgrounded tab) never settles that promise, and a
palette that cannot be closed is a far worse failure than one that closes without
its animation.

`prefers-reduced-motion` collapses every duration to 1ms, and the morph degrades
to a fade. So does an open with no visible resting bar — the palette scales in
from the centre instead.

## Instant answers

`answers.ts`, pure and offline. Arithmetic goes through a tokenizer and a
shunting-yard pass — never `eval` or `new Function`, because the input is a
string typed on a page that also holds OAuth tokens.

- **Arithmetic** — `+ - * / % ^`, parentheses, unary minus, `pi`/`e`/`tau`, and
  17 single-argument functions. Requires an operator or a function call, so a
  bare number is not an "answer".
- **Percentages** — `15% of 240`, `240 + 15%`, `30 is what % of 80`.
- **Units** — length, mass, volume, time, data, speed, angle, temperature
  (offset-aware). `20 mi in km`, `98.6 f in c`.
- **Time elsewhere** — `time in Tokyo`, `3pm in Tokyo`, resolved through
  `timezones.ts`'s `searchZones`.

No currency: it would need live rates, and a stale exchange rate presented as an
answer is worse than no answer.

## Navigation

`navigate.ts` is the one place a URL becomes a navigation. Before it, the dock
and both search providers each inlined their own
`newTab ? window.open : location.href` and **disagreed about which setting
decided it** — opening the same shortcut from the dock and from search could
behave differently. The `surface` argument names that difference instead of
hiding it: `"dock"` reads `shortcutsOpenIn`, `"search"` reads
`searchOpenInNewTab`, and both are read **at action time**, so a row rendered
before a settings change still opens the way the setting says now.

## Permissions

| Capability | Permission | How it's asked for |
|---|---|---|
| History | `history`, required | Already granted |
| Bookmarks | `bookmarks`, optional | A button on the scoped empty state |
| Open tabs | `tabs`, optional | A button on the scoped empty state |
| Suggestions | 4 optional origins | The settings checkbox |

Every one is requested synchronously from a click, because Chrome rejects a
permission request that isn't. Without the grant, `tabs.query` still resolves —
it just omits `url` and `title` — so `tabs-api.ts` checks the grant rather than
inferring it from the API's presence.

## Settings

Widgets → Search.

| Key | Default | |
|---|---|---|
| `searchEngine` | `google` | 7 engines, each with an inline SVG mark |
| `searchOpenInNewTab` | `false` | ⌘⏎ always overrides |
| `searchDisabledSources` | `[]` | A *disabled* list, so a new source arrives on without a migration |
| `searchSuggestions` | `false` | Requests the optional origins when flipped on |
| `searchTypeAnywhere` | `true` | |
| `searchAutofocus` | `true` | |
| `searchRecents` | `true` | Plus a Clear button |

`local`: `searchRecentQueries`, `searchLearning`.

**`debounceSearch` is gone.** It existed because the shortcuts provider walked
every shortcut on every keystroke and a large collection made typing lag; per-
source debouncing and cancellation make it meaningless.

## Adding a source

```ts
// src/search/sources/thing.ts
export const thingSource: SearchSource = {
  id: "thing",            // add it to SEARCH_SOURCES in defaults.ts first
  label: "Things",
  token: "th",
  glyph: "sparkle",
  weight: 1,
  limit: 3,
  available: () => true,
  query(ctx) {
    if (!ctx.text.trim() && !ctx.scoped) return []
    return things().map((t) => ({
      id: `thing:${t.id}`,
      title: t.name,
      icon: () => icon("sparkle", { size: 16 }),
      run: (mode) => navigate(t.url, "search", mode === "newTab" ? "newTab" : "default"),
    }))
  },
}
```

Then add it to `SOURCES` in `search/index.ts` and to `TOGGLEABLE_SOURCES` in
`settings.ts`. Return every plausible candidate and let `rank.ts` do the work —
`limit` is enforced by the engine after ranking, not by you.

## prettyUrl

`url.ts` — shortens a URL for display.

- Adds `https://` if there's no scheme, and returns the input unchanged if it
  still won't parse.
- Strips a leading `www.`, keeps the port.
- Keeps a single path segment as-is; collapses two or more to `/.../lastSegment`.
- Appends the query string and hash verbatim.

```
https://www.github.com/anthropics/claude-code/issues  →  github.com/.../issues
https://example.com/about                             →  example.com/about
```

## Refactor candidates

- **Five of the seven engine marks are still approximations.** Google's is the
  real four-colour mark; Bing, Yahoo, DuckDuckGo, Ecosia, Qwant and Startpage are
  hand-drawn from memory and are recognisable rather than correct.
- **`buildCommands()` rebuilds ~60 objects per keystroke.** Cheap today, but it
  reads eleven store keys each time and will not stay cheap as commands are added.
- **The notes source treats every line as a candidate**, so a long note floods
  its own scope. Paragraph chunking, or a real index, would rank better.
- **Calendar's blended pass only sees weeks the card has drawn** — usually one.
  Scoping is what reaches the rest, which is a sharper cliff than the other
  sources have.
- **No source can report a partial failure.** A network source that throws is
  indistinguishable from one that legitimately found nothing; both come back as
  an empty bucket, and the palette says "No results."
