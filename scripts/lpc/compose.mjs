/**
 * Composite Universal LPC layers into the frames this game actually draws.
 *
 * LPC ships one sheet per layer per animation: a body, a head, a torso, legs,
 * feet and a weapon are separate images that line up frame for frame. This
 * stacks them in z-order and cuts out only what the renderer needs.
 *
 * The game views the board from behind the player's own side, so a unit only
 * ever needs two of LPC's four facings: BLUE marches away from the camera and
 * shows its back, RED marches toward it and shows its face. LPC's row order is
 * up, left, down, right — so rows 0 and 2 are exactly those two.
 */

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import AdmZip from 'adm-zip';

export const FRAME = 64;
/** LPC row index for each facing we use. */
export const ROW_BACK = 0;
export const ROW_FRONT = 2;

const zipCache = new Map();

export function openZip(dir, name) {
  const key = `${dir}/${name}`;
  let zip = zipCache.get(key);
  if (!zip) {
    zip = new AdmZip(`${dir}/${name}.zip`);
    zipCache.set(key, zip);
  }
  return zip;
}

/** Read a PNG out of a layer zip, or null when that variant does not exist. */
export function readSheet(dir, zipName, path) {
  const zip = openZip(dir, zipName);
  const entry = zip.getEntry(path);
  if (!entry) return null;
  return PNG.sync.read(entry.getData());
}

/** List entries under a prefix, for discovering what variants exist. */
export function listEntries(dir, zipName, prefix) {
  return openZip(dir, zipName)
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.png'));
}

/** Alpha-composite `src` over `dst` at an offset, both RGBA PNG buffers. */
function over(dst, src, dx, dy, sx, sy, w, h) {
  for (let y = 0; y < h; y++) {
    const syy = sy + y;
    const dyy = dy + y;
    if (syy < 0 || syy >= src.height || dyy < 0 || dyy >= dst.height) continue;
    for (let x = 0; x < w; x++) {
      const sxx = sx + x;
      const dxx = dx + x;
      if (sxx < 0 || sxx >= src.width || dxx < 0 || dxx >= dst.width) continue;
      const si = (syy * src.width + sxx) << 2;
      const a = src.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (dyy * dst.width + dxx) << 2;
      const inv = 1 - a;
      dst.data[di] = src.data[si] * a + dst.data[di] * inv;
      dst.data[di + 1] = src.data[si + 1] * a + dst.data[di + 1] * inv;
      dst.data[di + 2] = src.data[si + 2] * a + dst.data[di + 2] * inv;
      dst.data[di + 3] = Math.min(255, src.data[si + 3] + dst.data[di + 3] * inv);
    }
  }
}

/**
 * Build one card's atlas.
 *
 * Layout is a strip: walk frames then strike frames, back row above front row.
 * Keeping both facings in one image means the renderer picks a row by team and
 * a column by animation phase, with no second texture to manage.
 */
export function composeAtlas({ layers, walkFrames, strikeFrames, strikeAnim }) {
  const cols = walkFrames + strikeFrames;
  const out = new PNG({ width: cols * FRAME, height: 2 * FRAME, filterType: -1 });
  out.data.fill(0);

  const rows = [ROW_BACK, ROW_FRONT];
  for (let r = 0; r < rows.length; r++) {
    const srcRow = rows[r];
    for (const layer of layers) {
      // Walk block.
      const walk = layer.walk;
      if (walk) {
        for (let f = 0; f < walkFrames; f++) {
          over(out, walk, f * FRAME, r * FRAME, f * FRAME, srcRow * FRAME, FRAME, FRAME);
        }
      }
      // Strike block, appended after the walk frames.
      const strike = layer[strikeAnim];
      if (strike) {
        for (let f = 0; f < strikeFrames; f++) {
          over(
            out,
            strike,
            (walkFrames + f) * FRAME,
            r * FRAME,
            f * FRAME,
            srcRow * FRAME,
            FRAME,
            FRAME,
          );
        }
      }
    }
  }
  return out;
}

export function encode(png) {
  return PNG.sync.write(png, { colorType: 6 });
}

export function readLocal(path) {
  return PNG.sync.read(readFileSync(path));
}
