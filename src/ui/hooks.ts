import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// One shared interval per rate, however many components tick on it.
const tickers = new Map<number, { count: number; listeners: Set<() => void>; id?: ReturnType<typeof setInterval> }>();

function ticker(hz: number) {
  let t = tickers.get(hz);
  if (!t) tickers.set(hz, (t = { count: 0, listeners: new Set() }));
  return t;
}

/** Re-render at `hz` — for widgets that read the sample buffers (telemetry, live speed). */
export function useTicker(hz: number): number {
  return useSyncExternalStore(
    (onChange) => {
      const t = ticker(hz);
      t.listeners.add(onChange);
      t.id ??= setInterval(() => {
        t.count++;
        t.listeners.forEach((l) => l());
      }, 1000 / hz);
      return () => {
        t.listeners.delete(onChange);
        if (!t.listeners.size) {
          clearInterval(t.id);
          t.id = undefined;
        }
      };
    },
    () => ticker(hz).count
  );
}

/** Element size via ResizeObserver */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
