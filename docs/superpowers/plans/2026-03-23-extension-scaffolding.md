# Extension Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a cross-browser (Chrome + Firefox) new tab extension with vanilla JS, HTML, Tailwind CSS v4, and a zero-dependency build pipeline using standalone binaries.

**Architecture:** Single MV3 manifest, source in `src/`, built output in `dist/` (which is the loadable extension). Two standalone binaries (Tailwind CLI + esbuild) in `bin/` orchestrated by a shell script with build and watch modes.

**Tech Stack:** Vanilla JS, HTML, Tailwind CSS v4 (standalone CLI), esbuild (standalone binary), Bash

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `.gitignore` | Create | Ignore `bin/`, `dist/` |
| `manifest.json` | Create | MV3 extension manifest with storage + geolocation permissions |
| `src/styles.css` | Create | Tailwind v4 CSS input |
| `src/index.html` | Write (exists, empty) | New tab page HTML shell |
| `src/index.js` | Write (exists, empty) | App entry point with cross-browser compat |
| `build.sh` | Create | Build + watch script orchestrating both binaries |

---

## Chunk 1: Project Foundation

### Task 1: Initialize git repo and create .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

Run: `git init`

- [ ] **Step 2: Create .gitignore**

```
bin/
dist/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: initialize repo with .gitignore"
```

---

### Task 2: Create manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create the manifest**

```json
{
  "manifest_version": 3,
  "name": "Startpage",
  "version": "1.0.0",
  "description": "A custom new tab startpage",
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
  "permissions": [
    "storage",
    "geolocation"
  ]
}
```

- [ ] **Step 2: Validate JSON is parseable**

Run: `python -c "import json; json.load(open('manifest.json')); print('Valid JSON')"` (use `python3` if `python` is not available)
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add MV3 manifest with storage and geolocation permissions"
```

---

### Task 3: Create source files

**Files:**
- Create: `src/styles.css`
- Write: `src/index.html` (exists, empty)
- Write: `src/index.js` (exists, empty)

- [ ] **Step 1: Create src/styles.css**

```css
@import "tailwindcss";
```

- [ ] **Step 2: Write src/index.html**

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
  <div id="app"></div>
  <script src="index.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write src/index.js**

```js
const browser = globalThis.browser || globalThis.chrome;

document.addEventListener("DOMContentLoaded", () => {
  // Weather: navigator.geolocation.getCurrentPosition()
  // Storage: browser.storage.sync.get() / .set()
});
```

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: add source scaffolding (HTML, JS, Tailwind input)"
```

---

## Chunk 2: Build Pipeline

### Task 4: Create build.sh

**Files:**
- Create: `build.sh`

- [ ] **Step 1: Create build.sh with platform detection, binary checks, build mode, and watch mode**

The script must handle:
1. **Platform detection** — detect OS and set binary names (append `.exe` on Windows)
2. **Binary existence check** — if `bin/tailwindcss` or `bin/esbuild` is missing, print download instructions with exact URLs and exit
3. **`bin/` directory creation** — create `bin/` if it doesn't exist
4. **Build mode (default):**
   - Remove and recreate `dist/`
   - Copy `manifest.json` → `dist/manifest.json`
   - Copy `src/index.html` → `dist/index.html`
   - Run: `bin/tailwindcss -i src/styles.css -o dist/styles.css --minify`
   - Run: `bin/esbuild src/index.js --outfile=dist/index.js --minify`
5. **Watch mode (`--watch`):**
   - Do initial build (copy static files, run both tools once)
   - Start `bin/tailwindcss -i src/styles.css -o dist/styles.css --watch` as background process
   - Start `bin/esbuild src/index.js --outfile=dist/index.js --watch=forever` as background process (must use `=forever` since backgrounded processes lose stdin, which causes `--watch` to terminate)
   - Run a loop that re-copies `manifest.json` and `src/index.html` to `dist/` every 1 second
   - Trap `SIGINT`/`SIGTERM` to kill all background processes on `Ctrl+C`

Download instructions to print when binaries are missing:

**Tailwind CSS v4.2.2:**
- Windows: `curl -Lo bin/tailwindcss.exe https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-windows-x64.exe`
- macOS (Apple Silicon): `curl -Lo bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-macos-arm64 && chmod +x bin/tailwindcss`
- Linux: `curl -Lo bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-linux-x64 && chmod +x bin/tailwindcss`

**esbuild v0.27.4 (no GitHub release binaries — extract from npm registry):**
- Windows: `curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/esbuild.exe bin/esbuild.exe && rm -rf package esbuild.tgz`
- macOS (Apple Silicon): `curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/bin/esbuild bin/esbuild && chmod +x bin/esbuild && rm -rf package esbuild.tgz`
- Linux: `curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/bin/esbuild bin/esbuild && chmod +x bin/esbuild && rm -rf package esbuild.tgz`

Full `build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Platform detection ---
EXE=""
OS="$(uname -s)"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) EXE=".exe" ;;
esac

TAILWIND="bin/tailwindcss${EXE}"
ESBUILD="bin/esbuild${EXE}"

# --- Binary check ---
MISSING=0

if [ ! -f "$TAILWIND" ]; then
  echo "ERROR: $TAILWIND not found."
  echo ""
  echo "Download Tailwind CSS v4.2.2 standalone CLI:"
  case "$OS" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      echo "  curl -Lo bin/tailwindcss.exe https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-windows-x64.exe"
      ;;
    Darwin)
      echo "  curl -Lo bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-macos-arm64 && chmod +x bin/tailwindcss"
      ;;
    Linux)
      echo "  curl -Lo bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-linux-x64 && chmod +x bin/tailwindcss"
      ;;
  esac
  echo ""
  MISSING=1
fi

if [ ! -f "$ESBUILD" ]; then
  echo "ERROR: $ESBUILD not found."
  echo ""
  echo "Download esbuild v0.27.4 (extracted from npm registry):"
  case "$OS" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      echo "  curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/esbuild.exe bin/esbuild.exe && rm -rf package esbuild.tgz"
      ;;
    Darwin)
      echo "  curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/bin/esbuild bin/esbuild && chmod +x bin/esbuild && rm -rf package esbuild.tgz"
      ;;
    Linux)
      echo "  curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/bin/esbuild bin/esbuild && chmod +x bin/esbuild && rm -rf package esbuild.tgz"
      ;;
  esac
  echo ""
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  mkdir -p bin
  echo "Create the bin/ directory and run the commands above, then re-run this script."
  exit 1
fi

# --- Build functions ---
copy_static() {
  cp manifest.json dist/manifest.json
  cp src/index.html dist/index.html
}

build() {
  echo "Building..."
  rm -rf dist
  mkdir -p dist
  copy_static
  "$TAILWIND" -i src/styles.css -o dist/styles.css --minify
  "$ESBUILD" src/index.js --outfile=dist/index.js --minify
  echo "Build complete. Output in dist/"
}

watch() {
  echo "Starting watch mode..."
  rm -rf dist
  mkdir -p dist
  copy_static

  # Initial build so dist/ is complete before watchers take over
  "$TAILWIND" -i src/styles.css -o dist/styles.css --minify
  "$ESBUILD" src/index.js --outfile=dist/index.js --minify

  # Start watchers in background
  "$TAILWIND" -i src/styles.css -o dist/styles.css --watch &
  TAILWIND_PID=$!
  "$ESBUILD" src/index.js --outfile=dist/index.js --watch=forever &
  ESBUILD_PID=$!

  # Trap to kill background processes on exit
  cleanup() {
    echo ""
    echo "Stopping watchers..."
    kill "$TAILWIND_PID" "$ESBUILD_PID" 2>/dev/null
    wait "$TAILWIND_PID" "$ESBUILD_PID" 2>/dev/null
    echo "Done."
    exit 0
  }
  trap cleanup SIGINT SIGTERM

  echo "Watching for changes... (Ctrl+C to stop)"

  # Re-copy static files every 1 second
  while true; do
    sleep 1
    copy_static
  done
}

# --- Main ---
case "${1:-}" in
  --watch) watch ;;
  *) build ;;
esac
```

- [ ] **Step 2: Make build.sh executable**

Run: `chmod +x build.sh`

- [ ] **Step 3: Commit**

```bash
git add build.sh
git commit -m "feat: add build script with build and watch modes"
```

---

### Task 5: Download binaries and verify build

**Files:**
- Create: `bin/` directory with binaries

- [ ] **Step 1: Create bin/ directory**

Run: `mkdir -p bin`

- [ ] **Step 2: Download Tailwind CSS standalone CLI**

On Windows (Git Bash):
```bash
curl -Lo bin/tailwindcss.exe https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-windows-x64.exe
```

- [ ] **Step 3: Download esbuild**

On Windows (Git Bash):
```bash
curl -o esbuild.tgz https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.27.4.tgz && tar xzf esbuild.tgz && mv package/esbuild.exe bin/esbuild.exe && rm -rf package esbuild.tgz
```

- [ ] **Step 4: Run the build**

Run: `./build.sh`
Expected output:
```
Building...
Build complete. Output in dist/
```

- [ ] **Step 5: Verify dist/ contents**

Run: `ls dist/`
Expected: `index.html  index.js  manifest.json  styles.css`

- [ ] **Step 6: Verify dist/index.js is minified**

Run: `cat dist/index.js`
Expected: Single line of minified JS containing the browser alias and DOMContentLoaded listener.

- [ ] **Step 7: Verify dist/styles.css has Tailwind output**

Run: `head -5 dist/styles.css`
Expected: Minified CSS containing Tailwind's base/reset styles.

- [ ] **Step 8: Verify dist/manifest.json was copied correctly**

Run: `cat dist/manifest.json`
Expected: Identical to root `manifest.json`.

---

### Task 6: Manual extension load verification

- [ ] **Step 1: Load in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Open a new tab

Expected: Blank page (our empty `<div id="app">`) loads without errors. Check the console (F12) for no errors.

- [ ] **Step 2: Load in Firefox**

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist/manifest.json`
4. Open a new tab

Expected: Same blank page, no console errors.

- [ ] **Step 3: Verify clean working tree**

Run: `git status`
Expected: Nothing to commit (all scaffolding files were already committed in earlier tasks). If any untracked files appear, review them before staging.
