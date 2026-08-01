/**
 * Composite Universal LPC layers into the frames this game actually draws.
 *
 * LPC ships one sheet per layer per animation: a body, a head, a torso, legs,
 * feet and a weapon are separate images that line up frame for frame. This
 * stacks them in z-order and cuts out only what the renderer needs.
 *
 * The game views the board from behind the player's own side, so a unit only
 * ever needs two of LPC's four facings: the back row for units marching away
 * from the camera and the front row for those marching toward it. LPC's row
 * order is up, left, down, right — so rows 0 and 2 are exactly those two.
 */

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import AdmZip from 'adm-zip';
import UPNG from 'upng-js';

/**
 * Output cell size, and the figure's own box within it.
 *
 * LPC's base layers are all 64px, but weapons are not: a mace swing ships on a
 * 192px grid and an arming sword on a 128px one, both centred on the same 64px
 * body. Cutting those to 64 threw away the entire arc — which is why every
 * unit in the first build appeared to strike with an invisible weapon.
 *
 * 96 is measured, not guessed: the widest swing in the pack (the scythe) inks
 * 104px across and the rest fit inside 96, so a 96px cell keeps essentially
 * every weapon whole. The figure still occupies the middle 64, and the
 * renderer scales against that logical box so unit sizes are unchanged.
 */
export const CELL = 96;
export const LOGICAL = 64;
export const PAD = (CELL - LOGICAL) / 2;

/** LPC row index for each facing we use. */
export const ROW_BACK = 0;
export const ROW_FRONT = 2;

const DIRECTIONS = 4;

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

/**
 * The frame size of a four-direction sheet.
 *
 * Every walk and slash sheet in the pack is four rows of square frames, so the
 * frame size falls straight out of the height. Assuming 64 instead — as this
 * did originally — silently cropped every oversize weapon to its top-left
 * quarter, which is a corner of empty margin on a 192px mace sheet.
 */
export function frameSize(sheet) {
  const fs = sheet.height / DIRECTIONS;
  if (Number.isInteger(fs) && fs % 64 === 0 && sheet.width % fs === 0) return fs;
  return 64;
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
 * How many frames each LPC animation actually has.
 *
 * Needed because sheet width is not a reliable frame count. LPC's oversize
 * weapon sheets are padded to a wider grid than the animation uses — the bow's
 * nine walk frames sit in a thirteen-column sheet — so dividing width by frame
 * size and sampling across the result walks straight off the end of the cycle
 * into blank columns, which is why bows disappeared halfway through a stride.
 */
const FRAME_COUNTS = {
  walk: 9,
  slash: 6,
  attack_slash: 6,
  attack_halfslash: 7,
  halfslash: 7,
  thrust: 8,
  shoot: 13,
  spellcast: 7,
  hurt: 6,
  run: 8,
  idle: 2,
  combat_idle: 2,
};

/**
 * Draw one animation block of one layer.
 *
 * Source columns are sampled proportionally across whatever the sheet actually
 * holds rather than against a fixed stride, because the counts are not uniform:
 * a body walks in nine frames but a trident overlay in eight. Striding by a
 * constant would drift them apart; striding by proportion keeps every layer at
 * the same point in its own cycle.
 */
function drawBlock(out, sheet, anim, srcRow, outRow, colOffset, outFrames) {
  const fs = frameSize(sheet);
  const limit = FRAME_COUNTS[anim] ?? Infinity;
  const cols = Math.max(1, Math.min(limit, Math.floor(sheet.width / fs)));
  const inset = (CELL - fs) / 2;
  for (let f = 0; f < outFrames; f++) {
    const src = Math.min(Math.round((f * cols) / outFrames), cols - 1);
    over(
      out,
      sheet,
      (colOffset + f) * CELL + inset,
      outRow * CELL + inset,
      src * fs,
      srcRow * fs,
      fs,
      fs,
    );
  }
}

/**
 * Build one model's atlas.
 *
 * Layout is a strip: walk frames then strike frames, back row above front row.
 * Keeping both facings in one image means the renderer picks a row by facing
 * and a column by animation phase, with no second texture to manage.
 *
 * `layers` is ordered back to front. A weapon contributes two entries — the
 * half LPC draws behind the body and the half it draws in front — so a bow
 * wraps the archer rather than floating on one side of them.
 *
 * Each layer names the animation its strike sheet came from, because the frame
 * count depends on it and a layer that had to fall back to a different motion
 * is not on the same cycle length as the rest.
 */
export function composeAtlas({ layers, walkFrames, strikeFrames }) {
  const cols = walkFrames + strikeFrames;
  const out = new PNG({ width: cols * CELL, height: 2 * CELL, filterType: -1 });
  out.data.fill(0);

  const rows = [ROW_BACK, ROW_FRONT];
  for (let r = 0; r < rows.length; r++) {
    for (const layer of layers) {
      if (layer.walk) drawBlock(out, layer.walk, 'walk', rows[r], r, 0, walkFrames);
      if (layer.slash) {
        drawBlock(out, layer.slash, layer.slashAnim ?? 'slash', rows[r], r, walkFrames, strikeFrames);
      }
    }
  }
  return out;
}

/**
 * Encode as an indexed-colour PNG.
 *
 * The art is limited-palette pixel work, so storing it as 32-bit RGBA spends
 * roughly three bytes per pixel on information that is not there. Quantising
 * to 256 colours is visually free on this material and is what makes shipping
 * hundreds of cards in one file possible at all — the atlas payload dominates
 * the build, so a third of the size is a third of the whole artifact.
 *
 * `cnum: 0` would ask UPNG for lossless RGBA; naming the count explicitly is
 * what selects the palette path.
 */
export function encode(png, colours = 256) {
  const buf = png.data.buffer.slice(png.data.byteOffset, png.data.byteOffset + png.data.byteLength);
  return Buffer.from(UPNG.encode([buf], png.width, png.height, colours));
}

export function readLocal(path) {
  return PNG.sync.read(readFileSync(path));
}
