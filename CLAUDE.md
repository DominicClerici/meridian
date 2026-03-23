# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome extension (Manifest V3) that replaces the new tab page with a custom startpage. No npm/node_modules — build tools are standalone binaries in `bin/`.

## Build Commands

```bash
./build.sh          # One-shot build → dist/
```

Requires two binaries in `bin/`: `tailwindcss` (v4.2.2 standalone CLI) and `esbuild` (v0.27.4). If missing, `build.sh` prints download instructions for the current platform.

**Type-checking only** (no emit): `npx tsc --noEmit` or use the tsconfig.json with your editor. esbuild handles the actual compilation — TypeScript errors won't block builds.

## Architecture

**Entrypoint:** `src/index.ts` — applies stored settings synchronously (no flash), subscribes to changes, then calls `store.init()` and `initSettings()` on DOMContentLoaded.

**Storage layer (`src/store.ts`):** Reactive key-value store with two typed namespaces (`store.sync` backed by `browser.storage.sync`, `store.local` backed by `browser.storage.local`). Reads are synchronous from an in-memory cache seeded by localStorage on load; `init()` reconciles with browser.storage async. Cross-tab sync via `browser.storage.onChanged`. See `STORAGE.md` for full API reference.

**Adding a new setting:** Add the key/type to the interface in `src/defaults.ts`, add a default value, done. The store picks it up automatically.

**Settings UI (`src/settings.ts`):** Wires the `<dialog>` and color buttons in `index.html` to the store. Uses `data-color` attributes and `aria-pressed` for active state.

**Browser API types (`src/browser.d.ts`):** Ambient declarations for `browser`/`chrome` storage APIs. The store uses `globalThis.browser ?? globalThis.chrome` for cross-browser compat.

## Key Conventions

- **Tailwind CSS v4** — uses `@import "tailwindcss"` syntax (not v3 `@tailwind` directives). Utility classes go directly in `index.html`.
- **No runtime dependencies.** Everything is vanilla TypeScript + HTML + Tailwind utilities.
- **TypeScript strict mode.** The store is fully generic-typed; settings keys and values are enforced at compile time.
- **localStorage keys** are prefixed `sp:sync:` / `sp:local:` to avoid collisions.
- **Comments** - do not use comments unless explaining complex or hard to understand code. No redundant or self explanatory comments.
