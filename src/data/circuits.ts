// Maps the live session's circuit onto the 3D geometry baked for f1-dashboard
// (FastF1 fastest-lap telemetry, see that repo's scripts/extract-circuit-geometry.py).

import type { CircuitGeometry } from "../circuits/geometry-schema";
import type { SessionInfo } from "./types";

export interface CircuitCorner {
  number: number;
  name?: string;
  position: number; // percent along the lap
}

export interface CircuitData {
  id: string;
  name: string;
  shortName: string;
  location: string;
  country?: string;
  length: number; // km
  turns?: number;
  laps?: number;
  raceDistance?: number; // km
  firstGP?: number;
  pitLaneTimeLoss?: number; // seconds
  drsZones?: unknown[];
  records?: { lapRecord?: { time?: string; driver?: string; year?: number } };
  svg?: { path?: string };
  corners?: CircuitCorner[];
}

const circuitFiles = import.meta.glob<{ default: CircuitData }>("../circuits/*.json");
const geometryFiles = import.meta.glob<{ default: CircuitGeometry }>("../circuits/geometry/*.json");

// F1 feed Meeting.Circuit.ShortName -> circuit id
const BY_SHORT_NAME: Record<string, string> = {
  melbourne: "albert-park",
  sakhir: "bahrain",
  baku: "baku",
  catalunya: "barcelona",
  austin: "cota",
  hungaroring: "hungaroring",
  imola: "imola",
  interlagos: "interlagos",
  jeddah: "jeddah",
  "las vegas": "las-vegas",
  lusail: "lusail",
  singapore: "marina-bay",
  "mexico city": "mexico-city",
  miami: "miami",
  "monte carlo": "monaco",
  montreal: "montreal",
  monza: "monza",
  spielberg: "red-bull-ring",
  shanghai: "shanghai",
  silverstone: "silverstone",
  "spa-francorchamps": "spa",
  suzuka: "suzuka",
  "yas marina circuit": "yas-marina",
  "yas island": "yas-marina",
  zandvoort: "zandvoort",
};

/** Stored circuit id from a circuit short name (F1's) and a location hint, or null */
export function circuitIdFromName(shortName: string | undefined, location?: string): string | null {
  const short = shortName?.toLowerCase().trim();
  const ids = Object.keys(circuitFiles).map((p) => p.split("/").pop()!.replace(".json", ""));
  const named = (hay: string) => ids.find((id) => hay.includes(id.replace(/-/g, " "))) ?? null;
  if (short) return BY_SHORT_NAME[short] ?? named(short);
  return location ? named(location.toLowerCase()) : null;
}

export function circuitIdFor(info: SessionInfo | undefined): string | null {
  const short = info?.Meeting?.Circuit?.ShortName?.toLowerCase().trim();
  const ids = Object.keys(circuitFiles).map((p) => p.split("/").pop()!.replace(".json", ""));
  const named = (hay: string) => ids.find((id) => hay.includes(id.replace(/-/g, " "))) ?? null;
  if (short) {
    // Trust F1's circuit name. An event can move: the 2026 "Bahrain Grand Prix" ran at
    // Kuala Lumpur, so matching on the meeting name would draw Sakhir under Sepang.
    // An unknown circuit gets no stored shape; the map builds one from positions.
    return BY_SHORT_NAME[short] ?? named(short);
  }
  return named([info?.Meeting?.Location, info?.Meeting?.Name].filter(Boolean).join(" ").toLowerCase());
}

export async function loadCircuit(id: string): Promise<{ circuit: CircuitData; geometry: CircuitGeometry | null } | null> {
  const c = circuitFiles[`../circuits/${id}.json`];
  if (!c) return null;
  const g = geometryFiles[`../circuits/geometry/${id}.json`];
  const [circuit, geometry] = await Promise.all([c(), g ? g() : Promise.resolve(null)]);
  return { circuit: circuit.default, geometry: geometry?.default ?? null };
}
