// Replay source: plays back a recording made by scripts/record.mjs (one MultiViewer
// state per line, gzip NDJSON) through the same store and buffers as live mode.

import { parseUtc } from "../lib/format";
import { ingestCarData, ingestPositions, resetBuffers } from "./buffers";
import { apply, diff } from "./diff";
import { replaceTopics, setWallNow, trackNow, usePitwall } from "./store";
import type { CarDataFrame, LiveClock, LiveState, PositionFrame } from "./types";

interface RecordedLine {
  t: number;
  f1LiveTimingState: LiveState | null;
  f1LiveTimingClock: { paused: boolean; systemTime: string; trackTime: string } | null;
}

interface Frame {
  t: number;
  clock: LiveClock | null;
  state: LiveState;
}

export interface Recording {
  name: string;
  frames: Frame[];
  positions: PositionFrame[];
  positionTimes: number[];
  carData: CarDataFrame[];
  carTimes: number[];
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

  const rec: Recording = { name, frames: [], positions: [], positionTimes: [], carData: [], carTimes: [] };
  let prevRaw: LiveState | undefined;
  let state: LiveState = {};

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const obj = JSON.parse(line) as RecordedLine;
    const raw = obj.f1LiveTimingState;
    if (!raw) return;
    for (const f of raw.Position?.Position ?? []) {
      const t = parseUtc(f.Timestamp);
      if (t > (rec.positionTimes.at(-1) ?? -Infinity)) {
        rec.positions.push(f);
        rec.positionTimes.push(t);
      }
    }
    for (const f of raw.CarData?.Entries ?? []) {
      const t = parseUtc(f.Utc);
      if (t > (rec.carTimes.at(-1) ?? -Infinity)) {
        rec.carData.push(f);
        rec.carTimes.push(t);
      }
    }
    delete raw.Position;
    delete raw.CarData;
    state = apply(state, diff(prevRaw, raw));
    prevRaw = raw;
    const c = obj.f1LiveTimingClock;
    rec.frames.push({
      t: obj.t,
      clock: c ? { paused: c.paused, systemTime: Number(c.systemTime), trackTime: Number(c.trackTime) } : null,
      state,
    });
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
  if (!rec.frames.length) throw new Error("No frames in recording");
  return rec;
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

// How far ahead of the track clock MultiViewer's state usually runs; the map
// interpolates inside this window.
const LOOKAHEAD_MS = 1500;

export function startReplay(rec: Recording): ReplayControls {
  const { frames } = rec;
  const frameTimes = frames.map((f) => f.t);
  const start = frames[0].t;
  const end = frames[frames.length - 1].t;
  let anchorAt = start;
  let anchorPerf = performance.now();
  let playing = false;
  let speed = 1;
  let idx = -1;
  let posPtr = 0;
  let carPtr = 0;
  let lastPublish = 0;

  const now = () => (playing ? Math.min(end, anchorAt + (performance.now() - anchorPerf) * speed) : anchorAt);
  setWallNow(now);
  resetBuffers();

  const publish = (force = false) => {
    const t = performance.now();
    if (!force && t - lastPublish < 250) return;
    lastPublish = t;
    usePitwall.setState((s) => ({ replay: s.replay && { ...s.replay, at: now(), playing, speed } }));
  };

  const step = (seeking = false) => {
    const at = now();
    let i = idx;
    if (i < 0 || frames[i].t > at) i = Math.max(0, lowerBound(frameTimes, at + 1) - 1);
    while (i + 1 < frames.length && frames[i + 1].t <= at) i++;
    if (i !== idx) {
      idx = i;
      replaceTopics(frames[i].state, frames[i].clock);
    }
    const tn = trackNow();
    if (seeking) {
      resetBuffers();
      posPtr = lowerBound(rec.positionTimes, tn - 15_000);
      carPtr = lowerBound(rec.carTimes, tn - 60_000);
    }
    const posEnd = lowerBound(rec.positionTimes, tn + LOOKAHEAD_MS);
    if (posEnd > posPtr) ingestPositions(rec.positions.slice(posPtr, posEnd));
    posPtr = Math.max(posPtr, posEnd);
    const carEnd = lowerBound(rec.carTimes, tn + LOOKAHEAD_MS);
    if (carEnd > carPtr) ingestCarData(rec.carData.slice(carPtr, carEnd));
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
    replay: { name: rec.name, start, end, at: start, playing, speed, loadProgress: null },
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
