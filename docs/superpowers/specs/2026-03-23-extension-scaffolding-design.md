# Extension Scaffolding Design

## Overview

A cross-browser (Chrome + Firefox) new tab extension built with vanilla JS, HTML, and Tailwind CSS v4. Optimized for performance with no node_modules — uses standalone binaries for the build pipeline.

## Project Structure

```
startpage-final/
├── src/
│   ├── index.html          # Main new tab page
│   ├── index.js            # Application logic
│   └── styles.css          # Tailwind v4 input (@import "tailwindcss")
├── manifest.json           # MV3 manifest (copied to dist on build)
├── build.sh                # Build + watch script
├── bin/                    # Standalone binaries (gitignored)
│   ├── tailwindcss(.exe)    # Tailwind CSS CLI standalone
│   └── esbuild(.exe)       # esbuild standalone
├── dist/                   # Built output (gitignored) — the loadable extension
│   ├── manifest.json
│   ├── index.html
│   ├── index.js            # Minified + bundled
│   └── styles.css          # Purged + minified
└── .gitignore
```

## Manifest V3

```json
{
  "manifest_version": 3,
  "name": "Startpage",
  "version": "1.0.0",
  "description": "A custom new tab startpage",
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
  "permissions": ["storage", "geolocation"]
}
```

- Single manifest works in both Chrome and Firefox (MV3 supported since Firefox 109+).
- `storage` permission enables `browser.storage.sync` for user preferences.
- `geolocation` permission required — Chrome extension pages run on `chrome-extension://` origins, so the Web Geolocation API silently fails without this manifest permission. On Chrome, the permission grants access without a user prompt. On Firefox (`moz-extension://` origins), the browser may still show a permission prompt.
- Cross-browser API compat: In MV3, Chrome supports Promise-based `chrome.storage` calls (no callback needed, Chrome 96+). A simple alias `const browser = globalThis.browser || globalThis.chrome;` covers both browsers for Promise-based usage.
- MV3 CSP note: Inline `<script>` and inline event handlers (`onclick=`) are disallowed by default. All JS must be in external files using `addEventListener`.

## Build Pipeline

### Tools

Two standalone binaries in `bin/` (no node_modules):
- **Tailwind CSS CLI** — standalone binary from [GitHub releases](https://github.com/tailwindlabs/tailwindcss/releases) (platform-specific, e.g. `tailwindcss-windows-x64.exe`)
- **esbuild** — obtained from npm registry by downloading the platform-specific package (e.g. `@esbuild/win32-x64`) and extracting the binary from the tgz, or via `go install github.com/evanw/esbuild/cmd/esbuild@latest`

### Build Script (`build.sh`)

**Default mode (`./build.sh`):**
1. Check that `bin/tailwindcss` and `bin/esbuild` exist; print download instructions if missing
2. Clean `dist/` directory
3. Copy `manifest.json` and `src/index.html` into `dist/`
4. Run Tailwind CLI: `bin/tailwindcss -i src/styles.css -o dist/styles.css --minify`
5. Run esbuild: `bin/esbuild src/index.js --outfile=dist/index.js --minify`

Note: `--bundle` omitted since this is vanilla JS with no module imports. If imports are added later, `--bundle` can be added then.

**Watch mode (`./build.sh --watch`):**
1. Run Tailwind CLI in watch mode (background process)
2. Run esbuild in watch mode (background process)
3. Re-copy static files (`manifest.json`, `index.html`) every 1 second via simple loop (two small files, cheap to copy unconditionally)
4. `Ctrl+C` trap to kill all background processes cleanly

### Binary Setup

User downloads platform-appropriate binaries into `bin/`. The build script prints exact download URLs and instructions when binaries are missing.

## Source Scaffolding

### `src/styles.css`
```css
@import "tailwindcss";
```
Tailwind v4 CSS-first config. Custom theme values added via `@theme {}` blocks later.

### `src/index.html`
- DOCTYPE, charset, viewport meta
- Links `styles.css`
- Root `<div id="app">` container
- Script tag for `index.js`

### `src/index.js`
- `browser`/`chrome` namespace alias
- `DOMContentLoaded` entry point
- Stub comments for weather + storage logic

## Development Loading

- **Chrome:** `chrome://extensions` → Enable Developer Mode → Load unpacked → select `dist/`
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist/manifest.json`

## .gitignore

```
bin/
dist/
```

## Decisions

| Decision | Rationale |
|----------|-----------|
| Single MV3 manifest | Firefox 109+ supports MV3; new tab API surface is identical |
| No node_modules | Performance and lightweight-ness; standalone binaries suffice |
| Tailwind v4 standalone CLI | CSS-first config, no JS toolchain needed |
| esbuild standalone | Fastest JS minifier, available as single binary |
| Shell script build | Simple orchestration of two binaries, no build framework needed |
| `dist/` as extension root | Clean separation of source and distributable |
