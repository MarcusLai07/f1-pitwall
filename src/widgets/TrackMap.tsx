// Adapted from f1-dashboard's components/circuit/CircuitMap.tsx + CircuitMapLive.tsx.
// Car positions come from the Position buffer, interpolated at the board's track time
// every animation frame, so the cars move in step with the timing.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { applySim } from "../circuit3d/autoAlign";
import { useTrackShape, type TrackShape } from "./trackShape";
import { MapBanners } from "./MapBanners";
import { positionAt } from "../data/buffers";
import { buildRows, sessionKind } from "../data/derive";
import { useFreeFeed } from "../data/liveSettings";
import { trackNow, usePitwall } from "../data/store";
import { createCircuitScene, type SceneHandle } from "../circuit3d/scene";
import { createOrbitControls, type OrbitControls } from "../circuit3d/controls";
import { createLabelProjector } from "../circuit3d/labels";
import { createCarLayer, type CarRenderInput } from "../circuit3d/cars";
import { makeGpsMapper } from "../circuit3d/gpsTransform";
import { DRS_COLOR, SECTOR_COLORS, VIEW_PRESETS, type ViewPreset } from "../circuit3d/constants";

// Camera distance when following a car: a few hundred metres of track in view
const FOLLOW_ZOOM = 0.34;
import { cn } from "../lib/format";
import { loadValue, saveValue } from "../lib/storage";
import { useSize } from "../ui/hooks";

export function TrackMap() {
  const { shape, status } = useTrackShape();
  // While a new shape is being built, the stored one would put cars in the wrong place
  const building = status === "building";
  // F1's free feed has no car positions
  const freeFeed = useFreeFeed();

  if (!shape) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        {building ? "Building the track map from live positions… (needs one clean lap)" : "Waiting for session"}
      </div>
    );
  }
  return (
    <MapScene key={`${shape.key}:${shape.source}`} shape={shape} hideCars={building}>
      <MapBanners />
      {freeFeed && (
        <span className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950/90 px-3 py-1.5 text-[11px] text-zinc-300">
          Cars on the map come with your F1 TV sign-in (Sessions → Sign in to F1 TV)
        </span>
      )}
      {building && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-zinc-700 bg-zinc-950/90 px-3 py-1.5 text-[11px] text-zinc-300">
          This layout doesn't match the stored map · building it from live positions…
        </span>
      )}
      {shape.source !== "stored" && (
        <span
          className="pointer-events-none absolute bottom-8 left-2.5 text-[9px] uppercase tracking-[0.14em] text-zinc-600"
          title={shape.source === "live" ? "Drawn from a live lap because the stored track shape didn't match" : "Stored track shape re-aligned to live positions"}
        >
          {shape.source === "live" ? "Track from live positions" : "Track auto-aligned"}
        </span>
      )}
    </MapScene>
  );
}

function MapScene({ shape, hideCars, children }: { shape: TrackShape; hideCars: boolean; children?: React.ReactNode }) {
  const { circuit, geometry, sim } = shape;
  const [hostRef, size] = useSize<HTMLDivElement>();
  const chipsRef = useRef<HTMLDivElement>(null);
  const carsRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<{ handle: SceneHandle; controls: OrbitControls } | null>(null);
  const [preset, setPreset] = useState<ViewPreset>("top");
  const [follow, setFollow] = useState(false);
  // Racing numbers in the dots; names beside them only for selected drivers unless this is on
  const [names, setNames] = useState(false);
  const namesRef = useRef(names);
  namesRef.current = names;
  useEffect(() => {
    loadValue<boolean>("map:names").then((v) => v !== undefined && setNames(v));
  }, []);
  const ready = size.width > 0 && size.height > 0;
  const hideCarsRef = useRef(hideCars);
  hideCarsRef.current = hideCars;
  // Raw positions (decimeters) → geometry space; a re-fitted transform takes meters
  const toTrack = useMemo(
    () => (sim ? (x: number, y: number) => applySim(sim, x / 10, y / 10) : geometry ? mapperFor(geometry) : null),
    [sim, geometry]
  );

  // Race control gates 2026 Overtake Mode like it used to gate DRS
  const overtakeEnabled = usePitwall((s) => {
    const m = s.live.RaceControlMessages?.Messages;
    const list = Array.isArray(m) ? m : m ? Object.values(m) : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const msg = list[i].Message?.toUpperCase() ?? "";
      if (msg.includes("OVERTAKE ENABLED")) return true;
      if (msg.includes("OVERTAKE DISABLED")) return false;
    }
    return null;
  });
  const isRace = usePitwall((s) => sessionKind(s.live.SessionInfo) === "race");
  // Overtake Mode is open to a car within a second of the one ahead (F1 judges it at a
  // detection point; this is the same rule on the live interval)
  const overtakeRef = useRef(false);
  overtakeRef.current = isRace && overtakeEnabled === true;

  const corners = useMemo(() => {
    if (geometry) {
      return geometry.corners.map(([label, frac]) => {
        const turn = circuit.corners?.find((t) => t.number === parseInt(label, 10));
        return { label, frac, name: turn?.name };
      });
    }
    return (circuit.corners ?? []).map((t) => ({ label: String(t.number), frac: t.position / 100, name: t.name }));
  }, [circuit, geometry]);

  // Scene lifecycle (once per circuit; resizes go through handle.resize)
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;
    const handle = createCircuitScene(host, {
      geometry,
      svgPath: circuit.svg?.path,
      drsBands: geometry?.overtakeZones ?? [],
      width: host.clientWidth,
      height: host.clientHeight,
    });
    const controls = createOrbitControls(handle, { autoSpin: false, initialPreset: "top" });
    const projector = createLabelProjector(handle);

    for (const el of Array.from(chipsRef.current?.children ?? []) as HTMLElement[]) {
      const frac = parseFloat(el.dataset.frac ?? "0");
      const p = handle.curve.getPointAt(((frac % 1) + 1) % 1);
      projector.add(el, new THREE.Vector3(p.x, p.y + 0.07, p.z));
      el.style.opacity = "0.9";
    }
    handle.wallMat.opacity = 0.12;

    const carLayer = createCarLayer(handle, projector, carsRef.current!);
    const mapper = toTrack;
    let pitSet = new Set<string>();
    let order = new Map<string, { position: number; inRange: boolean }>();
    let rowsRef: unknown; // the TimingData the order was built from

    const unsubFrame = handle.onFrame(() => {
      if (!mapper || hideCarsRef.current) {
        carLayer.sync([]);
        return;
      }
      const { live, selected } = usePitwall.getState();
      if (live.TimingData !== rowsRef) {
        rowsRef = live.TimingData;
        const rows = buildRows(live);
        pitSet = new Set(rows.filter((r) => r.status === "PIT" || r.status === "OUT").map((r) => r.num));
        order = new Map(
          rows.map((r) => {
            const gap = Number(r.interval.replace("+", ""));
            return [r.num, { position: r.position, inRange: r.position > 1 && r.status === "RUN" && Number.isFinite(gap) && gap > 0 && gap < 1 }];
          })
        );
      }
      const at = trackNow();
      const inputs: CarRenderInput[] = [];
      for (const [num, d] of Object.entries(live.DriverList ?? {})) {
        const p = positionAt(num, at);
        if (!p || (p.x === 0 && p.y === 0)) continue;
        const [xn, yn] = mapper(p.x, p.y);
        const o = order.get(num);
        inputs.push({
          num,
          code: d.Tla,
          color: d.TeamColour ? `#${d.TeamColour}` : "#808080",
          x: xn,
          z: -yn,
          position: o?.position ?? 99,
          inPit: pitSet.has(num) || p.status === "OffTrack",
          selected: selected.includes(num),
          overtake: overtakeRef.current && !!o?.inRange,
          named: namesRef.current,
        });
      }
      carLayer.sync(inputs);
    });

    setEngine({ handle, controls });
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__pitwallMap = handle;
    return () => {
      setEngine(null);
      unsubFrame();
      carLayer.dispose();
      projector.dispose();
      controls.dispose();
      handle.dispose();
    };
    // Built once per circuit; size changes go through handle.resize below
  }, [ready, circuit, geometry, toTrack]);

  useEffect(() => {
    if (!engine || !ready) return;
    engine.handle.resize(size.width, size.height);
    engine.controls.setAspect(size.width / size.height);
  }, [engine, ready, size.width, size.height]);

  // Follow the most recently selected driver, zoomed in to where you can see which side
  // of the road each car is on; back out to the view's usual distance afterwards
  const followedRef = useRef(false);
  useEffect(() => {
    if (!engine) return;
    if (!follow) {
      engine.controls.setFollowTarget(null);
      if (followedRef.current) engine.controls.zoomTo(VIEW_PRESETS[preset].r);
      followedRef.current = false;
      return;
    }
    followedRef.current = true;
    engine.controls.zoomTo(FOLLOW_ZOOM);
    const v = new THREE.Vector3();
    engine.controls.setFollowTarget(() => {
      const num = usePitwall.getState().selected[0];
      if (!num || !toTrack) return null;
      const p = positionAt(num, trackNow());
      if (!p) return null;
      const [xn, yn] = toTrack!(p.x, p.y);
      return v.set(xn, 0, -yn);
    });
    // The preset is only read on the way out, so it isn't a dependency
  }, [engine, follow, toTrack]);

  const applyPreset = (p: ViewPreset) => {
    setPreset(p);
    engine?.controls.setPreset(p);
  };

  return (
    <div ref={hostRef} className="relative h-full w-full select-none overflow-hidden">
      <div ref={chipsRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        {corners.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-frac={c.frac}
            title={c.name ? `T${c.label} · ${c.name}` : `Turn ${c.label}`}
            className="absolute left-0 top-0 rounded-md border border-border bg-background/85 px-1 py-px text-[9px] font-bold tracking-wide text-foreground opacity-0"
          >
            {c.label}
          </span>
        ))}
      </div>
      <div ref={carsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      <div className="pointer-events-none absolute bottom-2 left-2.5 flex gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        {geometry?.sectors &&
          SECTOR_COLORS.map((c, i) => (
            <span key={c} className="flex items-center gap-1">
              <i className="h-2 w-2 rounded-sm" style={{ background: c }} />S{i + 1}
            </span>
          ))}
        {(geometry?.overtakeZones?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1" title="Overtake zones: the main flat-out stretches (2026 has no DRS)">
            <i className="h-0.5 w-3 rounded-sm" style={{ background: DRS_COLOR }} />OT
          </span>
        )}
        {isRace && overtakeEnabled && (
          <span className="flex items-center gap-1 normal-case tracking-normal" title="Within a second of the car ahead: Overtake Mode is open to them (estimated from the live interval)">
            <i className="h-2.5 w-2.5 rounded-full" style={{ boxShadow: `0 0 0 2px ${DRS_COLOR}` }} />
            within 1 s
          </span>
        )}
      </div>

      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1.5">
        <div className="flex gap-1.5">
          <MapButton
            active={names}
            onClick={() => {
              setNames(!names);
              saveValue("map:names", !names);
            }}
            title="Show every driver's code beside their number (selected drivers always show theirs)"
          >
            names
          </MapButton>
          <MapButton active={follow} onClick={() => setFollow((f) => !f)} title="Follow the selected driver, zoomed in">
            follow
          </MapButton>
          {(["top", "3d"] as ViewPreset[]).map((p) => (
            <MapButton key={p} active={preset === p} onClick={() => applyPreset(p)}>
              {p}
            </MapButton>
          ))}
        </div>
        <div className="flex gap-1.5">
          <MapButton
            onClick={() => {
              setPreset("top");
              engine?.controls.reset();
            }}
            title="Fit the whole track (or double-click the map)"
          >
            fit
          </MapButton>
          <MapButton onClick={() => engine?.controls.zoomBy(-0.55)} title="Zoom in">+</MapButton>
          <MapButton onClick={() => engine?.controls.zoomBy(0.55)} title="Zoom out">−</MapButton>
        </div>
      </div>

      <span className="pointer-events-none absolute right-2.5 top-2 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
        drag to move · right-drag to rotate · scroll to zoom
      </span>

      {overtakeEnabled !== null && (
        <span
          className={cn(
            "pointer-events-none absolute left-2.5 top-2 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
            overtakeEnabled ? "animate-pulse border-f1-green/60 bg-f1-green/15 text-f1-green" : "border-border bg-background/70 text-muted-foreground"
          )}
        >
          Overtake {overtakeEnabled ? "enabled" : "disabled"}
        </span>
      )}
      {children}
    </div>
  );
}

// F1 positions are decimeters (unit 0.1); one mapper per circuit
const mapperCache = new WeakMap<CircuitGeometry, ReturnType<typeof makeGpsMapper>>();
function mapperFor(g: CircuitGeometry) {
  let m = mapperCache.get(g);
  if (!m) mapperCache.set(g, (m = makeGpsMapper(g.transform, 0.1)));
  return m;
}

function MapButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "h-7 min-w-7 rounded-md border bg-background/85 px-2 text-[10px] font-bold uppercase tracking-wider hover:text-foreground",
        active ? "border-f1-red text-foreground" : "border-border text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}
