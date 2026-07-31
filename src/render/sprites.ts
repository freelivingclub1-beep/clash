/**
 * Unit artwork.
 *
 * Two sources, in priority order:
 *
 *   1. `card.spriteKey`, when it is a URL. The image is fetched at runtime and
 *      used directly, so any card can point at art hosted anywhere without a
 *      rebuild. This is the seam for real assets.
 *   2. A procedural character generator, used otherwise. It composes a figure
 *      — legs, torso, head, weapon, shield — from the card's own stats, so a
 *      card authored in the Card Maker has recognisable art the instant it
 *      exists, with nobody drawing anything.
 *
 * No third-party art is bundled. Shipping Clash Royale's actual textures would
 * be straightforward and also copyright infringement, and the two large CC0
 * asset hosts are blocked by this environment's network policy — so runtime
 * URLs are the honest seam rather than a vendored asset folder.
 *
 * Generated sprites are rasterised once into offscreen canvases and cached by
 * (card, team, pose). Redrawing a figure from primitives every frame for every
 * unit would dominate the frame budget; blitting a cached bitmap does not.
 */

import type { CardDefinition } from '@cards/schema';

/** Pixel size of a generated sprite cell. Scaled down at draw time. */
export const SPRITE_SIZE = 96;
/** Distinct walk poses baked per unit. */
export const POSE_COUNT = 6;

export type Team = 0 | 1;

const TEAM_TRIM: Record<Team, string> = { 0: '#4a9eff', 1: '#ff6b5b' };
const TEAM_TRIM_DARK: Record<Team, string> = { 0: '#1b4f8a', 1: '#8a2f24' };

/**
 * Visual archetype, derived from the card rather than authored.
 *
 * Deriving it means a new card is never art-less: the generator reads the same
 * fields the simulation does and produces a figure consistent with how the
 * card actually behaves.
 */
export type Archetype = 'tank' | 'melee' | 'ranged' | 'caster' | 'flier' | 'building' | 'swarm';

export function archetypeOf(card: CardDefinition): Archetype {
  if (card.category === 'Building' || card.category === 'TowerTroop') return 'building';
  if (card.isFlying) return 'flier';
  if (card.spawnCount >= 3) return 'swarm';
  if (card.splashRadius > 0 && card.attackRange >= 3) return 'caster';
  if (card.attackRange >= 3) return 'ranged';
  if (card.baseHealth >= 1500) return 'tank';
  return 'melee';
}

// ---------------------------------------------------------------------------
// Colour helpers
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

// ---------------------------------------------------------------------------
// Figure drawing
// ---------------------------------------------------------------------------

interface PoseParams {
  /** 0..1 around the walk cycle. */
  phase: number;
  team: Team;
  tint: string;
  archetype: Archetype;
  isHero: boolean;
}

/**
 * Draw one character into a 96x96 cell, feet at the bottom.
 *
 * The whole figure is built from primitives so it stays sharp at any scale and
 * costs nothing to ship. Limb swing is driven by `phase`, which is what makes
 * a walking unit read as walking rather than sliding.
 */
function drawFigure(ctx: CanvasRenderingContext2D, p: PoseParams): void {
  const S = SPRITE_SIZE;
  const cx = S / 2;
  const groundY = S - 8;
  const swing = Math.sin(p.phase * Math.PI * 2);
  const bob = Math.abs(Math.cos(p.phase * Math.PI * 2)) * 2;

  const body = p.tint;
  const bodyDark = shade(body, -0.35);
  const bodyLight = shade(body, 0.25);
  const trim = TEAM_TRIM[p.team];
  const trimDark = TEAM_TRIM_DARK[p.team];
  const skin = '#e8b98a';

  ctx.save();
  ctx.lineJoin = 'round';

  if (p.archetype === 'building') {
    // Structures: a plinth, a body, and crenellations. No limbs, no bob.
    roundRect(ctx, cx - 26, groundY - 14, 52, 14, 4, shade(body, -0.45));
    roundRect(ctx, cx - 22, groundY - 54, 44, 42, 6, body);
    roundRect(ctx, cx - 16, groundY - 48, 32, 14, 3, shade(body, 0.3));
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = bodyDark;
      ctx.fillRect(cx - 22 + i * 12, groundY - 60, 8, 8);
    }
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 22, groundY - 20, 44, 5);
    ctx.restore();
    return;
  }

  const scale = p.archetype === 'tank' ? 1.15 : p.archetype === 'swarm' ? 0.78 : 1;
  ctx.translate(cx, groundY);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -groundY);

  const hover = p.archetype === 'flier' ? 14 + swing * 3 : 0;
  const baseY = groundY - hover - bob;

  // --- legs (or wings, for a flier) ---
  if (p.archetype === 'flier') {
    const wingSpread = 18 + swing * 8;
    ellipse(ctx, cx - wingSpread, baseY - 34, 16, 8, shade(body, 0.35));
    ellipse(ctx, cx + wingSpread, baseY - 34, 16, 8, shade(body, 0.35));
  } else {
    const legSwing = swing * 6;
    ctx.fillStyle = bodyDark;
    roundRect(ctx, cx - 11 + legSwing, baseY - 20, 9, 20, 4, bodyDark);
    roundRect(ctx, cx + 2 - legSwing, baseY - 20, 9, 20, 4, bodyDark);
    // Boots pick up the team colour so allegiance reads at a glance.
    roundRect(ctx, cx - 12 + legSwing, baseY - 6, 11, 6, 3, trimDark);
    roundRect(ctx, cx + 1 - legSwing, baseY - 6, 11, 6, 3, trimDark);
  }

  // --- torso ---
  const torsoTop = baseY - 46;
  roundRect(ctx, cx - 15, torsoTop, 30, 28, 8, body);
  roundRect(ctx, cx - 15, torsoTop, 30, 10, 6, bodyLight);
  // Team sash.
  ctx.fillStyle = trim;
  ctx.fillRect(cx - 15, torsoTop + 13, 30, 5);

  // --- head ---
  const headY = torsoTop - 12;
  ellipse(ctx, cx, headY, 12, 12, skin);
  // Helmet, shaped by archetype.
  if (p.archetype === 'tank' || p.archetype === 'melee') {
    ctx.fillStyle = shade(trim, -0.15);
    ctx.beginPath();
    ctx.arc(cx, headY, 12, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 12, headY - 1, 24, 4);
  } else if (p.archetype === 'caster') {
    // Pointed hat.
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(cx - 14, headY - 6);
    ctx.lineTo(cx, headY - 30);
    ctx.lineTo(cx + 14, headY - 6);
    ctx.closePath();
    ctx.fill();
  } else if (p.archetype === 'ranged') {
    // Hood.
    ctx.fillStyle = shade(body, -0.2);
    ctx.beginPath();
    ctx.arc(cx, headY - 2, 13, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
  }
  // Eyes — two dots is all it takes for a figure to face the viewer.
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(cx - 5, headY + 1, 3, 4);
  ctx.fillRect(cx + 2, headY + 1, 3, 4);

  // --- arms and weapon ---
  const armSwing = swing * 5;
  ctx.fillStyle = shade(body, -0.15);
  roundRect(ctx, cx - 20, torsoTop + 4 - armSwing, 7, 18, 3, shade(body, -0.15));
  roundRect(ctx, cx + 13, torsoTop + 4 + armSwing, 7, 18, 3, shade(body, -0.15));

  switch (p.archetype) {
    case 'tank':
      // Hammer.
      ctx.fillStyle = '#6b6f78';
      ctx.fillRect(cx + 17, torsoTop - 14 + armSwing, 4, 30);
      roundRect(ctx, cx + 11, torsoTop - 22 + armSwing, 17, 12, 3, '#8f959f');
      // Shield on the off hand.
      roundRect(ctx, cx - 30, torsoTop + 2 - armSwing, 14, 20, 5, trim);
      roundRect(ctx, cx - 27, torsoTop + 6 - armSwing, 8, 12, 3, shade(trim, 0.35));
      break;
    case 'melee':
      // Sword.
      ctx.fillStyle = '#d8dce4';
      ctx.fillRect(cx + 18, torsoTop - 20 + armSwing, 4, 34);
      ctx.fillStyle = '#8f6b3f';
      ctx.fillRect(cx + 15, torsoTop + 12 + armSwing, 10, 4);
      break;
    case 'ranged':
      // Bow.
      ctx.strokeStyle = '#8f6b3f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx + 20, torsoTop + 8, 16, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.stroke();
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 28, torsoTop - 5);
      ctx.lineTo(cx + 28, torsoTop + 21);
      ctx.stroke();
      break;
    case 'caster':
      // Staff with a glowing head.
      ctx.fillStyle = '#8f6b3f';
      ctx.fillRect(cx + 19, torsoTop - 24 + armSwing, 4, 40);
      ellipse(ctx, cx + 21, torsoTop - 26 + armSwing, 7, 7, shade(trim, 0.4));
      ellipse(ctx, cx + 21, torsoTop - 26 + armSwing, 4, 4, '#ffffff');
      break;
    case 'swarm':
      ctx.fillStyle = '#c8ccd4';
      ctx.fillRect(cx + 17, torsoTop - 10 + armSwing, 3, 24);
      break;
    default:
      break;
  }

  // Champions get a crown. It is the single most important read in a fight.
  if (p.isHero) {
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.moveTo(cx - 11, headY - 12);
    ctx.lineTo(cx - 7, headY - 22);
    ctx.lineTo(cx - 3, headY - 14);
    ctx.lineTo(cx + 1, headY - 24);
    ctx.lineTo(cx + 5, headY - 14);
    ctx.lineTo(cx + 9, headY - 22);
    ctx.lineTo(cx + 11, headY - 12);
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
  const archetype = archetypeOf(card);
  const cells: Cell[] = [];
  for (let i = 0; i < POSE_COUNT; i++) {
    const { canvas, ctx } = makeCell();
    drawFigure(ctx, {
      phase: i / POSE_COUNT,
      team,
      tint: card.tint,
      archetype,
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

/** Drop every cached bitmap. Used when a runtime card's tint changes. */
export function clearSpriteCache(): void {
  generatedCache.clear();
  imageCache.clear();
}

/** A standalone portrait for the deck builder and Card Maker preview. */
export function portraitFor(card: CardDefinition, team: Team = 0): HTMLCanvasElement {
  const { canvas, ctx } = makeCell();
  drawFigure(ctx, {
    phase: 0,
    team,
    tint: card.tint,
    archetype: archetypeOf(card),
    isHero: card.isHero,
  });
  return canvas;
}
