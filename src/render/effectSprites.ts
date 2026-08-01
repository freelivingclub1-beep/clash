/**
 * Hand-drawn animated effects, played as sprite strips.
 *
 * The procedural particle work underneath this is good at *mass* — a plume
 * that swirls, sparks that scatter, smoke that outlives the blow — but it is
 * built out of soft round blobs, and enough soft round blobs still read as
 * soft round blobs. What it cannot do is draw: a fire that has the shape of
 * fire, a shockwave with a rim, a rune that turns. Those are drawn frames, and
 * drawn frames are what makes an effect look authored rather than simulated.
 *
 * So the two run together. The particles carry the spread and the physics, and
 * a real animation plays over the top of them at the point of contact.
 *
 * Source: CodeManu / DavitMasia, "Free Pixel Effects Pack" — public domain,
 * see `src/assets/effects/CREDITS.md`. Built into strips by
 * `scripts/fx/build.mjs`.
 */

const EFFECT_URLS = import.meta.glob('../assets/effects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Frames per strip and the native size of one, matching `scripts/fx/build.mjs`. */
export const EFFECT_FRAMES = 16;
export const EFFECT_SIZE = 100;

/** Every effect in the pack, by the name the renderer asks for. */
export type EffectName =
  | 'bluefire'
  | 'brightfire'
  | 'casting'
  | 'felspell'
  | 'fire'
  | 'firespin'
  | 'flamelash'
  | 'freezing'
  | 'loading'
  | 'magic8'
  | 'magicbubbles'
  | 'magickahit'
  | 'magicspell'
  | 'midnight'
  | 'nebula'
  | 'phantom'
  | 'protectioncircle'
  | 'sunburn'
  | 'vortex'
  | 'weaponhit';

const urlByName = new Map<string, string>();
for (const [path, url] of Object.entries(EFFECT_URLS)) {
  const file = path.split('/').pop() ?? '';
  urlByName.set(file.replace(/\.png$/, ''), url);
}

const images = new Map<string, HTMLImageElement | null>();

/**
 * The decoded strip for an effect, or null until it is ready.
 *
 * Never throws and never blocks: a frame that asks for an effect the browser
 * has not finished decoding simply draws the particles without it, which is
 * exactly what the game looked like before these existed.
 */
export function effectSheet(name: EffectName): HTMLImageElement | null {
  const url = urlByName.get(name);
  if (!url) return null;

  const cached = images.get(name);
  if (cached !== undefined) {
    return cached && cached.complete && cached.naturalWidth > 0 ? cached : null;
  }

  if (typeof Image === 'undefined') {
    images.set(name, null);
    return null;
  }
  const img = new Image();
  img.src = url;
  images.set(name, img);
  return null;
}

/**
 * Start decoding every effect.
 *
 * Called as a match starts. Decoding one on first use would mean the first
 * fireball of the game is the one that stutters, and the first fireball of the
 * game is the one somebody is watching.
 */
export function warmEffects(): void {
  for (const name of urlByName.keys()) effectSheet(name as EffectName);
}

/** Draw one frame of a strip, centred on a point. */
export function drawEffectFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  x: number,
  y: number,
  size: number,
  rotation = 0,
): void {
  const index = Math.max(0, Math.min(EFFECT_FRAMES - 1, frame));
  const half = size / 2;
  if (rotation === 0) {
    ctx.drawImage(
      sheet,
      index * EFFECT_SIZE,
      0,
      EFFECT_SIZE,
      EFFECT_SIZE,
      x - half,
      y - half,
      size,
      size,
    );
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(sheet, index * EFFECT_SIZE, 0, EFFECT_SIZE, EFFECT_SIZE, -half, -half, size, size);
  ctx.restore();
}
