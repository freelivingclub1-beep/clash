/**
 * Bolt-on aero: splitters, side skirts, ducktails, spoilers, wings, diffusers.
 *
 * These are generated against the body's own outline rather than modelled per
 * car. A ducktail is a cross-section swept along the trailing edge of whatever
 * the tail happens to be, so the same catalogue entry fits a Model 3, a Model Y
 * and a Cybercab -- and will fit a real glTF once one is loaded, because the
 * outline query works on any surface that can answer "how wide are you here".
 */

import * as THREE from 'three';

/**
 * Full left-to-right path around one end of the car at a fixed height, with an
 * outward normal at each point. Sweeping a profile along this is what makes a
 * lip follow the bodywork instead of being a straight bar bolted across it.
 */
function tracePath(shape, y, side, zLimit, maxRun) {
  let rows = shape.outline(y, side, zLimit);
  if (rows.length < 2) return null;

  // Stop the sweep a fixed distance in from the bumper. Without this the trace
  // runs until the body reaches `zLimit`, which on a car with a long, gently
  // tapering nose is most of the way to the doors -- and a "front splitter"
  // comes out as a shelf running half the length of the car.
  if (maxRun) {
    const start = rows[0].x;
    rows = rows.filter((r) => Math.abs(r.x - start) <= maxRun);
    if (rows.length < 2) return null;
  }

  const path = [];
  for (let k = rows.length - 1; k >= 0; k--) path.push({ x: rows[k].x, z: -rows[k].z });
  for (let k = 0; k < rows.length; k++) path.push({ x: rows[k].x, z: rows[k].z });

  return path.map((p, k) => {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    let nx = b.z - a.z;
    let nz = -(b.x - a.x);
    if (nx * side < 0) {
      nx = -nx;
      nz = -nz;
    }
    const len = Math.hypot(nx, nz) || 1;
    return { ...p, nx: nx / len, nz: nz / len };
  });
}

/**
 * Sweeps a closed 2D profile along a path. The profile lives in the plane of
 * (outward, up) at each point, so `[out, up]` pairs describe the lip's
 * cross-section the same way you'd draw it on paper.
 */
function sweep(path, profile, y) {
  const pos = [];
  const at = (k, i) => {
    const p = path[k];
    const [o, v] = profile[i];
    return [p.x + p.nx * o, y + v, p.z + p.nz * o];
  };
  for (let k = 0; k < path.length - 1; k++) {
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const a = at(k, i);
      const b = at(k, j);
      const c = at(k + 1, j);
      const d = at(k + 1, i);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const THICKNESS = 0.022;

function frontLip(shape, spec) {
  const y = shape.dims.sill + 0.045;
  const path = tracePath(shape, y, 1, shape.halfWidth(0) * 0.9, 0.55);
  if (!path) return null;
  const { reach, drop } = spec;
  // Blade sweeps forward and downward, tapering to a thin leading edge.
  return sweep(path, [
    [0, 0],
    [reach, -drop],
    [reach, -drop - THICKNESS * 0.6],
    [0, -THICKNESS],
  ], y);
}

function rearLip(shape, spec) {
  const { dims } = shape;
  // Sit on the trailing edge of the deck, just under the top of the tail.
  const y = shape.sectionShape(dims.rear + 0.14).top - 0.025;
  const path = tracePath(shape, y, -1, shape.halfWidth(0) * 0.9, 0.42);
  if (!path) return null;
  const { reach, rise } = spec;
  return sweep(path, [
    [0, 0],
    [reach, rise],
    [reach, rise - THICKNESS],
    [0, -THICKNESS],
  ], y);
}

function skirt(shape, spec) {
  const { dims } = shape;
  const y = dims.sill + 0.035;
  const from = dims.axleRear + dims.archRadius * 0.92;
  const to = dims.axleFront - dims.archRadius * 0.92;
  const steps = 40;

  const build = (sign) => {
    const path = [];
    for (let i = 0; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps;
      const z = shape.edgeZ(x, y);
      if (z == null) continue;
      path.push({ x, z: sign * z, nx: 0, nz: sign });
    }
    if (path.length < 2) return null;
    return sweep(path, [
      [0, 0],
      [0.035, -spec.drop],
      [0.035, -spec.drop - THICKNESS],
      [0, -THICKNESS * 1.6],
    ], y);
  };

  const geos = [build(1), build(-1)].filter(Boolean);
  if (!geos.length) return null;
  return geos;
}

function wing(shape, spec) {
  const { dims } = shape;
  const group = [];
  const deckY = shape.sectionShape(dims.rear + 0.3).top;
  const baseX = dims.rear + 0.28;
  const halfW = shape.halfWidth(0) * 0.86;

  // Two pedestals.
  for (const sign of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.06, spec.rise, 0.035);
    post.translate(baseX, deckY + spec.rise / 2, sign * halfW * 0.66);
    group.push(post);
  }

  // Plank: a thin aerofoil, angled slightly nose-down at the trailing edge.
  const plank = new THREE.BoxGeometry(spec.chord, 0.028, halfW * 2);
  plank.translate(0, 0, 0);
  const m = new THREE.Matrix4().makeRotationZ(0.14);
  plank.applyMatrix4(m);
  plank.translate(baseX - 0.02, deckY + spec.rise, 0);
  group.push(plank);

  return group;
}

function diffuser(shape) {
  const { dims } = shape;
  const y = dims.sill - 0.01;
  const halfW = shape.halfWidth(dims.rear * 0.85) * 0.8;
  const group = [];

  const plate = new THREE.BoxGeometry(0.5, 0.03, halfW * 2);
  plate.translate(dims.rear + 0.3, y, 0);
  group.push(plate);

  // Strakes. Five reads as a diffuser; three reads as an accident.
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.BoxGeometry(0.46, 0.075, 0.022);
    fin.translate(dims.rear + 0.3, y + 0.04, (i / 2.4) * halfW);
    group.push(fin);
  }
  return group;
}

const BUILDERS = { frontLip, rearLip, skirt, wing, diffuser };

/**
 * Turns the chosen catalogue parts into meshes. Returns a group; callers add it
 * to the car and dispose it when the selection changes.
 */
export function buildAeroParts(shape, parts, material) {
  const group = new THREE.Group();
  group.name = 'aero';

  for (const option of [parts.frontLip, parts.rearLip, parts.skirts, parts.diffuser]) {
    const spec = option?.part;
    if (!spec) continue;
    const builder = BUILDERS[spec.kind];
    if (!builder) continue;
    const result = builder(shape, spec);
    if (!result) continue;
    for (const geo of Array.isArray(result) ? result : [result]) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 1;
      group.add(mesh);
    }
  }
  return group;
}
