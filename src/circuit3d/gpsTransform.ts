import type { GpsTransform } from "../circuits/geometry-schema";

export type GpsMapper = (x: number, y: number) => [number, number];

/**
 * Maps raw F1 Position.z coordinates into normalized geometry space using
 * the transform baked at data-generation time (see extract-circuit-geometry.py).
 *
 * The F1 positional stream is in decimeters and the baked rawBounds are in
 * meters, so the unit factor is 0.1. Pass `unit` when the source is known;
 * otherwise it's auto-detected from observed extents.
 *
 * Returns normalized [xn, yn] with y UP (same frame as CircuitGeometry.pts).
 */
export function makeGpsMapper(t: GpsTransform, knownUnit?: number): GpsMapper {
  const a = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [ox, oy] = t.offset ?? [0, 0];
  const scale = t.scale * (t.scaleAdjust || 1);
  const refExtent = Math.max(
    t.rawBounds[1] - t.rawBounds[0],
    t.rawBounds[3] - t.rawBounds[2]
  );

  // Unit auto-detection: accumulate observed bounds until stable
  let unit = knownUnit ?? 0.1; // decimeters -> meters (expected)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let samples = 0;
  let locked = knownUnit !== undefined;

  return (x: number, y: number): [number, number] => {
    if (!locked) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      samples++;
      if (samples >= 40) {
        const extent = Math.max(maxX - minX, maxY - minY);
        if (extent > 0) {
          const candidates = [0.1, 1, 10];
          unit = candidates.reduce((best, c) =>
            Math.abs(extent * c - refExtent) < Math.abs(extent * best - refExtent) ? c : best
          );
        }
        locked = true;
      }
    }
    const xm = x * unit;
    const ym = y * unit;
    const xr = xm * cos - ym * sin;
    const yr = xm * sin + ym * cos;
    return [(xr - t.center[0]) / scale + ox, (yr - t.center[1]) / scale + oy];
  };
}
