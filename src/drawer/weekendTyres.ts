// Weekend-wide tyre usage. F1's live feed only reports the current session's sets, but the
// earlier sessions (practice, qualifying, sprint) sit in the static archive — which the live
// 403 doesn't touch. We sum the new sets each driver fitted across every completed session
// plus the live one, so the brief can show how much of their dry allocation is left.

import { useEffect, useMemo, useState } from "react";
import { archiveYear, loadSessionStints, type ArchiveIndex } from "../data/archive";
import { usePitwall } from "../data/store";
import type { SessionInfo, Stint } from "../data/types";

export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type CompoundCount = Partial<Record<Compound, number>>;

export interface WeekendTyre {
  code: string;
  color: string;
  used: CompoundCount; // new sets fitted so far this weekend
}

export interface WeekendTyres {
  rows: WeekendTyre[];
  /** archived sessions were read, so `used` spans the weekend (not just the live session) */
  weekend: boolean;
  /** completed sessions F1's archive wouldn't hand over (so usage may be undercounted) */
  skipped: number;
}

function addNewSets(stints: Stint[] | undefined, into: CompoundCount) {
  for (const st of stints ?? []) {
    if (st.New === "true" && st.Compound) {
      const c = st.Compound as Compound;
      into[c] = (into[c] ?? 0) + 1;
    }
  }
}

function yearOf(info: SessionInfo | undefined): number | null {
  const y = Number(info?.Path?.slice(0, 4)) || new Date(info?.StartDate ?? NaN).getFullYear();
  return Number.isFinite(y) && y > 2000 ? y : null;
}

/** The archive meeting that holds the live session: matched by the session Path's meeting
 *  folder (reliable), else by location. */
function findMeeting(index: ArchiveIndex | null, info: SessionInfo) {
  if (!index) return undefined;
  const prefix = info.Path?.split("/").slice(0, 2).join("/"); // "2026/2026-..._Grand_Prix"
  const loc = info.Meeting?.Location?.toLowerCase();
  return (
    (prefix ? index.Meetings.find((m) => m.Sessions.some((s) => s.Path?.startsWith(prefix))) : undefined) ??
    (loc ? index.Meetings.find((m) => m.Location?.toLowerCase() === loc) : undefined)
  );
}

interface Archived {
  counts: Record<string, CompoundCount>; // racing number -> new sets per compound
  skipped: number;
  ok: boolean;
}

/** Sums new sets per driver across the meeting's completed sessions, skipping the live one
 *  (counted from live state) and any session the archive refuses. */
async function fetchArchived(year: number, info: SessionInfo): Promise<Archived> {
  const index = await archiveYear(year).catch(() => null);
  const meeting = findMeeting(index, info);
  if (!meeting) return { counts: {}, skipped: 0, ok: false };
  const counts: Record<string, CompoundCount> = {};
  let skipped = 0;
  for (const s of meeting.Sessions) {
    if (!s.Path || s.Key === info.Key) continue;
    try {
      const stints = await loadSessionStints(s.Path);
      for (const [num, sts] of Object.entries(stints)) addNewSets(sts, (counts[num] ??= {}));
    } catch {
      skipped++; // 401/403/404 for this one — carry on with the rest
    }
  }
  return { counts, skipped, ok: true };
}

const cache = new Map<string, Promise<Archived>>();
function archivedFor(year: number, info: SessionInfo): Promise<Archived> {
  const key = `${year}:${info.Path ?? info.Key ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchArchived(year, info).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return p;
}

export function useWeekendTyres(): WeekendTyres | null {
  const info = usePitwall((s) => s.live.SessionInfo);
  const source = usePitwall((s) => s.source);
  const drivers = usePitwall((s) => s.live.DriverList);
  const liveApp = usePitwall((s) => s.live.TimingAppData);
  const [archived, setArchived] = useState<Archived | null>(null);

  const live = source === "live" || source === "replay";
  const path = info?.Path;
  const year = yearOf(info);

  useEffect(() => {
    setArchived(null);
    if (!live || !info || !year) return;
    let alive = true;
    archivedFor(year, info)
      .then((a) => alive && setArchived(a))
      .catch(() => alive && setArchived({ counts: {}, skipped: 0, ok: false }));
    return () => {
      alive = false;
    };
  }, [live, path, year]);

  return useMemo(() => {
    if (!live || !drivers) return null;
    const counts: Record<string, CompoundCount> = {};
    for (const [num, cc] of Object.entries(archived?.counts ?? {})) counts[num] = { ...cc };
    for (const [num, line] of Object.entries(liveApp?.Lines ?? {})) addNewSets(line.Stints, (counts[num] ??= {}));

    const rows: WeekendTyre[] = [];
    for (const num of Object.keys(counts).sort((a, b) => Number(a) - Number(b))) {
      const d = drivers[num];
      const cc = counts[num];
      if (!d || !Object.keys(cc).length) continue;
      rows.push({ code: d.Tla, color: d.TeamColour ? `#${d.TeamColour}` : "#808080", used: cc });
    }
    const weekend = !!archived?.ok && Object.keys(archived.counts).length > 0;
    return rows.length ? { rows, weekend, skipped: archived?.skipped ?? 0 } : null;
  }, [archived, liveApp, drivers, live]);
}
