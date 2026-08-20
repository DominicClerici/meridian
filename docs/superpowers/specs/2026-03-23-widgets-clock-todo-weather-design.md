# Widgets: Clock, Todo, Weather — Design Spec

## Overview

Three new widgets for the startpage extension: a live clock above the search bar, a to-do list in a popover, and a weather summary fetched from open-meteo. All follow the existing one-file-per-feature pattern with init functions wired in `index.ts`.

## File Structure

| File | Purpose |
|------|---------|
| `src/clock.ts` | Clock rendering, interval, `initClock()` |
| `src/todos.ts` | Todo data types and pure helper functions |
| `src/todo.ts` | Todo popover, drag-and-drop, DOM rendering, `initTodo()` |
| `src/weather.ts` | Weather fetch, cooldown, popover, `initWeather()` |
| `src/defaults.ts` | New settings keys and defaults (modified) |
| `src/settings.ts` | New fieldsets for clock, todo, weather settings (modified) |
| `src/index.html` | New HTML elements for widgets, settings fieldsets, todo dialog (modified) |
| `src/index.ts` | Wire up init functions (modified) |

## Storage Schema

### SyncSettings (new keys)

```ts
clockEnabled: boolean             // default: true
clockShowSeconds: boolean         // default: false
clock24Hour: boolean              // default: false
clockShowAmPm: boolean            // default: true
clockShowDate: boolean            // default: false
clockDateFormat: "long" | "short" | "abbr" | "numeric" | "numericShort"
                                  // default: "long"
                                  // "January 24th" | "Jan. 24th" | "Jan 24" | "01/24/2024" | "01/24"
clockSize: "small" | "medium" | "large"  // default: "medium"

todoEnabled: boolean              // default: true
todoShowBadges: boolean           // default: true

weatherEnabled: boolean           // default: true
weatherUnit: "f" | "c"           // default: "f"
```

### LocalSettings (new keys)

```ts
todos: Todo[]                     // default: []
weatherLat: number | null         // default: null
weatherLon: number | null         // default: null
```

### Raw localStorage (not store API)

These are ephemeral cache values that don't need reactivity or cross-tab sync. They bypass the store API to avoid unnecessary overhead. The `sp:weather:` prefix is a third namespace distinct from `sp:sync:` and `sp:local:`.

| Key | Purpose |
|-----|---------|
| `sp:weather:lastFetch` | Timestamp (ms) of last successful weather fetch |
| `sp:weather:cachedData` | JSON string of last weather response |

---

## 1. Clock Widget

### Layout

Inside the existing `#search-wrapper` centered flex container, above the search input. The clock element is a `<div id="clock">` with `text-center text-white mb-4`.

### Rendering

- `setInterval` at 1 second drives updates
- Colons between time segments are individual `<span>` elements
- Colons alternate between `opacity: 1` and `opacity: 0.5` each second tick
- Time digits use `font-variant-numeric: tabular-nums` to prevent width shifts

### Size

| Setting | CSS | Approximate size |
|---------|-----|-----------------|
| `"small"` | `font-size: 3rem` | ~48px |
| `"medium"` | `font-size: 5rem` | ~80px |
| `"large"` | `font-size: 8rem` | ~128px |

### Date Display

Rendered below the time in a smaller font size. Only shown when `clockShowDate` is true.

Format mapping:
- `"long"` — "January 24th"
- `"short"` — "Jan. 24th"
- `"abbr"` — "Jan 24"
- `"numeric"` — "01/24/2024"
- `"numericShort"` — "01/24"

### Settings Controls

Nesting logic in the settings dialog:
- Display clock (toggle)
- Display seconds (toggle)
- 24-hour / 12-hour format (toggle)
  - If 12-hour: Show AM/PM (toggle)
- Show date (toggle)
  - If enabled: Date format (select)
- Size (select: small / medium / large)

When `clock24Hour` is true, the `clockShowAmPm` setting is ignored by the rendering code (the toggle is hidden in the UI). The stored value is preserved so switching back to 12-hour mode restores the user's previous preference.

### Reactivity

Each setting has a `store.sync.subscribe` call. Changes re-render the clock immediately. When `clockEnabled` is toggled off, the clock element is hidden and the interval is cleared. When toggled back on, the interval restarts.

---

## 2. Todo Widget

### Data Model

```ts
type Todo = {
  id: string
  title: string              // required, max 256 characters
  description: string | null // optional, max 1024 characters
  url: string | null         // optional
  dueDate: string | null     // optional, ISO date string "YYYY-MM-DD"
  completed: boolean
  completedAt: string | null // ISO timestamp, set when completed
  createdAt: string          // ISO timestamp
  updatedAt: string          // ISO timestamp
  order: number              // global sort order — used to sort within overdue/todo sections
}
```

### Pure Functions (`src/todos.ts`)

- `addTodo(todos, data)` — creates a new todo with generated id, timestamps, order. Enforces `MAX_TODOS = 500`; returns unchanged if at limit.
- `editTodo(todos, id, data)` — updates fields, bumps `updatedAt`
- `deleteTodo(todos, id)` — removes by id
- `toggleTodo(todos, id)` — flips `completed`, sets/clears `completedAt`
- `reorderTodos(todos, id, newOrder)` — updates order for drag-and-drop
- `getOverdue(todos)` — incomplete todos with a past due date, sorted by `order`
- `getActive(todos)` — incomplete todos that are not overdue, sorted by `order`
- `getCompleted(todos)` — completed todos, sorted by `completedAt` descending (most recent first)
- `purgeStale(todos)` — removes completed todos older than 3 days and active/overdue todos older than 6 months (based on `updatedAt`)

### Trigger Button

Fixed top-right corner inside `<div id="widgets">`. Contains:
- Checklist SVG icon
- **Count badge**: shown when `todoShowBadges` is true and incomplete count > 0. Displays total incomplete count (overdue + active). Neutral/white styling.
- **Overdue badge**: shown when `todoShowBadges` is true and overdue count > 0. Red styling. Displays overdue count only.

Hidden entirely when `todoEnabled` is false.

### Popover

Created dynamically in JS, positioned relative to trigger, dismissed on outside click (same pattern as `dock.ts` folder popovers).

Contents:
1. **Add todo button** at the top
2. **Overdue accordion** — only rendered if overdue items exist. Trigger text and chevron are red.
3. **Todo accordion** — always rendered
4. **Completed accordion** — always rendered

All visible accordions start expanded.

### Todo Item Rendering

Each item row contains:
- **Checkbox** (left) — toggles completed state
- **Title** (middle) — truncated with ellipsis if long
- **URL button** — small external-link icon, opens URL in new tab. Only rendered if `url` is set.
- **Edit button** — pencil icon, opens add/edit dialog pre-filled
- **Delete button** — trash icon, removes the todo
- **Drag handle** — grip icon on the right. Only in overdue/todo sections.
- **Description tooltip** — native `title` attribute or custom tooltip on hover. Only if `description` is set.

### Completion Toggle Behavior

When checkbox is toggled to complete (in overdue or todo section):
- Text becomes gray with strikethrough
- Item stays in its current accordion section (does not move)

When popover is closed and reopened:
- Items re-sort into correct accordion sections

When a completed item is unchecked (in completed section):
- Text returns to normal styling
- Stays in completed section until popover closes

Completed section items:
- Gray text, no strikethrough
- No drag handles
- Cannot be reordered
- Sorted by `completedAt` descending

### Drag and Drop

Native HTML drag events (`dragstart`, `dragover`, `drop`) matching the pattern in `shortcut-settings.ts`:
- Only items in overdue and todo sections are draggable
- Items can only be reordered within their own section
- Drop indicators shown between items
- On drop: `order` fields are updated and persisted via `store.local.set("todos", ...)`

### Add/Edit Dialog

A `<dialog>` element in `index.html` (similar to `#sc-prompt-dialog`). Fields:
- Title — `<input type="text">`, required, `maxlength="256"`
- Description — `<textarea>`, optional, `maxlength="1024"`
- URL — `<input type="url">`, optional
- Due date — `<input type="date">`, optional

Cancel and Save buttons. On save: validates, calls `addTodo` or `editTodo`, persists to store, re-renders popover.

### Auto-Deletion

`purgeStale()` runs once during `initTodo()` and again each time the popover is opened:
- Completed todos with `completedAt` older than 3 days → deleted
- Active/overdue todos with `updatedAt` older than 6 months → deleted

### Settings Controls

New "Todo" fieldset in settings dialog:
- Enable widget (toggle)
- Show badges (toggle)
- Clear all todos (button, with a confirmation prompt before clearing)

---

## 3. Weather Widget

### States

| State | Trigger appearance | Click behavior |
|-------|--------------------|----------------|
| No permission | Location-off icon + "Enable location" text | Opens settings dialog |
| Loading | Spinner/loading indicator | No action |
| Data loaded | Temperature + weather icon + condition text | Opens blank popover |

Hidden entirely when `weatherEnabled` is false.

### Location & Coordinates

- When weather is enabled and a fetch is needed, call `navigator.geolocation.getCurrentPosition()` to get fresh coordinates
- Save coordinates to `store.local` (`weatherLat`, `weatherLon`)
- If the user denies the permission prompt, enter "no permission" state
- Every fetch cycle attempts to refresh coordinates before making the API call
- If `getCurrentPosition` fails (timeout, denied after initial grant), fall back to the last stored coordinates in `store.local`. If no stored coordinates exist either, enter "no permission" state.
- Once the browser has permanently denied geolocation, `getCurrentPosition` will fail immediately without a prompt. The "Grant location access" button in settings will show a help message in this case explaining that the user must re-enable location in browser settings.

### Fetch & Cooldown

**On tab open:**
- Check `sp:weather:lastFetch` in localStorage
- If `Date.now() - lastFetch < 120_000` (2 minutes): use `sp:weather:cachedData`
- Otherwise: refresh coordinates, fetch from API, update both localStorage keys

**Within a tab:**
- `setInterval` every 5 minutes (300,000ms) triggers a re-fetch
- Each successful fetch updates `sp:weather:lastFetch` and `sp:weather:cachedData` in localStorage
- This prevents other new tabs opened during cooldown from redundant fetches

### Open-Meteo API

Single request to current weather endpoint:

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude={lat}
  &longitude={lon}
  &current=temperature_2m,weather_code
  &temperature_unit={celsius|fahrenheit}
```

Response provides `current.temperature_2m` and `current.weather_code`.

### Weather Code Mapping

Static lookup table mapping WMO weather codes to `{ icon: string, condition: string }`:

| Code(s) | Condition | Icon |
|---------|-----------|------|
| 0 | Clear sky | ☀️ |
| 1 | Mainly clear | 🌤️ |
| 2 | Partly cloudy | ⛅ |
| 3 | Overcast | ☁️ |
| 45, 48 | Fog | 🌫️ |
| 51, 53, 55 | Drizzle | 🌦️ |
| 56, 57 | Freezing drizzle | 🌧️ |
| 61, 63, 65 | Rain | 🌧️ |
| 66, 67 | Freezing rain | 🌧️ |
| 71, 73, 75 | Snow | ❄️ |
| 77 | Snow grains | ❄️ |
| 80, 81, 82 | Rain showers | 🌧️ |
| 85, 86 | Snow showers | ❄️ |
| 95 | Thunderstorm | ⛈️ |
| 96, 99 | Thunderstorm with hail | ⛈️ |

### Error Handling

| Scenario | Behavior |
|----------|----------|
| HTTP error (4xx, 5xx) | Use cached data if available; otherwise show a retry icon on the trigger |
| Network timeout | Same as HTTP error |
| Malformed JSON response | Same as HTTP error |
| `getCurrentPosition` fails | Fall back to stored coordinates; if none, enter "no permission" state |

On fetch failure, `sp:weather:lastFetch` is not updated, so the next tab open or interval tick will retry.

### Popover

When in data-loaded state, clicking the trigger opens a dynamically-created popover (same pattern as todo/dock). The popover body is empty — a placeholder container for future content.

### Settings Controls

New "Weather" fieldset in settings dialog:
- Enable weather (toggle)
- Temperature unit: F / C (select or toggle)
- If location not yet granted: "Grant location access" button that triggers `navigator.geolocation.getCurrentPosition()` to prompt the browser permission dialog

---

## 4. Layout & HTML Integration

### Widget Container

```html
<div id="widgets" class="fixed top-4 right-4 flex items-center gap-2">
  <button id="weather-trigger" ...></button>
  <button id="todo-trigger" ...></button>
</div>
```

### Clock Placement

```html
<div id="search-wrapper" class="fixed inset-0 flex items-center justify-center pointer-events-none">
  <div class="w-full max-w-lg pointer-events-auto">
    <div id="clock" class="text-center text-white mb-4"></div>
    <input id="search-input" ...>
    <div id="search-results" ...></div>
  </div>
</div>
```

### Init Wiring (`src/index.ts`)

```ts
import { initClock } from "./clock"
import { initTodo } from "./todo"
import { initWeather } from "./weather"

document.addEventListener("DOMContentLoaded", async () => {
  await store.init()
  initSettings()
  initDock()
  initShortcutSettings()
  initSearch()
  initClock()
  initTodo()
  initWeather()
})
```

### Settings Dialog Additions

Three new `<fieldset>` blocks in the settings dialog for Clock, Todo, and Weather, following the same styling pattern as existing fieldsets.

### Todo Dialog

A new `<dialog id="todo-prompt-dialog">` in `index.html` with the form fields for add/edit, following the same pattern as `#sc-prompt-dialog`.
