// Session catalogue: the season's schedule from OpenF1 (past, live and upcoming), and
// the F1 TV content behind each session so MultiViewer can open it. OpenF1, F1 TV and
// F1's timing archive share F1's meeting/session keys (F1 TV: emfAttributes.MeetingSessionKey).

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
// F1 TV's catalogue sends no CORS headers: host permission in the extension, proxy in dev
const F1TV = import.meta.env.DEV ? "/f1tv" : "https://f1tv.formula1.com";
const SEARCH_PAGE = 5234; // F1 TV's search page id (as MultiViewer uses it)
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

interface F1TVMetadata {
  contentId: number;
  contentSubtype?: string;
  title?: string;
  emfAttributes?: { MeetingKey?: string; MeetingSessionKey?: string };
}

function collect(o: unknown, out: F1TVMetadata[]) {
  if (Array.isArray(o)) o.forEach((v) => collect(v, out));
  else if (o && typeof o === "object") {
    const m = (o as { metadata?: F1TVMetadata }).metadata;
    if (m?.contentId && m.emfAttributes) out.push(m);
    Object.values(o).forEach((v) => collect(v, out));
  }
}

const contentCache = new Map<number, string>();

/** F1 TV refused the catalogue request (its firewall rejects pages served from localhost) */
export class CatalogRefused extends Error {}

/** F1 TV content id of a session's main replay (or live) video, or null if F1 TV has none yet */
export async function findContentId(session: Session, meeting: Meeting): Promise<string | null> {
  const hit = contentCache.get(session.key);
  if (hit) return hit;
  let refused = 0;
  const terms = [meeting.country, meeting.location, meeting.name];
  for (const term of terms) {
    const res = await fetch(`${F1TV}/2.0/R/ENG/WEB_DASH/ALL/PAGE/${SEARCH_PAGE}/PREMIUM/2?search=${encodeURIComponent(term)}`);
    if (!res.ok) {
      refused++;
      continue;
    }
    const found: F1TVMetadata[] = [];
    collect(await res.json(), found);
    // The session itself, not its highlights or the pre/post shows (those use other keys)
    const match = found
      .filter((m) => m.emfAttributes?.MeetingSessionKey === String(session.key))
      .filter((m) => /^(REPLAY|LIVE)$/i.test(m.contentSubtype ?? ""))
      .sort((a, b) => Number(/LIVE/i.test(b.contentSubtype ?? "")) - Number(/LIVE/i.test(a.contentSubtype ?? "")))[0];
    if (match) {
      contentCache.set(session.key, String(match.contentId));
      return String(match.contentId);
    }
  }
  if (refused === terms.length) throw new CatalogRefused("F1 TV refused the lookup");
  return null;
}
