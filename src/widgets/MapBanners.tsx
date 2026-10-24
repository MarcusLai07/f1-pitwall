// F1 TV-style banners at the top of the track map: a new fastest lap (provisional pole
// in Q3) and, in races, a new leader. They only fire for changes seen while watching,
// not on load, a new session or a replay seek, and a fastest lap only when the session
// best actually improves (a deleted lap makes it slower and stays quiet).

import { useEffect, useRef, useState } from "react";
import { sessionKind } from "../data/derive";
import { usePitwall } from "../data/store";
import { cn, isLightColor, lapSeconds } from "../lib/format";

type Kind = "fastest" | "pole" | "leader";

interface Banner {
  id: number;
  kind: Kind;
  num: string;
  time?: string;
  lap?: number;
}

const SHOW_MS = 4500;
const LABEL: Record<Kind, string> = { fastest: "Fastest lap", pole: "Provisional pole", leader: "New leader" };

export function MapBanners() {
  const stats = usePitwall((s) => s.live.TimingStats);
  const timing = usePitwall((s) => s.live.TimingData);
  const info = usePitwall((s) => s.live.SessionInfo);
  const resync = usePitwall((s) => s.resync);
  const drivers = usePitwall((s) => s.live.DriverList);
  const [queue, setQueue] = useState<Banner[]>([]);
  const prev = useRef<{ session?: string; resync?: number; best?: number; leader?: string }>({});
  const nextId = useRef(1);

  useEffect(() => {
    const kind = sessionKind(info);
    const session = info?.Path;
    let fastest: Banner | undefined;
    for (const [num, line] of Object.entries(stats?.Lines ?? {})) {
      const pb = line.PersonalBestLapTime;
      if (pb?.Position === 1 && pb.Value) fastest = { id: 0, kind: "fastest", num, time: pb.Value, lap: pb.Lap };
    }
    const leader =
      kind === "race" ? Object.entries(timing?.Lines ?? {}).find(([, l]) => l.Position === "1")?.[0] : undefined;
    const best = lapSeconds(fastest?.time) ?? undefined;

    const p = prev.current;
    // Only changes between two snapshots of the same session, with no seek in between
    if (p.session === session && p.resync === resync) {
      const add: Banner[] = [];
      if (fastest && best !== undefined && p.best !== undefined && best < p.best - 0.0005) {
        const pole = kind === "qualifying" && (timing?.SessionPart ?? 0) === 3;
        add.push({ ...fastest, id: nextId.current++, kind: pole ? "pole" : "fastest" });
      }
      if (leader && p.leader && leader !== p.leader) add.push({ id: nextId.current++, kind: "leader", num: leader });
      if (add.length) setQueue((q) => [...q, ...add].slice(-3));
    }
    prev.current = { session, resync, best, leader };
  }, [stats, timing, info, resync]);

  // One banner at a time
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;
  const d = drivers?.[current.num];
  const color = d?.TeamColour ? `#${d.TeamColour}` : "#808080";
  const accent = current.kind === "leader" ? "#e10600" : "#7c3aed";
  return (
    <div
      key={current.id}
      className="map-banner pointer-events-none absolute left-1/2 top-3 z-10 flex max-w-[94%] -translate-x-1/2 items-stretch overflow-hidden whitespace-nowrap rounded-md font-f1 shadow-2xl shadow-black/70"
    >
      <span className="flex shrink-0 items-center px-3 text-[12px] font-black uppercase tracking-wider text-white" style={{ background: accent }}>
        {current.kind === "leader" ? "P1" : "⏱"}
        <span className="ml-2">{LABEL[current.kind]}</span>
      </span>
      <span className="w-1.5" style={{ background: color }} />
      <span className="flex min-w-0 items-center gap-3 bg-zinc-950/95 px-3 py-1.5">
        <span className="flex min-w-0 flex-col truncate leading-tight">
          <span className="text-[14px] font-black uppercase tracking-wide text-white">{d?.BroadcastName ?? d?.Tla ?? current.num}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">{d?.TeamName}</span>
        </span>
        {current.time && (
          <span className={cn("rounded px-2 py-0.5 text-[16px] font-black tabular-nums", current.kind === "leader" ? "text-white" : "text-purple-300")}>
            {current.time}
          </span>
        )}
        {current.lap ? <span className="text-[11px] font-semibold uppercase text-zinc-400">Lap {current.lap}</span> : null}
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-bold"
          style={{ backgroundColor: color, color: isLightColor(color) ? "#000" : "#fff" }}
        >
          {d?.Tla ?? current.num}
        </span>
      </span>
    </div>
  );
}
