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

**localStorage key namespacing:** Keys are prefixed to avoid collisions: `sync:bgColor`, `local:someKey`.

**Subscribe pattern:** Callback-based. Returns an unsubscribe function.

```ts
const unsub = store.sync.subscribe("bgColor", (value) => {
  // called when bgColor changes
});
unsub(); // cleanup
```

## Settings Dialog & UI

### Background Color

On init, after the store loads, read `store.sync.get("bgColor")` and apply a Tailwind class on `document.body` (`bg-red-500`, `bg-green-500`, `bg-blue-500`). Subscribe to changes for live updates.

### Settings Button

A fixed-position button in the top-left corner. Clicking it calls `dialog.showModal()`.

### Dialog Structure

Uses the native HTML `<dialog>` element. Benefits: focus trapping, Escape-to-close, backdrop overlay — all built-in.

```html
<dialog id="settings-dialog">
  <div>
    <h2>Settings</h2>
    <fieldset>
      <legend>Background Color</legend>
      <button data-color="red">Red</button>
      <button data-color="green">Green</button>
      <button data-color="blue">Blue</button>
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
