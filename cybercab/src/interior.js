/**
 * Cabin.
 *
 * Placed against the loaded body rather than at fixed coordinates: the roof
 * peak sets where the seats go, the sill sets the floor height, and the length
 * decides whether there is a second row. Human-sized parts stay human-sized on
 * every car, which is what keeps the interior views believable.
 *
 * Seen only from the two interior camera presets, so it is built to exactly the
 * standard those views demand and no higher.
 */

import * as THREE from 'three';
import { MATERIALS, makeScreenTexture } from './materials.js';

/** Rounded box via a bevelled extrusion -- sharp box edges read as untextured cubes. */
function roundedBox(w, h, d, radius = 0.06, bevel = 0.03) {
  const shape = new THREE.Shape();
  const x = -w / 2 + radius;
  const y = -h / 2 + radius;
  const iw = w - radius * 2;
  const ih = h - radius * 2;
  shape.moveTo(x, y - radius);
  shape.lineTo(x + iw, y - radius);
  shape.quadraticCurveTo(x + iw + radius, y - radius, x + iw + radius, y);
  shape.lineTo(x + iw + radius, y + ih);
  shape.quadraticCurveTo(x + iw + radius, y + ih + radius, x + iw, y + ih + radius);
  shape.lineTo(x, y + ih + radius);
  shape.quadraticCurveTo(x - radius, y + ih + radius, x - radius, y + ih);
  shape.lineTo(x - radius, y);
  shape.quadraticCurveTo(x - radius, y - radius, x, y - radius);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, d - bevel * 2),
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(d - bevel * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * roundedBox takes (x, y, z) in that order. Getting a seat back's thickness and
 * width the wrong way round gives you a half-metre-thick plank 16cm wide, which
 * from the interior camera looks like a wall.
 */
function seat(trim, floorY) {
  const group = new THREE.Group();
  const upholstery = new THREE.MeshStandardMaterial({
    color: new THREE.Color(trim.seat),
    roughness: 0.82,
    metalness: 0.02,
  });

  const cushion = new THREE.Mesh(roundedBox(0.52, 0.13, 0.48, 0.07), upholstery);
  cushion.position.set(0, floorY + 0.1, 0);
  group.add(cushion);

  const back = new THREE.Mesh(roundedBox(0.14, 0.56, 0.47, 0.07), upholstery);
  back.position.set(-0.29, floorY + 0.38, 0);
  back.rotation.z = 0.16;
  group.add(back);

  const headrest = new THREE.Mesh(roundedBox(0.12, 0.18, 0.26, 0.055), upholstery);
  headrest.position.set(-0.37, floorY + 0.68, 0);
  group.add(headrest);

  const pedestal = new THREE.Mesh(
    roundedBox(0.26, 0.2, 0.22, 0.05),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(trim.trim), roughness: 0.6 })
  );
  pedestal.position.set(0, floorY - 0.07, 0);
  group.add(pedestal);

  return group;
}

export function buildInterior(trim, shape) {
  const root = new THREE.Group();
  root.name = 'interior';

  const { dims } = shape;
  const floorY = dims.sill + 0.1;

  // Anchor everything to where the roof actually peaks on this car.
  let peakX = 0;
  let peakY = 0;
  for (const x of shape.stations) {
    const y = shape.roofline(x);
    if (y > peakY) {
      peakY = y;
      peakX = x;
    }
  }
  const cabinHalf = shape.halfWidth(peakX);
  const rowOne = peakX - 0.1;
  const dashX = peakX + 0.85;

  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(trim.trim),
    roughness: 0.62,
    metalness: 0.05,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(shape.length * 0.66, cabinHalf * 1.6),
    new THREE.MeshStandardMaterial({ color: 0x202123, roughness: 0.97 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(peakX - 0.1, floorY, 0);
  root.add(floor);

  // Wraparound dash: a shallow arc echoing the canopy. The radius stays under
  // the body half-width or it pushes straight through the doors -- there is no
  // collision detection here, only arithmetic.
  const dash = new THREE.Mesh(
    new THREE.CylinderGeometry(cabinHalf * 0.66, cabinHalf * 0.66, 0.52, 32, 1, true, Math.PI * 0.66, Math.PI * 0.68),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(trim.trim), roughness: 0.6, side: THREE.DoubleSide })
  );
  dash.position.set(dashX - 0.36, floorY + 0.28, 0);
  root.add(dash);

  const screenTex = makeScreenTexture();
  const screen = new THREE.Mesh(
    roundedBox(0.44, 0.26, 0.03, 0.02, 0.012),
    new THREE.MeshStandardMaterial({
      map: screenTex,
      emissive: 0xffffff,
      emissiveMap: screenTex,
      emissiveIntensity: 1.6,
      roughness: 0.18,
      metalness: 0.1,
    })
  );
  screen.position.set(dashX - 0.05, floorY + 0.42, 0);
  screen.rotation.y = -Math.PI / 2;
  screen.rotation.x = 0.06;
  root.add(screen);

  const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), MATERIALS.cladding());
  stalk.position.set(dashX - 0.04, floorY + 0.28, 0);
  root.add(stalk);

  for (const side of [-1, 1]) {
    const s = seat(trim, floorY);
    s.position.set(rowOne, 0, side * cabinHalf * 0.42);
    root.add(s);
  }

  // A second row, but only on cars long enough to have one.
  if (shape.length > 4.4) {
    for (const side of [-1, 1]) {
      const s = seat(trim, floorY);
      s.position.set(rowOne - 0.95, 0, side * cabinHalf * 0.44);
      root.add(s);
    }
  }

  const centre = new THREE.Mesh(roundedBox(0.74, 0.2, 0.3, 0.06), trimMat);
  centre.position.set(rowOne + 0.04, floorY + 0.09, 0);
  root.add(centre);

  for (const side of [-1, 1]) {
    const card = new THREE.Mesh(roundedBox(1.4, 0.42, 0.08, 0.06), trimMat);
    card.position.set(rowOne + 0.2, floorY + 0.28, side * cabinHalf * 0.8);
    root.add(card);
  }

  const shelf = new THREE.Mesh(roundedBox(0.44, 0.09, cabinHalf * 1.35, 0.05), trimMat);
  shelf.position.set(dims.rear * 0.5, floorY + 0.46, 0);
  shelf.rotation.z = 0.2;
  root.add(shelf);

  return root;
}
