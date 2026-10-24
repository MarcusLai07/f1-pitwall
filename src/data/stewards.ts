// Investigation tracker and track-limits tally, parsed from race control messages.
// The feed tags these with SubCategory (IncidentNoted, IncidentUnderInvestigation,
// IncidentNoFurtherInvestigation, LapTimeDeleted, ...); the text carries the cars,
// the reason and, for incidents, the time they happened, e.g. "(16:40:50)".

import { parseUtc } from "../lib/format";
import type { RaceControlMessage } from "./types";

export type IncidentStatus = "noted" | "investigating" | "after-session" | "no-action" | "penalty" | "info";

export interface Incident {
  key: string;
  where: string; // "Turn 9", "Pit lane", ""
  cars: string[]; // racing numbers
  reason: string;
  status: IncidentStatus;
  outcome: string; // penalty text when there is one
  happenedAt: string; // "16:40:50" from the message, if given
  updatedAt: number; // epoch ms of the latest message
  lap?: number;
  history: { at: number; status: IncidentStatus; text: string }[];
}

const CAR_RE = /CARS? ((?:\d+ \(\w{3}\)(?:,| AND)? ?)+)/;
const carNumbers = (s: string) => [...s.matchAll(/(\d+) \(\w{3}\)/g)].map((m) => m[1]);

function statusOf(m: RaceControlMessage): IncidentStatus | null {
  const sub = m.SubCategory ?? "";
  const text = m.Message.toUpperCase();
  if (/PENALTY|REPRIMAND|DISQUALIFIED|WARNING FOR/.test(text) && text.includes("FOR CAR")) return "penalty";
  if (sub === "IncidentNoted" || / NOTED( -|$)/.test(text)) return "noted";
  if (sub === "IncidentUnderInvestigation" || text.includes("UNDER INVESTIGATION")) return "investigating";
  if (text.includes("WILL BE INVESTIGATED AFTER")) return "after-session";
  if (sub === "IncidentNoFurtherInvestigation" || /NO FURTHER (INVESTIGATION|ACTION)/.test(text)) return "no-action";
  if (sub.startsWith("Incident") || text.startsWith("FIA STEWARDS")) return "info";
  return null;
}

export function investigations(messages: RaceControlMessage[]): Incident[] {
  const byKey = new Map<string, Incident>();
  for (const m of messages) {
    const status = statusOf(m);
    if (!status) continue;
    const text = m.Message.replace(/^FIA STEWARDS:\s*/i, "");
    const at = parseUtc(m.Utc);
    const happenedAt = text.match(/\((\d\d:\d\d:\d\d)\)\s*$/)?.[1] ?? "";

    if (status === "penalty") {
      // "5 SECOND TIME PENALTY FOR CAR 5 (BOR) - CAUSING A COLLISION": attach to that car's open incident
      const car = text.match(/FOR CARS? (\d+)/)?.[1];
      const reason = text.split(" - ").slice(1).join(" - ").replace(/\s*\(\d\d:\d\d:\d\d\)$/, "");
      const open = [...byKey.values()].reverse().find((i) => car && i.cars.includes(car) && i.status !== "no-action" && i.status !== "penalty");
      const outcome = text.split(" - ")[0];
      if (open) {
        open.status = "penalty";
        open.outcome = outcome;
        open.updatedAt = at;
        open.history.push({ at, status, text: m.Message });
        continue;
      }
      byKey.set(`pen-${m.Utc}-${car}`, {
        key: `pen-${m.Utc}-${car}`,
        where: "",
        cars: car ? [car] : [],
        reason,
        status,
        outcome,
        happenedAt,
        updatedAt: at,
        lap: m.Lap,
        history: [{ at, status, text: m.Message }],
      });
      continue;
    }

    const carsText = text.match(CAR_RE)?.[1] ?? "";
    const cars = carNumbers(carsText);
    const where = text.match(/^(.*?)\s*INCIDENT INVOLVING/)?.[1] ?? "";
    const reason = (text.split(/ - /).slice(1).join(" - ") || "").replace(/\s*\(\d\d:\d\d:\d\d\)$/, "");
    const key = `${happenedAt}|${[...cars].sort().join(",")}|${where}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.status = status;
      existing.updatedAt = at;
      if (reason) existing.reason = reason;
      existing.history.push({ at, status, text: m.Message });
    } else {
      byKey.set(key, { key, where: titleCase(where), cars, reason, status, outcome: "", happenedAt, updatedAt: at, lap: m.Lap, history: [{ at, status, text: m.Message }] });
    }
  }
  return [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface TrackLimitStrike {
  at: number;
  lap?: number;
  turn: string;
  lapTime: string; // deleted time, if the message gives one
  reinstated: boolean;
}

export interface TrackLimitsTally {
  num: string;
  strikes: TrackLimitStrike[];
  count: number; // not counting reinstated laps
  blackWhiteFlag: boolean;
  penalty: string;
}

export function trackLimits(messages: RaceControlMessage[]): TrackLimitsTally[] {
  const by = new Map<string, TrackLimitsTally>();
  const get = (num: string) => {
    let t = by.get(num);
    if (!t) by.set(num, (t = { num, strikes: [], count: 0, blackWhiteFlag: false, penalty: "" }));
    return t;
  };
  for (const m of messages) {
    const text = m.Message.toUpperCase();
    const car = text.match(/CAR (\d+) \(/)?.[1];
    if (!car) continue;
    if (m.SubCategory === "LapTimeDeleted" || /DELETED - TRACK LIMITS/.test(text)) {
      get(car).strikes.push({
        at: parseUtc(m.Utc),
        lap: Number(text.match(/ LAP (\d+) \d\d:/)?.[1]) || m.Lap,
        turn: text.match(/TURN (\d+)/)?.[1] ?? "",
        lapTime: text.match(/TIME ([\d:.]+) DELETED/)?.[1] ?? "",
        reinstated: false,
      });
    } else if (text.includes("REINSTATED")) {
      // "CAR 43 (COL) LAP 13 WILL BE REINSTATED" / "... TIME 1:35.2 ... REINSTATED"
      const lap = Number(text.match(/LAP (\d+)/)?.[1]);
      const t = by.get(car);
      const strike = t?.strikes.find((s) => !s.reinstated && (!lap || s.lap === lap));
      if (strike) strike.reinstated = true;
    } else if (m.Flag === "BLACK AND WHITE" || text.includes("BLACK AND WHITE FLAG")) {
      get(car).blackWhiteFlag = true;
    } else if (/PENALTY/.test(text) && text.includes("TRACK LIMITS")) {
      get(car).penalty = text.split(" - ")[0].replace(/^FIA STEWARDS:\s*/, "");
    }
  }
  for (const t of by.values()) t.count = t.strikes.filter((s) => !s.reinstated).length;
  return [...by.values()].filter((t) => t.strikes.length || t.blackWhiteFlag).sort((a, b) => b.count - a.count || a.num.localeCompare(b.num));
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Which drawer tab a message belongs to, for notifications */
export function messageTab(m: RaceControlMessage): "racecontrol" | "investigations" | "limits" {
  if (m.SubCategory === "LapTimeDeleted" || m.Message.includes("TRACK LIMITS")) return "limits";
  if (statusOf(m)) return "investigations";
  return "racecontrol";
}

/** Blue flags and sector clears are constant chatter; everything else is worth a pop-up */
export function isNotable(m: RaceControlMessage): boolean {
  if (m.Category === "Flag") return m.Flag !== "BLUE" && m.Flag !== "CLEAR";
  return true;
}
