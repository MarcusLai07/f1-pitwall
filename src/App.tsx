import { useCallback, useEffect, useRef, useState } from "react";
import { sessionKind } from "./data/derive";
import { startLive } from "./data/multiviewer";
import { loadRecording, startReplay, type ReplayControls } from "./data/replay";
import { usePitwall } from "./data/store";
import { Board } from "./layout/Board";
import { useLayout } from "./layout/layoutStore";
import type { View } from "./layout/defaults";
import { ReplayBar } from "./ui/ReplayBar";
import { TopBar } from "./ui/TopBar";

const baseView: View = document.documentElement.dataset.view === "panel" ? "panel" : "window";
// Below this width the window uses the one-column side-panel layout
const NARROW_PX = 760;

function useView(): View {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_PX);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return baseView === "panel" || narrow ? "panel" : "window";
}

export function App() {
  const view = useView();
  const kind = usePitwall((s) => sessionKind(s.live.SessionInfo));
  const layoutReady = useLayout((s) => s.ready);
  const loadLayout = useLayout((s) => s.load);
  const [controls, setControls] = useState<ReplayControls | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped whenever the source changes, so a recording that finishes loading late is dropped
  const loadIdRef = useRef(0);

  // Each view keeps one layout per session type (practice / qualifying / race)
  useEffect(() => {
    loadLayout(view, kind);
  }, [view, kind, loadLayout]);

  const goLive = useCallback(() => {
    loadIdRef.current++;
    stopRef.current?.();
    setControls(null);
    stopRef.current = startLive();
  }, []);

  const openRecording = useCallback(
    async (src: File | string) => {
      const loadId = ++loadIdRef.current;
      stopRef.current?.();
      stopRef.current = null;
      setControls(null);
      const name = typeof src === "string" ? src.split("/").pop() ?? src : src.name;
      usePitwall.setState({
        source: "replay",
        status: "loading",
        error: null,
        live: {},
        clock: null,
        replay: { name, start: 0, end: 0, at: 0, playing: false, speed: 1, loadProgress: 0 },
      });
      try {
        const rec = await loadRecording(src, (p) => {
          if (loadId === loadIdRef.current) usePitwall.setState((s) => ({ replay: s.replay && { ...s.replay, loadProgress: p } }));
        });
        if (loadId !== loadIdRef.current) return;
        const c = startReplay(rec);
        stopRef.current = c.stop;
        setControls(c);
      } catch (err) {
        if (loadId !== loadIdRef.current) return;
        usePitwall.setState({ status: "error", error: err instanceof Error ? err.message : String(err), replay: null });
      }
    },
    []
  );

  useEffect(() => {
    const replay = new URLSearchParams(location.search).get("replay");
    if (replay) openRecording(replay);
    else goLive();
    return () => {
      loadIdRef.current++;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [goLive, openRecording]);

  // Space toggles replay playback
  useEffect(() => {
    if (!controls) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement).closest("input, button")) return;
      e.preventDefault();
      usePitwall.getState().replay?.playing ? controls.pause() : controls.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar onGoLive={goLive} onOpenRecording={openRecording} />
      {layoutReady && <Board />}
      {controls && <ReplayBar controls={controls} />}
    </div>
  );
}
