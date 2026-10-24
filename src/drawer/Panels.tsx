// Drawer panels: race control, investigation tracker, track limits.

import { useMemo, useState } from "react";
import { raceControlMessages, sessionKind } from "../data/derive";
import { investigations, trackLimits, type IncidentStatus } from "../data/stewards";
import { usePitwall } from "../data/store";
import type { DriverInfo, RaceControlMessage } from "../data/types";
import { cn, isLightColor, parseGmtOffset, parseUtc, trackClock } from "../lib/format";

export const FLAG_COLORS: Record<string, string> = {
  GREEN: "#22c55e",
  CLEAR: "#22c55e",
  YELLOW: "#eab308",
  "DOUBLE YELLOW": "#eab308",
  RED: "#ef4444",
  BLUE: "#3b82f6",
  CHEQUERED: "#ffffff",
  "BLACK AND WHITE": "#a1a1aa",
};

export function messageColor(m: RaceControlMessage): string {
  if (m.Flag && FLAG_COLORS[m.Flag]) return FLAG_COLORS[m.Flag];
  if (m.Category === "SafetyCar" || m.SubCategory === "SafetyCar") return "#f59e0b";
  if (m.SubCategory?.startsWith("Incident")) return "#f97316";
  if (m.SubCategory === "LapTimeDeleted") return "#a855f7";
  return "#52525b";
}

function useMessages() {
  const rc = usePitwall((s) => s.live.RaceControlMessages);
  return useMemo(() => raceControlMessages({ RaceControlMessages: rc }), [rc]);
}

function useOffset() {
  return usePitwall((s) => parseGmtOffset(s.live.SessionInfo?.GmtOffset));
}

export function RaceControlPanel() {
  const messages = useMessages();
  const offset = useOffset();
  const [blue, setBlue] = useState(false);
  const shown = blue ? messages : messages.filter((m) => m.Flag !== "BLUE");
  const hiddenBlue = messages.length - shown.length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px] text-zinc-400">
        <span>{messages.length} messages</span>
        <button
          onClick={() => setBlue((b) => !b)}
          className={cn("ml-auto rounded border px-2 py-0.5 font-semibold", blue ? "border-blue-500 text-blue-300" : "border-zinc-700 text-zinc-400 hover:text-zinc-200")}
        >
          {blue ? "Hide blue flags" : `Show blue flags${hiddenBlue ? ` (${hiddenBlue})` : ""}`}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length ? (
          shown.map((m, i) => (
            <div key={`${m.Utc}-${i}`} className="flex gap-2.5 border-b border-zinc-800/60 px-3 py-2">
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: messageColor(m) }} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-snug text-zinc-100">{m.Message}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
                  {trackClock(parseUtc(m.Utc), offset)}
                  {m.Lap ? ` · Lap ${m.Lap}` : ""}
                </p>
              </div>
            </div>
          ))
        ) : (
          <Empty>No race control messages</Empty>
        )}
      </div>
    </div>
  );
}

const STATUS: Record<IncidentStatus, { label: string; cls: string }> = {
  noted: { label: "Noted", cls: "bg-zinc-700 text-zinc-100" },
  investigating: { label: "Under investigation", cls: "bg-orange-500 text-black" },
  "after-session": { label: "After the session", cls: "bg-amber-400 text-black" },
  "no-action": { label: "No further action", cls: "bg-green-700 text-white" },
  penalty: { label: "Penalty", cls: "bg-red-600 text-white" },
  info: { label: "Stewards", cls: "bg-zinc-700 text-zinc-100" },
};

export function InvestigationsPanel() {
  const messages = useMessages();
  const offset = useOffset();
  const drivers = usePitwall((s) => s.live.DriverList);
  // Oldest first in, newest first out
  const incidents = useMemo(() => investigations([...messages].reverse()), [messages]);
  if (!incidents.length) return <Empty>No incidents noted yet</Empty>;
  return (
    <div className="h-full overflow-y-auto">
      {incidents.map((inc) => (
        <div key={inc.key} className="border-b border-zinc-800/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATUS[inc.status].cls)}>
              {STATUS[inc.status].label}
            </span>
            {inc.cars.map((n) => (
              <DriverChip key={n} num={n} drivers={drivers} />
            ))}
            {inc.where && <span className="text-[12px] font-semibold text-zinc-300">{inc.where}</span>}
          </div>
          {inc.reason && <p className="mt-1 text-[12.5px] font-semibold text-zinc-100">{inc.reason}</p>}
          {inc.outcome && <p className="mt-0.5 text-[12px] font-bold text-red-400">{inc.outcome}</p>}
          <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
            {inc.happenedAt ? `Incident ${inc.happenedAt}` : ""}
            {inc.lap ? `${inc.happenedAt ? " · " : ""}Lap ${inc.lap}` : ""}
            {` · updated ${trackClock(inc.updatedAt, offset)}`}
            {inc.history.length > 1 && (
              <span title={inc.history.map((h) => `${trackClock(h.at, offset)}  ${h.text}`).join("\n")}> · {inc.history.length} updates</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export function TrackLimitsPanel() {
  const messages = useMessages();
  const drivers = usePitwall((s) => s.live.DriverList);
  const kind = usePitwall((s) => sessionKind(s.live.SessionInfo));
  const tallies = useMemo(() => trackLimits([...messages].reverse()), [messages]);
  const isRace = kind === "race";
  if (!tallies.length) return <Empty>No track limits strikes yet</Empty>;
  return (
    <div className="flex h-full flex-col">
      <p className="shrink-0 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">
        {isRace
          ? "Races: the 3rd strike brings a black and white flag, the next one a penalty."
          : "Deleted laps for exceeding track limits."}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tallies.map((t) => {
          const turns = Object.entries(
            t.strikes.filter((s) => !s.reinstated).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.turn || "?"]: (acc[s.turn || "?"] ?? 0) + 1 }), {})
          );
          const level = t.penalty ? "penalty" : t.blackWhiteFlag || (isRace && t.count >= 3) ? "warn" : "ok";
          return (
            <div key={t.num} className="flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2">
              <DriverChip num={t.num} drivers={drivers} />
              <div className="flex gap-1" title={`${t.count} strike${t.count === 1 ? "" : "s"}`}>
                {Array.from({ length: Math.max(4, t.count) }, (_, i) => (
                  <span
                    key={i}
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: i < t.count ? (i >= 3 ? "#ef4444" : i === 2 ? "#f97316" : "#eab308") : "#27272a" }}
                  />
                ))}
              </div>
              <span className="w-6 text-[14px] font-bold tabular-nums text-zinc-100">{t.count}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-400">
                {turns.map(([turn, n]) => `T${turn}${n > 1 ? ` ×${n}` : ""}`).join(", ")}
                {t.strikes.some((s) => s.reinstated) && <span className="text-green-400"> · reinstated lap</span>}
              </span>
              {level === "penalty" && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.penalty || "PENALTY"}</span>}
              {level === "warn" && (
                <span className="rounded bg-gradient-to-r from-zinc-100 to-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-black ring-1 ring-zinc-500">
                  {t.blackWhiteFlag ? "B/W FLAG" : "NEXT = B/W"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DriverChip({ num, drivers }: { num: string; drivers: Record<string, DriverInfo> | undefined }) {
  const d = drivers?.[num];
  const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
  return (
    <span
      className="w-[40px] shrink-0 rounded py-px text-center text-[11px] font-bold"
      style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
    >
      {d?.Tla ?? num}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500">{children}</div>;
}
