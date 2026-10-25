// Decides which track shape the map draws and how live positions map onto it:
//   1. the stored shape, if cars drive on it (checked against live positions),
//   2. the stored shape re-fitted (rotated/shifted) when only the coordinate frame moved,
//   3. a shape built from one live lap when the stored one doesn't match at all (or
//      there is none). 2 and 3 are cached per circuit and season.
// Live, that takes watching cars drive for a while. A replay has the whole session's
// positions up front, so it's decided from those before the first frame plays.

import { useEffect, useMemo, useState } from "react";
import { alignmentError, bakedSimilarity, fitTrack, type Pt, type Similarity } from "../circuit3d/autoAlign";
import { buildTrackGeometry, type TrackSample } from "../circuit3d/liveTrack";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { positionAt, positionHistory, trackTraces, type PositionHistory } from "../data/buffers";
import { circuitIdFor, loadCircuit, type CircuitData } from "../data/circuits";
import { trackNow, usePitwall } from "../data/store";
import { loadValue, saveValue } from "../lib/storage";

type Fix = { kind: "aligned"; sim: Similarity } | { kind: "live"; geometry: CircuitGeometry };

export interface TrackShape {
  key: string;
  circuit: CircuitData;
  geometry: CircuitGeometry | null;
  /** Live positions → geometry, when the stored transform had to be re-fitted */
  sim: Similarity | null;
  source: "stored" | "aligned" | "live";
}

export type ShapeStatus = "waiting" | "checking" | "building" | "ready";

const GOOD_M = 12; // median distance from cars to the track that counts as aligned
const MOVED_M = 8; // only sample cars that moved this far since their last sample
const CHECK_AFTER = 150; // samples before judging the stored transform
const FIT_AFTER = 600; // samples before fitting a new one

const fixKey = (key: string) => `trackfix:${key}`;

/** Every n-th of `items`, at most `max` of them, spread evenly */
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}

/**
 * Settles the shape from a replay's whole position history: moving, on-track samples
 * from across the session to check or re-fit the stored shape, and stretches of single
 * cars' running to build one from a lap. "stored" when the stored shape fits as is; null
 * when the history can't tell (no running in it).
 */
function decideFromHistory(hist: PositionHistory, geometry: CircuitGeometry | null, key: string): Fix | "stored" | null {
  const n = hist.times.length;
  if (n < 100) return null;
  const samples: Pt[] = [];
  const lastSample = new Map<string, Pt>();
  const running = new Map<string, number>(); // on-track samples per car
  const stride = Math.max(1, Math.floor(n / 3000));
  for (let i = 0; i < n; i += stride) {
    for (const [num, e] of Object.entries(hist.between(i, i + 1)[0]?.Entries ?? {})) {
      if (e.Status !== "OnTrack" || (!e.X && !e.Y)) continue;
      const pt: Pt = [e.X / 10, e.Y / 10];
      const prev = lastSample.get(num);
      if (prev && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < MOVED_M) continue;
      lastSample.set(num, pt);
      samples.push(pt);
      running.set(num, (running.get(num) ?? 0) + 1);
    }
  }
  if (samples.length < CHECK_AFTER) return null;

  if (geometry) {
    const meters = geometry.transform.scale * (geometry.transform.scaleAdjust || 1);
    const track: Pt[] = geometry.pts.map((q) => [q[0], q[1]]);
    const baked = bakedSimilarity(geometry.transform);
    if (alignmentError(baked, spread(samples, 400), track) * meters < GOOD_M) return "stored";
    const fit = fitTrack(spread(samples, 1200), track, baked);
    if (fit.error * meters < GOOD_M) return { kind: "aligned", sim: fit.sim };
  }

  // Build from a lap: the cars that ran most, a few minutes at a time from across the session
  const WINDOW = 1000; // frames, ~4 minutes at ~4 Hz: room for a full lap
  const cars = [...running.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([num]) => num);
  for (const start of [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => Math.floor(f * Math.max(0, n - WINDOW)))) {
    const frames = hist.between(start, Math.min(n, start + WINDOW));
    for (const num of cars) {
      const trace: TrackSample[] = [];
      frames.forEach((f, i) => {
        const e = f.Entries[num];
        if (e?.Status === "OnTrack" && (e.X || e.Y)) trace.push({ t: hist.times[start + i], x: e.X / 10, y: e.Y / 10, z: e.Z / 10 });
      });
      const g = buildTrackGeometry(`live:${key}`, trace);
      if (g) return { kind: "live", geometry: g };
    }
  }
  return null;
}

export function useTrackShape(): { shape: TrackShape | null; status: ShapeStatus } {
  const info = usePitwall((s) => s.live.SessionInfo);
  const circuitId = useMemo(() => circuitIdFor(info), [info]);
  const key = info ? `${circuitId ?? info.Meeting?.Circuit?.ShortName ?? info.Meeting?.Name ?? "unknown"}:${info.Path?.slice(0, 4) ?? ""}` : null;
  // undefined = still loading
  const [stored, setStored] = useState<{ circuit: CircuitData; geometry: CircuitGeometry | null } | null | undefined>(undefined);
  const [fix, setFix] = useState<Fix | null | undefined>(undefined);
  const [status, setStatus] = useState<ShapeStatus>("waiting");

  useEffect(() => {
    setStored(undefined);
    setFix(undefined);
    setStatus("waiting");
    if (!key) return;
    let alive = true;
    (circuitId ? loadCircuit(circuitId) : Promise.resolve(null)).then((r) => alive && setStored(r));
    loadValue<Fix>(fixKey(key)).then((f) => alive && setFix(f ?? null));
    return () => {
      alive = false;
    };
  }, [key, circuitId]);

  // Check the stored shape against live positions; re-fit or rebuild when it's off
  useEffect(() => {
    if (!key || stored === undefined || fix === undefined) return;
    if (fix) {
      setStatus("ready");
      return;
    }
    const geometry = stored?.geometry ?? null;
    // A replay: settle it from the whole session before anything plays
    const hist = positionHistory();
    const decided = hist ? decideFromHistory(hist, geometry, key) : null;
    if (decided === "stored") {
      setStatus("ready");
      return;
    }
    if (decided) {
      setFix(decided);
      saveValue(fixKey(key), decided);
      return;
    }
    let mode: "checking" | "building" = geometry ? "checking" : "building";
    setStatus(mode);
    const samples: Pt[] = [];
    // Parked cars (garage, pit box) would repeat the same off-track point every second
    const lastSample = new Map<string, Pt>();
    let tick = 0;
    const save = (f: Fix) => {
      setFix(f);
      saveValue(fixKey(key), f);
    };

    const id = setInterval(() => {
      tick++;
      if (mode === "checking" && geometry) {
        const { live } = usePitwall.getState();
        const at = trackNow();
        for (const num of Object.keys(live.DriverList ?? {})) {
          const p = positionAt(num, at);
          if (!p || p.status !== "OnTrack" || (!p.x && !p.y)) continue;
          const pt: Pt = [p.x / 10, p.y / 10];
          const prev = lastSample.get(num);
          if (prev && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < MOVED_M) continue;
          lastSample.set(num, pt);
          samples.push(pt);
        }
        const meters = geometry.transform.scale * (geometry.transform.scaleAdjust || 1);
        const track: Pt[] = geometry.pts.map((q) => [q[0], q[1]]);
        const baked = bakedSimilarity(geometry.transform);
        if (samples.length >= CHECK_AFTER && samples.length < FIT_AFTER) {
          if (alignmentError(baked, samples.slice(-400), track) * meters < GOOD_M) {
            setStatus("ready");
            clearInterval(id);
            return;
          }
        }
        if (samples.length >= FIT_AFTER) {
          const fit = fitTrack(samples.slice(-1200), track, baked);
          if (fit.error * meters < GOOD_M) {
            save({ kind: "aligned", sim: fit.sim });
            clearInterval(id);
            return;
          }
          // No rotation or shift fits: a different layout. Build it from a live lap.
          mode = "building";
          setStatus("building");
        }
      }
      if (mode === "building" && tick % 3 === 0) {
        // Longest traces first: they're the likeliest to hold a clean lap
        const candidates = [...trackTraces().entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
        for (const [, trace] of candidates) {
          const g = buildTrackGeometry(`live:${key}`, trace);
          if (g) {
            save({ kind: "live", geometry: g });
            clearInterval(id);
            return;
          }
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [key, stored, fix]);

  const shape = useMemo<TrackShape | null>(() => {
    if (!key || stored === undefined || fix === undefined) return null;
    if (fix?.kind === "live") {
      const name = info?.Meeting?.Circuit?.ShortName ?? info?.Meeting?.Location ?? "Track";
      const circuit: CircuitData = stored?.circuit
        ? { ...stored.circuit, corners: [] } // stored corner positions belong to the stored shape
        : { id: key, name, shortName: name, location: info?.Meeting?.Location ?? "", length: fix.geometry.len, corners: [] };
      return { key, circuit, geometry: fix.geometry, sim: null, source: "live" };
    }
    if (!stored) return null;
    return { key, circuit: stored.circuit, geometry: stored.geometry, sim: fix?.kind === "aligned" ? fix.sim : null, source: fix ? "aligned" : "stored" };
  }, [key, stored, fix, info]);

  return { shape, status };
}
