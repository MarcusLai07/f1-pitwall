// Decides which track shape the map draws and how live positions map onto it:
//   1. the stored shape, if cars drive on it (checked against live positions),
//   2. the stored shape re-fitted (rotated/shifted) when only the coordinate frame moved,
//   3. a shape built from one live lap when the stored one doesn't match at all (or
//      there is none). 2 and 3 are cached per circuit and season.

import { useEffect, useMemo, useState } from "react";
import { alignmentError, bakedSimilarity, fitTrack, type Pt, type Similarity } from "../circuit3d/autoAlign";
import { buildTrackGeometry } from "../circuit3d/liveTrack";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { positionAt, trackTraces } from "../data/buffers";
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
