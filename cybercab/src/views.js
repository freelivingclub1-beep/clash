/**
 * Camera presets, computed from the car's own dimensions so a Model Y frames
 * the same way a Cybercab does without a second table of numbers.
 *
 * A view is five numbers for the spherical rig in scene.js. Option groups name
 * one of these in the catalogue, which is what makes opening "Wheels" fly to
 * the wheel and opening "Paint" pull back to see the whole car.
 */

export function makeViews(vehicle) {
  const d = vehicle.dims;
  const length = d.front - d.rear;
  const far = length * 2.35;

  return {
    hero: {
      id: 'hero',
      label: 'Front three-quarter',
      kind: 'exterior',
      pose: { targetX: 0, targetY: d.sill + 0.42, radius: far, azimuth: 1.02, elevation: 0.13, fov: 30 },
    },
    side: {
      id: 'side',
      label: 'Side profile',
      kind: 'exterior',
      pose: { targetX: 0, targetY: d.sill + 0.44, radius: far * 1.18, azimuth: 0, elevation: 0.05, fov: 26 },
    },
    rear: {
      id: 'rear',
      label: 'Rear three-quarter',
      kind: 'exterior',
      pose: { targetX: 0, targetY: d.sill + 0.46, radius: far, azimuth: -1.12, elevation: 0.17, fov: 30 },
    },
    front: {
      id: 'front',
      label: 'Front',
      kind: 'exterior',
      // Low and close: a splitter is invisible from the standard hero angle.
      pose: { targetX: d.front * 0.62, targetY: d.sill + 0.12, radius: length * 0.92, azimuth: 1.32, elevation: 0.04, fov: 32 },
    },
    wheel: {
      id: 'wheel',
      label: 'Wheel detail',
      kind: 'exterior',
      pose: { targetX: d.axleFront, targetY: d.sill + 0.14, radius: length * 0.8, azimuth: 0.42, elevation: 0.06, fov: 34 },
    },
    cabin: {
      id: 'cabin',
      label: 'Interior, looking forward',
      kind: 'interior',
      pose: { targetX: length * 0.17, targetY: d.sill + 0.5, radius: 1.35, azimuth: -1.5, elevation: 0.18, fov: 68 },
    },
    cabinRear: {
      id: 'cabinRear',
      label: 'Interior, looking back',
      kind: 'interior',
      pose: { targetX: -length * 0.11, targetY: d.sill + 0.45, radius: 1.3, azimuth: 1.5, elevation: 0.24, fov: 64 },
    },
  };
}

/** The order behind the dot strip under the render. */
export const DOT_ORDER = ['hero', 'side', 'rear', 'front', 'wheel', 'cabin', 'cabinRear'];
