// Shared formatting and colour helpers (colours match f1-dashboard's lib/constants.ts).

export const TYRE_COLORS: Record<string, string> = {
  SOFT: "#ff0000",
  MEDIUM: "#ffd700",
  HARD: "#ffffff",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};

export const TYRE_SHORT: Record<string, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
};

export const TIMING_COLORS = {
  PURPLE: "#a855f7", // session best
  GREEN: "#22c55e", // personal best
  YELLOW: "#eab308", // slower than personal best
} as const;

/** Mini-sector segment status codes from the F1 feed */
export function segmentColor(status: number | undefined): string {
  switch (status) {
    case 2048:
      return TIMING_COLORS.YELLOW;
    case 2049:
      return TIMING_COLORS.GREEN;
    case 2051:
      return TIMING_COLORS.PURPLE;
    case 2064:
      return "#6b7280"; // pit lane
    default:
      return "#3f3f46";
  }
}

/** F1 timestamps carry 7 fractional digits and sometimes no zone; both are UTC. */
export function parseUtc(s: string | undefined): number {
  if (!s) return NaN;
  const trimmed = s.replace(/(\.\d{3})\d+/, "$1");
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(trimmed) ? trimmed : trimmed + "Z");
}

/** "-05:00:00" -> -18000000 */
export function parseGmtOffset(s: string | undefined): number {
  const m = s?.match(/^(-)?(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return 0;
  const ms = (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0)) * 1000;
  return m[1] ? -ms : ms;
}

/** Wall-clock time at the track, HH:MM:SS */
export function trackClock(epochMs: number, gmtOffsetMs: number): string {
  if (!Number.isFinite(epochMs)) return "--:--:--";
  return new Date(epochMs + gmtOffsetMs).toISOString().slice(11, 19);
}

/** "01:02:03" -> ms */
export function parseDuration(s: string | undefined): number {
  const m = s?.match(/^(\d+):(\d+):(\d+)/);
  return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 : NaN;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1:35.706" or "35.706" -> seconds */
export function lapSeconds(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

export function formatLap(seconds: number | null): string {
  if (seconds === null) return "";
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3).padStart(6, "0");
  return mins > 0 ? `${mins}:${secs}` : secs;
}

export function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length !== 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const TRACK_STATUS: Record<string, { label: string; color: string }> = {
  "1": { label: "Track Clear", color: "#22c55e" },
  "2": { label: "Yellow Flag", color: "#eab308" },
  "3": { label: "Flag", color: "#eab308" },
  "4": { label: "Safety Car", color: "#f59e0b" },
  "5": { label: "Red Flag", color: "#ef4444" },
  "6": { label: "VSC Deployed", color: "#f59e0b" },
  "7": { label: "VSC Ending", color: "#f59e0b" },
};
