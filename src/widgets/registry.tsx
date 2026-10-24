import type { ComponentType } from "react";
import { TimingTower } from "./TimingTower";
import { TrackMap } from "./TrackMap";
import { Telemetry } from "./Telemetry";
import { RaceControl, SectorLeaderboard, TyreStrategy, WeatherWidget } from "./InfoWidgets";

export type WidgetId = "tower" | "map" | "telemetry" | "racecontrol" | "sectors" | "weather" | "tyres";

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
  racecontrol: { title: "Race control", component: RaceControl, minW: 3, minH: 3 },
  sectors: { title: "Sector leaderboard", component: SectorLeaderboard, minW: 3, minH: 4 },
  weather: { title: "Weather", component: WeatherWidget, minW: 2, minH: 3 },
  tyres: { title: "Tyre strategy", component: TyreStrategy, minW: 3, minH: 4 },
};

export const isWidgetId = (id: string): id is WidgetId => id in WIDGETS;
