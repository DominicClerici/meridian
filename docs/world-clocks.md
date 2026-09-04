# World clocks

Extra timezones shown alongside the main clock, up to five of them.

**Source:** `src/world-clocks.ts` (the three renderers, the tick, the hover card), `src/timezones.ts` (the catalogue and the arithmetic), the `buildWorldClocksSection()` block in `settings.ts`, the `#world-clocks` element in `index.html`, and the `.world-clock-*` / `.wc-*` rules in `styles.css`.

## The data

One list, `store.sync.worldClocks`, in display order:

```ts
type WorldClock = {
  id: string        // crypto.randomUUID()
  timezone: string  // IANA id, "Asia/Tokyo"
  label: string     // the user's own text; defaults to the zone's city
}
```

The label is separate from the city on purpose — "Asia/Tokyo" can read *Kenji* or *HQ*. Where the two differ, the hover card names the city as well so the label never hides which place it means.

`MAX_WORLD_CLOCKS` (5, in `defaults.ts`) is enforced in `writeWorldClocks()` by a `slice`, not only by disabling the Add button, so a list arriving from another device can't exceed it either.

There is **no `worldClocksEnabled`**. An empty list is the off state: the row hides itself, no cards register, and nothing ticks. That is the one place this feature deliberately breaks the widget pattern in [widgets.md](widgets.md).

## Format

World clocks follow the main clock's `clock24Hour` and `clockShowSeconds` settings rather than carrying their own. `formatOpts()` reads both on every tick, and `initWorldClocks()` subscribes to both so a change redraws the row.

## Three hosts, one list

| Layout | Where | Built by |
|---|---|---|
| Default | A row of compact chips between the clock and the search bar | `#world-clocks` singleton slot |
| Immersive | The same row, backgrounds stripped | same slot, `[data-layout="immersive"]` CSS |
| Dashboard | One tile per clock in the top row | one `registerCard()` per clock |

### The chip row

`#world-clocks` is a [singleton slot](layouts.md#singleton-slots) (`worldClocks`), so it survives layout switches with its chips and their listeners intact. `frameDefault()` nests it with the clock in a tighter `gap-4` column so the pair reads as one block, while the search bar keeps the frame's wider `gap-8`. `frameImmersive()` widens its centre column to `max-w-3xl` and centres the search bar inside it — at `max-w-lg` five chips wrapped onto a second line.

A chip is two lines: label and relative offset on top, the time below, with a `+1` / `−1` pill when the date over there isn't today's. The offset is the terse `shortOffsetLabel` form; everything else waits for the hover card.

**The row empties itself in the Dashboard.** `renderRow()` checks `getLayout()` and builds nothing when the answer is `dashboard`. Parked nodes are still in the document, so chips left in a parked row would keep ticking, invisibly, on every open tab.

### The Dashboard tiles

`syncCards()` tears down every `world-clock:<id>` card and re-registers the current list inside `batchCards()`, rather than diffing. Registration order decides position in the top row, so a diff would have to reorder anyway, and five cards is cheaper than getting that right. Their `order` starts at 100 — after every built-in widget, so adding a clock never displaces weather or Spotify from the head of the row.

A tile is a dial plus the time and a `+13h · Tomorrow` caption. It has no hover card; the tile already shows what the card would say.

### The hover card

Hovering (or focusing, or clicking) a chip opens `.world-clock-hovercard`: a 64px dial, the time at 27px, the zone's own date, then the label, the city and zone id with its UTC offset, and the relative offset in the accent colour.

It is **not** a `createPopover`. It is a plain fixed-position element on `document.body` with `pointer-events: none`, for two reasons: a popover joins the dismissal stack and installs a focus trap, neither of which a hover affordance wants; and taking the pointer would let the card steal the hover that opened it and flicker. Only one is ever open — `openHoverCard` is both the flag and the closer, the same shape the widget popovers use.

`positionHoverCard()` centres it over the chip and flips below when the top is tight. A resize or Escape closes it; so does `renderRow()`, since the chip it points at is about to be replaced.

## The tick

One `setTimeout`, re-aimed at the next second boundary after every run, drives every clock face on the page — chips, tiles, hover card, and the rows and picker inside the settings dialog. Two things are worth knowing:

**It self-cleans.** `onTick(owner, run)` checks `owner.isConnected` before each run and unregisters itself once the node is gone. Every host here is torn down by something it does not control — a layout switch, `refreshCards()`, a settings re-render — so binding the subscription's life to the node's is the only teardown that can't be missed. The timer stops when the last ticker leaves.

**It pauses in a hidden tab**, via `visibilitychange`, and catches up immediately on the way back so a tab hidden for an hour doesn't show a stale reading for up to a second. Weather and calendar still don't do this (see [widgets.md](widgets.md#refactor-candidates)).

It is second-aligned, unlike the main clock's plain 1000ms interval, so the displayed seconds never lag their true second.

## `timezones.ts`

### The catalogue

`zoneCatalogue()` reads `Intl.supportedValuesOf("timeZone")` — around 400 canonical zones — and falls back to `knownTimezones()` from `timezone-coords.ts` (the ~130 the weather widget already carries) where that API is missing. `Etc/*` is filtered out: `Etc/GMT+5` counts its offset backwards, which is a trap in a city picker, and plain `UTC` covers the same need honestly.

A zone's display name is derived from its id: last segment as the city, the rest as the region. No name table to keep current.

### Search

`searchZones(query)` ranks by city (exact, prefix, substring), then an `ALIASES` table, then region, then the raw id. The aliases are the queries a zone id doesn't answer — `nyc`, `pst`, `germany`, `bengaluru`, `gmt` — matched by prefix so `east` finds Eastern time. It's a modest table, not a country database; extend it when a search you'd expect to work doesn't.

An **empty query returns the popular list**, not all 400 rows, led by the viewer's own zone.

### The arithmetic

| Function | Answers |
|---|---|
| `zoneTime(tz, at)` | The wall clock over there, as numbers |
| `zoneOffsetMinutes(tz, at)` | The zone's offset from UTC |
| `relativeOffsetMinutes(tz, at)` | How far ahead of the viewer it is |
| `dayOffset(tz, at)` | Whole days between its date and the viewer's |
| `zoneDateLabel(tz, at)` | `"Sunday, Aug 31"`, or `"Tomorrow · Sep 1"` off-day |

Offsets are derived by formatting the instant in the zone and re-reading the result as if it were UTC. That is the only approach that gets a *historical* offset right — DST rules change, and a fixed offset table goes stale the next time a legislature moves a clock.

Every `Intl.DateTimeFormat` is memoised per zone; constructing them is the expensive part and the tick runs once a second per clock.

## The settings section

Bottom of the **General** tab, under the clock settings — that tab is already entirely about the clock.

A heading with an `n / 5` count, one row per clock, and an Add control. Each row is a drag handle, an editable label, the city and UTC offset, a live time, and a remove button that appears on hover.

**The label field looks like text until you touch it** — transparent border, no background — so the list reads as a list rather than a form. It commits on `change` and on Enter, reverts on Escape, and falls back to the zone's city if emptied.

**Reorder is HTML5 DnD** on the rows, the same idiom the todo list uses, not the pointer engine in [drag-and-drop.md](drag-and-drop.md). The row's `draggable` is switched off while the label has focus, so selecting text inside the field doesn't drag the row instead — `focus` and not `pointerdown`, because focus lands first and a drag can only start after a move.

**The Add control is a slot, not a popover.** Pressing *Add clock* replaces the button in place with a search field over a results list; Escape or the fifth clock collapses it back. A popover would have detached from its row the moment the settings panel scrolled. Each result shows the city, its region, its current time and its UTC offset; zones already added are disabled and say so. Arrow keys move the highlight, Enter picks, and picking keeps the field open (with the query cleared) until the list is full.

## Refactor candidates

- **The chip and the tile are two renderers of the same three facts.** They share `createClockFace` and `createReadout` but each assembles its own stack and caption; one builder taking a size would cover both.
- **`renderRow()` rebuilds every chip** when any clock changes, so renaming the fifth clock throws away and re-creates the other four, along with their tick subscriptions. Harmless at five, wrong in principle.
- **The alias table is hand-maintained.** It covers the searches that came to mind, which is not the same as the searches users will type. There is no country-to-zone data behind it.
- **`isDaytime` is a 6am–6pm rule.** `timezone-coords.ts` has coordinates for many of these zones and `weather.ts` already computes real sunrise and sunset; the dial could use them instead of guessing.
- **The hover card duplicates the popover's positioning maths.** `positionHoverCard()` is a smaller copy of what `createPopover` does, because that helper couldn't be reused without its stack and focus trap. Splitting the placement out of `createPopover` would remove the copy.
- **World clocks can't be rearranged from the page**, only from settings — `cardLayouts` and the Default grid's rearrange mode don't reach either the chip row or the Dashboard's top row.
