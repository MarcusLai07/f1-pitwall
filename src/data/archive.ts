// Past sessions straight from F1's timing archive (livetiming.formula1.com/static),
// signed in with F1 TV: timing, map, telemetry and team radio (no video).
// A session is a folder of per-topic .jsonStream files, one line per update: the time
// since the archive started ("HH:MM:SS.mmm"), then a JSON patch (base64 raw-deflate for
// the .z topics). This turns them into a Recording the replay engine plays.

import { parseGmtOffset, parseUtc } from "../lib/format";
import { f1Token } from "../sessions/f1account";
import type { Recording } from "./replay";
import type { CarDataFrame, LiveState, PositionFrame } from "./types";

// The dev page goes through Vite's proxy; the extension has host permission
export const ARCHIVE_BASE = import.meta.env.DEV ? "/f1static/" : "https://livetiming.formula1.com/static/";

/** The archive wants an F1 TV sign-in (401) */
export class ArchiveAuthError extends Error {}

export async function archiveFetch(url: string): Promise<Response> {
  const token = f1Token();
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (res.status === 401) throw new ArchiveAuthError(token ? "F1 TV refused the sign-in" : "Sign in to F1 TV first");
  return res;
}

async function archiveJson<T>(url: string): Promise<T | null> {
  const res = await archiveFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`F1's archive answered ${res.status}`);
  return JSON.parse((await res.text()).replace(/^﻿/, "")) as T;
}

export interface ArchiveIndex {
  Year: number;
  Meetings: {
    Key: number;
    Name: string;
    Location: string;
    Country?: { Name?: string; Code?: string };
    Circuit?: { ShortName?: string };
    Sessions: { Key: number; Type: string; Name: string; StartDate: string; EndDate: string; GmtOffset: string; Path?: string }[];
  }[];
}

/** The season's sessions as the archive lists them (only ones that have happened) */
export function archiveYear(year: number, base = ARCHIVE_BASE): Promise<ArchiveIndex | null> {
  return archiveJson<ArchiveIndex>(`${base}${year}/Index.json`);
}

/** Folder of a session in the archive, e.g. "2024/2024-10-27_Mexico_City_Grand_Prix/2024-10-27_Race/" */
export async function archivePath(year: number, sessionKey: number, base = ARCHIVE_BASE): Promise<string | null> {
  const index = await archiveYear(year, base);
  for (const m of index?.Meetings ?? []) {
    const s = m.Sessions.find((s) => s.Key === sessionKey);
    if (s?.Path) return s.Path;
  }
  return null;
}

// ---------- merging F1's patches ----------

// Lists the feed patches by index ({"3": {...}}) rather than replacing whole
const ARRAY_KEYS = new Set(["Sectors", "Segments", "BestLapTimes", "Stats", "Stints", "Messages", "Captures", "Series", "BestSectors"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Applies one patch, copying only the branches it touches (earlier states stay intact) */
export function merge(base: unknown, patch: unknown, key?: string): unknown {
  if (!isObject(patch)) return patch;
  if (Array.isArray(base) || (base === undefined && key && ARRAY_KEYS.has(key) && Object.keys(patch).every((k) => /^\d+$/.test(k)))) {
    const out = Array.isArray(base) ? base.slice() : [];
    for (const k in patch) {
      const i = Number(k);
      if (Number.isInteger(i)) out[i] = merge(out[i], patch[k]);
    }
    return out;
  }
  const out: Record<string, unknown> = isObject(base) ? { ...base } : {};
  for (const k in patch) {
    if (k === "_deleted") continue;
    out[k] = merge(out[k], patch[k], k);
  }
  const deleted = patch._deleted;
  if (Array.isArray(deleted)) for (const k of deleted) delete out[String(k)];
  return out;
}

interface Msg {
  at: number; // ms since the archive started
  topic: string;
  data: unknown;
}

function applyBatch(state: LiveState, batch: Msg[]): LiveState {
  if (!batch.length) return state;
  const next: LiveState = { ...state };
  for (const m of batch) next[m.topic] = merge(next[m.topic], m.data);
  return next;
}

// Frames every half second; a full state kept every two minutes, the rest rebuilt on demand
const FRAME_MS = 500;
const KEY_EVERY = 240;

function keyframedStates(batches: Msg[][]): (i: number) => LiveState {
  const keys: LiveState[] = [];
  let s: LiveState = {};
  for (let i = 0; i < batches.length; i++) {
    s = applyBatch(s, batches[i]);
    if (i % KEY_EVERY === 0) keys.push(s);
  }
  let cur = -1;
  let curState: LiveState = {};
  return (i) => {
    if (i === cur) return curState;
    let from = cur;
    if (!(cur >= 0 && cur < i && i - cur <= KEY_EVERY)) {
      const k = Math.floor(i / KEY_EVERY);
      from = k * KEY_EVERY;
      curState = keys[k];
    }
    for (let j = from + 1; j <= i; j++) curState = applyBatch(curState, batches[j]);
    cur = i;
    return curState;
  };
}

// ---------- compact car samples ----------

// Position and car data run at ~4 Hz for every car: hours of it as plain objects would
// take hundreds of MB, so they're packed into int rows and turned back into feed
// frames only for the slice being played.
const MAX_CARS = 30;
const POS_WIDTH = 4; // status (0 none, 1 on track, 2 off track), x, y, z
const CAR_WIDTH = 6; // present, rpm, speed, gear, throttle, brake

class Rows {
  times: number[] = [];
  data: Int32Array;
  constructor(public width: number) {
    this.data = new Int32Array(width * 4096);
  }
  /** Drops the growth slack and the unused car slots once loading is done */
  shrink(width: number) {
    const out = new Int32Array(this.times.length * width);
    for (let i = 0; i < this.times.length; i++) out.set(this.data.subarray(i * this.width, i * this.width + width), i * width);
    this.data = out;
    this.width = width;
  }
  /** Adds a zeroed row at time t; returns its offset, or -1 when out of order */
  push(t: number): number {
    if (!(t > (this.times.at(-1) ?? -Infinity))) return -1;
    const i = this.times.length;
    if ((i + 1) * this.width > this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.times.push(t);
    return i * this.width;
  }
}

class Cars {
  nums: string[] = [];
  private slots = new Map<string, number>();
  slot(num: string): number {
    let s = this.slots.get(num);
    if (s === undefined) {
      if (this.nums.length >= MAX_CARS) return -1;
      s = this.nums.length;
      this.nums.push(num);
      this.slots.set(num, s);
    }
    return s;
  }
}

// ---------- reading the streams ----------

const TOPICS = [
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
  "WeatherDataSeries",
  "TeamRadio",
  "PitLaneTimeCollection",
  "Heartbeat",
  "Position.z",
  "CarData.z",
];
// Rough share of the download, for the progress bar
const WEIGHT: Record<string, number> = { "Position.z": 8, "CarData.z": 8, TimingData: 6 };

function* streamLines(text: string): Generator<[number, string]> {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl).trim();
    pos = nl + 1;
    const m = /^(\d+):(\d\d):(\d\d)\.(\d+)/.exec(line);
    if (!m) continue;
    const at = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, "0").slice(0, 3));
    yield [at, line.slice(m[0].length)];
  }
}

/** Decodes a .z topic payload (base64 raw deflate) to its JSON text */
export async function inflate(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Response(stream).text();
}

async function download(url: string, onBytes: (read: number, total: number) => void): Promise<string | null> {
  const res = await archiveFetch(url);
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`F1's archive answered ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let text = "";
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += value;
    read += value.length; // characters: close enough to bytes for a progress bar
    onBytes(read, total);
  }
  return text;
}

/** Downloads and decodes one archived session into a playable recording */
export async function loadArchive(path: string, onProgress: (fraction: number) => void, base = ARCHIVE_BASE): Promise<Recording> {
  const folder = base + path.replace(/^\/+/, "").replace(/\/?$/, "/");
  const index = await archiveJson<{ Feeds?: Record<string, unknown> }>(`${folder}Index.json`).catch((err) => {
    if (err instanceof ArchiveAuthError) throw err;
    return null;
  });
  const listed = index?.Feeds ? new Set(Object.keys(index.Feeds)) : null;
  const topics = TOPICS.filter((t) => !listed || listed.has(t));

  const share = new Map<string, number>(topics.map((t) => [t, 0]));
  const totalWeight = topics.reduce((a, t) => a + (WEIGHT[t] ?? 0.3), 0);
  const report = () => onProgress((0.8 * [...share].reduce((a, [t, f]) => a + f * (WEIGHT[t] ?? 0.3), 0)) / totalWeight);

  const texts = new Map<string, string>();
  await Promise.all(
    topics.map(async (topic) => {
      const text = await download(`${folder}${topic}.jsonStream`, (read, total) => {
        if (total) share.set(topic, Math.min(0.99, read / total));
        report();
      });
      share.set(topic, 1);
      report();
      if (text) texts.set(topic, text);
    })
  );
  if (!texts.has("SessionInfo") && !texts.has("TimingData")) throw new Error("F1's archive has no timing for this session yet");

  // Plain topics become patches; the compressed ones are packed as they're decoded
  const msgs: Msg[] = [];
  const stamps: { at: number; utc: number }[] = []; // archive offset vs. real time, for the base time
  for (const [topic, text] of texts) {
    if (topic.endsWith(".z")) continue;
    for (const [at, body] of streamLines(text)) {
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        continue;
      }
      if (topic === "Heartbeat") {
        const utc = parseUtc((data as { Utc?: string }).Utc);
        if (Number.isFinite(utc) && stamps.length < 200) stamps.push({ at, utc });
      } else msgs.push({ at, topic, data });
    }
    texts.delete(topic);
  }

  const cars = new Cars();
  const pos = new Rows(MAX_CARS * POS_WIDTH);
  const car = new Rows(MAX_CARS * CAR_WIDTH);
  const fromHeartbeat = stamps.length > 0;
  const zTopics = [...texts.keys()];
  for (const [n, topic] of zTopics.entries()) {
    const lines = [...streamLines(texts.get(topic)!)];
    texts.delete(topic);
    for (let i = 0; i < lines.length; i += 256) {
      const batch = lines.slice(i, i + 256);
      const decoded = await Promise.all(batch.map(([, body]) => inflate(JSON.parse(body) as string).catch(() => null)));
      for (const [k, json] of decoded.entries()) {
        if (!json) continue;
        const at = batch[k][0];
        if (topic === "Position.z") {
          for (const f of (JSON.parse(json) as { Position?: PositionFrame[] }).Position ?? []) {
            const t = parseUtc(f.Timestamp);
            if (!fromHeartbeat && stamps.length < 200) stamps.push({ at, utc: t });
            const o = pos.push(t);
            if (o < 0) continue;
            for (const [num, e] of Object.entries(f.Entries)) {
              const s = cars.slot(num);
              if (s < 0) continue;
              const p = o + s * POS_WIDTH;
              pos.data[p] = e.Status === "OnTrack" ? 1 : 2;
              pos.data[p + 1] = e.X;
              pos.data[p + 2] = e.Y;
              pos.data[p + 3] = e.Z;
            }
          }
        } else {
          for (const f of (JSON.parse(json) as { Entries?: CarDataFrame[] }).Entries ?? []) {
            const t = parseUtc(f.Utc);
            if (!fromHeartbeat && stamps.length < 200) stamps.push({ at, utc: t });
            const o = car.push(t);
            if (o < 0) continue;
            for (const [num, c] of Object.entries(f.Cars)) {
              const s = cars.slot(num);
              if (s < 0) continue;
              const p = o + s * CAR_WIDTH;
              const ch = c.Channels;
              car.data[p] = 1;
              car.data[p + 1] = ch["0"] ?? 0;
              car.data[p + 2] = ch["2"] ?? 0;
              car.data[p + 3] = ch["3"] ?? 0;
              car.data[p + 4] = ch["4"] ?? 0;
              car.data[p + 5] = ch["5"] ?? 0;
            }
          }
        }
      }
      onProgress(0.8 + (0.15 * (n + (i + batch.length) / lines.length)) / zTopics.length);
    }
  }

  msgs.sort((a, b) => a.at - b.at);
  const started = msgs.find((m) => m.topic === "SessionStatus" && (m.data as { Status?: string }).Status === "Started");

  // Real time of the archive's start: median of (timestamp - offset) over the first samples
  const offsets = stamps.map((s) => s.utc - s.at).sort((a, b) => a - b);
  let base0 = offsets[offsets.length >> 1];
  if (!Number.isFinite(base0)) {
    // No car data either: say the session started on schedule (StartDate is local time)
    const info = msgs.find((m) => m.topic === "SessionInfo")?.data as LiveState["SessionInfo"];
    base0 = parseUtc(info?.StartDate) - parseGmtOffset(info?.GmtOffset) - (started?.at ?? msgs[0]?.at ?? 0);
  }

  const times: number[] = [];
  const batches: Msg[][] = [];
  for (const m of msgs) {
    const ft = Math.ceil(m.at / FRAME_MS) * FRAME_MS + base0;
    if (times.at(-1) !== ft) {
      times.push(ft);
      batches.push([]);
    }
    batches[batches.length - 1].push(m);
  }
  if (!times.length) throw new Error("F1's archive has no timing for this session yet");
  const stateAt = keyframedStates(batches);
  const nums = cars.nums;
  pos.shrink(nums.length * POS_WIDTH);
  car.shrink(nums.length * CAR_WIDTH);
  onProgress(1);

  const info = stateAt(times.length - 1).SessionInfo;

  return {
    name: [info?.Meeting?.Name, info?.Name].filter(Boolean).join(" · ") || path,
    times,
    clockAt: () => null,
    stateAt,
    // A minute before the lights (or the session clock) start
    startAt: started ? Math.max(times[0], base0 + started.at - 60_000) : undefined,
    positionTimes: pos.times,
    positionsBetween: (from, to) => {
      const out: PositionFrame[] = [];
      for (let i = from; i < to; i++) {
        const o = i * pos.width;
        const entries: PositionFrame["Entries"] = {};
        for (let s = 0; s < nums.length; s++) {
          const p = o + s * POS_WIDTH;
          const st = pos.data[p];
          if (st) entries[nums[s]] = { Status: st === 1 ? "OnTrack" : "OffTrack", X: pos.data[p + 1], Y: pos.data[p + 2], Z: pos.data[p + 3] };
        }
        out.push({ Timestamp: new Date(pos.times[i]).toISOString(), Entries: entries });
      }
      return out;
    },
    carTimes: car.times,
    carDataBetween: (from, to) => {
      const out: CarDataFrame[] = [];
      for (let i = from; i < to; i++) {
        const o = i * car.width;
        const cars: CarDataFrame["Cars"] = {};
        for (let s = 0; s < nums.length; s++) {
          const p = o + s * CAR_WIDTH;
          if (!car.data[p]) continue;
          const d = car.data;
          cars[nums[s]] = { Channels: { "0": d[p + 1], "2": d[p + 2], "3": d[p + 3], "4": d[p + 4], "5": d[p + 5] } };
        }
        out.push({ Utc: new Date(car.times[i]).toISOString(), Cars: cars });
      }
      return out;
    },
  };
}
