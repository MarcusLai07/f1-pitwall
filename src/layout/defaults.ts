import type { LayoutItem } from "react-grid-layout";
import type { SessionKind } from "../data/derive";
import type { WidgetId } from "../widgets/registry";

export type View = "window" | "panel";

export const GRID = {
  window: { cols: 24, rowHeight: 28 },
  panel: { cols: 4, rowHeight: 28 },
} as const;

type Item = Omit<LayoutItem, "i"> & { i: WidgetId };

// Window: 24 columns, sized for ~1400x900. Tower left, map + side widgets right.
const WINDOW_BASE: Item[] = [
  { i: "tower", x: 0, y: 0, w: 13, h: 19 },
  { i: "map", x: 13, y: 0, w: 6, h: 12 },
  { i: "sectors", x: 19, y: 0, w: 5, h: 7 },
  { i: "weather", x: 19, y: 7, w: 5, h: 5 },
  { i: "telemetry", x: 13, y: 12, w: 6, h: 13 },
  { i: "racecontrol", x: 19, y: 12, w: 5, h: 13 },
  { i: "tyres", x: 0, y: 19, w: 13, h: 6 },
];

const WINDOW_RACE: Item[] = [
  { i: "tower", x: 0, y: 0, w: 12, h: 19 },
  { i: "map", x: 12, y: 0, w: 7, h: 12 },
  { i: "racecontrol", x: 19, y: 0, w: 5, h: 12 },
  { i: "tyres", x: 0, y: 19, w: 12, h: 8 },
  { i: "telemetry", x: 12, y: 12, w: 7, h: 15 },
  { i: "weather", x: 19, y: 12, w: 5, h: 5 },
  { i: "sectors", x: 19, y: 17, w: 5, h: 10 },
];

// Side panel: one narrow column, most-used first
const PANEL: Item[] = [
  { i: "tower", x: 0, y: 0, w: 4, h: 18 },
  { i: "map", x: 0, y: 18, w: 4, h: 10 },
  { i: "racecontrol", x: 0, y: 28, w: 4, h: 7 },
  { i: "telemetry", x: 0, y: 35, w: 4, h: 11 },
];

export function defaultLayout(view: View, kind: SessionKind): Item[] {
  if (view === "panel") return PANEL;
  return kind === "race" ? WINDOW_RACE : WINDOW_BASE;
}

export const layoutKey = (view: View, kind: SessionKind) => `layout:${view}:${kind}`;
