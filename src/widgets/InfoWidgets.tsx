// Sector leaderboard: every driver's best sector times, ranked per sector.

import { useMemo } from "react";
import { sectorLeaders } from "../data/derive";
import { usePitwall } from "../data/store";
import { cn, isLightColor } from "../lib/format";
import { useSize } from "../ui/hooks";

// 22 px header + 30 px rows, so the default 4-row widget shows exactly the top 3
export function SectorLeaderboard() {
  const stats = usePitwall((s) => s.live.TimingStats);
  const drivers = usePitwall((s) => s.live.DriverList);
  const leaders = useMemo(() => sectorLeaders({ TimingStats: stats }, Infinity), [stats]);
  const [ref, size] = useSize<HTMLDivElement>();
  const narrow = size.width > 0 && size.width < 360;
  const rows = Math.max(0, ...leaders.map((l) => l.length));

  return (
    <div ref={ref} className="h-full overflow-y-auto font-f1">
      <div className="sticky top-0 z-10 grid h-[22px] grid-cols-3 border-b border-zinc-800 bg-zinc-900 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {[1, 2, 3].map((n) => (
          <span key={n} className="flex items-center border-r border-zinc-800 px-2.5 last:border-r-0">
            Sector {n}
          </span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid h-[30px] grid-cols-3 border-b border-zinc-800/50">
          {leaders.map((list, i) => {
            const s = list[r];
            if (!s) return <span key={i} className="border-r border-zinc-800/60 last:border-r-0" />;
            const d = drivers?.[s.num];
            const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
            return (
              <div key={i} className={cn("flex items-center border-r border-zinc-800/60 last:border-r-0", narrow ? "gap-1.5 px-1.5" : "gap-2 px-2.5")}>
                {!narrow && <span className="w-4 text-[11px] font-bold tabular-nums text-zinc-500">{s.position}</span>}
                <span
                  className="w-[38px] shrink-0 rounded py-px text-center text-[11px] font-bold"
                  style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
                >
                  {d?.Tla ?? s.num}
                </span>
                <span className={cn("ml-auto text-[13px] font-bold tabular-nums", s.position === 1 ? "text-purple-400" : "text-zinc-100")}>
                  {s.value}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
