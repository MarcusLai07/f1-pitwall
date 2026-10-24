// Fits a layout to the window's height so the page never needs to scroll: the bottom
// widget of each column stretches or shrinks to meet the bottom edge. If that widget has
// a fixed height (telemetry), the tallest flexible widget above it takes the difference.
// Applied at render time only; the saved layout keeps what the user arranged.

import type { LayoutItem } from "react-grid-layout";

const overlapsX = (a: LayoutItem, b: LayoutItem) => a.x < b.x + b.w && b.x < a.x + a.w;
const clamp = (v: number, lo = 1, hi = Infinity) => Math.max(lo, Math.min(hi, v));

export function fitToRows(items: readonly LayoutItem[], rows: number, fixed: ReadonlySet<string>): LayoutItem[] {
  const out = items.map((it) => ({ ...it }));
  const isBottom = (it: LayoutItem) => !out.some((b) => b !== it && b.y >= it.y + it.h && overlapsX(b, it));

  // Fixed-height widgets at the bottom: resize the tallest flexible widget above them
  for (const it of out) {
    if (!fixed.has(it.i) || !isBottom(it)) continue;
    const gap = rows - (it.y + it.h);
    if (!gap) continue;
    const above = out.filter((a) => a !== it && !fixed.has(a.i) && a.y + a.h <= it.y && overlapsX(a, it));
    const target = above.sort((a, b) => b.h - a.h)[0];
    if (!target) continue;
    const oldBottom = target.y + target.h;
    const delta = clamp(target.h + gap, target.minH, target.maxH) - target.h;
    target.h += delta;
    for (const b of out) if (b !== target && b.y >= oldBottom && overlapsX(b, target)) b.y += delta;
  }
  // Flexible widgets at the bottom: stretch or shrink to the edge
  for (const it of out) {
    if (fixed.has(it.i) || !isBottom(it)) continue;
    it.h = clamp(rows - it.y, it.minH, it.maxH);
  }
  return out;
}
