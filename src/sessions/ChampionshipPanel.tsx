// The championship at a glance: drivers' and constructors' standings with the title race
// (who can still win, and when it's clinched), and the team + driver roster. Pops out of
// the trophy button next to Layout.

import { animate } from "animejs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn, isLightColor } from "../lib/format";
import { ensureSeason } from "./schedule";
import { TEAMS_2026, useChampionship, type ConstructorStanding, type DriverStanding, type TitleRace } from "./championship";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Tab = "drivers" | "constructors" | "teams";

export function ChampionshipPanel({ closing, onClose, onClosed }: { closing: boolean; onClose: () => void; onClosed: () => void }) {
  const { loading, error, standings, drivers, constructors } = useChampionship();
  const [tab, setTab] = useState<Tab>("drivers");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The title maths needs the season's remaining races
  useEffect(() => ensureSeason(standings?.season ?? new Date().getFullYear()), [standings?.season]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || reducedMotion()) return;
    animate(el, { opacity: [0, 1], translateY: [-10, 0], scale: [0.96, 1], duration: 300, ease: "outExpo" });
  }, []);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  useEffect(() => {
    if (!closing) return;
    const el = panelRef.current;
    if (!el || reducedMotion()) return closedRef.current();
    animate(el, { opacity: 0, translateY: -8, scale: 0.97, duration: 160, ease: "inQuad", onComplete: () => closedRef.current() });
  }, [closing]);

  // Rows slide in on a tab change
  useEffect(() => {
    const rows = listRef.current?.querySelectorAll("[data-row]");
    if (!rows?.length || reducedMotion()) return;
    animate(rows, { opacity: [0, 1], translateX: [10, 0], delay: (_el, i) => (i ?? 0) * 18, duration: 260, ease: "outCubic" });
  }, [tab, standings]);

  const race = tab === "constructors" ? constructors : drivers;

  return (
    <div
      ref={panelRef}
      style={{ transformOrigin: "top right" }}
      className="absolute right-0 top-9 z-50 flex max-h-[min(640px,82vh)] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/97 font-f1 shadow-2xl shadow-black/60 backdrop-blur"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-200">Championship</span>
        {standings && <span className="text-[11px] text-zinc-500">{standings.season} · after round {standings.round}</span>}
        <div className="ml-auto flex overflow-hidden rounded-md border border-zinc-800">
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
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">
          ×
        </button>
      </div>

      {error && !standings && <p className="p-5 text-center text-[12px] text-amber-400">Couldn't load standings. {error}.</p>}
      {loading && !standings && <p className="p-5 text-center text-[12px] text-zinc-500">Loading standings…</p>}

      {standings && race && tab !== "teams" && <TitleLine race={race} what={tab === "constructors" ? "constructor" : "driver"} />}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "teams" ? (
          <TeamRoster constructors={standings?.constructors ?? []} />
        ) : tab === "constructors" ? (
          standings?.constructors.map((c) => <ConstructorRow key={c.name} c={c} canWin={constructors?.canWin.has(c.position) ?? true} eliminated={!constructors?.canWin.has(c.position)} live={!!standings} />)
        ) : (
          standings?.drivers.map((d) => <DriverRow key={d.code + d.position} d={d} canWin={drivers?.canWin.has(d.position) ?? true} />)
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
        Standings from Jolpica (Ergast) · the title race is an estimate (max points left, no tie-breaks)
      </div>
    </div>
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

function Pos({ n }: { n: number }) {
  return <span className="w-5 shrink-0 text-right text-[12px] font-bold tabular-nums text-zinc-500">{n}</span>;
}

function DriverRow({ d, canWin }: { d: DriverStanding; canWin: boolean }) {
  return (
    <div data-row className={cn("flex items-center gap-2 rounded-md px-2 py-1", !canWin && "opacity-55")}>
      <Pos n={d.position} />
      <span className="flex h-5 w-6 shrink-0 items-center justify-center rounded text-[10px] font-black tabular-nums" style={{ background: d.color, color: isLightColor(d.color) ? "#000" : "#fff" }}>
        {d.number || d.code}
      </span>
      <span className="w-10 shrink-0 text-[12.5px] font-bold text-zinc-100">{d.code}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-400">{d.name}</span>
      <i className="h-2.5 w-0.5 shrink-0 rounded" style={{ background: d.color }} />
      <span className="w-16 truncate text-[11px] text-zinc-500">{d.team}</span>
      {d.wins > 0 && <span className="w-9 text-right text-[10px] text-zinc-500">{d.wins} win{d.wins === 1 ? "" : "s"}</span>}
      <span className="w-12 text-right text-[13px] font-black tabular-nums text-zinc-100">{d.points}</span>
    </div>
  );
}

function ConstructorRow({ c, canWin }: { c: ConstructorStanding; canWin: boolean; eliminated: boolean; live: boolean }) {
  return (
    <div data-row className={cn("flex items-center gap-2 rounded-md px-2 py-1", !canWin && "opacity-55")}>
      <Pos n={c.position} />
      <i className="h-4 w-1 shrink-0 rounded" style={{ background: c.color }} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-zinc-100">{c.name}</span>
      {c.wins > 0 && <span className="w-9 text-right text-[10px] text-zinc-500">{c.wins} win{c.wins === 1 ? "" : "s"}</span>}
      <span className="w-12 text-right text-[13px] font-black tabular-nums text-zinc-100">{c.points}</span>
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
