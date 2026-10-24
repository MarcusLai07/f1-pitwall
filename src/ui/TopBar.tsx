import { useRef, useState } from "react";
import { feedDelay, trackNow, usePitwall } from "../data/store";
import { TRACK_STATUS, cn, formatDuration, parseDuration, parseGmtOffset, parseUtc, trackClock } from "../lib/format";
import { useLayout } from "../layout/layoutStore";
import { WIDGETS, type WidgetId } from "../widgets/registry";
import { useTicker } from "./hooks";
import { HeaderWeather } from "./HeaderWeather";

interface Props {
  onGoLive: () => void;
  onOpenRecording: (file: File) => void;
}

export function TopBar({ onGoLive, onOpenRecording }: Props) {
  const view = useLayout((s) => s.view);
  const compact = view === "panel";
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5">
      <SessionTitle compact={compact} />
      <SessionClock />
      <HeaderWeather compact={compact} />
      <div className="ml-auto flex items-center gap-2">
        <SourceStatus onGoLive={onGoLive} onOpenRecording={onOpenRecording} compact={compact} />
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

function SourceStatus({ onGoLive, onOpenRecording, compact }: Props & { compact: boolean }) {
  useTicker(1);
  const source = usePitwall((s) => s.source);
  const status = usePitwall((s) => s.status);
  const error = usePitwall((s) => s.error);
  const loading = usePitwall((s) => s.replay?.loadProgress);
  const fileRef = useRef<HTMLInputElement>(null);
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
      ? "Couldn't load recording"
      : source === "replay"
      ? loading != null
        ? `Loading ${Math.round(loading * 100)}%`
        : "Replay"
      : status === "connected"
        ? "Live"
        : status === "offline"
          ? "MultiViewer offline"
          : status === "waiting"
            ? "No live session"
            : "Connecting";

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300"
        title={
          source === "live"
            ? error ?? "Reading MultiViewer's live timing at localhost:10101. The delay matches MultiViewer's video."
            : undefined
        }
      >
        <i className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
        {source === "live" && status === "connected" && delay != null && !compact && (
          <span className="font-semibold normal-case tracking-normal text-zinc-500">{Math.round(delay / 1000)} s behind</span>
        )}
      </span>
      {source === "replay" ? (
        <BarButton onClick={onGoLive}>Go live</BarButton>
      ) : (
        <BarButton onClick={() => fileRef.current?.click()} title="Replay a recording made with npm run record">
          Replay…
        </BarButton>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".gz,.ndjson,.jsonl"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onOpenRecording(f);
          e.target.value = "";
        }}
      />
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
          <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
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
