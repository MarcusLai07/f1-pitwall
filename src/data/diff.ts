// Structural diff/patch for plain JSON values, used to turn a recording of full
// states into a sequence of states that share every unchanged branch.

export const DELETED = Symbol("deleted");

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Patch = unknown;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns undefined when equal. Arrays are compared whole and replaced whole. */
export function diff(prev: unknown, next: unknown): Patch | undefined {
  if (prev === next) return undefined;
  if (isObject(prev) && isObject(next)) {
    let out: Record<string, unknown> | undefined;
    for (const k in next) {
      const d = k in prev ? diff(prev[k], next[k]) : next[k];
      if (d !== undefined) (out ??= {})[k] = d;
    }
    for (const k in prev) {
      if (!(k in next)) (out ??= {})[k] = DELETED;
    }
    return out;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    return JSON.stringify(prev) === JSON.stringify(next) ? undefined : next;
  }
  return next as Json;
}

/** Applies a patch made by diff(base, x), returning x with base's untouched branches reused. */
export function apply<T>(base: T, patch: Patch | undefined): T {
  if (patch === undefined) return base;
  if (!isObject(patch) || !isObject(base)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const k in patch) {
    const p = patch[k];
    if (p === DELETED) delete out[k];
    else out[k] = k in base ? apply(base[k], p) : p;
  }
  return out as T;
}
