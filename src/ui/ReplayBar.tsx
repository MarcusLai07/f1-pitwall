import type { ReplayControls } from "../data/replay";
import { usePitwall } from "../data/store";
import { formatDuration } from "../lib/format";
import { cn } from "../lib/format";

const SPEEDS = [1, 2, 4, 8, 16];

export function ReplayBar({ controls }: { controls: ReplayControls }) {
  const replay = usePitwall((s) => s.replay);
  if (!replay || replay.loadProgress != null) return null;
  const { start, end, at, playing, speed, name } = replay;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-800 bg-zinc-950 px-3 py-1.5">
      <button
        onClick={playing ? controls.pause : controls.play}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800 text-sm text-white hover:bg-zinc-700"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={() => controls.seek(at - 10_000)} className="text-[10px] font-bold text-zinc-400 hover:text-white" title="Back 10 s">
        −10s
      </button>
      <button onClick={() => controls.seek(at + 10_000)} className="text-[10px] font-bold text-zinc-400 hover:text-white" title="Forward 10 s">
        +10s
      </button>
      <span className="w-14 text-right font-f1 text-xs font-bold tabular-nums text-zinc-200">{formatDuration(at - start)}</span>
      <input
        type="range"
        min={start}
        max={end}
        step={1000}
        value={at}
        onChange={(e) => controls.seek(Number(e.target.value))}
        className="min-w-[140px] flex-1 accent-[#e10600]"
      />
      <span className="w-14 font-f1 text-xs tabular-nums text-zinc-500">{formatDuration(end - start)}</span>
      <div className="flex overflow-hidden rounded-md border border-zinc-800">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => controls.setSpeed(s)}
            className={cn("px-1.5 py-0.5 text-[10px] font-bold", s === speed ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="hidden max-w-48 truncate text-[10px] text-zinc-500 lg:inline" title={name}>
        {name}
      </span>
    </div>
  );
}
