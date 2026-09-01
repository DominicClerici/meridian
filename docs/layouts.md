# Layouts

Three arrangements of the same page — Default, Dashboard, Immersive — plus the machinery that swaps between them at runtime.

**Source:** `src/layout.ts`, the `#layout-stage` / `#layout-parking` pair in `index.html`, `createCard()` in `components.ts`, `card-grid.ts` and `card-carousel.ts` for the two non-trivial regions, and one `registerCard()` call per widget.

## The three modes

| Mode | Value | Shape |
|---|---|---|
| **Default** | `"default"` (the default) | Clock and search bar at the top, the dock directly beneath the search bar, then a responsive masonry card region (4/3/2/1 columns). The dock is in-flow and scrolls away with the content. |
| **Dashboard** | `"dashboard"` | A row of compact tiles across the top; below it two columns — the left holds clock, search, shortcuts and the settings button, the right is a one-at-a-time widget carousel. The whole block sits high on the page rather than flush to the top — see *Vertical placement*. |
| **Immersive** | `"immersive"` | The original layout: clock and search on the page's 2/5 line, a magnifying glass dock pinned at the bottom, every widget behind a trigger button in the top-right corner. No cards. |

The mode lives in `store.sync.layout` and is stamped onto `<html>` as `data-layout`, alongside `data-theme` / `data-mode` / `data-accent`.

## Two element populations

Everything on the page is one of two things, and the distinction is the whole design:

**Singletons** — the search bar, the clock, the dock, the settings button, the widget-trigger cluster. These exist exactly once in `index.html`, and a layout switch **moves** them rather than rebuilding them. Element identity survives every switch, which is why no module needs a teardown path: listeners, store subscriptions, the drag engine, and the clock's interval all keep pointing at live nodes.

**Cards** — built fresh on every mount from a `render()` callback the widget registered. A card is the expanded form of a widget: the same body the immersive layout shows inside a popover.

### Singleton slots

`SINGLETONS` in `layout.ts` maps a slot name to an element ID:

| Slot | Element | Present in |
|---|---|---|
| `search` | `#search-wrapper` | all three |
| `clock` | `#clock` | all three (centred in Default and Immersive, left-aligned in Dashboard) |
| `worldClocks` | `#world-clocks` (the chip row) | Default and Immersive; parked in Dashboard, which shows tiles instead |
| `dock` | `#dock-wrapper` | all three — bottom-centre in Immersive, under the search bar in Default and Dashboard. It reads the layout back out of the store and re-presents itself; see [shortcuts.md](shortcuts.md#three-presentations-one-element). |
| `settings` | `#settings-open` | all three |
| `widgets` | `#widgets` (the trigger cluster) | Immersive only |

`slot(name, extraClass)` returns the element with its class reset to the markup's original value plus whatever the frame wants — so positioning is owned by the frame, not by `index.html`. That is why the base classes in `index.html` carry no placement: `#search-wrapper` is `w-full` and picks up its `max-w-*` from the frame, `#dock-wrapper` gets its `items-center` / `items-start` from the frame, and `#settings-open` is a bare button that Default and Immersive turn into a corner icon (`CORNER_SETTINGS`) while Dashboard leaves inline. Anything a frame doesn't claim ends up in `#layout-parking`, a `hidden` div that keeps parked nodes in the document so `getElementById` still finds them.

**A card may adopt a singleton** via `adoptSlot()`. No card does today — the Dashboard clock is a plain slot in the main column — but `reclaimSingletons(scope)` still runs before any card is discarded so an adopted node would be parked instead of destroyed with its card. Its scope is always a single card's subtree, never the whole stage: `refreshCards()` rebuilds the cards without rebuilding the frame, so a frame-owned singleton swept into parking there would stay hidden until the next layout switch.

## The card registry

A widget registers once, at module scope:

```ts
registerCard({
  id: "weather",
  title: "Weather",
  order: 20,
  regions: { default: "grid", dashboard: "top" },
  enabledKey: "weatherEnabled",
  render: buildWeatherBody,
})
```

| Field | Meaning |
|---|---|
| `id` | Key for `refreshCard(id)`; lands on the card element as `data-card`. |
| `title` | Card header text. |
| `order` | Sort order within a region. |
| `regions` | Which region this card mounts into, **per layout**. A layout that isn't listed doesn't show the card at all. |
| `span` | Optional column span per layout. A packed region (Default's `grid`) hands it to the packer; an unpacked region gets a Tailwind class from `SPAN_CLASSES`, which holds literal class names because the scanner can't see interpolated ones. |
| `enabledKey` | A `SyncSettings` key that gates the card. `registerCard` subscribes to it and rebuilds when it flips. |
| `isEnabled` | Extra gate for state the store doesn't hold — Spotify uses it for "something is playing, or the idle card is switched on". |
| `cardTitle` | Header text that tracks live state, for a card whose name changes with what it is showing — Spotify is *Now Playing* while something is, and *Spotify* when it isn't. Re-read on every `refreshCard`. Falls back to `title`. |
| `render` | Builds the body. Called on every mount and every `refreshCard`. |
| `renderTile` | Compact body for a tile region (Dashboard's top row). Falls back to `render` when absent. |
| `tileTitle` | Header text in tile form, winning over `cardTitle` there, when the card title is too generic for a glance — the weather tile names its city. Re-read on every `refreshCard`, so it can track live state. |
| `actions` | Optional control for the card header. Called after `render()`, so it can close over what `render` just built. No card uses it today — the todo card moved its `+` into a toolbar inside the body, so the immersive popover gets it too. |
| `onUnmount` | Called before the card is discarded. |

### Registering at runtime

Most widgets register once and stay registered. The world clocks don't: the user
adds and removes them, so `layout.ts` also exports

- **`unregisterCard(id)`** — drops the definition and releases the `enabledKey`
  subscription `registerCard` took out for it.
- **`batchCards(fn)`** — suppresses the rebuild each register/unregister would
  otherwise trigger and does one at the end. Replacing five world clocks would
  otherwise rebuild every card on the page ten times.

See [world-clocks.md](world-clocks.md#the-dashboard-tiles).

### Regions

| Region | Exists in | Shape | Where |
|---|---|---|---|
| `grid` | Default | packed (`card-grid.ts`) | The masonry region under the search bar |
| `top` | Dashboard | tiles | The row across the top |
| `main` | Dashboard | plain flex column | Under the shortcuts in the left column; empty today |
| `side` | Dashboard | carousel (`card-carousel.ts`) | The right column |

A region declares its shape with a data attribute on the host, which is the only
thing `mountCards` branches on: `data-packed` hands the cards to the grid packer,
`data-carousel` to the carousel, `data-variant="tile"` renders the compact body
and adds `.widget-tile`. Anything else is a plain append. A non-packed,
non-carousel region with no cards in it is `hidden` after the mount, so it
doesn't contribute a gap to its parent flexbox.

Current assignment:

| Card | Default | Dashboard | Immersive |
|---|---|---|---|
| Clock | — (slot above search) | — (slot in the main column) | — (slot above search) |
| World clocks | — (slot under the clock) | one `top` tile each | — (slot under the clock) |
| Now Playing | `grid` | `top` | floating card, bottom-right |
| Weather | `grid` | `top` | popover |
| Calendar | `grid` (spans 2) | `side` | popover |
| Todos | `grid` | `side` | popover |
| Notepad | `grid` | `side` | popover |

## Vertical placement

Dashboard and Immersive both place their content block off top-dead-centre: its
**midpoint sits at 2/5 of the viewport height**, so the page reads as balanced
without drifting into the dead centre.

Both do it the same way, with no measuring — centre a box that spans the top 4/5
of the screen and its centre *is* 2/5 of the screen:

- **Dashboard** — `.dash-aligner` (`styles.css`) wraps the whole block: it is
  `min-height: 80vh` with `justify-content: center`. The padded wrapper inside is
  symmetric, so its padding doesn't shift the midpoint.
- **Immersive** — the clock/search column is centred in an absolutely positioned
  box inset `top-0 bottom-[20%]` rather than the full stage. The dock and the
  widget triggers keep their own corners and are unaffected.

Once the Dashboard block outgrows 80vh the aligner grows with it, `safe center`
degrades to `start` rather than letting the top overflow off-screen, and the
block flows from the top of the (scrollable) root as it did before. The carousel
transitions its own height between slides, so cycling widgets slides the whole block smoothly
rather than jumping.

Note that the `min-height: 26rem` floor on `.dash-lower` is part of the block
being centred, so it also acts as a floor on how high the tile row can sit.

## The tile row

Dashboard's `top` region is a `flex-wrap` row of fixed-height, content-width
cards. The height (`.widget-tile` in `styles.css`) is what makes the row read as
one band; the width is intrinsic, so the row packs from the left and grows as
widgets are added rather than stretching two of them across the page.

A tile is not a smaller card, it is a different body: `renderTile()` drops the
chart, the metric picker and anything else that needs room, leaving one reading
and a caption. `refreshCard(id)` re-renders whichever form is mounted and
re-reads `tileTitle` — `layout.ts` remembers the variant per mounted card, so a
widget never has to know which one it is in.

## The side carousel

Dashboard's `side` region shows one card at a time.

**Source:** `src/card-carousel.ts`, the `.card-carousel*` rules in `styles.css`.

Every slide is absolutely positioned inside a viewport whose height is set from
the active slide and transitioned, so cycling animates between two intrinsic
heights instead of padding every widget out to the tallest one. A slide change
crossfades with a short directional slide: the outgoing card gets `is-exit-left`
/ `is-exit-right`, the incoming one is parked off-centre with its transition
suppressed (`is-enter`) and released in the same frame.

- **Chevrons** sit half over the card's left and right edges and fade in on
  hover, or when focused with the keyboard.
- **Dots** below the card stay visible whenever there is more than one widget —
  a standing hint that something is behind this one. The active dot elongates.
  Clicking one jumps straight to that widget.
- **Inactive slides are `inert` and `aria-hidden`.** At opacity 0 they would
  otherwise still be tabbable and still read aloud.
- **The active widget is remembered** in `store.local.dashboardWidget`, so a
  rebuild — or the next page load — comes back to the same one. A widget that
  has since been disabled falls back to the first.

With a single widget the chevrons and dots are hidden; with none, the whole
container is, and `.dash-lower` drops to a single column so the left half takes
the full width.

## The packed card region

Default's `grid` region is not a CSS grid. It carries `data-packed`, and `mountCards` hands its cards to `createCardGrid()` (`src/card-grid.ts`) instead of appending them into a grid flow. Every card is `position: absolute` and placed by measured geometry, so a short card never leaves a row-height hole under it.

**Source:** `src/card-grid.ts`, the `.card-grid-item` rules in `styles.css`, and the `packed` branch of `mountCards`.

### Column count

From `window.innerWidth`, not the container — the container is capped at `1600px` while the clock and search bar stay at `max-w-5xl`, so the cap alone can't tell the breakpoints apart.

| Viewport | Columns |
|---|---|
| ≥ 1700px | 4 |
| 1100–1699px | 3 |
| 640–1099px | 2 |
| < 640px | 1 |

A card's span is clamped to the column count, so Calendar still spans the full width at 2 columns and only collapses to one column below 640px.

### Packing

Cards are placed in order into the position whose top edge is highest; for a spanning card that top is the lowest point of the columns it covers. Ties go leftmost. This is a per-column height cursor, which is why the region can't be a flex row of column elements — a spanning card has to advance two cursors at once.

### Card order

The region's cards are **one linear list**, packed directly at whatever column
count the viewport calls for. There is no separate per-width arrangement and
nothing is derived from a wider one: 4 → 2 → 4 returns to the original layout
because every pass re-packs the same list.

That is what makes drag-to-rearrange honest. The arrangement a user drags at
three columns *is* what the stored order produces at three columns, so nothing
shifts under them the moment they hit Save.

The list comes from `store.sync.cardOrder`, applied by `applyCardOrder()` in
`layout.ts` before `setItems()`. A card the stored list doesn't name — a widget
added since the last rearrange — keeps its registration `order` and sorts after
every hand-placed card, so a new widget appears at the end instead of displacing
anything.

### Staying current

Three things trigger a repack, all coalesced into one `requestAnimationFrame`:

- a `ResizeObserver` on the region (container width changed),
- a `ResizeObserver` on each card (a widget loaded data and grew),
- `window`'s `resize` event — needed on its own, because crossing 1699 → 1700px changes the column count without changing the capped container width.

The per-card observer compares against the height the last pass recorded and ignores anything that matches, which is what keeps it from looping against the width it just set. Because the repack is on `rAF`, a hidden tab defers it until it is shown again; the initial `setItems()` lays out synchronously, so a tab opened in the background is still correct on first paint.

### Keeping a card current

Two update paths, and the choice matters:

- **`refreshCard(id)`** replaces the body wholesale by calling `render()` again. Right for stateless bodies — `weather.ts` calls it from `renderTrigger()`, so every fetch and state change reaches the card.
- **A rebuild closure** the widget holds onto. Right when the body owns view state that a re-render would throw away: `calendar.ts` keeps `cardBody.rebuild()` so a refresh doesn't reset the 1d/1w view and the nav offset.

`refreshCards()` (plural) rebuilds the whole set — use it when a card's *visibility* changes, not its contents.

## Rearranging

The user's own arrangement of the packed region, dragged on the real page.

**Source:** `src/layout-edit.ts`, the drag API on `createCardGrid()`, the
`html[data-editing="layout"]` rules in `styles.css`, and the Rearrange button in
`buildLayoutSelector()` (`settings.ts`).

### Entering and leaving

The Appearance tab's Layout section carries a **Rearrange widgets** button under
the three previews. It is hidden unless the layout is Default, and disabled
unless there are at least two cards to swap (`canEditLayout()`, re-checked every
time the dialog opens — which widgets are on is settled two tabs away).

Pressing it closes the settings dialog, because the thing being edited is the
page behind it. `startLayoutEdit()` then stamps `data-editing="layout"` on
`<html>`, which is the whole visual mode:

- `#settings-open` fades out — there is nowhere to go but Save or Cancel.
- Everything marked `data-edit-dim` (the whole head — clock, search bar and the
  dock beneath it — tagged in `frameDefault()`) drops to 30% and goes
  `pointer-events: none`.
- Every card's children go `pointer-events: none`, so the whole card is a
  handle and no widget control can swallow the grab.

A fixed Save / Cancel pair sits in the top-right corner. Save writes
`grid.getOrder()` to `store.sync.cardOrder`; Cancel calls `grid.setOrder()` with
the snapshot taken on entry. **Escape backs out one level** — an in-flight drag
first, then the mode. A layout change from another tab exits the mode, since the
switch takes the grid with it.

### The drag

Pointer Events, not HTML5 DnD, for the same reasons as
[drag-and-drop.md](drag-and-drop.md): the drag image has to be a live element,
and the grid has to animate while it moves. A `DRAG_THRESHOLD` of 3px separates
a drag from a click.

Three things move at once:

| | What | Owner |
|---|---|---|
| **The floating card** | A clone of the card at 25% opacity, `position: fixed`, pinned to the cursor at the offset it was grabbed by | `layout-edit.ts` |
| **The outline** | A dashed accent box marking the slot it would drop into, transitioned as the slot changes | `card-grid.ts` |
| **The other cards** | Slide aside, because the packer re-runs with the dragged card at its previewed index | `card-grid.ts` |

The lifted card **stays in the packing order** — that is what makes the others
move — and is only rendered invisible (`.is-card-dragging`). Its height still
feeds the packer, so the outline is always the size of the real thing.

**Choosing the slot.** `hover(x, y)` doesn't hit-test rectangles. For every
insertion index it re-packs the whole list with the dragged card at that index
and measures how far the card *would* land from the floating clone's centre;
closest wins. Spanning cards and the reflow they cause are therefore accounted
for by construction rather than by special cases. A `SNAP_STICKINESS` bonus of
28px on the index it is already at is what keeps it from flickering between two
equidistant slots.

**Dropping.** The clone flies to the outline's slot over 280ms while fading up
to full opacity; the real card is revealed and the clone removed at the end of
the flight, so the handoff is invisible. Escape mid-drag flies it back instead.
A second pickup during that flight settles the first one early rather than being
refused.

Near the top or bottom edge of the scrolling frame the drag scrolls the page,
and re-aims after each step, so the outline keeps tracking a cursor that is
holding still at the edge.

## The switch

`subscribeLayout()` watches `store.sync.layout`. On a change, `switchTo()`:

1. Closes every open popover (`closeAllPopovers()` — triggers are about to move).
2. Sets `pointer-events: none` on the stage and adds `.is-fading` → **250ms fade out**.
3. Waits a **100ms** beat.
4. `build(mode)` — unmount cards, park every singleton, clear the stage, stamp `data-layout`, build the new frame, mount the new cards.
5. Forces a reflow, removes `.is-fading` → **250ms fade in**, then restores pointer events.

Durations are `FADE_MS` / `PAUSE_MS` in `layout.ts`; the transition itself is `.layout-stage` in `styles.css`. A `switching` flag blocks re-entry, and `finishSwitch()` re-checks the stored mode afterward so a click made mid-transition isn't dropped. `prefers-reduced-motion` skips straight to step 4.

`applyLayout()` is the boot path — it runs in the `index.ts` module body, before first paint, so the correct layout is up on the first frame with no flash.

## Boot ordering

Card registration happens in the widget modules' **module bodies**, which ES module evaluation runs before `index.ts`'s body — so every card is registered by the time `applyLayout()` builds the first frame. That also means `render()` runs before `store.init()`: bodies must be safe against not-yet-reconciled data, which they are, since reads come from the localStorage-seeded cache and every widget re-renders its card once its data arrives.

## Adding a card

1. Extract the widget's content into a `buildXBody()` that returns an element, and have the popover use it too — one builder, two hosts.
2. Call `registerCard({...})` at module scope with the regions you want.
3. If one of those regions is a tile row, add a `renderTile()` — a full body squeezed into a 118px tile will not read as a glance.
4. Call `refreshCard("x")` (or hold a rebuild closure) wherever the widget's data changes.

## Refactor candidates

- **Some card bodies are still sized for popovers.** Weather and Calendar measure their host with a `ResizeObserver`; the todo list and the calendar scroller still cap themselves at a width-derived max height, which is why the carousel follows its slides' heights rather than stretching them to fill the column.
- **`refreshCard` re-renders the whole body.** Fine for the current widgets, but a card that holds focus or scroll position will lose it.
- **Cards are only in the top-level regions.** There's no nesting and no per-card size preference. Empty regions hide themselves in Dashboard, but Default's packed grid still leaves a blank area when every widget is off.
- **`span` only means something in a packed region.** Dashboard's `main` is the one plain region left, so `SPAN_CLASSES` exists for a case no card uses; `top` and `side` ignore `span` outright.
- **Dashboard's `main` region is empty.** Nothing mounts there. It is kept as the place a full-width panel under the shortcuts would go, and hides itself when unused.
- **Region assignment is hardcoded, and so is form.** `regions` is a literal in each widget, and `renderTile` fixes what it looks like there. Rearranging moves cards within Default's grid, but which *region* a card lives in — and whether it renders as a tile or a panel — is still fixed in code. Making that user-configurable means moving the map into the store and letting either form appear in either region: the carousel would have to accept a tile and the top row a full panel.
- **Only the Default grid can be rearranged.** Dashboard's `top` row and `side` carousel still order themselves by the registration `order`, and `cardOrder` doesn't apply to them.
- **No keyboard path to rearranging.** The drag is pointer-only. There is no way to move a card with the keyboard, and no screen-reader announcement of where a card would land.
- **A card's span is fixed.** The user can move Calendar but can't make it one column wide, or Weather two.
