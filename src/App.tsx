import { useCallback, useEffect, useRef, useState } from "react";
import { ARCHIVE_BASE, loadArchive } from "./data/archive";
import { sessionKind } from "./data/derive";
import { startF1Live } from "./data/f1live";
import { loadLiveSettings, useLiveSettings } from "./data/liveSettings";
import { loadRecording, startReplay, type Recording, type ReplayControls } from "./data/replay";
import { usePitwall, type Via } from "./data/store";
import { Board } from "./layout/Board";
import { useLayout } from "./layout/layoutStore";
import type { View } from "./layout/defaults";
import { useF1Account, watchF1Account } from "./sessions/f1account";
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

  // Whether the running live feed was started signed in, to restart it when that changes
  const liveRef = useRef<{ signedIn: boolean } | null>(null);

  const goLive = useCallback(() => {
    loadIdRef.current++;
    stopRef.current?.();
    setControls(null);
    liveRef.current = { signedIn: useF1Account.getState().state === "signed-in" };
    stopRef.current = startF1Live(() => useLiveSettings.getState().delaySec * 1000);
  }, []);

  // Signing in or out switches between F1's full feed and its free one
  const signedIn = useF1Account((s) => s.state === "signed-in");
  useEffect(() => {
    if (liveRef.current && liveRef.current.signedIn !== signedIn) goLive();
  }, [signedIn, goLive]);

  const openReplay = useCallback(
    async (name: string, via: Via, load: (onProgress: (fraction: number) => void) => Promise<Recording>) => {
      const loadId = ++loadIdRef.current;
      stopRef.current?.();
      stopRef.current = null;
      liveRef.current = null;
      setControls(null);
      usePitwall.setState({
        source: "replay",
        via,
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
      openReplay(typeof src === "string" ? src.split("/").pop() ?? src : src.name, "file", (p) => loadRecording(src, p)),
    [openReplay]
  );

  /** A past session from F1's timing archive, by its folder path */
  const openArchive = useCallback(
    (path: string, name: string, base = ARCHIVE_BASE) => openReplay(name, "archive", (p) => loadArchive(path, p, base)),
    [openReplay]
  );

  useEffect(() => {
    let alive = true;
    // Live mode needs the saved delay and the F1 TV sign-in before it starts
    const ready = Promise.all([loadLiveSettings(), watchF1Account()]);
    const params = new URLSearchParams(location.search);
    const replay = params.get("replay");
    const archive = params.get("archive");
    if (replay) openRecording(replay);
    // Dev: ?archive=<session path>&archiveBase=/recordings/archive/ plays a saved copy
    else if (archive) openArchive(archive, archive, (import.meta.env.DEV && params.get("archiveBase")) || ARCHIVE_BASE);
    else ready.then(() => alive && goLive());
    return () => {
      alive = false;
      liveRef.current = null;
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
      <TopBar onGoLive={goLive} onOpenArchive={openArchive} />
      {layoutReady && <Board />}
      {controls && <ReplayBar controls={controls} />}
    </div>
  );
}
