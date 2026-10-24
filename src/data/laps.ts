// Per-driver lap history for the race trace and lap times, built by watching TimingData: each time a
// driver's lap count goes up we record that lap's time, gap to the leader and position.
// The feed has no lap-by-lap history, so it starts from whenever Pit Wall starts watching
// (replay rebuilds it from the start of the recording).

import { create } from "zustand";
import { lapSeconds } from "../lib/format";
import type { TimingAppData, TimingData } from "./types";

export interface LapPoint {
  lap: number;
  time: number | null; // seconds
  gap: number | null; // seconds behind the leader, null when lapped or unknown
  position: number;
  compound?: string; // tyre the lap was done on
  pit?: "in" | "out"; // pit in-lap / out-lap
}

const history = new Map<string, LapPoint[]>();
const lastLap = new Map<string, number>();

export const useLaps = create<{ version: number }>(() => ({ version: 0 }));

export function lapHistory(): ReadonlyMap<string, LapPoint[]> {
  return history;
}

export function resetLaps() {
  history.clear();
  lastLap.clear();
  useLaps.setState((s) => ({ version: s.version + 1 }));
}

function parseGap(gap: string | undefined, position: number): number | null {
  if (position === 1) return 0;
  if (!gap || /L/.test(gap)) return null; // "1L", "LAP 23"
  const n = Number(gap.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

/** Feed one TimingData snapshot (+ TimingAppData for tyres); returns true when any lap was added */
export function feedLaps(td: TimingData | undefined, app: TimingAppData | undefined, notify = true): boolean {
  let added = false;
  for (const [num, line] of Object.entries(td?.Lines ?? {})) {
    const n = line.NumberOfLaps ?? 0;
    const prev = lastLap.get(num);
    if (prev === undefined) {
      // First sight of this driver: start from here without inventing earlier laps
      lastLap.set(num, n);
      continue;
    }
    if (n <= prev) continue;
    lastLap.set(num, n);
    const position = Number(line.Position) || line.Line || 99;
    let list = history.get(num);
    if (!list) history.set(num, (list = []));
    list.push({
      lap: n,
      time: lapSeconds(line.LastLapTime?.Value),
      gap: parseGap(line.GapToLeader, position),
      position,
      compound: app?.Lines?.[num]?.Stints?.at(-1)?.Compound,
      pit: line.InPit ? "in" : line.PitOut ? "out" : undefined,
    });
    added = true;
  }
  if (added && notify) useLaps.setState((s) => ({ version: s.version + 1 }));
  return added;
}

export function bumpLaps() {
  useLaps.setState((s) => ({ version: s.version + 1 }));
}
