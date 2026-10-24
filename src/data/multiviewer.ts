// Live source: polls MultiViewer's local GraphQL API. MultiViewer holds the state
// back to match its video player, so everything here is already in sync with it.

import { ingestCarData, ingestPositions, resetBuffers } from "./buffers";
import { feedLaps, resetLaps } from "./laps";
import { commitTopics, setWallNow, usePitwall } from "./store";
import { TOPICS, type LiveClock, type LiveState } from "./types";

const ENDPOINT = import.meta.env.DEV ? "/mv/api/graphql" : "http://localhost:10101/api/graphql";
const CLOCK = "f1LiveTimingClock { paused systemTime trackTime liveTimingStartTime }";
const FULL_QUERY = `{ f1LiveTimingState { ${TOPICS.join(" ")} } ${CLOCK} }`;
const FAST_QUERY = `{ f1LiveTimingState { Position CarData } ${CLOCK} }`;

// Position/CarData keep ~1 s of frames in MultiViewer's state; poll faster than that.
const FAST_MS = 400;
const FULL_EVERY = 3; // full state every 3rd tick (~1.2 s)

interface GqlResponse {
  data?: {
    f1LiveTimingState?: LiveState | null;
    f1LiveTimingClock?: { paused: boolean; systemTime: string; trackTime: string; liveTimingStartTime?: string } | null;
  };
  errors?: { message: string }[];
}

async function query(q: string, signal: AbortSignal): Promise<GqlResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: q }),
    signal,
  });
  if (!res.ok) throw new Error(`MultiViewer API ${res.status}`);
  return res.json();
}

function toClock(raw: NonNullable<GqlResponse["data"]>["f1LiveTimingClock"]): LiveClock | null {
  if (!raw) return null;
  return {
    paused: raw.paused,
    systemTime: Number(raw.systemTime),
    trackTime: Number(raw.trackTime),
    liveTimingStartTime: raw.liveTimingStartTime ? Number(raw.liveTimingStartTime) : undefined,
  };
}

export function startLive(): () => void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tick = 0;
  let failures = 0;

  resetBuffers();
  resetLaps();
  setWallNow(() => Date.now());
  usePitwall.setState({ source: "live", status: "connecting", error: null, replay: null, live: {}, clock: null });

  const loop = async () => {
    const full = tick % FULL_EVERY === 0;
    tick++;
    try {
      const res = await query(full ? FULL_QUERY : FAST_QUERY, abort.signal);
      if (res.errors?.length) throw new Error(res.errors[0].message);
      const state = res.data?.f1LiveTimingState ?? null;
      const clock = toClock(res.data?.f1LiveTimingClock);
      failures = 0;
      if (!state || (full && !state.SessionInfo)) {
        usePitwall.setState({ status: "waiting", clock });
      } else {
        ingestPositions(state.Position?.Position);
        ingestCarData(state.CarData?.Entries);
        if (full) {
          commitTopics(state, clock);
          feedLaps(state.TimingData, state.TimingAppData);
        } else usePitwall.setState({ clock });
        if (usePitwall.getState().status !== "connected") usePitwall.setState({ status: "connected", error: null });
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      failures++;
      usePitwall.setState({
        status: "offline",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (abort.signal.aborted) return;
    // Back off while MultiViewer isn't running
    const delay = failures ? Math.min(5000, 1000 * failures) : FAST_MS;
    timer = setTimeout(loop, delay);
  };
  loop();

  return () => {
    abort.abort();
    clearTimeout(timer);
  };
}
