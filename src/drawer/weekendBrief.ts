// "This weekend" data for the Race Brief and the timing tower: Pirelli's prescriptions
// (compounds, pressures, stint limit), the event's rules, grid drops and the stewards'
// decisions. scripts/update-weekend.mjs builds it from the FIA's event documents and a
// GitHub Action publishes it on the `weekend-data` branch every 15 min over a race
// weekend; Pit Wall fetches it from there (no release needed when it changes).

import { useMemo, useSyncExternalStore } from "react";
import { usePitwall } from "../data/store";
import { useNomination } from "./raceWeather";

const REMOTE = "https://raw.githubusercontent.com/MarcusLai07/f1-pitwall/weekend-data/weekend.json";
// `node scripts/update-weekend.mjs` writes data/weekend.json; the dev server serves it
const LOCAL = "/data/weekend.json";
const REFRESH_MS = 10 * 60_000;

export interface DocRef {
  num: number | null;
  title: string;
  url: string;
  published: string | null;
}

export interface TyreRules {
  hard: string;
  medium: string;
  soft: string;
  mandatory?: string[];
  q3?: string;
  pressures?: { front: number; rear: number };
  stintCap?: number;
  stintCapSource?: "pirelli" | "manual";
  doc: DocRef;
}

export type StewardKind = "grid" | "penalty" | "fine" | "reprimand" | "warning" | "cleared" | "info" | "laps-deleted";

export interface GridPenalty {
  kind: "places" | "back" | "pitlane";
  places?: number;
}

export interface StewardEntry extends DocRef {
  cars: string[];
  car?: string;
  driver?: string;
  code?: string;
  team?: string;
  session?: string;
  fact?: string;
  decision?: string;
  kind: StewardKind;
  label: string;
  grid?: GridPenalty;
}

export interface GridDrop extends GridPenalty {
  car?: string;
  driver?: string;
  code?: string;
  team?: string;
  fact?: string;
  decision?: string;
  num: number | null;
  url: string;
  /** set when the penalty was handed down at the previous event */
  fromEvent?: string;
}

export interface RuleNote {
  tag: string;
  title: string;
  body: string;
  doc?: number;
}

export interface WeekendEvent {
  name: string;
  docsUrl: string;
  tyres?: TyreRules;
  notes?: { doc: DocRef; sections: string[] };
  puReport?: DocRef;
  stewards: StewardEntry[];
  pending: (DocRef & { cars: string[] })[];
  grid: GridDrop[];
  nextRaceGrid: GridDrop[];
  rules?: RuleNote[];
  documents: DocRef[];
  firstDocAt?: string;
  lastDocAt?: string;
}

export interface WeekendData {
  generatedAt?: string;
  season: number;
  events: WeekendEvent[];
}

// ---- A tiny shared store: one fetch, refreshed while anything is watching ---------------

let data: WeekendData | null = null;
let loaded = false;
let watchers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

async function fetchJson(url: string): Promise<WeekendData | null> {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) return null;
  const d = (await r.json()) as WeekendData;
  return Array.isArray(d?.events) ? d : null;
}

async function refresh() {
  let next: WeekendData | null = null;
  if (import.meta.env.DEV) next = await fetchJson(LOCAL).catch(() => null);
  next ??= await fetchJson(REMOTE).catch(() => null);
  // Keep what we have if a refresh fails; only replace it with real data
  if (next || !loaded) {
    data = next ?? data;
    loaded = true;
    listeners.forEach((l) => l());
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (watchers++ === 0) {
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  }
  return () => {
    listeners.delete(l);
    if (--watchers === 0) clearInterval(timer);
  };
}

export function useWeekendData(): { data: WeekendData | null; loaded: boolean } {
  const d = useSyncExternalStore(subscribe, () => data);
  const l = useSyncExternalStore(subscribe, () => loaded);
  return { data: d, loaded: l };
}

// ---- Matching an FIA event to a meeting ------------------------------------------------

const norm = (s: string | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export interface MeetingRef {
  season: number;
  name?: string;
  location?: string;
  circuit?: string;
  /** race start, ms: bounds how far back a previous event's penalties carry */
  raceStart?: number;
}

/** The FIA names some events differently ("São Paulo Grand Prix" for the Brazilian GP),
 *  so a match on the meeting's own name or its location in the FIA name will do. */
function sameEvent(fiaName: string, m: MeetingRef) {
  const f = norm(fiaName);
  return f === norm(m.name) || (!!m.location && f.includes(norm(m.location))) || (!!m.circuit && f.includes(norm(m.circuit)));
}

export interface EventMatch {
  event?: WeekendEvent;
  /** the event before it, whose race-day penalties apply here */
  previous?: WeekendEvent;
  /** grid drops for this meeting's race: its own, plus any carried from the previous event */
  grid: GridDrop[];
  updatedAt?: string;
}

export function matchEvent(d: WeekendData | null, m: MeetingRef | null): EventMatch {
  if (!d || !m || d.season !== m.season) return { grid: [] };
  const i = d.events.findIndex((e) => sameEvent(e.name, m));
  let event: WeekendEvent | undefined;
  let previous: WeekendEvent | undefined;
  if (i >= 0) {
    event = d.events[i];
    previous = d.events[i + 1];
  } else {
    // This meeting's documents aren't out yet: the latest event is the one before it,
    // as long as it really was recent (not last season's finale)
    const last = d.events[0];
    const lastAt = last?.lastDocAt ? Date.parse(last.lastDocAt) : NaN;
    if (last && (!m.raceStart || (lastAt < m.raceStart && m.raceStart - lastAt < 21 * 86_400_000))) previous = last;
  }
  const carried = (previous?.nextRaceGrid ?? []).map((g) => ({ ...g, fromEvent: previous!.name }));
  return { event, previous, grid: [...(event?.grid ?? []), ...carried], updatedAt: d.generatedAt };
}

export function useWeekendEvent(m: MeetingRef | null): EventMatch & { loaded: boolean } {
  const { data: d, loaded } = useWeekendData();
  const key = m ? `${m.season}|${m.name}|${m.location}|${m.circuit}|${m.raceStart}` : "";
  const match = useMemo(() => matchEvent(d, m), [d, key]);
  return { ...match, loaded };
}

// ---- Compounds -------------------------------------------------------------------------

export interface Compounds {
  hard: string;
  medium: string;
  soft: string;
  /** where they came from: the FIA's copy of Pirelli's prescriptions, or the hand-kept list */
  source: "fia" | "list";
}

/** The weekend's C-numbers: the FIA document when it's out, else data/nominations.json
 *  (which Pirelli's earlier announcements go into) */
export function useCompounds(m: MeetingRef | null, event: WeekendEvent | undefined): Compounds | null {
  const nom = useNomination(m?.season, m?.location || m?.circuit);
  if (event?.tyres) return { hard: event.tyres.hard, medium: event.tyres.medium, soft: event.tyres.soft, source: "fia" };
  return nom ? { ...nom, source: "list" } : null;
}

/** C-number for a live compound name ("MEDIUM" → "C2"); wets and inters have none */
export function cNumber(c: Compounds | null, compound: string): string | undefined {
  if (!c) return undefined;
  return compound === "SOFT" ? c.soft : compound === "MEDIUM" ? c.medium : compound === "HARD" ? c.hard : undefined;
}

// ---- The live session's tyre rules (timing tower) ---------------------------------------

export interface LiveTyreRules {
  compounds: Compounds | null;
  stintCap?: number;
}

/** Compounds and stint limit for the session being watched, when it's from the weekend the
 *  data covers (a replay of last year's race at the same circuit gets neither cap nor
 *  this year's compounds). */
export function useLiveTyreRules(): LiveTyreRules {
  const info = usePitwall((s) => s.live.SessionInfo);
  const season = Number(info?.Path?.slice(0, 4)) || new Date(info?.StartDate ?? NaN).getFullYear() || 0;
  const ref = useMemo<MeetingRef | null>(
    () => (info?.Meeting ? { season, name: info.Meeting.Name, location: info.Meeting.Location, circuit: info.Meeting.Circuit?.ShortName } : null),
    [season, info?.Meeting?.Name, info?.Meeting?.Location]
  );
  const { event } = useWeekendEvent(ref);
  const compounds = useCompounds(ref, event);
  const stintCap = event?.tyres?.stintCap;
  // Stable between renders so memoised tower rows don't all redraw
  const key = compounds ? `${compounds.hard}${compounds.medium}${compounds.soft}${compounds.source}` : "";
  return useMemo(() => ({ compounds, stintCap }), [key, stintCap]);
}

/** How close a set is to the stint limit: null without one, else laps left and a level */
export function capState(age: number, cap: number | undefined): { left: number; level: "ok" | "near" | "last" } | null {
  if (!cap) return null;
  const left = cap - age;
  return { left, level: left <= 2 ? "last" : left <= 5 ? "near" : "ok" };
}
