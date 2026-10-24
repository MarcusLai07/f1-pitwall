// Session catalogue: the season's schedule from OpenF1 (past, live and upcoming), or
// F1's archive index while OpenF1 is closed. Both use F1's meeting/session keys.

import { ArchiveAuthError, archiveYear, type ArchiveIndex } from "../data/archive";
import { parseGmtOffset, parseUtc } from "../lib/format";
import { loadValue, saveValue } from "../lib/storage";
import { f1Token } from "./f1account";

export interface Session {
  key: number;
  meetingKey: number;
  name: string; // "Practice 3", "Sprint Qualifying", "Race"
  type: string; // "Practice" | "Qualifying" | "Race"
  start: number; // epoch ms
  end: number;
  path?: string; // folder in F1's timing archive, when the schedule came from there
}

export interface Meeting {
  key: number;
  name: string;
  country: string;
  location: string;
  circuit: string;
  flag?: string;
  start: number;
  end: number;
  cancelled: boolean;
  sessions: Session[];
}

export type SessionState = "upcoming" | "live" | "past";

const OPENF1 = "https://api.openf1.org/v1";
// Sessions often run past their scheduled end (red flags, delays)
const LIVE_GRACE_MS = 45 * 60_000;

export function sessionState(s: Session, now = Date.now()): SessionState {
  if (now < s.start) return "upcoming";
  if (now <= s.end + LIVE_GRACE_MS) return "live";
  return "past";
}

interface OpenF1Meeting {
  meeting_key: number;
  meeting_name: string;
  country_name: string;
  location: string;
  circuit_short_name: string;
  country_flag?: string;
  date_start: string;
  date_end: string;
  is_cancelled?: boolean;
}
interface OpenF1Session {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
}

/** Where a schedule came from: OpenF1, the copy saved last time, or F1's archive (past sessions only) */
export type ScheduleSource = "openf1" | "saved" | "archive";

function fromArchive(index: ArchiveIndex): Meeting[] {
  return index.Meetings.filter((m) => !/testing/i.test(m.Name))
    .map((m) => {
      const sessions = m.Sessions.filter((s) => s.Key > 0)
        .map((s) => {
          const offset = parseGmtOffset(s.GmtOffset);
          return { key: s.Key, meetingKey: m.Key, name: s.Name, type: s.Type, start: parseUtc(s.StartDate) - offset, end: parseUtc(s.EndDate) - offset, path: s.Path };
        })
        .sort((a, b) => a.start - b.start);
      return {
        key: m.Key,
        name: m.Name,
        country: m.Country?.Name ?? "",
        location: m.Location,
        circuit: m.Circuit?.ShortName ?? m.Location,
        start: sessions[0]?.start ?? 0,
        end: sessions.at(-1)?.end ?? 0,
        cancelled: false,
        sessions,
      };
    })
    .filter((m) => m.sessions.length)
    .sort((a, b) => a.start - b.start);
}

/**
 * The season's meetings with their sessions. OpenF1 refuses free requests (even for
 * past seasons) while a session is live; then the last good copy is used, or F1's
 * own archive index when signed in to F1 TV.
 */
export async function loadSeason(year: number): Promise<{ meetings: Meeting[]; source: ScheduleSource }> {
  const key = `season:${year}`;
  try {
    let mr: Response, sr: Response;
    try {
      [mr, sr] = await Promise.all([fetch(`${OPENF1}/meetings?year=${year}`), fetch(`${OPENF1}/sessions?year=${year}`)]);
    } catch {
      // Its refusals carry no CORS headers, so a page only sees a network error
      throw new Error("OpenF1 didn't answer. It's closed to free users while a session is live");
    }
    if (!mr.ok || !sr.ok) {
      const bad = mr.ok ? sr : mr;
      const detail = String(((await bad.json().catch(() => null)) as { detail?: unknown } | null)?.detail ?? "");
      throw new Error(/live/i.test(detail) ? "OpenF1 is closed to free users while a session is live" : `OpenF1 answered ${bad.status}`);
    }
    const [ms, ss] = (await Promise.all([mr.json(), sr.json()])) as [OpenF1Meeting[], OpenF1Session[]];
    const meetings: Meeting[] = ms
      .filter((m) => !/testing/i.test(m.meeting_name))
      .map((m) => ({
        key: m.meeting_key,
        name: m.meeting_name,
        country: m.country_name,
        location: m.location,
        circuit: m.circuit_short_name,
        flag: m.country_flag,
        start: Date.parse(m.date_start),
        end: Date.parse(m.date_end),
        cancelled: !!m.is_cancelled,
        sessions: ss
          .filter((s) => s.meeting_key === m.meeting_key)
          .map((s) => ({
            key: s.session_key,
            meetingKey: s.meeting_key,
            name: s.session_name,
            type: s.session_type,
            start: Date.parse(s.date_start),
            end: Date.parse(s.date_end),
          }))
          .sort((a, b) => a.start - b.start),
      }))
      .sort((a, b) => a.start - b.start);
    saveValue(key, meetings);
    return { meetings, source: "openf1" };
  } catch (err) {
    const cached = await loadValue<Meeting[]>(key);
    if (cached?.length) return { meetings: cached, source: "saved" };
    if (f1Token()) {
      let refused = false;
      const index = await archiveYear(year).catch((e) => {
        refused = e instanceof ArchiveAuthError;
        return null;
      });
      if (index?.Meetings?.length) return { meetings: fromArchive(index), source: "archive" };
      if (refused) throw new Error(`${err instanceof Error ? err.message : err}, and F1's archive refused your F1 TV sign-in`);
    }
    throw err;
  }
}
