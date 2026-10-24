import type { ComponentType } from "react";
import { TimingTower } from "./TimingTower";
import { TrackMap } from "./TrackMap";
import { Telemetry } from "./Telemetry";
import { SectorLeaderboard } from "./InfoWidgets";
import { TeamRadio } from "./TeamRadio";

// Weather lives in the header, tyre history in the tower's tyre popover, and race
// control with investigations, track limits and race trace in the bottom drawer
export type WidgetId = "tower" | "map" | "telemetry" | "sectors" | "radio";

export interface WidgetDef {
  title: string;
  component: ComponentType;
  minW: number;
  minH: number;
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  tower: { title: "Timing", component: TimingTower, minW: 4, minH: 6 },
  map: { title: "Track map", component: TrackMap, minW: 3, minH: 5 },
  telemetry: { title: "Telemetry", component: Telemetry, minW: 3, minH: 6 },
  sectors: { title: "Sector leaderboard", component: SectorLeaderboard, minW: 3, minH: 2 },
  radio: { title: "Team radio", component: TeamRadio, minW: 3, minH: 3 },
};

export const isWidgetId = (id: string): id is WidgetId => id in WIDGETS;
