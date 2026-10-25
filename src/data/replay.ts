// Replay source: plays back a recording through the same store and buffers as live
// mode. Recordings come from F1's timing archive (archive.ts), or for development from
// older MultiViewer recordings (one state per line, gzip NDJSON; ?replay= on the dev page).

import { parseUtc } from "../lib/format";
import { ingestCarData, ingestPositions, resetBuffers, setPositionHistory } from "./buffers";
import { apply, diff } from "./diff";
import { bumpLaps, feedLaps, resetLaps } from "./laps";
import { bumpPits, feedPits, resetPits } from "./pits";
import { replaceTopics, setWallNow, trackNow, usePitwall } from "./store";
import type { CarDataFrame, LiveClock, LiveState, PositionFrame } from "./types";

interface RecordedLine {
  t: number;
  f1LiveTimingState: LiveState | null;
  f1LiveTimingClock: { paused: boolean; systemTime: string; trackTime: string } | null;
}

export interface Recording {
  name: string;
  /** Frame times, ms (wall time of the recording, or track time for the archive) */
  times: number[];
  /** MultiViewer's clock at frame i, when recorded */
  clockAt: (i: number) => LiveClock | null;
  /** All topics except Position/CarData at frame i; unchanged topics keep their reference */
  stateAt: (i: number) => LiveState;
  positionTimes: number[];
  /** Position frames [from, to) by index into positionTimes */
  positionsBetween: (from: number, to: number) => PositionFrame[];
  carTimes: number[];
  carDataBetween: (from: number, to: number) => CarDataFrame[];
  /** Where playback starts, if not at the first frame */
  startAt?: number;
}

export async function loadRecording(
  src: File | string,
  onProgress: (fraction: number) => void
): Promise<Recording> {
  let stream: ReadableStream<Uint8Array>;
  let total = 0;
  const name = typeof src === "string" ? src.split("/").pop() ?? src : src.name;
  if (typeof src === "string") {
    const res = await fetch(src);
    if (!res.ok || !res.body) throw new Error(`Couldn't load ${src} (${res.status})`);
    total = Number(res.headers.get("content-length")) || 0;
    stream = res.body;
  } else {
    total = src.size;
    stream = src.stream();
  }

  let read = 0;
  const counted = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        read += chunk.byteLength;
        if (total) onProgress(Math.min(1, read / total));
        ctl.enqueue(chunk);
      },
    })
  );
  // The DOM typings want BufferSource writables; the runtime streams are byte streams either way
  type BytePair<O> = ReadableWritablePair<O, Uint8Array>;
  const bytes = name.endsWith(".gz")
    ? counted.pipeThrough(new DecompressionStream("gzip") as unknown as BytePair<Uint8Array>)
    : counted;
  const text = bytes.pipeThrough(new TextDecoderStream() as unknown as BytePair<string>);

  const times: number[] = [];
  const clocks: (LiveClock | null)[] = [];
  const states: LiveState[] = [];
  const positions: PositionFrame[] = [];
  const positionTimes: number[] = [];
  const carData: CarDataFrame[] = [];
  const carTimes: number[] = [];
  let prevRaw: LiveState | undefined;
  let state: LiveState = {};

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const obj = JSON.parse(line) as RecordedLine;
    const raw = obj.f1LiveTimingState;
    if (!raw) return;
    for (const f of raw.Position?.Position ?? []) {
      const t = parseUtc(f.Timestamp);
      if (t > (positionTimes.at(-1) ?? -Infinity)) {
        positions.push(f);
        positionTimes.push(t);
      }
    }
    for (const f of raw.CarData?.Entries ?? []) {
      const t = parseUtc(f.Utc);
      if (t > (carTimes.at(-1) ?? -Infinity)) {
        carData.push(f);
        carTimes.push(t);
      }
    }
    delete raw.Position;
    delete raw.CarData;
    state = apply(state, diff(prevRaw, raw));
    prevRaw = raw;
    const c = obj.f1LiveTimingClock;
    times.push(obj.t);
    clocks.push(c ? { paused: c.paused, systemTime: Number(c.systemTime), trackTime: Number(c.trackTime) } : null);
    states.push(state);
  };

  const reader = text.getReader();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += value;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      handleLine(pending.slice(0, nl));
      pending = pending.slice(nl + 1);
    }
  }
  handleLine(pending);
  if (!times.length) throw new Error("No frames in recording");
  return {
    name,
    times,
    clockAt: (i) => clocks[i],
    stateAt: (i) => states[i],
    positionTimes,
    positionsBetween: (from, to) => positions.slice(from, to),
    carTimes,
    carDataBetween: (from, to) => carData.slice(from, to),
  };
}

/** First index with times[i] >= t */
function lowerBound(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface ReplayControls {
  play: () => void;
  pause: () => void;
  seek: (at: number) => void;
  setSpeed: (speed: number) => void;
  stop: () => void;
}

// How far ahead of the board's clock samples are let through; the map
// interpolates inside this window.
const LOOKAHEAD_MS = 1500;

export function startReplay(rec: Recording): ReplayControls {
  const { times } = rec;
  const start = times[0];
  const end = times[times.length - 1];
  let anchorAt = rec.startAt ?? start;
  let anchorPerf = performance.now();
  let playing = false;
  let speed = 1;
  let idx = -1;
  let posPtr = 0;
  let carPtr = 0;
  let lastPublish = 0;
  let lapsFed = -1;
  let fedState: LiveState | undefined; // the state at lapsFed

  const now = () => (playing ? Math.min(end, anchorAt + (performance.now() - anchorPerf) * speed) : anchorAt);
  setWallNow(now);
  resetBuffers();
  setPositionHistory({ times: rec.positionTimes, between: rec.positionsBetween });
  resetLaps();
  resetPits();

  const publish = (force = false) => {
    const t = performance.now();
    if (!force && t - lastPublish < 250) return;
    lastPublish = t;
    usePitwall.setState((s) => ({ replay: s.replay && { ...s.replay, at: now(), playing, speed } }));
  };

  const step = (seeking = false) => {
    const at = now();
    let i = idx;
    if (i < 0 || times[i] > at) i = Math.max(0, lowerBound(times, at + 1) - 1);
    while (i + 1 < times.length && times[i + 1] <= at) i++;
    if (i !== idx) {
      // Lap history: replay every frame since the last one fed, or rebuild after a jump back
      if (i < lapsFed) {
        resetLaps();
        resetPits();
        lapsFed = -1;
        fedState = undefined;
      }
      let added = false;
      let pits = false;
      for (let f = lapsFed + 1; f <= i; f++) {
        const st = rec.stateAt(f);
        const prev = fedState;
        fedState = st;
        if (st.TimingData === prev?.TimingData && st.PitLaneTimeCollection === prev?.PitLaneTimeCollection) continue;
        added = feedLaps(st.TimingData, st.TimingAppData, false) || added;
        // Track time of that frame, from its own clock
        const clock = rec.clockAt(f);
        const at = clock ? clock.trackTime + (times[f] - clock.systemTime) : times[f];
        pits = feedPits(st.TimingData, st.PitLaneTimeCollection, at, false) || pits;
      }
      lapsFed = i;
      if (added) bumpLaps();
      if (pits) bumpPits();
      idx = i;
      replaceTopics(rec.stateAt(i), rec.clockAt(i), seeking);
    }
    const tn = trackNow();
    if (seeking) {
      resetBuffers();
      // A few minutes back: enough on-track trace for a live-built track shape
      posPtr = lowerBound(rec.positionTimes, tn - 150_000);
      carPtr = lowerBound(rec.carTimes, tn - 60_000);
    }
    const posEnd = lowerBound(rec.positionTimes, tn + LOOKAHEAD_MS);
    if (posEnd > posPtr) ingestPositions(rec.positionsBetween(posPtr, posEnd));
    posPtr = Math.max(posPtr, posEnd);
    const carEnd = lowerBound(rec.carTimes, tn + LOOKAHEAD_MS);
    if (carEnd > carPtr) ingestCarData(rec.carDataBetween(carPtr, carEnd));
    carPtr = Math.max(carPtr, carEnd);
    if (playing && at >= end) {
      anchorAt = end;
      playing = false;
      publish(true);
    } else publish(seeking);
  };

  usePitwall.setState({
    source: "replay",
    status: "ready",
    error: null,
    replay: { name: rec.name, start, end, at: anchorAt, playing, speed, loadProgress: null },
  });
  step(true);
  const timer = setInterval(() => step(), 100);

  const reanchor = () => {
    anchorAt = now();
    anchorPerf = performance.now();
  };

  return {
    play: () => {
      if (anchorAt >= end) anchorAt = start;
      anchorPerf = performance.now();
      playing = true;
      step(anchorAt === start);
      publish(true);
    },
    pause: () => {
      reanchor();
      playing = false;
      publish(true);
    },
    seek: (at) => {
      anchorAt = Math.min(end, Math.max(start, at));
      anchorPerf = performance.now();
      idx = -1;
      step(true);
    },
    setSpeed: (s) => {
      reanchor();
      speed = s;
      publish(true);
    },
    stop: () => clearInterval(timer),
  };
}
