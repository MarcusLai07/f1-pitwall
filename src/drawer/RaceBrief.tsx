// The pre-race brief: the next race's weather forecast, what's at stake in the title
// race, and a guide to the circuit. Opened from the drawer's right-hand tab.

import { useEffect, useMemo, useState } from "react";
import { circuitIdFromName, loadCircuit, type CircuitData } from "../data/circuits";
import { cn } from "../lib/format";
import { useChampionship } from "../sessions/championship";
import { ensureSeason, useNextSession } from "../sessions/schedule";
import type { Meeting, Session } from "../sessions/catalog";
import { useRaceWeather } from "./raceWeather";

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
