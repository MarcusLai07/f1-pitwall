// Fits live car positions onto the track shape. The baked GPS transform comes from
// FastF1 laps of an earlier season, and F1 sometimes changes a circuit's coordinate
// frame (2026 Bahrain is turned ~90°), so the map checks the baked transform against
// where cars actually drive and, if it's off, fits a new transform (rotation, shift,
// optional mirror) with trimmed ICP. Scale stays at the baked one: both sides are in
// meters, and letting ICP scale freely lets it shrink the cars onto part of the track.

import type { GpsTransform } from "../circuits/geometry-schema";

/** x' = a·x − b·y + tx, y' = b·x + a·y + ty, applied after mirroring y when `mirror` */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
  mirror: boolean;
}

export type Pt = [number, number];

export function applySim(s: Similarity, x: number, y: number): Pt {
  const yy = s.mirror ? -y : y;
  return [s.a * x - s.b * yy + s.tx, s.b * x + s.a * yy + s.ty];
}

/** The baked transform (input in meters) in Similarity form */
export function bakedSimilarity(t: GpsTransform): Similarity {
  const r = (t.rotationDeg * Math.PI) / 180;
  const k = 1 / (t.scale * (t.scaleAdjust || 1));
  const [ox, oy] = t.offset ?? [0, 0];
  return { a: Math.cos(r) * k, b: Math.sin(r) * k, tx: -t.center[0] * k + ox, ty: -t.center[1] * k + oy, mirror: false };
}

/** Closest point on the closed polyline and the distance to it */
function closest(track: Pt[], x: number, y: number): { px: number; py: number; d: number } {
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < track.length; i++) {
    const [x1, y1] = track[i];
    const [x2, y2] = track[(i + 1) % track.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    let u = len ? ((x - x1) * dx + (y - y1) * dy) / len : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = x1 + u * dx;
    const py = y1 + u * dy;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) {
      best = d;
      bx = px;
      by = py;
    }
  }
  return { px: bx, py: by, d: Math.sqrt(best) };
}

const median = (v: number[]) => {
  const s = [...v].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : Infinity;
};

/** Median distance (normalized units) from the mapped samples to the track */
export function alignmentError(sim: Similarity, samples: Pt[], track: Pt[]): number {
  return median(samples.map(([x, y]) => closest(track, ...applySim(sim, x, y)).d));
}

/** Best rotation + shift (at a fixed scale) mapping source points onto matched targets */
function procrustes(src: Pt[], dst: Pt[], mirror: boolean, scale: number): Similarity {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0];
    sy += mirror ? -src[i][1] : src[i][1];
    dx += dst[i][0];
    dy += dst[i][1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - sx;
    const ay = (mirror ? -src[i][1] : src[i][1]) - sy;
    const bx = dst[i][0] - dx;
    const by = dst[i][1] - dy;
    sxx += ax * bx + ay * by;
    sxy += ax * by - ay * bx;
  }
  const norm = Math.hypot(sxx, sxy) || 1;
  const a = (sxx / norm) * scale;
  const b = (sxy / norm) * scale;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy), mirror };
}

/** Trimmed ICP from a starting guess; returns the refined transform and its error */
function icp(start: Similarity, samples: Pt[], track: Pt[], iterations: number): { sim: Similarity; error: number } {
  let sim = start;
  const scale = Math.hypot(start.a, start.b);
  for (let it = 0; it < iterations; it++) {
    const pairs = samples.map(([x, y]) => {
      const c = closest(track, ...applySim(sim, x, y));
      return { src: [x, y] as Pt, dst: [c.px, c.py] as Pt, d: c.d };
    });
    const med = median(pairs.map((p) => p.d));
    // Keep the closest ~60%: pit lane, run-offs and stray samples drop out
    const keep = pairs.filter((p) => p.d <= Math.max(med * 1.5, 1e-6));
    if (keep.length < 20) break;
    const next = procrustes(keep.map((p) => p.src), keep.map((p) => p.dst), sim.mirror, scale);
    const moved = Math.abs(next.a - sim.a) + Math.abs(next.b - sim.b) + Math.abs(next.tx - sim.tx) + Math.abs(next.ty - sim.ty);
    sim = next;
    if (moved < 1e-6) break;
  }
  return { sim, error: alignmentError(sim, samples, track) };
}

function bbox(pts: Pt[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, diag: Math.hypot(x1 - x0, y1 - y0) };
}

/**
 * Fit samples (meters) onto the track (normalized). Tries the baked transform plus
 * every quarter turn, mirrored and not, keeps the best. Error is in normalized units.
 */
export function fitTrack(samples: Pt[], track: Pt[], baked: Similarity): { sim: Similarity; error: number } {
  // A few hundred spread-out samples are plenty for choosing between candidates
  const step = Math.max(1, Math.floor(samples.length / 400));
  const coarse = samples.filter((_, i) => i % step === 0);
  const sb = bbox(samples);
  const tb = bbox(track);
  const k = Math.hypot(baked.a, baked.b);

  const starts: Similarity[] = [baked];
  for (const mirror of [false, true]) {
    for (let q = 0; q < 4; q++) {
      const r = (q * Math.PI) / 2;
      const a = Math.cos(r) * k;
      const b = Math.sin(r) * k;
      const cy = mirror ? -sb.cy : sb.cy;
      starts.push({ a, b, tx: tb.cx - (a * sb.cx - b * cy), ty: tb.cy - (b * sb.cx + a * cy), mirror });
    }
  }
  let best = { sim: baked, error: Infinity };
  for (const s of starts) {
    const r = icp(s, coarse, track, 25);
    if (r.error < best.error) best = r;
  }
  // Polish the winner on every sample
  return icp(best.sim, samples, track, 15);
}
