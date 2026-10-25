// Bottom drawer under the timing tower: race control, investigations, track limits and
// race trace as tabs. New race control messages pop up above it as notifications.

import { useMemo } from "react";
import { investigations } from "../data/stewards";
import { raceControlMessages } from "../data/derive";
import { usePitwall } from "../data/store";
import { cn, parseGmtOffset, parseUtc, trackClock } from "../lib/format";
import { InvestigationsPanel, RaceControlPanel, TrackLimitsPanel, messageColor } from "./Panels";
import { RaceTracePanel } from "./RaceTrace";
import { LapTimesPanel } from "./LapTimes";
import { RaceBriefPanel } from "./RaceBrief";
import { useNotify, useRaceControlNotifications, type DrawerTab } from "./notifyStore";

const TABS: { id: DrawerTab; label: string }[] = [
  { id: "racecontrol", label: "Race control" },
  { id: "investigations", label: "Investigations" },
  { id: "limits", label: "Track limits" },
  { id: "laps", label: "Lap times" },
  { id: "trace", label: "Race trace" },
];

export const DRAWER_BAR_PX = 36;

export function Drawer({ left, width }: { left: number; width: number }) {
  useRaceControlNotifications();
  const { open, unread, openTab } = useNotify();
  const rc = usePitwall((s) => s.live.RaceControlMessages);
  // Investigations badge counts open cases rather than unread messages
  const openCases = useMemo(() => {
    const msgs = raceControlMessages({ RaceControlMessages: rc }).reverse();
    return investigations(msgs).filter((i) => i.status === "investigating" || i.status === "after-session").length;
  }, [rc]);

  return (
    <div className="pointer-events-none absolute bottom-0 z-40 flex flex-col" style={{ left, width }}>
      <Toasts />
      <div
        className={cn(
          "pointer-events-auto overflow-hidden rounded-t-lg border-x border-t border-zinc-700 bg-zinc-950/97 shadow-2xl shadow-black/60 backdrop-blur transition-[height,opacity] duration-300 ease-out",
          open ? "h-[min(420px,55vh)] opacity-100" : "h-0 border-transparent opacity-0"
        )}
      >
        {open === "racecontrol" && <RaceControlPanel />}
        {open === "investigations" && <InvestigationsPanel />}
        {open === "limits" && <TrackLimitsPanel />}
        {open === "laps" && <LapTimesPanel />}
        {open === "trace" && <RaceTracePanel />}
        {open === "racebrief" && <RaceBriefPanel />}
      </div>
      <div
        className="pointer-events-auto flex items-center gap-1 border-x border-t border-zinc-800 bg-zinc-950/95 px-1.5 backdrop-blur"
        style={{ height: DRAWER_BAR_PX }}
      >
        {TABS.map((t) => {
          const badge = t.id === "investigations" ? openCases : unread[t.id];
          return (
            <button
              key={t.id}
              onClick={() => openTab(open === t.id ? null : t.id)}
              className={cn(
                "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
                open === t.id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              )}
            >
              {t.label}
              {badge > 0 && (
                <span
                  className={cn(
                    "min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[16px] text-white",
                    t.id === "investigations" ? "bg-orange-500 text-black" : "bg-f1-red"
                  )}
                >
                  {badge}
                </span>
              )}
              {open === t.id && <span className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded bg-f1-red" />}
            </button>
          );
        })}
        <span className="mx-1 ml-auto h-4 w-px bg-zinc-800" />
        <button
          onClick={() => openTab(open === "racebrief" ? null : "racebrief")}
          title="Pre-race brief: weather, what's at stake, circuit guide"
          className={cn(
            "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
            open === "racebrief" ? "bg-zinc-800 text-white" : "text-amber-300/90 hover:bg-zinc-900 hover:text-amber-200",
            open !== "racebrief" && "race-brief-beam"
          )}
        >
          {/* The chevron is the open/closed tell: up to pull the brief up, down to drop it */}
          <span aria-hidden className={cn("inline-block text-[9px] leading-none transition-transform duration-300 ease-out", open !== "racebrief" && "rotate-180")}>
            ▾
          </span>
          Race brief
          {open === "racebrief" && <span className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded bg-amber-400" />}
        </button>
        {/* Race brief has its own animated chevron, so it needs no separate close button */}
        {open && open !== "racebrief" && (
          <button
            onClick={() => openTab(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white"
            title="Close drawer"
          >
            ▾
          </button>
        )}
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts, openTab, dismiss } = useNotify();
  const offset = usePitwall((s) => parseGmtOffset(s.live.SessionInfo?.GmtOffset));
  return (
    <div className="flex flex-col-reverse gap-1.5 px-1 pb-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-in pointer-events-auto flex cursor-pointer items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/97 shadow-xl shadow-black/50 backdrop-blur hover:border-zinc-500"
          onClick={() => openTab(t.tab)}
          title="Open in the drawer"
        >
          <span className="w-1.5 shrink-0" style={{ background: messageColor(t.message) }} />
          <div className="min-w-0 flex-1 px-3 py-2">
            <p className="text-[12.5px] font-semibold leading-snug text-zinc-100">{t.message.Message}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
              {trackClock(parseUtc(t.message.Utc), offset)}
              {t.message.Lap ? ` · Lap ${t.message.Lap}` : ""}
              <span className="text-zinc-500"> · {TABS.find((x) => x.id === t.tab)?.label}</span>
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="px-2.5 text-zinc-500 hover:text-zinc-200"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
