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
  /** Pull the camera back on narrow canvases so the whole track stays in frame */
  setAspect: (aspect: number) => void;
  dispose: () => void;
}

export interface OrbitOptions {
  autoSpin: boolean;
  initialPreset: ViewPreset;
}

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

  let dragging = false;
  let idleMs = 0;
  let fit = 1;
  const trackSamples = Array.from({ length: 120 }, (_, i) => handle.curve.getPointAt(i / 120));

  const unsubFrame = handle.onFrame((dt) => {
    if (!dragging && opts.autoSpin) {
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
    handle.camera.position.set(
      view.tx,
      Math.sin(phi) * r + TARGET_Y,
      view.tz + Math.cos(phi) * r
    );
    lookTarget.set(view.tx, TARGET_Y, view.tz);
    handle.camera.lookAt(lookTarget);
  });

  const el = handle.renderer.domElement;
  el.style.cursor = "grab";
  el.style.touchAction = "none";
  let px = 0;
  let py = 0;

  const down = (e: PointerEvent) => {
    dragging = true;
    idleMs = 0;
    px = e.clientX;
    py = e.clientY;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    el.style.cursor = "grabbing";
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yawAnim.yaw(view.yaw + (e.clientX - px) * 0.011);
    phiAnim.phi(utils.clamp(view.phi + (e.clientY - py) * 0.008, PHI_MIN, PHI_MAX));
    px = e.clientX;
    py = e.clientY;
  };
  const up = (e: PointerEvent) => {
    dragging = false;
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

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });

  return {
    setPreset: (name) => {
      const p = VIEW_PRESETS[name];
      idleMs = 0;
      // Timed transition (not the drag animatables) so presets feel deliberate
      animate(view, { phi: p.phi, r: p.r, duration: 600, ease: "inOut(2)" });
      if (name === "top") animate(view, { tx: 0, tz: 0, duration: 600, ease: "inOut(2)" });
    },
    zoomBy: (delta) => {
      idleMs = 0;
      zoomAnim.r(utils.clamp(view.r + delta, ZOOM_MIN, ZOOM_MAX));
    },
    setAspect: (aspect) => {
      if (!(aspect > 0)) return;
      // Distance that keeps the (yaw-rotated) track inside the frustum, relative
      // to the top preset; never zooms in past the preset
      const tanHalf = Math.tan((handle.camera.fov * Math.PI) / 360);
      const c = Math.cos(view.yaw);
      const s = Math.sin(view.yaw);
      let ex = 0;
      let ez = 0;
      for (const p of trackSamples) {
        ex = Math.max(ex, Math.abs(p.x * c + p.z * s));
        ez = Math.max(ez, Math.abs(-p.x * s + p.z * c));
      }
      const need = Math.max(ex / (tanHalf * aspect), ez / tanHalf) * 1.12;
      fit = Math.max(1, need / VIEW_PRESETS.top.r);
    },
    setFollowTarget: (fn) => {
      followFn = fn;
      if (!fn) {
        targetAnim.tx(0);
        targetAnim.tz(0);
      }
    },
    dispose: () => {
      unsubFrame();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    },
  };
}
