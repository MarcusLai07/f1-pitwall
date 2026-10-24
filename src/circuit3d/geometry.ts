import * as THREE from "three";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import {
  BASE_LIFT,
  ELEV_EXAGGERATION,
  FALLBACK_METERS_PER_UNIT,
  FALLBACK_SAMPLES,
  SECTOR_COLORS,
  TUBE_RADIAL_SEGMENTS,
  TUBE_SEGMENTS,
  WALL_SEGMENTS,
} from "./constants";

/** Geometry-space points: x/y normalized plan coords (y up) -> three (x, elev, -y). */
export function pointsFromGeometry(geo: CircuitGeometry): THREE.Vector3[] {
  const metersPerUnit = geo.transform.scale * (geo.transform.scaleAdjust || 1);
  return geo.pts.map(
    ([x, y, z]) =>
      new THREE.Vector3(x, (z / metersPerUnit) * ELEV_EXAGGERATION + BASE_LIFT, -y)
  );
}

/** Fallback for circuits without telemetry: sample the 2D SVG path, flat profile. */
export function pointsFromSvgPath(d: string): THREE.Vector3[] {
  const ns = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(ns, "svg");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d);
  svgEl.appendChild(p);
  document.body.appendChild(svgEl);
  const total = p.getTotalLength();
  const raw: [number, number][] = [];
  for (let i = 0; i < FALLBACK_SAMPLES; i++) {
    const pt = p.getPointAtLength((i / FALLBACK_SAMPLES) * total);
    raw.push([pt.x, pt.y]);
  }
  svgEl.remove();

  const xs = raw.map((r) => r[0]);
  const ys = raw.map((r) => r[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale =
    Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    ) / 2 || 1;
  // svg y-down maps directly onto three z; gentle synthetic profile for depth cues
  return raw.map(([x, y], i) => {
    const u = (i / FALLBACK_SAMPLES) * Math.PI * 2;
    const z = 8 * (1 + Math.sin(u * 2 + 1) * Math.sin(u + 0.5));
    return new THREE.Vector3(
      (x - cx) / scale,
      (z / FALLBACK_METERS_PER_UNIT) * ELEV_EXAGGERATION + BASE_LIFT,
      (y - cy) / scale
    );
  });
}

export function buildCurve(pts: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.08);
}

export function buildTube(
  curve: THREE.CatmullRomCurve3,
  sectors: [number, number] | null,
  radius: number
): { geo: THREE.TubeGeometry; mat: THREE.MeshStandardMaterial } {
  const geo = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, radius, TUBE_RADIAL_SEGMENTS, true);
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.15,
    transparent: true,
    opacity: 0,
  });
  if (sectors) {
    applySectorColors(geo, sectors);
    mat.vertexColors = true;
  } else {
    mat.color = new THREE.Color(SECTOR_COLORS[0]);
  }
  return { geo, mat };
}

/** Per-vertex sector colors for a closed TubeGeometry (verts ordered tubular x radial). */
function applySectorColors(tubeGeo: THREE.TubeGeometry, sectors: [number, number]) {
  const count = tubeGeo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const cols = SECTOR_COLORS.map((c) => new THREE.Color(c));
  const [b1, b2] = sectors;
  for (let i = 0; i < count; i++) {
    const seg = Math.floor(i / (TUBE_RADIAL_SEGMENTS + 1));
    const t = seg / TUBE_SEGMENTS;
    const c = cols[t < b1 ? 0 : t < b2 ? 1 : 2];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  tubeGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Translucent ribbon from the track down to the floor — the elevation cue. */
export function buildWallGeometry(curve: THREE.CatmullRomCurve3): THREE.BufferGeometry {
  const positions = new Float32Array((WALL_SEGMENTS + 1) * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i <= WALL_SEGMENTS; i++) {
    const pt = curve.getPointAt(i / WALL_SEGMENTS);
    positions.set([pt.x, 0, pt.z], i * 6);
    positions.set([pt.x, pt.y, pt.z], i * 6 + 3);
    if (i < WALL_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Overlay tube segments marking DRS zones (kept separate from sector colors). */
export function buildDrsBands(
  curve: THREE.CatmullRomCurve3,
  bands: [number, number][],
  radius: number,
  color: string
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const addSegment = (a: number, b: number) => {
    if (b - a < 0.002) return;
    const samples = Math.max(8, Math.round((b - a) * 200));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      pts.push(curve.getPointAt(a + ((b - a) * i) / samples));
    }
    const sub = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05);
    const geo = new THREE.TubeGeometry(sub, samples * 2, radius, 8, false);
    meshes.push(new THREE.Mesh(geo, mat));
  };
  for (const [a, b] of bands) {
    const a1 = ((a % 1) + 1) % 1;
    const b1 = ((b % 1) + 1) % 1;
    if (b1 >= a1) addSegment(a1, b1);
    else {
      addSegment(a1, 1);
      addSegment(0, b1);
    }
  }
  return meshes;
}

/** Cheap elevation lookup: nearest of the curve's uniform samples.
 *
 * Runs per car per frame, so a caller-provided hint object caches the last
 * matched sample index: cars move continuously along the track, so the next
 * match is almost always within a few samples of the previous one. Full scans
 * only happen on the first lookup or after a discontinuity (pit exit, GPS
 * glitch), detected when the local neighborhood is a poor fit. */
export interface ElevationHint {
  index: number;
}

export function makeElevationSampler(curve: THREE.CatmullRomCurve3, samples = 240) {
  const px = new Float32Array(samples);
  const py = new Float32Array(samples);
  const pz = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const p = curve.getPointAt(i / samples);
    px[i] = p.x;
    py[i] = p.y;
    pz[i] = p.z;
  }
  // A neighborhood miss = farther than a few sample spacings from the track
  const JUMP_THRESHOLD_SQ = 0.05 * 0.05;
  const NEIGHBORHOOD = 6;

  const distSq = (i: number, x: number, z: number) => {
    const dx = px[i] - x;
    const dz = pz[i] - z;
    return dx * dx + dz * dz;
  };

  return (x: number, z: number, hint?: ElevationHint): number => {
    let best = -1;
    let bestD = Infinity;
    if (hint && hint.index >= 0) {
      for (let o = -NEIGHBORHOOD; o <= NEIGHBORHOOD; o++) {
        const i = (hint.index + o + samples) % samples;
        const d = distSq(i, x, z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0 || bestD > JUMP_THRESHOLD_SQ) {
      for (let i = 0; i < samples; i++) {
        const d = distSq(i, x, z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (hint) hint.index = best;
    return py[best];
  };
}
