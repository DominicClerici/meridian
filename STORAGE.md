# Storage API Reference

The store is a unified, typed storage system that combines `browser.storage.sync`, `browser.storage.local`, and `localStorage` into a single API with reactive subscriptions.

## Architecture

```
┌─────────────────────────────────────────────┐
│              In-Memory Cache                │
│   (synchronous reads, always up to date)    │
├──────────────────┬──────────────────────────┤
│   localStorage   │    browser.storage       │
│   (sync mirror)  │  (source of truth)       │
│   instant load   │  async reconciliation    │
└──────────────────┴──────────────────────────┘
```

**On page load**, the cache is populated synchronously from `localStorage`, so `get()` returns a value immediately with zero async delay. Then `init()` reconciles asynchronously with `browser.storage`, updating the cache and firing subscribers if any values differ. `browser.storage` is always the source of truth.

## Namespaces

The store is split into two namespaces:

| Namespace | Backed by | Use for |
|-----------|-----------|---------|
| `store.sync` | `browser.storage.sync` | Settings that sync across devices (color theme, preferences). ~100KB total limit, ~8KB per item. |
| `store.local` | `browser.storage.local` | Large data that stays on one device (images, cached objects). ~5MB limit. |

Each namespace has the same API. They are typed independently — `store.sync` is typed against `SyncSettings` and `store.local` against `LocalSettings`.

## Setup

### Initialization

`store.init()` must be called once at startup. It reconciles the cache with `browser.storage` and registers the cross-tab sync listener.

```ts
import { store } from "./store";

// get() is safe to call immediately — returns from cache (localStorage or defaults)
const color = store.sync.get("bgColor"); // works before init()

document.addEventListener("DOMContentLoaded", async () => {
  await store.init();
  // browser.storage is now reconciled, cross-tab sync is active
});
```

### Adding a new setting

1. Add the key and its type to the appropriate interface in `src/defaults.ts`:

```ts
export interface SyncSettings {
  bgColor: "red" | "green" | "blue";
  showClock: boolean;       // new setting
}
```

2. Add a default value:

```ts
export const syncDefaults: SyncSettings = {
  bgColor: "blue",
  showClock: true,          // default for first launch
};
```

That's it. The store automatically picks up the new key. `store.sync.get("showClock")` is now available and fully typed.

For settings that should stay on the device (large data, images):

```ts
export interface LocalSettings {
  backgroundImage: string | null;  // base64 or data URL
}

export const localDefaults: LocalSettings = {
  backgroundImage: null,
};
```

## API

### `get(key)`

Reads a value synchronously from the in-memory cache. Always returns immediately.

```ts
const color = store.sync.get("bgColor");
// => "red" | "green" | "blue" (typed to the exact value type)

const img = store.local.get("backgroundImage");
// => string | null
```

- Safe to call before `init()` — returns the value from localStorage, or the default if nothing is stored.
- Returns the default value after `delete()` is called on a key.
- TypeScript enforces that you can only `get()` keys that exist in the namespace's interface. `store.sync.get("backgroundImage")` is a compile-time error.

### `set(key, value)`

Writes a value to the cache, localStorage, and browser.storage.

```ts
store.sync.set("bgColor", "red");
store.local.set("backgroundImage", dataUrl);
```

**Write order:**
1. In-memory cache updated (synchronous)
2. `localStorage` written (synchronous)
3. `browser.storage` written (async, fire-and-forget)
4. Subscribers notified with the new value

The value is available via `get()` immediately. The `browser.storage` write happens in the background — if it fails (e.g., quota exceeded), the cache and localStorage still hold the value for the current session. Cross-device sync may lag until the next successful write.

TypeScript enforces value types: `store.sync.set("bgColor", "purple")` is a compile-time error.

### `delete(key)`

Resets a key to its default value and removes it from all persistence layers.

```ts
store.sync.delete("bgColor");
// store.sync.get("bgColor") now returns "blue" (the default)
```

**What happens:**
1. Cache reset to the default value from `defaults.ts`
2. Key removed from `localStorage`
3. Key removed from `browser.storage` (async)
4. Subscribers notified with the default value

On next page load, the default will be used since no persisted value exists.

### `subscribe(key, callback)`

Registers a callback that fires whenever a key's value changes. Returns an unsubscribe function.

```ts
const unsubscribe = store.sync.subscribe("bgColor", (color) => {
  // color is typed as "red" | "green" | "blue"
  console.log("Background color changed to:", color);
});

// Later, to stop listening:
unsubscribe();
```

**When the callback fires:**
- After `set()` is called (optimistic — fires before the async `browser.storage` write completes)
- After `delete()` is called (receives the default value)
- During `init()` reconciliation, if `browser.storage` has a different value than `localStorage`
- When another tab changes the value (cross-tab sync)

**The callback receives only the new value.** If you need the old value, read it with `get()` before the operation.

**Subscribers are not called on initial registration.** To handle the initial value, read it with `get()`:

```ts
function handleColor(color: SyncSettings["bgColor"]) {
  document.body.className = `bg-${color}-500`;
}

// Apply initial value
handleColor(store.sync.get("bgColor"));

// React to future changes
store.sync.subscribe("bgColor", handleColor);
```

### `init()`

Called once at startup. Performs two operations:

1. **Async reconciliation** — reads `browser.storage.sync` and `browser.storage.local`, updates the cache and localStorage to match. Fires subscribers for any keys that changed.
2. **Cross-tab listener** — registers a `browser.storage.onChanged` listener so that changes from other tabs are reflected in the cache and trigger subscribers.

```ts
await store.init();
```

If `browser.storage` is unavailable (e.g., running outside the extension context), `init()` silently completes and the store operates in localStorage-only mode.

## Cross-Tab Sync

When a value changes in another tab (via `browser.storage.onChanged`):

1. The in-memory cache is updated
2. `localStorage` is updated to match
3. Subscribers fire with the new value

Echo suppression is built in — if the current tab made the change, the `onChanged` listener detects that the cache already holds the new value and skips redundant notifications.

Cross-tab sync requires `init()` to have been called.

## localStorage Key Format

All keys are prefixed to avoid collisions with other extensions or pages:

```
sp:sync:<key>    — e.g., sp:sync:bgColor
sp:local:<key>   — e.g., sp:local:backgroundImage
```

## Error Handling

The store is designed to never throw. All storage operations are guarded:

| Scenario | Behavior |
|----------|----------|
| `browser.storage` unavailable | Silent fallback to localStorage-only mode |
| `localStorage` quota exceeded | Write silently fails; cache and subscribers still work |
| `localStorage` entry corrupted | Falls back to default value for that key |
| `browser.storage` write fails | Cache and localStorage already updated; retried on next `set()` |
| `get()` called before `init()` | Returns value from localStorage or the default |

## Type Safety

The store is fully typed. TypeScript enforces:

- **Key validity** — only keys defined in `SyncSettings` / `LocalSettings` are accepted
- **Value types** — values must match the type declared for that key
- **Namespace isolation** — `store.sync.get("localOnlyKey")` is a compile error if the key isn't in `SyncSettings`

```ts
store.sync.get("bgColor");           // OK: returns "red" | "green" | "blue"
store.sync.set("bgColor", "red");    // OK
store.sync.set("bgColor", "purple"); // Compile error: not in union
store.sync.get("noSuchKey");         // Compile error: key doesn't exist
store.local.get("bgColor");          // Compile error: bgColor is in SyncSettings, not LocalSettings
```

## Complete Example

```ts
import { store } from "./store";
import type { SyncSettings } from "./defaults";

// Read immediately (from cache, before init)
const currentColor = store.sync.get("bgColor");

// Subscribe to changes (reactive)
const unsub = store.sync.subscribe("bgColor", (color) => {
  applyTheme(color);
});

// Initialize (reconcile + cross-tab sync)
await store.init();

// Write a value
store.sync.set("bgColor", "green");

// Delete (reset to default)
store.sync.delete("bgColor");
// store.sync.get("bgColor") === "blue" (default)

// Cleanup
unsub();
```
