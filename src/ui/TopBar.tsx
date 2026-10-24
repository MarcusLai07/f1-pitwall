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
        <LayoutMenu />
      </div>
    </header>
  );
}

function SessionTitle({ compact }: { compact: boolean }) {
  const info = usePitwall((s) => s.live.SessionInfo);
  const track = usePitwall((s) => s.live.TrackStatus);
  const status = TRACK_STATUS[track?.Status ?? ""];
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="min-w-0">
        <div className={cn("truncate font-f1 font-bold text-zinc-100", compact ? "text-xs" : "text-sm")}>
          {info?.Meeting?.Name ?? "Pit Wall"}
          {info?.Name && <span className="text-zinc-400"> · {info.Name}</span>}
        </div>
      </div>
      {status && (
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
  const gmtOffset = usePitwall((s) => s.live.SessionInfo?.GmtOffset);
  const offset = parseGmtOffset(gmtOffset);
  const now = trackNow();
  let remaining = parseDuration(clock?.Remaining);
  if (clock?.Extrapolating) remaining -= now - parseUtc(clock.Utc);
  return (
    <div className="flex items-center gap-4 font-f1 tabular-nums">
      {Number.isFinite(remaining) && <Field label="Remaining" value={formatDuration(remaining)} />}
      {laps?.TotalLaps ? <Field label="Lap" value={`${laps.CurrentLap ?? 0}/${laps.TotalLaps}`} /> : null}
      {/* Same moment twice: at the circuit, and in your own time zone */}
      <Field label="Track time" zone={gmtOffset ? utcLabel(offset) : undefined} value={trackClock(now, offset)} />
      <Field label="Your time" zone={localZone(now)} value={localClock(now)} accent="text-sky-200" />
    </div>
  );
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

function Field({ label, value, zone, accent }: { label: string; value: string; zone?: string; accent?: string }) {
  return (
    <div className="flex flex-col leading-tight">
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
      {source === "replay" && <BarButton onClick={onGoLive}>Go live</BarButton>}
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
      <BarButton onClick={() => setOpen((o) => !o)} title="Past, live and upcoming sessions, and your F1 TV sign-in">
        Sessions
      </BarButton>
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

function LayoutMenu() {
  const { items, locked, packing, add, reset, setLocked, setPacking } = useLayout();
  const [open, setOpen] = useState(false);
  const hidden = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !items.some((it) => it.i === id));
  return (
    <div className="relative">
      <BarButton onClick={() => setOpen((o) => !o)}>Layout</BarButton>
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

export function BarButton({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-zinc-600 hover:text-white"
    >
      {children}
    </button>
  );
}
