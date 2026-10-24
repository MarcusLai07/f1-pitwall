// The delay that holds F1's live feed back to match whatever stream you're watching.

import { create } from "zustand";
import { loadValue, saveValue } from "../lib/storage";
import { useF1Account } from "../sessions/f1account";
import { usePitwall } from "./store";

// Never less than this: the map interpolates between position samples that arrive in
// bursts about a second apart
export const MIN_DELAY_S = 3;
export const MAX_DELAY_S = 120;

interface LiveSettings {
  delaySec: number;
  setDelay: (s: number) => void;
}

export const useLiveSettings = create<LiveSettings>((set) => ({
  delaySec: MIN_DELAY_S,
  setDelay: (s) => {
    const delaySec = Math.round(Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, s)));
    set({ delaySec });
    saveValue("live:delay", delaySec);
  },
}));

/** Loads the saved delay */
export async function loadLiveSettings(): Promise<void> {
  const delay = await loadValue<number>("live:delay");
  if (typeof delay === "number") useLiveSettings.setState({ delaySec: Math.max(MIN_DELAY_S, delay) });
}

/** Live from F1 without the F1 TV sign-in: no car positions, car data or team radio audio */
export function useFreeFeed(): boolean {
  const f1Live = usePitwall((s) => s.source === "live" && s.via === "f1");
  const signedIn = useF1Account((s) => s.state === "signed-in");
  return f1Live && !signedIn;
}
