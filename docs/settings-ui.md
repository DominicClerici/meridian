# Settings UI

The settings dialog. **File:** `src/settings.ts` (1420 lines — the largest module in the app).

Entry point `initSettings()` (`settings.ts:1332`) is called first in the boot sequence because it constructs DOM that other modules then look up by ID — see [architecture.md](architecture.md#order-dependencies).

## Structure

The dialog is built entirely at runtime by `createDialog()` ([components.md](components.md#createdialog)), 725×480 with an 80vh cap:

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
| General | `buildGeneralTab()` | All seven clock settings |
| Shortcuts | `buildShortcutsPanel()` | Empty containers for `shortcut-settings.ts`, plus the recommendations toggle and open-in select |
| Appearance | `buildAppearanceTab()` | Theme, accent, mode, and the three background accordions |
| Widgets | `buildWidgetsTab()` | Search, Todo, Weather, Spotify, Calendar accordions |
| Advanced | `buildAdvancedPanel()` | Unsplash API key |

Two construction styles coexist. `buildShortcutsPanel()` and `buildAdvancedPanel()` **return** a panel element that `initSettings()` appends; `buildGeneralTab()`, `buildAppearanceTab()`, and `buildWidgetsTab()` **query** for their already-appended panel via `document.querySelector('[data-settings-tab="…"]')` and fill it. That's why the first two run inline in `initSettings()` while the other three are called afterward.

### Navigation

`buildNav()` (`settings.ts:1063`) creates one 48px icon button per tab plus a `.settings-nav-indicator` accent bar. The indicator is positioned by arithmetic — `indicatorTop(index) = 12 + index * 52 + 14` — which hard-codes the button height and gap. Because a `<dialog>` has no layout until it's shown, `initSettings()` re-runs `refreshIndicator()` inside a `requestAnimationFrame` after `open()` (`settings.ts:1403`).

`switchTab()` cross-fades panels: the outgoing panel is absolutely positioned over the incoming one, both fade over 50ms, and a `switching` flag blocks re-entry until the animation finishes. The title cross-fades on the same schedule. Each nav button also carries a `.settings-tooltip` that appears after a 400ms hover.

## The settingsRow helper

```ts
settingsRow(label: string, control: HTMLElement, opts?: { hidden?: boolean }): HTMLElement
```

`settings.ts:41`. Produces a label-left / control-right row with a bottom hairline that's suppressed on the last child. This is the standard unit of the settings UI, but it's only used in the General, Search, Todo, Weather, Spotify, and Calendar sections — the Appearance tab and the Advanced panel build their rows by hand.

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

Seven clock settings, all `createCheckbox`/`createSelect` rows, with the two conditional rows described above. This tab is entirely about the clock despite being named "General".

### Appearance

- **Theme** — a `createSelect` with exactly one option (`modern`).
- **Accent Color / Background → Color** — both are `buildSwatchGroup(storeKey)` (`settings.ts:169`), a row of ten `bg-swatch-*` circles plus one special button: `random` for accent (daily rotation), `auto` for background (follow the accent). Selection is drawn as an outline in the swatch's own color, with a checkmark injected into the selected circle; the special buttons instead take an accent outline. Selected state is driven by a store subscription, so the two groups stay right when the underlying value changes elsewhere.
- **Mode** — `buildModeSelector()` (`settings.ts:260`), three `"override"` buttons using the `--mode-light-*` / `--mode-dark-*` tokens, with `auto` rendered in the accent.
- **Background** — three `"settings"`-variant accordions (Color, Unsplash, Upload). The one matching `bgSource` opens by default and gets a 3px accent left border on its trigger, applied via inline styles in `updateActiveIndicator()`.

The **Unsplash accordion** (`settings.ts:349`) is the most complex control in the file: it hides itself entirely behind an "add your API key" message when `unsplashApiKey` is empty, cross-disables its own halves (daily-refresh mode dims the search grid; manual mode dims the topic select and refresh button), debounces search at 500ms, and sizes its result grid with a container query (`100cqi`) so thumbnails keep a 16:10 ratio.

The **Upload accordion** (`settings.ts:565`) previews the current upload by pulling the blob straight out of IndexedDB with `idbGet("upload")`, and sizes its preview box to the viewport's aspect ratio, recomputed on a 300ms-debounced resize.

### Widgets

Five `"settings"` accordions, all collapsed by default. Each widget follows the same shape: an enable checkbox, its own options, then any connect/disconnect controls.

Spotify and Calendar connection state is derived from the store — `spotifyAccessToken !== null` and `calendarConnected` — and both subscribe so the buttons flip when auth completes or is cleared elsewhere. `createSpotifyButton()` and `createGoogleButton()` (`settings.ts:749`, `775`) are bespoke brand-colored buttons that bypass `createButton` and use placeholder colored squares where the brand logos should be.

Weather additionally has a "Grant location access" row that calls `navigator.geolocation.getCurrentPosition` directly and writes `weatherLat`/`weatherLon`; the row hides itself once coordinates exist.

### Shortcuts

`buildShortcutsPanel()` creates three empty containers — `#sc-tab-bar`, `#sc-item-list`, `#sc-control-bar` — that `shortcut-settings.ts` fills in. Everything about shortcut editing lives there; see [shortcuts.md](shortcuts.md). The panel also holds two settings of its own: a raw `<input type="checkbox">` for `recommendationsEnabled` (wired at the bottom of `initSettings()`) and a `createSelect` for `shortcutsOpenIn`.

### Advanced

One row: the Unsplash API key, a password-type `createInput` with a Show/Hide toggle, saved on `change` (blur), plus a link to unsplash.com/developers.

## Refactor candidates

- **1420 lines in one file.** Dialog chrome, nav animation, and per-feature control logic all live together, and the file imports from five feature modules to do it. Moving each `buildXTab()` into the module it configures — or at minimum into `settings/` submodules — is the single biggest structural win available in this codebase.
- **Two panel construction conventions.** Some builders return a panel, some query for one they assume was already appended. Pick one.
- **The three-line store-sync pattern is repeated ~25 times.** `get` → control → `set` → `subscribe` → setter, with an `as any` in the checkbox case. A `bindCheckbox(key, label)` / `bindSelect(key, label, options)` helper would collapse most of the General and Widgets tabs to one line per setting and remove every `as any`.
- **`settingsRow` isn't used everywhere.** Appearance and Advanced hand-build rows with duplicated class strings that have already drifted from the helper's.
- **Nav indicator geometry is hard-coded.** `12 + index * 52 + 14` (`settings.ts:1080`) silently breaks if the nav button size, gap, or padding changes. Measuring the button's `offsetTop` would be robust.
- **Conditional-row visibility is manual and duplicated.** Each dependent row is toggled in both the change handler and the subscriber. A declarative `dependsOn` on the row helper would halve it.
- **Inline styles for state.** Selected swatches, mode buttons, the active background accordion, and disabled states are all driven by direct `style.*` assignment rather than classes or data attributes, so none of it is inspectable from CSS or overridable by a theme.
- **Brand buttons use placeholder squares.** `createSpotifyButton` and `createGoogleButton` draw a colored `div` where a logo should be, and hard-code their hover colors in JS.
- **`confirm()` for destructive actions.** "Clear all todos" (`settings.ts:884`) uses the native browser dialog while the rest of the app has a themed confirmation flow (`shortcut-settings.ts:815`).
- **The General tab is really the Clock tab.** Either rename it or move the clock settings under Widgets alongside every other widget.
