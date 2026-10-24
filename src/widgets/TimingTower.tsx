// Adapted from f1-dashboard's components/live/TimingTower.tsx: same look, but fed by
// the raw F1 topics (DriverRow) and with columns that drop out as the widget narrows.

import { memo, useEffect, useMemo, useRef } from "react";
import { animate } from "animejs";
import { buildRows, qualifyingZones, sessionKind, type DriverRow, type SectorCell, type TimeCell } from "../data/derive";
import { carAt } from "../data/buffers";
import { trackNow, usePitwall } from "../data/store";
import { TYRE_COLORS, TYRE_SHORT, cn, isLightColor, segmentColor } from "../lib/format";
import { useSize, useTicker } from "../ui/hooks";

interface Columns {
  gap: boolean;
  interval: boolean;
  sectors: boolean;
  minis: boolean;
  live: boolean;
  theo: boolean;
  pits: boolean;
}

// Breakpoints follow the column min-widths below (driver 100, gap 62, int 58,
// last/best 70, tyre 52, sector 54 or 110 with minis, live 118, theo 64, + padding)
function columnsFor(width: number, isRace: boolean): Columns {
  return {
    gap: width >= 380,
    interval: width >= 450,
    sectors: width >= 640,
    minis: !isRace && width >= 900,
    live: width >= 1000,
    theo: !isRace && width >= 1120,
    pits: isRace && width >= 760,
  };
}

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

  useEffect(() => {
    for (const r of rows) prevPositions.current.set(r.num, r.position);
  }, [rows]);

  if (!rows.length) {
    return (
      <div ref={ref} className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Waiting for timing data
      </div>
    );
  }

  return (
    <div ref={ref} className="flex h-full flex-col overflow-hidden font-f1">
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
        <span className="min-w-[100px] shrink-0 pl-1">Driver</span>
        {cols.gap && <span className="min-w-[62px] shrink-0 pr-2 text-right">{isRace ? "Gap" : "Gap"}</span>}
        {cols.interval && <span className="min-w-[58px] shrink-0 pr-2 text-right">Int</span>}
        <span className="min-w-[70px] shrink-0 pr-3 text-right">Last</span>
        <span className="min-w-[70px] shrink-0 pr-3 text-right">Best</span>
        <span className="min-w-[52px] shrink-0 text-center">Tyre</span>
        {cols.pits && <span className="min-w-[34px] shrink-0 text-center">Pit</span>}
        {cols.sectors &&
          ["S1", "S2", "S3"].map((s) => (
            <span key={s} className={cn("shrink-0 pl-2", cols.minis ? "min-w-[110px]" : "min-w-[54px]")}>
              {s}
            </span>
          ))}
        {cols.live && <span className="min-w-[118px] shrink-0 pl-3">Speed · Pedals</span>}
        {cols.theo && <span className="min-w-[64px] shrink-0 pr-2 text-right">Theo</span>}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {rows.map((row) => (
          <TimingRow
            key={row.num}
            row={row}
            cols={cols}
            isRace={isRace}
            selected={selected.includes(row.num)}
            inDropZone={!!zones && row.position >= zones.dropZoneStart && row.position < zones.knockoutStart}
            eliminated={!!zones && (row.knockedOut || row.position >= zones.knockoutStart)}
            previousPosition={prevPositions.current.get(row.num)}
            onClick={() => toggleSelected(row.num)}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  row: DriverRow;
  cols: Columns;
  isRace: boolean;
  selected: boolean;
  inDropZone: boolean;
  eliminated: boolean;
  previousPosition: number | undefined;
  onClick: () => void;
}

const TimingRow = memo(function TimingRow({ row, cols, isRace, selected, inDropZone, eliminated, previousPosition, onClick }: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isOut = row.status === "OUT" || row.status === "STOPPED";
  const knockedOut = eliminated || row.status === "KO";
  const positionChange = previousPosition !== undefined ? previousPosition - row.position : 0;

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
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center border-b border-zinc-800/50 px-2 py-[3px] transition-colors duration-150",
        inDropZone && !knockedOut && "bg-orange-950/60",
        knockedOut && "bg-red-950/50 opacity-70",
        selected && !inDropZone && !knockedOut && "bg-zinc-800/70 ring-1 ring-inset ring-zinc-600",
        selected && inDropZone && "bg-orange-900/70 ring-1 ring-inset ring-orange-500",
        isOut && !knockedOut && "opacity-50",
        !selected && !isOut && !inDropZone && !knockedOut && "hover:bg-zinc-800/40"
      )}
    >
      <div className="flex min-w-[100px] shrink-0 items-center">
        <span
          className={cn(
            "flex h-[20px] w-[22px] items-center justify-center rounded-l-md text-[11px] font-black",
            !inDropZone && !knockedOut && row.position === 1 && "bg-yellow-500 text-black",
            !inDropZone && !knockedOut && row.position === 2 && "bg-zinc-400 text-black",
            !inDropZone && !knockedOut && row.position === 3 && "bg-amber-600 text-white",
            !inDropZone && !knockedOut && row.position > 3 && "bg-zinc-800 text-zinc-300",
            inDropZone && !knockedOut && "bg-orange-600 text-black",
            knockedOut && "bg-red-700 text-white"
          )}
        >
          {row.position}
        </span>
        <span
          className="flex h-[20px] items-center rounded-r-md px-1.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: row.color, color: isLightColor(row.color) ? "#000" : "#fff" }}
          title={`${row.name} · ${row.team}`}
        >
          {row.tla}
        </span>
        {isRace && positionChange !== 0 && (
          <span
            className={cn(
              "ml-1 flex h-[16px] min-w-[18px] items-center justify-center rounded px-0.5 text-[9px] font-bold text-white",
              positionChange > 0 ? "bg-green-600" : "bg-red-600"
            )}
          >
            {positionChange > 0 ? "▲" : "▼"}
            {Math.abs(positionChange)}
          </span>
        )}
      </div>

      {cols.gap && (
        <div className="min-w-[62px] shrink-0 pr-2 text-right">
          <span className={cn("text-[11px] font-bold tabular-nums", row.position === 1 ? "text-zinc-500" : "text-zinc-300")}>
            {row.position === 1 && !row.gap.startsWith("+") ? (isRace ? row.gap || "Leader" : "—") : row.gap}
          </span>
        </div>
      )}
      {cols.interval && (
        <div className="min-w-[58px] shrink-0 pr-2 text-right">
          <span
            className={cn(
              "text-[11px] font-bold tabular-nums",
              row.position === 1 ? "text-zinc-500" : row.catching ? "text-green-400" : "text-yellow-400"
            )}
          >
            {row.position === 1 ? "—" : row.interval}
          </span>
        </div>
      )}

      <div className="min-w-[70px] shrink-0 pr-3 text-right">
        {knockedOut ? (
          <Badge bg="#dc2626" fg="#fff">KO</Badge>
        ) : row.status === "PIT" ? (
          <Badge bg="#f59e0b" fg="#000">IN PIT</Badge>
        ) : row.status === "PIT OUT" ? (
          <Badge bg="#0ea5e9" fg="#000">PIT OUT</Badge>
        ) : isOut ? (
          <Badge bg="#ef4444" fg="#fff">{row.status === "STOPPED" ? "STOP" : "OUT"}</Badge>
        ) : (
          <Time cell={row.lastLap} size="text-[12px]" />
        )}
      </div>
      <div className="min-w-[70px] shrink-0 pr-3 text-right">
        <span className={cn("text-[12px] font-bold tabular-nums", row.bestLap.ob ? "text-purple-400" : "text-zinc-300")}>
          {row.bestLap.value}
        </span>
      </div>

      <div className="flex min-w-[52px] shrink-0 items-center justify-center gap-1" title={row.tyre ? `${row.tyre.compound}${row.tyre.isNew ? " (new)" : " (used)"}` : ""}>
        {row.tyre && (
          <>
            <TyreDot compound={row.tyre.compound} />
            <span className="text-[11px] font-bold tabular-nums text-zinc-300">{row.tyre.age}</span>
          </>
        )}
      </div>
      {cols.pits && (
        <div className="min-w-[34px] shrink-0 text-center text-[11px] font-bold tabular-nums text-zinc-400">{row.pitStops || ""}</div>
      )}

      {cols.sectors && row.sectors.map((s, i) => <Sector key={i} cell={s} minis={cols.minis} />)}
      {cols.live && <LiveCells num={row.num} />}
      {cols.theo && (
        <div className="min-w-[64px] shrink-0 pr-2 text-right text-[11px] font-bold tabular-nums text-zinc-400">{row.theoretical}</div>
      )}
    </div>
  );
});

function Badge({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: bg, color: fg }}>
      {children}
    </span>
  );
}

function Time({ cell, size }: { cell: TimeCell; size: string }) {
  return (
    <span
      className={cn(
        size,
        "font-bold tabular-nums",
        cell.ob ? "text-purple-400" : cell.pb ? "text-green-400" : "text-zinc-200"
      )}
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
        "flex items-center justify-center rounded-full font-black",
        small ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[9px]"
      )}
      style={{ backgroundColor: color, color: compound === "HARD" || compound === "MEDIUM" ? "#000" : "#fff" }}
    >
      {TYRE_SHORT[compound] ?? "?"}
    </span>
  );
}

const MINI_COUNT = 8;

function Sector({ cell, minis }: { cell: SectorCell; minis: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2 pl-2", minis ? "min-w-[110px]" : "min-w-[54px]")}>
      <span
        className={cn(
          "min-w-[42px] text-right text-[11px] font-bold tabular-nums",
          !cell.value && "text-zinc-600",
          cell.ob && "text-purple-400",
          cell.pb && !cell.ob && "text-green-400",
          !cell.ob && !cell.pb && cell.value && "text-yellow-400"
        )}
      >
        {cell.value || "—"}
      </span>
      {minis && (
        <div className="flex items-center gap-[3px]">
          {Array.from({ length: MINI_COUNT }, (_, i) => (
            <div key={i} className="h-[14px] w-[5px] shrink-0 rounded-[2px]" style={{ backgroundColor: segmentColor(cell.segments[i]) }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Live speed + throttle/brake from CarData, refreshed on a ticker */
function LiveCells({ num }: { num: string }) {
  useTicker(5);
  const c = carAt(num, trackNow());
  return (
    <div className="flex min-w-[118px] shrink-0 items-center gap-2 pl-3">
      <span className="min-w-[48px] text-right text-[11px] font-bold tabular-nums text-zinc-200">
        {c ? c.speed : "—"}
        <span className="ml-0.5 text-[8px] font-normal text-zinc-500">km/h</span>
      </span>
      <div className="flex w-[52px] flex-col gap-[2px]">
        <div className="h-[4px] overflow-hidden rounded-sm bg-zinc-800">
          <div className="h-full bg-green-500" style={{ width: `${c?.throttle ?? 0}%` }} />
        </div>
        <div className="h-[4px] overflow-hidden rounded-sm bg-zinc-800">
          <div className="h-full bg-red-500" style={{ width: `${c?.brake ?? 0}%` }} />
        </div>
      </div>
    </div>
  );
}
