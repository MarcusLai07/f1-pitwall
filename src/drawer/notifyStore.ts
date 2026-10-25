import { useEffect, useRef } from "react";
import { create } from "zustand";
import { isNotable, messageTab } from "../data/stewards";
import { trackNow, usePitwall } from "../data/store";
import type { RaceControlMessage } from "../data/types";
import { parseUtc } from "../lib/format";

export type DrawerTab = "racecontrol" | "investigations" | "limits" | "laps" | "trace" | "racebrief";

export interface Toast {
  id: string;
  message: RaceControlMessage;
  tab: DrawerTab;
}

interface NotifyStore {
  open: DrawerTab | null;
  toasts: Toast[];
  unread: Record<DrawerTab, number>;
  openTab: (tab: DrawerTab | null) => void;
  dismiss: (id: string) => void;
}

const NO_UNREAD: Record<DrawerTab, number> = { racecontrol: 0, investigations: 0, limits: 0, laps: 0, trace: 0, racebrief: 0 };

export const useNotify = create<NotifyStore>((set) => ({
  open: null,
  toasts: [],
  unread: NO_UNREAD,
  openTab: (tab) =>
    set((s) => ({
      open: tab,
      unread: tab ? { ...s.unread, [tab]: 0 } : s.unread,
      toasts: tab ? s.toasts.filter((t) => t.tab !== tab) : s.toasts,
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const MAX_TOASTS = 3;
const TOAST_MS = 9000;
// Only messages this recent (track time) pop up; older ones are history, e.g. on connect
const FRESH_MS = 120_000;

const keyOf = (m: RaceControlMessage) => `${m.Utc}|${m.Message}`;

/** Watches race control and raises toasts + unread counts for new messages */
export function useRaceControlNotifications() {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const handle = (rc: ReturnType<typeof usePitwall.getState>["live"]["RaceControlMessages"]) => {
      const raw = rc?.Messages;
      const list: RaceControlMessage[] = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
      const keys = new Set(list.map(keyOf));
      const prev = seen.current;
      seen.current = keys;
      // First load, a new session, or a replay seek: take the list as already read
      if (!prev || list.length < prev.size) return;
      const fresh = list.filter((m) => !prev.has(keyOf(m)));
      if (!fresh.length || fresh.length > 15) return;

      const now = trackNow();
      const { open } = useNotify.getState();
      const toasts: Toast[] = [];
      const unread = { ...useNotify.getState().unread };
      for (const m of fresh) {
        const tab = messageTab(m);
        if (open !== tab) unread[tab]++;
        if (isNotable(m) && now - parseUtc(m.Utc) < FRESH_MS && open !== tab) {
          toasts.push({ id: `${keyOf(m)}#${Math.random().toString(36).slice(2, 7)}`, message: m, tab });
        }
      }
      useNotify.setState((s) => ({ unread, toasts: [...toasts.reverse(), ...s.toasts].slice(0, MAX_TOASTS) }));
      for (const t of toasts) setTimeout(() => useNotify.getState().dismiss(t.id), TOAST_MS);
    };
    handle(usePitwall.getState().live.RaceControlMessages);
    return usePitwall.subscribe((s, p) => {
      if (s.resync !== p.resync) {
        // A replay seek or a source switch: what's listed now is history, not news
        seen.current = null;
      }
      if (s.live.RaceControlMessages !== p.live.RaceControlMessages || s.resync !== p.resync) handle(s.live.RaceControlMessages);
    });
  }, []);
}
