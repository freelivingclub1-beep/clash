/**
 * Real-model path.
 *
 * When a vehicle entry names an `asset.url`, this loads that glTF and adapts it
 * to the same interface `buildVehicle()` returns, so the configurator drives a
 * downloaded car and a generated one identically.
 *
 * The adaptation is entirely name-based. `asset.roles` maps a role to a list of
 * substrings; any mesh whose name or material name contains one of them takes
 * that role. This is deliberately dumb, because it means retargeting a model
 * from a new supplier is editing strings in vehicles.js rather than writing
 * code -- and when a name doesn't match, the mesh keeps its authored material
 * instead of disappearing.
 *
 * See models/README.md for what a model needs to satisfy.
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { DRACOLoader } from '../vendor/three/DRACOLoader.js';
import { makePaintMaterial, makeGlassMaterial, MATERIALS, applyFinish, makeContactTexture } from './materials.js';

let loader = null;

function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../vendor/three/draco/gltf/', import.meta.url).href);
  loader.setDRACOLoader(draco);
  return loader;
}

const matches = (name, needles) => {
  const n = name.toLowerCase();
  return needles.some((needle) => n.includes(needle));
};

function roleOf(mesh, roles) {
  const names = [mesh.name, mesh.material?.name ?? ''].join(' ');
  // Wheels first: a mesh called "wheel_rim_chrome" is a wheel, not brightwork.
  for (const role of ['wheel', 'glass', 'paint', 'chrome', 'dark', 'interior']) {
    if (roles[role] && matches(names, roles[role])) return role;
  }
  return null;
}

/**
 * Normalises a loaded scene: recentres it on the origin, drops it onto y=0 and
 * scales it to the vehicle's real length. Downloaded models arrive in every
 * unit and orientation imaginable, and the rest of the app assumes metres with
 * +X forward.
 */
function normalise(scene, asset) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  // Longest horizontal axis is the car's length. If it runs along Z, the model
  // is 90 degrees out from our convention and needs turning.
  if (size.z > size.x) {
    scene.rotation.y = Math.PI / 2;
    scene.updateMatrixWorld(true);
    box.setFromObject(scene);
    box.getSize(size);
    box.getCenter(centre);
  }

  const scale = asset.scaleToLength ? asset.scaleToLength / size.x : 1;
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.position.sub(centre);
  scene.position.y += size.y / 2;
  wrapper.scale.setScalar(scale);
  return wrapper;
}

/**
 * Wheels in a downloaded model are usually four separate nodes. Grouping them
 * by position lets the app spin, swap or hide them, and tells us the axle
 * positions without the manifest having to state them.
 */
function collectWheels(meshes) {
  const wheels = meshes.map((m) => {
    const box = new THREE.Box3().setFromObject(m);
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    return { mesh: m, centre };
  });
  return wheels;
}

export async function loadVehicleAsset(vehicle, parts) {
  const asset = vehicle.asset;
  if (!asset?.url) return null;

  const gltf = await getLoader().loadAsync(asset.url);
  const scene = gltf.scene;

  const paintMaterial = makePaintMaterial(parts.paint);
  const glassMaterial = makeGlassMaterial(parts.tint);
  const trimMaterial = MATERIALS.trim(parts.trimFinish);
  const darkMaterial = MATERIALS.cladding();

  const wheelMeshes = [];
  const interiorNodes = [];

  scene.traverse((node) => {
    if (!node.isMesh) return;
    node.frustumCulled = false;
    switch (roleOf(node, asset.roles)) {
      case 'paint':
        node.material = paintMaterial;
        break;
      case 'glass':
        node.material = glassMaterial;
        node.renderOrder = 2;
        break;
      case 'chrome':
        node.material = trimMaterial;
        break;
      case 'dark':
        node.material = darkMaterial;
        break;
      case 'wheel':
        wheelMeshes.push(node);
        break;
      case 'interior':
        interiorNodes.push(node);
        break;
      default:
        // Unrecognised: keep whatever the artist authored. Better a mesh we
        // don't recolour than a mesh we lose.
        break;
    }
  });

  const root = new THREE.Group();
  root.name = vehicle.id;
  const body = new THREE.Group();
  body.name = 'body';
  body.add(normalise(scene, asset));
  root.add(body);

  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  const found = collectWheels(wheelMeshes);
  if (found.length) {
    const contactTexture = makeContactTexture();
    for (const { centre } of found) {
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(parts.wheels.radius * 2.4, parts.wheels.radius * 1.7),
        new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false })
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(centre.x, 0.003, centre.z);
      wheels.add(contact);
    }
  }
  root.add(wheels);

  const wheelFaceMaterial = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.28 });
  applyFinish(wheelFaceMaterial, parts.wheelFinish);
  for (const { mesh } of found) {
    if (matches(mesh.name.toLowerCase(), ['tyre', 'tire', 'rubber'])) continue;
    mesh.material = wheelFaceMaterial;
  }

  return {
    root,
    body,
    vehicle,
    shape: null, // aero parts need an outline query; a loaded model has none yet
    materials: {
      paint: paintMaterial,
      glass: glassMaterial,
      trim: trimMaterial,
      wheelFace: wheelFaceMaterial,
      caliper: new THREE.MeshStandardMaterial({ color: new THREE.Color(parts.calipers.color) }),
    },
    groups: { wheels, aero: new THREE.Group(), interior: new THREE.Group() },
    setSuspension(drop) {
      body.position.y = -drop;
    },
  };
}
