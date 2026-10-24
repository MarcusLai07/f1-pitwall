// Pit stops, caught as they happen: entry/exit from TimingData's InPit flag, the
// official pit-lane time from PitLaneTimeCollection (each entry only lingers a few
// seconds), and the stationary time estimated from car data (speed at zero), since
// F1's own stop times aren't in the timing feed. Like lap history, it covers what
// Pit Wall has seen.

import { create } from "zustand";
import { carHistory } from "./buffers";
import type { LiveState, TimingData } from "./types";

export interface PitStop {
  lap: number; // the in-lap
  inAt: number; // track time, ms
  outAt?: number;
  laneSec?: number; // official pit-lane time
  stationarySec?: number; // estimated from car data (±0.3 s)
}

const stops = new Map<string, PitStop[]>();
const wasInPit = new Map<string, boolean>();

export const usePits = create<{ version: number }>(() => ({ version: 0 }));

export function pitStops(num: string): readonly PitStop[] {
  return stops.get(num) ?? [];
}

export function resetPits() {
  stops.clear();
  wasInPit.clear();
  usePits.setState((s) => ({ version: s.version + 1 }));
}

/** Longest stretch at zero speed between pit entry and exit, in seconds */
function stationary(num: string, from: number, to: number): number | undefined {
  const samples = carHistory(num, from, to);
  if (samples.length < 4) return undefined;
  let best = 0;
  let start: number | null = null;
  for (const s of samples) {
    if (s.speed <= 1) start ??= s.t;
    else if (start !== null) {
      // From the first zero sample to the first moving one (sample times are ms)
      best = Math.max(best, s.t - start);
      start = null;
    }
  }
  return best > 500 ? Math.round(best / 100) / 10 : undefined;
}

/** Feed one snapshot at track time `at`; returns true when anything changed */
export function feedPits(
  td: TimingData | undefined,
  pitLane: LiveState["PitLaneTimeCollection"],
  at: number,
  notify = true
): boolean {
  let changed = false;
  for (const [num, line] of Object.entries(td?.Lines ?? {})) {
    const inPit = !!line.InPit;
    const prev = wasInPit.get(num);
    wasInPit.set(num, inPit);
    if (prev === undefined) continue; // first sight: don't invent a stop already under way
    let list = stops.get(num);
    if (!prev && inPit) {
      if (!list) stops.set(num, (list = []));
      list.push({ lap: (line.NumberOfLaps ?? 0) + 1, inAt: at });
      changed = true;
    } else if (prev && !inPit && list?.length) {
      const stop = list[list.length - 1];
      if (stop.outAt === undefined) {
        stop.outAt = at;
        stop.stationarySec = stationary(num, stop.inAt - 3000, at + 1000);
        changed = true;
      }
    }
  }
  for (const [num, p] of Object.entries(pitLane?.PitTimes ?? {})) {
    const lane = Number(p.Duration);
    const list = stops.get(num);
    if (!list?.length || !Number.isFinite(lane)) continue;
    const lap = Number(p.Lap);
    const stop = list.find((s) => s.lap === lap) ?? list[list.length - 1];
    if (stop.laneSec !== lane) {
      stop.laneSec = lane;
      changed = true;
    }
  }
  if (changed && notify) usePits.setState((s) => ({ version: s.version + 1 }));
  return changed;
}

export function bumpPits() {
  usePits.setState((s) => ({ version: s.version + 1 }));
}
