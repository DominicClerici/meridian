# Architecture

How the app boots, how modules relate to each other, who owns which DOM node, and how the whole thing gets built.

## Boot sequence

Everything happens in `src/index.ts:1`. `dist/index.js` is loaded by a `<script>` tag that is the **last element in `<body>`**, so the static DOM already exists when the module body runs. That matters — the module body touches the DOM directly, before `DOMContentLoaded`.

**Phase 1 — module body, synchronous, before first paint**

1. `import "./icons/modern"` — side-effect import. Registers the `modern` icon set into the icon registry (`icons/registry.ts`). Any icon lookup before this would silently render nothing.
2. `applyTheme()` — reads `theme`, `accentColor`, `bgColor`, `mode` from the store and stamps `data-theme` / `data-accent` / `data-bg` / `data-mode` onto `<html>`. Reads are synchronous from the localStorage-seeded cache, so this beats the first paint and there's no flash. See [design-system.md](design-system.md#the-theme-cascade).
3. `subscribeTheme()` — re-applies those attributes when the settings change.
4. `applyBackground()` — applies the background image (Unsplash or upload) from IndexedDB, or starts the animated mesh gradient for the `color` source. See [backgrounds.md](backgrounds.md).
5. `subscribeBackground()`.
6. `applyLayout()` — reads `layout` from the store, stamps `data-layout` onto `<html>`, builds that mode's frame into `#layout-stage`, moves the shared singletons (search, clock, dock, widget triggers) into their slots, and mounts the widget cards. Runs here, before first paint, so the layout doesn't flash. See [layouts.md](layouts.md).
7. `subscribeLayout()` — runs the fade-out / pause / fade-in switch when `layout` changes.
8. Two icons are prepended into the static shell: `#settings-open` gets `settings`, `#todo-trigger` gets `todoList`.

Card registration happens even earlier: `registerCard()` runs in the module bodies of `clock.ts`, `weather.ts`, `todo.ts`, `spotify.ts`, and `calendar.ts`, which ES module evaluation runs before `index.ts`'s own body — so the registry is complete by the time `applyLayout()` builds the first frame.

**Phase 2 — `DOMContentLoaded`, async**

9. `await store.init()` — reconciles the in-memory cache against `browser.storage` and registers the cross-tab listener. Everything after this point sees authoritative values. See [storage.md](storage.md).
10. The `initX()` calls, **in this order**:

   ```
   initSettings()          creates the settings dialog + all its panels
   initDock()              renders the shortcut dock
   initShortcutSettings()  binds the shortcuts panel, starts the drag engine
   initHistoryImport()     binds the history-import dialog
   initSearch()            binds the search bar, registers providers
   initClock()
   initTodo()
   initWeather()
   initSpotify()
   initRecommendations()
   initCalendar()
   ```

### Order dependencies

Most of that list is order-independent, but two edges are real:

- **`initSettings()` must precede `initShortcutSettings()`.** `buildShortcutsPanel()` (`settings.ts:1203`) creates `#sc-tab-bar`, `#sc-item-list`, and `#sc-control-bar`; `initShortcutSettings()` looks all three up with a non-null assertion and will throw if they don't exist.
- **`initSettings()` must precede its own tail.** `initSettings()` builds the shortcuts panel (which contains `#settings-recommendations-enabled`) before wiring that checkbox at the end of the same function.

`initHistoryImport()` nominally depends on `initShortcutSettings()` having rendered a control bar containing `#sc-import-history` — but that button no longer exists anywhere in the codebase, so the function early-returns on every load. See *Refactor candidates*.

### The `initX()` contract

Every feature module exports exactly one `initX(): void`. The convention it follows:

- Called once, after `store.init()`.
- Looks up the DOM nodes it owns, renders initial state from `store.*.get()`.
- Subscribes to the store keys it cares about; the subscriptions live for the page's lifetime and are never torn down.
- Widgets additionally toggle their own trigger's `hidden` attribute from their `*Enabled` setting.

There is no teardown path and no re-init. Modules keep their state in module-level `let` bindings rather than instances.

## Module graph

```
                         defaults.ts  (types + default values; no imports but shortcuts/todos types)
                              │
                           store.ts   (reactive storage — the one true dependency)
                              │
        ┌──────────┬──────────┼───────────┬────────────┬─────────────┐
        │          │          │           │            │             │
     theme.ts  icons/     components.ts  search.ts  background.ts  feature
               registry.ts     │  ▲         │        + unsplash.ts  modules
                    ▲          │  │         │        + idb.ts          │
                    │          │  │         │        + mesh-bg.ts → color.ts
                    └──────────┘  │         │                          │
                              layout.ts ◄───┼──────────────────────────┘
                                            │       (widgets register cards)
                                   ┌────────┴────────┐
                          provider-engine    provider-shortcuts
```

Feature modules and what they pull in beyond `store`:

| Module | Depends on |
|---|---|
| `settings.ts` | `components`, `icons/registry`, `spotify`, `calendar`, `weather`, `location`, `capabilities`, `google-auth`, `unsplash`, `background`, `idb`, `defaults` |
| `dock.ts` | `components`, `icons/registry`, `recommendations`, `shortcuts` |
| `shortcut-settings.ts` | `components`, `icons/registry`, `shortcuts`, `shortcut-drag`, `url`, `defaults` |
| `shortcut-drag.ts` | `shortcuts` only — no store, no DOM lookups of its own |
| `search.ts` | its two providers (imported for their registration side effect) |
| `todo.ts` | `components`, `icons/registry`, `todos` |
| `weather.ts` | `components`, `icons/registry`, `location` |
| `calendar.ts` | `components`, `icons/registry`, `google-auth` |
| `spotify.ts` | `icons/registry` |
| `location.ts` | `timezone-coords` only — plus the store |
| `google-auth.ts` | the store only; wraps every `identity` call |
| `capabilities.ts` | `location`, `google-auth` — probes, renders nothing |
| `history-import.ts` | `shortcuts` |
| `layout.ts` | `components` only — it knows nothing about any widget; widgets register themselves |
| `background.ts` | `unsplash`, `idb`, `mesh-bg`, `defaults` |
| `mesh-bg.ts` | `color` only — no store; it reads the resolved `--page-bg` off `<html>` |

Notable shapes:

- **`shortcuts.ts` and `todos.ts` are pure.** No imports, no DOM, no store. They take a data structure and return a new one; the caller persists. This is the cleanest seam in the codebase.
- **`settings.ts` imports feature modules directly** (`spotify.authenticate`, `calendar.disconnect`, `background.setUploadedPhoto`). That's the main source of coupling — the settings dialog knows about the internals of five subsystems.
- **`squircle.ts` is imported by nothing.** It's live, correct, well-commented code with zero call sites; the squircle effect currently ships entirely through CSS `corner-shape`. See *Refactor candidates*.

## DOM ownership

`src/index.html` is a thin static shell. Most of the UI — the entire settings dialog, every popover, every dock item, and all three layout frames — is constructed in JavaScript at runtime.

The shell holds **no positioning**. Every element that a layout places lives inside `#layout-parking` with only its intrinsic classes; `layout.ts` moves it into the current frame and applies the positional classes. `#layout-stage` is the fixed, full-viewport container the frames are built into, and the thing that fades during a switch. See [layouts.md](layouts.md).

### Static shell → owning module

| Element | Created in | Owned by |
|---|---|---|
| `#layout-stage`, `#layout-parking` | `index.html` | `layout.ts` |
| `#settings-open` | `index.html` | icon by `index.ts`, click handler by `settings.ts` — fixed chrome, outside the stage so it never fades |
| `#widgets` | `index.html` | container only; children owned individually |
| `#calendar-trigger` | `index.html` | `calendar.ts` |
| `#weather-trigger` | `index.html` | `weather.ts` |
| `#todo-trigger`, `#todo-badge-count`, `#todo-badge-overdue` | `index.html` | icon by `index.ts`, rest by `todo.ts` |
| `#search-wrapper`, `#search-input`, `#search-results` | `index.html` | `search.ts`; positioned by `layout.ts` |
| `#clock` | `index.html` | `clock.ts`; positioned by `layout.ts`, adopted into a card in Dashboard |
| `#dock-wrapper`, `#dock`, `#dock-scroll`, `#dock-suggestions`, `#dock-divider`, `#dock-items`, `#dock-tabs` | `index.html` | `dock.ts`; positioned by `layout.ts` |
| `#history-import-dialog` and children | `index.html` | `history-import.ts` — **currently unreachable** |

### Runtime-created

| Element | Created in | Consumed by |
|---|---|---|
| `#mesh-bg` | `mesh-bg.ts` `startMesh()` — inserted as `<body>`'s first child | `mesh-bg.ts` only |
| Layout frames and their `[data-region]` containers | `layout.ts` frame builders | `layout.ts` |
| `[data-card]` widget cards | `layout.ts` `mountCards()` via `createCard()` | body from the widget's `render()` |
| `#bg-attribution` | `background.ts` `renderAttribution()` | `background.ts` only |
| `#settings-dialog` | `settings.ts:1333` via `createDialog()` | `settings.ts` |
| `#settings-nav`, `#settings-title`, `#settings-panels` | `settings.ts:1339`–`1372` | `settings.ts` |
| `[data-settings-tab="…"]` panels (general, shortcuts, appearance, widgets, advanced) | `settings.ts` | the matching `buildXTab()` |
| `#sc-tab-bar`, `#sc-item-list`, `#sc-control-bar` | `settings.ts:1203` `buildShortcutsPanel()` | `shortcut-settings.ts:875` |
| `#settings-recommendations-enabled` | `settings.ts:1229` | wired at `settings.ts:1410` |
| Popovers | `components.ts` `createPopover()` | appended to the nearest `<dialog>` ancestor, else `document.body` |

The cross-module handoffs (`settings.ts` builds containers that `shortcut-settings.ts` then queries by ID) are the fragile part of this arrangement — the coupling is a string literal with no type or compile-time check behind it.

## Build pipeline

`./build.sh` — one-shot build into `dist/`.
`./build.sh --watch` — same, then starts watchers and re-copies static files every second.

**Requires two standalone binaries in `bin/`:**

| Binary | Version |
|---|---|
| `bin/tailwindcss` | Tailwind CSS v4.2.2 standalone CLI |
| `bin/esbuild` | esbuild v0.27.4 |

If either is missing, `build.sh` prints the exact `curl` command for the current platform and exits 1. Platform is detected from `uname -s`; Windows shells get a `.exe` suffix.

**What a build does** (`build.sh:66`):

1. `rm -rf dist && mkdir -p dist`
2. Copy static: `manifest.json`, `src/index.html`, `src/fonts/` → `dist/`
3. `tailwindcss -i src/styles.css -o dist/styles.css --minify`
4. `esbuild src/index.ts --bundle --outfile=dist/index.js --minify`

Output is exactly four things: `dist/manifest.json`, `dist/index.html`, `dist/index.js`, `dist/styles.css`, plus `dist/fonts/`.

**Type-checking is not part of the build.** esbuild strips types without checking them, so a type error will happily ship. Run `npx tsc --noEmit` (or lean on your editor's `tsconfig.json` integration) separately.

There is no test suite, no linter, and no CI.

### Loading it

1. `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `dist/`

## Manifest

`manifest.json` — Manifest V3.

| Field | Value | Why |
|---|---|---|
| `chrome_url_overrides.newtab` | `index.html` | The whole point |
| `permissions` | `storage` | The store's `browser.storage.sync` / `.local` backing |
| | `geolocation` | Weather coordinates, where the browser can supply them |
| | `identity` | OAuth for Spotify and Google Calendar (`launchWebAuthFlow`, `getAuthToken`) |
| | `history` | Recommendations heatmap + history import |
| `host_permissions` | the nine API hosts the app calls | Lets extension-page `fetch` bypass CORS instead of depending on each third party's headers |
| `oauth2.client_id` | a Google OAuth client | Calendar via `getAuthToken`. Only used where the browser has a Google account service |
| `oauth2.scopes` | `calendar.readonly` | |
| `key` | a fixed public key | Pins the extension ID, which pins the OAuth redirect URI |

**`host_permissions` is load-bearing, not belt-and-braces.** Without it every cross-origin call from the page is an ordinary CORS request carrying a `chrome-extension://` origin, and succeeds only if the remote host happens to allow it. Adding a host here is part of adding an API call.

The `oauth2` block is now a fast path rather than the mechanism: when `identity.getAuthToken` doesn't work, `google-auth.ts` falls back to a redirect flow driven by the `googleClientId` setting. See [browser-compat.md](browser-compat.md#google-sign-in).

No background service worker and no content scripts — the commented-out `cp src/service-worker.js` line in `build.sh:71` is a leftover from a design that was never shipped.

## Refactor candidates

- **`initHistoryImport()` is dead.** It looks up `#sc-import-history` (`history-import.ts:236`) and early-returns when absent — and nothing creates that button; `renderControlBar()` in `shortcut-settings.ts:723` has no import control. `#sc-tab-select` (`history-import.ts:123`) is likewise gone. So `#history-import-dialog` in `index.html:96` is orphaned markup and the entire 244-line module is unreachable. Either restore the entry point or delete the feature.
- **`squircle.ts` has no call sites.** 159 lines of correct, carefully documented geometry that nothing imports. Either use it where `corner-shape` can't reach (SVG, canvas, masks) or drop it.
- **Cross-module DOM handoff by ID string.** `settings.ts` builds `#sc-*` containers that `shortcut-settings.ts` queries with `!`. Nothing catches a rename. Passing the elements as arguments to `initShortcutSettings(tabBar, itemList, controlBar)` would make the dependency explicit and typed.
- **No teardown.** Every `subscribe()` returns an unsubscribe function; none of the feature modules keep it. Layout switching is built around that fact — it moves existing elements rather than rebuilding them — but it still means no module can be re-initialized.
- **`settings.ts` reaches into five subsystems.** At 1420 lines it mixes dialog chrome, tab layout, and per-feature control logic. Splitting each `buildXTab()` into the feature module it configures would cut most of the import graph's coupling.
