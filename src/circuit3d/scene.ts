import * as THREE from "three";
import { createTimer, engine } from "animejs";
import { currentScale } from "../ui/scale";
import "animejs/adapters/three";

// Headless-verification hook: lets tooling tick animations manually when the
// tab is hidden (anime pauses on rAF suspension). Harmless in production.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__animeEngine = engine;
}
import type { CircuitGeometry } from "../circuits/geometry-schema";
import {
  DRS_COLOR,
  TUBE_RADIUS,
} from "./constants";
import {
  buildCurve,
  buildDrsBands,
  buildTube,
  buildWallGeometry,
  makeElevationSampler,
  pointsFromGeometry,
  pointsFromSvgPath,
} from "./geometry";

export interface CircuitSceneOptions {
  geometry: CircuitGeometry | null;
  /** SVG path fallback when geometry is null */
  svgPath?: string;
  /** DRS bands as lap-fraction ranges */
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
  tube: THREE.Mesh;
  tubeGeo: THREE.TubeGeometry;
  tubeMat: THREE.MeshStandardMaterial;
  wallGeo: THREE.BufferGeometry;
  wallMat: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  drsMeshes: THREE.Mesh[];
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
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);

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

  const { geo: tubeGeo, mat: tubeMat } = buildTube(curve, opts.geometry?.sectors ?? null, TUBE_RADIUS);
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  group.add(tube);

  const wallGeo = buildWallGeometry(curve);
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0xe10600,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(wallGeo, wallMat));

  const drsMeshes = buildDrsBands(curve, opts.drsBands ?? [], TUBE_RADIUS * 1.35, DRS_COLOR);
  drsMeshes.forEach((m) => group.add(m));

  const startPt = curve.getPointAt(0);
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.012),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
  );
  marker.position.copy(startPt);
  marker.position.y += 0.045;
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
    tube,
    tubeGeo,
    tubeMat,
    wallGeo,
    wallMat,
    marker,
    drsMeshes,
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
      handle.width = w;
      handle.height = h;
    },
    dispose: () => {
      renderTimer.cancel();
      frameCbs.clear();
      tubeGeo.dispose();
      tubeMat.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      drsMeshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return handle;
}
