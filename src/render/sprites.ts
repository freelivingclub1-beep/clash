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
  MODELS,
} from './models';

export const SPRITE_SIZE = 96;
export const POSE_COUNT = 6;

export type Team = 0 | 1;

const TEAM_TRIM: Record<Team, string> = { 0: '#4a9eff', 1: '#ff6b5b' };
const TEAM_TRIM_DARK: Record<Team, string> = { 0: '#1b4f8a', 1: '#8a2f24' };

/** Fallback body plan when a card names no model, derived from its stats. */
export function fallbackModel(card: CardDefinition): ModelSpec {
  if (card.category === 'Building' || card.category === 'TowerTroop') {
    return { body: 'structure', head: 'none', weapon: 'cannon', accessory: 'none', scale: 1 };
  }
  if (card.isFlying) {
    return { body: 'winged', head: 'beak', weapon: 'claws', accessory: 'wings', scale: 0.9 };
  }
  if (card.attackRange >= 3) {
    return { body: 'humanoid', head: 'hood', weapon: 'bow', accessory: 'none', scale: 0.9 };
  }
  return { body: 'humanoid', head: 'helm', weapon: 'sword', accessory: 'none', scale: 1 };
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
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 15, top + 13, 30, 5);
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
      ctx.fillStyle = p.trim;
      ctx.fillRect(cx - 22, top + 18, 44, 6);
      roundRect(ctx, cx - 32, top + 2 - swing * 4, 11, 30, 5, shade(p.body, -0.15));
      roundRect(ctx, cx + 21, top + 2 + swing * 4, 11, 30, 5, shade(p.body, -0.15));
      return { headX: cx, headY: top - 8, headR: 14, handX: cx + 27, handY: top + 26, torsoX: cx - 22, torsoY: top, torsoW: 44, torsoH: 36 };
    }

    case 'golem': {
      // Stacked slabs with visible seams — reads as stone, not flesh.
      roundRect(ctx, cx - 18, groundY - 18, 14, 18, 3, p.dark);
      roundRect(ctx, cx + 4, groundY - 18, 14, 18, 3, p.dark);
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
      roundRect(ctx, cx - 30, top + 4, 10, 26, 3, shade(p.body, 0.1));
      roundRect(ctx, cx + 20, top + 4, 10, 26, 3, shade(p.body, 0.1));
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
    case 'cape':
      ctx.fillStyle = shade(p.trim, -0.25);
      ctx.beginPath();
      ctx.moveTo(rig.torsoX + 2, rig.torsoY + 2);
      ctx.lineTo(rig.torsoX + rig.torsoW - 2, rig.torsoY + 2);
      ctx.lineTo(rig.torsoX + rig.torsoW + 4 + swing * 4, rig.torsoY + rig.torsoH + 16);
      ctx.lineTo(rig.torsoX - 4 + swing * 4, rig.torsoY + rig.torsoH + 16);
      ctx.closePath();
      ctx.fill();
      break;
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
}

function drawFigure(ctx: CanvasRenderingContext2D, pose: PoseParams): void {
  const S = SPRITE_SIZE;
  const cx = S / 2;
  const groundY = S - 8;
  const swing = Math.sin(pose.phase * Math.PI * 2);
  const bob = Math.abs(Math.cos(pose.phase * Math.PI * 2)) * 2;

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

  const scale = pose.spec.scale;
  ctx.translate(cx, groundY);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -groundY);

  const isStatic = pose.spec.body === 'structure';
  const rig = drawBody(ctx, pose.spec.body, palette, cx, groundY - (isStatic ? 0 : bob), swing);

  // Accessories that sit behind the figure go first.
  if (pose.spec.accessory === 'cape' || pose.spec.accessory === 'banner') {
    drawAccessory(ctx, pose.spec.accessory, palette, rig, swing);
  }
  drawHead(ctx, pose.spec.head, palette, rig);
  drawWeapon(ctx, pose.spec.weapon, palette, rig, swing);
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

export interface DrawnSprite {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * The bitmap to blit for a unit this frame.
 *
 * `phase` is the walk-cycle position in 0..1; callers derive it from the
 * simulation tick so animation speed follows movement speed.
 */
export function spriteFor(card: CardDefinition, team: Team, phase: number): DrawnSprite {
  const external = externalImage(card);
  if (external) {
    return { source: external, width: external.width, height: external.height };
  }

  const key = `${card.id}|${team}`;
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
  imageCache.clear();
}

/** A standalone portrait for the deck builder and Card Maker preview. */
export function portraitFor(card: CardDefinition, team: Team = 0): HTMLCanvasElement {
  const { canvas, ctx } = makeCell();
  drawFigure(ctx, { phase: 0, team, tint: card.tint, spec: modelFor(card), isHero: card.isHero });
  return canvas;
}
