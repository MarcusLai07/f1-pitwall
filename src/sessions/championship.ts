// Championship standings and the title race, for the Championship panel. Standings come
// from Jolpica (the Ergast continuation, api.jolpi.ca); it sends no CORS headers, so the
// extension reaches it with host permission and the dev page through Vite's /jolpi proxy.
// Team colours and the full driver/team roster are bundled (teams-2026), so the panel
// works with no live session. Who can still win is worked out from the standings and the
// remaining races in the shared schedule store.

import { create } from "zustand";
import { useEffect } from "react";
import { useTicker } from "../ui/hooks";
import { nextRounds } from "./schedule";

const JOLPI = import.meta.env.DEV ? "/jolpi" : "https://api.jolpi.ca/ergast/f1";

// 2026 constructors and their colours (from f1-dashboard). The roster is fixed; points
// come from Jolpica.
export interface Team {
  name: string;
  color: string;
  engine: string;
  base: string;
  drivers: string[]; // TLAs
}

export const TEAMS_2026: Team[] = [
  { name: "McLaren", color: "#FF8000", engine: "Mercedes", base: "Woking, UK", drivers: ["NOR", "PIA"] },
  { name: "Ferrari", color: "#E8002D", engine: "Ferrari", base: "Maranello, Italy", drivers: ["LEC", "HAM"] },
  { name: "Red Bull Racing", color: "#3671C6", engine: "Red Bull Ford", base: "Milton Keynes, UK", drivers: ["VER", "HAD"] },
  { name: "Mercedes", color: "#27F4D2", engine: "Mercedes", base: "Brackley, UK", drivers: ["RUS", "ANT"] },
  { name: "Aston Martin", color: "#229971", engine: "Honda", base: "Silverstone, UK", drivers: ["ALO", "STR"] },
  { name: "Alpine", color: "#00A1E8", engine: "Mercedes", base: "Enstone, UK", drivers: ["GAS", "COL"] },
  { name: "Williams", color: "#1868DB", engine: "Mercedes", base: "Grove, UK", drivers: ["ALB", "SAI"] },
  { name: "Racing Bulls", color: "#6692FF", engine: "Red Bull Ford", base: "Faenza, Italy", drivers: ["LAW", "LIN"] },
  { name: "Audi", color: "#F50537", engine: "Audi", base: "Hinwil, Switzerland", drivers: ["HUL", "BOR"] },
  { name: "Haas F1 Team", color: "#B6BABD", engine: "Ferrari", base: "Kannapolis, USA", drivers: ["OCO", "BEA"] },
  { name: "Cadillac", color: "#1C1C1C", engine: "Ferrari", base: "Indianapolis, USA", drivers: ["PER", "BOT"] },
];

// Jolpica's constructor names → ours (it uses older or short names)
const TEAM_ALIASES: Record<string, string> = {
  "Red Bull": "Red Bull Racing",
  "RB F1 Team": "Racing Bulls",
  Sauber: "Audi",
  "Kick Sauber": "Audi",
  "Alpine F1 Team": "Alpine",
  "Cadillac F1 Team": "Cadillac",
};

const byName = new Map(TEAMS_2026.map((t) => [t.name, t]));

export function teamByName(name: string): Team | undefined {
  return byName.get(TEAM_ALIASES[name] ?? name);
}
export function teamColor(name: string): string {
  return teamByName(name)?.color ?? "#808080";
}

export interface DriverStanding {
  position: number;
  id: string; // Jolpica driverId, for per-race results
  code: string;
  number: number;
  name: string;
  nationality: string;
  team: string;
  color: string;
  points: number;
  wins: number;
}
export interface ConstructorStanding {
  position: number;
  name: string;
  color: string;
  points: number;
  wins: number;
}
export interface Standings {
  season: number;
  round: number;
  drivers: DriverStanding[];
  constructors: ConstructorStanding[];
}

type Entry = Standings | "loading" | { error: string };
export const useStandings = create<{ entry?: Entry }>(() => ({}));
export const isStandings = (e: Entry | undefined): e is Standings => !!e && typeof e === "object" && "drivers" in e;

const REFRESH_MS = 10 * 60_000;
let loadedAt = 0;

interface JDriver {
  driverId: string;
  code?: string;
  permanentNumber?: string;
  givenName: string;
  familyName: string;
  nationality: string;
}
interface JList<T> {
  MRData: { StandingsTable: { StandingsLists: T[] } };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${JOLPI}/${path}`);
  if (!res.ok) throw new Error(`Jolpica answered ${res.status}`);
  return res.json();
}

/** Loads the current standings unless a fresh copy is already in hand (or loading). */
export function ensureStandings() {
  const cur = useStandings.getState().entry;
  if (cur === "loading" || (isStandings(cur) && Date.now() - loadedAt < REFRESH_MS)) return;
  if (!isStandings(cur)) useStandings.setState({ entry: "loading" });
  Promise.all([
    fetchJson<JList<{ season: string; round: string; DriverStandings: { position: string; points: string; wins: string; Driver: JDriver; Constructors: { name: string }[] }[] }>>("current/driverStandings.json"),
    fetchJson<JList<{ ConstructorStandings: { position: string; points: string; wins: string; Constructor: { name: string } }[] }>>("current/constructorStandings.json"),
  ])
    .then(([dr, cr]) => {
      const dList = dr.MRData.StandingsTable.StandingsLists[0];
      const cList = cr.MRData.StandingsTable.StandingsLists[0];
      if (!dList || !cList) throw new Error("No standings yet");
      const drivers: DriverStanding[] = dList.DriverStandings.map((d) => {
        const team = TEAM_ALIASES[d.Constructors[0]?.name] ?? d.Constructors[0]?.name ?? "";
        return {
          position: Number(d.position),
          id: d.Driver.driverId,
          code: d.Driver.code ?? d.Driver.familyName.slice(0, 3).toUpperCase(),
          number: Number(d.Driver.permanentNumber) || 0,
          name: `${d.Driver.givenName} ${d.Driver.familyName}`,
          nationality: d.Driver.nationality,
          team,
          color: teamColor(team),
          points: Number(d.points),
          wins: Number(d.wins),
        };
      });
      const constructors: ConstructorStanding[] = cList.ConstructorStandings.map((c) => {
        const name = TEAM_ALIASES[c.Constructor.name] ?? c.Constructor.name;
        return { position: Number(c.position), name, color: teamColor(name), points: Number(c.points), wins: Number(c.wins) };
      });
      loadedAt = Date.now();
      useStandings.setState({ entry: { season: Number(dList.season), round: Number(dList.round), drivers, constructors } });
    })
    .catch((err) => {
      if (!isStandings(useStandings.getState().entry)) useStandings.setState({ entry: { error: err instanceof Error ? err.message : String(err) } });
    });
}

export interface TitleRace<T> {
  leader?: T;
  /** Points still available to each entrant from the remaining races */
  remaining: number;
  races: number;
  sprints: number;
  /** position → still mathematically able to win the title */
  canWin: Set<number>;
  /** The leader has clinched it */
  clinched: boolean;
}

const POINTS_WIN = 25;
const POINTS_SPRINT = 8;

/**
 * Who can still win, from the points gap and the races left. Simplified: it uses the
 * maximum points on offer and ignores count-back on wins, so a driver it marks "in the
 * hunt" on equal theoretical points might lose a tie-break.
 */
export function titleRace<T extends { position: number; points: number }>(table: T[], races: number, sprints: number): TitleRace<T> {
  const remaining = races * POINTS_WIN + sprints * POINTS_SPRINT;
  const leader = table[0];
  const canWin = new Set<number>();
  if (leader) for (const e of table) if (e.points + remaining >= leader.points) canWin.add(e.position);
  const second = table[1];
  const clinched = !!leader && !!second && leader.points > second.points + remaining;
  return { leader, remaining, races, sprints, canWin, clinched };
}

/** Standings plus the title picture, refreshed and recomputed as the season rolls on */
export function useChampionship() {
  useTicker(1 / 30);
  const entry = useStandings((s) => s.entry);
  useEffect(() => {
    ensureStandings();
    const id = setInterval(ensureStandings, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const standings = isStandings(entry) ? entry : null;
  const { races, sprints } = nextRounds(standings?.season ?? new Date().getFullYear());
  return {
    loading: entry === "loading" || entry === undefined,
    error: entry && typeof entry === "object" && "error" in entry ? entry.error : null,
    standings,
    drivers: standings ? titleRace(standings.drivers, races, sprints) : null,
    constructors: standings ? titleRace(standings.constructors, races, sprints) : null,
  };
}

export interface RaceResult {
  round: number;
  name: string; // "Singapore"
  position: number | null; // finishing position, null if no classified result
  grid: number;
  points: number;
  status: string; // "Finished", "+1 Lap", "Accident"…
  dnf: boolean;
}

const resultsCache = new Map<string, Promise<RaceResult[]>>();

/** A driver's result in every round this season (cached); newest round last */
export function driverResults(driverId: string): Promise<RaceResult[]> {
  let p = resultsCache.get(driverId);
  if (!p) {
    p = fetchJson<{ MRData: { RaceTable: { Races: { round: string; raceName: string; Circuit: { Location: { locality: string } }; Results: { position: string; grid: string; points: string; status: string }[] }[] } } }>(
      `current/drivers/${driverId}/results.json?limit=100`
    )
      .then((r) =>
        r.MRData.RaceTable.Races.map((race) => {
          const res = race.Results[0];
          const status = res?.status ?? "";
          return {
            round: Number(race.round),
            name: race.Circuit?.Location?.locality || race.raceName.replace(/ Grand Prix$/, ""),
            position: res ? Number(res.position) : null,
            grid: res ? Number(res.grid) : 0,
            points: res ? Number(res.points) : 0,
            status,
            dnf: !/^(Finished|\+\d+ Lap)/.test(status),
          };
        })
      )
      .catch((err) => {
        resultsCache.delete(driverId); // let a later open retry
        throw err;
      });
    resultsCache.set(driverId, p);
  }
  return p;
}
