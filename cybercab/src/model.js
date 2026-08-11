/**
 * Vehicle assembly.
 *
 * Takes a vehicle spec plus the resolved catalogue selections and returns a
 * group, along with handles to the materials and sub-groups the app needs to
 * mutate. The split matters: changing paint or tint is a material write with no
 * allocation, changing wheels rebuilds the arches, changing aero rebuilds only
 * the aero group.
 */

import * as THREE from 'three';
import { makeShape, buildSurface, bandGeometry } from './surface.js';
import { buildAeroParts } from './parts.js';
import { buildInterior } from './interior.js';
import {
  MATERIALS,
  makePaintMaterial,
  makeGlassMaterial,
  makeWheelTexture,
  makeRotorTexture,
  makeContactTexture,
  applyFinish,
} from './materials.js';

/* ------------------------------------------------------------------ *
 * Wheels
 * ------------------------------------------------------------------ */

/** Annular sector, for the caliper. */
function caliperGeometry(rInner, rOuter, sweep, depth) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOuter, -sweep / 2, sweep / 2, false);
  shape.absarc(0, 0, rInner, sweep / 2, -sweep / 2, true);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.006,
    bevelSegments: 2,
    curveSegments: 16,
  });
  geo.computeVertexNormals();
  return geo;
}

function buildWheel({ wheel, faceTexture, rotorTexture, faceMaterial, caliperMaterial }) {
  const group = new THREE.Group();
  const r = wheel.radius;
  const w = wheel.width;

  const tread = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 64, 1, true), MATERIALS.tire());
  tread.rotation.x = Math.PI / 2;
  group.add(tread);

  // The rotor and caliper sit behind the face. They are only visible because
  // the face texture has real holes in it.
  const rotor = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.6, 48),
    new THREE.MeshStandardMaterial({ map: rotorTexture, metalness: 0.75, roughness: 0.45 })
  );
  rotor.position.z = w / 2 - 0.055;
  group.add(rotor);

  const caliper = new THREE.Mesh(caliperGeometry(r * 0.44, r * 0.62, 1.0, 0.042), caliperMaterial);
  // Parked at top dead centre so it stays put when the far-side wheel is
  // mirrored through 180 degrees.
  caliper.rotation.z = Math.PI / 2;
  caliper.position.z = w / 2 - 0.1;
  group.add(caliper);

  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 72), faceMaterial);
  face.position.z = w / 2;
  group.add(face);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(r, 32),
    new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.9 })
  );
  inner.position.z = -w / 2;
  inner.rotation.y = Math.PI;
  group.add(inner);

  group.userData.faceTexture = faceTexture;
  return group;
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

export function buildVehicle({ vehicle, parts }) {
  const root = new THREE.Group();
  root.name = vehicle.id;

  // Body and everything bolted to it live under one group, so lowering the
  // suspension is a single transform and the wheels stay on the ground.
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const shape = makeShape(vehicle, parts.wheels.radius);
  const surface = buildSurface(shape);
  const { dims } = shape;

  const paintMaterial = makePaintMaterial(parts.paint);
  const glassMaterial = makeGlassMaterial(parts.tint);
  const claddingMaterial = MATERIALS.cladding();
  const trimMaterial = MATERIALS.trim(parts.trimFinish);
  const aeroMaterial = MATERIALS.aero();

  body.add(new THREE.Mesh(surface.paint, paintMaterial));
  body.add(new THREE.Mesh(surface.cladding, claddingMaterial));
  body.add(new THREE.Mesh(surface.noseCap, paintMaterial));
  body.add(new THREE.Mesh(surface.tailCap, paintMaterial));

  const glassMesh = new THREE.Mesh(surface.glass, glassMaterial);
  glassMesh.renderOrder = 2;
  body.add(glassMesh);

  if (surface.trim) body.add(new THREE.Mesh(surface.trim, trimMaterial));

  // Cabin liner, so interior views look like a room rather than the inside of
  // a balloon. BackSide flips the shading normals for us.
  body.add(
    new THREE.Mesh(
      surface.liner,
      new THREE.MeshStandardMaterial({ color: 0x5e5c58, roughness: 0.9, side: THREE.BackSide })
    )
  );

  body.add(
    new THREE.Mesh(
      surface.floor,
      new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.95, side: THREE.DoubleSide })
    )
  );

  // Light bars: ribbons wrapped around each end at a fixed height.
  const bars = [
    { band: vehicle.surface.lightBar.front, side: 1, colour: 0xdfe9ff, power: 2.6 },
    { band: vehicle.surface.lightBar.rear, side: -1, colour: 0xff2f2a, power: 2.0 },
  ];
  for (const bar of bars) {
    const geo = bandGeometry(shape, bar.band[0], bar.band[1], bar.side, shape.halfWidth(0) * 0.6, 0.03);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, MATERIALS.lightBar(bar.colour, bar.power));
    mesh.material.side = THREE.DoubleSide;
    body.add(mesh);
  }

  // No underbody box. The floor pan already closes the shell along the body's
  // own outline and the wheel wells close the arches, so a box here only ever
  // showed up as a straight-edged slab hanging below the curved rocker.

  for (const ax of [dims.axleFront, dims.axleRear]) {
    // Matched to the arch radius and kept just inside the body's width. Any
    // wider and the tube's ends hang outside the flanks like mudflaps.
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(dims.archRadius, dims.archRadius, dims.trackHalf * 2 - 0.02, 24, 1, true, Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.95, side: THREE.BackSide })
    );
    well.rotation.x = Math.PI / 2;
    well.position.set(ax, parts.wheels.radius - 0.06, 0);
    body.add(well);
  }

  const interior = buildInterior(parts.interior, shape);
  body.add(interior);

  const aero = buildAeroParts(shape, parts, aeroMaterial);
  body.add(aero);

  /* ---------------- wheels ---------------- */

  const faceTexture = makeWheelTexture(parts.wheels.style);
  const rotorTexture = makeRotorTexture();
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    transparent: true,
    // alphaTest rather than blending: the spoke gaps must write depth
    // correctly or the rotor behind them sorts wrong from some angles.
    alphaTest: 0.5,
    metalness: 0.9,
    roughness: 0.28,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  });
  applyFinish(faceMaterial, parts.wheelFinish);

  const caliperMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(parts.calipers.color),
    metalness: 0.35,
    roughness: 0.42,
  });

  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  const contactTexture = makeContactTexture();
  for (const ax of [dims.axleFront, dims.axleRear]) {
    for (const side of [-1, 1]) {
      const wheel = buildWheel({ wheel: parts.wheels, faceTexture, rotorTexture, faceMaterial, caliperMaterial });
      wheel.position.set(ax, parts.wheels.radius, side * (dims.trackHalf - parts.wheels.width / 2));
      if (side < 0) wheel.rotation.y = Math.PI;
      wheels.add(wheel);

      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(parts.wheels.radius * 2.4, parts.wheels.radius * 1.7),
        new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false })
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(ax, 0.003, side * dims.trackHalf);
      contact.renderOrder = 1;
      wheels.add(contact);
    }
  }
  root.add(wheels);

  return {
    root,
    body,
    shape,
    vehicle,
    aeroMaterial,
    materials: {
      paint: paintMaterial,
      glass: glassMaterial,
      trim: trimMaterial,
      wheelFace: faceMaterial,
      caliper: caliperMaterial,
    },
    groups: { wheels, aero, interior },
    setSuspension(drop) {
      body.position.y = -drop;
    },
  };
}
