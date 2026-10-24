// Adapted from f1-dashboard's components/circuit/CircuitMap.tsx + CircuitMapLive.tsx.
// Car positions come from the Position buffer, interpolated at MultiViewer's track
// time every animation frame, so the cars move in step with the video.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { circuitIdFor, loadCircuit, type CircuitData } from "../data/circuits";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { positionAt } from "../data/buffers";
import { buildRows } from "../data/derive";
import { trackNow, usePitwall } from "../data/store";
import { createCircuitScene, type SceneHandle } from "../circuit3d/scene";
import { createOrbitControls, type OrbitControls } from "../circuit3d/controls";
import { createLabelProjector } from "../circuit3d/labels";
import { createCarLayer, type CarRenderInput } from "../circuit3d/cars";
import { makeGpsMapper } from "../circuit3d/gpsTransform";
import { DRS_COLOR, SECTOR_COLORS, type ViewPreset } from "../circuit3d/constants";
import { cn } from "../lib/format";
import { useSize } from "../ui/hooks";

interface Loaded {
  id: string;
  circuit: CircuitData;
  geometry: CircuitGeometry | null;
}

export function TrackMap() {
  const info = usePitwall((s) => s.live.SessionInfo);
  const circuitId = useMemo(() => circuitIdFor(info), [info]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setMissing(false);
    if (!circuitId) {
      setLoaded(null);
      setMissing(!!info);
      return;
    }
    loadCircuit(circuitId).then((r) => {
      if (!alive) return;
      if (r) setLoaded({ id: circuitId, ...r });
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [circuitId, info]);

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        No track map for {info?.Meeting?.Circuit?.ShortName ?? "this circuit"} yet
      </div>
    );
  }
  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Waiting for session</div>;
  }
  return <MapScene key={loaded.id} loaded={loaded} />;
}

function MapScene({ loaded }: { loaded: Loaded }) {
  const { circuit, geometry } = loaded;
  const [hostRef, size] = useSize<HTMLDivElement>();
  const chipsRef = useRef<HTMLDivElement>(null);
  const carsRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<{ handle: SceneHandle; controls: OrbitControls } | null>(null);
  const [preset, setPreset] = useState<ViewPreset>("top");
  const [follow, setFollow] = useState(false);
  const ready = size.width > 0 && size.height > 0;

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
    handle.tubeMat.opacity = 1;
    handle.wallMat.opacity = 0.12;
    (handle.marker.material as THREE.MeshBasicMaterial).opacity = 1;
    for (const m of handle.drsMeshes) (m.material as THREE.MeshBasicMaterial).opacity = 0.85;

    const carLayer = createCarLayer(handle, projector, carsRef.current!);
    const mapper = geometry ? mapperFor(geometry) : null;
    let pitSet = new Set<string>();
    let rowsRef = usePitwall.getState().live.TimingData;

    const unsubFrame = handle.onFrame(() => {
      if (!mapper) return;
      const { live, selected } = usePitwall.getState();
      if (live.TimingData !== rowsRef) {
        rowsRef = live.TimingData;
        pitSet = new Set(buildRows(live).filter((r) => r.status === "PIT" || r.status === "OUT").map((r) => r.num));
      }
      const at = trackNow();
      const inputs: CarRenderInput[] = [];
      for (const [num, d] of Object.entries(live.DriverList ?? {})) {
        const p = positionAt(num, at);
        if (!p || (p.x === 0 && p.y === 0)) continue;
        const [xn, yn] = mapper(p.x, p.y);
        inputs.push({
          code: d.Tla,
          color: d.TeamColour ? `#${d.TeamColour}` : "#808080",
          x: xn,
          z: -yn,
          inPit: pitSet.has(num) || p.status === "OffTrack",
          selected: selected.includes(num),
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
  }, [ready, circuit, geometry]);

  useEffect(() => {
    if (!engine || !ready) return;
    engine.handle.resize(size.width, size.height);
    engine.controls.setAspect(size.width / size.height);
  }, [engine, ready, size.width, size.height]);

  // Follow the most recently selected driver
  useEffect(() => {
    if (!engine) return;
    if (!follow) {
      engine.controls.setFollowTarget(null);
      return;
    }
    const v = new THREE.Vector3();
    engine.controls.setFollowTarget(() => {
      const num = usePitwall.getState().selected[0];
      if (!num || !geometry) return null;
      const p = positionAt(num, trackNow());
      if (!p) return null;
      const [xn, yn] = mapperFor(geometry)(p.x, p.y);
      return v.set(xn, 0, -yn);
    });
  }, [engine, follow, geometry]);

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
            <i className="h-2 w-2 rounded-sm" style={{ background: DRS_COLOR }} />OT
          </span>
        )}
      </div>

      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1.5">
        <div className="flex gap-1.5">
          <MapButton active={follow} onClick={() => setFollow((f) => !f)} title="Follow the selected driver">
            follow
          </MapButton>
          {(["top", "3d"] as ViewPreset[]).map((p) => (
            <MapButton key={p} active={preset === p} onClick={() => applyPreset(p)}>
              {p}
            </MapButton>
          ))}
        </div>
        <div className="flex gap-1.5">
          <MapButton onClick={() => engine?.controls.zoomBy(-0.55)} title="Zoom in">+</MapButton>
          <MapButton onClick={() => engine?.controls.zoomBy(0.55)} title="Zoom out">−</MapButton>
        </div>
      </div>

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
