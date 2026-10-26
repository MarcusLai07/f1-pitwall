// The pre-race brief: the next race's weather forecast, what's at stake in the title
// race, and a guide to the circuit. Opened from the drawer's right-hand tab.

import { useEffect, useMemo, useState } from "react";
import { circuitIdFromName, loadCircuit, type CircuitData } from "../data/circuits";
import { cn } from "../lib/format";
import { useChampionship } from "../sessions/championship";
import { ensureSeason, useNextSession } from "../sessions/schedule";
import type { Meeting, Session } from "../sessions/catalog";
import { usePitwall } from "../data/store";
import { useNomination, useRaceWeather, useRaceStrategy } from "./raceWeather";

const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The race the brief is about: the next upcoming meeting's Race session */
function useTargetRace(): { meeting: Meeting; race: Session | undefined } | null {
  const next = useNextSession();
  useEffect(() => {
    if (next) ensureSeason(new Date(next.session.start).getFullYear());
  }, [next?.meeting.key]);
  if (!next) return null;
  return { meeting: next.meeting, race: next.meeting.sessions.find((s) => /^Race$/i.test(s.name)) ?? next.meeting.sessions.at(-1) };
}

export function RaceBriefPanel() {
  const target = useTargetRace();

  if (!target) return <Empty>Waiting for the schedule…</Empty>;
  const { meeting, race } = target;
  const season = new Date(race?.start ?? meeting.start ?? Date.now()).getFullYear();
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2">
        {meeting.flag && <img src={meeting.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />}
        <span className="text-[13px] font-black text-zinc-100">{meeting.name}</span>
        <span className="text-[11px] text-zinc-500">{meeting.circuit}</span>
        {race && <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{day.format(race.start)}</span>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <WeatherCard location={meeting.location || meeting.circuit} startMs={race?.start} />
        <StakeCard meeting={meeting} />
        <NominationCard season={season} location={meeting.location || meeting.circuit} />
        <StrategyCard location={meeting.location || meeting.circuit} />
        <TyresCard />
        <CircuitCard meeting={meeting} />
      </div>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5", className)}>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-zinc-500">{children}</div>;
}

function WeatherCard({ location, startMs }: { location: string; startMs?: number }) {
  const { weather, loading, unavailable } = useRaceWeather(location, startMs);
  return (
    <Section title="Race-day weather">
      {loading ? (
        <p className="text-[12px] text-zinc-500">Loading forecast…</p>
      ) : unavailable || !weather ? (
        <p className="text-[12px] text-zinc-500">Forecast not available yet (more than two weeks out, or no data).</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="text-[26px] font-black leading-none text-zinc-100">
            {weather.temp}
            <span className="text-[14px] text-zinc-500">°C</span>
          </div>
          <div className="text-[12px] leading-tight">
            <p className={cn("font-bold", weather.dry ? "text-green-400" : "text-sky-300")}>{weather.dry ? "Likely dry" : "Rain possible"}</p>
            <p className="text-zinc-400">
              {weather.rain}% rain · {weather.wind} km/h wind
            </p>
          </div>
        </div>
      )}
      <p className="mt-1.5 text-[9px] text-zinc-600">Forecast at the circuit around race start · Open-Meteo</p>
    </Section>
  );
}

function StakeCard({ meeting }: { meeting: Meeting }) {
  const { drivers, constructors, standings } = useChampionship();
  const sprint = meeting.sessions.some((s) => /^Sprint$/i.test(s.name));
  const maxThisRound = 25 + (sprint ? 8 : 0);

  type Row = { position: number; points: number; name?: string; code?: string };
  type Race = { clinched: boolean; remaining: number; canWin: Set<number> } | null;
  const line = (what: string, race: Race, table: Row[] | undefined) => {
    if (!race || !table || table.length < 2) return null;
    const [leader, second] = table;
    const who = leader.code ?? leader.name ?? `P${leader.position}`;
    if (race.clinched) return <p key={what} className="text-[12px] text-amber-300">🏆 {what} title already decided.</p>;
    const lead = leader.points - second.points;
    // Leader clinches this round if, winning the max while the rival scores nothing,
    // their lead would exceed the points still on offer afterwards
    const clinchable = lead > race.remaining - 2 * maxThisRound;
    return (
      <p key={what} className="text-[12px] text-zinc-300">
        <b className="text-zinc-100">{who}</b> leads the {what} title by <b className="text-zinc-100">{lead}</b>.{" "}
        {clinchable ? (
          <span className="font-semibold text-amber-300">Can clinch it this weekend.</span>
        ) : (
          <span className="text-zinc-500">
            {race.canWin.size} still in it · {race.remaining} pts left.
          </span>
        )}
      </p>
    );
  };

  return (
    <Section title="What's at stake">
      {standings ? (
        <div className="space-y-1">
          {line("drivers'", drivers, standings.drivers)}
          {line("constructors'", constructors, standings.constructors)}
          <p className="pt-0.5 text-[10px] text-zinc-600">
            {maxThisRound} pts on offer this round{sprint ? " (sprint weekend)" : ""}.
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-zinc-500">Loading standings…</p>
      )}
    </Section>
  );
}

const COMPOUND = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const COMPOUND_SHORT: Record<string, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };
const COMPOUND_COLOR: Record<string, string> = { SOFT: "#ef4444", MEDIUM: "#eab308", HARD: "#e5e7eb", INTERMEDIATE: "#22c55e", WET: "#3b82f6" };

// Pirelli's hardest→softest C-range palette (independent of per-weekend white/yellow/red)
const C_COLOR: Record<string, string> = { C1: "#60a5fa", C2: "#e5e7eb", C3: "#eab308", C4: "#f97316", C5: "#ef4444", C6: "#ec4899" };

function NominationCard({ season, location }: { season: number; location: string }) {
  const nom = useNomination(season, location);
  return (
    <Section title="Pirelli compounds">
      {!nom ? (
        <p className="text-[12px] text-zinc-500">Not announced yet for this race.</p>
      ) : (
        <div className="flex items-center gap-4">
          {([["Hard", nom.hard], ["Medium", nom.medium], ["Soft", nom.soft]] as const).map(([role, c]) => (
            <div key={role} className="flex items-center gap-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-black" style={{ borderColor: C_COLOR[c] ?? "#888", color: C_COLOR[c] ?? "#888" }}>
                {c}
              </span>
              <span className="text-[11px] text-zinc-400">{role}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function StrategyCard({ location }: { location: string }) {
  const { strategy, loading } = useRaceStrategy(location);
  return (
    <Section title="Likely strategy">
      {loading ? (
        <p className="text-[12px] text-zinc-500">Reading past races…</p>
      ) : !strategy ? (
        <p className="text-[12px] text-zinc-500">No pit-stop history for this circuit yet.</p>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <p className="text-[13px] font-bold text-zinc-100">Typically a {strategy.typical}-stop race</p>
            {strategy.pitSeconds != null && (
              <span className="text-[12px] font-bold tabular-nums text-amber-300" data-tip="Median pit-lane time lost per stop in the last race here">
                ~{strategy.pitSeconds}s / stop
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {strategy.season}:{" "}
            {Object.entries(strategy.stops)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([n, c]) => `${c} ran ${n}`)
              .join(" · ")}
          </p>
          <p className="mt-1 text-[9px] text-zinc-600">From the last race here · Jolpica</p>
        </div>
      )}
    </Section>
  );
}

interface TyreUse {
  code: string;
  color: string;
  used: { compound: string; n: number }[];
}

/** Fresh tyre sets each driver has used in the session now loaded (the feed only tracks
 *  the current session, so this is "used so far", not the full weekend allocation). */
function useSessionTyres(): TyreUse[] | null {
  const app = usePitwall((s) => s.live.TimingAppData);
  const drivers = usePitwall((s) => s.live.DriverList);
  const source = usePitwall((s) => s.source);
  return useMemo(() => {
    if (source !== "live" && source !== "replay") return null;
    const lines = app?.Lines;
    if (!lines || !drivers) return null;
    const out: TyreUse[] = [];
    for (const [num, line] of Object.entries(lines)) {
      const d = drivers[num];
      if (!d) continue;
      const counts = new Map<string, number>();
      for (const st of line.Stints ?? []) {
        if (st.New === "true" && st.Compound) counts.set(st.Compound, (counts.get(st.Compound) ?? 0) + 1);
      }
      if (!counts.size) continue;
      out.push({
        code: d.Tla,
        color: d.TeamColour ? `#${d.TeamColour}` : "#808080",
        used: COMPOUND.filter((c) => counts.has(c)).map((c) => ({ compound: c, n: counts.get(c)! })),
      });
    }
    return out.length ? out : null;
  }, [app, drivers, source]);
}

function TyresCard() {
  const tyres = useSessionTyres();
  return (
    <Section title="Tyre sets used (this session)">
      {!tyres ? (
        <p className="text-[12px] text-zinc-500">Shows during a session, once cars run. F1 only sends tyre sets for the live session, not the full weekend.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {tyres.map((t) => (
            <div key={t.code} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-8 font-bold text-zinc-200" style={{ color: t.color }}>
                {t.code}
              </span>
              <span className="flex gap-1">
                {t.used.map((u) => (
                  <span key={u.compound} className="tabular-nums" style={{ color: COMPOUND_COLOR[u.compound] }}>
                    {u.n}
                    {COMPOUND_SHORT[u.compound] ?? "?"}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function CircuitCard({ meeting }: { meeting: Meeting }) {
  const id = useMemo(() => circuitIdFromName(meeting.circuit, meeting.location), [meeting.circuit, meeting.location]);
  const [circuit, setCircuit] = useState<CircuitData | null>(null);
  useEffect(() => {
    setCircuit(null);
    if (!id) return;
    let alive = true;
    loadCircuit(id).then((c) => alive && setCircuit(c?.circuit ?? null));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Section title="Circuit guide" className="md:col-span-2">
      {!circuit ? (
        <p className="text-[12px] text-zinc-500">No guide for {meeting.circuit} yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
          <Fact label="Length" value={circuit.length ? `${circuit.length} km` : "—"} />
          <Fact label="Turns" value={circuit.turns ? String(circuit.turns) : "—"} />
          <Fact label="Laps" value={circuit.laps ? String(circuit.laps) : "—"} />
          <Fact label="Distance" value={circuit.raceDistance ? `${Math.round(circuit.raceDistance)} km` : "—"} />
          <Fact label="DRS zones" value={circuit.drsZones?.length ? String(circuit.drsZones.length) : "—"} />
          <Fact label="Pit loss" value={circuit.pitLaneTimeLoss ? `${circuit.pitLaneTimeLoss}s` : "—"} />
          <Fact label="First GP" value={circuit.firstGP ? String(circuit.firstGP) : "—"} />
          {circuit.records?.lapRecord?.time && (
            <Fact label="Lap record" value={`${circuit.records.lapRecord.time}`} sub={`${circuit.records.lapRecord.driver ?? ""} ${circuit.records.lapRecord.year ?? ""}`.trim()} />
          )}
        </div>
      )}
    </Section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-bold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}
