// The season schedule shared by the header (next session and its countdown) and the
// calendar: loaded once per season and refreshed every half hour.

import { useEffect } from "react";
import { create } from "zustand";
import { useTicker } from "../ui/hooks";
import { loadSeason, sessionState, type Meeting, type ScheduleSource, type Session } from "./catalog";

export interface Season {
  meetings: Meeting[];
  source: ScheduleSource;
}

type Entry = Season | "loading" | { error: string };

export const useSchedule = create<{ seasons: Record<number, Entry> }>(() => ({ seasons: {} }));

const REFRESH_MS = 30 * 60_000;
const loadedAt = new Map<number, number>();

export const isSeason = (e: Entry | undefined): e is Season => !!e && typeof e === "object" && "meetings" in e;

const put = (year: number, entry: Entry) => useSchedule.setState((s) => ({ seasons: { ...s.seasons, [year]: entry } }));

/** Loads a season unless it's loaded and fresh (or loading) */
export function ensureSeason(year: number) {
  const cur = useSchedule.getState().seasons[year];
  if (cur === "loading" || (isSeason(cur) && Date.now() - (loadedAt.get(year) ?? 0) < REFRESH_MS)) return;
  if (!isSeason(cur)) put(year, "loading");
  loadSeason(year)
    .then((season) => {
      loadedAt.set(year, Date.now());
      put(year, season);
    })
    .catch((err) => {
      // A failed refresh keeps the schedule it had
      if (!isSeason(useSchedule.getState().seasons[year])) put(year, { error: err instanceof Error ? err.message : String(err) });
    });
}

export interface NextUp {
  meeting: Meeting;
  session: Session;
  /** Running now by the schedule */
  live: boolean;
}

/** The session running now by the schedule, or else the next one to start */
export function nextSession(meetings: Meeting[], now = Date.now()): NextUp | null {
  for (const meeting of meetings) {
    if (meeting.cancelled) continue;
    for (const session of meeting.sessions) {
      const state = sessionState(session, now);
      if (state !== "past") return { meeting, session, live: state === "live" };
    }
  }
  return null;
}

/** The next session on the calendar, this season or (at its end) the next one */
export function useNextSession(): NextUp | null {
  useTicker(1 / 15);
  const year = new Date().getFullYear();
  const seasons = useSchedule((s) => s.seasons);
  const now = Date.now();
  const thisYear = seasons[year];
  const next = isSeason(thisYear) ? nextSession(thisYear.meetings, now) : null;
  const overflow = isSeason(thisYear) && !next;
  useEffect(() => {
    ensureSeason(year);
    const id = setInterval(() => ensureSeason(year), REFRESH_MS);
    return () => clearInterval(id);
  }, [year]);
  useEffect(() => {
    if (overflow) ensureSeason(year + 1);
  }, [overflow, year]);
  if (next) return next;
  const nextYear = seasons[year + 1];
  return isSeason(nextYear) ? nextSession(nextYear.meetings, now) : null;
}

/** "Practice 1" → "FP1", "Sprint Qualifying" → "Sprint Quali"; Race, Sprint, Qualifying as they are */
export function shortSessionName(name: string): string {
  const fp = /^Practice (\d)$/.exec(name);
  if (fp) return `FP${fp[1]}`;
  return name.replace("Qualifying", "Quali").replace(/^Sprint Shootout$/, "Sprint Quali");
}
