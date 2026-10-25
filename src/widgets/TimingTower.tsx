// Adapted from f1-dashboard's components/live/TimingTower.tsx: same look, but fed by
// the raw F1 topics (DriverRow) and with columns that drop out as the widget narrows.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { buildRows, qualifyingZones, sessionKind, type DriverRow, type SectorCell, type TimeCell } from "../data/derive";
import { carAt } from "../data/buffers";
import { trackNow, usePitwall } from "../data/store";
import { TYRE_COLORS, TYRE_SHORT, cn, isLightColor, segmentColor } from "../lib/format";
import { useSize, useTicker } from "../ui/hooks";
import { TyrePopover } from "./TyrePopover";

// One width per column, shared by the header and every cell so they line up exactly
// Sized so Speed · Pedals still fits a 13-column tower on a 16:10 laptop (~770 px)
const WIDE = { driver: 98, gap: 66, interval: 62, last: 80, best: 80, tyre: 54, pits: 38, sector: 62, live: 120, theo: 72 };
const COMPACT = { ...WIDE, driver: 94, gap: 62, last: 76, best: 76, tyre: 52 };
type Widths = typeof WIDE;
const PAD = 16; // row padding, px-2 each side

interface Columns {
  w: Widths;
  gap: boolean;
  interval: boolean;
  sectors: boolean;
  live: boolean;
  theo: boolean;
  pits: boolean;
}

/** Add columns in priority order while they fit the widget's width */
function columnsFor(width: number, isRace: boolean): Columns {
  const w = width < 480 ? COMPACT : WIDE;
  let used = PAD + w.driver + w.last + w.best + w.tyre;
  const fits = (px: number) => (width >= used + px ? ((used += px), true) : false);
  const gap = fits(w.gap);
  const interval = gap && fits(w.interval);
  const pits = isRace && interval && fits(w.pits);
  const sectors = interval && fits(3 * w.sector);
  const live = sectors && fits(w.live);
  const theo = !isRace && live && fits(w.theo);
  return { w, gap, interval, sectors, live, theo, pits };
}

const col = (px: number) => ({ width: px, flex: "none" as const });

export function TimingTower() {
  const live = usePitwall((s) => s.live);
  const selected = usePitwall((s) => s.selected);
  const toggleSelected = usePitwall((s) => s.toggleSelected);
  // Rebuild only when a topic buildRows reads changes (unchanged topics keep their reference)
  const rows = useMemo(
    () => buildRows(live),
    [live.TimingData, live.DriverList, live.TimingAppData, live.TimingStats, live.SessionInfo]
  );
  const kind = sessionKind(live.SessionInfo);
  const isRace = kind === "race";
  const part = live.TimingData?.SessionPart ?? 0;
  const zones = kind === "qualifying" ? qualifyingZones(part, rows.length) : null;
  const [ref, size] = useSize<HTMLDivElement>();
  const cols = columnsFor(size.width, isRace);
  const prevPositions = useRef(new Map<string, number>());
  const [tyreFor, setTyreFor] = useState<{ num: string; anchor: DOMRect } | null>(null);

  useEffect(() => {
    for (const r of rows) prevPositions.current.set(r.num, r.position);
  }, [rows]);

  const onTyreClick = useCallback((num: string, anchor: DOMRect) => {
    setTyreFor((open) => (open?.num === num ? null : { num, anchor }));
  }, []);
  const tyreRow = tyreFor && rows.find((r) => r.num === tyreFor.num);

  if (!rows.length) {
    return (
      <div ref={ref} className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Waiting for timing data
      </div>
    );
  }

  const { w } = cols;
  return (
    <div ref={ref} className="flex h-full flex-col overflow-hidden font-f1">
      {/* 22 px so the tower plus N rows of 30 px fills whole grid rows (see layout/defaults.ts) */}
      <div className="flex h-[22px] shrink-0 items-center border-b border-zinc-800 bg-zinc-900/90 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        <span style={col(w.driver)} className="pl-1">Driver</span>
        {cols.interval && <span style={col(w.interval)} className="pr-2 text-right">Int</span>}
        {cols.gap && <span style={col(w.gap)} className="pr-2 text-right">Gap</span>}
        <span style={col(w.last)} className="pr-3 text-right">Last</span>
        <span style={col(w.best)} className="pr-3 text-right">Best</span>
        <span style={col(w.tyre)} className="pl-2">Tyre</span>
        {cols.pits && <span style={col(w.pits)} className="text-center">Pit</span>}
        {cols.sectors &&
          ["S1", "S2", "S3"].map((s) => (
            <span key={s} style={col(w.sector)} className="pl-2">
              {s}
            </span>
          ))}
        {cols.live && <span style={col(w.live)} className="pl-2">Speed · Pedals</span>}
        {cols.theo && <span style={col(w.theo)} className="pr-2 text-right">Theo</span>}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto" onScroll={() => setTyreFor(null)}>
        {rows.map((row) => (
          <TimingRow
            key={row.num}
            row={row}
            cols={cols}
            isRace={isRace}
            selected={selected.includes(row.num)}
            tyreOpen={tyreFor?.num === row.num}
            inDropZone={!!zones && row.position >= zones.dropZoneStart && row.position < zones.knockoutStart}
            eliminated={!!zones && (row.knockedOut || row.position >= zones.knockoutStart)}
            previousPosition={prevPositions.current.get(row.num)}
            onClick={toggleSelected}
            onTyreClick={onTyreClick}
          />
        ))}
      </div>
      {tyreFor && tyreRow && (
        <TyrePopover row={tyreRow} anchor={tyreFor.anchor} onClose={() => setTyreFor(null)} />
      )}
    </div>
  );
}

interface RowProps {
  row: DriverRow;
  cols: Columns;
  isRace: boolean;
  selected: boolean;
  tyreOpen: boolean;
  inDropZone: boolean;
  eliminated: boolean;
  previousPosition: number | undefined;
  onClick: (num: string) => void;
  onTyreClick: (num: string, anchor: DOMRect) => void;
}

const TimingRow = memo(function TimingRow({
  row,
  cols,
  isRace,
  selected,
  tyreOpen,
  inDropZone,
  eliminated,
  previousPosition,
  onClick,
  onTyreClick,
}: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isOut = row.status === "OUT" || row.status === "STOPPED";
  const knockedOut = eliminated || row.status === "KO";
  const positionChange = previousPosition !== undefined ? previousPosition - row.position : 0;
  const { w } = cols;

  useEffect(() => {
    if (!rowRef.current || positionChange === 0) return;
    const base = knockedOut ? "rgba(69, 10, 10, 0.5)" : inDropZone ? "rgba(67, 20, 7, 0.6)" : "rgba(0, 0, 0, 0)";
    animate(rowRef.current, {
      backgroundColor: [positionChange > 0 ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)", base],
      duration: 1200,
      ease: "outQuad",
    });
  }, [row.position, positionChange, inDropZone, knockedOut]);

  return (
    <div
      ref={rowRef}
      onClick={() => onClick(row.num)}
      className={cn(
        "flex h-[30px] shrink-0 cursor-pointer items-center border-b border-zinc-800/50 px-2 transition-colors duration-150",
        inDropZone && !knockedOut && "bg-orange-950/60",
        knockedOut && "bg-red-950/50 opacity-70",
        selected && !inDropZone && !knockedOut && "bg-zinc-800/70 ring-1 ring-inset ring-zinc-600",
        selected && inDropZone && "bg-orange-900/70 ring-1 ring-inset ring-orange-500",
        isOut && !knockedOut && "opacity-50",
        !selected && !isOut && !inDropZone && !knockedOut && "hover:bg-zinc-800/40"
      )}
    >
      <div style={col(w.driver)} className="flex items-center">
        <span
          className={cn(
            "flex h-[22px] w-[24px] items-center justify-center rounded-l-md text-[12px] font-black",
            !inDropZone && !knockedOut && row.position === 1 && "bg-yellow-500 text-black",
            !inDropZone && !knockedOut && row.position === 2 && "bg-zinc-400 text-black",
            !inDropZone && !knockedOut && row.position === 3 && "bg-amber-600 text-white",
            !inDropZone && !knockedOut && row.position > 3 && "bg-zinc-800 text-zinc-200",
            inDropZone && !knockedOut && "bg-orange-600 text-black",
            knockedOut && "bg-red-700 text-white"
          )}
        >
          {row.position}
        </span>
        <span
          className="flex h-[22px] w-[42px] items-center justify-center rounded-r-md text-[12px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: row.color, color: isLightColor(row.color) ? "#000" : "#fff" }}
          title={`${row.name} · ${row.team}`}
        >
          {row.tla}
        </span>
        {isRace && row.grid && row.grid !== row.position && (
          <span
            title={`Started P${row.grid}`}
            className={cn(
              "ml-1 flex h-[18px] min-w-[22px] items-center justify-center rounded px-0.5 text-[10px] font-bold",
              row.grid > row.position ? "bg-green-600/80 text-white" : "bg-red-600/80 text-white"
            )}
          >
            {row.grid > row.position ? "▲" : "▼"}
            {Math.abs(row.grid - row.position)}
          </span>
        )}
      </div>

      {cols.interval && (
        <span
          style={col(w.interval)}
          className={cn(
            "pr-2 text-right text-[13px] font-bold tabular-nums",
            row.position === 1 ? "text-zinc-500" : row.catching ? "text-green-400" : "text-yellow-400"
          )}
        >
          {row.position === 1 ? "—" : row.interval}
        </span>
      )}
      {cols.gap && (
        <span
          style={col(w.gap)}
          className={cn("pr-2 text-right text-[13px] font-bold tabular-nums", row.position === 1 ? "text-zinc-500" : "text-zinc-100")}
        >
          {row.position === 1 && !row.gap.startsWith("+") ? (isRace ? row.gap || "Leader" : "—") : row.gap}
        </span>
      )}

      <div style={col(w.last)} className="pr-3 text-right">
        {knockedOut ? (
          <Badge bg="#dc2626" fg="#fff">KO</Badge>
        ) : row.status === "PIT" ? (
          <Badge bg="#f59e0b" fg="#000">IN PIT</Badge>
        ) : row.status === "PIT OUT" ? (
          <Badge bg="#38bdf8" fg="#000">PIT OUT</Badge>
        ) : isOut ? (
          <Badge bg="#ef4444" fg="#fff">{row.status === "STOPPED" ? "STOP" : "OUT"}</Badge>
        ) : (
          <Time cell={row.lastLap} />
        )}
      </div>
      <span
        style={col(w.best)}
        className={cn("pr-3 text-right text-[14px] font-bold tabular-nums", row.bestLap.ob ? "text-purple-400" : "text-zinc-100")}
      >
        {row.bestLap.value}
      </span>

      <div style={col(w.tyre)} className="pl-1">
        {row.tyre && (
          <button
            data-tyre-button
            onClick={(e) => {
              e.stopPropagation();
              onTyreClick(row.num, e.currentTarget.getBoundingClientRect());
            }}
            className={cn(
              "flex h-[24px] items-center gap-1.5 rounded-md px-1 transition-colors",
              tyreOpen ? "bg-zinc-700 ring-1 ring-zinc-500" : "hover:bg-zinc-800"
            )}
            title="Tyre history"
          >
            <TyreDot compound={row.tyre.compound} />
            <span className="w-[16px] text-left text-[13px] font-bold tabular-nums text-zinc-100">{row.tyre.age}</span>
          </button>
        )}
      </div>
      {cols.pits && (
        <span style={col(w.pits)} className="text-center text-[13px] font-bold tabular-nums text-zinc-300">
          {row.pitStops || ""}
        </span>
      )}

      {cols.sectors && row.sectors.map((s, i) => <Sector key={i} cell={s} width={w.sector} />)}
      {cols.live && <LiveCells num={row.num} width={w.live} />}
      {cols.theo && (
        <span style={col(w.theo)} className="pr-2 text-right text-[13px] font-bold tabular-nums text-zinc-300">
          {row.theoretical}
        </span>
      )}
    </div>
  );
});

function Badge({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span className="inline-block rounded px-1.5 py-[3px] text-[10px] font-bold leading-none" style={{ backgroundColor: bg, color: fg }}>
      {children}
    </span>
  );
}

function Time({ cell }: { cell: TimeCell }) {
  return (
    <span
      className={cn("text-[14px] font-bold tabular-nums", cell.ob ? "text-purple-400" : cell.pb ? "text-green-400" : "text-zinc-100")}
    >
      {cell.value}
    </span>
  );
}

export function TyreDot({ compound, small }: { compound: string; small?: boolean }) {
  const color = TYRE_COLORS[compound] ?? "#808080";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-black leading-none",
        small ? "h-4 w-4 text-[9px]" : "h-[20px] w-[20px] text-[11px]"
      )}
      style={{ backgroundColor: color, color: compound === "HARD" || compound === "MEDIUM" ? "#000" : "#fff" }}
    >
      {TYRE_SHORT[compound] ?? "?"}
    </span>
  );
}

/** Sector time with its mini-sectors underneath (one bar per timing segment) */
function Sector({ cell, width }: { cell: SectorCell; width: number }) {
  const segments = cell.segments.length ? cell.segments : Array<number>(8).fill(0);
  return (
    <div style={col(width)} className="flex flex-col justify-center gap-[3px] pl-2 pr-1">
      <span
        className={cn(
          "text-right text-[13px] font-bold leading-none tabular-nums",
          !cell.value && "text-zinc-600",
          cell.ob && "text-purple-400",
          cell.pb && !cell.ob && "text-green-400",
          !cell.ob && !cell.pb && cell.value && "text-yellow-400"
        )}
      >
        {cell.value || "—"}
      </span>
      <div className="flex gap-[2px]">
        {segments.map((status, i) => (
          <div key={i} className="h-[4px] flex-1 rounded-[1px]" style={{ backgroundColor: segmentColor(status) }} />
        ))}
      </div>
    </div>
  );
}

/** Live speed + throttle/brake from CarData, refreshed on a ticker */
function LiveCells({ num, width }: { num: string; width: number }) {
  useTicker(5);
  const c = carAt(num, trackNow());
  return (
    <div style={col(width)} className="flex items-center gap-2 pl-2">
      <span className="w-[56px] shrink-0 text-right text-[13px] font-bold tabular-nums text-zinc-100">
        {c ? c.speed : "—"}
        <span className="ml-0.5 text-[9px] font-semibold text-zinc-500">km/h</span>
      </span>
      <div className="flex w-[48px] flex-col gap-[3px]">
        <div className="h-[5px] overflow-hidden rounded-sm bg-zinc-800">
          <div className="h-full bg-green-500" style={{ width: `${c?.throttle ?? 0}%` }} />
        </div>
        <div className="h-[5px] overflow-hidden rounded-sm bg-zinc-800">
          <div className="h-full bg-red-500" style={{ width: `${c?.brake ?? 0}%` }} />
        </div>
      </div>
    </div>
  );
}
