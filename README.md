# Pit Wall

One rearrangeable window for following F1 sessions live: timing tower, 3D track map, telemetry, race control and sector leaderboard, with weather and the session clocks in the header. It's a Chromium extension (built for Dia) that opens as its own resizable window, with a compact side-panel view too.

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
- **Right-click the toolbar button → Open in side panel:** the compact one-column view. Narrow windows (under 760 px) use it too.
- **Header:** session time remaining, **Track time** (the circuit's time zone) next to **Your time** (the same moment in your time zone), and a weather strip.
- **Timing tower:** mini-sectors sit under each sector time. Click a driver's tyre for their tyre history: every set, new or used, the laps run on it and its best lap.
- **Click drivers** in the timing tower to select them (up to four). Telemetry shows them two across (stacked when the widget is narrow) and grows a row of cards at a time; the map highlights them and **follow** tracks the most recent one.
- **Track map:** drag to move it, right-drag (or Shift + drag) to rotate and tilt, scroll to zoom, double-click or **fit** to frame the whole track again. It checks the stored track shape against where cars actually drive: if F1 has moved the coordinate frame it re-aligns the shape, and if the layout doesn't match at all (or there's no stored shape) it draws the track from a live lap instead. The result is remembered per circuit and season.
- **Team radio:** play any clip. Set **Transcripts** to *Standard* (about 250 MB) or *Light* (about 80 MB) to transcribe clips on your Mac with OpenAI's Whisper; the model downloads once and transcripts are kept.
- **Drawer** (under the timing tower): Race control, Investigations (each incident's latest status and any penalty), Track limits (strikes per driver), Lap times (every lap by driver, with tyres) and Race trace (gap to the leader by lap; lap times in practice and qualifying). New race control messages pop up above it; click one to open its tab. Lap times and race trace start from when Pit Wall starts watching.
- **Layout:** hover the top edge of a widget to slide its title bar down, then drag it to move and resize from the edges. The grid moves in steps of one timing row, and the tower stops growing at the last driver. The **Layout** menu adds or removes widgets, locks the layout, switches between *snap upward* (default) and *free placement*, and resets to the default.

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
- Team radio audio and transcription fetch clips from F1's archive (`livetiming.formula1.com/static`), so the extension asks for access to that host.
- Circuits without a stored shape (e.g. Madring) or with a different layout show a map after about one lap of running, drawn from live positions (no sector colours or turn numbers there).
- For personal use. Don't redistribute the timing data.
