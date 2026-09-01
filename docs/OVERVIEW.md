# Overview

The documentation map for this project. Start here, then follow the link to the doc for whatever you're working on.

## What this is

A Chrome extension (Manifest V3) that replaces the new tab page with a custom startpage: a shortcut dock, a search bar, and a set of widgets (clock, todo, notepad, weather, Spotify, Google Calendar), arranged by one of three view modes. Vanilla TypeScript, no frameworks, no runtime dependencies, no `node_modules` — the build is two standalone binaries in `bin/` driven by `build.sh`.

Everything renders into one page (`src/index.html`) from one bundle (`dist/index.js`). Modules are wired together by `src/index.ts`, which calls each subsystem's `initX()` once on `DOMContentLoaded`.

## Doc map

| Doc | Covers | Source files |
|---|---|---|
| [architecture.md](architecture.md) | Boot sequence, module graph, DOM ownership, build pipeline, manifest | `index.ts`, `index.html`, `build.sh`, `manifest.json` |
| [storage.md](storage.md) | The reactive store, every settings key, IndexedDB, raw localStorage caches | `store.ts`, `defaults.ts`, `idb.ts`, `browser.d.ts` |
| [layouts.md](layouts.md) | The three view modes, the slot/card system, the Default layout's column packer, drag-to-rearrange, the Dashboard's tile row and side carousel, and the switch transition | `layout.ts`, `card-grid.ts`, `card-carousel.ts`, `layout-edit.ts`, `index.html` |
| [design-system.md](design-system.md) | Design tokens, theme cascade, color palettes, squircles, fonts, icons | `styles.css`, `theme.ts`, `squircle.ts`, `icons/` |
| [components.md](components.md) | The UI kit — buttons, inputs, selects, dialogs, popovers, tooltips | `components.ts` |
| [settings-ui.md](settings-ui.md) | The settings dialog, and how to add a new setting end to end | `settings.ts` |
| [shortcuts.md](shortcuts.md) | Shortcut data model, CRUD, the icon layer, the dock in all three layouts, the shortcuts settings panel | `shortcuts.ts`, `shortcut-icon.ts`, `dock*.ts`, `shortcut-settings.ts` |
| [drag-and-drop.md](drag-and-drop.md) | The pointer-based drag engine for the shortcuts grid, and the two others it doesn't share code with (todos use plain HTML5 DnD) | `shortcut-drag.ts`, `dock-drag.ts`, `layout-edit.ts` |
| [shortcut-import.md](shortcut-import.md) | Importing shortcuts from bookmarks, history, a pasted list or a file; JSON backup | `shortcut-import.ts`, `bookmarks-api.ts`, `ext-call.ts` |
| [search.md](search.md) | The search bar, the provider registry, and its two providers | `search.ts`, `search-provider-*.ts`, `url.ts` |
| [widgets.md](widgets.md) | The shared widget pattern (trigger + popover + cache), and the clock | `clock.ts` |
| [world-clocks.md](world-clocks.md) | Extra timezones beside the clock: the chip row, the Dashboard tiles, the hover card, the shared tick, and the timezone catalogue | `world-clocks.ts`, `timezones.ts` |
| [todos.md](todos.md) | Todo data model, pure operations, the widget body, and the calendar cross-link | `todos.ts`, `todo.ts` |
| [notepad.md](notepad.md) | The one freeform note: autosave, list continuation, and the shared body | `notepad.ts` |
| [weather.md](weather.md) | Open-Meteo fetching, caching, the metric selector, the container-responsive body, the 24-hour SVG chart, and the next sunrise/sunset row | `weather.ts`, `location.ts`, `timezone-coords.ts` |
| [spotify.md](spotify.md) | PKCE OAuth, player polling, playback controls | `spotify.ts` |
| [calendar.md](calendar.md) | Google OAuth, event fetching, the compressed 1d/1w timelines | `calendar.ts`, `google-auth.ts` |
| [github.md](github.md) | Device-flow OAuth, the GraphQL triage query, the grouped card | `github.ts`, `github-api.ts`, `github-auth.ts` |
| [linear.md](linear.md) | API-key auth, the one-round-trip issue query, the grouped card, inline status changes, the cycle burndown, and the GitHub cross-link | `linear.ts`, `linear-api.ts`, `linear-auth.ts`, `issue-links.ts` |
| [mail.md](mail.md) | The shared Google scope registry, per-tab unread fetching, in-place triage and Gmail search | `mail.ts`, `gmail-api.ts`, `google-auth.ts` |
| [browser-compat.md](browser-compat.md) | What de-Googled Chromium and Firefox break, how it's detected, how it degrades | `location.ts`, `google-auth.ts`, `capabilities.ts`, `history-api.ts` |
| [recommendations.md](recommendations.md) | The browsing-history heatmap and dock suggestion scoring | `recommendations.ts` |
| [backgrounds.md](backgrounds.md) | Background sources — mesh gradient, Unsplash, upload — and blob storage | `background.ts`, `mesh-bg.ts`, `color.ts`, `unsplash.ts`, `idb.ts` |

## Where do I find…

| If you're looking at… | Go to |
|---|---|
| A setting that won't persist, or syncs wrong across devices | [storage.md](storage.md) |
| Adding a brand new setting | [settings-ui.md](settings-ui.md#adding-a-setting) |
| Where a widget shows up in a given view mode | [layouts.md](layouts.md) |
| How many card columns show at a given window width, or a card landing in the wrong column | [layouts.md](layouts.md#the-packed-card-region) |
| Cycling widgets in the Dashboard's right-hand column, or which one it opens on | [layouts.md](layouts.md#the-side-carousel) |
| Rearranging widget cards, or an arrangement that won't stick | [layouts.md](layouts.md#rearranging) |
| A widget looking cramped in the Dashboard's top row | [layouts.md](layouts.md#the-tile-row) |
| The fade when switching view modes, or a layout flashing on load | [layouts.md](layouts.md#the-switch) |
| Colors, spacing, or radii looking wrong | [design-system.md](design-system.md) |
| Light/dark mode, accent color, or `data-*` attributes on `<html>` | [design-system.md](design-system.md#the-theme-cascade) |
| A button/input/select that looks off-pattern | [components.md](components.md) |
| An icon that's missing or won't swap with the theme | [design-system.md](design-system.md#icons) |
| The row of shortcut icons, wherever it is on screen | [shortcuts.md](shortcuts.md#the-dock) |
| The dock wrapping to two rows, scrolling, or fading at its edge | [shortcuts.md](shortcuts.md#laying-out-the-row) |
| Icons magnifying under the cursor in Immersive | [shortcuts.md](shortcuts.md#the-fisheye) |
| Reordering, right-clicking or editing a shortcut on the page | [shortcuts.md](shortcuts.md#dragging-on-the-page) |
| A shortcut showing the wrong colour, or a favicon that won't load | [shortcuts.md](shortcuts.md#the-icon-layer) |
| A shortcut that navigates somewhere odd, or won't save | [shortcuts.md](shortcuts.md#url-normalization) |
| Pulling shortcuts in from bookmarks, history or a file | [shortcut-import.md](shortcut-import.md) |
| Dragging an item and it lands in the wrong place | [drag-and-drop.md](drag-and-drop.md) |
| The search bar, or results ranked wrong | [search.md](search.md) |
| A widget's popover not opening or closing | [widgets.md](widgets.md), [components.md](components.md#createpopover) |
| A note that didn't save, or Enter doing something odd in the notepad | [notepad.md](notepad.md) |
| A world clock reading the wrong time, or its hover card | [world-clocks.md](world-clocks.md) |
| A city missing from the timezone picker, or a search that finds nothing | [world-clocks.md](world-clocks.md#search) |
| An OAuth/connect button | [spotify.md](spotify.md), [calendar.md](calendar.md), [github.md](github.md), [mail.md](mail.md), [linear.md](linear.md) |
| Google asking for the wrong permissions, or one widget signing another out | [mail.md](mail.md#the-shared-google-account) |
| An unread count that disagrees with the list under it | [mail.md](mail.md#counts) |
| A PR, review request or GitHub notification that won't show up | [github.md](github.md) |
| A Linear issue in the wrong section, or missing from the card | [linear.md](linear.md#bucketing-and-ranking) |
| An `ENG-123` badge on a PR, or a `#1842` badge on an issue | [linear.md](linear.md#the-github-cross-link) |
| Sign-in that hangs, or "Enable location" doing nothing | [browser-compat.md](browser-compat.md) |
| A `fetch` failing CORS from the extension page | [architecture.md](architecture.md#manifest) |
| The wallpaper, the animated mesh gradient, attribution credit, or a stale daily photo | [backgrounds.md](backgrounds.md) |
| The suggested sites at the left of the dock | [recommendations.md](recommendations.md) |
| Which module owns a given element ID | [architecture.md](architecture.md#dom-ownership) |
| Why a build output is missing a file | [architecture.md](architecture.md#build-pipeline) |

## Layout

```
build.sh              One-shot and watch builds → dist/
manifest.json         MV3 manifest: newtab override, OAuth client, permissions, host_permissions
bin/                  tailwindcss + esbuild standalone binaries (gitignored)
dist/                 Build output — load this folder as an unpacked extension
docs/                 This documentation set
  archive/            Superseded docs, kept for history
  superpowers/        Historical plans and specs (see below)
src/
  index.html          The single page. Static shell only; most UI is built in JS
  index.ts            Entrypoint — boot sequence and init calls
  styles.css          Tailwind v4 entry, design tokens, component CSS, @font-face
  store.ts            Reactive typed store over browser.storage + localStorage
  defaults.ts         Every settings key and its default value
  browser.d.ts        Ambient types for the browser/chrome extension APIs
  theme.ts            Applies data-theme/accent/bg/mode to <html>
  layout.ts           The three view modes: frames, singleton slots, card registry
  card-grid.ts        Responsive column packer for the Default layout's card region
  card-carousel.ts    One-at-a-time card region for the Dashboard's side column
  layout-edit.ts      Drag-to-rearrange mode for the Default layout's cards
  squircle.ts         Apple-style continuous corner geometry (currently unused)
  idb.ts              Tiny IndexedDB blob store for background images
  url.ts              URL prettifier
  components.ts       The UI kit
  settings.ts         The settings dialog
  icons/
    registry.ts       Theme-aware icon registry
    modern.ts         The "modern" theme's icon set
  fonts/              Gilroy (woff) and Red Hat Mono (ttf)
  shortcuts.ts        Shortcut/folder/tab data model + pure CRUD
  dock.ts             The dock UI — renders and lays out the row
  dock-drag.ts        Reordering shortcuts by dragging them on the page
  dock-magnify.ts     The Immersive dock's fisheye
  dock-menu.ts        The dock's context menu and inline editor
  shortcut-settings.ts  The shortcuts settings panel
  shortcut-icon.ts    One renderer for every shortcut/folder/tab icon
  shortcut-icon-picker.ts  The icon editor used by the detail pane
  shortcut-drag.ts    Pointer-based drag-and-drop engine for the grid
  shortcut-import.ts  Import from bookmarks/history/paste/file, and JSON backup
  search.ts           Search bar + provider registry
  search-provider-engine.ts     Web-search-engine provider
  search-provider-shortcuts.ts  Shortcut-matching provider
  clock.ts            Clock widget
  world-clocks.ts     Extra timezone clocks: chip row, Dashboard tiles, hover card
  timezones.ts        IANA zone catalogue, search, and offset/day arithmetic
  todos.ts            Todo data model + pure operations
  todo.ts             Todo widget UI
  notepad.ts          Notepad widget
  weather.ts          Weather widget
  location.ts         Location resolution chain: manual → device → stored → timezone
  timezone-coords.ts  IANA timezone → coarse coordinates table
  spotify.ts          Spotify widget
  calendar.ts         Google Calendar widget
  github.ts           GitHub widget — state, cards, rendering
  github-api.ts       GitHub GraphQL query, notifications, normalization
  github-auth.ts      GitHub device flow, PAT, authenticated transport
  linear.ts           Linear widget
  linear-api.ts       Linear GraphQL query, mapping, and mutations
  linear-auth.ts      Linear API key + PKCE OAuth, and the GraphQL transport
  issue-links.ts      The PR-URL join between the Linear and GitHub cards
  google-auth.ts      Google OAuth over both the brokered and redirect flows
  capabilities.ts     Browser capability probes for the Advanced settings report
  recommendations.ts  History heatmap + scoring
  history-api.ts      history.search/getVisits over Chrome's and Firefox's conventions
  background.ts       Background source switching + image application
  mesh-bg.ts          WebGL mesh-gradient background for the "color" source
  color.ts            sRGB ⇄ OKLCH conversion and gamut fitting
  unsplash.ts         Unsplash API client
```

## Conventions

- **These docs describe the code as it is**, including its problems. Each feature doc ends with a *Refactor candidates* section listing things that are genuinely wrong or awkward, so the rebuild has a starting point. If you fix one, delete the entry.
- **`docs/superpowers/` and `docs/archive/` are history, not truth.** Those plans, specs, and superseded docs record what was intended or true at the time they were written; several describe behavior that has since changed. Never treat them as a description of current behavior.
- **`README.md` is user-facing.** It documents installation and features for someone using the extension. These docs are for someone changing it.
- **Keep docs next to the change.** If you move a storage key, edit `storage.md` in the same commit.
