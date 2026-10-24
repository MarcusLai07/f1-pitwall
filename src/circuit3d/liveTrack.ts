// Builds a track shape from live car positions (one clean lap of one car), for when
// the stored geometry doesn't match what cars are actually driving (a different layout,
// like the 2026 Bahrain race) or there is no stored geometry at all.

import type { CircuitGeometry } from "../circuits/geometry-schema";

export interface TrackSample {
  t: number;
  x: number; // meters
  y: number;
  z: number;
}

const POINTS = 240;
const MIN_LAP_M = 2500; // shortest plausible F1 lap is ~3.3 km
const CLOSE_M = 20; // how near the trace must come back to where it started

/** First closed lap in a car's time-ordered trace, or null if there isn't one yet */
function findLap(trace: TrackSample[]): TrackSample[] | null {
  // Try a few start points so one noisy sample can't spoil it
  for (let i = 0; i < Math.min(trace.length, 40); i += 4) {
    let dist = 0;
    for (let j = i + 1; j < trace.length; j++) {
      const a = trace[j - 1];
      const b = trace[j];
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      if (step > 150) break; // gap in the feed (pit, garage): not a clean lap
      dist += step;
      if (dist > MIN_LAP_M && Math.hypot(b.x - trace[i].x, b.y - trace[i].y) < CLOSE_M) return trace.slice(i, j + 1);
    }
  }
  return null;
}

/** Evenly spaced points along the closed loop */
function resample(loop: TrackSample[], n: number): TrackSample[] {
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y));
  const total = cum[cum.length - 1];
  const out: TrackSample[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const a = loop[j - 1];
    const b = loop[j];
    const u = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push({ t: 0, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });
  }
  return out;
}

export function buildTrackGeometry(id: string, trace: TrackSample[]): CircuitGeometry | null {
  const lap = findLap(trace);
  if (!lap) return null;
  const raw = resample(lap, POINTS);
  // Light smoothing (closed loop) to take the jitter out of the feed
  const pts = raw.map((_, i) => {
    const w = [raw[(i - 1 + POINTS) % POINTS], raw[i], raw[(i + 1) % POINTS]];
    return { x: (w[0].x + w[1].x + w[2].x) / 3, y: (w[0].y + w[1].y + w[2].y) / 3, z: (w[0].z + w[1].z + w[2].z) / 3 };
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const zs = pts.map((p) => p.z);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const minZ = Math.min(...zs);
  const center: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const scale = Math.max(maxX - minX, maxY - minY) / 2;
  let len = 0;
  for (let i = 0; i < POINTS; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % POINTS];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return {
    id,
    pts: pts.map((p) => [(p.x - center[0]) / scale, (p.y - center[1]) / scale, p.z - minZ]),
    len: len / 1000,
    elev: Math.round(Math.max(...zs) - minZ),
    sectors: null,
    corners: [],
    overtakeZones: [],
    transform: { rotationDeg: 0, center, scale, rawBounds: [minX, maxX, minY, maxY], offset: [0, 0], scaleAdjust: 1 },
    source: "live positions",
  };
}
