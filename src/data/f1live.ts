// Live source straight from F1: livetiming.formula1.com's SignalR Core hub over its
// Server-Sent Events transport, so the F1 TV token can ride in a header (a browser
// WebSocket can't carry one). Signed in, the feed includes car data and team radio;
// signed out it's F1's free feed (timing, positions, race control). Everything is held
// back by the delay setting so the board can match the stream you're watching.

import { parseUtc } from "../lib/format";
import { f1Token, watchF1Account } from "../sessions/f1account";
import { inflate, merge } from "./archive";
import { ingestCarData, ingestPositions, resetBuffers } from "./buffers";
import { feedLaps, resetLaps } from "./laps";
import { feedPits, resetPits } from "./pits";
import { setWallNow, trackNow, usePitwall } from "./store";
import type { CarDataFrame, LiveClock, LiveState, PositionFrame } from "./types";

// The dev page goes through Vite's proxy; the extension has host permission
const HUB = import.meta.env.DEV ? "/f1live" : "https://livetiming.formula1.com/signalrcore";
const RS = "\x1e";
const TOPICS = [
  "Heartbeat",
  "SessionInfo",
  "SessionStatus",
  "TrackStatus",
  "ExtrapolatedClock",
  "LapCount",
  "DriverList",
  "TimingData",
  "TimingAppData",
  "TimingStats",
  "RaceControlMessages",
  "WeatherData",
  "PitLaneTimeCollection",
  "TeamRadio",
  "Position.z",
  "CarData.z",
];
// Positions and car data are let through slightly ahead of the board's clock, for the
// map and telemetry to interpolate into
const LOOKAHEAD_MS = 1500;
// SignalR drops a client that's silent for 30 s
const KEEPALIVE_MS = 15_000;

interface Pending {
  at: number; // server time, ms
  topic: string;
  data: unknown;
  replace: boolean; // a full snapshot (subscribe result) rather than a patch
}

/** Starts the F1 feed; `delayMs` is read on every tick. Returns a stop function. */
export function startF1Live(delayMs: () => number): () => void {
  const abort = new AbortController();
  let state: LiveState = {};
  let pending: Pending[] = [];
  let posQ: PositionFrame[] = [];
  let carQ: CarDataFrame[] = [];
  let skew = 0; // server clock minus ours, from message timestamps
  const skews: number[] = [];
  let sessionKey: number | undefined;
  let clock: LiveClock = { paused: false, systemTime: 0, trackTime: -delayMs() };
  let failures = 0;

  resetBuffers();
  resetLaps();
  resetPits();
  setWallNow(() => Date.now());
  usePitwall.setState({ source: "live", via: "f1", status: "connecting", error: null, replay: null, live: {}, clock });

  const serverNow = () => Date.now() + skew;
  const noteSkew = (ts: string | undefined) => {
    const t = parseUtc(ts);
    if (!Number.isFinite(t)) return;
    skews.push(t - Date.now());
    if (skews.length > 40) skews.shift();
    // Latency only ever makes a message look older: the largest offset is the closest
    skew = Math.max(...skews);
  };

  // Hold everything until the board's clock (server now minus the delay) reaches it
  const tick = () => {
    const trackTime = skew - delayMs();
    if (Math.abs(trackTime - clock.trackTime) > 100) clock = { paused: false, systemTime: 0, trackTime };
    const now = trackNow();
    let n = 0;
    let next = state;
    while (n < pending.length && pending[n].at <= now) {
      const m = pending[n++];
      next = { ...next, [m.topic]: m.replace ? m.data : merge(next[m.topic], m.data) };
    }
    if (n) pending = pending.slice(n);

    let p = 0;
    while (p < posQ.length && parseUtc(posQ[p].Timestamp) <= now + LOOKAHEAD_MS) p++;
    if (p) {
      ingestPositions(posQ.slice(0, p));
      posQ = posQ.slice(p);
    }
    let c = 0;
    while (c < carQ.length && parseUtc(carQ[c].Utc) <= now + LOOKAHEAD_MS) c++;
    if (c) {
      ingestCarData(carQ.slice(0, c));
      carQ = carQ.slice(c);
    }

    const s = usePitwall.getState();
    if (next !== state) {
      const key = next.SessionInfo?.Key;
      if (sessionKey !== undefined && key !== sessionKey) {
        // A new session began: drop the old one's laps, stops and traces
        resetLaps();
        resetPits();
        resetBuffers();
      }
      sessionKey = key;
      state = next;
      const ended = /^(Finalised|Ends)$/.test(state.SessionStatus?.Status ?? "");
      usePitwall.setState({ live: state, clock, status: ended || !state.SessionInfo ? "waiting" : "connected", error: null });
      feedLaps(state.TimingData, state.TimingAppData);
      feedPits(state.TimingData, state.PitLaneTimeCollection, now);
    } else if (s.clock !== clock) usePitwall.setState({ clock });
  };
  const ticker = setInterval(tick, 200);

  const handle = async (msg: { type?: number; target?: string; arguments?: unknown[]; result?: Record<string, unknown>; error?: string }) => {
    if (msg.type === 7) throw new Error(msg.error || "F1 closed the connection");
    if (msg.type === 3) {
      if (msg.error) throw new Error(msg.error);
      failures = 0; // subscribed: the connection works
      const at = serverNow();
      for (const [topic, data] of Object.entries(msg.result ?? {})) await take(topic, data, at, true);
    } else if (msg.type === 1 && msg.target === "feed") {
      const [topic, data, ts] = msg.arguments ?? [];
      if (typeof topic !== "string") return;
      noteSkew(ts as string);
      const at = parseUtc(ts as string);
      await take(topic, data, Number.isFinite(at) ? at : serverNow(), false);
    }
  };

  const take = async (topic: string, data: unknown, at: number, replace: boolean) => {
    if (topic.endsWith(".z")) {
      if (typeof data !== "string") return;
      const decoded = JSON.parse(await inflate(data));
      if (topic === "Position.z") posQ.push(...((decoded as { Position?: PositionFrame[] }).Position ?? []));
      else if (topic === "CarData.z") carQ.push(...((decoded as { Entries?: CarDataFrame[] }).Entries ?? []));
      return;
    }
    if (topic === "Heartbeat") {
      noteSkew((data as { Utc?: string } | null)?.Utc);
      return;
    }
    pending.push({ at, topic, data, replace });
  };

  const session = async () => {
    await watchF1Account();
    let token = f1Token();
    const opts = (extra: Record<string, string> = {}): RequestInit => ({
      headers: { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "include", // the load balancer pins the connection with a cookie
      signal: abort.signal,
    });
    let neg = await fetch(`${HUB}/negotiate?negotiateVersion=1`, { method: "POST", ...opts({ "Content-Type": "application/json" }) });
    if (neg.status === 401 && token) {
      // F1 refused the token: carry on with the free feed
      token = null;
      neg = await fetch(`${HUB}/negotiate?negotiateVersion=1`, { method: "POST", ...opts({ "Content-Type": "application/json" }) });
    }
    if (!neg.ok) throw new Error(`F1 live timing answered ${neg.status}`);
    const { connectionToken } = (await neg.json()) as { connectionToken: string };
    const url = `${HUB}?id=${encodeURIComponent(connectionToken)}`;
    const send = (msg: object) =>
      fetch(url, { method: "POST", body: JSON.stringify(msg) + RS, ...opts({ "Content-Type": "text/plain;charset=UTF-8" }) });

    const res = await fetch(url, opts({ Accept: "text/event-stream" }));
    if (!res.ok || !res.body) throw new Error(`F1 live timing answered ${res.status}`);
    await send({ protocol: "json", version: 1 });
    const keepalive = setInterval(() => send({ type: 6 }).catch(() => {}), KEEPALIVE_MS);
    try {
      const reader = res.body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
      let buf = "";
      let handshaken = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error("F1 closed the live timing stream");
        buf += value.replace(/\r\n/g, "\n");
        let end: number;
        while ((end = buf.indexOf("\n\n")) >= 0) {
          const event = buf.slice(0, end);
          buf = buf.slice(end + 2);
          const data = event
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          for (const part of data.split(RS)) {
            if (!part.trim()) continue;
            const msg = JSON.parse(part);
            if (!handshaken) {
              if (msg.error) throw new Error(msg.error);
              handshaken = true;
              await send({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] });
              continue;
            }
            await handle(msg);
          }
        }
      }
    } finally {
      clearInterval(keepalive);
    }
  };

  (async () => {
    while (!abort.signal.aborted) {
      try {
        await session();
      } catch (err) {
        if (abort.signal.aborted) return;
        failures++;
        usePitwall.setState({ status: failures > 1 ? "offline" : "connecting", error: err instanceof Error ? err.message : String(err) });
      }
      // Back off, then reconnect (the subscribe result brings the whole state again)
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))));
    }
  })();

  return () => {
    abort.abort();
    clearInterval(ticker);
  };
}
