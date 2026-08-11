/**
 * Materials and procedurally drawn textures.
 *
 * There are no image files in this project -- every map is painted into a 2D
 * canvas at boot. That keeps the demo self-contained and it is genuinely how
 * you want to prototype: adding a wheel style is a function, not an export.
 *
 * Wheel faces are drawn with a real alpha channel, so the gaps between spokes
 * are actually holes. That is what lets a coloured brake caliper read through
 * the wheel, which is the whole point of offering caliper colours.
 */

import * as THREE from 'three';

const canvas = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Car paint: metallic base + clearcoat, which is what sells a render as "car". */
export function makePaintMaterial(paint) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paint.base),
    metalness: paint.metalness,
    roughness: paint.roughness,
    clearcoat: paint.roughness > 0.5 ? 0.2 : 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1.15,
  });
}

export function applyPaint(mat, paint) {
  mat.color.set(paint.base);
  mat.metalness = paint.metalness;
  mat.roughness = paint.roughness;
  mat.clearcoat = paint.roughness > 0.5 ? 0.2 : 1;
  mat.needsUpdate = true;
}

/** Glass darkens and shifts colour with tint level; VLT drives opacity. */
export function makeGlassMaterial(tint) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint.color),
    metalness: 0,
    roughness: 0.06,
    opacity: tint.opacity,
    transparent: true,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });
  return mat;
}

export function applyTint(mat, tint) {
  mat.color.set(tint.color);
  mat.opacity = tint.opacity;
  mat.needsUpdate = true;
}

export function applyFinish(mat, finish) {
  mat.color.set(finish.tint ?? finish.color);
  if (finish.metalness != null) mat.metalness = finish.metalness;
  if (finish.roughness != null) mat.roughness = finish.roughness;
  mat.needsUpdate = true;
}

export const MATERIALS = {
  cladding: () =>
    new THREE.MeshPhysicalMaterial({ color: 0x131518, metalness: 0.25, roughness: 0.62, envMapIntensity: 0.7 }),

  aero: () =>
    new THREE.MeshPhysicalMaterial({ color: 0x17191c, metalness: 0.3, roughness: 0.42, clearcoat: 0.6, envMapIntensity: 0.9 }),

  chassis: () => new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.3, roughness: 0.85 }),

  tire: () => new THREE.MeshStandardMaterial({ color: 0x121315, metalness: 0.0, roughness: 0.92 }),

  trim: (finish) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(finish.color),
      metalness: finish.metalness,
      roughness: finish.roughness,
      envMapIntensity: 1.2,
    }),

  lightBar: (color = 0xf2f5ff, intensity = 2.4) =>
    new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      roughness: 0.3,
      metalness: 0.1,
    }),
};

/* ------------------------------------------------------------------ *
 * Wheel faces
 * ------------------------------------------------------------------ */

/**
 * Draws one wheel style. Neutral greys only -- the finish is applied as a
 * material colour on top, so nine styles times six finishes is nine textures,
 * not fifty-four.
 *
 * Everything outside the spokes is left transparent.
 */
export function makeWheelTexture(style, size = 1024) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const R = size / 2;
  g.translate(R, R);

  const ring = (r0, r1, fill) => {
    g.beginPath();
    g.arc(0, 0, r1, 0, Math.PI * 2);
    g.arc(0, 0, r0, 0, Math.PI * 2, true);
    g.fillStyle = fill;
    g.fill();
  };

  const spokes = (count, draw) => {
    for (let i = 0; i < count; i++) {
      g.save();
      g.rotate((i / count) * Math.PI * 2);
      draw(i);
      g.restore();
    }
  };

  const faceGrad = (r0, r1) => {
    const grd = g.createLinearGradient(0, -r1, 0, r1);
    grd.addColorStop(0, '#e8eaec');
    grd.addColorStop(0.45, '#b6babe');
    grd.addColorStop(1, '#8d9195');
    return grd;
  };

  // Tyre sidewall: always opaque, always dark, whatever the finish.
  ring(R * 0.74, R, '#151618');
  ring(R * 0.7, R * 0.75, '#0c0d0f');

  const LIP = R * 0.7;
  const HUB = R * 0.15;

  const barrel = () => {
    ring(R * 0.64, LIP, '#c8ccd0');
    ring(0, HUB, '#b6babe');
  };

  if (style === 'aero') {
    // Full-face cover: no holes at all, so no caliper shows. Correct.
    const dish = g.createRadialGradient(-R * 0.22, -R * 0.28, R * 0.05, 0, 0, R * 0.8);
    dish.addColorStop(0, '#dcdee0');
    dish.addColorStop(0.5, '#b0b4b8');
    dish.addColorStop(1, '#83878b');
    ring(0, LIP, dish);
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.arc(0, 0, R * (0.2 + i * 0.072), 0, Math.PI * 2);
      g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.24)';
      g.lineWidth = size * 0.007;
      g.stroke();
    }
  } else if (style === 'turbine') {
    barrel();
    spokes(10, () => {
      g.beginPath();
      g.moveTo(HUB, -R * 0.06);
      g.quadraticCurveTo(R * 0.42, -R * 0.2, LIP, -R * 0.1);
      g.lineTo(LIP, R * 0.08);
      g.quadraticCurveTo(R * 0.4, R * 0.04, HUB, R * 0.1);
      g.closePath();
      g.fillStyle = faceGrad(HUB, LIP);
      g.fill();
    });
  } else if (style === 'induction') {
    // Wide twin-blade, the classic performance-EV look.
    barrel();
    spokes(9, () => {
      g.beginPath();
      g.moveTo(HUB * 0.9, -R * 0.09);
      g.lineTo(LIP * 0.99, -R * 0.15);
      g.lineTo(LIP * 0.99, R * 0.05);
      g.lineTo(HUB * 0.9, R * 0.1);
      g.closePath();
      g.fillStyle = faceGrad(HUB, LIP);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = size * 0.003;
      g.stroke();
    });
  } else if (style === 'arachnid') {
    // Ten thin curved legs.
    barrel();
    spokes(10, () => {
      g.beginPath();
      g.moveTo(HUB, -R * 0.035);
      g.quadraticCurveTo(R * 0.45, -R * 0.14, LIP, -R * 0.03);
      g.lineTo(LIP, R * 0.05);
      g.quadraticCurveTo(R * 0.45, -R * 0.04, HUB, R * 0.055);
      g.closePath();
      g.fillStyle = faceGrad(HUB, LIP);
      g.fill();
    });
  } else if (style === 'mesh') {
    // Twenty fine strands: reads as woven at any realistic distance.
    barrel();
    spokes(20, () => {
      g.beginPath();
      g.moveTo(HUB, -R * 0.028);
      g.quadraticCurveTo(R * 0.4, -R * 0.1, LIP, -R * 0.055);
      g.lineTo(LIP, R * 0.005);
      g.quadraticCurveTo(R * 0.4, -R * 0.04, HUB, R * 0.028);
      g.closePath();
      g.fillStyle = faceGrad(HUB, LIP);
      g.fill();
    });
    ring(R * 0.42, R * 0.46, 'rgba(190,194,198,0.85)');
  } else if (style === 'split') {
    // Five spokes that fork halfway out.
    barrel();
    spokes(5, () => {
      g.beginPath();
      g.moveTo(-R * 0.055, HUB);
      g.lineTo(R * 0.055, HUB);
      g.lineTo(R * 0.085, R * 0.4);
      g.lineTo(-R * 0.085, R * 0.4);
      g.closePath();
      g.fillStyle = faceGrad(HUB, LIP);
      g.fill();
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * R * 0.055, R * 0.38);
        g.lineTo(s * R * 0.12, R * 0.4);
        g.lineTo(s * R * 0.17, LIP);
        g.lineTo(s * R * 0.06, LIP);
        g.closePath();
        g.fillStyle = faceGrad(R * 0.4, LIP);
        g.fill();
      }
    });
  } else if (style === 'concave') {
    // Deep dish monoblock: shading does the concavity, geometry can't.
    const dish = g.createRadialGradient(0, 0, HUB, 0, 0, LIP);
    dish.addColorStop(0, '#6f7377');
    dish.addColorStop(0.55, '#a8acb0');
    dish.addColorStop(1, '#dee1e4');
    spokes(7, () => {
      g.beginPath();
      g.moveTo(-R * 0.075, HUB);
      g.quadraticCurveTo(-R * 0.13, R * 0.45, -R * 0.135, LIP);
      g.lineTo(R * 0.135, LIP);
      g.quadraticCurveTo(R * 0.13, R * 0.45, R * 0.075, HUB);
      g.closePath();
      g.fillStyle = dish;
      g.fill();
    });
    ring(R * 0.64, LIP, '#d2d6da');
    ring(0, HUB, '#9ba0a4');
  } else if (style === 'lattice') {
    // Two counter-rotated spoke sets, which is what makes it read as a lattice.
    barrel();
    for (const dir of [1, -1]) {
      spokes(9, () => {
        g.save();
        g.rotate(dir * 0.16);
        g.beginPath();
        g.moveTo(HUB, -R * 0.03);
        g.quadraticCurveTo(R * 0.42, -R * 0.06 * dir, LIP, -R * 0.035);
        g.lineTo(LIP, R * 0.025);
        g.quadraticCurveTo(R * 0.42, R * 0.0 * dir, HUB, R * 0.03);
        g.closePath();
        g.fillStyle = faceGrad(HUB, LIP);
        g.fill();
        g.restore();
      });
    }
  } else {
    // 'dish': six flat spokes on a very deep lip, with exposed hardware.
    ring(R * 0.58, LIP, '#cfd3d7');
    ring(0, HUB * 1.3, '#b6babe');
    spokes(6, () => {
      g.beginPath();
      g.moveTo(-R * 0.1, HUB);
      g.lineTo(R * 0.1, HUB);
      g.lineTo(R * 0.14, R * 0.6);
      g.lineTo(-R * 0.14, R * 0.6);
      g.closePath();
      g.fillStyle = faceGrad(HUB, R * 0.6);
      g.fill();
    });
    // Exposed rim bolts.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.635, Math.sin(a) * R * 0.635, size * 0.007, 0, Math.PI * 2);
      g.fillStyle = '#8b8f93';
      g.fill();
    }
  }

  // Lug bolts read as scale cues; their absence is noticeable.
  if (style !== 'aero') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1, size * 0.012, 0, Math.PI * 2);
      g.fillStyle = '#7d8185';
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Vented brake rotor, seen through the spokes. */
export function makeRotorTexture(size = 512) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const R = size / 2;
  g.translate(R, R);

  const grd = g.createRadialGradient(0, 0, R * 0.3, 0, 0, R);
  grd.addColorStop(0, '#3c3f42');
  grd.addColorStop(0.45, '#6e7276');
  grd.addColorStop(1, '#585c60');
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fillStyle = grd;
  g.fill();

  // Drilled holes and a machined swirl -- the two cues that say "brake disc".
  for (let ringIdx = 0; ringIdx < 3; ringIdx++) {
    const r = R * (0.6 + ringIdx * 0.12);
    const n = 16 + ringIdx * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ringIdx * 0.2;
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, size * 0.012, 0, Math.PI * 2);
      g.fillStyle = '#26292b';
      g.fill();
    }
  }
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(0, 0, R * (0.42 + (i / 40) * 0.5), 0, Math.PI * 2);
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.lineWidth = 1.5;
    g.stroke();
  }

  g.beginPath();
  g.arc(0, 0, R * 0.38, 0, Math.PI * 2);
  g.fillStyle = '#2d3033';
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The blurred blob under the car. A real soft shadow needs a big shadow map or
 * a render-to-texture pass; a painted ellipse gets most of the look for free
 * and never shimmers when the camera moves.
 */
export function makeShadowTexture(size = 512) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const R = size / 2;
  const grd = g.createRadialGradient(R, R, 0, R, R, R);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.42, 'rgba(0,0,0,0.34)');
  grd.addColorStop(0.72, 'rgba(0,0,0,0.10)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dark contact patch beneath each tyre -- stops the car from floating. */
export function makeContactTexture(size = 256) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const R = size / 2;
  const grd = g.createRadialGradient(R, R, 0, R, R, R);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.32)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fake infotainment UI so the interior views have something alive in them. */
export function makeScreenTexture(width = 1024, height = 640) {
  const c = canvas(width, height);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0e12';
  g.fillRect(0, 0, width, height);

  g.fillStyle = '#151a20';
  g.fillRect(0, 0, width, 74);
  g.fillStyle = '#cfe0f2';
  g.font = '600 34px system-ui, sans-serif';
  g.fillText('Arriving 4 min', 34, 50);
  g.fillText('72°', width - 110, 50);

  g.fillStyle = '#182029';
  g.fillRect(0, 74, width, height - 74);
  g.beginPath();
  g.moveTo(width * 0.5 - 40, 150);
  g.lineTo(width * 0.5 + 40, 150);
  g.lineTo(width * 0.86, height - 30);
  g.lineTo(width * 0.14, height - 30);
  g.closePath();
  g.fillStyle = '#26333f';
  g.fill();
  g.strokeStyle = '#5ea0e0';
  g.lineWidth = 6;
  g.setLineDash([26, 22]);
  g.beginPath();
  g.moveTo(width * 0.5, 150);
  g.lineTo(width * 0.5, height - 30);
  g.stroke();
  g.setLineDash([]);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
