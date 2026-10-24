import { create } from "zustand";
import type { LayoutItem } from "react-grid-layout";
import type { SessionKind } from "../data/derive";
import { loadValue, removeValue, saveValue } from "../lib/storage";
import { WIDGETS, isWidgetId, type WidgetId } from "../widgets/registry";
import { GRID, defaultLayout, layoutKey, type View } from "./defaults";

interface LayoutStore {
  view: View;
  kind: SessionKind;
  items: LayoutItem[];
  locked: boolean;
  /** "pack": widgets float up to fill gaps. "free": they stay where dropped and never push others. */
  packing: "pack" | "free";
  ready: boolean;
  load: (view: View, kind: SessionKind) => Promise<void>;
  setItems: (items: readonly LayoutItem[]) => void;
  add: (id: WidgetId) => void;
  remove: (id: WidgetId) => void;
  reset: () => void;
  setLocked: (locked: boolean) => void;
  setPacking: (packing: "pack" | "free") => void;
}

const withLimits = (items: readonly LayoutItem[]): LayoutItem[] =>
  items
    .filter((it) => isWidgetId(it.i))
    .map((it) => ({ ...it, minW: WIDGETS[it.i as WidgetId].minW, minH: WIDGETS[it.i as WidgetId].minH }));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persist = (view: View, kind: SessionKind, items: LayoutItem[]) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveValue(layoutKey(view, kind), items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));
  }, 300);
};

export const useLayout = create<LayoutStore>((set, get) => ({
  view: "window",
  kind: "practice",
  items: [],
  locked: false,
  packing: "pack",
  ready: false,
  load: async (view, kind) => {
    const [saved, locked, packing] = await Promise.all([
      loadValue<LayoutItem[]>(layoutKey(view, kind)),
      loadValue<boolean>(`locked:${view}`),
      loadValue<"pack" | "free">(`packing:${view}`),
    ]);
    set({
      view,
      kind,
      items: withLimits(saved?.length ? saved : defaultLayout(view, kind)),
      locked: !!locked,
      packing: packing ?? "pack",
      ready: true,
    });
  },
  setItems: (items) => {
    const next = withLimits(items);
    set({ items: next });
    persist(get().view, get().kind, next);
  },
  add: (id) => {
    const { items, view, kind } = get();
    if (items.some((it) => it.i === id)) return;
    const def = WIDGETS[id];
    const cols = GRID[view].cols;
    const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const next = withLimits([...items, { i: id, x: 0, y: bottom, w: Math.min(cols, Math.max(def.minW, view === "panel" ? cols : 6)), h: def.minH + 3 }]);
    set({ items: next });
    persist(view, kind, next);
  },
  remove: (id) => {
    const { items, view, kind } = get();
    const next = items.filter((it) => it.i !== id);
    set({ items: next });
    persist(view, kind, next);
  },
  reset: () => {
    const { view, kind } = get();
    removeValue(layoutKey(view, kind));
    set({ items: withLimits(defaultLayout(view, kind)) });
  },
  setLocked: (locked) => {
    set({ locked });
    saveValue(`locked:${get().view}`, locked);
  },
  setPacking: (packing) => {
    set({ packing });
    saveValue(`packing:${get().view}`, packing);
  },
}));
