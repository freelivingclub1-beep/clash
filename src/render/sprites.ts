/**
 * Unit artwork.
 *
 * Two sources, in priority order:
 *
 *   1. `card.spriteKey`, when it is a URL. The image is fetched at runtime and
 *      used directly, so any card can point at art hosted anywhere without a
 *      rebuild. This is the seam for real assets.
 *   2. The procedural composer below, driven by the card's `modelId`.
 *
 * The composer draws a body plan, a head, a weapon and an accessory from
 * `./models`. That composition is what gives ~40 cards ~40 distinct
 * silhouettes: an earlier version derived the figure from stats, so every
 * melee tank drew identically and a mixed board read as one repeated unit.
 *
 * No third-party art is bundled. Shipping Clash Royale's actual textures would
 * be copyright infringement, and the large CC0 asset hosts are unreachable
 * under this environment's network policy — so runtime URLs are the honest
 * seam rather than a vendored asset folder.
 *
 * Generated sprites are rasterised once into offscreen canvases and cached by
 * (card, team, pose). Redrawing from primitives every frame for every unit
 * would dominate the frame budget; blitting a cached bitmap does not.
 */

import type { CardDefinition } from '@cards/schema';
import {
  type ModelSpec,
  type BodyPlan,
  type HeadKind,
  type WeaponKind,
  type AccessoryKind,
  type BuildKind,
  type TrimKind,
  MODELS,
} from './models';

export const SPRITE_SIZE = 96;
/**
 * Frames in the walk cycle.
 *
 * Twelve rather than six. The phase driving this is now sampled on a fractional
 * tick, so it advances every frame; at six frames the cycle still visibly
 * stepped, because the limiting factor had become the number of distinct
 * pictures rather than how often they were chosen. Each extra pose is one more
 * cached 96px bitmap per card per team, and only cards actually played are ever
 * rasterised, so the cost is bounded by deck size rather than roster size.
 */
export const POSE_COUNT = 12;
/** Frames in the attack animation. Fewer than the walk cycle: a swing is quick. */
export const STRIKE_POSE_COUNT = 8;

export type Team = 0 | 1;

const TEAM_TRIM: Record<Team, string> = { 0: '#4a9eff', 1: '#ff6b5b' };
const TEAM_TRIM_DARK: Record<Team, string> = { 0: '#1b4f8a', 1: '#8a2f24' };

/** Fallback body plan when a card names no model, derived from its stats. */
export function fallbackModel(card: CardDefinition): ModelSpec {
  if (card.category === 'Building' || card.category === 'TowerTroop') {
    return { body: 'structure', head: 'none', weapon: 'cannon', accessory: 'none', scale: 1, build: 'normal', trim: 'sash' };
  }
  if (card.isFlying) {
    return { body: 'winged', head: 'beak', weapon: 'claws', accessory: 'wings', scale: 0.9, build: 'normal', trim: 'sash' };
  }
  if (card.attackRange >= 3) {
    return { body: 'humanoid', head: 'hood', weapon: 'bow', accessory: 'none', scale: 0.9, build: 'lean', trim: 'sash' };
  }
  return { body: 'humanoid', head: 'helm', weapon: 'sword', accessory: 'none', scale: 1, build: 'normal', trim: 'sash' };
}

export function modelFor(card: CardDefinition): ModelSpec {
  return MODELS[card.modelId] ?? fallbackModel(card);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const mix = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

interface Palette {
  body: string;
  dark: string;
  light: string;
  trim: string;
  trimDark: string;
  skin: string;
  metal: string;
  wood: string;
}

interface Rig {
  /** Where the head sits. */
  headX: number;
  headY: number;
  headR: number;
  /** Where a held weapon anchors. */
  handX: number;
  handY: number;
  /** Torso box, for capes and shields. */
  torsoX: number;
  torsoY: number;
  torsoW: number;
  torsoH: number;
}

/**
 * Proportion multipliers per build.
 *
 * These are applied as a transform around the whole body, so one set of plan
 * geometry yields a lanky version, a squat version and a hulking version
 * without any plan being rewritten. Without this, every card sharing a body
 * plan was drawn from identical hardcoded numbers — which is how forty-seven
 * humanoids ended up as one figure in different colours.
 */
const BUILDS: Record<BuildKind, { w: number; h: number; head: number }> = {
  normal: { w: 1, h: 1, head: 1 },
  lean: { w: 0.78, h: 1.12, head: 0.9 },
  gaunt: { w: 0.64, h: 1.24, head: 0.78 },
  stout: { w: 1.22, h: 0.86, head: 1.1 },
  hulking: { w: 1.34, h: 1.16, head: 1.18 },
  squat: { w: 1.14, h: 0.7, head: 1.24 },
  towering: { w: 0.9, h: 1.42, head: 0.84 },
  tiny: { w: 0.82, h: 0.76, head: 1.22 },
  broad: { w: 1.45, h: 0.94, head: 0.86 },
};

/**
 * Paint the team colour onto a torso box, in the place this model wears it.
 *
 * Every figure in the game used to carry the identical horizontal band across
 * the chest at the identical height. Even genuinely different bodies rhymed
 * because of it, so where the colour sits is now part of the model.
 */
function trimBand(
  ctx: CanvasRenderingContext2D,
  kind: TrimKind,
  p: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (kind === 'none') return;
  ctx.fillStyle = p.trim;
  switch (kind) {
    case 'sash':
      ctx.fillRect(x, y + h * 0.45, w, Math.max(3, h * 0.18));
      break;
    case 'belt':
      ctx.fillRect(x, y + h * 0.78, w, Math.max(3, h * 0.16));
      break;
    case 'collar':
      ctx.fillRect(x, y, w, Math.max(3, h * 0.2));
      break;
    case 'hem':
      ctx.fillRect(x, y + h - Math.max(3, h * 0.16), w, Math.max(3, h * 0.16));
      break;
    case 'shoulders':
      ctx.fillRect(x, y + h * 0.08, w * 0.28, Math.max(3, h * 0.22));
      ctx.fillRect(x + w * 0.72, y + h * 0.08, w * 0.28, Math.max(3, h * 0.22));
      break;
    case 'chevron': {
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h * 0.3);
      ctx.lineTo(x + w, y + h * 0.62);
      ctx.lineTo(x + w, y + h * 0.8);
      ctx.lineTo(x + w / 2, y + h * 0.48);
      ctx.lineTo(x, y + h * 0.8);
      ctx.lineTo(x, y + h * 0.62);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Body plans — each returns the rig the head/weapon/accessory attach to
// ---------------------------------------------------------------------------

function drawBody(
  ctx: CanvasRenderingContext2D,
  plan: BodyPlan,
  p: Palette,
  cx: number,
  groundY: number,
  swing: number,
  trim: TrimKind = 'sash',
): Rig {
  switch (plan) {
    case 'humanoid': {
      const legSwing = swing * 6;
      roundRect(ctx, cx - 11 + legSwing, groundY - 20, 9, 20, 4, p.dark);
      roundRect(ctx, cx + 2 - legSwing, groundY - 20, 9, 20, 4, p.dark);
      roundRect(ctx, cx - 12 + legSwing, groundY - 6, 11, 6, 3, p.trimDark);
      roundRect(ctx, cx + 1 - legSwing, groundY - 6, 11, 6, 3, p.trimDark);
      const top = groundY - 46;
      roundRect(ctx, cx - 15, top, 30, 28, 8, p.body);
      roundRect(ctx, cx - 15, top, 30, 10, 6, p.light);
      trimBand(ctx, trim, p, cx - 15, top, 30, 28);
      roundRect(ctx, cx - 20, top + 4 - swing * 5, 7, 18, 3, shade(p.body, -0.15));
      roundRect(ctx, cx + 13, top + 4 + swing * 5, 7, 18, 3, shade(p.body, -0.15));
      return { headX: cx, headY: top - 12, headR: 12, handX: cx + 18, handY: top + 8, torsoX: cx - 15, torsoY: top, torsoW: 30, torsoH: 28 };
    }

    case 'brute': {
      // Heavy, hunched, long arms that reach past the knees.
      const legSwing = swing * 4;
      roundRect(ctx, cx - 16 + legSwing, groundY - 22, 13, 22, 5, p.dark);
      roundRect(ctx, cx + 3 - legSwing, groundY - 22, 13, 22, 5, p.dark);
      const top = groundY - 54;
      roundRect(ctx, cx - 22, top, 44, 36, 12, p.body);
      roundRect(ctx, cx - 22, top, 44, 12, 8, p.light);
      trimBand(ctx, trim, p, cx - 22, top, 44, 36);
      roundRect(ctx, cx - 32, top + 2 - swing * 4, 11, 30, 5, shade(p.body, -0.15));
      roundRect(ctx, cx + 21, top + 2 + swing * 4, 11, 30, 5, shade(p.body, -0.15));
      return { headX: cx, headY: top - 8, headR: 14, handX: cx + 27, handY: top + 26, torsoX: cx - 22, torsoY: top, torsoW: 44, torsoH: 36 };
    }

    case 'golem': {
      // Stacked slabs with visible seams — reads as stone, not flesh.
      // Short, heavy stride: a golem should lumber, not glide, and before this
      // it did not move a single pixel between frames.
      const legSwing = swing * 3;
      roundRect(ctx, cx - 18 + legSwing, groundY - 18, 14, 18, 3, p.dark);
      roundRect(ctx, cx + 4 - legSwing, groundY - 18, 14, 18, 3, p.dark);
      const top = groundY - 56;
      roundRect(ctx, cx - 20, top, 40, 40, 6, p.body);
      ctx.strokeStyle = shade(p.body, -0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 20, top + 14);
      ctx.lineTo(cx + 20, top + 18);
      ctx.moveTo(cx - 6, top);
      ctx.lineTo(cx - 2, top + 40);
      ctx.stroke();
      roundRect(ctx, cx - 30, top + 4 - swing * 3, 10, 26, 3, shade(p.body, 0.1));
      roundRect(ctx, cx + 20, top + 4 + swing * 3, 10, 26, 3, shade(p.body, 0.1));
      // Glowing core.
      ellipse(ctx, cx, top + 22, 6, 6, p.light);
      return { headX: cx, headY: top - 6, headR: 12, handX: cx + 25, handY: top + 26, torsoX: cx - 20, torsoY: top, torsoW: 40, torsoH: 40 };
    }

    case 'winged': {
      const hover = 14 + swing * 3;
      const y = groundY - hover;
      const spread = 18 + swing * 8;
      ellipse(ctx, cx - spread, y - 34, 17, 9, shade(p.body, 0.35));
      ellipse(ctx, cx + spread, y - 34, 17, 9, shade(p.body, 0.35));
      const top = y - 44;
      roundRect(ctx, cx - 13, top, 26, 26, 10, p.body);
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 13, top + 12, 26, 4);
      // Tail.
      ctx.fillStyle = p.dark;
      ctx.beginPath();
      ctx.moveTo(cx - 4, top + 24);
      ctx.lineTo(cx + 4, top + 24);
      ctx.lineTo(cx + swing * 6, top + 40);
      ctx.closePath();
      ctx.fill();
      return { headX: cx, headY: top - 10, headR: 11, handX: cx + 16, handY: top + 12, torsoX: cx - 13, torsoY: top, torsoW: 26, torsoH: 26 };
    }

    case 'serpent': {
      // A coiled S-body, no legs — unmistakable next to a biped.
      ctx.strokeStyle = p.body;
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 14, groundY - 4);
      ctx.quadraticCurveTo(cx + 18 + swing * 4, groundY - 22, cx - 8, groundY - 38);
      ctx.quadraticCurveTo(cx - 24, groundY - 50, cx + 2, groundY - 58);
      ctx.stroke();
      ctx.strokeStyle = shade(p.body, 0.3);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = p.trim;
      ellipse(ctx, cx - 2, groundY - 30, 4, 4, p.trim);
      return { headX: cx + 4, headY: groundY - 66, headR: 11, handX: cx + 16, handY: groundY - 50, torsoX: cx - 12, torsoY: groundY - 50, torsoW: 24, torsoH: 30 };
    }

    case 'mech': {
      // Boxy, piston legs, no organic curves.
      const legSwing = swing * 5;
      ctx.fillStyle = p.metal;
      ctx.fillRect(cx - 14 + legSwing, groundY - 24, 10, 24);
      ctx.fillRect(cx + 4 - legSwing, groundY - 24, 10, 24);
      ctx.fillStyle = shade(p.metal, -0.3);
      ctx.fillRect(cx - 16 + legSwing, groundY - 6, 14, 6);
      ctx.fillRect(cx + 2 - legSwing, groundY - 6, 14, 6);
      const top = groundY - 54;
      roundRect(ctx, cx - 18, top, 36, 32, 4, p.body);
      ctx.fillStyle = shade(p.body, -0.35);
      ctx.fillRect(cx - 18, top + 20, 36, 5);
      // Exhaust stacks.
      ctx.fillStyle = p.metal;
      ctx.fillRect(cx - 14, top - 10, 5, 10);
      ctx.fillRect(cx + 9, top - 10, 5, 10);
      roundRect(ctx, cx - 26, top + 6, 9, 22, 2, p.metal);
      roundRect(ctx, cx + 17, top + 6, 9, 22, 2, p.metal);
      return { headX: cx, headY: top - 10, headR: 11, handX: cx + 24, handY: top + 20, torsoX: cx - 18, torsoY: top, torsoW: 36, torsoH: 32 };
    }

    case 'orb': {
      // Floating sphere with orbiting motes — no limbs at all.
      const hover = 16 + swing * 4;
      const y = groundY - hover - 20;
      ellipse(ctx, cx, y, 17, 17, p.body);
      ellipse(ctx, cx - 5, y - 5, 7, 7, p.light);
      for (let i = 0; i < 3; i++) {
        const a = swing * Math.PI + (i * Math.PI * 2) / 3;
        ellipse(ctx, cx + Math.cos(a) * 24, y + Math.sin(a) * 12, 4, 4, p.trim);
      }
      return { headX: cx, headY: y, headR: 13, handX: cx + 20, handY: y, torsoX: cx - 16, torsoY: y - 16, torsoW: 32, torsoH: 32 };
    }

    case 'insect': {
      // Low, wide, six legs splayed out.
      const top = groundY - 30;
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        const off = i * 10;
        const flex = swing * 3 * (i === 0 ? -1 : 1);
        ctx.beginPath();
        ctx.moveTo(cx + off, top + 12);
        ctx.lineTo(cx + off - 16, top + 20 + flex);
        ctx.lineTo(cx + off - 18, groundY);
        ctx.moveTo(cx + off, top + 12);
        ctx.lineTo(cx + off + 16, top + 20 - flex);
        ctx.lineTo(cx + off + 18, groundY);
        ctx.stroke();
      }
      ellipse(ctx, cx + 2, top + 12, 20, 13, p.body);
      ellipse(ctx, cx - 2, top + 8, 12, 9, p.light);
      return { headX: cx - 16, headY: top + 6, headR: 10, handX: cx + 18, handY: top + 8, torsoX: cx - 18, torsoY: top, torsoW: 36, torsoH: 24 };
    }

    case 'shelled': {
      // Dome shell over stubby legs — obviously a turtle in silhouette.
      const legSwing = swing * 3;
      roundRect(ctx, cx - 20 + legSwing, groundY - 12, 12, 12, 4, p.dark);
      roundRect(ctx, cx + 8 - legSwing, groundY - 12, 12, 12, 4, p.dark);
      const top = groundY - 42;
      ctx.fillStyle = shade(p.body, -0.25);
      ctx.beginPath();
      ctx.ellipse(cx, top + 22, 28, 24, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = shade(p.body, -0.5);
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 10, top + 22);
        ctx.lineTo(cx + i * 6, top);
        ctx.stroke();
      }
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 28, top + 20, 56, 4);
      return { headX: cx + 24, headY: top + 12, headR: 9, handX: cx + 26, handY: top + 16, torsoX: cx - 26, torsoY: top, torsoW: 52, torsoH: 24 };
    }

    case 'wraith': {
      // No legs — a tattered trailing hem that ripples with the walk cycle.
      const top = groundY - 52;
      ctx.fillStyle = p.body;
      ctx.beginPath();
      ctx.moveTo(cx - 16, top + 10);
      ctx.lineTo(cx + 16, top + 10);
      ctx.lineTo(cx + 12 + swing * 3, groundY - 2);
      ctx.lineTo(cx + 4, groundY - 8);
      ctx.lineTo(cx - 4, groundY - 1);
      ctx.lineTo(cx - 12 - swing * 3, groundY - 6);
      ctx.closePath();
      ctx.fill();
      roundRect(ctx, cx - 14, top, 28, 22, 9, shade(p.body, 0.15));
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 14, top + 12, 28, 4);
      return { headX: cx, headY: top - 10, headR: 11, handX: cx + 18, handY: top + 8, torsoX: cx - 14, torsoY: top, torsoW: 28, torsoH: 22 };
    }

    case 'quadruped': {
      // Four legs and a rider platform — clearly a beast, not a person.
      const legSwing = swing * 5;
      ctx.fillStyle = p.dark;
      ctx.fillRect(cx - 20 + legSwing, groundY - 18, 7, 18);
      ctx.fillRect(cx - 8 - legSwing, groundY - 18, 7, 18);
      ctx.fillRect(cx + 6 + legSwing, groundY - 18, 7, 18);
      ctx.fillRect(cx + 16 - legSwing, groundY - 18, 7, 18);
      const top = groundY - 40;
      roundRect(ctx, cx - 24, top, 48, 24, 10, p.body);
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 24, top + 15, 48, 5);
      // Snout end.
      ellipse(ctx, cx - 26, top + 8, 10, 8, shade(p.body, 0.1));
      return { headX: cx - 28, headY: top + 4, headR: 10, handX: cx + 18, handY: top - 6, torsoX: cx - 24, torsoY: top, torsoW: 48, torsoH: 24 };
    }

    case 'cart': {
      // Wheels and a chassis — a vehicle, not a creature.
      const spin = swing * 0.9;
      ctx.fillStyle = p.wood;
      roundRect(ctx, cx - 24, groundY - 34, 48, 20, 4, p.wood);
      ctx.fillStyle = shade(p.wood, -0.3);
      ctx.fillRect(cx - 24, groundY - 22, 48, 5);
      for (const wx of [cx - 15, cx + 15]) {
        ellipse(ctx, wx, groundY - 10, 11, 11, p.metal);
        ellipse(ctx, wx, groundY - 10, 5, 5, shade(p.metal, -0.4));
        ctx.strokeStyle = shade(p.metal, -0.4);
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = spin + (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(wx - Math.cos(a) * 10, groundY - 10 - Math.sin(a) * 10);
          ctx.lineTo(wx + Math.cos(a) * 10, groundY - 10 + Math.sin(a) * 10);
          ctx.stroke();
        }
      }
      return { headX: cx, headY: groundY - 44, headR: 10, handX: cx + 22, handY: groundY - 32, torsoX: cx - 24, torsoY: groundY - 34, torsoW: 48, torsoH: 20 };
    }

    // --- silhouettes added to break up the humanoid crowd ------------------

    case 'centaur': {
      // Human torso rising from a four-legged barrel.
      const legSwing = swing * 5;
      const backY = groundY - 26;
      for (let i = 0; i < 4; i++) {
        const lx = cx - 22 + i * 13;
        const sw = i % 2 === 0 ? legSwing : -legSwing;
        roundRect(ctx, lx + sw, backY, 7, 26, 3, p.dark);
      }
      roundRect(ctx, cx - 26, backY - 18, 52, 22, 10, p.body);
      const top = backY - 50;
      roundRect(ctx, cx + 2, top, 22, 34, 8, shade(p.body, 0.1));
      trimBand(ctx, trim, p, cx + 2, top, 22, 34);
      return { headX: cx + 13, headY: top - 11, headR: 11, handX: cx + 28, handY: top + 12, torsoX: cx + 2, torsoY: top, torsoW: 22, torsoH: 34 };
    }

    case 'floating': {
      // No legs: a hovering mass over a trailing hem.
      const drift = swing * 3;
      const centre = groundY - 40 + drift;
      ellipse(ctx, cx, groundY - 4, 16, 5, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = shade(p.body, -0.2);
      ctx.beginPath();
      ctx.moveTo(cx - 20, centre);
      ctx.quadraticCurveTo(cx - 14, groundY - 8, cx, groundY - 2);
      ctx.quadraticCurveTo(cx + 14, groundY - 8, cx + 20, centre);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, cx, centre, 21, 19, p.body);
      ellipse(ctx, cx - 6, centre - 6, 9, 7, p.light);
      trimBand(ctx, trim, p, cx - 21, centre - 8, 42, 20);
      return { headX: cx, headY: centre - 22, headR: 11, handX: cx + 22, handY: centre, torsoX: cx - 21, torsoY: centre - 19, torsoW: 42, torsoH: 38 };
    }

    case 'totem': {
      // A stack of plates, the tallest thing on the board.
      let y = groundY;
      const widths = [30, 26, 22, 19, 16];
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i];
        const h = 13;
        roundRect(ctx, cx - w / 2, y - h, w, h, 3, i % 2 === 0 ? p.body : shade(p.body, -0.18));
        y -= h + 1;
      }
      trimBand(ctx, trim, p, cx - 15, groundY - 34, 30, 12);
      return { headX: cx, headY: y - 9, headR: 10, handX: cx + 17, handY: y + 18, torsoX: cx - 13, torsoY: y, torsoW: 26, torsoH: 34 };
    }

    case 'tripod': {
      // Three splayed legs under a small pod.
      const flex = swing * 3;
      const podY = groundY - 40;
      for (const dx of [-19, 0, 19]) {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx + dx * 0.25, podY + 8);
        ctx.lineTo(cx + dx + (dx === 0 ? 0 : flex), groundY);
        ctx.stroke();
      }
      ellipse(ctx, cx, podY, 17, 14, p.body);
      ellipse(ctx, cx + 5, podY - 4, 6, 5, p.light);
      trimBand(ctx, trim, p, cx - 17, podY - 4, 34, 9);
      return { headX: cx, headY: podY - 16, headR: 9, handX: cx + 19, handY: podY + 2, torsoX: cx - 17, torsoY: podY - 14, torsoW: 34, torsoH: 28 };
    }

    case 'blob': {
      // Wide, soft, limbless. Squashes as it moves.
      const squash = 1 + swing * 0.08;
      const h = 26 / squash;
      const w = 30 * squash;
      ellipse(ctx, cx, groundY - h * 0.7, w, h, p.body);
      ellipse(ctx, cx - w * 0.3, groundY - h, w * 0.36, h * 0.4, p.light);
      trimBand(ctx, trim, p, cx - w, groundY - h * 0.6, w * 2, 8);
      return { headX: cx, headY: groundY - h * 1.5, headR: 11, handX: cx + w * 0.8, handY: groundY - h * 0.8, torsoX: cx - w, torsoY: groundY - h * 1.4, torsoW: w * 2, torsoH: h * 1.4 };
    }

    case 'crystal': {
      // Angular shards around a hollow core — nothing organic about it.
      const spin = swing * 2;
      const top = groundY - 52;
      ctx.fillStyle = p.body;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + 18, groundY - 26);
      ctx.lineTo(cx + 10, groundY);
      ctx.lineTo(cx - 10, groundY);
      ctx.lineTo(cx - 18, groundY - 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.light;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + 18, groundY - 26);
      ctx.lineTo(cx, groundY - 20);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, cx + spin, groundY - 30, 6, 6, p.trim);
      return { headX: cx, headY: top - 6, headR: 8, handX: cx + 20, handY: groundY - 32, torsoX: cx - 18, torsoY: top, torsoW: 36, torsoH: 52 };
    }

    case 'swarm': {
      // A card that *is* its cloud: five small bodies orbiting, no single torso.
      const positions: Array<[number, number, number]> = [
        [0, -44, 10], [-17, -30, 8], [17, -32, 8], [-10, -14, 7], [12, -12, 7],
      ];
      for (const [dx, dy, r] of positions) {
        const wob = swing * (dx === 0 ? 2 : dx > 0 ? 3 : -3);
        ellipse(ctx, cx + dx + wob, groundY + dy, r, r * 0.9, p.body);
        ellipse(ctx, cx + dx + wob - r * 0.3, groundY + dy - r * 0.3, r * 0.35, r * 0.3, p.light);
      }
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 14, groundY - 26, 28, 4);
      return { headX: cx, headY: groundY - 44, headR: 10, handX: cx + 22, handY: groundY - 30, torsoX: cx - 18, torsoY: groundY - 46, torsoW: 36, torsoH: 40 };
    }

    case 'siege': {
      // Long counterweighted arm on a narrow base.
      const tilt = swing * 0.12;
      roundRect(ctx, cx - 14, groundY - 14, 28, 14, 3, p.dark);
      ctx.save();
      ctx.translate(cx, groundY - 14);
      ctx.rotate(-0.5 + tilt);
      roundRect(ctx, -3, -44, 6, 46, 2, p.wood);
      ellipse(ctx, 0, -44, 8, 8, shade(p.body, -0.1));
      ctx.restore();
      roundRect(ctx, cx - 9, groundY - 30, 18, 18, 4, p.body);
      trimBand(ctx, trim, p, cx - 9, groundY - 26, 18, 6);
      return { headX: cx - 2, headY: groundY - 38, headR: 8, handX: cx + 16, handY: groundY - 26, torsoX: cx - 9, torsoY: groundY - 30, torsoW: 18, torsoH: 18 };
    }

    case 'hunched': {
      // Bent double — head lower than the shoulders.
      const legSwing = swing * 5;
      roundRect(ctx, cx - 12 + legSwing, groundY - 18, 10, 18, 4, p.dark);
      roundRect(ctx, cx + 2 - legSwing, groundY - 18, 10, 18, 4, p.dark);
      const top = groundY - 40;
      ctx.fillStyle = p.body;
      ctx.beginPath();
      ctx.ellipse(cx, top + 10, 20, 14, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ellipse(ctx, cx - 6, top + 4, 8, 6, p.light);
      trimBand(ctx, trim, p, cx - 18, top + 12, 36, 6);
      roundRect(ctx, cx + 8, top + 12 + swing * 4, 7, 22, 3, shade(p.body, -0.15));
      return { headX: cx - 18, headY: top + 16, headR: 10, handX: cx + 14, handY: top + 28, torsoX: cx - 20, torsoY: top - 4, torsoW: 40, torsoH: 28 };
    }

    case 'twinned': {
      // Two torsos on one waist.
      const legSwing = swing * 5;
      roundRect(ctx, cx - 11 + legSwing, groundY - 18, 10, 18, 4, p.dark);
      roundRect(ctx, cx + 1 - legSwing, groundY - 18, 10, 18, 4, p.dark);
      const top = groundY - 44;
      roundRect(ctx, cx - 20, top + 6, 40, 20, 7, shade(p.body, -0.1));
      roundRect(ctx, cx - 19, top - 4, 17, 22, 6, p.body);
      roundRect(ctx, cx + 2, top + 2, 17, 22, 6, shade(p.body, 0.12));
      trimBand(ctx, trim, p, cx - 20, top + 12, 40, 5);
      return { headX: cx - 11, headY: top - 14, headR: 10, handX: cx + 22, handY: top + 12, torsoX: cx - 20, torsoY: top - 4, torsoW: 40, torsoH: 30 };
    }

    case 'structure':
    default: {
      roundRect(ctx, cx - 26, groundY - 14, 52, 14, 4, shade(p.body, -0.45));
      roundRect(ctx, cx - 22, groundY - 54, 44, 42, 6, p.body);
      roundRect(ctx, cx - 16, groundY - 48, 32, 14, 3, shade(p.body, 0.3));
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = p.dark;
        ctx.fillRect(cx - 22 + i * 12, groundY - 60, 8, 8);
      }
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 22, groundY - 20, 44, 5);
      return { headX: cx, headY: groundY - 44, headR: 0, handX: cx + 20, handY: groundY - 40, torsoX: cx - 22, torsoY: groundY - 54, torsoW: 44, torsoH: 42 };
    }
  }
}

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

function drawHead(ctx: CanvasRenderingContext2D, kind: HeadKind, p: Palette, rig: Rig): void {
  if (kind === 'none' || rig.headR === 0) return;
  const { headX: x, headY: y, headR: r } = rig;

  const faceless = kind === 'skull' || kind === 'visor' || kind === 'mask' || kind === 'beak';
  ellipse(ctx, x, y, r, r, kind === 'skull' ? '#e8e4dc' : p.skin);

  switch (kind) {
    case 'helm':
      ctx.fillStyle = shade(p.trim, -0.15);
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - r, y - 1, r * 2, 4);
      break;
    case 'hood':
      ctx.fillStyle = shade(p.body, -0.25);
      ctx.beginPath();
      ctx.arc(x, y - 2, r + 1, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
      break;
    case 'wizardHat':
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.moveTo(x - r - 3, y - 5);
      ctx.lineTo(x, y - 30);
      ctx.lineTo(x + r + 3, y - 5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'beak':
      ctx.fillStyle = '#e8b24a';
      ctx.beginPath();
      ctx.moveTo(x + r - 2, y - 3);
      ctx.lineTo(x + r + 12, y + 2);
      ctx.lineTo(x + r - 2, y + 6);
      ctx.closePath();
      ctx.fill();
      break;
    case 'skull':
      ctx.fillStyle = '#1a1a22';
      ctx.beginPath();
      ctx.arc(x - 4, y, 3.2, 0, Math.PI * 2);
      ctx.arc(x + 4, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 4, y + 6, 8, 3);
      break;
    case 'horned':
      ctx.fillStyle = '#e8e0cc';
      ctx.beginPath();
      ctx.moveTo(x - r, y - 4);
      ctx.lineTo(x - r - 9, y - 16);
      ctx.lineTo(x - r + 3, y - 10);
      ctx.closePath();
      ctx.moveTo(x + r, y - 4);
      ctx.lineTo(x + r + 9, y - 16);
      ctx.lineTo(x + r - 3, y - 10);
      ctx.closePath();
      ctx.fill();
      break;
    case 'visor':
      ctx.fillStyle = shade(p.metal, 0.1);
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ff9d4a';
      ctx.fillRect(x - r + 2, y - 2, r * 2 - 4, 5);
      break;
    case 'crest':
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - r);
      ctx.lineTo(x, y - r - 14);
      ctx.lineTo(x + 3, y - r);
      ctx.closePath();
      ctx.fill();
      break;
    case 'crown':
      // A slim silver circlet with a single stone, so it never reads as the
      // gold multi-point champion crown drawn over the top of hero cards.
      ctx.fillStyle = '#d8dce4';
      ctx.fillRect(x - r + 1, y - r - 4, r * 2 - 2, 4);
      ellipse(ctx, x, y - r - 6, 3.5, 3.5, shade(p.trim, 0.35));
      break;
    case 'mask':
      ctx.fillStyle = shade(p.trim, -0.3);
      roundRect(ctx, x - r, y - 6, r * 2, 12, 3, shade(p.trim, -0.3));
      ctx.fillStyle = '#ffdca8';
      ctx.fillRect(x - 6, y - 2, 4, 3);
      ctx.fillRect(x + 2, y - 2, 4, 3);
      break;
    default:
      break;
  }

  if (!faceless) {
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x - 5, y + 1, 3, 4);
    ctx.fillRect(x + 2, y + 1, 3, 4);
  }
}

// ---------------------------------------------------------------------------
// Weapons and accessories
// ---------------------------------------------------------------------------

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  kind: WeaponKind,
  p: Palette,
  rig: Rig,
  swing: number,
): void {
  const x = rig.handX;
  const y = rig.handY + swing * 4;

  switch (kind) {
    case 'sword':
      ctx.fillStyle = '#d8dce4';
      ctx.fillRect(x, y - 28, 4, 34);
      ctx.fillStyle = p.wood;
      ctx.fillRect(x - 3, y + 4, 10, 4);
      break;
    case 'hammer':
      ctx.fillStyle = p.wood;
      ctx.fillRect(x, y - 20, 4, 32);
      roundRect(ctx, x - 7, y - 30, 18, 13, 3, p.metal);
      break;
    case 'axe':
      ctx.fillStyle = p.wood;
      ctx.fillRect(x, y - 24, 4, 34);
      ctx.fillStyle = p.metal;
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 26);
      ctx.lineTo(x + 20, y - 20);
      ctx.lineTo(x + 4, y - 8);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bow':
      ctx.strokeStyle = p.wood;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 17, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.stroke();
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 9, y - 14);
      ctx.lineTo(x + 9, y + 14);
      ctx.stroke();
      break;
    case 'staff':
      ctx.fillStyle = p.wood;
      ctx.fillRect(x, y - 30, 4, 42);
      ellipse(ctx, x + 2, y - 32, 7, 7, shade(p.trim, 0.4));
      ellipse(ctx, x + 2, y - 32, 4, 4, '#ffffff');
      break;
    case 'spear':
      ctx.fillStyle = p.wood;
      ctx.fillRect(x, y - 36, 3, 50);
      ctx.fillStyle = p.metal;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 34);
      ctx.lineTo(x + 1.5, y - 46);
      ctx.lineTo(x + 7, y - 34);
      ctx.closePath();
      ctx.fill();
      break;
    case 'claws':
      ctx.strokeStyle = '#e8e4d8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 2, y + i * 5);
        ctx.lineTo(x + 11, y + i * 7 - 2);
        ctx.stroke();
      }
      break;
    case 'cannon':
      roundRect(ctx, x - 4, y - 8, 24, 12, 4, p.metal);
      ctx.fillStyle = shade(p.metal, -0.45);
      ctx.fillRect(x + 18, y - 6, 6, 8);
      break;
    case 'dagger':
      ctx.fillStyle = '#c8ccd4';
      ctx.fillRect(x, y - 14, 3, 20);
      break;
    case 'drill':
      ctx.fillStyle = p.metal;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 10);
      ctx.lineTo(x + 26, y);
      ctx.lineTo(x - 4, y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(p.metal, -0.4);
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 4 + i * 7, y - 7 + i * 1.6);
        ctx.lineTo(x - 4 + i * 7, y + 7 - i * 1.6);
        ctx.stroke();
      }
      break;
    case 'bomb':
      ellipse(ctx, x + 8, y - 2, 10, 10, '#2c3038');
      ctx.strokeStyle = '#c08a4f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 12);
      ctx.quadraticCurveTo(x + 14, y - 20, x + 20, y - 16);
      ctx.stroke();
      ellipse(ctx, x + 21, y - 16, 3, 3, '#ffb44a');
      break;
    case 'lantern':
      ctx.strokeStyle = p.metal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x + 8, y - 14);
      ctx.stroke();
      roundRect(ctx, x + 2, y - 12, 13, 15, 3, shade(p.trim, -0.1));
      ellipse(ctx, x + 8.5, y - 4, 5, 5, '#ffe9a8');
      break;
    case 'scythe':
      ctx.fillStyle = p.wood;
      ctx.fillRect(x, y - 34, 3, 46);
      ctx.strokeStyle = p.metal;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x - 14, y - 32, 18, -Math.PI * 0.15, Math.PI * 0.5);
      ctx.stroke();
      break;
    default:
      break;
  }
}

function drawAccessory(
  ctx: CanvasRenderingContext2D,
  kind: AccessoryKind,
  p: Palette,
  rig: Rig,
  swing: number,
): void {
  switch (kind) {
    case 'shield':
      roundRect(ctx, rig.torsoX - 16, rig.torsoY + 2 - swing * 4, 14, 21, 5, p.trim);
      roundRect(ctx, rig.torsoX - 13, rig.torsoY + 6 - swing * 4, 8, 13, 3, shade(p.trim, 0.35));
      break;
    case 'cape': {
      /*
       * Narrower than the torso and cut short.
       *
       * It used to be drawn a little *wider* than the torso and flared well
       * past its base, which on the broader body plans meant the cape was the
       * entire silhouette — a row of otherwise unrelated cards all read as the
       * same blue teardrop with a head on top.
       */
      const inset = rig.torsoW * 0.22;
      const drop = Math.min(14, rig.torsoH * 0.45);
      ctx.fillStyle = shade(p.trim, -0.25);
      ctx.beginPath();
      ctx.moveTo(rig.torsoX + inset, rig.torsoY + 2);
      ctx.lineTo(rig.torsoX + rig.torsoW - inset, rig.torsoY + 2);
      ctx.lineTo(rig.torsoX + rig.torsoW - inset * 0.4 + swing * 3, rig.torsoY + rig.torsoH + drop);
      ctx.lineTo(rig.torsoX + inset * 0.4 + swing * 3, rig.torsoY + rig.torsoH + drop);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'wings':
      // Drawn by the winged body plan itself; nothing extra to add.
      break;
    case 'banner':
      ctx.fillStyle = p.wood;
      ctx.fillRect(rig.torsoX - 8, rig.torsoY - 34, 3, 60);
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.moveTo(rig.torsoX - 5, rig.torsoY - 34);
      ctx.lineTo(rig.torsoX + 16, rig.torsoY - 29);
      ctx.lineTo(rig.torsoX - 5, rig.torsoY - 14);
      ctx.closePath();
      ctx.fill();
      break;
    case 'backpack':
      roundRect(ctx, rig.torsoX - 10, rig.torsoY + 4, 11, 20, 4, shade(p.body, -0.35));
      break;
    case 'halo':
      ctx.strokeStyle = shade(p.trim, 0.4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(rig.headX, rig.headY - rig.headR - 8, 15, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface PoseParams {
  phase: number;
  team: Team;
  tint: string;
  spec: ModelSpec;
  isHero: boolean;
  /**
   * How far through a swing the figure is, 0..1, or 0 for "walking".
   *
   * Units used to attack by sliding a few pixels toward whatever they were
   * hitting, which reads as a shove rather than a swing — the weapon never
   * moved relative to the body, so every fight looked like two statues
   * nudging each other. This drives the weapon arm.
   */
  strike: number;
}

function drawFigure(ctx: CanvasRenderingContext2D, pose: PoseParams): void {
  const S = SPRITE_SIZE;
  const cx = S / 2;
  const groundY = S - 8;
  const swing = Math.sin(pose.phase * Math.PI * 2);
  // A stride should visibly lift the body. Two pixels on a 96px sprite was
  // close enough to nothing that the figures read as gliding.
  const bob = Math.abs(Math.cos(pose.phase * Math.PI * 2)) * 4;

  /*
   * Swing arc: back fast, through slow, recover.
   *
   * `strike` runs 0..1 across the frames right after a blow lands. The first
   * fifth is the wind-up (weapon back), the rest is the follow-through, which
   * is what gives the motion a direction rather than a wobble.
   */
  const strikeAngle =
    pose.strike <= 0
      ? 0
      : pose.strike < 0.2
        ? -1.1 * (pose.strike / 0.2)
        : -1.1 + 2.5 * ((pose.strike - 0.2) / 0.8);
  const lean = pose.strike > 0 ? Math.sin(pose.strike * Math.PI) * 3 : 0;

  const palette: Palette = {
    body: pose.tint,
    dark: shade(pose.tint, -0.35),
    light: shade(pose.tint, 0.25),
    trim: TEAM_TRIM[pose.team],
    trimDark: TEAM_TRIM_DARK[pose.team],
    skin: '#e8b98a',
    metal: '#9aa2ae',
    wood: '#8f6b3f',
  };

  ctx.save();
  ctx.lineJoin = 'round';

  /*
   * Model scale and build proportion multiply, so a card already drawn large
   * (a Giant at 1.45) on a hulking build (another 1.34 wide) rendered at
   * nearly twice the size the 96px cell was laid out for and was cropped by
   * its own frame. Clamp the composite.
   */
  const buildSpread = BUILDS[pose.spec.build] ?? BUILDS.normal;
  const worstAxis = Math.max(buildSpread.w, buildSpread.h);
  const scale = Math.min(pose.spec.scale, 1.5 / worstAxis);
  ctx.translate(cx, groundY);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -groundY);

  const isStatic = pose.spec.body === 'structure';
  const bodyY = groundY - (isStatic ? 0 : bob);
  const bodyX = cx + lean;

  /*
   * Proportion is applied as a transform about the figure's feet, so one set
   * of plan geometry yields a gaunt version, a squat version and a hulking
   * version. The rig the plan returns is in its own unscaled space, so it has
   * to be mapped back out before the head, weapon and accessory — which are
   * drawn after the transform is lifted — can attach to it.
   */
  const build = BUILDS[pose.spec.build] ?? BUILDS.normal;
  ctx.save();
  ctx.translate(bodyX, bodyY);
  ctx.scale(build.w, build.h);
  ctx.translate(-bodyX, -bodyY);
  // Leaning into the blow moves the whole body, not just the arm.
  const raw = drawBody(ctx, pose.spec.body, palette, bodyX, bodyY, swing, pose.spec.trim);
  ctx.restore();

  const outX = (x: number): number => bodyX + (x - bodyX) * build.w;
  const outY = (y: number): number => bodyY + (y - bodyY) * build.h;
  const rig: Rig = {
    headX: outX(raw.headX),
    headY: outY(raw.headY),
    headR: raw.headR * ((build.w + build.h) / 2) * build.head,
    handX: outX(raw.handX),
    handY: outY(raw.handY),
    torsoX: outX(raw.torsoX),
    torsoY: outY(raw.torsoY),
    torsoW: raw.torsoW * build.w,
    torsoH: raw.torsoH * build.h,
  };

  // Accessories that sit behind the figure go first.
  if (pose.spec.accessory === 'cape' || pose.spec.accessory === 'banner') {
    drawAccessory(ctx, pose.spec.accessory, palette, rig, swing);
  }
  drawHead(ctx, pose.spec.head, palette, rig);

  /*
   * The weapon is rotated about the hand rather than redrawn per pose.
   *
   * One transform animates every weapon in the game — a sword arcs, a hammer
   * comes over the top, a bow tips down — instead of thirteen bespoke attack
   * drawings that would all have to be kept in step with their idle versions.
   */
  ctx.save();
  ctx.translate(rig.handX, rig.handY);
  ctx.rotate(strikeAngle);
  ctx.translate(-rig.handX, -rig.handY);
  drawWeapon(ctx, pose.spec.weapon, palette, rig, swing);
  ctx.restore();
  if (pose.spec.accessory !== 'cape' && pose.spec.accessory !== 'banner') {
    drawAccessory(ctx, pose.spec.accessory, palette, rig, swing);
  }

  // Champions get a crown regardless of model — the single most important
  // read in a fight is "is that the champion".
  if (pose.isHero && rig.headR > 0) {
    ctx.fillStyle = '#ffd84a';
    const x = rig.headX;
    const y = rig.headY - rig.headR;
    ctx.beginPath();
    ctx.moveTo(x - 11, y);
    ctx.lineTo(x - 7, y - 11);
    ctx.lineTo(x - 3, y - 3);
    ctx.lineTo(x + 1, y - 13);
    ctx.lineTo(x + 5, y - 3);
    ctx.lineTo(x + 9, y - 11);
    ctx.lineTo(x + 11, y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type Cell = HTMLCanvasElement;

const generatedCache = new Map<string, Cell[]>();
const strikeCache = new Map<string, Cell[]>();
const imageCache = new Map<string, HTMLImageElement | null>();

function makeCell(): { canvas: Cell; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for sprite generation');
  return { canvas, ctx };
}

function generatePoses(card: CardDefinition, team: Team): Cell[] {
  const spec = modelFor(card);
  const cells: Cell[] = [];
  for (let i = 0; i < POSE_COUNT; i++) {
    const { canvas, ctx } = makeCell();
    drawFigure(ctx, {
      phase: i / POSE_COUNT,
      team,
      tint: card.tint,
      spec,
      isHero: card.isHero,
      strike: 0,
    });
    cells.push(canvas);
  }
  return cells;
}

/**
 * The swing, rasterised once per card like the walk cycle.
 *
 * Held in its own cache rather than appended to the walk poses so the two can
 * be indexed independently — a unit mid-swing is still standing on whichever
 * foot it was standing on.
 */
function generateStrikePoses(card: CardDefinition, team: Team): Cell[] {
  const spec = modelFor(card);
  const cells: Cell[] = [];
  for (let i = 0; i < STRIKE_POSE_COUNT; i++) {
    const { canvas, ctx } = makeCell();
    drawFigure(ctx, {
      phase: 0,
      team,
      tint: card.tint,
      spec,
      isHero: card.isHero,
      strike: (i + 0.5) / STRIKE_POSE_COUNT,
    });
    cells.push(canvas);
  }
  return cells;
}

const isUrl = (key: string): boolean => /^(https?:)?\/\//.test(key) || key.startsWith('data:');

/**
 * Kick off a load for a card's external sprite, if it declares one.
 *
 * Failures are cached as null rather than retried: a broken URL should fall
 * back to generated art permanently, not re-request every frame.
 */
function externalImage(card: CardDefinition): HTMLImageElement | null {
  if (!card.spriteKey || !isUrl(card.spriteKey)) return null;

  const cached = imageCache.get(card.spriteKey);
  if (cached !== undefined) return cached;

  imageCache.set(card.spriteKey, null);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => imageCache.set(card.spriteKey, image);
  image.onerror = () => imageCache.set(card.spriteKey, null);
  image.src = card.spriteKey;
  return null;
}

/**
 * Draw a sprite, whether it is a standalone bitmap or one cell of an atlas.
 *
 * Every caller must go through this. Three places draw sprites and only one of
 * them was updated when atlases arrived, so buildings and the placement ghost
 * blitted the *entire* strip squashed into a unit-sized box — a rainbow smear
 * where a figure should be.
 */
export function blitSprite(
  ctx: CanvasRenderingContext2D,
  sprite: DrawnSprite,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (sprite.sx !== undefined && sprite.sy !== undefined) {
    ctx.drawImage(sprite.source, sprite.sx, sprite.sy, sprite.width, sprite.height, dx, dy, dw, dh);
  } else {
    ctx.drawImage(sprite.source, dx, dy, dw, dh);
  }
}

/**
 * Draw a figure standing on a point, sized by the figure rather than by its
 * cell.
 *
 * An atlas cell is wider and taller than the character in it: weapon arcs need
 * somewhere to go, so a mace swing that inks 92 pixels across sits in a 96px
 * cell around a 64px body. Sizing the blit by the cell would shrink every unit
 * by a third the moment the margin appeared, and anchoring the cell's bottom
 * edge to the ground would leave them all hovering. Callers pass the height
 * the *figure* should be and this places the cell around it.
 */
export function blitFigure(
  ctx: CanvasRenderingContext2D,
  sprite: DrawnSprite,
  centreX: number,
  groundY: number,
  figureHeight: number,
): void {
  const margin = sprite.margin ?? 1;
  const foot = sprite.footFrac ?? 1;
  const boxHeight = figureHeight * margin;
  const boxWidth = boxHeight * (sprite.width / sprite.height);
  blitSprite(ctx, sprite, centreX - boxWidth / 2, groundY - boxHeight * foot, boxWidth, boxHeight);
}

export interface DrawnSprite {
  source: CanvasImageSource;
  width: number;
  height: number;
  /**
   * Sub-rectangle to blit, when the source is an atlas rather than a
   * standalone bitmap. Absent for the procedurally generated figures, which
   * are one image per pose.
   */
  sx?: number;
  sy?: number;
  /** Cell height as a multiple of the figure's own height. 1 when they match. */
  margin?: number;
  /** Where in the cell the figure's feet sit, as a fraction of cell height. */
  footFrac?: number;
}

// ---------------------------------------------------------------------------
// Universal LPC character atlases
// ---------------------------------------------------------------------------

/**
 * Real character art, built from the Universal LPC Spritesheet collection.
 *
 * `scripts/lpc/build.ts` composites a body, head, garment, legs, team sash and
 * weapon into one strip per card per side; see `src/assets/characters/CREDITS.md`
 * for authorship and licensing. The procedural composer below is still the
 * fallback — a card with no atlas, or one whose image has not decoded yet, is
 * drawn exactly as it was before, so nothing ever renders as a blank.
 *
 * The strip is walk frames followed by strike frames, with the back-facing row
 * above the front-facing one. Which row a unit uses is decided by its side:
 * you watch your own troops march away from you and the enemy's march toward
 * you, which is both the convention of the genre and free directional art.
 */
const ATLAS_URLS = import.meta.glob('../assets/characters/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

interface AtlasMeta {
  walkFrames: number;
  strikeFrames: number;
}

const ATLAS_META: AtlasMeta = { walkFrames: 6, strikeFrames: 4 };

/**
 * Atlas cell geometry.
 *
 * LPC's base layers are 64px, but its weapons are not — a mace swing is
 * authored on a 192px grid centred on the same body — so cells carry a margin
 * and the figure occupies the middle `ATLAS_LOGICAL` of it. Keep these in step
 * with `CELL` and `LOGICAL` in `scripts/lpc/compose.mjs`.
 */
export const ATLAS_CELL = 96;
export const ATLAS_LOGICAL = 64;
const ATLAS_MARGIN = ATLAS_CELL / ATLAS_LOGICAL;
const ATLAS_FOOT = (ATLAS_CELL / 2 + ATLAS_LOGICAL / 2) / ATLAS_CELL;

const atlasByKey = new Map<string, string>();
for (const [path, url] of Object.entries(ATLAS_URLS)) {
  const file = path.split('/').pop() ?? '';
  atlasByKey.set(file.replace(/\.png$/, ''), url);
}

const atlasImages = new Map<string, HTMLImageElement | null>();

/**
 * The decoded atlas for a card, or null until it is ready.
 *
 * One atlas serves both sides. Team used to be baked in as a coloured sash,
 * which doubled the payload of the single largest thing in the build for a
 * detail three pixels wide; allegiance is now a ring on the ground, drawn by
 * the entity renderer.
 */
function atlasFor(card: CardDefinition): HTMLImageElement | null {
  const key = card.modelId;
  if (!atlasByKey.has(key)) return null;

  const cached = atlasImages.get(key);
  if (cached !== undefined) return cached && cached.complete && cached.naturalWidth > 0 ? cached : null;

  if (typeof Image === 'undefined') {
    atlasImages.set(key, null);
    return null;
  }
  const img = new Image();
  img.src = atlasByKey.get(key) as string;
  atlasImages.set(key, img);
  return null;
}

/** True when this card has real character art available. */
export function hasAtlas(card: CardDefinition): boolean {
  return atlasByKey.has(card.modelId);
}

/** Kick off decoding for every atlas a match can use. */
export function warmAtlases(cards: readonly CardDefinition[]): void {
  for (const card of cards) atlasFor(card);
}

/**
 * Rasterise a card's figures ahead of time, for both sides.
 *
 * Poses are generated lazily on first use, which means the first time a card
 * appears the frame that draws it also rasterises its whole walk cycle, and the
 * first time it swings, its whole strike cycle — synchronously, inside the
 * animation callback. On a fresh card that was a visible hitch at exactly the
 * moment you were watching it arrive.
 *
 * Called once as a match starts, so every card in play is already resident
 * before it can be deployed. Cheap to call repeatedly: generation is
 * cache-guarded, so a warmed card costs a map lookup.
 */
export function warmSprites(cards: readonly CardDefinition[]): void {
  for (const card of cards) {
    if (!card.modelId) continue;
    for (const team of [0, 1] as const) {
      const key = `${card.id}|${team}`;
      if (!generatedCache.has(key)) generatedCache.set(key, generatePoses(card, team));
      if (!strikeCache.has(key)) strikeCache.set(key, generateStrikePoses(card, team));
    }
  }
}

/**
 * The bitmap to blit for a unit this frame.
 *
 * `phase` is the walk-cycle position in 0..1; callers derive it from the
 * simulation tick so animation speed follows movement speed.
 */
export function spriteFor(
  card: CardDefinition,
  team: Team,
  phase: number,
  strike = 0,
): DrawnSprite {
  const external = externalImage(card);
  if (external) {
    return { source: external, width: external.width, height: external.height };
  }

  /*
   * Real character art first.
   *
   * The atlas holds `walkFrames` walk poses followed by `strikeFrames` strike
   * poses, back row above front row. A unit shows its back on the near side
   * and its face on the far side, which is what the team index selects.
   */
  const atlas = atlasFor(card);
  if (atlas) {
    const { walkFrames, strikeFrames } = ATLAS_META;
    const column =
      strike > 0
        ? walkFrames + Math.min(strikeFrames - 1, Math.max(0, Math.floor(strike * strikeFrames)))
        : Math.min(walkFrames - 1, Math.max(0, Math.floor(phase * walkFrames)));
    return {
      source: atlas,
      width: ATLAS_CELL,
      height: ATLAS_CELL,
      sx: column * ATLAS_CELL,
      sy: team === 0 ? 0 : ATLAS_CELL,
      margin: ATLAS_MARGIN,
      footFrac: ATLAS_FOOT,
    };
  }

  const key = `${card.id}|${team}`;

  if (strike > 0) {
    let poses = strikeCache.get(key);
    if (!poses) {
      poses = generateStrikePoses(card, team);
      strikeCache.set(key, poses);
    }
    const index = Math.min(STRIKE_POSE_COUNT - 1, Math.max(0, Math.floor(strike * STRIKE_POSE_COUNT)));
    return { source: poses[index], width: SPRITE_SIZE, height: SPRITE_SIZE };
  }

  let poses = generatedCache.get(key);
  if (!poses) {
    poses = generatePoses(card, team);
    generatedCache.set(key, poses);
  }

  const index = Math.min(POSE_COUNT - 1, Math.max(0, Math.floor(phase * POSE_COUNT)));
  return { source: poses[index], width: SPRITE_SIZE, height: SPRITE_SIZE };
}

/** Drop every cached bitmap. Used when a runtime card's art changes. */
export function clearSpriteCache(): void {
  generatedCache.clear();
  strikeCache.clear();
  imageCache.clear();
  portraitCache.clear();
}

/** A standalone portrait for the deck builder and Card Maker preview. */
export function portraitFor(card: CardDefinition, team: Team = 0): HTMLCanvasElement {
  const { canvas, ctx } = makeCell();
  drawFigure(ctx, { phase: 0, team, tint: card.tint, spec: modelFor(card), isHero: card.isHero, strike: 0 });
  return canvas;
}

/**
 * The card's real character art, addressed as a CSS background.
 *
 * Card faces were rasterising the procedural fallback figure into a data URL
 * even for cards that had a proper atlas, so the hand and the deck builder
 * showed a different — and much cruder — creature than the board did. They
 * also paid for it: rasterising four hundred portraits on the main thread is
 * seconds of frozen UI when the collection opens.
 *
 * Neither is necessary. The atlas is already a decoded image the browser has
 * in memory, and one cell of it is a portrait. Handing back the URL and the
 * grid lets CSS do the cropping, which costs nothing and is always in step
 * with what the unit looks like in play.
 *
 * The front-facing row, because a portrait should look at you.
 */
export interface AtlasPortrait {
  url: string;
  /** Background size and position, as percentages, for a one-cell crop. */
  size: string;
  position: string;
}

export function atlasPortrait(card: CardDefinition): AtlasPortrait | null {
  return atlasPortraitFor(card.modelId);
}

/**
 * The same crop, addressed by model rather than by card.
 *
 * The Card Maker needs to show what a figure looks like before any card is
 * wearing it — you cannot pick an appearance from a list of names.
 */
export function atlasPortraitFor(modelId: string): AtlasPortrait | null {
  const url = atlasByKey.get(modelId);
  if (!url) return null;
  const cols = ATLAS_META.walkFrames + ATLAS_META.strikeFrames;
  return { url, size: `${cols * 100}% 200%`, position: '0% 100%' };
}

/** Every model the build produced art for, for the Card Maker's picker. */
export function drawableModelIds(): string[] {
  return [...atlasByKey.keys()].sort();
}

const portraitCache = new Map<string, string>();

/**
 * The card's figure as a data URL, for use as ordinary card art in the DOM.
 *
 * Card faces were a flat tint and a name, so nothing in the hand, the deck
 * builder or the collection told you what a card actually puts on the board —
 * you had to play it to find out. The figures already existed; they were only
 * ever drawn into the arena canvas.
 *
 * A data URL rather than a live canvas because card faces are rendered by
 * React in dozens of places at once, and an `<img>` costs nothing to mount,
 * unmount and re-mount. Rasterising is the expensive half, so it happens once
 * per card and is cached for the session.
 */
export function portraitDataUrl(card: CardDefinition, team: Team = 0): string {
  const key = `${card.id}|${team}`;
  const cached = portraitCache.get(key);
  if (cached !== undefined) return cached;

  let url = '';
  try {
    url = portraitFor(card, team).toDataURL();
  } catch {
    // No canvas (a test environment, or a tainted context). Card faces fall
    // back to their tint, which is what they looked like before.
  }
  portraitCache.set(key, url);
  return url;
}
