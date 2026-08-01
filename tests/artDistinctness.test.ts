/**
 * No two cards may look like the same card.
 *
 * The figures are composed from a recipe rather than drawn, which is what
 * makes a roster of a hundred and fifty affordable — and it is also how a
 * roster of a hundred and fifty quietly becomes a roster of forty. Only a few
 * axes of a card's model reached the composed figure for a long time, so two
 * cards agreeing on body plan, build and weapon kind came out pixel for pixel
 * alike however different their registry entries looked.
 *
 * The build guarantees distinct recipes now. This checks the thing that
 * actually matters, which is not the same claim: that the *pictures* differ.
 * A recipe can vary in an axis that turns out to be pure colour — a chainmail
 * shirt and a leather one have the same outline — and report success while a
 * player still cannot tell two units apart in a fight.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';

const DIR = new URL('../src/assets/characters/', import.meta.url);
const CELL = 96;
/** Coarse enough to be fast, fine enough to see a silhouette. */
const N = 16;

interface Signature {
  id: string;
  /** Coverage per cell: the shape, independent of palette. */
  mask: number[];
  /** Mean colour per cell, alpha-weighted. */
  rgb: number[];
}

function signature(png: PNG, id: string, col: number, row: number): Signature {
  const step = CELL / N;
  const mask: number[] = [];
  const rgb: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = 0; yy < step; yy++) {
        for (let xx = 0; xx < step; xx++) {
          const sx = col * CELL + Math.floor(x * step + xx);
          const sy = row * CELL + Math.floor(y * step + yy);
          const i = ((sy * png.width) + sx) << 2;
          const alpha = png.data[i + 3] / 255;
          r += png.data[i] * alpha;
          g += png.data[i + 1] * alpha;
          b += png.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      mask.push(a / n);
      rgb.push(a > 0 ? r / a : 0, a > 0 ? g / a : 0, a > 0 ? b / a : 0);
    }
  }
  return { id, mask, rgb };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function loadSignatures(): Signature[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => {
      const png = PNG.sync.read(readFileSync(new URL(f, DIR)));
      // The front-facing standing pose: what a card face shows and what a
      // player sees marching toward them.
      return signature(png, f.replace('.png', ''), 0, 1);
    });
}

describe('card art distinctness', () => {
  const sigs = loadSignatures();

  it('has art for the whole roster', () => {
    // Skipped in a checkout with no built atlases rather than failing, since
    // the art is generated and this file is about relationships between
    // pieces of it, not about whether the build has been run.
    if (sigs.length === 0) return;
    expect(sigs.length).toBeGreaterThan(100);
  });

  it('never draws two cards as the same figure', () => {
    if (sigs.length === 0) return;
    const offenders: string[] = [];
    let worst = 0;
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const shape = cosine(sigs[i].mask, sigs[j].mask);
        const colour = cosine(sigs[i].rgb, sigs[j].rgb);
        const score = shape * 0.5 + colour * 0.5;
        worst = Math.max(worst, score);
        /*
         * 0.99 rather than 1.0. Two figures built from the same pack will
         * always share a great deal — the same proportions, the same palette
         * range, the same stance — so demanding low similarity would be
         * demanding a different art pack. What this rules out is the pair a
         * player would call the same unit.
         */
        if (score >= 0.99) offenders.push(`${sigs[i].id} ~ ${sigs[j].id} (${score.toFixed(4)})`);
      }
    }
    expect(offenders, `worst pair scored ${worst.toFixed(4)}`).toEqual([]);
  });

  it('keeps silhouettes apart, not just palettes', () => {
    /*
     * Measured separately because it is the failure that hid for longest: the
     * de-duplication once ran on garment, trousers and boots, reported every
     * card distinct, and left pairs matching at a shape similarity of exactly
     * 1.000. Colour is not evidence that two units can be told apart in a
     * scrum; the outline is.
     */
    if (sigs.length === 0) return;
    const identical: string[] = [];
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        if (cosine(sigs[i].mask, sigs[j].mask) >= 0.999) {
          identical.push(`${sigs[i].id} ~ ${sigs[j].id}`);
        }
      }
    }
    expect(identical).toEqual([]);
  });
});
