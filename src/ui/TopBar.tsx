import { useState } from "react";
import { useLiveSettings } from "../data/liveSettings";
import { feedDelay, trackNow, usePitwall, type Via } from "../data/store";
import { TRACK_STATUS, cn, formatDuration, parseDuration, parseGmtOffset, parseUtc, trackClock } from "../lib/format";
import { useLayout } from "../layout/layoutStore";
import { WIDGETS, type WidgetId } from "../widgets/registry";
import { useTicker } from "./hooks";
import { HeaderWeather } from "./HeaderWeather";
import { currentScale, useUiScale } from "./scale";
import { useF1Account } from "../sessions/f1account";
import { CalendarIcon, LayoutIcon, RadioIcon, SessionsIcon } from "./icons";
import { shortSessionName, useNextSession } from "../sessions/schedule";
import { CalendarPanel } from "../sessions/CalendarPanel";
import { SessionPicker } from "../sessions/SessionPicker";

interface Props {
  onGoLive: () => void;
  onOpenArchive: (path: string, name: string) => void;
}

export function TopBar({ onGoLive, onOpenArchive }: Props) {
  const view = useLayout((s) => s.view);
  const compact = view === "panel";
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5">
      <SessionTitle compact={compact} />
      <SessionClock />
      <HeaderWeather compact={compact} />
      <div className="ml-auto flex items-center gap-2">
        <SourceStatus onGoLive={onGoLive} compact={compact} />
        <SessionsButton onGoLive={onGoLive} onOpenArchive={onOpenArchive} />
        <CalendarButton />
        <LayoutMenu />
      </div>
    </header>
  );
}

/** Live mode with nothing running: the header looks ahead to the next session instead */
function useIdle(): boolean {
  return usePitwall((s) => s.source === "live" && s.status !== "connected");
}

function SessionTitle({ compact }: { compact: boolean }) {
  const info = usePitwall((s) => s.live.SessionInfo);
  const track = usePitwall((s) => s.live.TrackStatus);
  const idle = useIdle();
  const next = useNextSession();
  const status = TRACK_STATUS[track?.Status ?? ""];
  const title = idle && next ? { meeting: next.meeting.name, session: next.session.name } : { meeting: info?.Meeting?.Name, session: info?.Name };
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {idle && next && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider",
            next.live ? "animate-pulse bg-f1-red text-white" : "bg-sky-500/20 text-sky-300"
          )}
          title={next.live ? "On now by the schedule; F1's feed hasn't started it yet" : "The next session on the calendar"}
        >
          {next.live ? "Now" : "Next"}
        </span>
      )}
      <div className="min-w-0">
        <div className={cn("truncate font-f1 font-bold text-zinc-100", compact ? "text-xs" : "text-sm")}>
          {title.meeting ?? "Pit Wall"}
          {title.session && <span className="text-zinc-400"> · {title.session}</span>}
        </div>
      </div>
      {!idle && status && (
        <span
          className="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black"
          style={{ backgroundColor: status.color }}
        >
          {status.label}
        </span>
      )}
    </div>
  );
}

function SessionClock() {
  useTicker(2);
  const clock = usePitwall((s) => s.live.ExtrapolatedClock);
  const laps = usePitwall((s) => s.live.LapCount);
  const sessionOffset = usePitwall((s) => s.live.SessionInfo?.GmtOffset);
  const idle = useIdle();
  const source = usePitwall((s) => s.source);
  const next = useNextSession();
  // Nothing running: the clocks are the real now, at the next session's circuit
  const gmtOffset = idle ? next?.session.gmtOffset ?? sessionOffset : sessionOffset;
  const offset = parseGmtOffset(gmtOffset);
  const now = idle ? Date.now() : trackNow();
  let remaining = parseDuration(clock?.Remaining);
  if (clock?.Extrapolating) remaining -= now - parseUtc(clock.Utc);
  const showCountdown = next && (idle || source === "replay");
  return (
    <div className="flex items-center gap-4 font-f1 tabular-nums">
      {!idle && Number.isFinite(remaining) && <Field label="Remaining" value={formatDuration(remaining)} />}
      {!idle && laps?.TotalLaps ? <Field label="Lap" value={`${laps.CurrentLap ?? 0}/${laps.TotalLaps}`} /> : null}
      {/* Same moment twice: at the circuit, and in your own time zone */}
      <Field label="Track time" zone={gmtOffset ? utcLabel(offset) : undefined} value={trackClock(now, offset)} />
      <Field label="Your time" zone={localZone(now)} value={localClock(now)} accent="text-sky-200" />
      {showCountdown &&
        (next.live ? (
          <Field label={shortSessionName(next.session.name)} value="On now" accent="text-f1-red" />
        ) : (
          <Field
            label={`${shortSessionName(next.session.name)} in`}
            value={countdown(next.session.start - Date.now())}
            accent="text-amber-300"
            title={`${next.meeting.name} · ${next.session.name}, ${new Date(next.session.start).toLocaleString()}`}
          />
        ))}
    </div>
  );
}

/** 28_351_000 → "7:52:31"; past a day, "2d 07:52:31" */
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hms = [Math.floor((s % 86_400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return d ? `${d}d ${pad(hms[0])}:${pad(hms[1])}:${pad(hms[2])}` : `${hms[0]}:${pad(hms[1])}:${pad(hms[2])}`;
}

/** -18000000 -> "UTC−5" */
function utcLabel(offsetMs: number): string {
  const h = offsetMs / 3_600_000;
  if (!h) return "UTC";
  const abs = Math.abs(h);
  const text = Number.isInteger(abs) ? String(abs) : `${Math.floor(abs)}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")}`;
  return `UTC${h < 0 ? "−" : "+"}${text}`;
}

const localTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const localZoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });

function localClock(epochMs: number): string {
  return Number.isFinite(epochMs) ? localTime.format(epochMs) : "--:--:--";
}

function localZone(epochMs: number): string | undefined {
  if (!Number.isFinite(epochMs)) return undefined;
  return localZoneName.formatToParts(epochMs).find((p) => p.type === "timeZoneName")?.value;
}

function Field({ label, value, zone, accent, title }: { label: string; value: string; zone?: string; accent?: string; title?: string }) {
  return (
    <div className="flex flex-col leading-tight" title={title}>
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">
        {label}
        {zone && <span className="ml-1 normal-case tracking-normal text-zinc-600">{zone}</span>}
      </span>
      <span className={cn("text-sm font-bold", accent ?? "text-zinc-100")}>{value}</span>
    </div>
  );
}

const FROM: Record<Via, string> = { f1: "F1", archive: "F1 TV archive", file: "Recording" };

/** What the board shows and where it comes from; its menu sets the live delay */
function SourceStatus({ onGoLive, compact }: Pick<Props, "onGoLive"> & { compact: boolean }) {
  useTicker(1);
  const source = usePitwall((s) => s.source);
  const via = usePitwall((s) => s.via);
  const status = usePitwall((s) => s.status);
  const error = usePitwall((s) => s.error);
  const loading = usePitwall((s) => s.replay?.loadProgress);
  const signedIn = useF1Account((s) => s.state === "signed-in");
  const [open, setOpen] = useState(false);
  const delay = feedDelay();

  const dot =
    source === "replay"
      ? "bg-sky-400"
      : status === "connected"
        ? "bg-green-500 animate-pulse"
        : status === "offline"
          ? "bg-red-500"
          : "bg-zinc-500";
  const label =
    status === "error"
      ? "Couldn't load"
      : source === "replay"
        ? loading != null
          ? `Loading ${Math.round(loading * 100)}%`
          : "Replay"
        : status === "connected"
          ? "Live"
          : status === "offline"
            ? "Offline"
            : status === "waiting"
              ? "No live session"
              : "Connecting";
  const from = via === "f1" ? (signedIn ? "F1 TV" : "F1 free feed") : FROM[via];

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-zinc-600"
        title={error ?? "Where the data comes from"}
      >
        <i className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
        <span className="font-semibold normal-case tracking-normal text-zinc-400">· {from}</span>
        {source === "live" && status === "connected" && delay != null && !compact && (
          <span className="font-semibold normal-case tracking-normal text-zinc-500">{Math.round(delay / 1000)} s behind</span>
        )}
        <span className="text-zinc-500">▾</span>
      </button>
      {source === "replay" && (
        <IconButton
          label="Go live"
          hint="Back to F1's live timing"
          icon={<RadioIcon className="h-4 w-4" />}
          onClick={onGoLive}
          className="border-f1-red/50 text-red-300 hover:border-f1-red hover:text-white"
        />
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <SourceMenu />
        </>
      )}
    </div>
  );
}

function SourceMenu() {
  const { delaySec, setDelay } = useLiveSettings();
  const source = usePitwall((s) => s.source);
  const via = usePitwall((s) => s.via);
  const error = usePitwall((s) => s.error);
  const signedIn = useF1Account((s) => s.state === "signed-in");
  return (
    <div className="absolute right-0 top-8 z-50 w-72 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 font-f1 text-[11px] leading-snug text-zinc-400 shadow-xl">
      {source === "replay" ? (
        <p>
          <span className="font-semibold text-zinc-100">{via === "archive" ? "A past session from F1's archive" : "A recording"}</span>, played back.
          Space plays and pauses; <span className="text-zinc-200">Go live</span> switches back.
        </p>
      ) : (
        <>
          <p className="font-semibold text-zinc-100">{signedIn ? "F1's live timing, with your F1 TV login" : "F1's free live timing feed"}</p>
          <p className="mt-0.5">
            {signedIn
              ? "Timing, cars on the map, telemetry and team radio, straight from F1."
              : "Timing, sectors and race control. Sign in to F1 TV (in Sessions) for cars on the map, telemetry and team radio."}
          </p>
          <div className="mt-2 flex items-center gap-1 text-xs text-zinc-300">
            <span className="flex-1">Delay</span>
            {[-5, -1].map((d) => (
              <button key={d} onClick={() => setDelay(delaySec + d)} className="h-6 w-7 rounded border border-zinc-700 text-[10px] hover:bg-zinc-800">
                {d}
              </button>
            ))}
            <span className="w-10 text-center tabular-nums">{delaySec} s</span>
            {[1, 5].map((d) => (
              <button key={d} onClick={() => setDelay(delaySec + d)} className="h-6 w-7 rounded border border-zinc-700 text-[10px] hover:bg-zinc-800">
                +{d}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">F1's feed runs ahead of most video streams. Raise the delay until the timing matches what you're watching.</p>
          {via === "f1" && <FeedCheck />}
        </>
      )}
      {error && <p className="mt-1.5 text-[10px] text-amber-400">{error}</p>}
    </div>
  );
}

// What each part of the board needs from F1's feed
const FEED_PARTS: [string, string][] = [
  ["TimingData", "Timing"],
  ["Position", "Cars on the map"],
  ["CarData", "Telemetry"],
  ["TeamRadio", "Team radio"],
  ["RaceControlMessages", "Race control"],
];

/** Which of those F1 is actually sending to this connection */
function FeedCheck() {
  const feed = usePitwall((s) => s.feed);
  const product = useF1Account((s) => s.product);
  if (!feed) return null;
  const missing = FEED_PARTS.filter(([t]) => !feed.topics.includes(t)).map(([, label]) => label);
  const carsMissing = !feed.topics.includes("Position") || !feed.topics.includes("CarData");
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-500">F1 is sending</p>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {FEED_PARTS.map(([topic, label]) => {
          const ok = feed.topics.includes(topic);
          return (
            <span key={topic} className={ok ? "text-zinc-200" : "text-zinc-500"}>
              <span className={ok ? "text-green-400" : "text-zinc-600"}>{ok ? "✓" : "–"}</span> {label}
            </span>
          );
        })}
      </div>
      {feed.withToken && carsMissing && (
        <p className="mt-1.5 text-[10px] text-amber-300/90">
          F1 hasn't sent {missing.filter((m) => m === "Cars on the map" || m === "Telemetry").join(" or ").toLowerCase()} to your login
          {product ? ` (${product})` : ""} so far. Outside a running session it may simply have nothing to send.
        </p>
      )}
    </div>
  );
}

function SessionsButton({ onGoLive, onOpenArchive }: Pick<Props, "onGoLive" | "onOpenArchive">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton
        label="Sessions"
        hint="Past, live and upcoming sessions · F1 TV sign-in"
        icon={<SessionsIcon className="h-4 w-4" />}
        active={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <SessionPicker
            onClose={() => setOpen(false)}
            onGoLive={onGoLive}
            onOpenArchive={(path, name) => {
              setOpen(false);
              onOpenArchive(path, name);
            }}
          />
        </>
      )}
    </div>
  );
}

function CalendarButton() {
  // Closing plays the panel's exit animation before it unmounts
  const [state, setState] = useState<"closed" | "open" | "closing">("closed");
  const close = () => setState((s) => (s === "open" ? "closing" : s));
  return (
    <div className="relative">
      <IconButton
        label="Calendar"
        hint="The season at a glance"
        icon={<CalendarIcon className="h-4 w-4" />}
        active={state !== "closed"}
        onClick={() => (state === "closed" ? setState("open") : close())}
      />
      {state !== "closed" && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <CalendarPanel closing={state === "closing"} onClose={close} onClosed={() => setState("closed")} />
        </>
      )}
    </div>
  );
}

function LayoutMenu() {
  const { items, locked, packing, add, reset, setLocked, setPacking } = useLayout();
  const [open, setOpen] = useState(false);
  const hidden = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !items.some((it) => it.i === id));
  return (
    <div className="relative">
      <IconButton
        label="Layout"
        hint="Widgets, UI size and arrangement"
        icon={<LayoutIcon className="h-4 w-4" />}
        active={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-52 rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
            <UiSize />
            <div className="my-1 h-px bg-zinc-800" />
            <MenuItem
              onClick={() => {
                setLocked(!locked);
                setOpen(false);
              }}
            >
              {locked ? "Unlock layout" : "Lock layout"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setPacking(packing === "pack" ? "free" : "pack");
                setOpen(false);
              }}
            >
              {packing === "pack" ? "Free placement" : "Snap widgets upward"}
            </MenuItem>
            {hidden.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[9px] uppercase tracking-wider text-zinc-500">Add widget</p>}
            {hidden.map((id) => (
              <MenuItem
                key={id}
                onClick={() => {
                  add(id);
                  setOpen(false);
                }}
              >
                + {WIDGETS[id].title}
              </MenuItem>
            ))}
            <div className="my-1 h-px bg-zinc-800" />
            <MenuItem
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Reset to default
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

/** Multiplies the automatic fit-to-window scale */
function UiSize() {
  const { factor, setFactor } = useUiScale();
  const step = (d: number) => setFactor(factor + d);
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-300">
      <span className="flex-1" title={`Fits the window automatically; this adjusts it (now ${Math.round(currentScale() * 100)}% zoom)`}>
        UI size
      </span>
      <button onClick={() => step(-0.1)} className="h-6 w-6 rounded border border-zinc-700 hover:bg-zinc-800" aria-label="Smaller">
        −
      </button>
      <button onClick={() => setFactor(1)} className="w-12 rounded py-0.5 text-center tabular-nums hover:bg-zinc-800" title="Back to automatic">
        {factor === 1 ? "Auto" : `${Math.round(factor * 100)}%`}
      </button>
      <button onClick={() => step(0.1)} className="h-6 w-6 rounded border border-zinc-700 hover:bg-zinc-800" aria-label="Larger">
        +
      </button>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white">
      {children}
    </button>
  );
}

/**
 * A square icon button whose tooltip eases in below it after a short hover (or on
 * keyboard focus), and stays out of the way while its own panel is open.
 */
function IconButton({
  label,
  hint,
  icon,
  onClick,
  active = false,
  align = "end",
  className,
}: {
  label: string;
  hint?: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  /** "end" lines the tooltip up with the button's right edge (the buttons sit at the right of the bar) */
  align?: "center" | "end";
  className?: string;
}) {
  return (
    <div className="group/tip relative">
      <button
        onClick={onClick}
        aria-label={label}
        aria-expanded={active || undefined}
        className={cn(
          "flex h-7 w-8 items-center justify-center rounded-md border transition-colors duration-150",
          active ? "border-zinc-500 bg-zinc-800 text-white" : "border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white",
          className
        )}
      >
        <span className="transition-transform duration-200 ease-out group-hover/tip:scale-110 group-active/tip:scale-95">{icon}</span>
      </button>
      {!active && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute top-full z-50 mt-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 font-f1 shadow-xl shadow-black/50 backdrop-blur",
            // Hidden until a short hover (or keyboard focus), then it springs down into place
            "invisible -translate-y-1 scale-95 opacity-0 transition-[opacity,translate,scale,visibility] duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1.25)]",
            "group-hover/tip:visible group-hover/tip:translate-y-0 group-hover/tip:scale-100 group-hover/tip:opacity-100 group-hover/tip:delay-300",
            "group-has-[:focus-visible]/tip:visible group-has-[:focus-visible]/tip:translate-y-0 group-has-[:focus-visible]/tip:scale-100 group-has-[:focus-visible]/tip:opacity-100",
            align === "end" ? "right-0 origin-top-right" : "left-1/2 -translate-x-1/2 origin-top"
          )}
        >
          <i
            className={cn(
              "absolute -top-[5px] h-2 w-2 rotate-45 border-l border-t border-zinc-700 bg-zinc-900",
              align === "end" ? "right-3" : "left-1/2 -translate-x-1/2"
            )}
          />
          <b className="block text-[11px] font-bold text-zinc-100">{label}</b>
          {hint && <span className="block text-[10px] text-zinc-400">{hint}</span>}
        </span>
      )}
    </div>
  );
}
