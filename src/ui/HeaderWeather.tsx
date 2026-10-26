// Weather strip in its own section of the header (it used to be a grid widget).

import { usePitwall } from "../data/store";
import { cn } from "../lib/format";

export function HeaderWeather({ compact }: { compact: boolean }) {
  const w = usePitwall((s) => s.live.WeatherData);
  const series = usePitwall((s) => s.live.WeatherDataSeries?.Series);
  if (!w) return null;
  const rain = !!w.Rainfall && w.Rainfall !== "0";
  const trackTrend = series?.map((p) => Number(p.Weather.TrackTemp)).filter(Number.isFinite) ?? [];

  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-f1" data-tip="Track weather">
      <Stat label="Track" value={`${w.TrackTemp ?? "—"}°`} className="text-orange-300" />
      {!compact && trackTrend.length > 1 && <Spark values={trackTrend} color="#fdba74" />}
      <Stat label="Air" value={`${w.AirTemp ?? "—"}°`} className="text-sky-300" />
      {!compact && <Stat label="Humidity" value={`${w.Humidity ?? "—"}%`} />}
      {!compact && (
        <Stat
          label="Wind"
          value={
            <span className="inline-flex items-center gap-1">
              {w.WindSpeed ?? "—"}
              <span className="text-[10px] font-semibold text-zinc-500">m/s</span>
              {/* WindDirection is where it blows from; the arrow points where it blows to */}
              <span className="inline-block text-[12px]" style={{ transform: `rotate(${Number(w.WindDirection ?? 0) + 180}deg)` }}>
                ↑
              </span>
            </span>
          }
        />
      )}
      <Stat label="Rain" value={rain ? "Yes" : "No"} className={rain ? "text-sky-400" : undefined} />
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={cn("text-[14px] font-bold tabular-nums", className ?? "text-zinc-100")}>{value}</span>
    </div>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const w = 64;
  const h = 22;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="-ml-2 shrink-0" aria-label="Track temperature trend">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
