import * as THREE from "three";
import type { SceneHandle } from "./scene";
import type { LabelProjector } from "./labels";

/** Normalized-space render state for one car (already GPS-mapped or estimated). */
export interface CarRenderInput {
  code: string;
  color: string; // team color, hex
  /** three group-space coords (x, z); y comes from the elevation sampler */
  x: number;
  z: number;
  inPit: boolean;
  selected: boolean;
}

interface CarEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  chip: HTMLElement;
  anchor: THREE.Vector3;
  color: string;
  elevHint: { index: number };
  inPit: boolean | null;
  selected: boolean | null;
}

export interface CarLayer {
  /** Full desired state; diffs internally (adds/updates/removes cars). Cheap enough to call every frame. */
  sync: (cars: CarRenderInput[]) => void;
  dispose: () => void;
}

const CAR_RADIUS = 0.022;
const CHIP_LIFT = 0.075;

export function createCarLayer(
  handle: SceneHandle,
  projector: LabelProjector,
  chipContainer: HTMLElement
): CarLayer {
  const sphereGeo = new THREE.SphereGeometry(CAR_RADIUS, 16, 16);
  const cars = new Map<string, CarEntry>();

  const unsubFrame = handle.onFrame(() => {
    // Keep car height glued to the track as it lerps + keep chip anchored
    for (const car of cars.values()) {
      car.mesh.position.y =
        handle.elevationAt(car.mesh.position.x, car.mesh.position.z, car.elevHint) + 0.012;
      car.anchor.set(car.mesh.position.x, car.mesh.position.y + CHIP_LIFT, car.mesh.position.z);
    }
  });

  const addCar = (input: CarRenderInput): CarEntry => {
    const mat = new THREE.MeshBasicMaterial({ color: input.color });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.set(input.x, 0, input.z);
    handle.group.add(mesh);

    const chip = document.createElement("span");
    chip.className =
      "absolute left-0 top-0 rounded px-1 py-px text-[9px] font-bold tracking-wide pointer-events-none border bg-black/75";
    chip.textContent = input.code;
    chip.style.color = input.color;
    chip.style.borderColor = input.color + "66";
    chipContainer.appendChild(chip);

    const anchor = new THREE.Vector3(input.x, CHIP_LIFT, input.z);
    projector.add(chip, anchor);

    return { mesh, mat, chip, anchor, color: input.color, elevHint: { index: -1 }, inPit: null, selected: null };
  };

  return {
    sync: (inputs) => {
      const seen = new Set<string>();
      for (const input of inputs) {
        seen.add(input.code);
        let car = cars.get(input.code);
        if (!car) {
          car = addCar(input);
          cars.set(input.code, car);
        }
        // Callers interpolate in time already, so positions are set directly each frame
        car.mesh.position.x = input.x;
        car.mesh.position.z = input.z;
        if (car.color !== input.color) {
          car.color = input.color;
          car.mat.color.set(input.color);
          car.chip.style.color = input.color;
          car.chip.style.borderColor = input.color + "66";
        }
        if (car.inPit !== input.inPit) {
          car.inPit = input.inPit;
          car.mat.transparent = true;
          car.mat.opacity = input.inPit ? 0.35 : 1;
          car.chip.style.opacity = input.inPit ? "0.4" : "1";
        }
        if (car.selected !== input.selected) {
          car.selected = input.selected;
          car.mesh.scale.setScalar(input.selected ? 1.6 : 1);
          car.chip.style.fontWeight = input.selected ? "900" : "700";
          car.chip.style.zIndex = input.selected ? "10" : "1";
        }
      }
      for (const [code, car] of cars) {
        if (!seen.has(code)) {
          projector.remove(car.chip);
          car.chip.remove();
          handle.group.remove(car.mesh);
          car.mat.dispose();
          cars.delete(code);
        }
      }
    },
    dispose: () => {
      unsubFrame();
      for (const car of cars.values()) {
        projector.remove(car.chip);
        car.chip.remove();
        handle.group.remove(car.mesh);
        car.mat.dispose();
      }
      cars.clear();
      sphereGeo.dispose();
    },
  };
}
