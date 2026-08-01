/**
 * Turn quadruped animal sheets into character atlases.
 *
 * Stendhal lays an animal out as three frames across and four directions down,
 * in the same row order LPC uses — away, right, toward, left — so rows 0 and 2
 * are the two facings this game draws, exactly as for the humanoids. That is
 * the only thing the two packs have in common; everything else here exists to
 * reconcile them.
 *
 * The output is byte-for-byte the same shape as the LPC atlases: one strip,
 * walk frames then strike frames, back row above front row, 96px cells with
 * the figure standing on the bottom of the middle 64. The renderer cannot tell
 * the difference and does not need to.
 *
 * Run with `npm run assets:beasts` after `npm run assets:beast-fetch`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { CELL, LOGICAL, ROW_BACK, ROW_FRONT, recolour, encode } from '../lpc/compose.mjs';
import { BEASTS } from './recipe.mjs';

const SRC = process.env.BEAST_DIR ?? '/tmp/beasts';
const OUT = 'src/assets/characters';

/** Matches the LPC atlases, because the renderer reads one number for both. */
const WALK_FRAMES = 6;
const STRIKE_FRAMES = 4;

/** Stendhal's grid: three frames of animation, four directions. */
const SRC_COLS = 3;
const SRC_ROWS = 4;

/**
 * Walk frames, as indices into the three the sheet has.
 *
 * A ping-pong rather than a repeat. Three frames are a left step, a neutral
 * stand and a right step, so playing them 0,1,2,0,1,2 snaps the legs back
 * through the stand every cycle and reads as a limp. Out and back is what the
 * artist drew the middle frame for.
 */
const WALK_SEQUENCE = [0, 1, 2, 2, 1, 0];

/**
 * Strike frames.
 *
 * These sheets have no attack animation — Stendhal animates an attack by
 * moving the sprite, not by drawing one. So the strike block is the extremes
 * of the stride, which under the lunge the entity renderer already applies
 * reads as the animal throwing itself forward. Inventing a bite by shearing
 * pixels would look worse than borrowing a pose that was drawn on purpose.
 */
const STRIKE_SEQUENCE = [1, 2, 2, 1];

/**
 * Resample a frame to a target height, keeping its aspect.
 *
 * A box filter, not nearest-neighbour. The scale factors here are nothing like
 * integers — a 64x85 hound into a 46px box — and nearest-neighbour at those
 * ratios drops whole pixel rows, which on art this small takes an ear or a leg
 * with it. The atlas is scaled again arbitrarily at draw time anyway, so
 * softening a little in the build costs nothing visible.
 */
function resample(src, sx, sy, sw, sh, dw, dh) {
  const out = new PNG({ width: dw, height: dh, filterType: -1 });
  out.data.fill(0);
  for (let y = 0; y < dh; y++) {
    const y0 = sy + (y * sh) / dh;
    const y1 = sy + ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = sx + (x * sw) / dw;
      const x1 = sx + ((x + 1) * sw) / dw;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = Math.floor(y0); yy < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); yy++) {
        for (let xx = Math.floor(x0); xx < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); xx++) {
          if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) continue;
          const i = (yy * src.width + xx) << 2;
          const alpha = src.data[i + 3] / 255;
          // Premultiplied, so a transparent pixel's colour cannot bleed into
          // the edge of the animal as a dark halo.
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      if (n === 0 || a === 0) continue;
      const o = (y * dw + x) << 2;
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/**
 * The tightest box containing ink, in frame-local coordinates, across every
 * frame of the sheet.
 *
 * Stendhal frames are padded — a tiger drawn inside a 64px cell might only
 * occupy forty of them — so scaling the *frame* to the target height leaves
 * the animal a third smaller than intended, which is how the first run
 * produced a pack of hounds the size of house cats.
 *
 * One box shared by every frame, not a box per frame. Trimming each frame to
 * its own ink would re-centre the animal on each one and the walk cycle would
 * jitter in place instead of striding.
 */
function inkBounds(sheet, fw, fh) {
  let x0 = fw;
  let y0 = fh;
  let x1 = -1;
  let y1 = -1;
  for (let row = 0; row < SRC_ROWS; row++) {
    for (let col = 0; col < SRC_COLS; col++) {
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const i = ((row * fh + y) * sheet.width + col * fw + x) << 2;
          if (sheet.data[i + 3] <= 8) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: fw, h: fh };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Paste an already-sized frame into one cell, standing on the logical floor. */
function place(atlas, frame, col, row) {
  const floor = row * CELL + (CELL - LOGICAL) / 2 + LOGICAL;
  const left = col * CELL + Math.round((CELL - frame.width) / 2);
  const top = Math.round(floor - frame.height);
  for (let y = 0; y < frame.height; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= atlas.height) continue;
    for (let x = 0; x < frame.width; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= atlas.width) continue;
      const si = (y * frame.width + x) << 2;
      const alpha = frame.data[si + 3];
      if (alpha === 0) continue;
      const di = (dy * atlas.width + dx) << 2;
      atlas.data[di] = frame.data[si];
      atlas.data[di + 1] = frame.data[si + 1];
      atlas.data[di + 2] = frame.data[si + 2];
      atlas.data[di + 3] = alpha;
    }
  }
}

function build() {
  mkdirSync(OUT, { recursive: true });
  const cache = new Map();
  let made = 0;

  for (const [modelId, spec] of Object.entries(BEASTS)) {
    let sheet = cache.get(spec.sheet);
    if (!sheet) {
      sheet = PNG.sync.read(readFileSync(`${SRC}/${spec.sheet}.png`));
      cache.set(spec.sheet, sheet);
    }
    const source = spec.palette ? recolour(sheet, spec.palette) : sheet;

    const fw = Math.floor(source.width / SRC_COLS);
    const fh = Math.floor(source.height / SRC_ROWS);
    const ink = inkBounds(source, fw, fh);
    const targetH = Math.round(LOGICAL * (spec.height ?? 0.8));
    const targetW = Math.max(1, Math.round((ink.w / ink.h) * targetH));

    const cols = WALK_FRAMES + STRIKE_FRAMES;
    const atlas = new PNG({ width: cols * CELL, height: 2 * CELL, filterType: -1 });
    atlas.data.fill(0);

    const rows = [ROW_BACK, ROW_FRONT];
    for (let r = 0; r < rows.length; r++) {
      const srcRow = rows[r];
      const sequence = [...WALK_SEQUENCE, ...STRIKE_SEQUENCE];
      for (let col = 0; col < sequence.length; col++) {
        const srcCol = Math.min(SRC_COLS - 1, sequence[col]);
        const frame = resample(
          source,
          srcCol * fw + ink.x,
          srcRow * fh + ink.y,
          ink.w,
          ink.h,
          targetW,
          targetH,
        );
        place(atlas, frame, col, r);
      }
    }

    writeFileSync(`${OUT}/${modelId}.png`, encode(atlas));
    made++;
    console.log(
      `${modelId.padEnd(16)} <- ${spec.sheet} frame ${fw}x${fh} ink ${ink.w}x${ink.h} -> ${targetW}x${targetH}`,
    );
  }

  console.log(`wrote ${made} animal atlases`);
}

build();
