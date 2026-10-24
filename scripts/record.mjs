#!/usr/bin/env node
// Records MultiViewer's F1 live timing state once a second as gzip NDJSON, for
// developing and testing Pit Wall's replay mode outside live sessions.
//
//   npm run record -- --minutes 130 --out recordings/2026-us-gp-race.ndjson.gz

import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    minutes: { type: "string", default: "120" },
    out: { type: "string" },
    url: { type: "string", default: "http://localhost:10101/api/graphql" },
  },
});
const out = values.out ?? `recordings/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.ndjson.gz`;
const stopAt = Date.now() + Number(values.minutes) * 60_000;

const TOPICS =
  "ArchiveStatus CarData ChampionshipPrediction DriverList ExtrapolatedClock Heartbeat LapCount LapSeries " +
  "PitLaneTimeCollection Position RaceControlMessages SessionData SessionInfo SessionStatus TeamRadio " +
  "TimingAppData TimingData TimingStats TopThree TrackStatus WeatherData WeatherDataSeries";
const body = JSON.stringify({
  query: `{ f1LiveTimingState { ${TOPICS} } f1LiveTimingClock { paused systemTime trackTime liveTimingStartTime } }`,
});

const gzip = createGzip();
gzip.pipe(createWriteStream(out));
let frames = 0;
let errors = 0;
let stopping = false;

const finish = () => {
  if (stopping) return;
  stopping = true;
  gzip.end(() => console.log(`\nframes=${frames} errors=${errors} file=${out}`));
};
process.on("SIGINT", finish);
process.on("SIGTERM", finish);

console.log(`Recording to ${out} until ${new Date(stopAt).toLocaleTimeString()} (Ctrl+C to stop early)`);
while (!stopping && Date.now() < stopAt) {
  const t = Date.now();
  try {
    const res = await fetch(values.url, { method: "POST", headers: { "content-type": "application/json" }, body });
    const { data } = await res.json();
    gzip.write(JSON.stringify({ t, ...data }) + "\n");
    frames++;
    if (frames % 60 === 0) process.stdout.write(".");
  } catch {
    errors++;
  }
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t))));
}
finish();
