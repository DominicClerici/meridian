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

## Documentation

**[`docs/OVERVIEW.md`](docs/OVERVIEW.md) is the map — read it first.** It indexes every subsystem to its own doc, and has a "where do I find…" table for going from a symptom to the right file. Each feature doc also ends with a *Refactor candidates* section listing known problems in that area.

Quick pointers:

| Working on | Read |
|---|---|
| Boot order, module graph, which module owns which element ID | [`docs/architecture.md`](docs/architecture.md) |
| Settings persistence, storage keys, IndexedDB | [`docs/storage.md`](docs/storage.md) |
| Colors, themes, tokens, icons | [`docs/design-system.md`](docs/design-system.md) |
| Buttons, inputs, selects, dialogs, popovers | [`docs/components.md`](docs/components.md) |
| Adding a setting, the settings dialog | [`docs/settings-ui.md`](docs/settings-ui.md) |

`docs/superpowers/` holds historical plans and specs. They record past intent, not current behavior — do not treat them as documentation.

**Entrypoint:** `src/index.ts` — applies theme and background synchronously (no flash) in the module body, then awaits `store.init()` and calls each subsystem's `initX()` on DOMContentLoaded.

**Storage layer (`src/store.ts`):** Reactive key-value store with two typed namespaces (`store.sync` backed by `browser.storage.sync`, `store.local` backed by `browser.storage.local`). Reads are synchronous from an in-memory cache seeded by localStorage on load; `init()` reconciles with browser.storage async. Cross-tab sync via `browser.storage.onChanged`.

**Adding a new setting:** Add the key/type to the interface in `src/defaults.ts`, add a default value, done. The store picks it up automatically. To surface it in the UI, see [`docs/settings-ui.md`](docs/settings-ui.md).

**Browser API types (`src/browser.d.ts`):** Ambient declarations for `browser`/`chrome` storage, identity, and history APIs. Modules use `globalThis.browser ?? globalThis.chrome` for cross-browser compat.

## Key Conventions

- **Tailwind CSS v4** — uses `@import "tailwindcss"` syntax (not v3 `@tailwind` directives). There is no config file; the `@theme inline` block in `src/styles.css` is the config. Utility classes go in `index.html` and in the class strings of JS-built elements.
- **No runtime dependencies.** Everything is vanilla TypeScript + HTML + Tailwind utilities.
- **TypeScript strict mode.** The store is fully generic-typed; settings keys and values are enforced at compile time.
- **localStorage keys** are prefixed `sp:sync:` / `sp:local:` to avoid collisions.
- **Comments** - do not use comments unless explaining complex or hard to understand code. No redundant or self explanatory comments.
- **Keep docs current.** If a change moves a storage key, renames an element ID, or alters a subsystem's behavior, update the matching file in `docs/` in the same commit. If it fixes something listed under *Refactor candidates*, delete that entry.
