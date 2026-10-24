// Turns the raw F1 topics into the rows and lists the widgets render.

import { lapSeconds, formatLap } from "../lib/format";
import type { LiveState, RaceControlMessage, SessionInfo, Stint } from "./types";

export type SessionKind = "practice" | "qualifying" | "race";

export function sessionKind(info: SessionInfo | undefined): SessionKind {
  const type = info?.Type?.toLowerCase() ?? "";
  if (type.includes("qualifying")) return "qualifying";
  if (type.includes("race")) return "race";
  return "practice";
}

export type DriverStatus = "RUN" | "PIT" | "PIT OUT" | "OUT" | "STOPPED" | "KO";

export interface TimeCell {
  value: string;
  pb: boolean; // personal best
  ob: boolean; // overall (session) best
}

export interface SectorCell extends TimeCell {
  segments: number[];
}

export interface DriverRow {
  num: string;
  tla: string;
  name: string;
  team: string;
  color: string;
  line: number;
  position: number;
  status: DriverStatus;
  gap: string;
  interval: string;
  catching: boolean;
  lastLap: TimeCell;
  bestLap: TimeCell;
  sectors: SectorCell[];
  speedTrap: TimeCell;
  tyre: { compound: string; age: number; isNew: boolean } | null;
  stints: Stint[];
  laps: number;
  pitStops: number;
  theoretical: string; // sum of best sectors
  knockedOut: boolean;
}

export function buildRows(live: LiveState): DriverRow[] {
  const lines = live.TimingData?.Lines ?? {};
  const drivers = live.DriverList ?? {};
  const app = live.TimingAppData?.Lines ?? {};
  const stats = live.TimingStats?.Lines ?? {};
  const kind = sessionKind(live.SessionInfo);
  const part = live.TimingData?.SessionPart ?? 0;
  // F1 times a lap from one line crossing to the next, so a car that sat in the garage
  // gets a "lap" like 21:43.737. Anything over twice the session's fastest lap (five
  // minutes before there is one) is garage time, not a lap.
  const fastest = Math.min(...Object.values(lines).map((l) => lapSeconds(l.BestLapTime?.Value) ?? Infinity));
  const maxLap = Number.isFinite(fastest) ? fastest * 2 : 300;

  const rows: DriverRow[] = [];
  for (const [num, line] of Object.entries(lines)) {
    const d = drivers[num];
    if (!d) continue;
    const stint = app[num]?.Stints?.at(-1);
    const st = stats[num];
    const q = kind === "qualifying" && part > 0 ? line.Stats?.[part - 1] : undefined;
    const bestValue =
      (kind === "qualifying" && part > 0 ? line.BestLapTimes?.[part - 1]?.Value : undefined) || line.BestLapTime?.Value || "";

    const status: DriverStatus = line.Retired
      ? "OUT"
      : line.Stopped
        ? "STOPPED"
        : line.KnockedOut
          ? "KO"
          : line.InPit
            ? "PIT"
            : line.PitOut
              ? "PIT OUT"
              : "RUN";

    const bestSectors = st?.BestSectors?.map((s) => lapSeconds(s.Value)) ?? [];
    const theo =
      bestSectors.length === 3 && bestSectors.every((s) => s !== null)
        ? formatLap(bestSectors.reduce<number>((a, b) => a + (b ?? 0), 0))
        : "";

    rows.push({
      num,
      tla: d.Tla,
      name: d.BroadcastName ?? d.Tla,
      team: d.TeamName ?? "",
      color: d.TeamColour ? `#${d.TeamColour}` : "#808080",
      line: line.Line ?? d.Line ?? 99,
      position: Number(line.Position) || line.Line || 99,
      status,
      gap: kind === "race" ? line.GapToLeader ?? "" : q?.TimeDiffToFastest ?? line.TimeDiffToFastest ?? "",
      interval:
        kind === "race"
          ? line.IntervalToPositionAhead?.Value ?? ""
          : q?.TimeDiffToPositionAhead ?? line.TimeDiffToPositionAhead ?? "",
      catching: !!line.IntervalToPositionAhead?.Catching,
      lastLap: {
        value: (lapSeconds(line.LastLapTime?.Value) ?? 0) > maxLap ? "" : line.LastLapTime?.Value ?? "",
        pb: !!line.LastLapTime?.PersonalFastest,
        ob: !!line.LastLapTime?.OverallFastest,
      },
      bestLap: { value: bestValue, pb: false, ob: st?.PersonalBestLapTime?.Position === 1 },
      sectors: [0, 1, 2].map((i) => {
        const s = line.Sectors?.[i];
        return {
          value: s?.Value ?? "",
          pb: !!s?.PersonalFastest,
          ob: !!s?.OverallFastest,
          segments: s?.Segments?.map((seg) => seg.Status) ?? [],
        };
      }),
      speedTrap: {
        value: line.Speeds?.ST?.Value ?? "",
        pb: !!line.Speeds?.ST?.PersonalFastest,
        ob: !!line.Speeds?.ST?.OverallFastest,
      },
      tyre: stint
        ? { compound: stint.Compound ?? "UNKNOWN", age: stint.TotalLaps ?? 0, isNew: stint.New === "true" }
        : null,
      stints: app[num]?.Stints ?? [],
      laps: line.NumberOfLaps ?? 0,
      pitStops: line.NumberOfPitStops ?? 0,
      theoretical: theo,
      knockedOut: !!line.KnockedOut,
    });
  }
  return rows.sort((a, b) => a.line - b.line);
}

export function raceControlMessages(live: LiveState): RaceControlMessage[] {
  const m = live.RaceControlMessages?.Messages;
  const list = Array.isArray(m) ? m : m ? Object.values(m) : [];
  return [...list].reverse();
}

export interface SectorBest {
  num: string;
  value: string;
  position: number;
}

/** Top N per sector from TimingStats (the sector leaderboard) */
export function sectorLeaders(live: LiveState, top = 5): SectorBest[][] {
  const stats = live.TimingStats?.Lines ?? {};
  return [0, 1, 2].map((i) =>
    Object.entries(stats)
      .map(([num, s]) => ({ num, value: s.BestSectors?.[i]?.Value ?? "", position: s.BestSectors?.[i]?.Position ?? 0 }))
      .filter((s) => s.value && s.position > 0)
      .sort((a, b) => a.position - b.position)
      .slice(0, top)
  );
}

/** Qualifying knockout zones: [dropZoneStart, knockoutStart] positions for the current part. */
export function qualifyingZones(part: number, drivers: number): { dropZoneStart: number; knockoutStart: number } {
  // 22 cars from 2026: six out after Q1, six after Q2
  const q1Cut = drivers > 20 ? 17 : 16;
  if (part === 1) return { dropZoneStart: q1Cut, knockoutStart: drivers + 1 };
  if (part === 2) return { dropZoneStart: 11, knockoutStart: q1Cut };
  if (part === 3) return { dropZoneStart: drivers + 1, knockoutStart: 11 };
  return { dropZoneStart: drivers + 1, knockoutStart: drivers + 1 };
}
