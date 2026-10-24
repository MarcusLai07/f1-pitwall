// Per-driver tyre history, opened from the tyre cell in the timing tower (replaces the
// old Tyre strategy widget). Adapted from f1-dashboard's TyreHistoryPopover.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DriverRow } from "../data/derive";
import { pitStops, usePits, type PitStop } from "../data/pits";
import { TYRE_COLORS, cn, formatDuration, isLightColor } from "../lib/format";
import { currentScale } from "../ui/scale";
import { TyreDot } from "./TimingTower";

const NAMES: Record<string, string> = {
  SOFT: "Soft",
  MEDIUM: "Medium",
  HARD: "Hard",
  INTERMEDIATE: "Inter",
  WET: "Wet",
};

const WIDTH = 300;
const MARGIN = 8;

export function TyrePopover({ row, anchor, onClose }: { row: DriverRow; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // The anchor rect is in screen pixels; the popover lives in the zoomed UI (ui/scale.ts)
  const z = currentScale();
  const box = { left: anchor.left / z, right: anchor.right / z, top: anchor.top / z };
  const viewW = window.innerWidth / z;
  const viewH = window.innerHeight / z;
  const [pos, setPos] = useState({ left: box.right + MARGIN, top: box.top - 6 });

  // Open beside the tyre, flipping left/up when it would leave the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = box.right + MARGIN;
    if (left + WIDTH > viewW - MARGIN) left = Math.max(MARGIN, box.left - WIDTH - MARGIN);
    let top = box.top - 6;
    if (top + h > viewH - MARGIN) top = Math.max(MARGIN, viewH - MARGIN - h);
    setPos({ left, top });
  }, [anchor, row.stints.length]); // box/view derive from anchor and the window

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-tyre-button]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Laps run on each set; StartLaps is the age the set already had when fitted
  let lap = 1;
  const stints = row.stints.map((s, i) => {
    const laps = Math.max(0, (s.TotalLaps ?? 0) - (s.StartLaps ?? 0));
    const from = lap;
    lap += laps;
    return {
      n: i + 1,
      compound: s.Compound ?? "UNKNOWN",
      laps,
      from,
      to: from + laps - 1,
      age: s.TotalLaps ?? 0,
      usedLaps: s.StartLaps ?? 0,
      isNew: s.New === "true",
      best: s.LapTime,
      current: i === row.stints.length - 1,
    };
  });
  const totalLaps = Math.max(1, stints.reduce((a, s) => a + s.laps, 0));

  // Pit stops seen while watching, matched to the stint they ended (by in-lap)
  usePits((st) => st.version);
  const stops = pitStops(row.num);
  // Closest pairs first, so each stop lands on the stint change nearest its in-lap
  const used = new Set<PitStop>();
  const stopAfter: (PitStop | undefined)[] = stints.map(() => undefined);
  const pairs = stops.flatMap((stop) =>
    stints.slice(0, -1).map((st, i) => ({ stop, i, d: Math.abs(stop.lap - st.to) }))
  );
  for (const { stop, i } of pairs.filter((x) => x.d <= 2).sort((a, b) => a.d - b.d || b.i - a.i)) {
    if (used.has(stop) || stopAfter[i]) continue;
    stopAfter[i] = stop;
    used.add(stop);
  }
  const inPitNow = stops.find((p) => p.outAt === undefined && !used.has(p));
  const laneTotal = stops.reduce((a, p) => a + (p.laneSec ?? 0), 0);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 flex flex-col rounded-xl border border-zinc-700 bg-zinc-950/95 font-f1 shadow-2xl backdrop-blur"
      // Wet races can mean many sets: stay inside the window and scroll the list
      style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: viewH - 2 * MARGIN }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span
          className="rounded px-2 py-0.5 text-[13px] font-bold"
          style={{ backgroundColor: row.color, color: isLightColor(row.color) ? "#000" : "#fff" }}
        >
          {row.tla}
        </span>
        <span className="text-[13px] font-semibold text-zinc-300">Tyre history</span>
        <button
          onClick={onClose}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-lg leading-none text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="flex gap-4 px-3 pt-2.5 text-[12px]">
        <Stat label="Pit stops" value={String(row.pitStops)} />
        {laneTotal > 0 && <Stat label="In pit lane" value={`${laneTotal.toFixed(1)} s`} />}
        <Stat label="Laps" value={String(row.laps)} />
        {row.tyre && <Stat label="Current set" value={`${NAMES[row.tyre.compound] ?? row.tyre.compound} · ${row.tyre.age} laps`} />}
      </div>

      {stints.length > 0 ? (
        <>
          {/* Proportional strip: one segment per set */}
          <div className="mx-3 mt-3 flex h-[10px] gap-[2px] overflow-hidden rounded-full">
            {stints.map((s) => (
              <div
                key={s.n}
                style={{
                  width: `${(s.laps / totalLaps) * 100}%`,
                  minWidth: 6,
                  backgroundColor: TYRE_COLORS[s.compound] ?? "#52525b",
                  opacity: s.isNew ? 1 : 0.6,
                }}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pt-2.5">
            {stints.map((s, i) => (
              <div key={s.n} className="space-y-1">
                <div
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
                    s.current ? "bg-zinc-800 ring-1 ring-zinc-600" : "bg-zinc-900"
                  )}
                >
                  <TyreDot compound={s.compound} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[13px] font-bold text-zinc-100">{NAMES[s.compound] ?? s.compound}</span>
                      <span className={cn("text-[11px] font-semibold", s.isNew ? "text-green-400" : "text-zinc-400")}>
                        {s.isNew ? "new" : `used${s.usedLaps ? ` +${s.usedLaps}` : ""}`}
                      </span>
                      {s.current && <span className="text-[11px] font-semibold text-sky-400">now</span>}
                    </div>
                    <div className="text-[11px] tabular-nums text-zinc-400">
                      {s.laps ? `Laps ${s.from}–${s.to}` : "No laps yet"}
                      {s.best ? ` · best ${s.best}` : ""}
                    </div>
                  </div>
                  <span className="text-right text-[14px] font-bold tabular-nums text-zinc-100">
                    {s.laps}
                    <span className="ml-0.5 text-[10px] font-semibold text-zinc-500">laps</span>
                  </span>
                </div>
                {i < stints.length - 1 && <PitRow stop={stopAfter[i]} />}
                {i === stints.length - 1 && inPitNow && <PitRow stop={inPitNow} />}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="px-3 py-4 text-center text-[12px] text-zinc-400">No stints yet</p>
      )}
    </div>,
    document.getElementById("pitwall-root") ?? document.body
  );
}

/** The stop between two stints: pit-lane time (official) and time stood still (estimated) */
function PitRow({ stop }: { stop?: PitStop }) {
  const garage = stop?.outAt !== undefined && stop.outAt - stop.inAt > 60_000;
  return (
    <div className="flex items-center gap-2 px-2 text-[11px] tabular-nums text-zinc-400">
      <span className="h-px w-3 bg-zinc-700" />
      <span className="rounded bg-zinc-800 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-zinc-300">Pit</span>
      {!stop ? (
        <span className="text-zinc-500" title="This stop happened before Pit Wall started watching">not timed</span>
      ) : (
        <>
          <span>Lap {stop.lap}</span>
          {stop.outAt === undefined ? (
            <span className="font-semibold text-amber-400">in the pit lane now</span>
          ) : garage ? (
            <span>garage {formatDuration(stop.outAt - stop.inAt)}</span>
          ) : (
            <>
              {stop.laneSec !== undefined && (
                <span title="Pit lane time from the timing feed">
                  <b className="text-zinc-100">{stop.laneSec.toFixed(1)} s</b> pit lane
                </span>
              )}
              {stop.stationarySec !== undefined && (
                <span title="Estimated from the car's speed data (±0.3 s)">
                  <b className="text-zinc-100">≈{stop.stationarySec.toFixed(1)} s</b> stopped
                </span>
              )}
            </>
          )}
        </>
      )}
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-bold text-zinc-100">{value}</span>
    </div>
  );
}
