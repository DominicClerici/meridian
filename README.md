# Startpage

A Chrome extension that turns every new tab into a proper dashboard. Shortcuts, search, smart recommendations, and a full widget suite — all running on zero npm dependencies, compiled from a single `build.sh`.

## Features

- **Shortcut dock** — bookmarks organized into tabs and folders, drag to reorder, searchable inline
- **Smart recommendations** — analyzes 3 months of browsing history into a time-of-day heatmap and surfaces the sites you're most likely to visit right now, weighted by day of week and hour
- **Search** — unified bar with swappable engines (Google, Bing, DuckDuckGo, Ecosia, and more), shortcuts indexed alongside
- **Clock** — timezone, 12/24h toggle, seconds, date format, all configurable
- **Weather** — hourly forecast with an interactive SVG chart; powered by [Open-Meteo](https://open-meteo.com/), no API key required
- **Spotify** — shows current track with album art and playback controls; full OAuth via PKCE, no backend
- **Todo list** — overdue / active / completed sections, drag-to-reorder, due dates, auto-purge of items over 30 days stale
- **Google Calendar** — upcoming events via OAuth2, no server needed
- **Backgrounds** — [Unsplash](https://unsplash.com/) integration for a daily photo refresh, or upload your own

Appearance is controlled by four independent axes — theme, accent color, background color, and light/dark mode — and syncs across devices via `browser.storage.sync`.

## Tech Stack

- **Vanilla TypeScript** — strict mode, no frameworks, zero runtime dependencies
- **Tailwind CSS v4** — standalone CLI binary; `node_modules/` doesn't exist
- **esbuild** — standalone binary bundler; the whole project compiles offline from `bin/`
- **Open-Meteo** — free weather API, no key required
- **Spotify Web API** — PKCE OAuth flow runs entirely in the browser, no backend
- **Google Calendar API** — same; OAuth2 via `chrome.identity`

The extension compiles down to two files — `dist/index.js` and `dist/styles.css`. The reactive state layer is a custom store built on `browser.storage` with a synchronous localStorage mirror: reads are instant on load, writes propagate cross-tab, and there's no flash of unstyled content because the theme gets applied synchronously before the first paint.

## Getting Started

The build requires two standalone binaries in `bin/` — the Tailwind CSS CLI and esbuild. If either is missing, `build.sh` prints the exact `curl` command to download it for your platform.

```bash
# one-shot build → dist/
./build.sh

# watch mode for development
./build.sh --watch
```

Then load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select the `dist/` folder

Open a new tab.

## API Keys

Most features work out of the box. A few need setup:

| Feature | What to do |
|---------|-----------|
| Weather | Nothing — Open-Meteo is free and keyless |
| Spotify | Click **Connect** in the widget; PKCE flow, no key needed |
| Unsplash backgrounds | Add your API key in **Settings → Appearance** |
| Google Calendar | Replace `client_id` in `manifest.json` with your own Google OAuth client |

## License

No license. Use it however you want.
