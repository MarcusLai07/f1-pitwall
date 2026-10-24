import { create } from "zustand";
import type { LiveClock, LiveState } from "./types";

// Telemetry shows up to five cars
export const MAX_SELECTED = 5;

export type SourceKind = "live" | "replay";
export type SourceStatus = "idle" | "connecting" | "connected" | "waiting" | "offline" | "loading" | "ready" | "error";

export interface ReplayInfo {
  name: string;
  start: number; // recorded wall time of the first frame, ms
  end: number;
  at: number; // current recorded wall time, ms
  playing: boolean;
  speed: number;
  loadProgress: number | null; // 0..1 while loading
}

interface PitwallStore {
  source: SourceKind;
  status: SourceStatus;
  error: string | null;
  /** Topics except Position/CarData (those go to buffers.ts). Unchanged topics keep their reference. */
  live: LiveState;
  clock: LiveClock | null;
  selected: string[]; // racing numbers, most recent first (up to MAX_SELECTED)
  replay: ReplayInfo | null;
  /** Bumped on a replay seek or source switch: jumps that aren't events (no banners) */
  resync: number;
  toggleSelected: (num: string) => void;
}

export const usePitwall = create<PitwallStore>((set) => ({
  source: "live",
  status: "idle",
  error: null,
  live: {},
  clock: null,
  selected: [],
  replay: null,
  resync: 0,
  toggleSelected: (num) =>
    set((s) => ({
      selected: s.selected.includes(num) ? s.selected.filter((n) => n !== num) : [num, ...s.selected].slice(0, MAX_SELECTED),
    })),
}));

// "Now" in the source's wall-clock domain: real time when live, the playhead in replay.
let wallNow: () => number = () => Date.now();

export function setWallNow(fn: () => number) {
  wallNow = fn;
}

/** Current track time (epoch ms) on MultiViewer's clock, i.e. in sync with the video. */
export function trackNow(): number {
  const clock = usePitwall.getState().clock;
  if (!clock) return wallNow();
  return clock.paused ? clock.trackTime : clock.trackTime + (wallNow() - clock.systemTime);
}

/** How far the shown data runs behind real time (the video delay), ms. Live only. */
export function feedDelay(): number | null {
  const { clock, source } = usePitwall.getState();
  if (!clock || source !== "live") return null;
  return Date.now() - trackNow();
}

const topicCache = new Map<string, string>();

/** Merge a full topic snapshot, keeping references for topics whose JSON didn't change. */
export function commitTopics(next: LiveState, clock: LiveClock | null) {
  const prev = usePitwall.getState().live;
  let changed = false;
  const merged: LiveState = { ...prev };
  for (const [topic, value] of Object.entries(next)) {
    if (topic === "Position" || topic === "CarData") continue;
    const json = JSON.stringify(value ?? null);
    if (topicCache.get(topic) === json) continue;
    topicCache.set(topic, json);
    merged[topic] = value;
    changed = true;
  }
  usePitwall.setState(changed ? { live: merged, clock } : { clock });
}

/** Replace the whole state (replay frames). `jump` marks a seek rather than playback. */
export function replaceTopics(next: LiveState, clock: LiveClock | null, jump = false) {
  topicCache.clear();
  usePitwall.setState((s) => ({ live: next, clock, resync: jump ? s.resync + 1 : s.resync }));
}
