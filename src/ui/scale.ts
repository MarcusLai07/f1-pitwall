// UI scale: the window view is laid out for a ~900 px tall window and zoomed to fit
// the real one, so a big monitor gets the same layout, just larger. Other aspect ratios
// then only change widths, which the 24-column grid absorbs. The Layout menu's UI size
// control multiplies it.

import { create } from "zustand";
import { loadValue, saveValue } from "../lib/storage";

export const DESIGN_HEIGHT = 900;
const MIN = 0.7;
const MAX = 2.6;
const FACTOR_KEY = "uiScale";

interface ScaleStore {
  factor: number; // user multiplier, 1 = auto
  setFactor: (factor: number) => void;
}

export const useUiScale = create<ScaleStore>((set) => ({
  factor: 1,
  setFactor: (factor) => {
    const f = Math.round(Math.min(1.6, Math.max(0.6, factor)) * 100) / 100;
    set({ factor: f });
    saveValue(FACTOR_KEY, f);
  },
}));

loadValue<number>(FACTOR_KEY).then((f) => f && useUiScale.setState({ factor: f }));

export function scaleFor(viewportHeight: number, factor: number, fitToHeight: boolean): number {
  const auto = fitToHeight ? viewportHeight / DESIGN_HEIGHT : 1;
  return Math.min(MAX, Math.max(MIN, auto * factor));
}

// For code outside React that converts between screen and layout pixels
let current = 1;
export const currentScale = () => current;
export const setCurrentScale = (s: number) => {
  current = s;
};
