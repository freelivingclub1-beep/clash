/**
 * Turn the Free Pixel Effects Pack into strips the renderer can play.
 *
 * The pack ships each effect as a square grid of 100px frames — up to eleven
 * by eleven — with the tail of the grid usually empty, because the author
 * exported a fixed grid whatever the effect's real length. This finds where
 * each effect actually ends, samples a fixed number of frames across it, and
 * lays them out in one row so the renderer picks a frame with a single
 * multiply.
 *
 * Run with `npm run assets:effects` after `npm run assets:fx-fetch`.
 *
 * Source: CodeManu / DavitMasia, "Free Pixel Effects Pack". The pack's README
 * states it is public domain, for personal and commercial use, with no credit
 * required. Credit is in `src/assets/effects/CREDITS.md` anyway.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import UPNG from 'upng-js';

const SRC = process.env.FX_DIR ?? '/tmp/fx-src';
const OUT = 'src/assets/effects';

/** Native frame size of the pack. */
const FRAME = 100;

/**
 * Frames kept per effect.
 *
 * At 30Hz sixteen frames is a little over half a second, which is the length
 * of a blow landing. The originals run to a hundred frames — playing those in
 * full would mean an impact that is still burning three seconds after the unit
 * that caused it has died.
 */
const FRAMES = 16;

/** Alpha below this is treated as nothing; the pack has faint dithered edges. */
const INK = 8;

function frameHasInk(png, col, row) {
  const x0 = col * FRAME;
  const y0 = row * FRAME;
  for (let y = 0; y < FRAME; y++) {
    const rowStart = ((y0 + y) * png.width + x0) << 2;
    for (let x = 0; x < FRAME; x++) {
      if (png.data[rowStart + (x << 2) + 3] > INK) return true;
    }
  }
  return false;
}

function build() {
  mkdirSync(OUT, { recursive: true });
  const manifest = {};

  const files = readdirSync(SRC)
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  for (const file of files) {
    const png = PNG.sync.read(readFileSync(`${SRC}/${file}`));
    const cols = Math.floor(png.width / FRAME);
    const rows = Math.floor(png.height / FRAME);

    // Frames run left to right, top to bottom. Find the last one with ink.
    let last = 0;
    for (let i = 0; i < cols * rows; i++) {
      if (frameHasInk(png, i % cols, Math.floor(i / cols))) last = i;
    }

    const out = new PNG({ width: FRAMES * FRAME, height: FRAME, filterType: -1 });
    out.data.fill(0);
    for (let f = 0; f < FRAMES; f++) {
      const src = Math.min(last, Math.round((f * (last + 1)) / FRAMES));
      const sx = (src % cols) * FRAME;
      const sy = Math.floor(src / cols) * FRAME;
      for (let y = 0; y < FRAME; y++) {
        const from = ((sy + y) * png.width + sx) << 2;
        const to = (y * out.width + f * FRAME) << 2;
        png.data.copy(out.data, to, from, from + (FRAME << 2));
      }
    }

    // `name_spritesheet.png` -> `name`, with the pack's leading index dropped.
    const name = file.replace(/^\d+_/, '').replace(/_spritesheet\.png$/, '');
    const buf = out.data.buffer.slice(out.data.byteOffset, out.data.byteOffset + out.data.byteLength);
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(UPNG.encode([buf], out.width, out.height, 256)));
    manifest[name] = { frames: FRAMES, size: FRAME, sourceFrames: last + 1 };
    console.log(`${name.padEnd(20)} ${last + 1} source frames -> ${FRAMES}`);
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ frame: FRAME, frames: FRAMES, effects: manifest }, null, 1));
  console.log(`wrote ${Object.keys(manifest).length} effects`);
}

build();
