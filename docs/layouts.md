# Layouts

Three arrangements of the same page — Default, Dashboard, Immersive — plus the machinery that swaps between them at runtime.

**Source:** `src/layout.ts`, the `#layout-stage` / `#layout-parking` pair in `index.html`, `createCard()` in `components.ts`, and one `registerCard()` call per widget.

## The three modes

| Mode | Value | Shape |
|---|---|---|
| **Default** | `"default"` (the default) | Clock and search bar at the top, a 3-column card grid beneath, dock pinned bottom-center. |
| **Dashboard** | `"dashboard"` | A row of cards across the top; below it a 3-column grid — search and the dock span the first two columns with cards under them, one column of cards on the right. |
| **Immersive** | `"immersive"` | The original layout: clock and search centered, dock pinned at the bottom, every widget behind a trigger button in the top-right corner. No cards. |

The mode lives in `store.sync.layout` and is stamped onto `<html>` as `data-layout`, alongside `data-theme` / `data-mode` / `data-accent`.

## Two element populations

Everything on the page is one of two things, and the distinction is the whole design:

**Singletons** — the search bar, the clock, the dock, the widget-trigger cluster. These exist exactly once in `index.html`, and a layout switch **moves** them rather than rebuilding them. Element identity survives every switch, which is why no module needs a teardown path: listeners, store subscriptions, the drag engine, and the clock's interval all keep pointing at live nodes.

**Cards** — built fresh on every mount from a `render()` callback the widget registered. A card is the expanded form of a widget: the same body the immersive layout shows inside a popover.

### Singleton slots

`SINGLETONS` in `layout.ts` maps a slot name to an element ID:

| Slot | Element | Present in |
|---|---|---|
| `search` | `#search-wrapper` | all three |
| `clock` | `#clock` | Default and Immersive as a slot; Dashboard adopts it into the Clock card |
| `dock` | `#dock-wrapper` | all three |
| `widgets` | `#widgets` (the trigger cluster) | Immersive only |

`slot(name, extraClass)` returns the element with its class reset to the markup's original value plus whatever the frame wants — so positioning is owned by the frame, not by `index.html`. Anything a frame doesn't claim ends up in `#layout-parking`, a `hidden` div that keeps parked nodes in the document so `getElementById` still finds them.

**A card may adopt a singleton** via `adoptSlot()` — the Dashboard clock card does. `reclaimSingletons(scope)` runs before any card is discarded so the adopted node is parked instead of being destroyed with its card.

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
| `span` | Optional column span per layout (`SPAN_CLASSES` holds the literal Tailwind classes — the scanner can't see interpolated ones). |
| `enabledKey` | A `SyncSettings` key that gates the card. `registerCard` subscribes to it and rebuilds when it flips. |
| `isEnabled` | Extra gate for state the store doesn't hold — Spotify uses it for "something is playing". |
| `render` | Builds the body. Called on every mount and every `refreshCard`. |
| `actions` | Optional control for the card header (the todo card's + button). Called after `render()`, so it can close over what `render` just built. |
| `onUnmount` | Called before the card is discarded. |

### Regions

| Region | Exists in | Where |
|---|---|---|
| `grid` | Default | The 3-column grid under the search bar |
| `top` | Dashboard | The row across the top |
| `main` | Dashboard | Columns 1–2, below search and the dock |
| `side` | Dashboard | Column 3 |

Current assignment:

| Card | Default | Dashboard | Immersive |
|---|---|---|---|
| Clock | — (slot above search) | `top` | — (slot above search) |
| Weather | `grid` | `top` | popover |
| Calendar | `grid` (spans 2) | `main` | popover |
| Todos | `grid` | `side` | popover |
| Now Playing | `grid` | `side` | floating card, bottom-right |

### Keeping a card current

Two update paths, and the choice matters:

- **`refreshCard(id)`** replaces the body wholesale by calling `render()` again. Right for stateless bodies — `weather.ts` calls it from `renderTrigger()`, so every fetch and state change reaches the card.
- **A rebuild closure** the widget holds onto. Right when the body owns view state that a re-render would throw away: `calendar.ts` keeps `cardBody.rebuild()` so a refresh doesn't reset the 1d/1w/1m view and the nav offset.

`refreshCards()` (plural) rebuilds the whole set — use it when a card's *visibility* changes, not its contents.

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
3. Call `refreshCard("x")` (or hold a rebuild closure) wherever the widget's data changes.

## Refactor candidates

- **Region assignment is hardcoded.** `regions` is a literal in each widget. Making placement user-configurable means moving that map into the store and adding drag-to-rearrange.
- **Card bodies are sized for popovers.** The calendar body was 660px wide in a popover and now stretches to its column; the clock renders at its configured font size inside a card that may be narrower than the digits. Both want layout-aware sizing.
- **`refreshCard` re-renders the whole body.** Fine for the current widgets, but a card that holds focus or scroll position will lose it.
- **Cards are only in the top-level regions.** There's no nesting, no per-card size preference, and no empty-region handling — a layout with no enabled widgets shows an empty grid.
