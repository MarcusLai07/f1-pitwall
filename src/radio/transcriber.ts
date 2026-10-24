// Team radio transcription: fetches each clip, decodes it to 16 kHz mono and hands it
// to the Whisper worker, one clip at a time, newest first. Transcripts are kept in
// storage so a clip is only ever transcribed once.

import { create } from "zustand";
import { archiveFetch } from "../data/archive";
import { loadValue, saveValue } from "../lib/storage";
import type { ModelKey, WorkerReply, WorkerRequest } from "./transcribe.worker";

// Radio clips come from F1's static archive (with the F1 TV token when signed in). It
// sends no CORS headers: the extension has host permission for it, the dev page goes
// through Vite's /f1static proxy.
export const CLIP_BASE = import.meta.env.DEV ? "/f1static/" : "https://livetiming.formula1.com/static/";
export const AUDIO_BASE = "https://livetiming.formula1.com/static/";

export const MODEL_SIZES: Record<ModelKey, string> = { standard: "≈250 MB", light: "≈80 MB" };

type Status = "off" | "loading" | "ready" | "error";

interface RadioStore {
  model: ModelKey | null;
  status: Status;
  progress: number; // model download, 0..1 of the files seen so far
  downloaded: number; // model bytes downloaded (grows steadily, unlike progress)
  error: string | null;
  transcripts: Record<string, string>; // clip URL -> text ("" = no speech)
  failed: Record<string, true>; // clips that couldn't be fetched or transcribed this session
  queue: string[]; // clip URLs waiting, next first
  working: string | null;
  setModel: (model: ModelKey | null) => void;
  request: (clipUrls: string[]) => void;
}

const MODEL_KEY = "radio:model";
const TRANSCRIPTS_KEY = "radio:transcripts";
const KEEP = 600;

let worker: Worker | null = null;
let workerModel: ModelKey | null = null;
const fileProgress = new Map<string, { loaded: number; total: number }>();
const waiting = new Map<string, (text: string | null) => void>();

export const useRadio = create<RadioStore>((set, get) => ({
  model: null,
  status: "off",
  progress: 0,
  downloaded: 0,
  error: null,
  transcripts: {},
  failed: {},
  queue: [],
  working: null,
  setModel: (model) => {
    set({ model });
    saveValue(MODEL_KEY, model);
    if (!model) {
      worker?.terminate();
      worker = null;
      workerModel = null;
      set({ status: "off", queue: [], working: null });
      return;
    }
    startWorker(model);
  },
  request: (clipUrls) => {
    const { transcripts, failed, queue, working, model } = get();
    if (!model) return;
    const fresh = clipUrls.filter((u) => !(u in transcripts) && !failed[u] && !queue.includes(u) && u !== working);
    if (!fresh.length) return;
    set({ queue: [...fresh, ...queue] });
    pump();
  },
}));

// Restore settings and saved transcripts
Promise.all([loadValue<ModelKey | null>(MODEL_KEY), loadValue<Record<string, string>>(TRANSCRIPTS_KEY)]).then(([model, saved]) => {
  if (saved) useRadio.setState((s) => ({ transcripts: { ...saved, ...s.transcripts } }));
  if (model) useRadio.getState().setModel(model);
});

function startWorker(model: ModelKey) {
  if (worker && workerModel === model) return;
  worker?.terminate();
  fileProgress.clear();
  worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
  workerModel = model;
  useRadio.setState({ status: "loading", progress: 0, downloaded: 0, error: null });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const msg = e.data;
    if (msg.type === "progress") {
      fileProgress.set(msg.file, { loaded: msg.loaded, total: msg.total });
      let loaded = 0;
      let total = 0;
      for (const f of fileProgress.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      useRadio.setState({ progress: total ? loaded / total : 0, downloaded: loaded });
    } else if (msg.type === "ready") {
      useRadio.setState({ status: "ready", progress: 1 });
      pump();
    } else if (msg.type === "result" || msg.type === "error") {
      if (msg.id) {
        waiting.get(msg.id)?.(msg.type === "result" ? msg.text : null);
        waiting.delete(msg.id);
      } else if (msg.type === "error") {
        useRadio.setState({ status: "error", error: msg.error });
      }
    }
  };
  const ortBase = new URL(`${import.meta.env.BASE_URL}ort/`, location.href).href;
  worker.postMessage({ type: "load", model, ortBase } satisfies WorkerRequest);
}

/** Where to fetch a clip's audio from (its URL is the archive's) */
export function clipSource(url: string): string {
  return CLIP_BASE + url.slice(AUDIO_BASE.length);
}

async function decode(url: string): Promise<Float32Array> {
  const res = await archiveFetch(clipSource(url));
  if (!res.ok) throw new Error(`clip ${res.status}`);
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 16000, sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  // Copy: AudioBuffer's own channel data can't be transferred to the worker
  if (buf.numberOfChannels === 1) return new Float32Array(buf.getChannelData(0));
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = Object.entries(useRadio.getState().transcripts).slice(-KEEP);
    saveValue(TRANSCRIPTS_KEY, Object.fromEntries(entries));
  }, 1000);
}

async function pump() {
  const s = useRadio.getState();
  if (s.working || s.status !== "ready" || !s.queue.length || !worker) return;
  const [url, ...rest] = s.queue;
  useRadio.setState({ working: url, queue: rest });
  let text: string | null = null;
  try {
    const audio = await decode(url);
    const id = `${url}#${Date.now()}`;
    text = await new Promise<string | null>((resolve) => {
      waiting.set(id, resolve);
      worker!.postMessage({ type: "transcribe", id, audio } satisfies WorkerRequest, [audio.buffer]);
    });
  } catch {
    text = null;
  }
  useRadio.setState((st) =>
    text === null
      ? { working: null, failed: { ...st.failed, [url]: true } }
      : { working: null, transcripts: { ...st.transcripts, [url]: text } }
  );
  if (text !== null) saveSoon();
  pump();
}
