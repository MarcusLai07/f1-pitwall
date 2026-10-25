import * as THREE from "three";
import { createTimer, engine } from "animejs";
import { currentScale } from "../ui/scale";
import "animejs/adapters/three";

// Headless-verification hook: lets tooling tick animations manually when the
// tab is hidden (anime pauses on rAF suspension). Harmless in production.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__animeEngine = engine;
}
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { DRS_COLOR, FALLBACK_METERS_PER_UNIT, TRACK_WIDTH_M } from "./constants";
import {
  buildCurve,
  buildRoad,
  buildWallGeometry,
  buildZoneLines,
  makeElevationSampler,
  pointsFromGeometry,
  pointsFromSvgPath,
} from "./geometry";

export interface CircuitSceneOptions {
  geometry: CircuitGeometry | null;
  /** SVG path fallback when geometry is null */
  svgPath?: string;
  /** Overtake zones as lap-fraction ranges */
  drsBands?: [number, number][];
  width: number;
  height: number;
}

export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  /** Group units per metre, for sizing things in real distances */
  unitsPerMeter: number;
  wallGeo: THREE.BufferGeometry;
  wallMat: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  width: number;
  height: number;
  elevationAt: (x: number, z: number, hint?: { index: number }) => number;
  /** Register a per-frame callback; returns unsubscribe */
  onFrame: (cb: (deltaMs: number) => void) => () => void;
  /** Resize the canvas (grid widgets resize freely) */
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export function createCircuitScene(host: HTMLElement, opts: CircuitSceneOptions): SceneHandle {
  const { width, height } = opts;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // The UI may be zoomed (ui/scale.ts): render at the pixels the canvas really covers
  renderer.setPixelRatio(Math.min(window.devicePixelRatio * currentScale(), 3));
  renderer.setSize(width, height);
  host.insertBefore(renderer.domElement, host.firstChild);

  const scene = new THREE.Scene();
  // Near plane close in: zoomed right into a corner the camera is very near the track
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.005, 50);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe10600, 0.5);
  rim.position.set(-2, 1, -2);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const grid = new THREE.GridHelper(3.4, 24, 0x33333f, 0x1a1a24);
  group.add(grid);

  const pts = opts.geometry
    ? pointsFromGeometry(opts.geometry)
    : pointsFromSvgPath(opts.svgPath ?? "M0 0 L1 1");
  const curve = buildCurve(pts);

  const metersPerUnit = opts.geometry ? opts.geometry.transform.scale * (opts.geometry.transform.scaleAdjust || 1) : FALLBACK_METERS_PER_UNIT;
  const road = buildRoad(curve, TRACK_WIDTH_M / 2 / metersPerUnit, opts.geometry?.sectors ?? null);
  group.add(road.asphalt, ...road.edges);
  const zones = buildZoneLines(curve, opts.drsBands ?? [], DRS_COLOR);
  zones.lines.forEach((l) => group.add(l));
  const lineMats: LineMaterial[] = [road.edgeMat, zones.mat];
  for (const m of lineMats) m.resolution.set(width, height);

  const wallGeo = buildWallGeometry(curve);
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0xe10600,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(wallGeo, wallMat));

  // Start/finish: a white line painted across the road
  const startPt = curve.getPointAt(0);
  const startDir = curve.getTangentAt(0);
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry((TRACK_WIDTH_M * 1.3) / metersPerUnit, 0.0004, 3 / metersPerUnit),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
  );
  marker.position.copy(startPt);
  marker.position.y += 0.0008;
  marker.rotation.y = Math.atan2(startDir.x, startDir.z);
  group.add(marker);

  const elevationAt = makeElevationSampler(curve);

  const frameCbs = new Set<(deltaMs: number) => void>();
  const renderTimer = createTimer({
    onUpdate: (t) => {
      frameCbs.forEach((cb) => cb(t.deltaTime));
      renderer.render(scene, camera);
    },
  });

  const handle: SceneHandle = {
    scene,
    camera,
    renderer,
    group,
    curve,
    unitsPerMeter: 1 / metersPerUnit,
    wallGeo,
    wallMat,
    marker,
    width,
    height,
    elevationAt,
    onFrame: (cb) => {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    resize: (w, h) => {
      if (w < 1 || h < 1) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const m of lineMats) m.resolution.set(w, h);
      handle.width = w;
      handle.height = h;
    },
    dispose: () => {
      renderTimer.cancel();
      frameCbs.clear();
      road.asphalt.geometry.dispose();
      (road.asphalt.material as THREE.Material).dispose();
      const lines: Line2[] = [...road.edges, ...zones.lines];
      for (const l of lines) l.geometry.dispose();
      for (const m of lineMats) m.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      // dispose() keeps the GL context; browsers allow ~16, so hand it back now
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  return handle;
}
