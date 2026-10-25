import * as THREE from "three";
import { isLightColor } from "../lib/format";
import type { LabelProjector } from "./labels";
import type { SceneHandle } from "./scene";

/** Normalized-space render state for one car (already GPS-mapped or estimated). */
export interface CarRenderInput {
  num: string; // racing number, shown in the dot
  code: string; // TLA, shown beside it when named
  color: string; // team color, hex
  /** three group-space coords (x, z); y comes from the elevation sampler */
  x: number;
  z: number;
  position: number; // race order: the leader's dot is drawn on top
  inPit: boolean;
  selected: boolean;
  /** Within a second of the car ahead while Overtake Mode is enabled */
  overtake: boolean;
  /** Show the TLA beside the number */
  named: boolean;
}

interface CarEntry {
  dot: HTMLElement;
  number: HTMLElement;
  tag: HTMLElement;
  anchor: THREE.Vector3;
  elevHint: { index: number };
  key: string; // last applied look, to skip unchanged style writes
}

export interface CarLayer {
  /** Full desired state; diffs internally (adds/updates/removes cars). Cheap enough to call every frame. */
  sync: (cars: CarRenderInput[]) => void;
  dispose: () => void;
}

// Dots keep their size on screen, so zooming in shows where across the road each car is
const DOT_PX = 17;
const DOT_SELECTED_PX = 21;
const DOT_PIT_PX = 13;
const OVERTAKE_COLOR = "#22c55e";

/**
 * Cars as team-coloured dots carrying their racing number, placed exactly where the car
 * is (HTML over the canvas, positioned by the label projector).
 */
export function createCarLayer(handle: SceneHandle, projector: LabelProjector, container: HTMLElement): CarLayer {
  const cars = new Map<string, CarEntry>();

  const unsubFrame = handle.onFrame(() => {
    // Keep each dot on the track surface as the elevation changes under it
    for (const car of cars.values()) car.anchor.y = handle.elevationAt(car.anchor.x, car.anchor.z, car.elevHint) + 0.0015;
  });

  const addCar = (input: CarRenderInput): CarEntry => {
    const dot = document.createElement("div");
    dot.className = "absolute left-0 top-0 flex items-center justify-center rounded-full font-f1 font-black tabular-nums pointer-events-none";
    const number = document.createElement("span");
    const tag = document.createElement("span");
    tag.className = "absolute left-full top-1/2 ml-[3px] -translate-y-1/2 rounded bg-black/80 px-1 py-px text-[9px] font-bold tracking-wide whitespace-nowrap";
    dot.append(number, tag);
    container.appendChild(dot);
    const anchor = new THREE.Vector3(input.x, 0, input.z);
    projector.add(dot, anchor);
    return { dot, number, tag, anchor, elevHint: { index: -1 }, key: "" };
  };

  const style = (car: CarEntry, input: CarRenderInput) => {
    const key = [input.num, input.code, input.color, input.position, input.inPit, input.selected, input.overtake, input.named].join("|");
    if (key === car.key) return;
    car.key = key;
    const size = input.selected ? DOT_SELECTED_PX : input.inPit ? DOT_PIT_PX : DOT_PX;
    const s = car.dot.style;
    s.width = s.height = `${size}px`;
    s.background = input.color;
    s.color = isLightColor(input.color) ? "#000" : "#fff";
    s.fontSize = `${input.inPit ? 7.5 : input.selected ? 10.5 : 9}px`;
    s.opacity = input.inPit ? "0.45" : "1";
    s.zIndex = String((input.selected ? 300 : 200) - input.position);
    const rings = ["0 0 0 1.5px rgba(0,0,0,0.7)", "0 1px 4px rgba(0,0,0,0.6)"];
    if (input.selected) rings.unshift("0 0 0 2px #fff");
    if (input.overtake) rings.unshift(`0 0 0 ${input.selected ? 4 : 2.5}px ${OVERTAKE_COLOR}`, `0 0 9px 2px ${OVERTAKE_COLOR}99`);
    s.boxShadow = rings.join(", ");
    car.number.textContent = input.num;
    car.tag.textContent = input.code;
    car.tag.style.color = input.color;
    car.tag.style.display = input.named || input.selected ? "" : "none";
  };

  return {
    sync: (inputs) => {
      const seen = new Set<string>();
      for (const input of inputs) {
        seen.add(input.num);
        let car = cars.get(input.num);
        if (!car) cars.set(input.num, (car = addCar(input)));
        // Callers interpolate in time already, so positions are set directly each frame
        car.anchor.x = input.x;
        car.anchor.z = input.z;
        style(car, input);
      }
      for (const [num, car] of cars) {
        if (seen.has(num)) continue;
        projector.remove(car.dot);
        car.dot.remove();
        cars.delete(num);
      }
    },
    dispose: () => {
      unsubFrame();
      for (const car of cars.values()) {
        projector.remove(car.dot);
        car.dot.remove();
      }
      cars.clear();
    },
  };
}
