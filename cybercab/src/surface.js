/**
 * Body surface generation, parameterised by a vehicle's curve table.
 *
 * This is the placeholder path. It exists so the configurator runs and so the
 * option logic can be built and tested without assets; a real glTF replaces it
 * wholesale via loader.js. Everything it returns is addressed by *role* --
 * paint, glass, cladding, wheel mounts, outline queries -- so the rest of the
 * app cannot tell which path produced the car.
 *
 * The body is a loft: cross-sections swept along the length, each a
 * superellipse whose height, width and boxiness come from four curves. See
 * README.md for why it is built this way and what it costs.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Monotone cubic interpolation (Fritsch-Carlson).
 * Plain Catmull-Rom overshoots, and an overshooting roofline puts a dent
 * in the hood. This never wiggles between control points.
 * ------------------------------------------------------------------ */
export function curve(points) {
  // Sorted, because the lookup below binary-searches. Handing this function a
  // descending list silently returns the first control point for every input,
  // which looks exactly like "that feature didn't get built".
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const xs = sorted.map((p) => p[0]);
  const ys = sorted.map((p) => p[1]);
  const n = xs.length;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    slope.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = dx[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      ys[lo] * (2 * t3 - 3 * t2 + 1) +
      m[lo] * h * (t3 - 2 * t2 + t) +
      ys[lo + 1] * (-2 * t3 + 3 * t2) +
      m[lo + 1] * h * (t3 - t2)
    );
  };
}

/**
 * Ring budget, in zones from the left sill up over the roof and back down:
 * cladding, paint, glass canopy, paint, cladding.
 *
 * Fixing the zone sizes is what makes the material boundaries clean. Spacing
 * the ring evenly and asking each quad "is your midpoint above the canopy
 * line?" rounds every boundary to the nearest edge loop, and the windscreen
 * ends up with a staircase down each side. Here the zone edges are placed on
 * the analytic curve and the ring is spaced around them.
 */
const ZONES = [10, 20, 26, 20, 10];
export const RING = ZONES.reduce((a, b) => a + b, 0) + 1;
const ZONE_START = ZONES.reduce((acc, n) => [...acc, acc[acc.length - 1] + n], [0]);
const CLASS_OF_ZONE = ['cladding', 'paint', 'glass', 'paint', 'cladding'];
const STATIONS = 184;

/**
 * Everything about a car's shape, as callable functions. Built once per
 * (vehicle, wheel size) pair.
 */
export function makeShape(vehicle, wheelRadius) {
  const dims = vehicle.dims;
  const s = vehicle.surface;
  const roofline = curve(s.roofline);
  const halfWidth = curve(s.halfWidth);
  const boxiness = curve(s.boxiness);
  const glassDepth = curve(s.glassDepth);
  const claddingLine = curve(s.claddingLine);

  /**
   * End closure: how much the section shrinks approaching the tip. This is the
   * bumper fillet. Ending the loft at full size and capping the hole leaves a
   * flat plate that reads as a plate whatever you do to its normals; rolling
   * the section down to nothing lets the surface close itself. A short zone
   * keeps the nose blunt, a long one would make it a torpedo.
   */
  const endClosure = (x) => {
    let c = 1;
    const t = (x - (dims.front - s.noseZone)) / s.noseZone;
    if (t > 0) c = Math.min(c, Math.sqrt(Math.max(0, 1 - t * t)));
    const r = (dims.rear + s.tailZone - x) / s.tailZone;
    if (r > 0) c = Math.min(c, Math.sqrt(Math.max(0, 1 - r * r)));
    return Math.max(0.04, c);
  };

  const sillLine = (x) => {
    const span = (dims.front - dims.rear) * 0.055;
    const overhang = Math.max(0, Math.abs(x) - (dims.front - span)) / span;
    return dims.sill + overhang * overhang * 0.06;
  };

  const archLine = (x) => {
    let y = sillLine(x);
    for (const ax of [dims.axleFront, dims.axleRear]) {
      const d = Math.abs(x - ax);
      if (d < dims.archRadius) {
        y = Math.max(y, wheelRadius + Math.sqrt(dims.archRadius ** 2 - d * d) - 0.06);
      }
    }
    return y;
  };

  /**
   * Anchored to the sill, not to the wheel arch. Anchoring to the arch makes
   * the section squash and stretch as the arch rises, which walks the widest
   * point of the flank up and down the car and gives it a dented look. The
   * arch is a trim applied afterwards; the flank never learns the wheels exist.
   */
  const sectionShape = (x) => {
    const closure = endClosure(x);
    const bot0 = sillLine(x);
    const top0 = roofline(x);
    const mid = (bot0 + top0) / 2;
    const h = Math.max(0.01, (top0 - bot0) * closure);
    return { bot: mid - h / 2, top: mid + h / 2, hw: halfWidth(x) * closure, n: boxiness(x), h };
  };

  /** Half-width of the body at a given station and height. */
  const edgeZ = (x, y) => {
    const { bot, top, hw, n, h } = sectionShape(x);
    if (y <= bot || y >= top) return null;
    const yn = (y - bot) / h;
    const at = Math.pow(Math.max(0, 1 - Math.pow(yn, n)), 1 / n);
    const tuck = 1 - 0.11 * Math.pow(1 - yn, 2.5);
    return hw * at * tuck;
  };

  /**
   * A single cross-section, from the left sill up over the roof and down to the
   * right sill. Within each zone, vertices are spaced by arc length rather than
   * by the shape parameter -- a boxy superellipse has near-vertical sides, so
   * parameter spacing dumps almost every vertex into the roof and leaves three
   * or four down each flank, which shows as banded shading along the doors.
   */
  const section = (x) => {
    const { bot, top, hw, n, h } = sectionShape(x);
    const DENSE = 400;
    const MID = DENSE / 2;
    const raw = [];
    const cum = [0];
    for (let k = 0; k <= DENSE; k++) {
      const theta = (Math.PI * k) / DENSE;
      const c = Math.cos(theta);
      const e = 2 / n;
      const t = -Math.sign(c) * Math.pow(Math.abs(c), e);
      const yn = Math.pow(Math.abs(Math.sin(theta)), e);
      const tuck = 1 - 0.11 * Math.pow(1 - yn, 2.5);
      const p = [hw * t * tuck, bot + h * yn];
      raw.push(p);
      if (k > 0) cum.push(cum[k - 1] + Math.hypot(p[0] - raw[k - 1][0], p[1] - raw[k - 1][1]));
    }

    const arcAtY = (y, rightSide) => {
      const clamped = Math.min(Math.max(y, bot), top);
      if (!rightSide) {
        let k = 0;
        while (k < MID && raw[k + 1][1] < clamped) k++;
        const span = raw[k + 1][1] - raw[k][1] || 1;
        return cum[k] + (cum[k + 1] - cum[k]) * ((clamped - raw[k][1]) / span);
      }
      let k = DENSE;
      while (k > MID && raw[k - 1][1] < clamped) k--;
      const span = raw[k - 1][1] - raw[k][1] || 1;
      return cum[k] + (cum[k - 1] - cum[k]) * ((clamped - raw[k][1]) / span);
    };

    const cut = archLine(x);
    const cladY = Math.max(claddingLine(x), cut);
    const depth = glassDepth(x);
    const glassY = depth > 0 ? top - depth : Infinity;

    // Forced monotonic, so a collapsed zone (no canopy this far forward, no
    // cladding inside an arch) becomes zero-width instead of inverting.
    // Zero-width zones emit degenerate triangles, which draw nothing.
    const marks = [
      arcAtY(cut, false), arcAtY(cladY, false), arcAtY(glassY, false),
      arcAtY(glassY, true), arcAtY(cladY, true), arcAtY(cut, true),
    ];
    for (let i = 1; i < 6; i++) marks[i] = Math.max(marks[i], marks[i - 1]);

    const pts = [];
    let cursor = 0;
    const sampleAt = (target) => {
      while (cursor < DENSE - 1 && cum[cursor + 1] < target) cursor++;
      const span = cum[cursor + 1] - cum[cursor] || 1;
      const f = (target - cum[cursor]) / span;
      const a = raw[cursor];
      const b = raw[cursor + 1];
      return new THREE.Vector3(x, a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f);
    };

    for (let zone = 0; zone < ZONES.length; zone++) {
      const from = marks[zone];
      const to = marks[zone + 1];
      for (let i = 0; i < ZONES[zone]; i++) pts.push(sampleAt(from + ((to - from) * i) / ZONES[zone]));
    }
    pts.push(sampleAt(marks[5]));
    return pts;
  };

  const stations = [];
  for (let i = 0; i < STATIONS; i++) {
    const u = i / (STATIONS - 1);
    // Bias stations toward the ends, where the surface bends hardest.
    const bias = u - (0.12 * Math.sin(2 * Math.PI * u)) / Math.PI;
    stations.push(dims.rear + (dims.front - dims.rear) * bias);
  }

  /**
   * Traces the body's plan-view outline at a fixed height, walking inward from
   * one end. This is what light bars and aero parts are built on -- they follow
   * the actual bodywork instead of being modelled to fit one car.
   */
  const outline = (y, side, zLimit) => {
    const rows = [];
    for (let k = 0; k < STATIONS; k++) {
      const i = side > 0 ? STATIONS - 1 - k : k;
      const x = stations[i];
      const z = edgeZ(x, y);
      if (z == null) {
        if (rows.length) break;
        continue;
      }
      rows.push({ x, z });
      if (z > zLimit) break;
    }
    return rows;
  };

  return {
    dims, wheelRadius, stations,
    roofline, halfWidth, boxiness, glassDepth, claddingLine,
    sillLine, archLine, sectionShape, section, edgeZ, outline,
    lightBar: s.lightBar,
    length: dims.front - dims.rear,
  };
}

/** Builds the meshes for a shape: paint, glass, cladding, liner, floor, caps. */
export function buildSurface(shape) {
  const { dims } = shape;
  const grid = shape.stations.map((x) => shape.section(x));
  const xs = shape.stations;

  const count = STATIONS * RING;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const idx = (i, j) => i * RING + j;

  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < RING; j++) {
      const p = grid[i][j];
      const k = idx(i, j);
      positions[k * 3] = p.x;
      positions[k * 3 + 1] = p.y;
      positions[k * 3 + 2] = p.z;
      uvs[k * 2] = i / (STATIONS - 1);
      uvs[k * 2 + 1] = j / (RING - 1);
    }
  }

  // Analytic normals from grid tangents. Computing them per-mesh instead would
  // put a hard shading seam everywhere paint meets glass.
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < RING; j++) {
      du.subVectors(grid[Math.min(STATIONS - 1, i + 1)][j], grid[Math.max(0, i - 1)][j]);
      dv.subVectors(grid[i][Math.min(RING - 1, j + 1)], grid[i][Math.max(0, j - 1)]);
      nrm.crossVectors(dv, du).normalize();
      const k = idx(i, j);
      normals[k * 3] = nrm.x;
      normals[k * 3 + 1] = nrm.y;
      normals[k * 3 + 2] = nrm.z;
    }
  }

  const position = new THREE.BufferAttribute(positions, 3);
  const normal = new THREE.BufferAttribute(normals, 3);
  const uv = new THREE.BufferAttribute(uvs, 2);

  // Material per quad is a pure function of the ring index, because section()
  // placed the zone edges exactly on the boundary curves.
  const classes = { paint: [], glass: [], cladding: [] };
  const linerIndex = [];
  const classForRing = new Array(RING - 1);
  for (let zone = 0; zone < ZONES.length; zone++) {
    for (let j = ZONE_START[zone]; j < ZONE_START[zone + 1]; j++) classForRing[j] = CLASS_OF_ZONE[zone];
  }

  const cabinFront = dims.front * 0.5;
  const cabinRear = dims.rear * 0.72;
  for (let i = 0; i < STATIONS - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < RING - 1; j++) {
      const a = idx(i, j);
      const b = idx(i, j + 1);
      const c = idx(i + 1, j + 1);
      const d = idx(i + 1, j);
      const cls = classForRing[j];
      classes[cls].push(a, b, c, a, c, d);

      // The liner only covers the cabin. Offsetting the thin nose and tail
      // sections inward by more than half their thickness turns them inside
      // out, and nobody is standing in the boot anyway.
      const y = (grid[i][j].y + grid[i + 1][j + 1].y) / 2;
      if (cls === 'paint' && x > cabinRear && x < cabinFront && y > dims.sill + 0.48) {
        linerIndex.push(a, b, c, a, c, d);
      }
    }
  }

  const make = (indices) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('uv', uv);
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  };

  // Cabin liner: the same shell pushed inward along its own normals. Scaling
  // the body instead leaves the two surfaces coincident wherever the section is
  // small -- the nose fills with z-fighting speckle.
  const linerPositions = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    for (let c = 0; c < 3; c++) {
      linerPositions[k * 3 + c] = positions[k * 3 + c] - normals[k * 3 + c] * 0.05;
    }
  }
  const liner = new THREE.BufferGeometry();
  liner.setAttribute('position', new THREE.BufferAttribute(linerPositions, 3));
  liner.setAttribute('normal', normal);
  liner.setIndex(linerIndex);
  liner.computeBoundingSphere();

  /**
   * Flat caps closing the nose and tail rings. The closure shrinks these to a
   * few centimetres across so they are specks; the rim keeps the body's own
   * normals so no shading seam announces them, and the centre bulges *outward*
   * -- an inward dish drives the fan through the last body quads and the seam
   * fills with z-fighting.
   */
  const capGeometry = (stationIndex, outward) => {
    const ring = grid[stationIndex];
    const centre = new THREE.Vector3();
    ring.forEach((p) => centre.add(p));
    centre.divideScalar(ring.length);
    centre.x += outward * 0.015;

    const pos = [];
    const nor = [];
    const tri = (ja, jb) => {
      const [j0, j1] = outward > 0 ? [ja, jb] : [jb, ja];
      const p0 = ring[j0];
      const p1 = ring[j1];
      const k0 = idx(stationIndex, j0) * 3;
      const k1 = idx(stationIndex, j1) * 3;
      pos.push(centre.x, centre.y, centre.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      nor.push(
        outward, 0, 0,
        normals[k0], normals[k0 + 1], normals[k0 + 2],
        normals[k1], normals[k1 + 1], normals[k1 + 2]
      );
    };
    for (let j = 0; j < ring.length - 1; j++) tri(j, j + 1);
    tri(ring.length - 1, 0);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    return g;
  };

  /**
   * Closes the open bottom of the shell, following the body's own plan-view
   * outline at sill height. A plain rectangle is easier and looks it: its
   * corners hang out past the bumpers as dark wedges from any low angle.
   */
  const floorGeometry = () => {
    const rows = xs.map((x) => {
      const y = Math.max(shape.sillLine(x), shape.sectionShape(x).bot + 0.005);
      return { x, y, z: shape.edgeZ(x, y) ?? 0 };
    });
    const pos = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      pos.push(a.x, a.y, -a.z, a.x, a.y, a.z, b.x, b.y, b.z);
      pos.push(a.x, a.y, -a.z, b.x, b.y, b.z, b.x, b.y, -b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };

  /**
   * Window surround. Built from the ring indices that section() already put
   * exactly on the canopy boundary, so the brightwork traces the glass edge
   * precisely -- which is the whole reason chrome delete looks convincing.
   */
  const trimGeometry = () => {
    const pos = [];
    const nor = [];
    const push = (i, j) => {
      const p = grid[i][j];
      const k = idx(i, j);
      const [nx, ny, nz] = [normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]];
      pos.push(p.x + nx * 0.006, p.y + ny * 0.006, p.z + nz * 0.006);
      nor.push(nx, ny, nz);
    };
    const edges = [ZONE_START[2], ZONE_START[3] - 1];
    for (let i = 0; i < STATIONS - 1; i++) {
      const x = (xs[i] + xs[i + 1]) / 2;
      if (shape.glassDepth(x) <= 0.02) continue;
      for (const edge of edges) {
        for (const j of [edge - 1, edge]) {
          push(i, j);
          push(i, j + 1);
          push(i + 1, j + 1);
          push(i, j);
          push(i + 1, j + 1);
          push(i + 1, j);
        }
      }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    return g;
  };

  return {
    paint: make(classes.paint),
    glass: make(classes.glass),
    cladding: make(classes.cladding),
    liner,
    trim: trimGeometry(),
    floor: floorGeometry(),
    noseCap: capGeometry(STATIONS - 1, 1),
    tailCap: capGeometry(0, -1),
  };
}

/**
 * A horizontal band wrapped around one end of the car: the light bars. Lofts a
 * ribbon between two traced outlines. Picking whole quads instead gives a
 * stair-stepped edge you can count the vertices on.
 */
export function bandGeometry(shape, y0, y1, side, zLimit, offset) {
  const rowsA = shape.outline(y0, side, zLimit);
  const rowsB = shape.outline(y1, side, zLimit);
  const n = Math.min(rowsA.length, rowsB.length);
  if (n < 2) return null;

  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ x: rowsA[i].x, zA: rowsA[i].z, zB: rowsB[i].z });

  const outlinePts = [];
  for (let k = rows.length - 1; k >= 0; k--) {
    outlinePts.push({ x: rows[k].x, zA: -rows[k].zA, zB: -rows[k].zB });
  }
  outlinePts.push(...rows);

  const nrmAt = (k) => {
    const a = outlinePts[Math.max(0, k - 1)];
    const b = outlinePts[Math.min(outlinePts.length - 1, k + 1)];
    let nx = b.zA - a.zA;
    let nz = -(b.x - a.x);
    if (nx * side < 0) {
      nx = -nx;
      nz = -nz;
    }
    const len = Math.hypot(nx, nz) || 1;
    return [(nx / len) * offset, (nz / len) * offset];
  };

  const pos = [];
  for (let k = 0; k < outlinePts.length - 1; k++) {
    const p = outlinePts[k];
    const q = outlinePts[k + 1];
    const [px, pz] = nrmAt(k);
    const [qx, qz] = nrmAt(k + 1);
    const a = [p.x + px, y0, p.zA + pz];
    const b = [p.x + px, y1, p.zB + pz];
    const c = [q.x + qx, y1, q.zB + qz];
    const d = [q.x + qx, y0, q.zA + qz];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
