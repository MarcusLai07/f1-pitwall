// One tooltip for the whole app. Instead of the browser's plain `title`, any element
// marked `data-tip="…"` gets this dark, animated tooltip — it eases in below (or above,
// near the bottom edge) after a short hover or on keyboard focus. A single delegated
// listener drives it, so there's no per-element wiring. Mounted once inside the zoomed
// root, so, like the tyre popover, it positions in layout pixels (screen ÷ UI scale).

import { animate } from "animejs";
import { useEffect, useRef, useState } from "react";
import { currentScale } from "./scale";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const DELAY_MS = 340;
const GAP = 8;
const HALF_MAX = 142; // half the tooltip's max width, for edge clamping

interface Tip {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const place = (el: HTMLElement): Tip | null => {
      const text = el.getAttribute("data-tip");
      if (!text) return null;
      const z = currentScale();
      const r = el.getBoundingClientRect();
      const viewW = window.innerWidth / z;
      const viewH = window.innerHeight / z;
      const cx = Math.min(viewW - GAP - HALF_MAX, Math.max(GAP + HALF_MAX, (r.left + r.width / 2) / z));
      const below = r.bottom / z + GAP;
      const placement: Tip["placement"] = below + 48 > viewH ? "top" : "bottom";
      return { text, x: cx, y: placement === "bottom" ? below : r.top / z - GAP, placement };
    };

    const open = (el: HTMLElement | null, delay: number) => {
      if (!el || el === anchor.current || !el.getAttribute("data-tip")) return;
      anchor.current = el;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (anchor.current === el && el.isConnected) setTip(place(el));
      }, delay);
    };
    const close = () => {
      anchor.current = null;
      clearTimeout(timer.current);
      setTip(null);
    };

    const onOver = (e: Event) => open((e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null, DELAY_MS);
    const onOut = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tip]");
      if (!el || el !== anchor.current) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      close();
    };
    const onFocus = (e: Event) => open((e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null, 0);

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", close, true);
    document.addEventListener("mousedown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", close, true);
      document.removeEventListener("mousedown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!tip || !el || reducedMotion()) return;
    animate(el, { opacity: [0, 1], translateY: tip.placement === "bottom" ? [-5, 0] : [5, 0], scale: [0.95, 1], duration: 160, ease: "outExpo" });
  }, [tip]);

  if (!tip) return null;
  // Outer node carries the position and centring; the inner box is what animates
  return (
    <div
      className="pointer-events-none fixed z-[100]"
      style={{ left: tip.x, top: tip.y, transform: tip.placement === "top" ? "translate(-50%,-100%)" : "translateX(-50%)" }}
    >
      <div
        ref={boxRef}
        role="tooltip"
        className="max-w-[280px] whitespace-pre-line rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-center font-f1 text-[11px] font-medium leading-snug text-zinc-100 shadow-xl shadow-black/50 backdrop-blur"
      >
        {tip.text}
      </div>
    </div>
  );
}
