import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

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

/**
 * Size of an element, kept current. The ref follows the element it's attached to, so
 * a component that swaps its root (e.g. telemetry's one-car vs. several-car layouts)
 * keeps being measured; `ref.current` is that element.
 */
export function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useMemo(() => {
    const attach = ((node: T | null) => {
      attach.current = node;
      setEl(node);
    }) as ((node: T | null) => void) & { current: T | null };
    attach.current = null;
    return attach;
  }, []);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, size] as const;
}
