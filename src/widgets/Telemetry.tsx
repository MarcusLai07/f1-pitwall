// Adapted from f1-dashboard's components/live/TelemetryPanel.tsx. The trace comes from
// the CarData buffer (every ~250 ms sample). Up to five cars: in the window the widget
// holds two cards (newest selection on the right) and cards 3–5 open out to the left,
// floating over whatever sits there. The side panel wraps them into rows instead.

import { useMemo } from "react";
import { carAt, carHistory, type CarSample } from "../data/buffers";
import { trackNow, usePitwall } from "../data/store";
import { buildRows } from "../data/derive";
import { useFreeFeed } from "../data/liveSettings";
import { cn, isLightColor } from "../lib/format";
import { TELEMETRY_TWO_COLUMN_PX, telemetryColumns } from "../layout/defaults";
import { useLayout } from "../layout/layoutStore";
import { useSize, useTicker } from "../ui/hooks";

const TRACE_MS = 20_000;

// Narrowest a telemetry card gets (two across in the narrowest two-column widget);
// past that, cards open out to the left instead
const MIN_CARD_PX = (TELEMETRY_TWO_COLUMN_PX - 6 - 14) / 2;

export function Telemetry() {
  useTicker(8);
  const freeFeed = useFreeFeed();
  const live = usePitwall((s) => s.live);
  const selected = usePitwall((s) => s.selected);
  const leader = useMemo(() => buildRows(live)[0]?.num, [live.TimingData, live.DriverList]);
  const [ref, size] = useSize<HTMLDivElement>();
  const isWindow = useLayout((s) => s.view) === "window";
  const nums = selected.length ? selected : leader ? [leader] : [];
  const columns = telemetryColumns(size.width, nums.length);
  const at = trackNow();
  const GAP = 14;

  if (isWindow && nums.length && !freeFeed) {
    // With more than one car every card is two-across width, whatever the widget's own
    // width (a narrow widget used to make them full width, and the extras with them).
    // Cards that don't fit open out to the left at the same size.
    const inner = size.width - 6;
    const several = nums.length > 1;
    const half = (inner - GAP) / 2;
    const cardW = several ? Math.max(MIN_CARD_PX, half) : inner;
    // Two inside when they fit at two-across width; in a widget too narrow for that, one
    const inside = several && half >= MIN_CARD_PX ? 2 : 1;
    return (
      <div ref={ref} className="relative h-full">
        <div className="absolute inset-y-[3px] right-[3px] flex flex-row-reverse" style={{ gap: GAP }}>
          {nums.map((num, i) => (
            <div key={num} className="h-full" style={{ width: cardW }}>
              <DriverCard num={num} at={at} isLeaderFallback={!selected.length} compact={several} floating={i >= inside} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="grid h-full gap-[14px] p-[3px]"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(1, Math.ceil(nums.length / columns))}, minmax(0, 1fr))`,
      }}
    >
      {freeFeed ? (
        <div className="flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Telemetry comes with your F1 TV sign-in (Sessions → Sign in to F1 TV)
        </div>
      ) : nums.length ? (
        nums.map((num) => <DriverCard key={num} num={num} at={at} isLeaderFallback={!selected.length} compact={columns === 2} />)
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">Waiting for car data</div>
      )}
    </div>
  );
}

function DriverCard({
  num,
  at,
  isLeaderFallback,
  compact,
  floating = false,
}: {
  num: string;
  at: number;
  isLeaderFallback: boolean;
  compact: boolean;
  floating?: boolean;
}) {
  const d = usePitwall((s) => s.live.DriverList?.[num]);
  const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
  const c = carAt(num, at);
  const history = carHistory(num, at - TRACE_MS, at);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-lg p-2.5 font-f1",
        // Cards outside the widget sit over other widgets, so they need a solid face
        floating ? "bg-zinc-900 shadow-2xl shadow-black/70 ring-1 ring-zinc-700" : "bg-secondary/60"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[13px] font-bold"
          style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
        >
          {d?.Tla ?? num}
        </span>
        <span className="text-[12px] text-zinc-400">#{num}</span>
        {isLeaderFallback && (
          <span className="rounded bg-zinc-800 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-zinc-400" title="Click drivers in the timing tower to choose">
            Leader
          </span>
        )}
        {!compact && <span className="ml-auto truncate text-[11px] uppercase tracking-wide text-zinc-500">{d?.TeamName}</span>}
      </div>

      <div className="flex items-end gap-4">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Speed</span>
          <span className={cn("font-bold tabular-nums leading-none text-zinc-50", compact ? "text-[24px]" : "text-[32px]")}>
            {c?.speed ?? "—"}
            <span className="ml-1 text-[11px] font-semibold text-zinc-500">km/h</span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Gear</span>
          <span className={cn("font-bold leading-none text-zinc-50", compact ? "text-[24px]" : "text-[32px]")}>
            {c ? (c.gear === 0 ? "N" : c.gear) : "—"}
          </span>
        </div>
        {!compact && (
          <div className="ml-auto flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">RPM</span>
            <span className="text-[14px] font-bold tabular-nums text-zinc-300">{c ? (c.rpm / 1000).toFixed(1) : "—"}k</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <GearLights gear={c?.gear ?? 0} />
        </div>
        {compact && <span className="text-[12px] font-bold tabular-nums text-zinc-300">{c ? (c.rpm / 1000).toFixed(1) : "—"}k</span>}
      </div>

      <Trace history={history} from={at - TRACE_MS} color={color} />
      <Bar label={compact ? "Thr" : "Throttle"} value={c?.throttle ?? 0} gradient="from-green-700 to-green-400" text="text-green-400" compact={compact} />
      <Bar label={compact ? "Brk" : "Brake"} value={c?.brake ?? 0} gradient="from-red-700 to-red-400" text="text-red-400" compact={compact} />
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
            "h-2 flex-1 rounded-full",
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

function Bar({ label, value, gradient, text, compact }: { label: string; value: number; gradient: string; text: string; compact: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("shrink-0 text-[10px] uppercase tracking-wider text-zinc-500", compact ? "w-[26px]" : "w-[54px]")}>{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-zinc-900">
        <div className={cn("h-full rounded bg-gradient-to-r", gradient)} style={{ width: `${value}%` }} />
      </div>
      <span className={cn("w-[34px] shrink-0 text-right text-[12px] font-bold tabular-nums", text)}>{value}%</span>
    </div>
  );
}

/** Last 20 s of speed/throttle/brake; stretches to fill the card's spare height */
function Trace({ history, from, color }: { history: CarSample[]; from: number; color: string }) {
  const width = 300;
  const height = 70;
  if (history.length < 2) {
    return <div className="flex min-h-[40px] flex-1 items-center justify-center rounded bg-zinc-900/50 text-[11px] text-zinc-500">Building trace…</div>;
  }
  const x = (t: number) => ((t - from) / TRACE_MS) * width;
  const path = (pick: (s: CarSample) => number) =>
    history.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)} ${(height - 4 - pick(s) * (height - 8)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="min-h-[40px] w-full flex-1 rounded bg-zinc-900/50">
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#27272a" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <path d={path((s) => Math.min(s.speed / 350, 1))} fill="none" stroke={color} strokeWidth="1.5" opacity="0.55" vectorEffect="non-scaling-stroke" />
      <path d={path((s) => s.throttle / 100)} fill="none" stroke="#22c55e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={path((s) => s.brake / 100)} fill="none" stroke="#ef4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
