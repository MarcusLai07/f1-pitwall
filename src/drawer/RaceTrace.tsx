// Race trace: gap to the leader lap by lap (races/sprints), or lap times for the
// selected drivers in practice and qualifying, where gaps don't mean much.

import { useMemo } from "react";
import { buildRows, sessionKind } from "../data/derive";
import { lapHistory, useLaps, type LapPoint } from "../data/laps";
import { usePitwall } from "../data/store";
import { formatLap } from "../lib/format";
import { useSize } from "../ui/hooks";
import { Empty } from "./Panels";

const PAD = { left: 46, right: 46, top: 12, bottom: 24 };

interface Series {
  num: string;
  tla: string;
  color: string;
  points: { x: number; y: number }[];
  highlighted: boolean;
}

export function RaceTracePanel() {
  const version = useLaps((s) => s.version);
  const live = usePitwall((s) => s.live);
  const selected = usePitwall((s) => s.selected);
  const kind = sessionKind(live.SessionInfo);
  const isRace = kind === "race";
  const [ref, size] = useSize<HTMLDivElement>();

  const series = useMemo<Series[]>(() => {
    const hist = lapHistory();
    const drivers = live.DriverList ?? {};
    const rows = buildRows(live);
    // Lap-time view shows only a few drivers: the selection, else the top five
    const shown = isRace ? rows.map((r) => r.num) : selected.length ? selected : rows.slice(0, 5).map((r) => r.num);
    const best = Math.min(...[...hist.values()].flat().map((p) => p.time ?? Infinity));
    const pick = (p: LapPoint) => (isRace ? p.gap : p.time !== null && p.time <= best * 1.07 ? p.time : null);
    return shown
      .map((num) => {
        const d = drivers[num];
        const points = (hist.get(num) ?? []).flatMap((p) => {
          const y = pick(p);
          return y === null ? [] : [{ x: p.lap, y }];
        });
        return {
          num,
          tla: d?.Tla ?? num,
          color: d?.TeamColour ? `#${d.TeamColour}` : "#808080",
          points,
          highlighted: !selected.length || selected.includes(num),
        };
      })
      .filter((s) => s.points.length > 0);
  }, [version, live.DriverList, live.TimingData, selected, isRace]);

  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    return (
      <div ref={ref} className="h-full">
        <Empty>
          {isRace ? "The race trace" : "The lap-time chart"} builds lap by lap from when Pit Wall starts watching. A replay builds it
          from the start of the recording.
        </Empty>
      </div>
    );
  }

  const w = Math.max(200, size.width);
  const h = Math.max(120, size.height);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(minX + 1, ...all.map((p) => p.x));
  const ys = all.map((p) => p.y);
  // Race: leader on top, gaps downward (capped so one straggler doesn't flatten the rest)
  const [y0, y1] = isRace ? [0, Math.min(Math.max(5, ...ys), 90)] : [Math.min(...ys) - 0.2, Math.max(...ys) + 0.2];
  const sx = (x: number) => PAD.left + ((x - minX) / (maxX - minX)) * (w - PAD.left - PAD.right);
  const sy = (y: number) => PAD.top + ((Math.min(y, y1) - y0) / (y1 - y0 || 1)) * (h - PAD.top - PAD.bottom);
  const yTicks = niceTicks(y0, y1, 5);
  const xTicks = niceTicks(minX, maxX, 8).filter((t) => Number.isInteger(t));

  // End-of-line labels, nudged apart so they stay readable
  const labels = series
    .filter((s) => s.highlighted)
    .map((s) => ({ s, y: sy(s.points[s.points.length - 1].y), x: sx(s.points[s.points.length - 1].x) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 11);

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={w} height={h} className="block font-f1">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={w - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#27272a" strokeDasharray="2 3" />
            <text x={PAD.left - 6} y={sy(t) + 3.5} textAnchor="end" fontSize="10" fill="#71717a">
              {isRace ? (t === 0 ? "Leader" : `+${t}s`) : formatLap(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={h - 8} textAnchor="middle" fontSize="10" fill="#71717a">
            {t === xTicks[0] ? `Lap ${t}` : t}
          </text>
        ))}
        {series
          .slice()
          .sort((a, b) => Number(a.highlighted) - Number(b.highlighted))
          .map((s) => (
            <g key={s.num} opacity={s.highlighted ? 1 : 0.22}>
              <polyline
                points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.highlighted && selectedOrFew(series) ? 2.25 : 1.5}
                strokeLinejoin="round"
              />
              {!isRace && s.points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2} fill={s.color} />)}
            </g>
          ))}
        {labels.map(({ s, x, y }) => (
          <text key={`l${s.num}`} x={Math.min(x + 5, w - PAD.right + 6)} y={y + 3.5} fontSize="10" fontWeight="700" fill={s.color}>
            {s.tla}
          </text>
        ))}
      </svg>
    </div>
  );
}

const selectedOrFew = (series: Series[]) => series.filter((s) => s.highlighted).length <= 6;

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Number(t.toFixed(6)));
  return out;
}
