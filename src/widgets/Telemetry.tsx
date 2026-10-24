// Adapted from f1-dashboard's components/live/TelemetryPanel.tsx. The trace now comes
// from the CarData buffer (every ~250 ms sample) instead of snapshots on change.

import { carAt, carHistory, type CarSample } from "../data/buffers";
import { trackNow, usePitwall } from "../data/store";
import { buildRows } from "../data/derive";
import { cn } from "../lib/format";
import { useTicker } from "../ui/hooks";
import { useMemo } from "react";

const TRACE_MS = 20_000;

export function Telemetry() {
  useTicker(8);
  const live = usePitwall((s) => s.live);
  const selected = usePitwall((s) => s.selected);
  const leader = useMemo(() => buildRows(live)[0]?.num, [live.TimingData, live.DriverList]);
  const nums = selected.length ? selected.slice(0, 2) : leader ? [leader] : [];
  const at = trackNow();

  if (!nums.length) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Waiting for car data</div>;
  }
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      {!selected.length && (
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Showing the leader · click drivers in the timing tower</p>
      )}
      {nums.map((num) => (
        <DriverCard key={num} num={num} at={at} />
      ))}
    </div>
  );
}

function DriverCard({ num, at }: { num: string; at: number }) {
  const d = usePitwall((s) => s.live.DriverList?.[num]);
  const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
  const c = carAt(num, at);
  const history = carHistory(num, at - TRACE_MS, at);

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/50 p-2.5">
      <div className="flex items-center gap-2">
        <div className="h-6 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
        <span className="text-base font-bold">{d?.Tla ?? num}</span>
        <span className="text-xs text-muted-foreground">#{num}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{d?.TeamName}</span>
      </div>

      <div className="flex items-end gap-5">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Speed</span>
          <span className="font-f1 text-3xl font-bold tabular-nums leading-none">
            {c?.speed ?? "—"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">km/h</span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Gear</span>
          <span className="font-f1 text-3xl font-bold leading-none">{c ? (c.gear === 0 ? "N" : c.gear) : "—"}</span>
        </div>
        <div className="flex flex-1 flex-col">
          <span className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">RPM</span>
          <GearLights gear={c?.gear ?? 0} />
          <span className="mt-1 text-xs tabular-nums text-zinc-400">{c ? (c.rpm / 1000).toFixed(1) : "—"}k</span>
        </div>
      </div>

      <Trace history={history} from={at - TRACE_MS} color={color} />
      <Bar label="Throttle" value={c?.throttle ?? 0} gradient="from-green-700 to-green-400" text="text-green-400" />
      <Bar label="Brake" value={c?.brake ?? 0} gradient="from-red-700 to-red-400" text="text-red-400" />
    </div>
  );
}

function GearLights({ gear }: { gear: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 8 }, (_, i) => i + 1).map((i) => (
        <div
          key={i}
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            i > gear && "bg-zinc-800",
            i <= gear && i <= 3 && "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]",
            i <= gear && i > 3 && i <= 6 && "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.6)]",
            i <= gear && i > 6 && "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
          )}
        />
      ))}
    </div>
  );
}

function Bar({ label, value, gradient, text }: { label: string; value: number; gradient: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", text)}>{value}%</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded bg-zinc-900">
        <div className={cn("h-full rounded bg-gradient-to-r", gradient)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Trace({ history, from, color }: { history: CarSample[]; from: number; color: string }) {
  const width = 300;
  const height = 70;
  if (history.length < 2) {
    return <div className="flex h-[70px] items-center justify-center rounded bg-zinc-900/50 text-[10px] text-muted-foreground">Building trace…</div>;
  }
  const x = (t: number) => ((t - from) / TRACE_MS) * width;
  const path = (pick: (s: CarSample) => number) =>
    history.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)} ${(height - 4 - pick(s) * (height - 8)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-[70px] w-full rounded bg-zinc-900/50">
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#27272a" strokeDasharray="2 2" />
      <path d={path((s) => Math.min(s.speed / 350, 1))} fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
      <path d={path((s) => s.throttle / 100)} fill="none" stroke="#22c55e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={path((s) => s.brake / 100)} fill="none" stroke="#ef4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <g transform="translate(6, 10)" fontSize="7" fill="#71717a">
        <rect x="0" y="-4" width="8" height="2" fill="#22c55e" rx="1" />
        <text x="11" y="0">THR</text>
        <rect x="32" y="-4" width="8" height="2" fill="#ef4444" rx="1" />
        <text x="43" y="0">BRK</text>
        <rect x="64" y="-4" width="8" height="2" fill={color} opacity="0.6" rx="1" />
        <text x="75" y="0">SPD</text>
      </g>
    </svg>
  );
}
