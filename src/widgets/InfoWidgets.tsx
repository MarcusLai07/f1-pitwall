// Smaller widgets: race control, sector leaderboard, weather, tyre strategy.

import { useMemo } from "react";
import { buildRows, raceControlMessages, sectorLeaders } from "../data/derive";
import { usePitwall } from "../data/store";
import { TYRE_COLORS, cn, isLightColor, parseGmtOffset, parseUtc, trackClock } from "../lib/format";
import { TyreDot } from "./TimingTower";
import { useSize } from "../ui/hooks";

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#22c55e",
  CLEAR: "#22c55e",
  YELLOW: "#eab308",
  "DOUBLE YELLOW": "#eab308",
  RED: "#ef4444",
  BLUE: "#3b82f6",
  CHEQUERED: "#ffffff",
  "BLACK AND WHITE": "#a1a1aa",
};

export function RaceControl() {
  const rc = usePitwall((s) => s.live.RaceControlMessages);
  const offset = usePitwall((s) => parseGmtOffset(s.live.SessionInfo?.GmtOffset));
  const messages = useMemo(() => raceControlMessages({ RaceControlMessages: rc }), [rc]);
  if (!messages.length) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No race control messages</div>;
  }
  return (
    <div className="h-full overflow-y-auto">
      {messages.map((m, i) => {
        const color = m.Flag ? FLAG_COLORS[m.Flag] : m.Category === "SafetyCar" ? "#f59e0b" : undefined;
        return (
          <div key={`${m.Utc}-${i}`} className="flex gap-2 border-b border-zinc-800/60 px-2.5 py-1.5">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "#3f3f46" }} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-snug text-zinc-200">{m.Message}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">
                {trackClock(parseUtc(m.Utc), offset)}
                {m.Lap ? ` · Lap ${m.Lap}` : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SectorLeaderboard() {
  const stats = usePitwall((s) => s.live.TimingStats);
  const drivers = usePitwall((s) => s.live.DriverList);
  const leaders = useMemo(() => sectorLeaders({ TimingStats: stats }), [stats]);
  const [ref, size] = useSize<HTMLDivElement>();
  const narrow = size.width > 0 && size.width < 340;
  return (
    <div ref={ref} className="grid h-full grid-cols-3 gap-px overflow-y-auto bg-zinc-800/60">
      {leaders.map((list, i) => (
        <div key={i} className="bg-background">
          <div className="border-b border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Sector {i + 1}</div>
          {list.map((s) => {
            const d = drivers?.[s.num];
            const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
            return (
              <div key={s.num} className={cn("flex items-center py-[3px]", narrow ? "gap-1 px-1.5" : "gap-1.5 px-2")}>
                {!narrow && <span className="w-3 text-[10px] font-bold tabular-nums text-zinc-500">{s.position}</span>}
                <span
                  className="rounded px-1 text-[10px] font-bold"
                  style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
                >
                  {d?.Tla ?? s.num}
                </span>
                <span className={cn("ml-auto text-[11px] font-bold tabular-nums", s.position === 1 ? "text-purple-400" : "text-zinc-300")}>
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

export function WeatherWidget() {
  const w = usePitwall((s) => s.live.WeatherData);
  const series = usePitwall((s) => s.live.WeatherDataSeries?.Series);
  if (!w) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No weather data</div>;
  const track = series?.map((p) => Number(p.Weather.TrackTemp)).filter(Number.isFinite) ?? [];
  const air = series?.map((p) => Number(p.Weather.AirTemp)).filter(Number.isFinite) ?? [];
  const rain = w.Rainfall && w.Rainfall !== "0";
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2.5">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        <Stat label="Track" value={`${w.TrackTemp ?? "—"}°C`} accent="text-orange-300" />
        <Stat label="Air" value={`${w.AirTemp ?? "—"}°C`} accent="text-sky-300" />
        <Stat label="Humidity" value={`${w.Humidity ?? "—"}%`} />
        <Stat
          label="Wind"
          value={
            <span className="inline-flex items-center gap-1">
              {w.WindSpeed ?? "—"}
              <span className="text-[10px] text-muted-foreground">m/s</span>
              <span className="inline-block text-[11px]" style={{ transform: `rotate(${Number(w.WindDirection ?? 0) + 180}deg)` }}>
                ↑
              </span>
            </span>
          }
        />
        <Stat label="Pressure" value={`${w.Pressure ?? "—"}`} />
        <Stat label="Rain" value={rain ? "Yes" : "No"} accent={rain ? "text-sky-400" : undefined} />
      </div>
      {track.length > 1 && (
        <Sparks series={[{ values: track, color: "#fdba74" }, { values: air, color: "#7dd3fc" }]} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", accent ?? "text-zinc-200")}>{value}</span>
    </div>
  );
}

function Sparks({ series }: { series: { values: number[]; color: string }[] }) {
  const all = series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 200;
  const h = 40;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="min-h-0 w-full flex-1">
      {series.map((s) => (
        <path
          key={s.color}
          d={s.values.map((v, i) => `${i ? "L" : "M"}${((i / (s.values.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function TyreStrategy() {
  const live = usePitwall((s) => s.live);
  const rows = useMemo(() => buildRows(live), [live.TimingData, live.DriverList, live.TimingAppData, live.TimingStats]);
  const total = live.LapCount?.TotalLaps;
  const maxLaps = Math.max(total ?? 0, ...rows.map((r) => r.stints.reduce((a, s) => a + (s.TotalLaps ?? 0) - (s.StartLaps ?? 0), 0)), 1);
  return (
    <div className="h-full overflow-y-auto px-2 py-1">
      {rows.map((r) => (
        <div key={r.num} className="flex items-center gap-2 py-[3px]">
          <span
            className="w-9 shrink-0 rounded px-1 text-center text-[10px] font-bold"
            style={{ backgroundColor: r.color, color: isLightColor(r.color) ? "#000" : "#fff" }}
          >
            {r.tla}
          </span>
          <div className="flex h-4 flex-1 gap-px overflow-hidden rounded-sm bg-zinc-900">
            {r.stints.map((s, i) => {
              const laps = Math.max(0, (s.TotalLaps ?? 0) - (s.StartLaps ?? 0));
              const color = TYRE_COLORS[s.Compound ?? ""] ?? "#52525b";
              return (
                <div
                  key={i}
                  className="flex items-center justify-center text-[9px] font-black"
                  style={{
                    width: `${(laps / maxLaps) * 100}%`,
                    minWidth: laps ? 14 : 4,
                    backgroundColor: color,
                    color: s.Compound === "HARD" || s.Compound === "MEDIUM" ? "#000" : "#fff",
                    opacity: s.New === "false" ? 0.65 : 1,
                  }}
                  title={`${s.Compound} · ${laps} laps${s.New === "false" ? " (used)" : ""}`}
                >
                  {laps >= 3 ? laps : ""}
                </div>
              );
            })}
          </div>
          {r.tyre && <TyreDot compound={r.tyre.compound} small />}
        </div>
      ))}
    </div>
  );
}
