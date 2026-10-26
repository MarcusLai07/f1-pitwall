// Lap time series: one column per driver (in running order), one row per lap, newest
// at the top. Green = the driver's best lap, purple = fastest lap overall.

import { useMemo } from "react";
import { buildRows } from "../data/derive";
import { lapHistory, useLaps, type LapPoint } from "../data/laps";
import { usePitwall } from "../data/store";
import { cn, formatLap, isLightColor } from "../lib/format";
import { TyreDot } from "../widgets/TimingTower";
import { Empty } from "./Panels";

const COL_PX = 112;

export function LapTimesPanel() {
  const version = useLaps((s) => s.version);
  const live = usePitwall((s) => s.live);
  const selected = usePitwall((s) => s.selected);

  const { drivers, laps, byDriver, personalBest, overallBest } = useMemo(() => {
    const hist = lapHistory();
    const rows = buildRows(live).filter((r) => (hist.get(r.num)?.length ?? 0) > 0);
    const byDriver = new Map<string, Map<number, LapPoint>>();
    const personalBest = new Map<string, number>();
    let overallBest = Infinity;
    const lapSet = new Set<number>();
    for (const r of rows) {
      const m = new Map<number, LapPoint>();
      for (const p of hist.get(r.num) ?? []) {
        m.set(p.lap, p);
        lapSet.add(p.lap);
        if (p.time !== null) {
          personalBest.set(r.num, Math.min(personalBest.get(r.num) ?? Infinity, p.time));
          overallBest = Math.min(overallBest, p.time);
        }
      }
      byDriver.set(r.num, m);
    }
    return { drivers: rows, laps: [...lapSet].sort((a, b) => b - a), byDriver, personalBest, overallBest };
  }, [version, live.DriverList, live.TimingData]);

  if (!laps.length) {
    return (
      <Empty>Lap times fill in lap by lap from when Pit Wall starts watching. A replay fills them from the start of the recording.</Empty>
    );
  }

  return (
    <div className="h-full overflow-auto font-f1">
      <table className="border-separate border-spacing-0 text-[12.5px] tabular-nums">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 h-[30px] w-[44px] border-b border-r border-zinc-800 bg-zinc-900 text-[11px] font-semibold uppercase text-zinc-400">
              Lap
            </th>
            {drivers.map((d) => (
              <th
                key={d.num}
                className={cn("sticky top-0 z-10 h-[30px] border-b border-zinc-800 bg-zinc-900 px-1.5", selected.includes(d.num) && "bg-zinc-800")}
                style={{ minWidth: COL_PX }}
              >
                <span className="flex items-center justify-center gap-1">
                  <span className="text-[11px] font-bold text-zinc-400">{d.position}</span>
                  <span
                    className="w-[40px] rounded py-px text-center text-[11px] font-bold"
                    style={{ backgroundColor: d.color, color: isLightColor(d.color) ? "#000" : "#fff" }}
                  >
                    {d.tla}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {laps.map((lap) => (
            <tr key={lap}>
              <td className="sticky left-0 z-10 h-[30px] border-b border-r border-zinc-800 bg-zinc-950 text-center text-[12px] font-bold text-zinc-300">
                {lap}
              </td>
              {drivers.map((d) => {
                const p = byDriver.get(d.num)?.get(lap);
                const isOverall = p?.time != null && p.time === overallBest;
                const isPersonal = !isOverall && p?.time != null && p.time === personalBest.get(d.num);
                return (
                  <td
                    key={d.num}
                    className={cn(
                      "h-[30px] border-b border-zinc-800/60 px-2",
                      isOverall && "bg-purple-500/15",
                      isPersonal && "bg-green-500/10",
                      selected.includes(d.num) && !isOverall && !isPersonal && "bg-zinc-900/60"
                    )}
                  >
                    {p && (
                      <span className="flex items-center justify-end gap-1.5">
                        {p.pit && (
                          <span className="rounded bg-zinc-800 px-1 text-[9px] font-bold uppercase text-zinc-400" data-tip={p.pit === "in" ? "Pit in-lap" : "Pit out-lap"}>
                            {p.pit}
                          </span>
                        )}
                        {p.compound && p.compound !== "UNKNOWN" ? <TyreDot compound={p.compound} small /> : null}
                        <span
                          className={cn(
                            "font-bold",
                            isOverall ? "text-purple-300" : isPersonal ? "text-green-400" : p.pit ? "text-zinc-500" : "text-zinc-100"
                          )}
                        >
                          {p.time != null ? formatLap(p.time) : "—"}
                        </span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
