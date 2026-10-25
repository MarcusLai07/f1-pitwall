import * as THREE from "three";
import type { CircuitGeometry } from "../circuits/geometry-schema";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  ASPHALT_COLOR,
  BASE_LIFT,
  EDGE_PX,
  ELEV_EXAGGERATION,
  FALLBACK_METERS_PER_UNIT,
  FALLBACK_SAMPLES,
  ROAD_SEGMENTS,
  SECTOR_COLORS,
  WALL_SEGMENTS,
  ZONE_PX,
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

/**
 * The track as a road at its real width: a flat asphalt strip, and its two edges as
 * screen-width lines coloured by sector (the "double line"), so zoomed in you can see
 * where across the track a car is. The centreline is a recorded racing line, so left
 * and right are relative to that, to within a few metres.
 */
export function buildRoad(
  curve: THREE.CatmullRomCurve3,
  halfWidth: number,
  sectors: [number, number] | null,
  segments = ROAD_SEGMENTS
): { asphalt: THREE.Mesh; edges: Line2[]; edgeMat: LineMaterial } {
  const left: number[] = [];
  const right: number[] = [];
  const colors: number[] = [];
  const cols = SECTOR_COLORS.map((c) => new THREE.Color(c));
  const tri: number[] = [];
  const verts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i % segments) / segments;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    // Perpendicular in the ground plane
    const len = Math.hypot(t.x, t.z) || 1;
    const nx = -t.z / len;
    const nz = t.x / len;
    left.push(p.x + nx * halfWidth, p.y, p.z + nz * halfWidth);
    right.push(p.x - nx * halfWidth, p.y, p.z - nz * halfWidth);
    const c = sectors ? cols[u < sectors[0] ? 0 : u < sectors[1] ? 1 : 2] : cols[0];
    colors.push(c.r, c.g, c.b);
    verts.push(p.x + nx * halfWidth, p.y - 0.001, p.z + nz * halfWidth, p.x - nx * halfWidth, p.y - 0.001, p.z - nz * halfWidth);
    if (i < segments) {
      const a = i * 2;
      tri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(tri);
  const asphalt = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: ASPHALT_COLOR, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false })
  );
  const edgeMat = new LineMaterial({ linewidth: EDGE_PX, vertexColors: true, worldUnits: false, transparent: true });
  const edges = [left, right].map((positions) => {
    const g = new LineGeometry();
    g.setPositions(positions);
    g.setColors(colors);
    return new Line2(g, edgeMat);
  });
  return { asphalt, edges, edgeMat };
}

/** Overtake zones as a green line down the middle of the road */
export function buildZoneLines(curve: THREE.CatmullRomCurve3, bands: [number, number][], color: string): { lines: Line2[]; mat: LineMaterial } {
  const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: ZONE_PX, worldUnits: false, transparent: true, opacity: 0.9 });
  const lines: Line2[] = [];
  const add = (a: number, b: number) => {
    if (b - a < 0.002) return;
    const n = Math.max(8, Math.round((b - a) * 600));
    const pos: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(a + ((b - a) * i) / n);
      pos.push(p.x, p.y + 0.0005, p.z);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    lines.push(new Line2(g, mat));
  };
  for (const [a, b] of bands) {
    const a1 = ((a % 1) + 1) % 1;
    const b1 = ((b % 1) + 1) % 1;
    if (b1 >= a1) add(a1, b1);
    else {
      add(a1, 1);
      add(0, b1);
    }
  }
  return { lines, mat };
}
