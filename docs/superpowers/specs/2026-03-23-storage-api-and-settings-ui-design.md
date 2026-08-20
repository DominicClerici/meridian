# Storage API & Settings UI Design

## Overview

A unified, typed storage API for the startpage extension that mirrors `browser.storage.sync` and `browser.storage.local` into localStorage for instant page loads, plus a foundational settings UI using a native `<dialog>` element. The first setting is a background color toggle (red/green/blue).

## Type System & Defaults

Two separate TypeScript interfaces define the sync and local schemas independently. A defaults object provides initial values for first launch and for reset-on-delete.

```ts
// defaults.ts

interface SyncSettings {
  bgColor: "red" | "green" | "blue";
}

interface LocalSettings {
  // empty for now — large objects, images, etc. go here
}

const syncDefaults: SyncSettings = {
  bgColor: "blue",
};

const localDefaults: LocalSettings = {};
```

Each store namespace (`store.sync`, `store.local`) is typed against its respective interface. `store.sync.get("bgColor")` returns `"red" | "green" | "blue"`. `store.local.get("bgColor")` would be a compile-time type error.

## Store Architecture

### Singleton Structure

```
store
├── sync    — namespaced API for browser.storage.sync keys
│   ├── get(key) → value        (synchronous, reads from in-memory cache)
│   ├── set(key, value) → void  (updates cache + localStorage + browser.storage.sync)
│   ├── delete(key) → void      (resets to default, removes from storage)
│   └── subscribe(key, callback) → unsubscribe function
├── local   — namespaced API for browser.storage.local keys
│   ├── get(key) → value
│   ├── set(key, value) → void  (updates cache + localStorage + browser.storage.local)
│   ├── delete(key) → void
│   └── subscribe(key, callback) → unsubscribe function
└── init()  — called once at startup
```

### Data Flow

**Startup sequence (init):**

1. **Instant load (synchronous):** Read localStorage keys (prefixed), merge over defaults, populate in-memory cache. The page can render immediately from this data.
2. **Async reconcile:** Read from `browser.storage.sync` and `browser.storage.local`. For each key where the browser.storage value differs from cache, update cache and localStorage to match browser.storage (browser.storage is the source of truth). Fire subscribers for any keys that changed.

**On `set(key, value)`:**

1. Update in-memory cache
2. Write to localStorage (synchronous)
3. Write to browser.storage (async, fire-and-forget — cache is already current)
4. Fire subscribers with new value

**On `delete(key)`:**

1. Reset cache to default value for that key
2. Remove from localStorage
3. Remove from browser.storage (async)
4. Fire subscribers with the default value

**localStorage key namespacing:** Keys are prefixed with a project namespace to avoid collisions: `sp:sync:bgColor`, `sp:local:someKey`.

**Subscribe pattern:** Callback-based. Callback receives only the new value. Returns an unsubscribe function.

```ts
const unsub = store.sync.subscribe("bgColor", (value) => {
  // called when bgColor changes, receives new value only
});
unsub(); // cleanup
```

**Subscriber notification is optimistic:** Subscribers fire immediately after the in-memory cache is updated, before the async `browser.storage` write completes. A failed browser.storage write does not roll back the notification. This is intentional — the cache and localStorage are already consistent, and browser.storage failures are rare.

**Cross-tab synchronization:** During `init()`, register a `browser.storage.onChanged` listener. When a change arrives from another tab or context:

1. Update the in-memory cache with the new value
2. Update localStorage mirror
3. Fire subscribers for the changed keys

To avoid echo (a local `set()` triggering `onChanged` back on the same tab), the listener compares the incoming value against the current cache. If they match, it skips subscriber notification.

**Error handling:** If `browser.storage` is unavailable (e.g., running outside the extension context during development, or quota exceeded), the store silently falls back to localStorage-only operation. The in-memory cache and localStorage continue to function normally.

**Pre-init guard:** Calling `get()` before `init()` returns the default value for the key. The cache is initialized from defaults at construction time; `init()` enriches it from localStorage and then browser.storage. This means `get()` is always safe to call.

**Post-delete semantics:** After `delete(key)`, the key is removed from all persistence layers (localStorage and browser.storage). `get(key)` returns the default value. On next page load, the default will be used again since no persisted value exists.

**Browser compatibility:** The store module uses the same `globalThis.browser || globalThis.chrome` shim established in `index.ts` to work in both Chrome and Firefox.

## Settings Dialog & UI

### Background Color

On init, after the store loads, read `store.sync.get("bgColor")` and apply a Tailwind class on `document.body` (`bg-red-500`, `bg-green-500`, `bg-blue-500`). Subscribe to changes for live updates.

**Tailwind safelist note:** These background classes must appear as full string literals in source code (not dynamically constructed via template literals like `` `bg-${color}-500` ``) so that Tailwind's scanner includes them in the CSS output.

### Settings Button

A fixed-position button in the top-left corner. Clicking it calls `dialog.showModal()`.

### Dialog Structure

Uses the native HTML `<dialog>` element. Benefits: focus trapping, Escape-to-close, backdrop overlay — all built-in.

```html
<dialog id="settings-dialog" aria-labelledby="settings-title">
  <div>
    <h2 id="settings-title">Settings</h2>
    <fieldset>
      <legend>Background Color</legend>
      <button data-color="red" aria-pressed="false">Red</button>
      <button data-color="green" aria-pressed="false">Green</button>
      <button data-color="blue" aria-pressed="false">Blue</button>
    </fieldset>
    <button id="settings-close">Close</button>
  </div>
</dialog>
```

### Settings Logic

- Query dialog and color buttons on init
- On color button click: `store.sync.set("bgColor", color)`
- Highlight the currently active color button (read initial value from store, subscribe to changes)
- Open/close wired to the gear button and close button

## File Map

| File | Action | Role |
|------|--------|------|
| `src/defaults.ts` | Create | Type interfaces (`SyncSettings`, `LocalSettings`) + default value objects |
| `src/store.ts` | Create | Singleton store with in-memory cache, localStorage mirror, browser.storage reconciliation, namespaced sync/local API, subscribe |
| `src/settings.ts` | Create | Dialog open/close, color button click handlers, active button state |
| `src/index.ts` | Modify | Init store, apply background color from store, mount settings button listener |
| `src/index.html` | Modify | Add settings button, `<dialog>` element markup |
| `src/styles.css` | Modify | Tailwind import (already exists) + any custom dialog/button styling |

## Decisions

| Decision | Rationale |
|----------|-----------|
| Single store module (Approach A) | Low total complexity for a startpage; avoids unnecessary indirection |
| Namespaced access (`store.sync` / `store.local`) | Clean API, each namespace independently typed |
| Callback-based subscribe | Simple, typed, returns unsubscribe function for cleanup |
| localStorage as synchronous mirror | Enables instant render on page load without waiting for async browser.storage |
| browser.storage as source of truth | On reconciliation, browser.storage wins over localStorage divergence |
| Native `<dialog>` element | Free focus trapping, Escape-to-close, backdrop; modern browser support guaranteed in extension context |
| Tailwind classes for bg color | Keeps styling in CSS layer, avoids inline styles |
| Typed defaults object | First-launch values and reset-on-delete behavior; compile-time safety |
