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
6. `applyLayout()` — reads `layout` from the store, stamps `data-layout` onto `<html>`, builds that mode's frame into `#layout-stage`, moves the shared singletons (search, clock, dock, settings button, widget triggers) into their slots, and mounts the widget cards. Runs here, before first paint, so the layout doesn't flash. See [layouts.md](layouts.md).
7. `subscribeLayout()` — runs the fade-out / pause / fade-in switch when `layout` changes.
8. Icons are prepended into the static shell: `#settings-open` gets `settings`, `#todo-trigger` gets `todoList`, `#notepad-trigger` gets `notepad`, `#github-trigger` gets `github`, `#linear-trigger` gets `linear`, `#mail-trigger` gets `mail`.

Card registration happens even earlier: `registerCard()` runs in the module bodies of `weather.ts`, `todo.ts`, `notepad.ts`, `spotify.ts`, `calendar.ts`, `github.ts`, `linear.ts` and `mail.ts` (the last three twice each — a card and a Dashboard tile), which ES module evaluation runs before `index.ts`'s own body — so the registry is complete by the time `applyLayout()` builds the first frame.

**Phase 2 — `DOMContentLoaded`, async**

9. `await store.init()` — reconciles the in-memory cache against `browser.storage` and registers the cross-tab listener. Everything after this point sees authoritative values. See [storage.md](storage.md).
10. The `initX()` calls, **in this order**:

   ```
   initSettings()          creates the settings dialog + all its panels
   initDock()              renders the shortcut dock
   initShortcutSettings()  binds the shortcuts panel, starts the drag engine
   initSearch()            binds the search bar, registers providers
   initClock()
   initTodo()
   initNotepad()
   initWeather()
   initSpotify()
   initRecommendations()
   initCalendar()
   ```

### Order dependencies

Most of that list is order-independent, but two edges are real:

- **`initSettings()` must precede `initShortcutSettings()`.** `buildShortcutsPanel()` creates `#sc-panel`; `initShortcutSettings()` looks it up with a non-null assertion and will throw if it doesn't exist. It then builds the rail, grid and detail pane inside it itself, so `#sc-panel` is the only ID crossing the two modules.
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

`settings.ts` and `weather.ts` import each other — settings calls `refreshWeather()`, weather calls `openSettings()` to deep-link at its own section. Both are hoisted function declarations called only after boot, so the cycle resolves; nothing either module runs at evaluation time touches the other.

| Module | Depends on |
|---|---|
| `settings.ts` | `components`, `icons/registry`, `spotify`, `calendar`, `weather`, `location`, `capabilities`, `google-auth`, `unsplash`, `background`, `idb`, `defaults` |
| `dock.ts` | `components`, `recommendations`, `shortcuts`, `shortcut-icon`, `dock-drag`, `dock-magnify`, `dock-menu` |
| `dock-drag.ts` | `components`, `shortcuts` |
| `dock-magnify.ts` | — (leaf) |
| `dock-menu.ts` | `components`, `icons/registry`, `shortcuts`, `shortcut-icon-picker`, `settings`, `url` |
| `shortcut-settings.ts` | `components`, `icons/registry`, `shortcuts`, `shortcut-icon`, `shortcut-icon-picker`, `shortcut-drag`, `shortcut-import`, `idb`, `url`, `store` |
| `shortcut-icon.ts` | `icons/registry`, `idb`, `url` — no store |
| `shortcut-import.ts` | `components`, `shortcuts`, `shortcut-icon`, `history-api`, `bookmarks-api`, `url`, `store` |
| `shortcut-drag.ts` | `shortcuts` only — no store, no DOM lookups of its own |
| `search.ts` | its two providers (imported for their registration side effect) |
| `todo.ts` | `components`, `icons/registry`, `todos`, `layout`, `store` |
| `notepad.ts` | `components`, `icons/registry`, `layout`, `defaults`, `store` |
| `weather.ts` | `components`, `icons/registry`, `layout`, `location`, `settings` |
| `calendar.ts` | `components`, `icons/registry`, `google-auth` |
| `spotify.ts` | `icons/registry` |
| `location.ts` | `timezone-coords` only — plus the store |
| `google-auth.ts` | the store only; wraps every `identity` call |
| `capabilities.ts` | `location`, `google-auth` — probes, renders nothing |
| `history-api.ts` | nothing — wraps every `history` call for both browsers |
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
| `#settings-open` | `index.html` | icon by `index.ts`, click handler by `settings.ts`; positioned by `layout.ts` — a corner icon in Default and Immersive, an icon-plus-label at the foot of the main column in Dashboard |
| `#widgets` | `index.html` | container only; children owned individually |
| `#calendar-trigger` | `index.html` | `calendar.ts` |
| `#weather-trigger` | `index.html` | `weather.ts` |
| `#todo-trigger`, `#todo-badge-count`, `#todo-badge-overdue` | `index.html` | icon by `index.ts`, rest by `todo.ts` |
| `#notepad-trigger`, `#notepad-badge` | `index.html` | icon by `index.ts`, rest by `notepad.ts` |
| `#github-trigger`, `#github-badge` | `index.html` | icon by `index.ts`, rest by `github.ts` |
| `#linear-trigger`, `#linear-badge` | `index.html` | icon by `index.ts`, rest by `linear.ts` |
| `#mail-trigger`, `#mail-badge` | `index.html` | icon by `index.ts`, rest by `mail.ts` |
| `#search-wrapper`, `#search-input`, `#search-results` | `index.html` | `search.ts`; positioned by `layout.ts` |
| `#clock` | `index.html` | `clock.ts`; positioned by `layout.ts` |
| `#dock-wrapper`, `#dock`, `#dock-scroll`, `#dock-groups`, `#dock-suggestions`, `#dock-divider`, `#dock-items`, `#dock-tabs`, `#dock-tabs-indicator` | `index.html` | `dock.ts`; positioned by `layout.ts`, laid out row-by-row by `dock.ts` itself |

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
| `#sc-panel` | `settings.ts` `buildShortcutsPanel()` | `shortcut-settings.ts` `initShortcutSettings()` |
| `#settings-recommendations-enabled` | `settings.ts:1229` | wired at `settings.ts:1410` |
| Popovers | `components.ts` `createPopover()` | appended to the nearest `<dialog>` ancestor, else `document.body` |

The cross-module handoff (`settings.ts` builds a container that `shortcut-settings.ts` then queries by ID) is the fragile part of this arrangement — the coupling is a string literal with no type or compile-time check behind it. It is now one ID rather than three.

## Build pipeline

`./build.sh` — one-shot build into `dist/`.
`./build.sh --watch` — same, then starts watchers and re-copies static files every second.
`./build.sh --firefox` — the Firefox build, into `dist-firefox/`. Combines with `--watch`.

The two targets differ in exactly one file: the manifest. Everything else — bundle, CSS, fonts, HTML — is byte-identical.

**Requires two standalone binaries in `bin/`:**

| Binary | Version |
|---|---|
| `bin/tailwindcss` | Tailwind CSS v4.2.2 standalone CLI |
| `bin/esbuild` | esbuild v0.27.4 |

If either is missing, `build.sh` prints the exact `curl` command for the current platform and exits 1. Platform is detected from `uname -s`; Windows shells get a `.exe` suffix.

**What a build does:**

1. `rm -rf $OUT && mkdir -p $OUT`
2. Copy static: `$MANIFEST` → `$OUT/manifest.json`, plus `src/index.html` and `src/fonts/`
3. `tailwindcss -i src/styles.css -o $OUT/styles.css --minify`
4. `esbuild src/index.ts --bundle --outfile=$OUT/index.js --minify`

Output is exactly four things: `manifest.json`, `index.html`, `index.js`, `styles.css`, plus `fonts/`.

**Type-checking is not part of the build.** esbuild strips types without checking them, so a type error will happily ship. Run `npx tsc --noEmit` (or lean on your editor's `tsconfig.json` integration) separately.

There is no test suite, no linter, and no CI.

### Loading it

**Chrome:** `chrome://extensions` → enable Developer mode → Load unpacked → select `dist/`.

**Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist-firefox/manifest.json`. It's removed on browser restart; a permanently installed copy has to be signed.

Firefox keys each add-on's `moz-extension://` UUID to its add-on ID in the `extensions.webextensions.uuids` pref, so `browser_specific_settings.gecko.id` also makes `identity.getRedirectURL()` stable across reloads — an OAuth client registered against it keeps matching. The UUID is still per *profile*, so a second machine or a fresh profile needs its own registration.

## Manifest

Two literal manifests, one per target — Manifest V3 both.

| Field | Value | Why |
|---|---|---|
| `chrome_url_overrides.newtab` | `index.html` | The whole point |
| `permissions` | `storage` | The store's `browser.storage.sync` / `.local` backing |
| | `geolocation` | Weather coordinates, where the browser can supply them |
| | `identity` | OAuth for Spotify and for Google — Calendar and Gmail share one token (`launchWebAuthFlow`, `getAuthToken`), scoped per feature ([mail.md](mail.md#the-shared-google-account)). **Not** GitHub — the device flow needs no redirect URI ([github.md](github.md#the-device-flow)) |
| | `history` | Recommendations heatmap + history import |
| `optional_permissions` | `bookmarks` | Requested from a click in the shortcuts import dialog, so installing never prompts for it and an update never disables the extension. See [browser-compat.md](browser-compat.md#optional-permissions) |
| `host_permissions` | the API hosts the app calls, `api.linear.app` and `linear.app` among them | Lets extension-page `fetch` bypass CORS instead of depending on each third party's headers |
| `oauth2.client_id` | a Google OAuth client | Calendar via `getAuthToken`. Only used where the browser has a Google account service |
| `oauth2.scopes` | `calendar.readonly` | |
| `key` | a fixed public key | Chrome only. Pins the extension ID, which pins the OAuth redirect URI |
| `browser_specific_settings.gecko.id` | `startpage@meridian` | Firefox only. Firefox refuses `storage.sync` for an add-on with no explicit ID |

**`host_permissions` is load-bearing, not belt-and-braces.** Without it every cross-origin call from the page is an ordinary CORS request carrying a `chrome-extension://` origin, and succeeds only if the remote host happens to allow it. Adding a host here is part of adding an API call.

The `oauth2` block is now a fast path rather than the mechanism: when `identity.getAuthToken` doesn't work, `google-auth.ts` falls back to a redirect flow driven by the `googleClientId` setting. See [browser-compat.md](browser-compat.md#google-sign-in).

### Why two files rather than one generated

`manifest.firefox.json` drops `key` and `oauth2`, which Firefox doesn't implement and AMO's linter flags as unknown properties, and adds `browser_specific_settings`, which Chrome warns about in turn. Generating the variant at build time would mean parsing JSON in `build.sh`, and the build is deliberately free of anything but bash and the two vendored binaries — it supports Windows shells where `python3`/`jq` aren't a safe assumption. Two short files that sit side by side make the drift visible instead. **Change one, check the other.**

No background service worker and no content scripts — the commented-out `cp src/service-worker.js` line in `build.sh` is a leftover from a design that was never shipped.

## Refactor candidates


- **`squircle.ts` has no call sites.** 159 lines of correct, carefully documented geometry that nothing imports. Either use it where `corner-shape` can't reach (SVG, canvas, masks) or drop it.
- **Cross-module DOM handoff by ID string.** `settings.ts` builds `#sc-panel`, which `shortcut-settings.ts` queries with `!`. Nothing catches a rename. Passing the element as an argument to `initShortcutSettings(panel)` would make the dependency explicit and typed.
- **No teardown.** Every `subscribe()` returns an unsubscribe function; none of the feature modules keep it. Layout switching is built around that fact — it moves existing elements rather than rebuilding them — but it still means no module can be re-initialized.
- **`settings.ts` reaches into five subsystems.** At 1420 lines it mixes dialog chrome, tab layout, and per-feature control logic. Splitting each `buildXTab()` into the feature module it configures would cut most of the import graph's coupling.
