// Every session of a season, past, live and upcoming, plus the F1 TV account. A past
// session replays straight from F1's timing archive with your F1 TV sign-in (timing,
// map, telemetry, radio; no video); a live one is followed through F1's live feed.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveAuthError, archivePath } from "../data/archive";
import { usePitwall } from "../data/store";
import { cn } from "../lib/format";
import { useTicker } from "../ui/hooks";
import { loadSeason, sessionState, type Meeting, type ScheduleSource, type Session } from "./catalog";
import {
  beginSignIn,
  checkF1Account,
  openSignInForm,
  signInWithPassword,
  signOut,
  testLogin,
  useF1Account,
  type LoginTest,
  type TokenCheck,
} from "./f1account";

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
  onGoLive: () => void;
  onOpenArchive: (path: string, name: string) => void;
}

export function SessionPicker({ onClose, onGoLive, onOpenArchive }: Props) {
  useTicker(1 / 30); // keep "in 12 min" current
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [season, setSeason] = useState<{ meetings: Meeting[]; source: ScheduleSource } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const showing = usePitwall((s) => s.live.SessionInfo?.Key);
  const source = usePitwall((s) => s.source);
  const account = useF1Account();
  const currentRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

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

  const follow = () => {
    if (source !== "live") onGoLive();
    onClose();
  };

  const load = async (s: Session, m: Meeting) => {
    setNote(null);
    if (account.state !== "signed-in") {
      setNote({
        text:
          account.state === "unavailable"
            ? "Replays need the F1 TV sign-in, which only works in the installed extension (not this dev page)."
            : "Replays come from F1's archive, which needs your F1 TV sign-in: use Sign in at the top right.",
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
        <div className="ml-auto" />
        <AccountChip />
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">
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
                        {state !== "upcoming" && (
                          <button
                            disabled={busy !== null}
                            onClick={() => (state === "live" ? follow() : load(s, m))}
                            title={
                              state === "live"
                                ? "Follow it live in Pit Wall"
                                : "Replay its timing, map, telemetry and team radio from F1's archive (F1 TV sign-in; no video)"
                            }
                            className={cn(
                              "w-[68px] rounded-md border py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              busy === s.key ? "border-zinc-600 text-zinc-400" : "border-f1-red/70 bg-f1-red/15 text-white hover:bg-f1-red/30",
                              busy !== null && busy !== s.key && "opacity-40"
                            )}
                          >
                            {busy === s.key ? "Opening…" : state === "live" ? "Follow" : "Replay"}
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
        <AccountPanel />
        <div className="flex items-center gap-3">
          <span className="text-zinc-500">Replays and live timing come straight from F1 · no video</span>
          <span className="ml-auto text-zinc-500">Times are yours</span>
        </div>
      </div>
    </div>
  );
}

const until = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ranOut = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const VERDICT: Record<TokenCheck["verdict"], string> = {
  accepted: "accepted by F1",
  unverified: "couldn't check with F1",
  expired: "expired",
  inactive: "subscription not active",
  refused: "refused by F1",
};

/** Each login Pit Wall found (its own sign-in, formula1.com cookies), and what F1 made of it */
function TokenChecks({ checks }: { checks: TokenCheck[] }) {
  if (!checks.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 text-[10px]">
      {checks.map((c, i) => (
        <li key={i} className="flex gap-1.5">
          <span className={c.verdict === "accepted" ? "text-green-400" : c.verdict === "unverified" ? "text-zinc-400" : "text-amber-400"}>
            {c.verdict === "accepted" ? "✓" : c.verdict === "unverified" ? "?" : "✗"}
          </span>
          <span className="font-mono text-zinc-300">{c.cookie}</span>
          <span className="text-zinc-500">
            {VERDICT[c.verdict]}
            {c.verdict === "expired" && c.expires ? ` ${ranOut.format(c.expires)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

const message = (err: unknown) =>
  err instanceof TypeError ? "Couldn't reach F1's sign-in service" : err instanceof Error ? err.message : String(err);

const field = "h-7 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";
const smallButton = "rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-200 hover:border-zinc-500";

/** The sign-in form, or why the login Pit Wall has doesn't work */
function AccountPanel() {
  const { state, expires, status, scan, formOpen } = useF1Account();
  const [phase, setPhase] = useState<"starting" | "password" | "sending">("starting");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [test, setTest] = useState<LoginTest | null | "running">(null);

  // Opening the form starts F1's sign-in; a browser already signed in to F1 may finish right here
  useEffect(() => {
    if (!formOpen) return;
    let alive = true;
    setPhase("starting");
    setError(null);
    beginSignIn()
      .then((r) => alive && r === "password" && setPhase("password"))
      .catch((err) => {
        if (!alive) return;
        setError(message(err));
        setPhase("password");
      });
    return () => {
      alive = false;
    };
  }, [formOpen]);

  if (state === "signed-in" || state === "unavailable") return null;
  const why =
    state === "expired"
      ? `Your F1 TV sign-in ran out${expires ? ` on ${ranOut.format(expires)}` : ""}. Sign in again to carry on.`
      : state === "refused"
        ? "F1 refused the F1 TV login Pit Wall found. Sign in to get a fresh one."
        : state === "no-subscription"
          ? `F1 says this account's F1 TV subscription is ${status ?? "not active"}.`
          : null;
  if (!formOpen && !why) return null;

  return (
    <div className="mb-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5 text-[11px] leading-snug text-zinc-300">
      {why && <p className="mb-1.5">{why}</p>}
      {formOpen ? (
        phase === "starting" ? (
          <p className="text-zinc-400">Contacting F1…</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              setPhase("sending");
              setError(null);
              try {
                await signInWithPassword(String(data.get("email") ?? "").trim(), String(data.get("password") ?? ""));
                form.reset();
              } catch (err) {
                const password = form.elements.namedItem("password") as HTMLInputElement | null;
                if (password) password.value = "";
                setError(message(err));
                setPhase("password");
              }
            }}
          >
            <p className="mb-1.5 font-semibold text-zinc-100">Sign in with your F1 account</p>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input name="email" type="email" autoComplete="username" required placeholder="Email" className={field} />
              <input name="password" type="password" autoComplete="current-password" required placeholder="Password" className={field} />
              <button
                type="submit"
                disabled={phase === "sending"}
                className="h-7 rounded-md bg-f1-red px-3 text-[10px] font-bold uppercase tracking-wider text-white hover:brightness-110 disabled:opacity-60"
              >
                {phase === "sending" ? "Signing in…" : "Sign in"}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-500">
              Your email and password go straight to F1's sign-in service (id.formula1.com), the way FastF1 signs in. Pit Wall keeps only the
              F1 TV token it gets back, never your password.{" "}
              <button type="button" onClick={() => openSignInForm(false)} className="text-zinc-300 underline-offset-2 hover:underline">
                Cancel
              </button>
            </p>
          </form>
        )
      ) : (
        <button onClick={() => openSignInForm()} className={smallButton}>
          Sign in
        </button>
      )}
      {error && <p className="mt-1.5 font-semibold text-amber-300">{error}</p>}
      {!!scan?.checks.length && (
        <button onClick={() => setDetails((d) => !d)} className="mt-1.5 text-[10px] text-zinc-500 hover:text-zinc-300">
          {details ? "Hide details" : "Details"}
        </button>
      )}
      {details && scan && (
        <div>
          <TokenChecks checks={scan.checks} />
          <div className="mt-1.5 flex gap-1.5">
            <button onClick={() => checkF1Account().catch(() => {})} className={smallButton}>
              Check again
            </button>
            <button
              onClick={async () => {
                setTest("running");
                setTest(await testLogin().catch(() => null));
              }}
              className={smallButton}
            >
              {test === "running" ? "Testing…" : "Test with F1"}
            </button>
          </div>
          {test && test !== "running" && (
            <div className="mt-2 rounded border border-zinc-800 bg-zinc-950/70 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
              <p className="text-zinc-300">login from "{test.cookie}"</p>
              {test.facts.map(([k, v]) => (
                <p key={k}>
                  {k}: <span className="text-zinc-200">{v}</span>
                </p>
              ))}
              <p className="mt-1 text-zinc-300">F1 answered</p>
              {test.answers.map(([k, v]) => (
                <p key={k}>
                  {k}: <span className={/^2\d\d/.test(v) ? "text-green-400" : "text-amber-300"}>{v}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The F1 TV account Pit Wall uses: sign in, see whose it is, sign out */
function AccountChip() {
  const { state, product, expires, scan, formOpen } = useF1Account();
  const [open, setOpen] = useState(false);
  const chip = "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider";
  if (state === "unavailable")
    return (
      <span className={cn(chip, "border border-zinc-800 text-zinc-500")} title="The dev page can't reach F1's sign-in; the installed extension can">
        F1 TV · extension only
      </span>
    );
  if (state !== "signed-in")
    return (
      <button
        onClick={() => openSignInForm(!formOpen)}
        className={cn(chip, state === "signed-out" ? "bg-f1-red text-white hover:brightness-110" : "border border-amber-500/60 text-amber-300 hover:bg-amber-500/10")}
        title="Sign in with your F1 account (for cars on the map, telemetry, team radio and replays)"
      >
        {state === "signed-out"
          ? "Sign in to F1 TV"
          : state === "expired"
            ? "F1 TV sign-in expired"
            : state === "refused"
              ? "F1 refused this login"
              : "No F1 TV subscription"}
      </button>
    );
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cn(chip, "flex items-center gap-1.5 border border-green-500/40 text-green-300 hover:bg-green-500/10")}>
        <i className="h-1.5 w-1.5 rounded-full bg-green-400" />
        {product ?? "F1 TV"}
        <span className="text-green-500/70">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 w-64 rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 text-[11px] leading-snug text-zinc-300 shadow-xl">
          <p className="font-semibold text-zinc-100">Signed in to F1 TV</p>
          <p className="mt-1 text-zinc-400">
            {scan?.from === "Pit Wall sign-in" ? "Signed in here, in Pit Wall." : "Using the F1 TV login in this browser's formula1.com cookies."} Replays and live
            timing come straight from F1, with telemetry and team radio.
          </p>
          {expires && <p className="mt-1 text-zinc-500">Good until {until.format(expires)}.</p>}
          {scan && <TokenChecks checks={scan.checks} />}
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="mt-2 w-full rounded-md border border-zinc-700 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-200 hover:border-zinc-500 hover:text-white"
          >
            Sign out of Pit Wall
          </button>
        </div>
      )}
    </div>
  );
}
