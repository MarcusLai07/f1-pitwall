// Team radio clips, newest first, with a local Whisper transcript under each one.
// The feed only carries each clip's path; audio comes from F1's static archive, which
// wants the F1 TV token, so clips are fetched and played from a blob.

import { useEffect, useMemo, useRef, useState } from "react";
import { archiveFetch } from "../data/archive";
import { useFreeFeed } from "../data/liveSettings";
import { trackNow, usePitwall } from "../data/store";
import { cn, isLightColor, parseGmtOffset, parseUtc, trackClock } from "../lib/format";
import { AUDIO_BASE, MODEL_SIZES, clipSource, useRadio } from "../radio/transcriber";
import type { ModelKey } from "../radio/transcribe.worker";
import { useTicker } from "../ui/hooks";

const NEW_MS = 90_000;

export function TeamRadio() {
  useTicker(1);
  const freeFeed = useFreeFeed();
  const captures = usePitwall((s) => s.live.TeamRadio?.Captures);
  const path = usePitwall((s) => s.live.SessionInfo?.Path);
  const drivers = usePitwall((s) => s.live.DriverList);
  const offset = usePitwall((s) => parseGmtOffset(s.live.SessionInfo?.GmtOffset));
  const { model, transcripts, failed, working, queue, request } = useRadio();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<string | null>(null);
  const wantRef = useRef<string | null>(null); // the clip asked for last
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [audioFailed, setAudioFailed] = useState<Set<string>>(new Set());
  const now = trackNow();

  // In replay the list only holds clips up to the playhead, newest first
  const list = useMemo(
    () =>
      [...(captures ?? [])]
        .filter((c) => parseUtc(c.Utc) <= now + 1000)
        .reverse()
        .map((c) => ({ ...c, url: AUDIO_BASE + (path ?? "") + c.Path })),
    // `now` moves every tick; re-filtering every 5 s is enough for clips arriving
    [captures, path, Math.floor(now / 5000)]
  );

  // Transcribe whatever is listed (newest first) once transcripts are on
  useEffect(() => {
    if (model && list.length) request(list.map((c) => c.url));
  }, [model, list, request]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    []
  );

  const toggle = async (url: string) => {
    const audio = (audioRef.current ??= new Audio());
    audio.pause();
    if (playing === url) {
      wantRef.current = null;
      setPlaying(null);
      return;
    }
    wantRef.current = url;
    setProgress(0);
    setPlaying(url);
    const fail = () => {
      setAudioFailed((f) => new Set(f).add(url));
      if (wantRef.current === url) setPlaying(null);
    };
    try {
      const res = await archiveFetch(clipSource(url));
      if (!res.ok) throw new Error(`clip ${res.status}`);
      const blob = URL.createObjectURL(await res.blob());
      if (wantRef.current !== url) return URL.revokeObjectURL(blob);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = blob;
      audio.src = blob;
      audio.ontimeupdate = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
      audio.onended = () => setPlaying(null);
      audio.onerror = fail;
      await audio.play();
    } catch {
      fail();
    }
  };

  return (
    <div className="relative flex h-full flex-col font-f1">
      <TranscriptBar />
      {!list.length ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {freeFeed ? "Team radio comes with your F1 TV sign-in (Sessions → Sign in to F1 TV)" : "No team radio yet"}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((c) => {
            const d = drivers?.[c.RacingNumber];
            const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
            const at = parseUtc(c.Utc);
            const isPlaying = playing === c.url;
            const cantPlay = audioFailed.has(c.url);
            const text = transcripts[c.url];
            return (
              <div key={c.Path} className={cn("relative border-b border-zinc-800/50 px-2.5 py-1.5", isPlaying && "bg-zinc-800/60")}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(c.url)}
                    disabled={cantPlay}
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px]",
                      cantPlay ? "cursor-not-allowed bg-zinc-900 text-zinc-600" : isPlaying ? "bg-f1-red text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    )}
                    data-tip={cantPlay ? "Couldn't load this clip" : isPlaying ? "Pause radio" : "Play radio"}
                  >
                    {cantPlay ? "✕" : isPlaying ? "❚❚" : "▶"}
                  </button>
                  <span
                    className="w-[38px] shrink-0 rounded py-px text-center text-[11px] font-bold"
                    style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
                  >
                    {d?.Tla ?? c.RacingNumber}
                  </span>
                  <span className="text-[12px] tabular-nums text-zinc-400">{trackClock(at, offset)}</span>
                  {now - at < NEW_MS && <span className="ml-auto h-2 w-2 rounded-full bg-sky-400" data-tip="New" />}
                </div>
                {model && (
                  <p className={cn("mt-1 pl-8 text-[12.5px] leading-snug", text ? "text-zinc-100" : "italic text-zinc-500")}>
                    {text
                      ? `“${text}”`
                      : text === ""
                        ? "No speech"
                        : failed[c.url]
                          ? "Couldn't transcribe"
                          : working === c.url
                            ? "Transcribing…"
                            : queue.includes(c.url)
                              ? "Waiting to transcribe"
                              : ""}
                  </p>
                )}
                {isPlaying && (
                  <div className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-800">
                    <div className="h-full bg-f1-red" style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Transcript switch + model download / queue status */
function TranscriptBar() {
  const { model, status, progress, downloaded, error, queue, working, setModel } = useRadio();
  const pending = queue.length + (working ? 1 : 0);
  return (
    <div className="relative flex h-[30px] shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-2.5 text-[11px]">
      <span className="font-semibold uppercase tracking-wide text-zinc-400">Transcripts</span>
      <select
        value={model ?? "off"}
        onChange={(e) => setModel(e.target.value === "off" ? null : (e.target.value as ModelKey))}
        className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200"
        data-tip="Transcribes radio on this Mac with OpenAI's Whisper. The model downloads once."
      >
        <option value="off">Off</option>
        <option value="standard">Standard ({MODEL_SIZES.standard})</option>
        <option value="light">Light ({MODEL_SIZES.light})</option>
      </select>
      <span className="ml-auto truncate text-zinc-500">
        {status === "loading" ? (
          // Files start one after another, so a byte count reads better than a percentage
          `Downloading model · ${Math.round(downloaded / 1e6)} MB`
        ) : status === "error" ? (
          <span className="text-red-400" data-tip={error ?? ""}>
            Model failed to load
          </span>
        ) : status === "ready" ? (
          pending ? `${pending} to go` : "Up to date"
        ) : (
          ""
        )}
      </span>
      {status === "loading" && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-800">
          <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
