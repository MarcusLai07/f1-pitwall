import * as THREE from "three";
import type { SceneHandle } from "./scene";

export interface LabelProjector {
  add: (el: HTMLElement, anchor: THREE.Vector3) => void;
  remove: (el: HTMLElement) => void;
  dispose: () => void;
}

interface Entry {
  anchor: THREE.Vector3;
  // Last written screen position (quantized) — skip DOM writes when unchanged
  lastX: number;
  lastY: number;
  lastVisible: boolean | null;
}

/**
 * Projects group-space anchor points into screen space every frame and
 * positions absolutely-placed HTML elements over the canvas. Shared by
 * corner chips and driver chips. Style writes are dirty-checked so a static
 * view (e.g. live top-down between location ticks) costs no DOM work.
 */
export function createLabelProjector(handle: SceneHandle): LabelProjector {
  const entries = new Map<HTMLElement, Entry>();
  const wv = new THREE.Vector3();

  const unsub = handle.onFrame(() => {
    if (!entries.size) return;
    handle.group.updateMatrixWorld();
    for (const [el, entry] of entries) {
      wv.copy(entry.anchor).applyMatrix4(handle.group.matrixWorld).project(handle.camera);
      // Quantize to half-pixels: below that, updates are invisible
      const sx = Math.round((wv.x * 0.5 + 0.5) * handle.width * 2) / 2;
      const sy = Math.round((-wv.y * 0.5 + 0.5) * handle.height * 2) / 2;
      const visible = wv.z < 1;
      if (sx !== entry.lastX || sy !== entry.lastY) {
        el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px)`;
        entry.lastX = sx;
        entry.lastY = sy;
      }
      if (visible !== entry.lastVisible) {
        el.style.visibility = visible ? "visible" : "hidden";
        entry.lastVisible = visible;
      }
    }
  });

  return {
    add: (el, anchor) =>
      entries.set(el, { anchor, lastX: NaN, lastY: NaN, lastVisible: null }),
    remove: (el) => entries.delete(el),
    dispose: () => {
      unsub();
      entries.clear();
    },
  };
}
