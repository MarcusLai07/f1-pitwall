import type { LayoutItem } from "react-grid-layout";
import type { SessionKind } from "../data/derive";
import type { WidgetId } from "../widgets/registry";

export type View = "window" | "panel";

// One grid step (row height + gap) = one 30 px timing-tower row, so the tower resizes
// a driver at a time. Its column header is 22 px: tower height h fits h - 1 drivers.
export const GRID_MARGIN = 6;
const ROW = 30 - GRID_MARGIN;
export const GRID = {
  window: { cols: 24, rowHeight: ROW },
  panel: { cols: 4, rowHeight: ROW },
} as const;

/** Grid rows for a tower showing every driver */
export const towerRowsFor = (drivers: number) => drivers + 1;

// Telemetry is sized by its cards: each card row is 9 grid rows, and cards go two
// across once the widget is wide enough
export const TELEMETRY_CARD_ROWS = 9;
export const TELEMETRY_TWO_COLUMN_PX = 330;
export const telemetryColumns = (widthPx: number, drivers: number) =>
  drivers > 1 && widthPx >= TELEMETRY_TWO_COLUMN_PX ? 2 : 1;
export const telemetryRowsFor = (widthPx: number, drivers: number) =>
  Math.ceil(drivers / telemetryColumns(widthPx, drivers)) * TELEMETRY_CARD_ROWS;

type Item = Omit<LayoutItem, "i"> & { i: WidgetId };

// Window: 24 columns, ~27 rows at 1440x900. Tower on the left sized to all 22
// drivers (race control and friends live in the drawer under it). On the right: the
// map across the top, then sector leaderboard over telemetry with team radio beside.
const WINDOW: Item[] = [
  { i: "tower", x: 0, y: 0, w: 13, h: towerRowsFor(22) },
  { i: "map", x: 13, y: 0, w: 11, h: 14 },
  { i: "sectors", x: 13, y: 14, w: 7, h: 4 },
  { i: "telemetry", x: 13, y: 18, w: 7, h: TELEMETRY_CARD_ROWS },
  { i: "radio", x: 20, y: 14, w: 4, h: 4 + TELEMETRY_CARD_ROWS },
];

// Side panel: one narrow column, most-used first
const PANEL: Item[] = [
  { i: "tower", x: 0, y: 0, w: 4, h: towerRowsFor(22) },
  { i: "map", x: 0, y: 23, w: 4, h: 12 },
  { i: "sectors", x: 0, y: 35, w: 4, h: 4 },
  { i: "telemetry", x: 0, y: 39, w: 4, h: TELEMETRY_CARD_ROWS },
  { i: "radio", x: 0, y: 48, w: 4, h: 8 },
];

export function defaultLayout(view: View, _kind: SessionKind): Item[] {
  return view === "panel" ? PANEL : WINDOW;
}

export const layoutKey = (view: View, kind: SessionKind) => `layout:v4:${view}:${kind}`;
