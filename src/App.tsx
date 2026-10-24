import { useCallback, useEffect, useRef, useState } from "react";
import { ARCHIVE_BASE, loadArchive } from "./data/archive";
import { sessionKind } from "./data/derive";
import { startLive } from "./data/multiviewer";
import { loadRecording, startReplay, type Recording, type ReplayControls } from "./data/replay";
import { usePitwall } from "./data/store";
import { Board } from "./layout/Board";
import { useLayout } from "./layout/layoutStore";
import type { View } from "./layout/defaults";
import { watchF1Account } from "./sessions/f1account";
import { ReplayBar } from "./ui/ReplayBar";
import { scaleFor, setCurrentScale, useUiScale } from "./ui/scale";
import { TopBar } from "./ui/TopBar";

const baseView: View = document.documentElement.dataset.view === "panel" ? "panel" : "window";
// Below this width the window uses the one-column side-panel layout
const NARROW_PX = 760;

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function App() {
  const viewport = useViewport();
  const view: View = baseView === "panel" || viewport.w < NARROW_PX ? "panel" : "window";
  // The window view zooms with the window height; the side panel only takes the user factor
  const factor = useUiScale((s) => s.factor);
  const scale = scaleFor(viewport.h, factor, view === "window");
  setCurrentScale(scale);
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

  useEffect(watchF1Account, []);

  const openReplay = useCallback(
    async (name: string, load: (onProgress: (fraction: number) => void) => Promise<Recording>) => {
      const loadId = ++loadIdRef.current;
      stopRef.current?.();
      stopRef.current = null;
      setControls(null);
      usePitwall.setState({
        source: "replay",
        status: "loading",
        error: null,
        live: {},
        clock: null,
        replay: { name, start: 0, end: 0, at: 0, playing: false, speed: 1, loadProgress: 0 },
      });
      try {
        const rec = await load((p) => {
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

  const openRecording = useCallback(
    (src: File | string) =>
      openReplay(typeof src === "string" ? src.split("/").pop() ?? src : src.name, (p) => loadRecording(src, p)),
    [openReplay]
  );

  /** A past session from F1's timing archive, by its folder path */
  const openArchive = useCallback(
    (path: string, name: string, base = ARCHIVE_BASE) => openReplay(name, (p) => loadArchive(path, p, base)),
    [openReplay]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const replay = params.get("replay");
    const archive = params.get("archive");
    if (replay) openRecording(replay);
    // Dev: ?archive=<session path>&archiveBase=/recordings/archive/ plays a saved copy
    else if (archive) openArchive(archive, archive, (import.meta.env.DEV && params.get("archiveBase")) || ARCHIVE_BASE);
    else goLive();
    return () => {
      loadIdRef.current++;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [goLive, openRecording, openArchive]);

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
    <div
      id="pitwall-root"
      className="flex flex-col bg-background text-foreground"
      style={{ zoom: scale, width: viewport.w / scale, height: viewport.h / scale }}
    >
      <TopBar onGoLive={goLive} onOpenRecording={openRecording} onOpenArchive={openArchive} />
      {layoutReady && <Board />}
      {controls && <ReplayBar controls={controls} />}
    </div>
  );
}
