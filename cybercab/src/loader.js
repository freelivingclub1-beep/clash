/**
 * Real-model path.
 *
 * Loads a glTF and adapts it to the same interface `buildVehicle()` returns, so
 * the configurator drives a downloaded car and a generated one identically.
 *
 * The adaptation is name-based: `ROLES` maps a role to substrings, and any mesh
 * whose name or material name contains one takes that role. This is
 * deliberately dumb, because retargeting a model from a new supplier is then
 * editing strings rather than writing code -- and a mesh that matches nothing
 * keeps the material its author gave it instead of disappearing.
 *
 * The default substrings below were derived from a real production car model,
 * not guessed: Blender's glTF exporter writes names like `car_main_paint`,
 * `Glass_mid_tint`, `Brake_Disc`, `Sidewall` and `calipers`, and those
 * conventions turn out to be near-universal across model marketplaces.
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { DRACOLoader } from '../vendor/three/DRACOLoader.js';
import {
  makePaintMaterial, makeGlassMaterial, MATERIALS, applyFinish, makeContactTexture,
} from './materials.js';

/**
 * Checked in order, so the first match wins. `caliper` and `rotor` come before
 * `wheel` because a caliper is part of a wheel assembly but must stay
 * separately colourable; `tyre` comes before `wheel` so rubber never picks up
 * the rim finish.
 */
export const ROLES = {
  caliper: ['caliper', 'brembo'],
  rotor: ['brake_disc', 'brake disc', 'brakedisc', 'rotor', 'disc_brake'],
  tyre: ['tyre', 'tire', 'sidewall', 'thread', 'tread', 'rubber'],
  wheel: ['rim', 'wheel', 'hubcap', 'hub_cap'],
  glass: ['glass', 'window', 'windshield', 'windscreen', 'canopy'],
  paint: ['car_main_paint', 'car main paint', 'carpaint', 'car_paint', 'bodypaint', 'paint', 'body', 'karosserie'],
  chrome: ['chrome', 'brightwork', 'trim'],
  light: ['headlight', 'taillight', 'rear_light', 'indicator', 'light'],
  dark: ['plastic', 'cladding', 'grill', 'grille', 'non_lustrous', 'black_rough', 'black rough'],
  interior: ['interior', 'seat', 'dash', 'steering'],
};

let loader = null;

function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../vendor/three/draco/gltf/', import.meta.url).href);
  loader.setDRACOLoader(draco);
  return loader;
}

function roleOf(node, roles) {
  const hay = `${node.name} ${node.material?.name ?? ''}`.toLowerCase().replace(/\s+/g, ' ');
  for (const [role, needles] of Object.entries(roles)) {
    if (needles.some((n) => hay.includes(n))) return role;
  }
  return null;
}

/**
 * Downloaded models arrive in every unit and orientation imaginable; the rest
 * of the app assumes metres with +X forward and the car sitting on y=0.
 */
function normalise(scene, asset) {
  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Longest horizontal axis is the car's length. If it runs along Z, the model
  // is 90 degrees out from our convention.
  if (size.z > size.x) {
    scene.rotation.y = Math.PI / 2;
    scene.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scene);
    box.getSize(size);
  }

  const scale = asset.scaleToLength && size.x ? asset.scaleToLength / size.x : 1;

  // Recentre and sit on the ground *after* scaling, by wrapping: mutating the
  // scene's own transform fights whatever the exporter already put there.
  const centred = new THREE.Group();
  centred.add(scene);
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  scene.position.set(-centre.x, -box.min.y, -centre.z);

  const wrapper = new THREE.Group();
  wrapper.add(centred);
  wrapper.scale.setScalar(scale);
  return wrapper;
}

export async function loadVehicleAsset(vehicle, parts, overrideUrl) {
  const asset = vehicle.asset ?? {};
  const url = overrideUrl || asset.url;
  if (!url) return null;

  const gltf = await getLoader().loadAsync(url);
  const scene = gltf.scene;
  const roles = { ...ROLES, ...(asset.roles ?? {}) };

  const paintMaterial = makePaintMaterial(parts.paint);
  const glassMaterial = makeGlassMaterial(parts.tint);
  const trimMaterial = MATERIALS.trim(parts.trimFinish);
  const darkMaterial = MATERIALS.cladding();
  const caliperMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(parts.calipers.color),
    metalness: 0.35,
    roughness: 0.42,
  });
  const wheelFaceMaterial = new THREE.MeshStandardMaterial({
    metalness: 0.9,
    roughness: 0.28,
    envMapIntensity: 1.1,
  });
  applyFinish(wheelFaceMaterial, parts.wheelFinish);

  // Tyres and rotors get our materials, not the author's. Downloaded models are
  // wildly inconsistent here -- the one this mapping was tested against ships
  // its tyres at Blender's default 0.8 grey, which renders as white sidewalls.
  // A tyre is black rubber on every car ever made; inheriting a mistake in the
  // source asset is not fidelity.
  const tyreMaterial = MATERIALS.tire();
  const rotorMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e7276,
    metalness: 0.8,
    roughness: 0.4,
  });

  const wheelNodes = [];
  const counts = {};
  const unmapped = new Set();

  scene.traverse((node) => {
    if (!node.isMesh) return;
    const role = roleOf(node, roles);
    counts[role ?? 'unmapped'] = (counts[role ?? 'unmapped'] ?? 0) + 1;
    if (!role) unmapped.add(node.material?.name || node.name);
    switch (role) {
      case 'paint': node.material = paintMaterial; break;
      case 'glass': node.material = glassMaterial; node.renderOrder = 2; break;
      case 'chrome': node.material = trimMaterial; break;
      case 'dark': node.material = darkMaterial; break;
      case 'caliper': node.material = caliperMaterial; wheelNodes.push(node); break;
      case 'wheel': node.material = wheelFaceMaterial; wheelNodes.push(node); break;
      case 'tyre': node.material = tyreMaterial; wheelNodes.push(node); break;
      case 'rotor': node.material = rotorMaterial; wheelNodes.push(node); break;
      default: break; // keep whatever the artist authored
    }
  });

  // Unmapped meshes keep the artist's material, which on many downloaded models
  // is Blender's default grey and shows up as pale patches. Naming them makes
  // that fixable: add the string to the right role list in vehicles.js.
  console.info('[configurator] role mapping:', counts);
  if (unmapped.size) {
    console.info(
      `[configurator] ${unmapped.size} unmapped material(s), keeping authored look:`,
      [...unmapped].sort()
    );
  }

  const root = new THREE.Group();
  root.name = vehicle.id;
  const body = new THREE.Group();
  body.name = 'body';
  body.add(normalise(scene, asset));
  root.add(body);

  // Ground contact patches under whatever the model calls its wheels.
  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  if (wheelNodes.length) {
    const contactTexture = makeContactTexture();
    const seen = [];
    for (const node of wheelNodes) {
      const centre = new THREE.Vector3();
      new THREE.Box3().setFromObject(node).getCenter(centre);
      // One patch per hub, not one per mesh: a wheel is typically rim + tyre +
      // disc + caliper, and four wheels would otherwise get sixteen shadows.
      if (seen.some((p) => p.distanceTo(centre) < 0.4)) continue;
      seen.push(centre);
    }
    root.updateMatrixWorld(true);
    for (const centre of seen) {
      const world = body.localToWorld(centre.clone());
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.6),
        new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false })
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(world.x, 0.003, world.z);
      wheels.add(contact);
    }
  }
  root.add(wheels);

  return {
    root,
    body,
    vehicle,
    // Aero parts sweep along a body outline, and a loaded mesh has no such
    // query. rebuildAero() checks this and returns early. See models/README.md.
    shape: null,
    materials: {
      paint: paintMaterial,
      glass: glassMaterial,
      trim: trimMaterial,
      wheelFace: wheelFaceMaterial,
      caliper: caliperMaterial,
    },
    groups: { wheels, aero: new THREE.Group(), interior: new THREE.Group() },
    setSuspension(drop) {
      body.position.y = -drop;
    },
  };
}
