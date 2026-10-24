# Pit Wall

One rearrangeable window for following F1 sessions live: timing tower, 3D track map, telemetry, race control, sector leaderboard, weather and tyre strategy. It's a Chromium extension (built for Dia) that opens as its own resizable window, with a compact side-panel view too.

Pit Wall doesn't talk to F1 itself. It reads the live timing that [MultiViewer](https://multiviewer.app) already pulls with your F1 TV login, through MultiViewer's local API on `localhost:10101`. Because MultiViewer holds that data back to match its video player, everything in Pit Wall lines up with what you're watching.

## Requirements

- MultiViewer running and signed in to F1 TV, with a live session (or a replay) open.
- Node 20+ to build.

## Install

```bash
npm install
npm run build
```

Then in Dia open `dia://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist` folder. After rebuilding, click ↻ on Pit Wall in the extensions page.

## Use

- **Toolbar button:** opens Pit Wall in its own window (or focuses it). The window remembers its size and position.
- **Right-click the toolbar button → Open in side panel:** the compact one-column view.
- **Click drivers** in the timing tower to select them (up to four). Telemetry shows the selected drivers and the map highlights them; **follow** on the map tracks the most recent one.
- **Layout:** drag widgets by their title bar and resize from the edges. The **Layout** menu adds or removes widgets, locks the layout, switches between *snap upward* (default) and *free placement*, and resets to the default. Each view keeps a separate layout for practice, qualifying and race.

## Replay

Record a session while MultiViewer is live, then play it back through the same widgets:

```bash
npm run record -- --minutes 130 --out recordings/2026-us-gp-race.ndjson.gz
```

In Pit Wall, click **Replay…** and pick the file. Space plays and pauses; the bar has seek, ±10 s and 1–16× speed. **Go live** switches back.

## Develop

```bash
npm run dev
```

Opens on [localhost:5288/window.html](http://localhost:5288/window.html) (or `/sidepanel.html`). The dev server proxies `/mv` to MultiViewer because its API sends no CORS headers; the built extension uses `host_permissions` instead. Add `?replay=/recordings/<file>` to load a recording from `recordings/` straight away.

Code map:

- `src/data/`: MultiViewer poller, replay loader, store, sample buffers for car positions and telemetry, and `derive.ts`, which turns raw F1 topics into tower rows.
- `src/widgets/`: the widgets. The timing tower, telemetry and track map are adapted from `f1-dashboard`.
- `src/circuit3d/`, `src/circuits/`: the three.js circuit engine and the FastF1-derived track geometry, copied from `f1-dashboard`.
- `src/layout/`: grid layout, defaults and persistence.

## Notes

- MultiViewer's API is unofficial and could change with a MultiViewer update.
- Team radio audio isn't included. The clips live on F1's servers, which block some connections.
- Madring (Madrid) has no track geometry yet, so the map shows a message there.
- For personal use. Don't redistribute the timing data.
