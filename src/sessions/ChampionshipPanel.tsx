// The championship at a glance: drivers' and constructors' standings with the title race
// (who can still win, and when it's clinched), and the team + driver roster. Pops out of
// the trophy button next to Layout.

import { animate } from "animejs";
import { useEffect, useRef, useState } from "react";
import { cn, isLightColor } from "../lib/format";
import { PopoverHeader } from "../ui/Popover";
import { ensureSeason } from "./schedule";
import { driverResults, TEAMS_2026, useChampionship, type ConstructorStanding, type DriverStanding, type RaceResult, type TitleRace } from "./championship";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Tab = "drivers" | "constructors" | "teams";

export function ChampionshipPanel({ onClose }: { onClose: () => void }) {
  const { loading, error, standings, drivers, constructors } = useChampionship();
  const [tab, setTab] = useState<Tab>("drivers");
  const [expanded, setExpanded] = useState<string | null>(null); // driverId whose results are open
  const listRef = useRef<HTMLDivElement>(null);

  // The title maths needs the season's remaining races
  useEffect(() => ensureSeason(standings?.season ?? new Date().getFullYear()), [standings?.season]);

  // Rows slide in on a tab change
  useEffect(() => {
    const rows = listRef.current?.querySelectorAll("[data-row]");
    if (!rows?.length || reducedMotion()) return;
    animate(rows, { opacity: [0, 1], translateX: [10, 0], delay: (_el, i) => (i ?? 0) * 18, duration: 260, ease: "outCubic" });
  }, [tab, standings]);

  const race = tab === "constructors" ? constructors : drivers;

  return (
    <>
      <PopoverHeader
        title="Championship"
        detail={standings ? `${standings.season} · after round ${standings.round}` : undefined}
        right={
          <div className="flex overflow-hidden rounded-md border border-zinc-800">
            {(["drivers", "constructors", "teams"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn("px-2.5 py-0.5 text-[11px] font-bold capitalize", t === tab ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
              >
                {t}
              </button>
            ))}
          </div>
        }
        onClose={onClose}
      />

      {error && !standings && <p className="p-5 text-center text-[12px] text-amber-400">Couldn't load standings. {error}.</p>}
      {loading && !standings && <p className="p-5 text-center text-[12px] text-zinc-500">Loading standings…</p>}

      {standings && race && tab !== "teams" && <TitleLine race={race} what={tab === "constructors" ? "constructor" : "driver"} />}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "teams" ? (
          <TeamRoster constructors={standings?.constructors ?? []} />
        ) : tab === "constructors" ? (
          standings?.constructors.map((c) => <ConstructorRow key={c.name} c={c} canWin={constructors?.canWin.has(c.position) ?? true} />)
        ) : (
          standings?.drivers.map((d) => (
            <DriverRow key={d.id || d.code} d={d} canWin={drivers?.canWin.has(d.position) ?? true} open={expanded === d.id} onToggle={() => setExpanded((x) => (x === d.id ? null : d.id))} />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
        Standings from Jolpica (Ergast) · the title race is an estimate (max points left, no tie-breaks)
      </div>
    </>
  );
}

function TitleLine({ race, what }: { race: TitleRace<{ position: number; points: number }>; what: string }) {
  const contenders = race.canWin.size;
  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px]">
      {race.clinched ? (
        <span className="font-bold text-amber-300">🏆 Title decided — the leader can't be caught.</span>
      ) : (
        <span className="text-zinc-300">
          <b className="text-zinc-100">{contenders}</b> {what}
          {contenders === 1 ? "" : "s"} can still win · <b className="text-zinc-100">{race.remaining}</b> pts left
          <span className="text-zinc-500"> ({race.races} race{race.races === 1 ? "" : "s"}{race.sprints ? `, ${race.sprints} sprint${race.sprints === 1 ? "" : "s"}` : ""})</span>
        </span>
      )}
    </div>
  );
}

// pos · number · code · name(1fr) · team · wins · points — fixed columns so every row lines up
const ROW_COLS = "grid-cols-[1.25rem_1.5rem_2.25rem_minmax(0,1fr)_7rem_2.5rem_2.75rem]";

function DriverRow({ d, canWin, open, onToggle }: { d: DriverStanding; canWin: boolean; open: boolean; onToggle: () => void }) {
  return (
    <div data-row className={cn("rounded-md", !canWin && "opacity-55", open && "bg-zinc-900/60")}>
      <button onClick={onToggle} aria-expanded={open} className={cn("grid w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-zinc-900", ROW_COLS)}>
        <span className="text-right text-[12px] font-bold tabular-nums text-zinc-500">{d.position}</span>
        <span className="flex h-5 w-6 items-center justify-center rounded text-[10px] font-black tabular-nums" style={{ background: d.color, color: isLightColor(d.color) ? "#000" : "#fff" }}>
          {d.number || d.code}
        </span>
        <span className="text-[12.5px] font-bold text-zinc-100">{d.code}</span>
        <span className="truncate text-[12px] text-zinc-400">{d.name}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <i className="h-3 w-0.5 shrink-0 rounded" style={{ background: d.color }} />
          <span className="truncate text-[11px] text-zinc-500">{d.team}</span>
        </span>
        <span className="text-right text-[10px] text-zinc-500">{d.wins ? `${d.wins}W` : ""}</span>
        <span className="flex items-center justify-end gap-1 text-[13px] font-black tabular-nums text-zinc-100">
          {d.points}
          <span className={cn("text-[8px] text-zinc-600 transition-transform", open && "rotate-180")}>▾</span>
        </span>
      </button>
      {open && <DriverResults id={d.id} />}
    </div>
  );
}

function DriverResults({ id }: { id: string }) {
  const [state, setState] = useState<RaceResult[] | "loading" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    driverResults(id)
      .then((r) => alive && setState(r))
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [id]);
  if (state === "loading") return <p className="px-3 pb-2 text-[11px] text-zinc-500">Loading results…</p>;
  if (state === "error") return <p className="px-3 pb-2 text-[11px] text-amber-400">Couldn't load this driver's results.</p>;
  if (!state.length) return <p className="px-3 pb-2 text-[11px] text-zinc-500">No results yet.</p>;
  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2 pt-0.5">
      {state.map((r) => (
        <span
          key={r.round}
          data-tip={`Round ${r.round} · ${r.name} · ${r.dnf ? r.status : `P${r.position} (from P${r.grid})`} · ${r.points} pts`}
          className={cn(
            "flex w-[38px] flex-col items-center rounded border px-1 py-0.5 tabular-nums",
            r.dnf
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : r.position === 1
                ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                : (r.position ?? 99) <= 3
                  ? "border-zinc-400/30 bg-zinc-400/10 text-zinc-100"
                  : r.points > 0
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-400"
          )}
        >
          <span className="text-[8px] uppercase text-zinc-500">{r.name.slice(0, 3)}</span>
          <span className="text-[11px] font-bold">{r.dnf ? "DNF" : `P${r.position}`}</span>
        </span>
      ))}
    </div>
  );
}

function ConstructorRow({ c, canWin }: { c: ConstructorStanding; canWin: boolean }) {
  return (
    <div data-row className={cn("grid grid-cols-[1.25rem_0.25rem_minmax(0,1fr)_2.5rem_2.75rem] items-center gap-2 rounded-md px-2 py-1", !canWin && "opacity-55")}>
      <span className="text-right text-[12px] font-bold tabular-nums text-zinc-500">{c.position}</span>
      <i className="h-4 w-1 rounded" style={{ background: c.color }} />
      <span className="truncate text-[12.5px] font-semibold text-zinc-100">{c.name}</span>
      <span className="text-right text-[10px] text-zinc-500">{c.wins ? `${c.wins}W` : ""}</span>
      <span className="text-right text-[13px] font-black tabular-nums text-zinc-100">{c.points}</span>
    </div>
  );
}

function TeamRoster({ constructors }: { constructors: ConstructorStanding[] }) {
  const pts = new Map(constructors.map((c) => [c.name, { points: c.points, position: c.position }]));
  const order = [...TEAMS_2026].sort((a, b) => (pts.get(a.name)?.position ?? 99) - (pts.get(b.name)?.position ?? 99));
  return (
    <div className="grid gap-1.5">
      {order.map((t) => {
        const p = pts.get(t.name);
        return (
          <div data-row key={t.name} className="flex items-center gap-2.5 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5">
            <i className="h-8 w-1 shrink-0 rounded" style={{ background: t.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-bold text-zinc-100">{t.name}</span>
                <span className="text-[10px] text-zinc-500">{t.engine}</span>
              </div>
              <div className="truncate text-[11px] text-zinc-400">
                {t.drivers.join(" · ")} <span className="text-zinc-600">· {t.base}</span>
              </div>
            </div>
            {p && (
              <div className="shrink-0 text-right">
                <div className="text-[13px] font-black tabular-nums text-zinc-100">{p.points}</div>
                <div className="text-[9px] uppercase tracking-wider text-zinc-500">P{p.position}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
