// The season at a glance, adapted from f1-dashboard's calendar: a month grid with the
// race weekends marked (in your time zone, like everything else here) beside the
// picked round's sessions. It pops out of the Calendar button with anime.js.

import { animate, stagger } from "animejs";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/format";
import { PopoverHeader } from "../ui/Popover";
import { useTicker } from "../ui/hooks";
import { sessionState, type Meeting, type Session } from "./catalog";
import { ensureSeason, isSeason, nextSession, shortSessionName, useSchedule } from "./schedule";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const sessionDay = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// Weeks start on Monday; any Monday will do for the day names
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekday.format(new Date(2024, 0, 1 + i)));

/** Local calendar day, as a sortable number (yyyymmdd) */
const dayKey = (t: number | Date) => {
  const d = new Date(t);
  return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
};

const BADGE: [RegExp, string, string][] = [
  [/^Practice/, "", "border-sky-500/40 bg-sky-500/15 text-sky-300"],
  [/^Sprint (Qualifying|Shootout)/, "SQ", "border-orange-500/40 bg-orange-500/15 text-orange-300"],
  [/^Sprint$/, "Sprint", "border-orange-500/40 bg-orange-500/15 text-orange-300"],
  [/^Qualifying/, "Quali", "border-purple-500/40 bg-purple-500/15 text-purple-300"],
  [/^Race/, "Race", "border-f1-red/50 bg-f1-red/20 text-red-200"],
];

function Badge({ name }: { name: string }) {
  const [, label, style] = BADGE.find(([re]) => re.test(name)) ?? [/./, "", "border-zinc-700 text-zinc-300"];
  return (
    <span className={cn("w-[54px] shrink-0 rounded border py-px text-center text-[9.5px] font-black uppercase tracking-wider", style)}>
      {label || shortSessionName(name)}
    </span>
  );
}

function until(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} days`;
}

export function CalendarPanel({ onClose }: { onClose: () => void }) {
  useTicker(1 / 20);
  const now = Date.now();
  const year = new Date().getFullYear();
  const entry = useSchedule((s) => s.seasons[year]);
  const meetings = useMemo(() => (isSeason(entry) ? entry.meetings : []), [entry]);
  const next = useMemo(() => nextSession(meetings, now), [meetings, Math.floor(now / 60_000)]);
  const [selected, setSelected] = useState<number | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => ensureSeason(year), [year]);

  // Open on the round that's next (or on now), in its month
  const focus = next?.meeting ?? meetings.find((m) => m.end > now) ?? meetings.at(-1);
  useEffect(() => {
    if (!focus || selected !== null) return;
    setSelected(focus.key);
    const d = new Date(next?.session.start ?? focus.start);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  }, [focus, next, selected]);
  const shownMonth = month ?? { y: new Date(now).getFullYear(), m: new Date(now).getMonth() };
  const meeting = meetings.find((m) => m.key === selected) ?? null;
  const round = meeting ? meetings.indexOf(meeting) + 1 : 0;

  // Which race weekend each local day belongs to
  const dayToMeeting = useMemo(() => {
    const map = new Map<number, Meeting>();
    for (const m of meetings) {
      if (!m.sessions.length) continue;
      for (let t = m.sessions[0].start; dayKey(t) <= dayKey(m.sessions.at(-1)!.start); t += 86_400_000) map.set(dayKey(t), m);
    }
    return map;
  }, [meetings]);

  const cells = useMemo(() => {
    const first = new Date(shownMonth.y, shownMonth.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(shownMonth.y, shownMonth.m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(shownMonth.y, shownMonth.m, i + 1))] as (Date | null)[];
  }, [shownMonth.y, shownMonth.m]);

  // Days ripple in on a month change; the round's sessions slide in on a pick
  useEffect(() => {
    const days = gridRef.current?.querySelectorAll("[data-day]");
    if (!days?.length || reducedMotion()) return;
    animate(days, { opacity: [0, 1], scale: [0.82, 1], delay: stagger(7, { grid: [7, Math.ceil(days.length / 7)], from: "first" }), duration: 280, ease: "outQuad" });
  }, [shownMonth.y, shownMonth.m, meetings.length]);
  useEffect(() => {
    const rows = detailRef.current?.querySelectorAll("[data-row]");
    if (!rows?.length || reducedMotion()) return;
    animate(rows, { opacity: [0, 1], translateX: [14, 0], delay: stagger(40), duration: 320, ease: "outCubic" });
  }, [selected]);

  const shift = (by: number) => {
    const d = new Date(shownMonth.y, shownMonth.m + by, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const pickRound = (by: number) => {
    const m = meetings[meetings.indexOf(meeting!) + by];
    if (!m) return;
    setSelected(m.key);
    const d = new Date(m.sessions[0]?.start ?? m.start);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const today = dayKey(now);

  return (
    <>
      <PopoverHeader title="Calendar" detail={`${year} season · your time`} onClose={onClose} />

      {!isSeason(entry) ? (
        <p className="p-6 text-center text-[12px] text-zinc-500">
          {entry && typeof entry === "object" && "error" in entry ? `Couldn't load the ${year} calendar. ${entry.error}.` : `Loading the ${year} calendar…`}
        </p>
      ) : (
        <div className="grid grid-cols-[272px_1fr]">
          {/* Month */}
          <div className="border-r border-zinc-800 p-3">
            <div className="mb-2 flex items-center">
              <button onClick={() => shift(-1)} className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Previous month">
                ‹
              </button>
              <span className="flex-1 text-center text-[12px] font-bold text-zinc-200">{monthName.format(new Date(shownMonth.y, shownMonth.m, 1))}</span>
              <button onClick={() => shift(1)} className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Next month">
                ›
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7 text-center text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              {WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div ref={gridRef} className="grid grid-cols-7 gap-[3px]">
              {cells.map((d, i) => {
                if (!d) return <span key={`blank-${i}`} />;
                const key = dayKey(d);
                const m = dayToMeeting.get(key);
                const isRace = !!m && m.sessions.some((s) => /^Race$/.test(s.name) && dayKey(s.start) === key);
                const sprint = !!m && m.sessions.some((s) => s.name === "Sprint");
                const picked = !!m && m.key === selected;
                return (
                  <button
                    key={key}
                    data-day
                    disabled={!m}
                    onClick={() => m && setSelected(m.key)}
                    data-tip={m ? `${m.name}${m.cancelled ? " (cancelled)" : ""}` : undefined}
                    className={cn(
                      "relative flex h-[30px] items-center justify-center rounded-md text-[11.5px] tabular-nums transition-colors",
                      picked ? "bg-f1-red/80 font-bold text-white" : m ? (m.cancelled ? "bg-zinc-900 text-zinc-600 line-through" : "bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700") : "text-zinc-500",
                      key === today && "ring-1 ring-sky-400"
                    )}
                  >
                    {d.getDate()}
                    {isRace && !m!.cancelled && (
                      <i className={cn("absolute bottom-[3px] h-[4px] w-[4px] rounded-full", picked ? "bg-white" : sprint ? "bg-purple-400" : "bg-f1-red")} />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1">
                <i className="h-[5px] w-[5px] rounded-full bg-f1-red" /> Race
              </span>
              <span className="flex items-center gap-1">
                <i className="h-[5px] w-[5px] rounded-full bg-purple-400" /> Sprint weekend
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded ring-1 ring-sky-400" /> Today
              </span>
            </div>
          </div>

          {/* Round */}
          <div ref={detailRef} className="min-w-0 p-3">
            {meeting ? (
              <>
                <div data-row className="flex items-center gap-2">
                  <button onClick={() => pickRound(-1)} disabled={round <= 1} className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30" aria-label="Previous round">
                    ‹
                  </button>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Round {round}</span>
                  <button onClick={() => pickRound(1)} disabled={round >= meetings.length} className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30" aria-label="Next round">
                    ›
                  </button>
                  <RoundState meeting={meeting} now={now} isNext={next?.meeting.key === meeting.key} />
                </div>
                <div data-row className="mt-1.5 flex items-center gap-2">
                  {meeting.flag && <img src={meeting.flag} alt="" className="h-5 w-7 rounded-sm object-cover" />}
                  <div className="min-w-0">
                    <p className={cn("truncate text-[15px] font-black", meeting.cancelled ? "text-zinc-500 line-through" : "text-zinc-50")}>{meeting.name}</p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {meeting.circuit} · {meeting.location}
                      {meeting.sessions.length > 0 && (
                        <span className="text-zinc-500">
                          {" "}
                          · {dayMonth.format(meeting.sessions[0].start)} – {dayMonth.format(meeting.sessions.at(-1)!.start)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {next?.meeting.key === meeting.key && !next.live && (
                  <p data-row className="mt-2 rounded-md bg-amber-400/10 px-2 py-1 text-[11px] font-bold text-amber-300">
                    {next.session.name} {until(next.session.start - now)}
                  </p>
                )}
                <div className="mt-2 space-y-1">
                  {meeting.sessions.map((s) => (
                    <SessionRow key={s.key} session={s} now={now} cancelled={meeting.cancelled} />
                  ))}
                  {!meeting.sessions.length && <p className="text-[11px] text-zinc-500">No sessions listed yet.</p>}
                </div>
              </>
            ) : (
              <p className="pt-6 text-center text-[12px] text-zinc-500">Pick a race weekend.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function RoundState({ meeting, now, isNext }: { meeting: Meeting; now: number; isNext: boolean }) {
  const [label, style] = meeting.cancelled
    ? ["Cancelled", "bg-zinc-800 text-zinc-400"]
    : meeting.sessions.some((s) => sessionState(s, now) === "live")
      ? ["On now", "animate-pulse bg-f1-red text-white"]
      : meeting.sessions.length && meeting.sessions.every((s) => sessionState(s, now) === "past")
        ? ["Done", "bg-zinc-800 text-zinc-400"]
        : isNext
          ? ["Next", "bg-sky-500/20 text-sky-300"]
          : ["Upcoming", "bg-zinc-800 text-zinc-300"];
  return <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider", style)}>{label}</span>;
}

function SessionRow({ session, now, cancelled }: { session: Session; now: number; cancelled: boolean }) {
  const state = sessionState(session, now);
  return (
    <div data-row className={cn("flex h-7 items-center gap-2 rounded-md px-2", state === "live" ? "bg-f1-red/15" : "bg-zinc-900/70", (state === "past" || cancelled) && "opacity-55")}>
      <Badge name={session.name} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">{session.name}</span>
      <span className="w-[86px] text-right text-[11px] tabular-nums text-zinc-400">{sessionDay.format(session.start)}</span>
      <span className="w-[40px] text-right text-[12px] font-bold tabular-nums text-zinc-100">{clock.format(session.start)}</span>
      <span className="w-[62px] text-right text-[10.5px] text-zinc-500">
        {cancelled ? "" : state === "live" ? <b className="text-f1-red">LIVE</b> : state === "past" ? "✓ done" : until(session.start - now)}
      </span>
    </div>
  );
}
