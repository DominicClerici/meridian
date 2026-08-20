# Overview

The documentation map for this project. Start here, then follow the link to the doc for whatever you're working on.

## What this is

A Chrome extension (Manifest V3) that replaces the new tab page with a custom startpage: a shortcut dock, a search bar, and a set of widgets (clock, todo, weather, Spotify, Google Calendar). Vanilla TypeScript, no frameworks, no runtime dependencies, no `node_modules` — the build is two standalone binaries in `bin/` driven by `build.sh`.

Everything renders into one page (`src/index.html`) from one bundle (`dist/index.js`). Modules are wired together by `src/index.ts`, which calls each subsystem's `initX()` once on `DOMContentLoaded`.

## Doc map

| Doc | Covers | Source files |
|---|---|---|
| [architecture.md](architecture.md) | Boot sequence, module graph, DOM ownership, build pipeline, manifest | `index.ts`, `index.html`, `build.sh`, `manifest.json` |
| [storage.md](storage.md) | The reactive store, every settings key, IndexedDB, raw localStorage caches | `store.ts`, `defaults.ts`, `idb.ts`, `browser.d.ts` |
| [design-system.md](design-system.md) | Design tokens, theme cascade, color palettes, squircles, fonts, icons | `styles.css`, `theme.ts`, `squircle.ts`, `icons/` |
| [components.md](components.md) | The UI kit — buttons, inputs, selects, dialogs, popovers, tooltips | `components.ts` |
| [settings-ui.md](settings-ui.md) | The settings dialog, and how to add a new setting end to end | `settings.ts` |
| [shortcuts.md](shortcuts.md) | Shortcut data model, CRUD, the dock, the shortcuts settings panel | `shortcuts.ts`, `dock.ts`, `shortcut-settings.ts` |
| [drag-and-drop.md](drag-and-drop.md) | The pointer-based drag engine for shortcuts and todos | `shortcut-drag.ts` |
| [search.md](search.md) | The search bar, the provider registry, and its two providers | `search.ts`, `search-provider-*.ts`, `url.ts` |
| [widgets.md](widgets.md) | The shared widget pattern (trigger + popover + cache), and the clock | `clock.ts` |
| [todos.md](todos.md) | Todo data model, pure operations, and the todo popover | `todos.ts`, `todo.ts` |
| [weather.md](weather.md) | Open-Meteo fetching, caching, and the hourly SVG chart | `weather.ts` |
| [spotify.md](spotify.md) | PKCE OAuth, player polling, playback controls | `spotify.ts` |
| [calendar.md](calendar.md) | Google OAuth, event fetching, the 1d/1w/1m views | `calendar.ts` |
| [recommendations.md](recommendations.md) | The browsing-history heatmap, scoring, and history import | `recommendations.ts`, `history-import.ts` |
| [backgrounds.md](backgrounds.md) | Background sources — mesh gradient, Unsplash, upload — and blob storage | `background.ts`, `mesh-bg.ts`, `color.ts`, `unsplash.ts`, `idb.ts` |

## Where do I find…

| If you're looking at… | Go to |
|---|---|
| A setting that won't persist, or syncs wrong across devices | [storage.md](storage.md) |
| Adding a brand new setting | [settings-ui.md](settings-ui.md#adding-a-setting) |
| Colors, spacing, or radii looking wrong | [design-system.md](design-system.md) |
| Light/dark mode, accent color, or `data-*` attributes on `<html>` | [design-system.md](design-system.md#the-theme-cascade) |
| A button/input/select that looks off-pattern | [components.md](components.md) |
| An icon that's missing or won't swap with the theme | [design-system.md](design-system.md#icons) |
| The row of icons at the bottom of the screen | [shortcuts.md](shortcuts.md#the-dock) |
| Dragging an item and it lands in the wrong place | [drag-and-drop.md](drag-and-drop.md) |
| The search bar, or results ranked wrong | [search.md](search.md) |
| A widget's popover not opening or closing | [widgets.md](widgets.md), [components.md](components.md#createpopover) |
| An OAuth/connect button | [spotify.md](spotify.md), [calendar.md](calendar.md) |
| The wallpaper, the animated mesh gradient, attribution credit, or a stale daily photo | [backgrounds.md](backgrounds.md) |
| The suggested sites at the left of the dock | [recommendations.md](recommendations.md) |
| Which module owns a given element ID | [architecture.md](architecture.md#dom-ownership) |
| Why a build output is missing a file | [architecture.md](architecture.md#build-pipeline) |

## Layout

```
build.sh              One-shot and watch builds → dist/
manifest.json         MV3 manifest: newtab override, OAuth client, permissions
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
  dock.ts             The dock UI
  shortcut-settings.ts  The shortcuts settings panel
  shortcut-drag.ts    Pointer-based drag-and-drop engine
  search.ts           Search bar + provider registry
  search-provider-engine.ts     Web-search-engine provider
  search-provider-shortcuts.ts  Shortcut-matching provider
  clock.ts            Clock widget
  todos.ts            Todo data model + pure operations
  todo.ts             Todo widget UI
  weather.ts          Weather widget
  spotify.ts          Spotify widget
  calendar.ts         Google Calendar widget
  recommendations.ts  History heatmap + scoring
  history-import.ts   Bulk-import shortcuts from browser history
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
