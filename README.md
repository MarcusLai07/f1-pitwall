# Pit Wall

One rearrangeable window for following F1 sessions: timing tower, 3D track map, telemetry, team radio with transcripts, race control and sector leaderboard, with weather and the session clocks in the header. It's a Chromium extension (built for Dia; works in Chrome, Arc, Brave and Edge) that opens as its own resizable window, with a compact side-panel view too.

## Install in one line (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/MarcusLai07/f1-pitwall/main/install.sh | bash
```

It downloads the latest release to `~/PitWall`, copies that folder's path to your clipboard and opens your browser's extensions page. Then:

1. Turn on **Developer mode** (top right).
2. Click **Load unpacked** → press **⌘⇧G** → **⌘V** → Return → **Select**.
3. Pin Pit Wall from the 🧩 menu and click it.

**Update:** run the same line again, then click ↻ on Pit Wall in the extensions page.

<details>
<summary><b>Windows, Linux, other options and uninstall</b></summary>

<br>

| | |
|---|---|
| Without the script | Download `pit-wall.zip` from [the latest release](https://github.com/MarcusLai07/f1-pitwall/releases/latest), unzip it somewhere it can stay, and pick that folder in **Load unpacked**. To update, unzip the new one over it and click ↻. |
| Somewhere else | `… \| bash -s -- --dir ~/Apps/PitWall` |
| Uninstall | `… \| bash -s -- --uninstall`, then remove Pit Wall from the extensions page |

**Why the manual click?** Browsers only let you add an extension outside their store through *Load unpacked*. No script is allowed to do it for you.

</details>

## Where the data comes from

Straight from F1, in your browser. Pit Wall has no server.

- **Live:** F1's live timing feed. Without signing in you get F1's free feed: timing, sectors and race control. **Sign in to F1 TV** (top right of **Sessions**) to add cars on the map, telemetry and team radio. F1's feed runs ahead of most video streams, so open the source menu (the **Live · F1** chip) and raise **Delay** until the timing matches what you're watching.
- **Past sessions:** **Sessions → Replay** loads any past session's timing, track positions, telemetry and team radio from F1's timing archive (the one FastF1 uses). It needs the F1 TV sign-in. There's no video; scrub with the replay bar.
- **Signing in:** click **Sign in to F1 TV** at the top right of **Sessions** and enter your F1 account's email and password. Pit Wall signs in to F1's own sign-in service (`id.formula1.com`) the way [FastF1](https://docs.fastf1.dev) does: your email and password go only to F1, and Pit Wall keeps just the F1 TV token F1 gives back (in the extension's own storage), never the password. If this browser is already signed in to F1, it may not even ask. The token lasts a few days; sign in again when Sessions says it ran out. Click your plan's name (e.g. **F1 TV Pro ▾**) to **Sign out of Pit Wall**, which deletes the token. (formula1.com used to leave the token in a cookie; Pit Wall still uses one if it finds it.)
- **Video:** Pit Wall shows data only. Watch the session wherever you normally do and set the **Delay** to match it. It doesn't depend on F1 TV's video, so it also works where F1 TV blocks live streams or current-season replays.

## Use

- **Sessions:** every session of a season, past, live and upcoming, in your time zone. **Replay** plays a past one from F1's archive and **Follow** switches to live. Your F1 TV sign-in sits top right.
- **Source chip** (top right, e.g. *Live · F1 TV · 3 s behind* or *Replay · F1 TV archive*): what the board shows and where it comes from. Click it to set the live delay.
- **Toolbar button:** opens Pit Wall in its own window (or focuses it). The window remembers its size and position.
- **Any screen:** the window is laid out for a ~900 px tall screen and scales to the real one, so a big monitor gets the same layout, just larger; other aspect ratios only stretch the columns. Nothing scrolls: widgets resize to fit the height. **Layout → UI size** makes everything bigger or smaller.
- **Right-click the toolbar button → Open in side panel:** the compact one-column view. Narrow windows (under 760 px) use it too.
- **Header:** session time remaining, **Track time** (the circuit's time zone) next to **Your time** (the same moment in your time zone), and a weather strip.
- **Timing tower:** mini-sectors sit under each sector time. Click a driver's tyre for their tyre history: every set, new or used, the laps run on it and its best lap, with each pit stop in between (official pit-lane time, plus the time stood still estimated from car data, ±0.3 s). Live, stops are timed from when Pit Wall starts watching; sessions loaded from F1's archive have every stop.
- **Click drivers** in the timing tower to select them (up to five). Telemetry shows the two most recent in the widget; cars 3–5 open out to its left as floating cards of the same size. The map highlights them and **follow** tracks the most recent one.
- **Track map:** drag to move it, right-drag (or Shift + drag) to rotate and tilt, scroll to zoom, double-click or **fit** to frame the whole track again. A new fastest lap (provisional pole in Q3) and, in races, a new leader drop in as banners at the top of the map. It checks the stored track shape against where cars actually drive: if F1 has moved the coordinate frame it re-aligns the shape, and if the layout doesn't match at all (or there's no stored shape) it draws the track from a live lap instead. The result is remembered per circuit and season.
- **Team radio:** play any clip. Set **Transcripts** to *Standard* (about 250 MB) or *Light* (about 80 MB) to transcribe clips on your Mac with OpenAI's Whisper; the model downloads once and transcripts are kept.
- **Drawer** (under the timing tower): Race control, Investigations (each incident's latest status and any penalty), Track limits (strikes per driver), Lap times (every lap by driver, with tyres) and Race trace (gap to the leader by lap; lap times in practice and qualifying). New race control messages pop up above it; click one to open its tab. Live, lap times and race trace start from when Pit Wall starts watching; sessions loaded from F1's archive have every lap.
- **Layout:** hover the top edge of a widget to slide its title bar down, then drag it to move and resize from the edges. The grid moves in steps of one timing row, and the tower stops growing at the last driver. The **Layout** menu adds or removes widgets, locks the layout, switches between *snap upward* (default) and *free placement*, and resets to the default.

## Replay

Past sessions loaded from **Sessions** play in the replay bar. Space plays and pauses; the bar has seek, ±10 s and 1–16× speed. Replays start a minute before the session's clock starts. **Go live** switches back.

## Develop

Needs Node 20+.

```bash
npm install
npm run dev     # dev page
npm run build   # the extension, in dist/ (Load unpacked → dist)
```

The dev page opens on [localhost:5288/window.html](http://localhost:5288/window.html) (or `/sidepanel.html`). The dev server proxies `/f1live` to F1's live feed and `/f1static` to its archive, because neither sends CORS headers; the built extension uses `host_permissions` instead. The dev page can't read cookies, so F1 TV sign-in only works in the extension.

- `?replay=/recordings/<file>` loads an older MultiViewer recording (gzip NDJSON, one state per line) from `recordings/`.
- `?archive=<session path>&archiveBase=/recordings/archive/` plays a saved copy of an archive session, e.g. `recordings/archive/2024/2024-10-27_Mexico_City_Grand_Prix/2024-10-27_Race/` holding its `.jsonStream` files.

**Releasing:** bump the version, then `git tag v0.3.0 && git push origin v0.3.0`. The Release workflow builds the extension, stamps the tag's version into its manifest and attaches `pit-wall.zip` to a GitHub release, which `install.sh` downloads.

Code map:

- `src/data/`: F1 live feed client (`f1live.ts`), F1 archive loader (`archive.ts`), replay engine, store, sample buffers for car positions and telemetry, and `derive.ts`, which turns raw F1 topics into tower rows.
- `src/sessions/`: the session picker, its schedule (OpenF1, or F1's archive index while OpenF1 is closed during live sessions) and the F1 TV sign-in.
- `src/widgets/`: the widgets. The timing tower, telemetry and track map are adapted from `f1-dashboard`.
- `src/circuit3d/`, `src/circuits/`: the three.js circuit engine and the FastF1-derived track geometry, copied from `f1-dashboard`.
- `src/layout/`: grid layout, defaults and persistence.

## Notes

- F1's live feed and archive are unofficial interfaces and could change without notice.
- Permissions: `*.formula1.com` to sign in to F1 and reach its live feed and archive (team radio clips come from there too), `cookies` to pick up a formula1.com login left in a cookie, `api.openf1.org` for the schedule.
- Your F1 TV token stays in your browser. Pit Wall only sends it to F1's own live timing and archive at `livetiming.formula1.com`; your password only ever goes to `id.formula1.com`.
- Circuits without a stored shape (e.g. Madring) or with a different layout show a map after about one lap of running, drawn from live positions (no sector colours or turn numbers there).
- For personal use. Don't redistribute the timing data.
