// Whisper running locally (transformers.js on onnxruntime-web, WebAssembly). The model
// downloads from Hugging Face on first use and is cached by the browser after that.

import { env, pipeline } from "@huggingface/transformers";

export const MODELS = {
  standard: "onnx-community/whisper-small.en",
  light: "onnx-community/whisper-base.en",
} as const;
export type ModelKey = keyof typeof MODELS;

export type WorkerRequest =
  | { type: "load"; model: ModelKey; ortBase: string }
  | { type: "transcribe"; id: string; audio: Float32Array };

export type WorkerReply =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready" }
  | { type: "result"; id: string; text: string }
  | { type: "error"; id?: string; error: string };

type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Asr | null = null;

// Whisper's usual inventions on silence or pure engine noise
const HALLUCINATIONS = /^(?:\[.*\]|\(.*\)|thank you\.?|thanks for watching!?|you|\.+)$/i;

const reply = (msg: WorkerReply) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "load") {
    try {
      env.allowLocalModels = false;
      // Load onnxruntime's WebAssembly from the extension itself: extension pages may
      // not import code from a CDN or a blob: URL
      env.useWasmCache = false;
      const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown };
      wasm.wasmPaths = {
        mjs: `${msg.ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${msg.ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
      };
      asr = (await pipeline("automatic-speech-recognition", MODELS[msg.model], {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.file) reply({ type: "progress", file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
        },
      })) as unknown as Asr;
      reply({ type: "ready" });
    } catch (err) {
      reply({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === "transcribe") {
    if (!asr) return reply({ type: "error", id: msg.id, error: "Model not loaded" });
    try {
      const out = await asr(msg.audio, { chunk_length_s: 30 });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
      reply({ type: "result", id: msg.id, text: HALLUCINATIONS.test(text) ? "" : text });
    } catch (err) {
      reply({ type: "error", id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
};
