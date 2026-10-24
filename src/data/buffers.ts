// Per-car sample buffers for the high-rate topics (Position ~4 Hz, CarData ~4 Hz).
// Kept outside React: the map reads them every animation frame and the telemetry
// widgets on a ticker, interpolating at the current track time.

import { parseUtc } from "../lib/format";
import type { CarDataFrame, PositionFrame } from "./types";

export interface PosSample {
  t: number;
  x: number;
  y: number;
  status?: string;
}

export interface CarSample {
  t: number;
  rpm: number;
  speed: number;
  gear: number;
  throttle: number;
  brake: number;
}

const POS_KEEP_MS = 20_000;
const CAR_KEEP_MS = 90_000;

const positions = new Map<string, PosSample[]>();
const cars = new Map<string, CarSample[]>();
let lastPosT = -Infinity;
let lastCarT = -Infinity;

export function resetBuffers() {
  positions.clear();
  cars.clear();
  lastPosT = -Infinity;
  lastCarT = -Infinity;
}

export function ingestPositions(frames: PositionFrame[] | undefined) {
  if (!frames) return;
  for (const frame of frames) {
    const t = parseUtc(frame.Timestamp);
    if (!(t > lastPosT)) continue;
    lastPosT = t;
    for (const [num, e] of Object.entries(frame.Entries)) {
      let list = positions.get(num);
      if (!list) positions.set(num, (list = []));
      list.push({ t, x: e.X, y: e.Y, status: e.Status });
    }
  }
  trim(positions, lastPosT - POS_KEEP_MS);
}

export function ingestCarData(frames: CarDataFrame[] | undefined) {
  if (!frames) return;
  for (const frame of frames) {
    const t = parseUtc(frame.Utc);
    if (!(t > lastCarT)) continue;
    lastCarT = t;
    for (const [num, c] of Object.entries(frame.Cars)) {
      const ch = c.Channels;
      let list = cars.get(num);
      if (!list) cars.set(num, (list = []));
      list.push({
        t,
        rpm: ch["0"] ?? 0,
        speed: ch["2"] ?? 0,
        gear: ch["3"] ?? 0,
        throttle: Math.min(100, ch["4"] ?? 0),
        brake: ch["5"] ? 100 : 0, // brake is on/off in the feed (0 or 100)
      });
    }
  }
  trim(cars, lastCarT - CAR_KEEP_MS);
}

function trim<T extends { t: number }>(map: Map<string, T[]>, before: number) {
  for (const list of map.values()) {
    let i = 0;
    while (i < list.length - 1 && list[i].t < before) i++;
    if (i > 0) list.splice(0, i);
  }
}

/** Index of the last sample with t <= at, or -1 */
function lastAtOrBefore<T extends { t: number }>(list: T[], at: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= at) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Interpolated position at track time `at`; holds the nearest sample at the edges. */
export function positionAt(num: string, at: number): PosSample | null {
  const list = positions.get(num);
  if (!list?.length) return null;
  const i = lastAtOrBefore(list, at);
  if (i < 0) return list[0];
  if (i >= list.length - 1) return list[list.length - 1];
  const a = list[i];
  const b = list[i + 1];
  // Don't glide across a gap (e.g. car off the feed): snap instead
  if (b.t - a.t > 3000) return a;
  const k = (at - a.t) / (b.t - a.t);
  return { t: at, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, status: a.status };
}

export function carAt(num: string, at: number): CarSample | null {
  const list = cars.get(num);
  if (!list?.length) return null;
  const i = lastAtOrBefore(list, at);
  return i < 0 ? null : list[i];
}

export function carHistory(num: string, from: number, to: number): CarSample[] {
  const list = cars.get(num);
  if (!list?.length) return [];
  const end = lastAtOrBefore(list, to);
  if (end < 0) return [];
  let start = end;
  while (start > 0 && list[start - 1].t >= from) start--;
  return list.slice(start, end + 1);
}

export function positionNumbers(): string[] {
  return [...positions.keys()];
}
