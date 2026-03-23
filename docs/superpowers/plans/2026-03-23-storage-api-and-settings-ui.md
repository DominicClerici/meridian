# Storage API & Settings UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified, typed storage API with localStorage mirroring for instant loads, plus a background color setting controlled via a native `<dialog>` settings panel.

**Architecture:** Single store module (`store.ts`) with namespaced `sync` and `local` APIs, backed by an in-memory cache that loads synchronously from localStorage and reconciles async from `browser.storage`. A `settings.ts` module handles the dialog UI and background color application. Types and defaults live in `defaults.ts`. Browser extension API types are declared in `browser.d.ts`.

**Tech Stack:** TypeScript, Tailwind CSS v4, esbuild (bundled output), browser extension APIs (Manifest V3)

**Note:** This project has no test framework (zero-dependency philosophy). Verification steps use build checks and manual browser testing instead of unit tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/browser.d.ts` | Create | TypeScript declarations for `browser.storage` APIs |
| `src/defaults.ts` | Create | `SyncSettings` and `LocalSettings` interfaces + default value objects |
| `src/store.ts` | Create | Singleton store: in-memory cache, localStorage mirror, browser.storage reconciliation, namespaced sync/local API with get/set/delete/subscribe, cross-tab sync |
| `src/settings.ts` | Create | Settings dialog open/close, color button handlers, active state, background color application |
| `src/index.ts` | Modify | Init store, apply background color immediately, mount settings on DOMContentLoaded |
| `src/index.html` | Modify | Add settings gear button + `<dialog>` element with color buttons |
| `src/styles.css` | Modify | Add dialog backdrop, button, and active-state styling |
| `build.sh` | Modify | Add `--bundle` flag to esbuild (required now that we have module imports) |

---

## Chunk 1: Storage Foundation

### Task 1: Create browser type declarations

**Files:**
- Create: `src/browser.d.ts`

- [ ] **Step 1: Create `src/browser.d.ts`**

```ts
interface BrowserStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface BrowserStorageOnChanged {
  addListener(
    callback: (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string
    ) => void
  ): void;
}

interface BrowserStorage {
  sync: BrowserStorageArea;
  local: BrowserStorageArea;
  onChanged: BrowserStorageOnChanged;
}

interface BrowserAPI {
  storage: BrowserStorage;
}

declare global {
  var browser: BrowserAPI | undefined;
  var chrome: BrowserAPI | undefined;
}

export {};
```

- [ ] **Step 2: Commit**

```bash
git add src/browser.d.ts
git commit -m "feat: add browser extension API type declarations"
```

---

### Task 2: Create defaults module

**Files:**
- Create: `src/defaults.ts`

- [ ] **Step 1: Create `src/defaults.ts`**

```ts
export interface SyncSettings {
  bgColor: "red" | "green" | "blue";
}

export interface LocalSettings {
  // Future: large objects, images, etc.
}

export const syncDefaults: SyncSettings = {
  bgColor: "blue",
};

export const localDefaults: LocalSettings = {};
```

- [ ] **Step 2: Commit**

```bash
git add src/defaults.ts
git commit -m "feat: add typed settings interfaces and defaults"
```

---

### Task 3: Create store module

**Files:**
- Create: `src/store.ts`

- [ ] **Step 1: Create `src/store.ts`**

```ts
import type { SyncSettings, LocalSettings } from "./defaults";
import { syncDefaults, localDefaults } from "./defaults";

const browserApi = globalThis.browser ?? globalThis.chrome;

const LS_PREFIX = "sp:";

type Callback<V> = (value: V) => void;

export interface StoreNamespace<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  delete<K extends keyof T>(key: K): void;
  subscribe<K extends keyof T>(key: K, callback: Callback<T[K]>): () => void;
}

interface NamespaceInternal<T extends Record<string, unknown>>
  extends StoreNamespace<T> {
  reconcile(): Promise<void>;
  handleExternalChange(key: string, newValue: unknown): void;
}

function createNamespace<T extends Record<string, unknown>>(
  area: "sync" | "local",
  defaults: T,
  storage: BrowserStorageArea | null
): NamespaceInternal<T> {
  const cache = { ...defaults };
  const subscribers = new Map<keyof T, Set<Callback<any>>>();
  const prefix = `${LS_PREFIX}${area}:`;

  // Instant load from localStorage
  for (const key of Object.keys(defaults)) {
    const raw = localStorage.getItem(`${prefix}${key}`);
    if (raw !== null) {
      try {
        (cache as any)[key] = JSON.parse(raw);
      } catch {
        // Corrupted localStorage entry — keep default
      }
    }
  }

  function notify<K extends keyof T>(key: K, value: T[K]): void {
    const subs = subscribers.get(key);
    if (subs) {
      for (const cb of subs) {
        cb(value);
      }
    }
  }

  return {
    get<K extends keyof T>(key: K): T[K] {
      return cache[key];
    },

    set<K extends keyof T>(key: K, value: T[K]): void {
      cache[key] = value;
      localStorage.setItem(`${prefix}${String(key)}`, JSON.stringify(value));
      storage?.set({ [key as string]: value }).catch(() => {});
      notify(key, value);
    },

    delete<K extends keyof T>(key: K): void {
      const defaultVal = defaults[key];
      cache[key] = defaultVal;
      localStorage.removeItem(`${prefix}${String(key)}`);
      storage?.remove(String(key)).catch(() => {});
      notify(key, defaultVal);
    },

    subscribe<K extends keyof T>(key: K, callback: Callback<T[K]>): () => void {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set());
      }
      subscribers.get(key)!.add(callback);
      return () => {
        subscribers.get(key)?.delete(callback);
      };
    },

    async reconcile(): Promise<void> {
      if (!storage) return;
      try {
        const keys = Object.keys(defaults);
        const result = await storage.get(keys);
        for (const key of keys) {
          if (key in result) {
            const val = result[key] as T[keyof T];
            if (JSON.stringify(cache[key as keyof T]) !== JSON.stringify(val)) {
              (cache as any)[key] = val;
              localStorage.setItem(`${prefix}${key}`, JSON.stringify(val));
              notify(key as keyof T, val);
            }
          }
        }
      } catch {
        // browser.storage unavailable — localStorage-only mode
      }
    },

    handleExternalChange(key: string, newValue: unknown): void {
      const k = key as keyof T;
      if (!(k in defaults)) return;
      // undefined means key was deleted in another tab — reset to default
      const val = (newValue === undefined ? defaults[k] : newValue) as T[keyof T];
      if (JSON.stringify(cache[k]) !== JSON.stringify(val)) {
        cache[k] = val;
        if (newValue === undefined) {
          localStorage.removeItem(`${prefix}${key}`);
        } else {
          localStorage.setItem(`${prefix}${key}`, JSON.stringify(val));
        }
        notify(k, val);
      }
    },
  };
}

function getStorage(area: "sync" | "local"): BrowserStorageArea | null {
  try {
    return browserApi?.storage?.[area] ?? null;
  } catch {
    return null;
  }
}

const syncNs = createNamespace<SyncSettings>(
  "sync",
  syncDefaults,
  getStorage("sync")
);
const localNs = createNamespace<LocalSettings>(
  "local",
  localDefaults,
  getStorage("local")
);

export const store = {
  sync: {
    get: syncNs.get,
    set: syncNs.set,
    delete: syncNs.delete,
    subscribe: syncNs.subscribe,
  } as StoreNamespace<SyncSettings>,

  local: {
    get: localNs.get,
    set: localNs.set,
    delete: localNs.delete,
    subscribe: localNs.subscribe,
  } as StoreNamespace<LocalSettings>,

  async init(): Promise<void> {
    await Promise.all([syncNs.reconcile(), localNs.reconcile()]);

    // Cross-tab synchronization
    try {
      browserApi?.storage?.onChanged?.addListener((changes, areaName) => {
        const ns =
          areaName === "sync"
            ? syncNs
            : areaName === "local"
              ? localNs
              : null;
        if (!ns) return;
        for (const [key, change] of Object.entries(changes)) {
          if ("newValue" in change) {
            ns.handleExternalChange(key, change.newValue);
          }
        }
      });
    } catch {
      // browser.storage unavailable
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/store.ts
git commit -m "feat: add unified store with sync/local namespaces and localStorage mirror"
```

---

### Task 4: Enable bundling in build script

**Files:**
- Modify: `build.sh`

Now that `index.ts` imports other modules, esbuild needs `--bundle` to resolve and inline them.

- [ ] **Step 1: Add `--bundle` flag to all four esbuild invocations in `build.sh`**

Change line 76 (build function):
```
"$ESBUILD" src/index.ts --outfile=dist/index.js --minify
```
to:
```
"$ESBUILD" src/index.ts --bundle --outfile=dist/index.js --minify
```

Change line 88 (watch initial build):
```
"$ESBUILD" src/index.ts --outfile=dist/index.js --minify
```
to:
```
"$ESBUILD" src/index.ts --bundle --outfile=dist/index.js --minify
```

Change line 93 (watch watcher):
```
"$ESBUILD" src/index.ts --outfile=dist/index.js --watch=forever &
```
to:
```
"$ESBUILD" src/index.ts --bundle --outfile=dist/index.js --watch=forever &
```

- [ ] **Step 2: Commit**

```bash
git add build.sh
git commit -m "feat: enable esbuild bundling for module imports"
```

---

### Task 5: Verify storage foundation builds

- [ ] **Step 1: Run the build**

Run: `./build.sh`
Expected: `Build complete. Output in dist/` with no errors.

- [ ] **Step 2: Verify `dist/index.js` contains bundled store code**

Run: `grep -c "localStorage" dist/index.js`
Expected: At least 1 match (proves store.ts was bundled in).

---

## Chunk 2: Settings UI

### Task 6: Update HTML with settings UI markup

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Replace the contents of `src/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Tab</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <button id="settings-open" class="fixed top-4 left-4 p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors" aria-label="Open settings">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
  </div>

  <dialog id="settings-dialog" aria-labelledby="settings-title" class="rounded-xl p-0 backdrop:bg-black/50">
    <div class="p-6 min-w-[300px]">
      <h2 id="settings-title" class="text-lg font-semibold mb-4">Settings</h2>
      <fieldset class="border-0 p-0 m-0">
        <legend class="text-sm font-medium mb-2">Background Color</legend>
        <div class="flex gap-2">
          <button data-color="red" aria-pressed="false" class="px-4 py-2 rounded-lg bg-red-500 text-white hover:opacity-80 transition-opacity">Red</button>
          <button data-color="green" aria-pressed="false" class="px-4 py-2 rounded-lg bg-green-500 text-white hover:opacity-80 transition-opacity">Green</button>
          <button data-color="blue" aria-pressed="false" class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:opacity-80 transition-opacity">Blue</button>
        </div>
      </fieldset>
      <button id="settings-close" class="mt-6 px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors text-sm">Close</button>
    </div>
  </dialog>

  <script src="index.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat: add settings button and dialog markup"
```

---

### Task 7: Add dialog and button styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Update `src/styles.css`**

```css
@import "tailwindcss";

/* Active color button ring */
button[aria-pressed="true"] {
  outline: 3px solid white;
  outline-offset: 2px;
}

/* Transition for body background color */
body {
  transition: background-color 0.2s ease;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat: add dialog button active state and body transition styles"
```

---

### Task 8: Create settings module

**Files:**
- Create: `src/settings.ts`

- [ ] **Step 1: Create `src/settings.ts`**

```ts
import { store } from "./store";
import type { SyncSettings } from "./defaults";

// Full string literals so Tailwind scanner finds them
const BG_CLASSES: Record<SyncSettings["bgColor"], string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
};

export function applyBgColor(color: SyncSettings["bgColor"]): void {
  document.body.classList.remove("bg-red-500", "bg-green-500", "bg-blue-500");
  document.body.classList.add(BG_CLASSES[color]);
}

export function initSettings(): void {
  const dialog = document.getElementById(
    "settings-dialog"
  ) as HTMLDialogElement;
  const openBtn = document.getElementById(
    "settings-open"
  ) as HTMLButtonElement;
  const closeBtn = document.getElementById(
    "settings-close"
  ) as HTMLButtonElement;
  const colorBtns =
    dialog.querySelectorAll<HTMLButtonElement>("[data-color]");

  openBtn.addEventListener("click", () => dialog.showModal());
  closeBtn.addEventListener("click", () => dialog.close());

  // Color button clicks
  colorBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color as SyncSettings["bgColor"];
      store.sync.set("bgColor", color);
    });
  });

  // Active button state
  function updateActiveButton(color: SyncSettings["bgColor"]): void {
    colorBtns.forEach((btn) => {
      const isActive = btn.dataset.color === color;
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  updateActiveButton(store.sync.get("bgColor"));
  store.sync.subscribe("bgColor", updateActiveButton);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add settings dialog logic and background color application"
```

---

### Task 9: Wire everything in entrypoint

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` contents**

```ts
import { store } from "./store";
import { applyBgColor, initSettings } from "./settings";

// Apply background color immediately from synchronous cache.
// The script tag is at the bottom of <body>, so document.body exists.
// This avoids a flash of unstyled background on page load.
applyBgColor(store.sync.get("bgColor"));
store.sync.subscribe("bgColor", applyBgColor);

document.addEventListener("DOMContentLoaded", async () => {
  // Reconcile with browser.storage (async) and register cross-tab listener
  await store.init();

  // Mount settings UI
  initSettings();
});
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire store and settings into entrypoint"
```

---

### Task 10: Build and verify end-to-end

- [ ] **Step 1: Run full build**

Run: `./build.sh`
Expected: `Build complete. Output in dist/` with no errors.

- [ ] **Step 2: Verify dist/ contents are complete**

Run: `ls dist/`
Expected: `index.html  index.js  manifest.json  styles.css`

- [ ] **Step 3: Verify bundled JS includes all modules**

Run: `grep -c "localStorage" dist/index.js`
Expected: At least 1 match.

Run: `grep -c "showModal" dist/index.js`
Expected: At least 1 match.

- [ ] **Step 4: Verify Tailwind output includes background color classes**

Run: `grep -c "bg-red" dist/styles.css`
Expected: At least 1 match.

Run: `grep -c "bg-green" dist/styles.css`
Expected: At least 1 match.

Run: `grep -c "bg-blue" dist/styles.css`
Expected: At least 1 match.

- [ ] **Step 5: Load extension in Chrome and verify**

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select `dist/`
4. Open a new tab

Expected:
- Page loads with blue background (default)
- Gear icon visible in top-left corner
- Clicking gear opens settings dialog with backdrop
- Three color buttons (Red, Green, Blue) — Blue has active ring
- Clicking Red changes background to red immediately, Red button gets active ring
- Pressing Escape closes dialog
- Opening new tab shows the last-selected color instantly (no flash)
- Changing color in one tab updates the other tab's background (cross-tab sync)

- [ ] **Step 6: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end verification"
```
