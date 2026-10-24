// Every session of a season, past, live and upcoming. A past one loads straight from
// F1's timing archive with your F1 TV sign-in (timing, map, telemetry; no video), or
// opens in MultiViewer with its video. Live ones open in MultiViewer, which Pit Wall
// follows.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveAuthError, archivePath } from "../data/archive";
import { openInMultiViewer } from "../data/multiviewer";
import { usePitwall } from "../data/store";
import { cn } from "../lib/format";
import { loadValue, saveValue } from "../lib/storage";
import { useTicker } from "../ui/hooks";
import { CatalogRefused, findContentId, loadSeason, sessionState, type Meeting, type ScheduleSource, type Session } from "./catalog";
import { openSignIn, useF1Account } from "./f1account";

const FIRST_YEAR = 2023; // OpenF1's history starts here
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function relative(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  const text = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  return ms > 0 ? `in ${text}` : `${text} ago`;
}

interface Props {
  onClose: () => void;
  /** MultiViewer is opening a session: Pit Wall should follow its live timing */
  onWatching: () => void;
  onOpenArchive: (path: string, name: string) => void;
}

export function SessionPicker({ onClose, onWatching, onOpenArchive }: Props) {
  useTicker(1 / 30); // keep "in 12 min" current
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [season, setSeason] = useState<{ meetings: Meeting[]; source: ScheduleSource } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [replace, setReplace] = useState(true);
  const showing = usePitwall((s) => s.live.SessionInfo?.Key);
  const account = useF1Account();
  const currentRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  useEffect(() => {
    loadValue<boolean>("picker:replace").then((v) => v !== undefined && setReplace(v));
  }, []);

  // Signing in can unlock the archive's schedule when OpenF1 is closed, so retry then
  const signedIn = account.state === "signed-in";
  useEffect(() => {
    let alive = true;
    setSeason(null);
    setError(null);
    loadSeason(year)
      .then((s) => alive && setSeason(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [year, signedIn]);

  // The meeting happening now, or the next one
  const focusKey = useMemo(
    () => season?.meetings.find((m) => m.end + 86_400_000 >= Date.now() && !m.cancelled)?.key,
    [season]
  );
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, [focusKey]);

  const load = async (s: Session, m: Meeting) => {
    setNote(null);
    if (account.state !== "signed-in") {
      setNote({
        text: account.state === "unavailable" ? "Loading from F1's archive works in the Pit Wall extension." : "Sign in to F1 TV first (below).",
        bad: true,
      });
      return;
    }
    setBusy(s.key);
    try {
      const path = s.path ?? (await archivePath(new Date(s.start).getUTCFullYear(), s.key));
      if (!path) {
        setNote({ text: `F1's archive doesn't have ${m.name} · ${s.name} yet.`, bad: true });
        return;
      }
      onOpenArchive(path, `${m.name} · ${s.name}`);
    } catch (err) {
      setNote({
        text: err instanceof ArchiveAuthError ? "F1 refused the sign-in. Open formula1.com to renew it, then try again." : err instanceof Error ? err.message : String(err),
        bad: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const watch = async (s: Session, m: Meeting) => {
    setBusy(s.key);
    setNote(null);
    try {
      const contentId = await findContentId(s, m);
      if (!contentId) {
        setNote({ text: `F1 TV doesn't have ${m.name} · ${s.name} yet.`, bad: true });
        return;
      }
      await openInMultiViewer(contentId, { replace });
      onWatching();
      setNote({ text: `Opened ${s.name} in MultiViewer. Pit Wall follows it once its timing loads.` });
      setTimeout(onClose, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNote({
        text: err instanceof CatalogRefused
          ? import.meta.env.DEV
            ? "F1 TV refuses lookups from the localhost dev page. Use the Pit Wall extension (load dist in Dia)."
            : "F1 TV refused the lookup. Try again in a moment."
          : /fetch|MultiViewer API|NetworkError/i.test(msg)
          ? "MultiViewer isn't reachable. Open it (signed in to F1 TV) and try again."
          : msg,
        bad: true,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="absolute right-0 top-9 z-50 flex max-h-[min(640px,80vh)] w-[min(600px,92vw)] flex-col rounded-xl border border-zinc-700 bg-zinc-950/97 font-f1 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-200">Sessions</span>
        <div className="ml-2 flex overflow-hidden rounded-md border border-zinc-800">
          {Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i).map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={cn("px-2 py-0.5 text-[11px] font-bold", y === year ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
            >
              {y}
            </button>
          ))}
        </div>
        {season && season.source !== "openf1" && (
          <span className="text-[10px] text-zinc-500" title="OpenF1 is closed to free users while a session is live">
            {season.source === "saved" ? "saved schedule" : "from F1's archive"}
          </span>
        )}
        <button onClick={onClose} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="p-4 text-center text-[12px] text-red-400">
            Couldn't load the {year} schedule. {error}.
            {account.state === "signed-out" || account.state === "expired" ? " Sign in to F1 TV to read it from F1's archive instead." : ""}
          </p>
        )}
        {!season && !error && <p className="p-4 text-center text-[12px] text-zinc-500">Loading the {year} schedule…</p>}
        {season?.meetings.map((m, i) => (
          <div key={m.key} ref={m.key === focusKey ? currentRef : undefined} className="border-b border-zinc-800/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-5 text-right text-[11px] font-bold tabular-nums text-zinc-500">{i + 1}</span>
              {m.flag && <img src={m.flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" />}
              <span className={cn("text-[13px] font-bold", m.cancelled ? "text-zinc-500 line-through" : "text-zinc-100")}>{m.name}</span>
              <span className="text-[11px] text-zinc-500">{m.circuit}</span>
              {m.cancelled && <span className="rounded bg-zinc-800 px-1.5 text-[10px] font-bold uppercase text-zinc-400">Cancelled</span>}
              <span className="ml-auto text-[11px] tabular-nums text-zinc-500">{day.format(m.start)}</span>
            </div>
            {!m.cancelled && (
              <div className="mt-1 grid gap-0.5 pl-7">
                {m.sessions.map((s) => {
                  const state = sessionState(s, now);
                  const isShowing = showing === s.key;
                  return (
                    <div key={s.key} className={cn("flex h-7 items-center gap-2 rounded-md px-2", isShowing ? "bg-zinc-800/80" : "hover:bg-zinc-900")}>
                      <span className="w-[120px] truncate text-[12.5px] font-semibold text-zinc-200">{s.name}</span>
                      <span className="w-[92px] text-[11px] tabular-nums text-zinc-400">
                        {day.format(s.start)}
                      </span>
                      <span className="w-[44px] text-[12px] font-bold tabular-nums text-zinc-200">{clock.format(s.start)}</span>
                      <span className="text-[11px] text-zinc-500">{state === "live" ? "" : relative(s.start - now)}</span>
                      <span className="ml-auto flex items-center gap-1.5">
                        {isShowing && <span className="rounded bg-sky-500/20 px-1.5 py-px text-[10px] font-bold uppercase text-sky-300">Showing</span>}
                        {state === "live" && <span className="animate-pulse rounded bg-f1-red px-1.5 py-px text-[10px] font-black uppercase text-white">Live</span>}
                        {state === "past" && (
                          <button
                            disabled={busy !== null}
                            onClick={() => load(s, m)}
                            title="Timing, map and telemetry from F1's archive (your F1 TV sign-in, no video)"
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              busy === s.key ? "border-zinc-600 text-zinc-400" : "border-f1-red/70 bg-f1-red/15 text-white hover:bg-f1-red/30",
                              busy !== null && busy !== s.key && "opacity-40"
                            )}
                          >
                            {busy === s.key ? "Opening…" : "Load"}
                          </button>
                        )}
                        {state !== "upcoming" && (
                          <button
                            disabled={busy !== null}
                            onClick={() => watch(s, m)}
                            title="Open the video in MultiViewer; Pit Wall follows its timing"
                            className={cn(
                              "rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-zinc-500 hover:text-white",
                              busy !== null && "opacity-40"
                            )}
                          >
                            {state === "live" ? "Watch live" : "MultiViewer"}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">
        {note && <p className={cn("mb-1.5 font-semibold", note.bad ? "text-amber-400" : "text-green-400")}>{note.text}</p>}
        <AccountLine />
        <div className="mt-1.5 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => {
                setReplace(e.target.checked);
                saveValue("picker:replace", e.target.checked);
              }}
              className="accent-[#e10600]"
            />
            Close what's open in MultiViewer first
          </label>
          <span className="ml-auto text-zinc-500">Times are yours</span>
        </div>
      </div>
    </div>
  );
}

const until = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function AccountLine() {
  const { state, product, expires } = useF1Account();
  const button = (label: string) => (
    <button onClick={openSignIn} className="rounded-md bg-f1-red px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white hover:brightness-110">
      {label}
    </button>
  );
  if (state === "signed-in")
    return (
      <p className="flex items-center gap-1.5">
        <span className="font-bold text-green-400">✓ F1 TV</span>
        <span className="text-zinc-300">{product ?? "signed in"}</span>
        <span className="text-zinc-500">· past sessions load from F1's archive{expires ? ` · sign-in good until ${until.format(expires)}` : ""}</span>
      </p>
    );
  if (state === "unavailable")
    return <p className="text-zinc-500">F1 TV sign-in works in the installed extension (it reads your formula1.com login).</p>;
  return (
    <p className="flex items-center gap-2">
      <span className={state === "signed-out" ? "text-zinc-300" : "text-amber-400"}>
        {state === "signed-out"
          ? "Sign in to F1 TV to load past sessions here: timing, map and telemetry (no video)."
          : state === "expired"
            ? "Your F1 TV sign-in ran out. Opening formula1.com renews it."
            : "This F1 account has no active F1 TV subscription."}
      </span>
      {state !== "no-subscription" && button(state === "expired" ? "Renew" : "Sign in")}
    </p>
  );
}
