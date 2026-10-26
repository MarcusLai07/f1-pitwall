// A self-animating pop-up shell: it fades/scales/slides in when opened and plays the
// same motion in reverse before it unmounts, with a full-screen click-catcher behind it.
// Every top-bar menu and panel uses it, so the chrome and the open/close animation live
// in one place. The caller just flips `open`.

import { animate } from "animejs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/format";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Popover({
  open,
  onClose,
  children,
  className,
  origin = "top right",
  overlay = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Positioning, width and height — e.g. "right-0 top-9 w-[min(560px,92vw)]" */
  className?: string;
  /** transform-origin the pop grows from (matches where it's anchored) */
  origin?: string;
  overlay?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Mount on open; on close, play the exit first and unmount when it finishes
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else {
      setClosing(true);
    }
  }, [open]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || closing || !el || reducedMotion()) return;
    animate(el, { opacity: [0, 1], translateY: [-10, 0], scale: [0.96, 1], duration: 280, ease: "outExpo" });
  }, [mounted, closing]);

  useEffect(() => {
    if (!closing) return;
    const el = ref.current;
    if (!el || reducedMotion()) {
      setMounted(false);
      return;
    }
    animate(el, { opacity: 0, translateY: -8, scale: 0.97, duration: 150, ease: "inQuad", onComplete: () => setMounted(false) });
  }, [closing]);

  if (!mounted) return null;
  return (
    <>
      {overlay && <div className="fixed inset-0 z-40" onClick={onClose} />}
      <div
        ref={ref}
        style={{ transformOrigin: origin }}
        className={cn(
          "absolute z-50 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/97 font-f1 shadow-2xl shadow-black/60 backdrop-blur",
          className
        )}
      >
        {children}
      </div>
    </>
  );
}

/** The standard pop-up header: a title, optional detail, a slot on the right, and a close
 *  button — so Championship, Calendar and Sessions all read the same. */
export function PopoverHeader({
  title,
  detail,
  right,
  onClose,
}: {
  title: string;
  detail?: React.ReactNode;
  right?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
      <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-200">{title}</span>
      {detail && <span className="text-[11px] text-zinc-500">{detail}</span>}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      <button
        onClick={onClose}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
          !right && "ml-auto"
        )}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
