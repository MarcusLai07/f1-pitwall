import * as THREE from "three";
import { createAnimatable, utils, animate } from "animejs";
import type { SceneHandle } from "./scene";
import {
  IDLE_SPIN_DELAY_MS,
  IDLE_SPIN_RATE,
  PHI_MAX,
  PHI_MIN,
  VIEW_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewPreset,
} from "./constants";

export interface OrbitControls {
  setPreset: (preset: ViewPreset) => void;
  zoomBy: (delta: number) => void;
  /** Camera follows the returned group-space point while set (live mode) */
  setFollowTarget: (fn: (() => THREE.Vector3 | null) | null) => void;
  /** Frame the whole track for this canvas aspect, centred */
  setAspect: (aspect: number) => void;
  /** Back to the framed view (also on double-click) */
  reset: () => void;
  dispose: () => void;
}

export interface OrbitOptions {
  autoSpin: boolean;
  initialPreset: ViewPreset;
}

/**
 * Drag pans the map, right-drag (or Shift/Alt + drag) rotates and tilts it, the
 * wheel zooms and a double-click re-frames the track.
 */
export function createOrbitControls(handle: SceneHandle, opts: OrbitOptions): OrbitControls {
  const preset = VIEW_PRESETS[opts.initialPreset];
  const view = { yaw: -0.55, phi: preset.phi, r: preset.r, tx: 0, tz: 0 };
  const yawAnim = createAnimatable(view, { yaw: 180, ease: "out(2)" });
  const phiAnim = createAnimatable(view, { phi: 180, ease: "out(2)" });
  const zoomAnim = createAnimatable(view, { r: 380, ease: "out(2)" });
  const targetAnim = createAnimatable(view, { tx: 400, tz: 400, ease: "out(2)" });

  const TARGET_Y = 0.14;
  const lookTarget = new THREE.Vector3();
  const followWorld = new THREE.Vector3();
  let followFn: (() => THREE.Vector3 | null) | null = null;

  let mode: "pan" | "rotate" | null = null;
  let idleMs = 0;
  // Camera distance multiplier and target that frame the track (set by setAspect)
  let fit = 1;
  const home = { tx: 0, tz: 0 };
  let lastAspect = 0;
  const trackSamples = Array.from({ length: 160 }, (_, i) => handle.curve.getPointAt(i / 160));

  const unsubFrame = handle.onFrame((dt) => {
    if (!mode && opts.autoSpin) {
      idleMs += dt;
      if (idleMs > IDLE_SPIN_DELAY_MS) view.yaw += dt * IDLE_SPIN_RATE;
    }
    if (followFn) {
      const p = followFn();
      if (p) {
        followWorld.copy(p).applyMatrix4(handle.group.matrixWorld);
        targetAnim.tx(followWorld.x);
        targetAnim.tz(followWorld.z);
      }
    }
    handle.group.rotation.y = view.yaw;
    const phi = utils.clamp(view.phi, PHI_MIN, PHI_MAX);
    const r = utils.clamp(view.r, ZOOM_MIN, ZOOM_MAX) * fit;
    handle.camera.position.set(view.tx, Math.sin(phi) * r + TARGET_Y, view.tz + Math.cos(phi) * r);
    lookTarget.set(view.tx, TARGET_Y, view.tz);
    handle.camera.lookAt(lookTarget);
  });

  const el = handle.renderer.domElement;
  el.style.cursor = "grab";
  el.style.touchAction = "none";
  let px = 0;
  let py = 0;

  const down = (e: PointerEvent) => {
    mode = e.button === 2 || e.shiftKey || e.altKey ? "rotate" : "pan";
    idleMs = 0;
    px = e.clientX;
    py = e.clientY;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    el.style.cursor = mode === "pan" ? "grabbing" : "move";
  };
  const move = (e: PointerEvent) => {
    if (!mode) return;
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    if (mode === "rotate") {
      yawAnim.yaw(view.yaw + dx * 0.011);
      phiAnim.phi(utils.clamp(view.phi + dy * 0.008, PHI_MIN, PHI_MAX));
      return;
    }
    // Pan: move the look target so the ground under the cursor follows it
    const phi = utils.clamp(view.phi, PHI_MIN, PHI_MAX);
    const dist = utils.clamp(view.r, ZOOM_MIN, ZOOM_MAX) * fit;
    const perPx = (2 * dist * Math.tan((handle.camera.fov * Math.PI) / 360)) / Math.max(1, handle.height);
    view.tx -= dx * perPx;
    view.tz -= (dy * perPx) / Math.max(0.3, Math.sin(phi));
  };
  const up = (e: PointerEvent) => {
    mode = null;
    idleMs = 0;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    el.style.cursor = "grab";
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    idleMs = 0;
    zoomAnim.r(utils.clamp(view.r * (1 + e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX));
  };
  const noMenu = (e: Event) => e.preventDefault();

  const frame = (aspect: number) => {
    // Bounding box of the track as the current yaw turns it, in world x/z
    const c = Math.cos(view.yaw);
    const s = Math.sin(view.yaw);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of trackSamples) {
      const x = p.x * c + p.z * s;
      const z = -p.x * s + p.z * c;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    home.tx = (minX + maxX) / 2;
    home.tz = (minZ + maxZ) / 2;
    const tanHalf = Math.tan((handle.camera.fov * Math.PI) / 360);
    const ex = (maxX - minX) / 2;
    // The top view is tilted slightly, which foreshortens depth a little
    const ez = ((maxZ - minZ) / 2) * Math.sin(VIEW_PRESETS.top.phi);
    const need = Math.max(ex / (tanHalf * aspect), ez / tanHalf) * 1.1;
    fit = need / VIEW_PRESETS.top.r;
  };

  const reset = () => {
    idleMs = 0;
    if (lastAspect) frame(lastAspect);
    const p = VIEW_PRESETS.top;
    animate(view, { phi: p.phi, r: p.r, tx: home.tx, tz: home.tz, duration: 600, ease: "inOut(2)" });
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("contextmenu", noMenu);
  el.addEventListener("dblclick", reset);

  return {
    setPreset: (name) => {
      const p = VIEW_PRESETS[name];
      idleMs = 0;
      // Timed transition (not the drag animatables) so presets feel deliberate
      animate(view, { phi: p.phi, r: p.r, duration: 600, ease: "inOut(2)" });
      if (name === "top") animate(view, { tx: home.tx, tz: home.tz, duration: 600, ease: "inOut(2)" });
    },
    zoomBy: (delta) => {
      idleMs = 0;
      zoomAnim.r(utils.clamp(view.r + delta, ZOOM_MIN, ZOOM_MAX));
    },
    setAspect: (aspect) => {
      if (!(aspect > 0)) return;
      lastAspect = aspect;
      frame(aspect);
      // Re-centre on resize unless following a car
      if (!followFn) {
        view.tx = home.tx;
        view.tz = home.tz;
      }
    },
    reset,
    setFollowTarget: (fn) => {
      followFn = fn;
      if (!fn) {
        targetAnim.tx(home.tx);
        targetAnim.tz(home.tz);
      }
    },
    dispose: () => {
      unsubFrame();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("dblclick", reset);
    },
  };
}
