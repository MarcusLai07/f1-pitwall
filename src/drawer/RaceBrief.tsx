// The pre-race brief, opened from the drawer's right-hand tab: four sections you swipe
// between (or pick from the tab row): an overview (weather, what's at stake, the weekend at
// a glance, the circuit), tyres (Pirelli's compounds, any stint limit, sets left), this
// event's rules, and grid penalties with the stewards' decisions. The weekend-specific
// parts come from the FIA's event documents (weekendBrief.ts).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { circuitIdFromName, loadCircuit, type CircuitData } from "../data/circuits";
import { raceControlMessages } from "../data/derive";
import { investigations } from "../data/stewards";
import { usePitwall } from "../data/store";
import { cn, isLightColor } from "../lib/format";
import { useChampionship } from "../sessions/championship";
import { ensureSeason, useNextSession } from "../sessions/schedule";
import type { Meeting, Session } from "../sessions/catalog";
import { useRaceStrategy, useRaceWeather } from "./raceWeather";
import { useWeekendTyres, type WeekendTyre } from "./weekendTyres";
import {
  useCompounds,
  useWeekendEvent,
  type Compounds,
  type DocRef,
  type GridDrop,
  type MeetingRef,
  type StewardEntry,
  type StewardKind,
  type TyreRules,
  type WeekendEvent,
} from "./weekendBrief";

const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const stamp = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The race the brief is about: the next upcoming meeting's Race session */
function useTargetRace(): { meeting: Meeting; race: Session | undefined } | null {
  const next = useNextSession();
  useEffect(() => {
    if (next) ensureSeason(new Date(next.session.start).getFullYear());
  }, [next?.meeting.key]);
  if (!next) return null;
  return { meeting: next.meeting, race: next.meeting.sessions.find((s) => /^Race$/i.test(s.name)) ?? next.meeting.sessions.at(-1) };
}

function useCircuit(meeting: Meeting): CircuitData | null {
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
  return circuit;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tyres", label: "Tyres" },
  { id: "rules", label: "Rules" },
  { id: "grid", label: "Grid & penalties" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// The section you were on, kept while Pit Wall stays open
let lastTab = 0;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function RaceBriefPanel() {
  const target = useTargetRace();
  if (!target) return <Empty>Waiting for the schedule…</Empty>;
  return <Brief meeting={target.meeting} race={target.race} />;
}

function Brief({ meeting, race }: { meeting: Meeting; race: Session | undefined }) {
  const season = new Date(race?.start ?? meeting.start ?? Date.now()).getFullYear();
  const sprint = meeting.sessions.some((s) => /^Sprint$/i.test(s.name));
  const ref = useMemo<MeetingRef>(
    () => ({ season, name: meeting.name, location: meeting.location, circuit: meeting.circuit, raceStart: race?.start }),
    [season, meeting.name, meeting.location, meeting.circuit, race?.start]
  );
  const { event, grid, updatedAt, loaded } = useWeekendEvent(ref);
  const compounds = useCompounds(ref, event);
  const circuit = useCircuit(meeting);
  const cap = event?.tyres?.stintCap;
  const laps = circuit?.laps;

  // ---- swipe track: native horizontal scroll with snapping, plus mouse drag ----
  const trackRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(lastTab);
  const pick = (i: number) => {
    lastTab = i;
    setTab(i);
  };
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (el) el.scrollLeft = tab * el.clientWidth;
  }, []);
  // While a tab click scrolls across several sections, keep the underline on the target
  const heading = useRef<number | null>(null);
  const go = (i: number) => {
    const el = trackRef.current;
    const t = Math.max(0, Math.min(TABS.length - 1, i));
    pick(t);
    if (!el || el.scrollLeft === t * el.clientWidth) return; // already there: no scroll, no scrollend
    heading.current = t;
    el.scrollTo({ left: t * el.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const at = () => {
    const el = trackRef.current;
    return el ? Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) : tab;
  };
  const onScroll = () => {
    if (drag.current || heading.current != null) {
      if (heading.current === at() && trackRef.current!.scrollLeft % trackRef.current!.clientWidth === 0) heading.current = null;
      return;
    }
    if (at() !== tab) pick(at());
  };
  const onScrollEnd = () => {
    heading.current = null;
    if (!drag.current && at() !== tab) pick(at());
  };
  const drag = useRef<{ x: number; left: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
    drag.current = { x: e.clientX, left: el.scrollLeft };
    el.style.scrollSnapType = "none";
    el.style.userSelect = "none";
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (el && drag.current) el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    const d = drag.current;
    if (!el || !d) return;
    drag.current = null;
    el.style.scrollSnapType = "";
    el.style.userSelect = "";
    const dx = e.clientX - d.x;
    const from = Math.round(d.left / Math.max(1, el.clientWidth));
    go(Math.abs(dx) > el.clientWidth * 0.12 ? from + (dx < 0 ? 1 : -1) : from);
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(TABS.length - 1, tab + (e.key === "ArrowRight" ? 1 : -1)));
    go(next);
    (e.currentTarget.querySelectorAll("[role=tab]")[next] as HTMLElement | undefined)?.focus();
  };
  const goTo = (id: TabId) => go(TABS.findIndex((t) => t.id === id));

  const special = !!cap || !!event?.rules?.length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        {meeting.flag && <img src={meeting.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />}
        <span className="text-[13px] font-black text-zinc-100">{meeting.name}</span>
        <span className="text-[11px] text-zinc-400">{meeting.circuit}</span>
        {race && <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{day.format(race.start)}</span>}
      </div>
      <div className="flex items-center gap-0.5 border-b border-zinc-800 px-2" role="tablist" aria-label="Race brief sections" onKeyDown={onTabKey}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === tab}
            tabIndex={i === tab ? 0 : -1}
            onClick={() => go(i)}
            className={cn(
              "relative flex h-8 items-center gap-1.5 rounded-t-md px-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
              i === tab ? "text-white" : "text-zinc-400 hover:text-zinc-100"
            )}
          >
            {t.label}
            {t.id === "rules" && special && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" data-tip="Something unusual this weekend" />}
            {t.id === "grid" && grid.length > 0 && (
              <span className="min-w-[16px] rounded-full bg-orange-500 px-1 text-center text-[10px] leading-[16px] tracking-normal text-black">{grid.length}</span>
            )}
            <span className={cn("absolute inset-x-2.5 -bottom-px h-[2px] rounded transition-colors", i === tab ? "bg-amber-400" : "bg-transparent")} />
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] tabular-nums text-zinc-500">
          {tab + 1} / {TABS.length}
        </span>
        <ArrowButton dir={-1} disabled={tab === 0} onClick={() => go(tab - 1)} />
        <ArrowButton dir={1} disabled={tab === TABS.length - 1} onClick={() => go(tab + 1)} />
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        onScrollEnd={onScrollEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Panel label="Overview">
          <div className="grid gap-2 md:grid-cols-2">
            <WeatherCard location={meeting.location || meeting.circuit} startMs={race?.start} />
            <StakeCard meeting={meeting} />
            <ThisWeekendCard compounds={compounds} event={event} grid={grid} cap={cap} laps={laps} loaded={loaded} onGo={goTo} />
            <CircuitCard meeting={meeting} circuit={circuit} />
          </div>
        </Panel>
        <Panel label="Tyres">
          <div className="grid gap-2 md:grid-cols-2">
            <CompoundsCard compounds={compounds} tyres={event?.tyres} />
            {cap ? <StintCapCard cap={cap} laps={laps} location={meeting.location || meeting.circuit} /> : <StrategyCard location={meeting.location || meeting.circuit} />}
            <TyresCard sprint={sprint} />
          </div>
        </Panel>
        <Panel label="Rules">
          <RulesPanel event={event} laps={laps} loaded={loaded} />
        </Panel>
        <Panel label="Grid and penalties">
          <GridPanel meeting={meeting} season={season} event={event} grid={grid} updatedAt={updatedAt} loaded={loaded} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section role="tabpanel" aria-label={label} className="h-full w-full shrink-0 snap-start snap-always overflow-y-auto p-3 pt-2.5">
      {children}
    </section>
  );
}

function ArrowButton({ dir, disabled, onClick }: { dir: 1 | -1; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir < 0 ? "Previous section" : "Next section"}
      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:pointer-events-none disabled:text-zinc-700"
    >
      <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir < 0 ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

function Section({ title, children, className, tone, aside }: { title: string; children: React.ReactNode; className?: string; tone?: "special"; aside?: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border p-2.5", tone === "special" ? "border-amber-900/80 bg-amber-950/20" : "border-zinc-800 bg-zinc-900/40", className)}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className={cn("text-[9px] font-bold uppercase tracking-[0.14em]", tone === "special" ? "text-amber-400" : "text-zinc-400")}>{title}</p>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-zinc-400">{children}</div>;
}

function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 text-[9.5px] text-zinc-500", className)}>{children}</p>;
}

function DocLink({ doc, label }: { doc: DocRef; label?: string }) {
  return (
    <a href={doc.url} target="_blank" rel="noreferrer" className="text-amber-300/90 hover:text-amber-200 hover:underline">
      {label ?? `Doc ${doc.num}`}
    </a>
  );
}

// ---- Overview --------------------------------------------------------------------------

function WeatherCard({ location, startMs }: { location: string; startMs?: number }) {
  const { weather, loading, unavailable } = useRaceWeather(location, startMs);
  return (
    <Section title="Race-day weather">
      {loading ? (
        <p className="text-[12px] text-zinc-400">Loading forecast…</p>
      ) : unavailable || !weather ? (
        <p className="text-[12px] text-zinc-400">Forecast not available yet (more than two weeks out, or no data).</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="text-[26px] font-black leading-none text-zinc-100">
            {weather.temp}
            <span className="text-[14px] text-zinc-400">°C</span>
          </div>
          <div className="text-[12px] leading-tight">
            <p className={cn("font-bold", weather.dry ? "text-green-400" : "text-sky-300")}>{weather.dry ? "Likely dry" : "Rain possible"}</p>
            <p className="text-zinc-400">
              {weather.rain}% rain · {weather.wind} km/h wind
            </p>
          </div>
        </div>
      )}
      <Note>Forecast at the circuit around race start · Open-Meteo</Note>
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
          <span className="text-zinc-400">
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
          <p className="pt-0.5 text-[10px] text-zinc-500">
            {maxThisRound} pts on offer this round{sprint ? " (sprint weekend)" : ""}.
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-zinc-400">Loading standings…</p>
      )}
    </Section>
  );
}

/** How many stops a stint limit forces over a race distance, and the earliest/latest laps
 *  those stops can fall on */
function capMaths(cap: number, laps: number | undefined) {
  if (!laps || laps <= cap) return null;
  const stops = Math.ceil(laps / cap) - 1;
  return { stops, firstFrom: Math.max(1, laps - stops * cap), lastFrom: laps - cap };
}

function rangeName(c: Compounds) {
  if (c.hard === "C1" && c.medium === "C2" && c.soft === "C3") return "Pirelli's three hardest";
  if (c.hard === "C3" && c.medium === "C4" && c.soft === "C5") return "Pirelli's three softest";
  return "Hard · medium · soft";
}

const penaltyText = (g: GridDrop) => (g.kind === "places" ? `−${g.places} places` : g.kind === "back" ? "back of the grid" : "pit lane start");

function ThisWeekendCard({
  compounds,
  event,
  grid,
  cap,
  laps,
  loaded,
  onGo,
}: {
  compounds: Compounds | null;
  event: WeekendEvent | undefined;
  grid: GridDrop[];
  cap: number | undefined;
  laps: number | undefined;
  loaded: boolean;
  onGo: (id: TabId) => void;
}) {
  const maths = cap ? capMaths(cap, laps) : null;
  const decisions = event?.stewards.filter((s) => s.kind !== "laps-deleted" && s.kind !== "grid") ?? [];
  const count = (k: StewardKind) => decisions.filter((s) => s.kind === k).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const others = [count("penalty") && plural(count("penalty"), "penalty"), count("fine") && plural(count("fine"), "fine"), count("reprimand") && plural(count("reprimand"), "reprimand"), count("cleared") && `${count("cleared")} cleared`]
    .filter(Boolean)
    .join(" · ");

  const rules = cap
    ? { title: `${cap}-lap cap per set`, sub: maths ? `Forces at least ${plural(maths.stops, "stop")}` : "Max laps on any one set", hot: true }
    : event?.rules?.length
      ? { title: plural(event.rules.length, "note"), sub: "For this event", hot: true }
      : event
        ? { title: "Nothing unusual", sub: "Standard 2026 rules", hot: false }
        : { title: "Not out yet", sub: "The FIA's notes come in race week", hot: false };
  const gridTile = grid.length
    ? { title: `${grid[0].code ?? `#${grid[0].car}`} ${penaltyText(grid[0])}`, sub: grid.length > 1 ? `+${grid.length - 1} more grid drop${grid.length > 2 ? "s" : ""}` : others || "On Sunday's grid", hot: true }
    : event
      ? { title: "No grid drops", sub: others || "No stewards' decisions yet", hot: false }
      : { title: "Nothing yet", sub: loaded ? "Shows once the FIA publishes" : "Loading…", hot: false };

  return (
    <Section title="This weekend" className="md:col-span-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Tile label="Tyres" onClick={() => onGo("tyres")} title={compounds ? `${compounds.hard} · ${compounds.medium} · ${compounds.soft}` : "Not announced"} sub={compounds ? rangeName(compounds) : "Pirelli names them before the race"} />
        <Tile label="Rules" onClick={() => onGo("rules")} title={rules.title} sub={rules.sub} tone={rules.hot ? "amber" : undefined} />
        <Tile label="Grid & penalties" onClick={() => onGo("grid")} title={gridTile.title} sub={gridTile.sub} tone={gridTile.hot ? "orange" : undefined} />
      </div>
    </Section>
  );
}

function Tile({ label, title, sub, tone, onClick }: { label: string; title: string; sub: string; tone?: "amber" | "orange"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "min-w-0 rounded-md border px-2 py-1.5 text-left transition-colors hover:border-zinc-500",
        tone === "amber" ? "border-amber-900 bg-amber-950/30" : "border-zinc-700/80 bg-zinc-900/70"
      )}
    >
      <span className={cn("block text-[9px] font-bold uppercase tracking-[0.12em]", tone === "amber" ? "text-amber-400" : tone === "orange" ? "text-orange-400" : "text-zinc-400")}>{label} ›</span>
      <span className="block truncate text-[12.5px] font-bold text-zinc-100">{title}</span>
      <span className="block truncate text-[10.5px] text-zinc-400">{sub}</span>
    </button>
  );
}

function CircuitCard({ meeting, circuit }: { meeting: Meeting; circuit: CircuitData | null }) {
  return (
    <Section title="Circuit guide" className="md:col-span-2">
      {!circuit ? (
        <p className="text-[12px] text-zinc-400">No guide for {meeting.circuit} yet.</p>
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
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="font-bold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-400">{sub}</div>}
    </div>
  );
}

// ---- Tyres -----------------------------------------------------------------------------

const COMPOUND_ORDER = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const;
const COMPOUND_SHORT: Record<string, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };
const COMPOUND_COLOR: Record<string, string> = { SOFT: "#ef4444", MEDIUM: "#eab308", HARD: "#e5e7eb", INTERMEDIATE: "#22c55e", WET: "#3b82f6" };

// Pirelli/FIA dry allocation per driver: 13 sets a normal weekend (8 soft, 3 medium,
// 2 hard), 12 on a sprint weekend (6 soft, 4 medium, 2 hard). A fixed rule, not in the feed.
const ALLOCATION = { normal: { S: 8, M: 3, H: 2 }, sprint: { S: 6, M: 4, H: 2 } };

function CompoundsCard({ compounds, tyres }: { compounds: Compounds | null; tyres: TyreRules | undefined }) {
  return (
    <Section
      title="Pirelli compounds"
      aside={compounds?.source === "fia" && <span className="text-[9px] font-bold tracking-wider text-green-400" data-tip="Read from the FIA's copy of Pirelli's prescriptions">● FIA</span>}
    >
      {!compounds ? (
        <p className="text-[12px] text-zinc-400">Not announced yet for this race.</p>
      ) : (
        <>
          {/* Ring in the colour the tyre wears this weekend, C-number inside */}
          <div className="flex items-center gap-4">
            {([["Hard", compounds.hard, "HARD"], ["Medium", compounds.medium, "MEDIUM"], ["Soft", compounds.soft, "SOFT"]] as const).map(([role, c, key]) => (
              <div key={role} className="flex items-center gap-1.5">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-[3px] text-[10px] font-black" style={{ borderColor: COMPOUND_COLOR[key], color: COMPOUND_COLOR[key] }}>
                  {c}
                </span>
                <span className="text-[11px] text-zinc-300">{role}</span>
              </div>
            ))}
          </div>
          {tyres?.mandatory?.length ? (
            <p className="mt-2 text-[10.5px] text-zinc-400" data-tip="Sets Pirelli's prescriptions set aside for the race, and for Q3">
              Mandatory race tyres <b className="text-zinc-100">{tyres.mandatory.join(" · ")}</b>
              {tyres.q3 && (
                <>
                  {" "}
                  · Q3 tyre <b className="text-zinc-100">{tyres.q3}</b>
                </>
              )}
            </p>
          ) : null}
          <Note>
            {tyres ? (
              <>
                <DocLink doc={tyres.doc} label={`FIA Doc ${tyres.doc.num} · Pirelli preview`} />
                {tyres.doc.published && ` · ${stamp.format(Date.parse(tyres.doc.published))}`}
              </>
            ) : (
              "Pirelli's announcement · the FIA's copy replaces it during race week"
            )}
          </Note>
        </>
      )}
    </Section>
  );
}

function StintCapCard({ cap, laps, location }: { cap: number; laps: number | undefined; location: string }) {
  const maths = capMaths(cap, laps);
  const { strategy } = useRaceStrategy(location);
  return (
    <Section title="Tyre life cap" tone="special" aside={<span className="text-[9px] font-bold tracking-wider text-amber-400">THIS EVENT</span>}>
      <div className="flex items-baseline gap-2">
        <span className="text-[22px] font-black leading-none text-amber-300">{cap} laps</span>
        <span className="text-[11px] text-zinc-300">max per set, all sessions</span>
      </div>
      {maths && (
        <>
          <p className="mt-1.5 text-[11.5px] text-zinc-100">
            <b>Forced {maths.stops}-stop:</b> {laps} laps needs {maths.stops + 1} stints.
          </p>
          <p className="text-[10.5px] text-zinc-400">
            First stop no earlier than lap {maths.firstFrom} · last stop no earlier than lap {maths.lastFrom}.
          </p>
        </>
      )}
      {strategy && (
        <Note>
          {strategy.season}:{" "}
          {Object.entries(strategy.stops)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([n, c]) => `${c} ran ${n}`)
            .join(" · ")}
          {strategy.pitSeconds != null && ` · ~${strategy.pitSeconds}s / stop`}
        </Note>
      )}
    </Section>
  );
}

function StrategyCard({ location }: { location: string }) {
  const { strategy, loading } = useRaceStrategy(location);
  return (
    <Section title="Likely strategy">
      {loading ? (
        <p className="text-[12px] text-zinc-400">Reading past races…</p>
      ) : !strategy ? (
        <p className="text-[12px] text-zinc-400">No pit-stop history for this circuit yet.</p>
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
          <Note>From the last race here · Jolpica</Note>
        </div>
      )}
    </Section>
  );
}

function TyresCard({ sprint }: { sprint: boolean }) {
  const tyres = useWeekendTyres();
  const alloc = sprint ? ALLOCATION.sprint : ALLOCATION.normal;
  const total = alloc.S + alloc.M + alloc.H;
  const weekend = tyres?.weekend ?? false;
  const footer = !tyres
    ? ""
    : weekend
      ? `Sets left = allocation − new sets run across the weekend's sessions${tyres.skipped ? ` (${tyres.skipped} F1 wouldn't send, so these read a little high)` : ""}. Excludes mandatory practice returns, so treat it as a close estimate.`
      : "Standard dry allocation · F1 reports only the current session's sets, so this is used-so-far, not the whole weekend.";
  return (
    <Section title={weekend ? "Tyre sets left (this weekend)" : "Tyre sets used (this session)"} className="md:col-span-2">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10px]" data-tip="Each driver's dry allocation for the weekend.">
        <span className="uppercase tracking-wider text-zinc-400">Weekend allocation</span>
        {([["S", alloc.S, "SOFT"], ["M", alloc.M, "MEDIUM"], ["H", alloc.H, "HARD"]] as const).map(([short, n, comp]) => (
          <span key={short} className="font-bold tabular-nums" style={{ color: COMPOUND_COLOR[comp] }}>
            {n}
            {short}
          </span>
        ))}
        <span className="font-semibold tabular-nums text-zinc-300">
          {total} sets{sprint ? " · sprint" : ""}
        </span>
      </div>
      {!tyres ? (
        <p className="text-[12px] text-zinc-400">Shows during a session, once cars run. The weekend's earlier sessions are read from F1's archive.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 md:grid-cols-4">
          {tyres.rows.map((t) => (
            <TyreRow key={t.code} row={t} alloc={alloc} weekend={weekend} />
          ))}
        </div>
      )}
      {footer && <Note>{footer}</Note>}
    </Section>
  );
}

function TyreRow({ row, alloc, weekend }: { row: WeekendTyre; alloc: { S: number; M: number; H: number }; weekend: boolean }) {
  const usedText = COMPOUND_ORDER.filter((c) => row.used[c]).map((c) => `${row.used[c]}${COMPOUND_SHORT[c]}`).join(" ");
  const cells = weekend
    ? ([["SOFT", alloc.S], ["MEDIUM", alloc.M], ["HARD", alloc.H]] as const).map(([c, a]) => ({ c, n: Math.max(0, a - (row.used[c] ?? 0)) }))
    : COMPOUND_ORDER.filter((c) => row.used[c]).map((c) => ({ c, n: row.used[c]! }));
  return (
    <div className="flex items-center gap-1.5 text-[11px]" data-tip={weekend ? `Used this weekend: ${usedText || "none yet"}` : undefined}>
      <span className="w-8 font-bold text-zinc-200" style={{ color: row.color }}>
        {row.code}
      </span>
      <span className="flex gap-1">
        {cells.map(({ c, n }) => (
          <span key={c} className="tabular-nums" style={{ color: COMPOUND_COLOR[c] }}>
            {n}
            {COMPOUND_SHORT[c]}
          </span>
        ))}
      </span>
    </div>
  );
}

// ---- Rules -----------------------------------------------------------------------------

interface RuleRow {
  tag: string;
  title: string;
  body: string;
  doc?: DocRef;
  special?: boolean;
}

function RulesPanel({ event, laps, loaded }: { event: WeekendEvent | undefined; laps: number | undefined; loaded: boolean }) {
  if (!event) {
    return <Empty>{loaded ? "This event's notes aren't out yet. The FIA publishes them during race week, and they'll show here." : "Loading the FIA's notes…"}</Empty>;
  }
  const t = event.tyres;
  const docByNum = (n?: number) => (n == null ? undefined : event.documents.find((d) => d.num === n) ?? (event.notes?.doc.num === n ? event.notes.doc : undefined));
  const rows: RuleRow[] = [];
  if (t?.stintCap) {
    const maths = capMaths(t.stintCap, laps);
    rows.push({
      tag: "Tyres",
      title: `${t.stintCap}-lap limit on every tyre set`,
      body: `Laps from every session count on that set, and a lap started counts in full. Race laps count from the start signal, not the formation lap.${maths ? ` Over ${laps} laps that means at least ${maths.stops} stops.` : ""}`,
      doc: t.doc,
      special: true,
    });
  }
  if (t?.pressures) {
    rows.push({ tag: "Tyres", title: "Minimum tyre pressures", body: `Slicks start at ${t.pressures.front.toFixed(1)} psi front and ${t.pressures.rear.toFixed(1)} psi rear. The FIA checks them all weekend.`, doc: t.doc });
  }
  for (const r of event.rules ?? []) rows.push({ tag: r.tag, title: r.title, body: r.body, doc: docByNum(r.doc) });

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">This weekend's rules</p>
        <span className="ml-auto text-[9.5px] text-zinc-500">From Pirelli's and the Race Director's notes</span>
      </div>
      {rows.length === 0 && <p className="mb-2 text-[12px] text-zinc-400">Nothing out of the ordinary in this event's notes.</p>}
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className={cn("grid grid-cols-[72px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border px-2.5 py-2", r.special ? "border-amber-900/80 bg-amber-950/20" : "border-zinc-800 bg-zinc-900/40")}>
            <span className={cn("justify-self-start rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.12em]", r.special ? "bg-amber-400 text-black" : "bg-zinc-800 text-zinc-300")}>{r.tag}</span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-zinc-100">{r.title}</p>
              <p className="text-[11px] leading-snug text-zinc-400">{r.body}</p>
            </div>
            {r.doc ? (
              <span className="whitespace-nowrap text-[10px]">
                <DocLink doc={r.doc} />
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {event.notes && event.notes.sections.length > 0 && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
          <p className="text-[10.5px] text-zinc-400">
            Also in the <DocLink doc={event.notes.doc} label="Race Director's notes" />: {event.notes.sections.join(" · ")}
          </p>
        </div>
      )}
      <Note>Only what's specific to this event. The standard 2026 rules aren't repeated.</Note>
    </div>
  );
}

// ---- Grid & penalties ------------------------------------------------------------------

const norm = (s: string | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function sessionShort(s: StewardEntry) {
  const name = s.session ?? "";
  const m = /^(?:Free )?Practice (\d)/i.exec(name);
  if (m) return `FP${m[1]}`;
  if (/sprint (?:qualifying|shootout)/i.test(name)) return "SQ";
  if (/^sprint$/i.test(name)) return "Sprint";
  if (/^qualifying$/i.test(name)) return "Quali";
  if (/^race$/i.test(name)) return "Race";
  return s.published ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(Date.parse(s.published)) : "—";
}

const OUTCOME_STYLE: Record<StewardKind, string> = {
  grid: "bg-orange-400 text-black",
  penalty: "bg-red-500/15 text-red-300",
  fine: "bg-orange-500/15 text-orange-300",
  reprimand: "bg-amber-500/15 text-amber-300",
  warning: "bg-zinc-800 text-amber-200",
  cleared: "bg-zinc-800 text-zinc-300",
  info: "bg-zinc-800 text-zinc-300",
  "laps-deleted": "bg-zinc-800 text-amber-300",
};

function GridPanel({
  meeting,
  season,
  event,
  grid,
  updatedAt,
  loaded,
}: {
  meeting: Meeting;
  season: number;
  event: WeekendEvent | undefined;
  grid: GridDrop[];
  updatedAt: string | undefined;
  loaded: boolean;
}) {
  const drivers = usePitwall((s) => s.live.DriverList);
  const info = usePitwall((s) => s.live.SessionInfo);
  const rc = usePitwall((s) => s.live.RaceControlMessages);
  const colorOf = (car?: string) => (car && drivers?.[car]?.TeamColour ? `#${drivers[car].TeamColour}` : "#a1a1aa");
  const codeOf = (car?: string, code?: string) => code ?? (car ? drivers?.[car]?.Tla : undefined) ?? (car ? `#${car}` : "—");

  // Grid penalties race control calls this weekend show up before the FIA files them
  const watchingThis = !!info?.Meeting && norm(info.Meeting.Name) === norm(meeting.name) && Number(info.Path?.slice(0, 4)) === season;
  const live = useMemo(() => {
    if (!watchingThis) return [];
    return investigations(raceControlMessages({ RaceControlMessages: rc }).reverse()).filter(
      (i) => i.status === "penalty" && /GRID|PIT ?LANE START/i.test(i.outcome) && !grid.some((g) => g.car && i.cars.includes(g.car))
    );
  }, [rc, watchingThis, grid]);

  if (!event && !grid.length && !live.length) {
    return <Empty>{loaded ? "No FIA documents for this event yet. Grid penalties and the stewards' decisions show here as they're published." : "Loading the FIA's documents…"}</Empty>;
  }
  const puDrops = event?.grid.filter((g) => /power unit|PU element/i.test(g.fact ?? "")).length ?? 0;
  const stewards = (event?.stewards ?? []).filter((s) => s.kind !== "grid").sort((a, b) => (b.num ?? 0) - (a.num ?? 0));

  return (
    <div className="grid gap-2">
      <Section title="Race grid">
        {grid.length === 0 && live.length === 0 && <p className="text-[12px] text-zinc-400">No grid penalties so far.</p>}
        <div className="space-y-1.5">
          {grid.map((g) => (
            <div key={g.url} className="flex items-center gap-2.5">
              <CodeChip code={codeOf(g.car, g.code)} color={colorOf(g.car)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-zinc-100">
                  {g.driver ?? `Car ${g.car}`}
                  {g.car && <span className="font-normal text-zinc-400"> · #{g.car}</span>}
                </p>
                <p className="text-[10.5px] leading-snug text-zinc-400" data-tip={g.decision}>
                  {g.fact}
                  {g.fromEvent && <span className="text-zinc-500"> · from the {g.fromEvent}</span>} · <DocLink doc={{ num: g.num, title: "", url: g.url, published: null }} />
                </p>
              </div>
              <span className="whitespace-nowrap text-[15px] font-black text-orange-400">{penaltyText(g)}</span>
            </div>
          ))}
          {live.map((i) => (
            <div key={i.key} className="flex items-center gap-2.5">
              <CodeChip code={codeOf(i.cars[0])} color={colorOf(i.cars[0])} />
              <p className="min-w-0 flex-1 text-[11px] text-zinc-300">
                {i.reason || "Race control"} <span className="text-zinc-500">· race control, not yet filed</span>
              </p>
              <span className="whitespace-nowrap text-[12px] font-black text-orange-400">{i.outcome.toLowerCase()}</span>
            </div>
          ))}
        </div>
        {event?.puReport && (
          <div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2 text-[10.5px]">
            <span className="rounded bg-zinc-800 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-300">Power units</span>
            <span className="flex-1 text-zinc-400">{puDrops ? `${puDrops} new-element penalt${puDrops === 1 ? "y" : "ies"} this weekend.` : "No new elements over the season limit so far."}</span>
            <DocLink doc={event.puReport} label={`Usage · Doc ${event.puReport.num}`} />
          </div>
        )}
      </Section>

      {(stewards.length > 0 || (event?.pending.length ?? 0) > 0) && (
        <Section title="Stewards this weekend">
          <div>
            {event?.pending.map((p) => (
              <div key={p.url} className="grid grid-cols-[44px_40px_minmax(0,1fr)_auto] items-center gap-2 border-t border-zinc-800/70 py-1 first:border-t-0">
                <span className="text-[10.5px] text-zinc-400">{p.published ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(Date.parse(p.published)) : ""}</span>
                <span className="text-[11px] font-black" style={{ color: colorOf(p.cars[0]) }}>
                  {p.cars.length ? codeOf(p.cars[0]) : "—"}
                </span>
                <p className="min-w-0 truncate text-[11px] text-zinc-200">
                  {p.title.replace(/^Summons\s*-\s*/i, "")} · <DocLink doc={p} />
                </p>
                <span className="whitespace-nowrap rounded border border-orange-500/60 px-1.5 py-px text-[10px] font-bold text-orange-300">Summoned</span>
              </div>
            ))}
            {stewards.map((s) => (
              <div key={s.url} className="grid grid-cols-[44px_40px_minmax(0,1fr)_auto] items-center gap-2 border-t border-zinc-800/70 py-1 first:border-t-0">
                <span className="text-[10.5px] text-zinc-400">{sessionShort(s)}</span>
                <span className="text-[11px] font-black" style={{ color: colorOf(s.car ?? s.cars[0]) }}>
                  {s.car || s.cars.length ? codeOf(s.car ?? s.cars[0], s.code) : "—"}
                </span>
                <p className="min-w-0 truncate text-[11px] text-zinc-200" data-tip={s.decision ?? s.title}>
                  {s.kind === "laps-deleted" ? "Lap times deleted for track limits" : (s.fact ?? s.title)} · <DocLink doc={s} />
                </p>
                <span className={cn("whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold", OUTCOME_STYLE[s.kind])}>{s.kind === "laps-deleted" ? "Track limits" : s.label || "Decision"}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="flex items-center gap-1.5 text-[9.5px] text-zinc-500">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Updated from the FIA documents about every 15 min, Thu–Sun{updatedAt && ` · last ${stamp.format(Date.parse(updatedAt))}`}.
        {event && (
          <a href={event.docsUrl} target="_blank" rel="noreferrer" className="ml-auto text-amber-300/90 hover:underline">
            All documents ›
          </a>
        )}
      </p>
    </div>
  );
}

function CodeChip({ code, color }: { code: string; color: string }) {
  return (
    <span className="w-10 shrink-0 rounded px-1 py-0.5 text-center text-[11px] font-black" style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}>
      {code}
    </span>
  );
}
