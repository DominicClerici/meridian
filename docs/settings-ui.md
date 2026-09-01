# Settings UI

The settings dialog. **File:** `src/settings.ts` (2986 lines — the largest module in the app).

Entry point `initSettings()` (`settings.ts:1332`) is called first in the boot sequence because it constructs DOM that other modules then look up by ID — see [architecture.md](architecture.md#order-dependencies).

## Structure

The dialog is built entirely at runtime by `createDialog()` ([components.md](components.md#createdialog)), 900×600 with 95vw/85vh caps. It grew from 725×480 to fit the shortcuts panel's three columns — see [shortcuts.md](shortcuts.md#the-settings-panel):

```
#settings-dialog (.dialog-surface)
└─ body  .flex
   ├─ #settings-nav        w-16 icon rail, one button per tab + sliding indicator
   └─ div .flex-1
      ├─ header            #settings-title + close button
      └─ #settings-panels  one [data-settings-tab] panel per tab, all but one hidden
```

Five tabs, defined in the `TABS` array (`settings.ts:33`):

| Tab | Panel built by | Contains |
|---|---|---|
| General | `buildGeneralTab()` | All seven clock settings, then the world-clock list |
| Shortcuts | `buildShortcutsPanel()` | An empty `#sc-panel` for `shortcut-settings.ts`, plus a footer with the recommendations toggle and open-in select |
| Appearance | `buildAppearanceTab()` | Theme, layout, accent, mode, and the three background accordions |
| Widgets | `buildWidgetsTab()` | Search, Todo, Notepad, Weather, Spotify, Calendar, GitHub accordions |
| Advanced | `buildAdvancedPanel()` | Unsplash API key, Google / Spotify / GitHub OAuth client IDs, the GitHub token field, browser-capability report |

Two construction styles coexist. `buildShortcutsPanel()` and `buildAdvancedPanel()` **return** a panel element that `initSettings()` appends; `buildGeneralTab()`, `buildAppearanceTab()`, and `buildWidgetsTab()` **query** for their already-appended panel via `document.querySelector('[data-settings-tab="…"]')` and fill it. That's why the first two run inline in `initSettings()` while the other three are called afterward.

### Deep-linking into a section

`openSettings(tabId?, sectionId?)` is the exported way in from anywhere else in the app. It opens the dialog, switches to the tab, then runs a hook registered under `sectionId` in `sectionHooks` — the weather widget uses `openSettings("widgets", "weather")` from its "Set a location" states and from the inline *settings* link in its approximate-location notice. The GitHub and Linear cards use `openSettings("advanced")` from their connect panels when the OAuth path needs a client ID that isn't set yet.

A section registers itself where it is built:

```ts
sectionHooks["weather"] = () => {
  if (weatherAcc.content.hidden) weatherAcc.toggle()
  weatherAcc.container.scrollIntoView({ block: "start", behavior: "smooth" })
}
```

Only the weather accordion registers one today. The hook runs inside a `requestAnimationFrame` so the panel it lives in has been laid out before anything scrolls.

### Navigation

`buildNav()` (`settings.ts:1063`) creates one 48px icon button per tab plus a `.settings-nav-indicator` accent bar. The indicator is positioned by arithmetic — `indicatorTop(index) = 12 + index * 52 + 14` — which hard-codes the button height and gap. Because a `<dialog>` has no layout until it's shown, `initSettings()` re-runs `refreshIndicator()` inside a `requestAnimationFrame` after `open()` (`settings.ts:1403`).

`switchTab()` cross-fades panels: the outgoing panel is absolutely positioned over the incoming one, both fade over 50ms, and a `switching` flag blocks re-entry until the animation finishes. The title cross-fades on the same schedule. Each nav button also carries a `.settings-tooltip` that appears after a 400ms hover.

## The settingsRow helper

```ts
settingsRow(label: string, control: HTMLElement, opts?: { hidden?: boolean }): HTMLElement
```

`settings.ts:41`. Produces a label-left / control-right row with a bottom hairline that's suppressed on the last child. This is the standard unit of the settings UI, but it's only used in the General, Search, Todo, Notepad, Weather, Spotify, and Calendar sections — the Appearance tab and the Advanced panel build their rows by hand.

Rows returned by `settingsRow` are also how conditional settings are hidden. `buildGeneralTab()` keeps references and toggles `.hidden` from a parent setting's change handler:

```ts
const clock24h = createCheckbox("", store.sync.get("clock24Hour"), (v) => {
  store.sync.set("clock24Hour", v)
  ampmRow.hidden = v          // AM/PM is meaningless in 24-hour mode
})
```

`clockShowDate` gates `dateFormatRow` the same way. Both are re-applied inside the corresponding `store.sync.subscribe` so a change from another tab hides the row too.

## Adding a setting

End to end, four steps.

**1. Declare it** in `src/defaults.ts` — key + type in the interface, value in the defaults object. See [storage.md](storage.md#adding-a-setting).

```ts
export type SyncSettings = {
  // …
  clockShowTimezone: boolean
}

export const syncDefaults: SyncSettings = {
  // …
  clockShowTimezone: false,
}
```

**2. Add a control** to the right `buildXTab()`, following the three-part pattern every setting here uses — initialize from the store, write on change, subscribe back:

```ts
const tz = createCheckbox("", store.sync.get("clockShowTimezone"), (v) =>
  store.sync.set("clockShowTimezone", v)
)
wrapper.appendChild(settingsRow("Show timezone", tz))

store.sync.subscribe("clockShowTimezone", (v) => {
  (tz as any).setChecked(v)
})
```

The subscription is what keeps a second open tab (and any programmatic write) in sync. Setters on the kit's controls deliberately don't fire their change callbacks, so this can't loop — see [components.md](components.md).

For a select, the same shape with `createSelect({ options, value, onChange })` and `sel.value = v` in the subscriber.

**3. Consume it** in the feature module: read with `get()` for the initial render, and `subscribe()` to re-render on change.

**4. Document it** — add the key to the inventory table in [storage.md](storage.md#key-inventory).

## Section notes

### General

Seven clock settings, all `createCheckbox`/`createSelect` rows, with the two conditional rows described above, then **World clocks** — a heading with an `n / 5` count, one row per clock, and an Add control. This tab is entirely about the clock despite being named "General".

The world-clock section is the only part of the dialog that manages a list of user-created records rather than single settings, and it is worth reading before building anything similar: the label field is an `<input>` styled to read as plain text until touched, rows reorder by HTML5 DnD (with `draggable` suspended while the label has focus), and the Add control swaps a button for a search panel **in place** rather than opening a popover — a popover would detach from its row as soon as the panel scrolled. Full detail in [world-clocks.md](world-clocks.md#the-settings-section).

### Appearance

- **Theme** — a `createSelect` with exactly one option (`modern`).
- **Layout** — `buildLayoutSelector()`, three buttons carrying a `.layout-preview` schematic (bars and blocks built from the div/span markup in `styles.css`) over a label. Selected state fills with the accent; writes `store.sync.layout`, which `layout.ts` picks up and animates. See [layouts.md](layouts.md).
- **Rearrange widgets** — under the three previews, and the one control here that acts on the page rather than a setting: it calls `closeSettings()` and hands over to `startLayoutEdit()`. Hidden unless the layout is Default, and disabled unless there are two cards to swap — `refreshRearrangeFn` re-checks that on every dialog open, because which widgets are on is decided on the Widgets tab. See [layouts.md](layouts.md#rearranging).
- **Accent Color / Background → Color** — both are `buildSwatchGroup(storeKey)` (`settings.ts:169`), a row of ten `bg-swatch-*` circles plus one special button: `random` for accent (daily rotation), `auto` for background (follow the accent). Selection is drawn as an outline in the swatch's own color, with a checkmark injected into the selected circle; the special buttons instead take an accent outline. Selected state is driven by a store subscription, so the two groups stay right when the underlying value changes elsewhere.
- **Mode** — `buildModeSelector()` (`settings.ts:260`), three `"override"` buttons using the `--mode-light-*` / `--mode-dark-*` tokens, with `auto` rendered in the accent.
- **Background** — three `"settings"`-variant accordions (Color, Unsplash, Upload). The one matching `bgSource` opens by default and gets a 3px accent left border on its trigger, applied via inline styles in `updateActiveIndicator()`.

The **Unsplash accordion** (`settings.ts:349`) is the most complex control in the file: it hides itself entirely behind an "add your API key" message when `unsplashApiKey` is empty, cross-disables its own halves (daily-refresh mode dims the search grid; manual mode dims the topic select and refresh button), debounces search at 500ms, and sizes its result grid with a container query (`100cqi`) so thumbnails keep a 16:10 ratio.

The **Upload accordion** (`settings.ts:565`) previews the current upload by pulling the blob straight out of IndexedDB with `idbGet("upload")`, and sizes its preview box to the viewport's aspect ratio, recomputed on a 300ms-debounced resize.

### Widgets

Six `"settings"` accordions, all collapsed by default. Each widget follows the same shape: an enable checkbox, its own options, then any connect/disconnect controls.

Spotify's rows are an enable checkbox, **Hide when nothing is playing** (`spotifyHideWhenIdle`, on by default — off keeps the card up in its idle state, [spotify.md](spotify.md#the-idle-card)), then the connect/disconnect pair.

GitHub's accordion is the longest: enable, `buildGithubAccountRow()` (connect / connected-as / disconnect), one checkbox per section in `GITHUB_SECTIONS`, hide-bots, contribution graph, an org filter and a comma-separated repo ignore-list. `buildGithubAccountRow()` renders the device code inline while a connection is pending and opens github.com/login/device itself — the same flow the widget runs, so settings is a second door to it rather than the only one ([github.md](github.md#the-device-flow)).

Spotify and Calendar connection state is derived from the store — `spotifyAccessToken !== null` and `calendarConnected` — and both subscribe so the buttons flip when auth completes or is cleared elsewhere. `createSpotifyButton()` and `createGoogleButton()` are bespoke brand-colored buttons that bypass `createButton` and use placeholder colored squares where the brand logos should be.

Both connect buttons render failures rather than swallowing them: `authenticate()` returns `{ ok: false, error }`, and `showStatus()` puts the string under the button in `text-danger`. When the Calendar failure carries `needsClientId`, the message gets an inline button that calls `selectTab("advanced")` — a module-level hook `buildNav()` assigns, since `switchTab` is otherwise closed over.

Notepad's rows are an enable checkbox and a **Typeface** select (Sans / Monospace, `notepadFont`), followed by a hint line saying the note is stored on this device only, and a destructive **Clear note**. That button *does* use `confirm()` — unlike the widget's own clear, which has a popover that a native dialog would dismiss ([notepad.md](notepad.md#the-footer)).

Weather's rows are an enable checkbox, a temperature unit, a **Metric** select mirroring the one inside the widget body ([weather.md](weather.md#metrics)), and then the location controls from `buildLocationControls()`. A "Use device location" button (which shows a `Locating…` state and reports the specific `GEO_FAILURE_TEXT` on failure), a 300ms-debounced city search against Open-Meteo's geocoder with an `AbortController` per keystroke, and a summary line reading e.g. `Boulder, CO, US · set manually`. The manual path is always visible, not revealed on failure. Both paths call `refreshWeather()` so the widget updates without a reload — the old row wrote `weatherLat` and left the widget stale until the next page load.

### Shortcuts

`buildShortcutsPanel()` creates one empty container, `#sc-panel`, that `shortcut-settings.ts` builds its rail, grid and detail pane inside. Everything about shortcut editing lives there; see [shortcuts.md](shortcuts.md) and [shortcut-import.md](shortcut-import.md). Beneath it sits a footer with the two settings that belong to the panel rather than to any one shortcut: a raw `<input type="checkbox">` for `recommendationsEnabled` (wired at the bottom of `initSettings()`) and a `createSelect` for `shortcutsOpenIn`.

### Advanced

Three sections, separated by `sectionHeading()` rules:

1. **Unsplash API key** — a password-type `createInput` with a Show/Hide toggle, saved on `change` (blur), plus a link to unsplash.com/developers.
2. **Google sign-in** (shared by the Calendar and Gmail widgets), **Spotify sign-in** and **GitHub sign-in** — all `buildOAuthSection()` with different copy: a client-ID field, the extension's redirect URI with a copy button, and setup instructions. Always shown, so the path is discoverable before sign-in fails rather than only after. The redirect URI is one value per browser, not per service. See [browser-compat.md](browser-compat.md#the-redirect-uri).

   GitHub's section is the odd one: its device flow never redirects, so the URI is shown only because GitHub's App form demands a callback value it will never use. The section adds a **personal access token** field beneath, which is the way in with no OAuth App at all, and a **client secret** field that stays hidden unless `githubRefreshToken` is set — only a GitHub App with expiring tokens can use it, so the ordinary setup never sees it ([github.md](github.md#token-lifecycle)).
3. **Browser capabilities** (`buildCapabilityPanel()`) — renders `probeCapabilities()` as label / state badge / detail rows with a Re-check button. Runs cached on open; the button forces a live probe. See [browser-compat.md](browser-compat.md#detection).

## Refactor candidates

- **2986 lines in one file.** Dialog chrome, nav animation, and per-feature control logic all live together, and the file imports from five feature modules to do it. Moving each `buildXTab()` into the module it configures — or at minimum into `settings/` submodules — is the single biggest structural win available in this codebase.
- **Two panel construction conventions.** Some builders return a panel, some query for one they assume was already appended. Pick one.
- **The three-line store-sync pattern is repeated ~25 times.** `get` → control → `set` → `subscribe` → setter, with an `as any` in the checkbox case. A `bindCheckbox(key, label)` / `bindSelect(key, label, options)` helper would collapse most of the General and Widgets tabs to one line per setting and remove every `as any`.
- **`settingsRow` isn't used everywhere.** Appearance and Advanced hand-build rows with duplicated class strings that have already drifted from the helper's.
- **Nav indicator geometry is hard-coded.** `12 + index * 52 + 14` (`settings.ts:1080`) silently breaks if the nav button size, gap, or padding changes. Measuring the button's `offsetTop` would be robust.
- **Conditional-row visibility is manual and duplicated.** Each dependent row is toggled in both the change handler and the subscriber. A declarative `dependsOn` on the row helper would halve it.
- **Inline styles for state.** Selected swatches, mode buttons, the active background accordion, and disabled states are all driven by direct `style.*` assignment rather than classes or data attributes, so none of it is inspectable from CSS or overridable by a theme.
- **Brand buttons use placeholder squares.** `createSpotifyButton` and `createGoogleButton` draw a colored `div` where a logo should be, and hard-code their hover colors in JS.
- **`confirm()` for destructive actions.** "Clear all todos" uses the native browser dialog while the rest of the app has a themed confirmation flow, and the shortcuts panel now has an undo toast (`showToast`, [components.md](components.md#showtoast)). The todo widget itself can't use `confirm()` at all — a native dialog eats the click its popover is listening for — so its Clear archive button is a two-click arm instead.
- **The General tab is really the Clock tab.** Either rename it or move the clock settings — and the world-clock list under them — to Widgets alongside every other widget.
