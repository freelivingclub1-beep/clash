/**
 * Procedural texture generation.
 *
 * Surfaces were flat colour fills — the turf was two shades of green in a
 * checkerboard, towers were rectangles with notches cut out. This module
 * generates actual tiling textures instead: stone with mortar courses, grass
 * with individual blades, water with caustic banding, planked wood with grain.
 *
 * Generated rather than downloaded because this environment can reach no
 * texture host (every CDN and asset site is blocked by the network policy),
 * and because bundling third-party art carries a licensing problem regardless.
 * Generation also has real advantages: the whole set costs a few kilobytes of
 * code instead of megabytes of PNG, every surface can be re-tinted per team
 * or per card without exporting a variant, and there is nothing to 404.
 *
 * Each texture is rasterised once into an offscreen canvas and handed out as a
 * `CanvasPattern`, so drawing a textured surface is one `fillRect` against a
 * cached bitmap rather than thousands of per-pixel operations per frame.
 */

/** Tile size for repeating textures. Large enough to hide obvious repetition. */
const TEXTURE_SIZE = 128;

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/**
 * A tiny seeded PRNG. Textures must look identical on every load — a player
 * should not see the arena change pattern between sessions — so nothing here
 * uses Math.random.
 */
function makeRandom(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return ((state >>> 8) & 0xffffff) / 0xffffff;
  };
}

/** Value-noise lattice with smooth interpolation, tiling at `size`. */
function makeValueNoise(seed: number, size: number): (x: number, y: number) => number {
  const random = makeRandom(seed);
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();

  const at = (x: number, y: number): number =>
    lattice[((y % size) + size) % size * size + (((x % size) + size) % size)];

  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // Smoothstep, so the lattice does not show as a visible grid.
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

/** Fractal sum of noise octaves — the standard way to get natural detail. */
function fbm(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 4,
): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function createTile(size = TEXTURE_SIZE): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for texture generation');
  return { canvas, ctx };
}

function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hexToRgb(hex: string): number[] {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// Texture painters
// ---------------------------------------------------------------------------

/**
 * Grass: fbm base for colour variation plus short blades.
 *
 * The blades matter more than the noise — a purely noisy green reads as static
 * rather than as ground, and drawing a few hundred one-pixel strokes at the
 * texture level costs nothing at runtime because it happens once.
 */
function paintGrass(ctx: CanvasRenderingContext2D, seed: number, base: string, size: number): void {
  const noise = makeValueNoise(seed, 16);
  const image = ctx.createImageData(size, size);
  const dark = mix(hexToRgb(base), [0, 0, 0], 0.32);
  const light = mix(hexToRgb(base), [255, 255, 255], 0.16);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, (x / size) * 6, (y / size) * 6, 4);
      const colour = mix(dark, light, n);
      const i = (y * size + x) * 4;
      image.data[i] = colour[0];
      image.data[i + 1] = colour[1];
      image.data[i + 2] = colour[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const random = makeRandom(seed ^ 0x5f5f);
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = random() * size;
    const y = random() * size;
    const height = 2 + random() * 4;
    const lean = (random() - 0.5) * 2;
    const shade = random();
    ctx.strokeStyle =
      shade > 0.5
        ? `rgba(255,255,255,${0.05 + shade * 0.08})`
        : `rgba(0,0,0,${0.05 + shade * 0.1})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - height);
    ctx.stroke();
  }
}

/** Stone blocks in offset courses, with mortar and per-block tonal variation. */
function paintStone(
  ctx: CanvasRenderingContext2D,
  seed: number,
  base: string,
  size: number,
  blockH = 16,
): void {
  const random = makeRandom(seed);
  const noise = makeValueNoise(seed ^ 0x99, 12);
  const rgb = hexToRgb(base);

  // Mortar shows through the gaps between blocks.
  ctx.fillStyle = `rgb(${mix(rgb, [0, 0, 0], 0.55).map(Math.round).join(',')})`;
  ctx.fillRect(0, 0, size, size);

  const blockW = 32;
  for (let row = 0; row * blockH < size; row++) {
    // Alternate courses are offset by half a block, as real masonry is.
    const offset = row % 2 === 0 ? 0 : -blockW / 2;
    for (let col = -1; col * blockW + offset < size; col++) {
      const x = col * blockW + offset;
      const y = row * blockH;
      const tone = 0.72 + random() * 0.42;
      const colour = mix(mix(rgb, [0, 0, 0], 0.25), mix(rgb, [255, 255, 255], 0.2), tone % 1);

      ctx.fillStyle = `rgb(${colour.map(Math.round).join(',')})`;
      ctx.fillRect(x + 1, y + 1, blockW - 2, blockH - 2);

      // A highlight on the top edge and shadow on the bottom give each block
      // enough relief to read as three-dimensional at small sizes.
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(x + 1, y + 1, blockW - 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + 1, y + blockH - 3, blockW - 2, 2);
    }
  }

  // Speckle to break up the flatness of each block face.
  const image = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(noise, (x / size) * 10, (y / size) * 10, 3) - 0.5) * 26;
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
      image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + n));
      image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + n));
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Water: layered horizontal caustic bands over a depth gradient. */
function paintWater(ctx: CanvasRenderingContext2D, seed: number, base: string, size: number): void {
  const noise = makeValueNoise(seed, 14);
  const rgb = hexToRgb(base);
  const deep = mix(rgb, [0, 0, 0], 0.4);
  const shallow = mix(rgb, [255, 255, 255], 0.3);

  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Stretched horizontally so the noise reads as a current rather than
      // as isotropic blobs.
      const n = fbm(noise, (x / size) * 3, (y / size) * 8, 4);
      const caustic = Math.pow(Math.max(0, Math.sin(n * Math.PI * 3 + y * 0.14)), 6) * 0.5;
      const colour = mix(deep, shallow, n * 0.6 + caustic);
      const i = (y * size + x) * 4;
      image.data[i] = colour[0];
      image.data[i + 1] = colour[1];
      image.data[i + 2] = colour[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Wood planks running horizontally, with grain and visible seams. */
function paintWood(ctx: CanvasRenderingContext2D, seed: number, base: string, size: number): void {
  const random = makeRandom(seed);
  const noise = makeValueNoise(seed ^ 0x2f, 10);
  const rgb = hexToRgb(base);
  const plankH = 16;

  for (let row = 0; row * plankH < size; row++) {
    const tone = 0.75 + random() * 0.4;
    const colour = mix(mix(rgb, [0, 0, 0], 0.2), mix(rgb, [255, 255, 255], 0.18), tone % 1);
    ctx.fillStyle = `rgb(${colour.map(Math.round).join(',')})`;
    ctx.fillRect(0, row * plankH, size, plankH);

    // Grain: long, low-contrast strokes along the plank.
    for (let i = 0; i < 10; i++) {
      const y = row * plankH + 2 + random() * (plankH - 4);
      ctx.strokeStyle = `rgba(0,0,0,${0.04 + random() * 0.07})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, y + (fbm(noise, x / 20, y / 8, 2) - 0.5) * 2.2);
      }
      ctx.stroke();
    }

    // Seam between planks.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, row * plankH + plankH - 2, size, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, row * plankH, size, 1);
  }
}

/** Packed dirt for the paths worn around towers. */
function paintDirt(ctx: CanvasRenderingContext2D, seed: number, base: string, size: number): void {
  const noise = makeValueNoise(seed, 18);
  const rgb = hexToRgb(base);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, (x / size) * 9, (y / size) * 9, 4);
      const colour = mix(mix(rgb, [0, 0, 0], 0.3), mix(rgb, [255, 255, 255], 0.2), n);
      const i = (y * size + x) * 4;
      image.data[i] = colour[0];
      image.data[i + 1] = colour[1];
      image.data[i + 2] = colour[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Scattered pebbles.
  const random = makeRandom(seed ^ 0x77);
  for (let i = 0; i < 70; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 0.6 + random() * 1.6;
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Brushed metal for mechanical structures. */
function paintMetal(ctx: CanvasRenderingContext2D, seed: number, base: string, size: number): void {
  const random = makeRandom(seed);
  const rgb = hexToRgb(base);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, `rgb(${mix(rgb, [255, 255, 255], 0.28).map(Math.round).join(',')})`);
  gradient.addColorStop(0.5, `rgb(${rgb.map(Math.round).join(',')})`);
  gradient.addColorStop(1, `rgb(${mix(rgb, [0, 0, 0], 0.35).map(Math.round).join(',')})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 200; i++) {
    const y = random() * size;
    ctx.strokeStyle = random() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (random() - 0.5) * 2);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type TextureName =
  | 'grassBlue'
  | 'grassBlueAlt'
  | 'grassRed'
  | 'grassRedAlt'
  | 'water'
  | 'wood'
  | 'stone'
  | 'stoneBlue'
  | 'stoneRed'
  | 'dirt'
  | 'metal';

interface TextureSpec {
  paint: (ctx: CanvasRenderingContext2D, seed: number, base: string, size: number) => void;
  base: string;
  seed: number;
}

const SPECS: Record<TextureName, TextureSpec> = {
  grassBlue: { paint: paintGrass, base: '#3f7040', seed: 101 },
  grassBlueAlt: { paint: paintGrass, base: '#457a45', seed: 202 },
  grassRed: { paint: paintGrass, base: '#4c6280', seed: 303 },
  grassRedAlt: { paint: paintGrass, base: '#546a8a', seed: 404 },
  water: { paint: paintWater, base: '#2f7fae', seed: 505 },
  wood: { paint: paintWood, base: '#8a6b45', seed: 606 },
  stone: { paint: paintStone, base: '#8b8f98', seed: 707 },
  stoneBlue: { paint: paintStone, base: '#5f86bf', seed: 808 },
  stoneRed: { paint: paintStone, base: '#bf6a5f', seed: 909 },
  dirt: { paint: paintDirt, base: '#7a6248', seed: 111 },
  metal: { paint: paintMetal, base: '#9aa2ae', seed: 222 },
};

const canvasCache = new Map<TextureName, HTMLCanvasElement>();
const patternCache = new Map<string, CanvasPattern>();

export function textureCanvas(name: TextureName): HTMLCanvasElement {
  const cached = canvasCache.get(name);
  if (cached) return cached;

  const spec = SPECS[name];
  const { canvas, ctx } = createTile();
  spec.paint(ctx, spec.seed, spec.base, TEXTURE_SIZE);
  canvasCache.set(name, canvas);
  return canvas;
}

/**
 * A repeating pattern for a texture.
 *
 * Patterns are cached per context because a `CanvasPattern` is bound to the
 * context that created it — reusing one across contexts is undefined.
 */
export function texturePattern(
  ctx: CanvasRenderingContext2D,
  name: TextureName,
): CanvasPattern | string {
  const key = name;
  const cached = patternCache.get(key);
  if (cached) return cached;

  const pattern = ctx.createPattern(textureCanvas(name), 'repeat');
  if (!pattern) return SPECS[name].base;
  patternCache.set(key, pattern);
  return pattern;
}

/** Drop every cached bitmap — used when the canvas is recreated on resize. */
export function clearTextureCache(): void {
  canvasCache.clear();
  patternCache.clear();
}

export const TEXTURE_TILE_SIZE = TEXTURE_SIZE;
