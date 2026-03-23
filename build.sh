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
