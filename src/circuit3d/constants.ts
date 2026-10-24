export const SECTOR_COLORS = ["#e10600", "#4d8bff", "#ffd24d"] as const; // S1, S2, S3
export const DRS_COLOR = "#22c55e";

export const ELEV_EXAGGERATION = 3;
export const BASE_LIFT = 0.03;
export const TUBE_RADIUS = 0.013;
export const TUBE_SEGMENTS = 560;
export const TUBE_RADIAL_SEGMENTS = 10;
export const WALL_SEGMENTS = 300;
export const FALLBACK_SAMPLES = 240;
export const FALLBACK_METERS_PER_UNIT = 1200;

export const ZOOM_MIN = 1.3;
export const ZOOM_MAX = 4.4;
export const PHI_MIN = 0.06;
export const PHI_MAX = 1.35;

/** Camera view presets: [phi, r] */
export const VIEW_PRESETS = {
  top: { phi: 1.32, r: 2.9 },
  "3d": { phi: 0.5, r: 2.65 },
} as const;
export type ViewPreset = keyof typeof VIEW_PRESETS;

export const IDLE_SPIN_DELAY_MS = 1600;
export const IDLE_SPIN_RATE = 0.00011; // rad per ms
