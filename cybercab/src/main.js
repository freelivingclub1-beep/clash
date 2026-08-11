/**
 * App wiring: state in, meshes and DOM out.
 *
 * The interesting decision here is what each change costs. Paint, tint, wheel
 * finish, caliper colour and trim are material writes -- three assignments, no
 * allocation. Aero rebuilds one small group. Wheels change the arch geometry,
 * so they rebuild the car. Switching vehicles rebuilds everything and reframes
 * the camera.
 */

import { Stage } from './scene.js';
import { buildVehicle } from './model.js';
import { loadVehicleAsset } from './loader.js';
import { buildAeroParts } from './parts.js';
import { applyPaint, applyTint, applyFinish } from './materials.js';
import { DEFAULT_CONFIG, GROUP_IMPACT, resolve } from './catalog.js';
import { VEHICLES, vehicleById } from './vehicles.js';
import { mountPanel, mountViewDots } from './ui.js';
import { makeViews, DOT_ORDER } from './views.js';

const stageEl = document.getElementById('stage');
const panelEl = document.getElementById('panel');
const dotsEl = document.getElementById('viewbar');
const badgeEl = document.getElementById('badge');

/**
 * The whole configuration fits in the query string, so any build is a link you
 * can send someone -- and a bug report can be a URL.
 */
const URL_KEYS = [
  'vehicle', 'trim', 'paint', 'wheels', 'wheelFinish', 'calipers', 'tint',
  'frontLip', 'rearLip', 'skirts', 'diffuser', 'trimFinish', 'suspension', 'interior',
];

function readUrl() {
  const q = new URLSearchParams(location.search ?? '');
  const patch = {};
  for (const key of URL_KEYS) if (q.has(key)) patch[key] = q.get(key);
  if (q.has('savings')) patch.includeSavings = q.get('savings') === '1';
  return patch;
}

/** Camera preset index, so a shared link opens on the angle you meant. */
const startView = Number(new URLSearchParams(location.search ?? '').get('view')) || 0;

/**
 * `?model=<url>` points the loader at any glTF without touching the source.
 * Since real vehicle assets can't be shipped with the demo, this is how you
 * try one: host a .glb anywhere with CORS open and paste the URL.
 */
const modelOverride = new URLSearchParams(location.search ?? '').get('model');

function writeUrl(state) {
  const q = new URLSearchParams();
  for (const key of URL_KEYS) q.set(key, state[key]);
  if (state.includeSavings) q.set('savings', '1');
  q.set('view', String(viewIndex));
  if (modelOverride) q.set('model', modelOverride);
  try {
    history.replaceState(null, '', `${location.pathname}?${q}`);
  } catch {
    // Sandboxed iframes reject history writes. Shareable links are a bonus;
    // losing them is not a reason to stop the configurator.
  }
}

const state = { ...DEFAULT_CONFIG, ...readUrl() };
const stage = new Stage(stageEl);

let car = null;
let vehicle = vehicleById(state.vehicle);
let views = makeViews(vehicle);
let dotViews = DOT_ORDER.map((id) => views[id]);
let viewIndex = 0;

function disposeGroup(group) {
  group.traverse((node) => {
    node.geometry?.dispose();
    if (node.material) {
      for (const m of [].concat(node.material)) {
        for (const key of ['map', 'emissiveMap', 'alphaMap']) m[key]?.dispose?.();
        m.dispose();
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * Rebuild paths, cheapest first
 * ------------------------------------------------------------------ */

function rebuildCar() {
  const parts = resolve(state);
  if (car) {
    stage.scene.remove(car.root);
    disposeGroup(car.root);
  }
  car = buildVehicle({ vehicle, parts });
  car.setSuspension(parts.suspension.drop);
  stage.scene.add(car.root);
  stage.frameGround(vehicle.dims);

  // If this vehicle names a real glTF, it supersedes the generated body the
  // moment it finishes downloading. Until then the placeholder is on screen,
  // which is better than an empty stage.
  loadVehicleAsset(vehicle, parts, modelOverride)
    .then((loaded) => {
      if (!loaded || vehicle.id !== loaded.vehicle.id) return;
      stage.scene.remove(car.root);
      disposeGroup(car.root);
      car = loaded;
      car.setSuspension(resolve(state).suspension.drop);
      stage.scene.add(car.root);
      setBadge(false);
    })
    .catch((err) => {
      console.warn(`[cybercab] asset load failed for ${vehicle.id}:`, err);
    });

  setBadge(!(modelOverride || vehicle.asset?.url));
}

function rebuildAero() {
  const parts = resolve(state);
  if (!car.shape) return; // a loaded glTF has no outline query yet
  car.body.remove(car.groups.aero);
  disposeGroup(car.groups.aero);
  car.groups.aero = buildAeroParts(car.shape, parts, car.aeroMaterial);
  car.body.add(car.groups.aero);
}

function applyMaterials() {
  const parts = resolve(state);
  applyPaint(car.materials.paint, parts.paint);
  applyTint(car.materials.glass, parts.tint);
  applyFinish(car.materials.wheelFace, parts.wheelFinish);
  car.materials.caliper.color.set(parts.calipers.color);
  car.materials.trim.color.set(parts.trimFinish.color);
  car.materials.trim.metalness = parts.trimFinish.metalness;
  car.materials.trim.roughness = parts.trimFinish.roughness;
  car.materials.trim.needsUpdate = true;
}

function setBadge(placeholder) {
  if (!badgeEl) return;
  badgeEl.hidden = !placeholder;
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

function focusView(id) {
  const view = views[id];
  if (!view) return;
  stage.setView(view.pose);
  stage.autoSpin = false;
  const dot = dotViews.findIndex((v) => v.id === id);
  if (dot >= 0) {
    viewIndex = dot;
    dots.update(viewIndex);
  } else {
    dots.update(-1);
  }
}

function setDot(index) {
  viewIndex = ((index % dotViews.length) + dotViews.length) % dotViews.length;
  stage.setView(dotViews[viewIndex].pose);
  stage.autoSpin = false;
  dots.update(viewIndex);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

const panel = mountPanel(
  panelEl,
  (patch) => {
    const before = { ...state };
    Object.assign(state, patch);

    if (patch.vehicle && patch.vehicle !== before.vehicle) {
      vehicle = vehicleById(state.vehicle);
      // Trims are per-vehicle; keep the equivalent one rather than resetting.
      if (!vehicle.trims.some((t) => t.id === state.trim)) state.trim = vehicle.trims[0].id;
      views = makeViews(vehicle);
      dotViews = DOT_ORDER.map((id) => views[id]);
      rebuildCar();
      focusView('hero');
    } else {
      const impacts = Object.keys(patch)
        .map((key) => GROUP_IMPACT[key])
        .filter(Boolean);
      if (impacts.includes('wheels') || impacts.includes('interior')) rebuildCar();
      else if (impacts.includes('parts')) rebuildAero();
      else if (impacts.includes('transform')) car.setSuspension(resolve(state).suspension.drop);
      if (impacts.includes('material')) applyMaterials();
    }

    panel.update(state, vehicle);
    writeUrl(state);
  },
  (focus) => focusView(focus)
);

const dots = mountViewDots(dotsEl, dotViews, (value, relative) => {
  setDot(relative ? viewIndex + value : value);
});

addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, button')) return;
  if (e.key === 'ArrowRight') setDot(viewIndex + 1);
  else if (e.key === 'ArrowLeft') setDot(viewIndex - 1);
  else if (e.key === ' ') {
    e.preventDefault();
    stage.autoSpin = !stage.autoSpin;
  }
});

rebuildCar();
panel.update(state, vehicle);
viewIndex = ((startView % dotViews.length) + dotViews.length) % dotViews.length;
dots.update(viewIndex);
stage.jumpTo(dotViews[viewIndex].pose);
stage.start();

requestAnimationFrame(() => document.body.classList.add('ready'));
