/**
 * Entity rendering.
 *
 * Figures come from `./sprites`, which either loads a card's declared sprite
 * URL or generates a character procedurally from the card's own stats. Either
 * way a card authored in the Card Maker has usable art the moment it exists.
 *
 * Everything animated here is derived from simulation state — walk phase from
 * speed and tick, spawn scale from the deploy timer, lunge from attack
 * cooldown — so the renderer never holds animation state of its own and can be
 * torn down and rebuilt mid-match without a visual glitch.
 *
 * Draw order is back-to-front by screen Y so overlapping units stack the way
 * the eye expects.
 */

import { tryGetCard } from '@cards/registry';
import type { CardDefinition } from '@cards/schema';
import { fxToFloat } from '@sim/math/fixed';
import { TOWER_LAYOUTS } from '@sim/nav/grid';
import { DAMAGE_RAMP_STACK_CAP, PROJECTILE_SPEED, TICK_HZ } from '@sim/constants';
import type { Entity, MatchState, Team } from '@sim/types';
import type { MatchRunner } from '@game/match';
import { TILE_W, TILE_H, tileToLogical } from './camera';
import { blitFigure, modelFor, spriteFor } from './sprites';
import {
  EFFECT_FRAMES,
  drawEffectFrame,
  effectSheet,
  type EffectName,
} from './effectSprites';
import { type Element, ELEMENT_LOOKS, elementOf } from './elements';
import { texturePattern } from './textures';

/** Ticks a swing animation plays for, regardless of the card's reload. */
const STRIKE_TICKS = 8;

const TEAM_COLOURS: Record<Team, { primary: string; dark: string }> = {
  0: { primary: '#4a9eff', dark: '#1b4f8a' },
  1: { primary: '#ff6b5b', dark: '#8a2f24' },
};

/**
 * Frame index for an effect looping continuously, from the animation clock.
 *
 * Status tells used to be flat rectangles of translucent colour laid over the
 * figure — a blue wash for frozen, a green one for poisoned. They said the
 * right thing and looked like nothing, which is the complaint that started
 * this work. A looping animation says the same thing and looks authored.
 */
function loopFrame(tick: number, cyclesPerSecond: number): number {
  const phase = ((tick / TICK_HZ) * cyclesPerSecond) % 1;
  return Math.floor(((phase + 1) % 1) * EFFECT_FRAMES);
}

/** Play one frame of a looping effect over a point, additively. */
function overlay(
  ctx: CanvasRenderingContext2D,
  name: EffectName,
  x: number,
  y: number,
  size: number,
  tick: number,
  opts: { rate?: number; alpha?: number } = {},
): boolean {
  const sheet = effectSheet(name);
  if (!sheet) return false;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = opts.alpha ?? 0.85;
  drawEffectFrame(ctx, sheet, loopFrame(tick, opts.rate ?? 1.4), x, y, size);
  ctx.restore();
  return true;
}

/**
 * The coloured disc a unit stands on.
 *
 * Two rings rather than one filled ellipse: a soft inner wash so the figure
 * sits in a pool of its own colour, and a brighter rim so the shape survives
 * against grass, stone and the river alike. Drawn under the figure, never over
 * it, so a scrum of bodies stays legible.
 */
function teamRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  team: Team,
): void {
  const colours = TEAM_COLOURS[team];
  const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
  wash.addColorStop(0, team === 0 ? 'rgba(74,158,255,0.55)' : 'rgba(255,107,91,0.55)');
  wash.addColorStop(0.7, team === 0 ? 'rgba(74,158,255,0.3)' : 'rgba(255,107,91,0.3)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colours.primary;
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function healthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  fraction: number,
  team: Team,
): void {
  const height = 8;
  const clamped = Math.max(0, Math.min(1, fraction));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - width / 2 - 2, y - 2, width + 4, height + 4);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - width / 2, y, width, height);
  ctx.fillStyle = TEAM_COLOURS[team].primary;
  ctx.fillRect(x - width / 2, y, width * clamped, height);
}

/**
 * Walk-cycle phase for a unit.
 *
 * Driven by the unit's own speed, so a Very Fast troop visibly strides faster
 * than a Slow one, and a stationary unit holds a pose instead of marching on
 * the spot. Offset by entity id so a spawned group does not move in lockstep
 * like a single organism.
 *
 * `tick` here is *fractional* — the simulation tick plus the renderer's
 * interpolation alpha. It used to be the integer tick, which meant bodies slid
 * between positions smoothly while their legs snapped forward only 30 times a
 * second. That mismatch is what read as "the models aren't animated": the
 * translation was already interpolated, the animation driving it was not.
 */
function walkPhase(entity: Entity, tick: number): number {
  const moving = entity.stepX !== 0 || entity.stepY !== 0;
  if (!moving || entity.freezeTicks > 0 || entity.stunTicks > 0) return 0;
  const speed = Math.max(0.02, fxToFloat(entity.speed));
  const cyclesPerTick = speed * 3.2;
  return ((tick * cyclesPerTick + entity.id * 0.37) % 1 + 1) % 1;
}

function drawTroop(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
  tick: number,
): void {
  const card = tryGetCard(entity.cardId);
  if (!card) return;

  /*
   * A tunneller is genuinely absent while it digs — no figure, no shadow, no
   * spawn ring. Drawing anything at all, even the scale-up other units get,
   * would give away the one thing the card is paying for.
   */
  if (card.passiveId === 'tunnel' && entity.deployTimer > 0) return;

  const radius = Math.max(10, fxToFloat(entity.radius) * TILE_W);

  // Flying units are lifted off the ground with their shadow left behind, so
  // air and ground stay distinguishable at a glance.
  const lift = entity.flying ? TILE_H * 0.9 : 0;

  ctx.save();

  // Spawn animation: the figure scales up out of the ground over its deploy
  // freeze, which makes the (very real) placement delay legible.
  const deployTotal = 30;
  const spawnProgress =
    entity.deployTimer > 0 ? 1 - entity.deployTimer / deployTotal : 1;
  const spawnScale = 0.4 + 0.6 * Math.max(0, Math.min(1, spawnProgress));

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(screenX, screenY, radius * 0.9 * spawnScale, radius * 0.45 * spawnScale, 0, 0, Math.PI * 2);
  ctx.fill();

  /*
   * Allegiance ring.
   *
   * The character art used to be built twice, once with a blue sash and once
   * with a red one, which doubled the largest asset in the game so that a
   * three-pixel band could say whose side a unit was on. It never read at
   * phone size anyway. A ring on the ground does — it is the convention of the
   * genre for exactly this reason — and it costs nothing to draw.
   */
  teamRing(ctx, screenX, screenY, radius * 0.95 * spawnScale, entity.team);

  if (entity.invisibleTicks > 0) ctx.globalAlpha = 0.35;

  /*
   * Strike phase, from how long ago the last blow landed.
   *
   * `attackCooldown` is set to the full reload the instant a blow lands and
   * counts down, so ticks-since-swing is the difference. The animation runs
   * over the first `STRIKE_TICKS` of that, whatever the card's reload — a
   * Mini P.E.K.K.A. with a 1.6s cooldown should not swing in slow motion.
   */
  const reload = Math.max(1, Math.round(card.hitSpeed * TICK_HZ));
  const sinceSwing = entity.windupDone ? reload - entity.attackCooldown : reload;
  const strike =
    entity.attackCooldown > 0 && sinceSwing >= 0 && sinceSwing < STRIKE_TICKS
      ? Math.min(0.999, (sinceSwing + 0.5) / STRIKE_TICKS)
      : 0;

  const sprite = spriteFor(card, entity.team, walkPhase(entity, tick), strike);
  // Sprites stand on a point, so the draw box is anchored to the entity's
  // ground position rather than centred on it. `drawHeight` is the height of
  // the *figure*; an atlas cell is larger, to leave room for weapon arcs, and
  // `blitFigure` places the cell around the figure.
  const drawHeight = radius * 4.2 * spawnScale;
  const drawWidth = drawHeight;
  const footY = screenY - lift;

  // The lunge rides on top of the swing rather than replacing it: the arm
  // arcs, and the body follows it a few pixels toward the target.
  const lungeStrength = strike > 0 ? Math.sin(strike * Math.PI) : 0;
  const facingLength = Math.hypot(fxToFloat(entity.faceX), fxToFloat(entity.faceY)) || 1;
  const lungeX = (fxToFloat(entity.faceX) / facingLength) * lungeStrength * radius * 0.45;
  const lungeY = (fxToFloat(entity.faceY) / facingLength) * lungeStrength * radius * 0.25;

  blitFigure(ctx, sprite, screenX + lungeX, footY - lungeY, drawHeight);

  ctx.globalAlpha = 1;

  const topY = footY - drawHeight;

  // Evolved units get a bright halo — the clearest tell available in a fight.
  if (entity.evolved) {
    if (!overlay(ctx, 'protectioncircle', screenX, screenY, drawHeight * 0.95, tick, { rate: 0.8, alpha: 0.8 })) {
      ctx.strokeStyle = '#ffd84a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, radius * 1.15, radius * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /*
   * Armour is worn, not orbited.
   *
   * The tell used to be a blue ellipse around the whole figure, which read as
   * a magic bubble and — on a three-body card where each unit tracks its own
   * plate — was hard to attribute to a particular body in a scrum. A plate
   * strapped across the chest sits *on* the unit, so at a glance you can see
   * which of the pack still has armour and which is down to bare health.
   *
   * It comes off in `VfxSystem`, which turns the `shieldBreak` event into
   * shards flung from this same spot.
   */
  if (entity.shield > 0) {
    /*
     * Half-height on the body, not up by the head.
     *
     * One constant has to suit a humanoid chest and a quadruped's back, and
     * the first attempt at 0.62 sat above both — the plates read as floating
     * over the pack rather than strapped to it. Mid-body works for either
     * silhouette.
     */
    const plateWidth = drawWidth * 0.48;
    const plateHeight = Math.max(3, drawHeight * 0.12);
    const plateX = screenX - plateWidth / 2;
    const plateY = footY - drawHeight * 0.5;

    const sheen = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateHeight);
    sheen.addColorStop(0, '#eaf4ff');
    sheen.addColorStop(0.45, '#9fc4e6');
    sheen.addColorStop(1, '#5c7d9c');
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.roundRect(plateX, plateY, plateWidth, plateHeight, plateHeight * 0.35);
    ctx.fill();

    ctx.strokeStyle = 'rgba(20,32,46,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Two rivets, so the plate reads as bolted metal rather than a bar.
    const rivet = Math.max(1, plateHeight * 0.16);
    ctx.fillStyle = 'rgba(30,44,60,0.9)';
    for (const side of [0.22, 0.78]) {
      ctx.beginPath();
      ctx.arc(plateX + plateWidth * side, plateY + plateHeight / 2, rivet, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /*
   * Status tells, drawn over the figure so they are never hidden by it.
   *
   * Each is a real animation now. The flat translucent rectangles they replace
   * were legible and completely inert — a frozen unit and a poisoned one
   * differed by a hue and nothing else, and neither looked like anything was
   * happening to them. The fills stay as the fallback for the moment before an
   * effect sheet has decoded, so a status is never invisible.
   */
  const midY = footY - drawHeight * 0.5;
  if (entity.freezeTicks > 0 || entity.stunTicks > 0) {
    if (!overlay(ctx, 'freezing', screenX, midY, drawHeight * 1.15, tick, { rate: 1.1, alpha: 0.7 })) {
      ctx.fillStyle = 'rgba(140,220,255,0.35)';
      ctx.fillRect(screenX - drawWidth / 2, topY, drawWidth, drawHeight);
    }
  }
  if (entity.rageTicks > 0) {
    if (!overlay(ctx, 'magic8', screenX, midY, drawHeight * 1.2, tick, { rate: 2.0, alpha: 0.75 })) {
      ctx.strokeStyle = 'rgba(224,91,213,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, radius * 1.3, radius * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (entity.poisonTicks > 0) {
    if (!overlay(ctx, 'felspell', screenX, midY, drawHeight * 1.05, tick, { rate: 0.9, alpha: 0.6 })) {
      ctx.fillStyle = 'rgba(120,200,90,0.28)';
      ctx.fillRect(screenX - drawWidth / 2, topY, drawWidth, drawHeight);
    }
  }
  // A charge is a threat you are meant to see coming, so it burns at the feet
  // rather than over the body — visible even when the figure is in a scrum.
  if (entity.charging) {
    overlay(ctx, 'firespin', screenX, screenY, drawHeight * 0.85, tick, { rate: 2.6, alpha: 0.8 });
  }

  // Ramp tell. A unit whose damage or rate of fire is multiplying has to show
  // it, or the opponent has no cue that the thing chewing on their tower is
  // about to hit five times harder — and no reason to reach for the reset
  // spell that answers it. The bar heats from amber to red as it saturates.
  if (
    entity.passiveCharges > 0 &&
    (card.passiveId === 'damage_ramp' || card.passiveId === 'attack_ramp')
  ) {
    const fill = Math.min(1, entity.passiveCharges / DAMAGE_RAMP_STACK_CAP);
    const width = radius * 2.2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(screenX - width / 2, topY - 21, width, 4);
    ctx.fillStyle = fill >= 1 ? '#ff4d3d' : `rgb(255, ${Math.round(190 - 120 * fill)}, 60)`;
    ctx.fillRect(screenX - width / 2, topY - 21, width * fill, 4);
  }

  if (entity.hp < entity.maxHp) {
    healthBar(ctx, screenX, topY - 14, radius * 2.2, entity.hp / entity.maxHp, entity.team);
  }

  ctx.restore();
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const card = tryGetCard(entity.cardId);
  if (!card) return;
  const size = Math.max(24, fxToFloat(entity.radius) * TILE_W * 2.4);

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(screenX, screenY, size * 0.5, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // A stone footing under every placed building, so it sits on the ground
  // rather than hovering over it.
  ctx.fillStyle = texturePattern(ctx, 'stone');
  ctx.fillRect(screenX - size * 0.42, screenY - 8, size * 0.84, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(screenX - size * 0.42, screenY, size * 0.84, 3);

  teamRing(ctx, screenX, screenY, size * 0.46, entity.team);

  const sprite = spriteFor(card, entity.team, 0);
  blitFigure(ctx, sprite, screenX, screenY, size);

  healthBar(ctx, screenX, screenY - size - 20, size * 1.1, entity.hp / entity.maxHp, entity.team);

  // Lifetime decay as a thin draining bar under the health bar.
  if (entity.lifetimeTicks > 0) {
    const card2 = tryGetCard(entity.cardId);
    const total = Math.max(1, Math.round((card2?.lifetimeSeconds ?? 1) * 30));
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(
      screenX - (size * 1.1) / 2,
      screenY - size - 8,
      size * 1.1 * (entity.lifetimeTicks / total),
      4,
    );
  }
}

/**
 * Crown towers: a textured stone keep on a stepped plinth, with battlements,
 * an arrow slit, a corner turret pair, a banner and a roof.
 *
 * Damage is shown structurally rather than only on the health bar — cracks
 * appear as the tower is worn down and the merlons break away, so the state of
 * the board is readable from the towers themselves.
 */
function drawTower(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const layout = TOWER_LAYOUTS[entity.towerIndex];
  const isKing = layout?.kind === 'king';
  const tiles = isKing ? 4 : 3;
  /*
   * King towers are drawn wide and squat, princess towers narrow and tall.
   *
   * Not a style choice: a king tower's footprint sits two tiles from the back
   * of the grid, so it has ~5 tiles of vertical room. Drawn at the princess
   * tower's proportions it was 6 tiles tall and the far one was sliced off by
   * the top of the field. Width carries the "this is the big one" read
   * instead, and it survives the clip.
   */
  const width = tiles * TILE_W * (isKing ? 0.8 : 0.68);
  const height = tiles * TILE_H * (isKing ? 1.0 : 1.45);
  const colours = TEAM_COLOURS[entity.team];
  const health = Math.max(0, Math.min(1, entity.hp / entity.maxHp));

  const footprintHalf = (tiles * TILE_H) / 2;
  const base = screenY + footprintHalf;
  const top = base - height;
  const left = screenX - width / 2;

  const stone = texturePattern(ctx, entity.team === 0 ? 'stoneBlue' : 'stoneRed');
  const plainStone = texturePattern(ctx, 'stone');

  ctx.save();

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(screenX, base, width * 0.62, TILE_H * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- stepped plinth ------------------------------------------------------
  ctx.fillStyle = plainStone;
  ctx.fillRect(left - 10, base - 14, width + 20, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(left - 10, base - 4, width + 20, 4);
  ctx.fillStyle = plainStone;
  ctx.fillRect(left - 5, base - 24, width + 10, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(left - 5, base - 24, width + 10, 2);

  // --- main keep -----------------------------------------------------------
  const bodyTop = top + 14;
  const bodyHeight = base - 22 - bodyTop;
  ctx.fillStyle = stone;
  ctx.fillRect(left, bodyTop, width, bodyHeight);

  // A dormant king tower is desaturated, which is how "not yet awake" reads.
  if (entity.dormant) {
    ctx.fillStyle = 'rgba(90,96,108,0.55)';
    ctx.fillRect(left, bodyTop, width, bodyHeight);
  }

  // Form shading: lit from the upper left.
  const shading = ctx.createLinearGradient(left, 0, left + width, 0);
  shading.addColorStop(0, 'rgba(255,255,255,0.16)');
  shading.addColorStop(0.45, 'rgba(255,255,255,0)');
  shading.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = shading;
  ctx.fillRect(left, bodyTop, width, bodyHeight);

  // --- battlements ---------------------------------------------------------
  const merlons = isKing ? 6 : 5;
  const merlonW = width / (merlons * 2 - 1);
  for (let i = 0; i < merlons; i++) {
    // Merlons break off as the tower is destroyed, from the outside in.
    const survival = 1 - Math.abs(i - (merlons - 1) / 2) / merlons;
    if (health < survival * 0.7) continue;
    ctx.fillStyle = stone;
    ctx.fillRect(left + i * merlonW * 2, bodyTop - 14, merlonW, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(left + i * merlonW * 2, bodyTop - 2, merlonW, 3);
  }

  // --- corner turrets ------------------------------------------------------
  // Drawn after the battlements: painted before, the merlons buried the caps
  // and the towers read as a plain box.
  const turretW = width * 0.22;
  for (const tx of [left - turretW * 0.5, left + width - turretW * 0.5]) {
    ctx.fillStyle = stone;
    const turretRise = isKing ? 10 : 20;
    ctx.fillRect(tx, bodyTop - turretRise, turretW, bodyHeight + turretRise);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(tx + turretW - 3, bodyTop - turretRise, 3, bodyHeight + turretRise);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(tx, bodyTop - turretRise, 3, bodyHeight + turretRise);

    // Conical cap in the team colour, the clearest allegiance read at range.
    ctx.fillStyle = entity.dormant ? '#5a606c' : colours.dark;
    const capPeak = bodyTop - turretRise - (isKing ? 16 : 24);
    ctx.beginPath();
    ctx.moveTo(tx - 5, bodyTop - turretRise);
    ctx.lineTo(tx + turretW / 2, capPeak);
    ctx.lineTo(tx + turretW + 5, bodyTop - turretRise);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(tx - 5, bodyTop - turretRise);
    ctx.lineTo(tx + turretW / 2, capPeak);
    ctx.lineTo(tx + turretW / 2, bodyTop - turretRise);
    ctx.closePath();
    ctx.fill();
  }

  // --- arrow slit ----------------------------------------------------------
  // A narrow arched window with a warm interior. The first version was a
  // full-height black bar, which read as a chimney rather than a window.
  const slitW = Math.max(4, width * 0.07);
  const slitH = bodyHeight * 0.2;
  const slitY = bodyTop + bodyHeight * 0.16;

  // Recessed surround, so the opening looks cut into the masonry.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(screenX - slitW, slitY - 3, slitW * 2, slitH + 6);

  ctx.fillStyle = 'rgba(12,14,20,0.92)';
  ctx.beginPath();
  ctx.moveTo(screenX - slitW / 2, slitY + slitH);
  ctx.lineTo(screenX - slitW / 2, slitY + slitW / 2);
  ctx.arc(screenX, slitY + slitW / 2, slitW / 2, Math.PI, 0);
  ctx.lineTo(screenX + slitW / 2, slitY + slitH);
  ctx.closePath();
  ctx.fill();

  // Lamplight inside, extinguished while a king tower is dormant.
  if (!entity.dormant) {
    ctx.fillStyle = colours.primary;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(screenX - slitW / 2 + 1, slitY + slitH - 5, slitW - 2, 4);
    ctx.globalAlpha = 1;
  }

  // --- banner --------------------------------------------------------------
  if (!entity.dormant) {
    const bannerH = bodyHeight * 0.34;
    ctx.fillStyle = colours.primary;
    ctx.beginPath();
    ctx.moveTo(screenX - width * 0.16, bodyTop + bodyHeight * 0.58);
    ctx.lineTo(screenX + width * 0.16, bodyTop + bodyHeight * 0.58);
    ctx.lineTo(screenX + width * 0.16, bodyTop + bodyHeight * 0.58 + bannerH);
    ctx.lineTo(screenX, bodyTop + bodyHeight * 0.58 + bannerH * 0.7);
    ctx.lineTo(screenX - width * 0.16, bodyTop + bodyHeight * 0.58 + bannerH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(screenX, bodyTop + bodyHeight * 0.58, width * 0.16, bannerH * 0.9);
  }

  // --- battle damage -------------------------------------------------------
  if (health < 0.75) {
    ctx.strokeStyle = 'rgba(20,16,14,0.75)';
    ctx.lineWidth = 2;
    const cracks = health < 0.35 ? 5 : health < 0.55 ? 3 : 2;
    for (let i = 0; i < cracks; i++) {
      // Deterministic layout: the same tower always cracks the same way, so
      // damage does not shimmer between frames.
      const seed = entity.towerIndex * 31 + i * 17;
      const sx = left + ((seed * 37) % 100) / 100 * width;
      const sy = bodyTop + ((seed * 53) % 100) / 100 * bodyHeight;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ((seed % 2 === 0 ? 1 : -1) * width) / 7, sy + bodyHeight / 5);
      ctx.lineTo(sx + ((seed % 3 === 0 ? -1 : 1) * width) / 10, sy + bodyHeight / 2.6);
      ctx.stroke();
    }
    // Scorching around the base as it nears collapse. A gradient rather than
    // a flat rectangle, which read as a solid overlay rather than as soot.
    if (health < 0.35) {
      const soot = ctx.createLinearGradient(0, bodyTop + bodyHeight * 0.45, 0, bodyTop + bodyHeight);
      soot.addColorStop(0, 'rgba(20,16,14,0)');
      soot.addColorStop(1, 'rgba(20,16,14,0.45)');
      ctx.fillStyle = soot;
      ctx.fillRect(left, bodyTop + bodyHeight * 0.45, width, bodyHeight * 0.55);
    }
  }

  ctx.restore();

  healthBar(ctx, screenX, bodyTop - (isKing ? 22 : 34), width * 1.15, health, entity.team);
}

/**
 * Projectile looks, keyed off the firing card's weapon.
 *
 * Every shot in the game used to be the same coloured dot, which meant a
 * Musketeer's bullet, a Wizard's fireball and a Bomber's bomb were visually
 * identical — the board told you something was in the air and nothing about
 * what. The model registry already knows what each card is holding, so the
 * shot can simply match the weapon that threw it.
 */
type ShotLook = 'arrow' | 'bolt' | 'ball' | 'spear' | 'bomb' | 'blade' | 'mote';

function shotLookFor(card: CardDefinition | undefined): ShotLook {
  if (!card) return 'mote';
  // A spell is thrown at a point rather than fired by a weapon.
  if (card.category === 'Spell') return 'bomb';
  switch (modelFor(card).weapon) {
    case 'bow':
      return 'arrow';
    case 'staff':
    case 'lantern':
      return 'bolt';
    case 'cannon':
    case 'drill':
      return 'ball';
    case 'spear':
      return 'spear';
    case 'bomb':
      return 'bomb';
    case 'dagger':
    case 'sword':
    case 'axe':
    case 'scythe':
      return 'blade';
    default:
      return 'mote';
  }
}

/** Lobbed shots travel in an arc and cast a shadow; flat ones fly straight. */
const LOBBED: ReadonlySet<ShotLook> = new Set<ShotLook>(['bomb', 'ball']);

/**
 * Cached corona for bolt-type shots.
 *
 * `drawProjectile` draws five trail ghosts plus the body, so every bolt in
 * flight was building six radial gradients a frame — ten bolts on screen meant
 * sixty gradient objects per frame, each one allocated and thrown away.
 *
 * Safe to cache because the gradient is defined at the origin in the *local*
 * space of an already-translated context, and a canvas gradient is resolved
 * against the transform in effect when it is used rather than when it is made.
 */
const boltGlowCache = new Map<string, CanvasGradient>();

function boltGlow(ctx: CanvasRenderingContext2D, tint: string, scale: number): CanvasGradient {
  const radius = 11 * scale;
  const key = `${tint}|${radius.toFixed(2)}`;
  let glow = boltGlowCache.get(key);
  if (!glow) {
    glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.35, tint);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    boltGlowCache.set(key, glow);
  }
  return glow;
}

/** Draws one shot body at the origin, pointing along +X. Caller sets transform. */
function drawShotBody(ctx: CanvasRenderingContext2D, look: ShotLook, tint: string, scale: number): void {
  ctx.lineCap = 'round';
  switch (look) {
    case 'arrow':
      ctx.strokeStyle = '#6b4b2a';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(-9 * scale, 0);
      ctx.lineTo(6 * scale, 0);
      ctx.stroke();
      // Head.
      ctx.fillStyle = '#d8dee8';
      ctx.beginPath();
      ctx.moveTo(11 * scale, 0);
      ctx.lineTo(4 * scale, -3 * scale);
      ctx.lineTo(4 * scale, 3 * scale);
      ctx.closePath();
      ctx.fill();
      // Fletching.
      ctx.strokeStyle = tint;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(-9 * scale, 0);
      ctx.lineTo(-5 * scale, -3 * scale);
      ctx.moveTo(-9 * scale, 0);
      ctx.lineTo(-5 * scale, 3 * scale);
      ctx.stroke();
      break;

    case 'spear':
      ctx.strokeStyle = '#8a6a42';
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.moveTo(-12 * scale, 0);
      ctx.lineTo(7 * scale, 0);
      ctx.stroke();
      ctx.fillStyle = '#cfd8e4';
      ctx.beginPath();
      ctx.moveTo(14 * scale, 0);
      ctx.lineTo(6 * scale, -2.5 * scale);
      ctx.lineTo(6 * scale, 2.5 * scale);
      ctx.closePath();
      ctx.fill();
      break;

    case 'bolt': {
      // Glowing core inside a soft corona, so magic reads as magic.
      ctx.fillStyle = boltGlow(ctx, tint, scale);
      ctx.beginPath();
      ctx.arc(0, 0, 11 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 3 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'ball':
      ctx.fillStyle = '#3a4150';
      ctx.beginPath();
      ctx.arc(0, 0, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(-2 * scale, -2 * scale, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'bomb':
      ctx.fillStyle = '#2b2f3a';
      ctx.beginPath();
      ctx.arc(0, 0, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a42';
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(3 * scale, -5 * scale);
      ctx.lineTo(7 * scale, -9 * scale);
      ctx.stroke();
      ctx.fillStyle = '#ffcf6b';
      ctx.beginPath();
      ctx.arc(8 * scale, -10 * scale, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'blade':
      ctx.fillStyle = '#d8dee8';
      ctx.beginPath();
      ctx.moveTo(9 * scale, 0);
      ctx.lineTo(-4 * scale, -2.5 * scale);
      ctx.lineTo(-6 * scale, 0);
      ctx.lineTo(-4 * scale, 2.5 * scale);
      ctx.closePath();
      ctx.fill();
      break;

    default:
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(0, 0, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
  }
}

function drawProjectile(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
  viewTeam: Team,
  tick: number,
): void {
  const card = tryGetCard(entity.cardId);
  const look = shotLookFor(card);
  /*
   * A shot is coloured by what it *is*, not by its owner's card art. Every
   * projectile used to be a small silhouette in the card's tint, so a wizard's
   * fireball and an archer's arrow differed only in outline and a shade of
   * paint — which is the whole reason the board read as "everyone shoots a
   * dot". The element decides the core, the body and the trail.
   */
  const el: Element = card ? elementOf(card) : 'steel';
  const glow = ELEMENT_LOOKS[el];
  const tint = glow.body;
  // Bigger shot for a bigger blast: a Fireball should not read like an arrow.
  const scale = entity.splashRadius > 0 ? 1.35 : 1;

  const heading = Math.atan2(fxToFloat(entity.faceY), fxToFloat(entity.faceX));
  const flightY = screenY - TILE_H * 0.6;

  /*
   * Flight progress, from the origin recorded at spawn. Lobbed shots use it
   * for a parabolic lift; every shot uses it to fade in the trail so a shot
   * that has only just left the barrel does not arrive with one already
   * stretched out behind it.
   */
  const totalX = fxToFloat(entity.destX - entity.originX);
  const totalY = fxToFloat(entity.destY - entity.originY);
  const total = Math.hypot(totalX, totalY);
  const doneX = fxToFloat(entity.x - entity.originX);
  const doneY = fxToFloat(entity.y - entity.originY);
  const progress = total > 0.01 ? Math.max(0, Math.min(1, Math.hypot(doneX, doneY) / total)) : 1;

  const lobbed = LOBBED.has(look);
  // Arc height scales with how far the shot has to travel, capped so a
  // cross-arena Fireball does not sail off the top of the screen.
  const arc = lobbed ? Math.min(52, total * 9) * Math.sin(progress * Math.PI) : 0;

  ctx.save();

  if (lobbed) {
    // The impact ring is a real readability win, not decoration: it is the
    // only way to see where a lobbed shot is going to land while it is still
    // in the air.
    const impact = tileToLogical(fxToFloat(entity.destX), fxToFloat(entity.destY), viewTeam);
    const radius = Math.max(10, fxToFloat(entity.splashRadius) * TILE_W);
    ctx.strokeStyle = 'rgba(255,190,110,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(impact.x, impact.y, radius, radius * (TILE_H / TILE_W), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Shadow on the ground beneath the shot, which is what sells the height.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, 5 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trail: ghosts stepped back along the heading, fading out. Positions are
  // derived from the constant flight speed rather than remembered, so nothing
  // has to be tracked frame to frame.
  const trailStep = fxToFloat(PROJECTILE_SPEED) * TILE_W;
  const trailCount = look === 'bolt' || look === 'mote' ? 5 : 3;
  for (let i = trailCount; i >= 1; i--) {
    const back = trailStep * i * 0.9;
    if (back > progress * total * TILE_W) continue;
    ctx.globalAlpha = (1 - i / (trailCount + 1)) * 0.4;
    ctx.save();
    ctx.translate(screenX - Math.cos(heading) * back, flightY - arc - Math.sin(heading) * back);
    ctx.rotate(heading);
    drawShotBody(ctx, look, tint, scale * (1 - i * 0.12));
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.translate(screenX, flightY - arc);
  // A lobbed shot tumbles rather than pointing at anything; a flat one points
  // exactly where it is going.
  ctx.rotate(lobbed ? progress * Math.PI * 3 : heading);

  /*
   * The element is drawn *around* the shot, before the shot itself.
   *
   * The silhouette still comes from the weapon — an arrow is arrow-shaped
   * whoever looses it — but a fireball now trails flame, a frost bolt trails
   * ice, and a bolt of lightning crackles. That envelope is the difference
   * between "a wizard fires a projectile" and "a wizard throws a fireball".
   */
  drawShotAura(ctx, el, glow, scale, progress);

  /*
   * And a drawn animation on top of the shot itself.
   *
   * The envelope below is procedural — tongues of flame, shards, droplets —
   * and it does the streaming and the physics well. What it cannot do is have
   * the *shape* of fire. A hand-drawn loop riding on the shot is the
   * difference between a coloured dot with a tail and something a person drew,
   * and it is the part of "everyone just shoots a simple projectile" that the
   * procedural work could never answer.
   *
   * Drawn unrotated, in the shot's own space, because the pack's effects are
   * authored upright and spinning them with a flat shot makes fire flow
   * sideways. A lobbed shot already tumbles, and the effect tumbles with it,
   * which reads correctly for something arcing through the air.
   */
  const inFlight = SHOT_EFFECTS[el];
  if (inFlight) {
    const sheet = effectSheet(inFlight);
    if (sheet) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      if (!lobbed) ctx.rotate(-heading);
      drawEffectFrame(ctx, sheet, loopFrame(tick, 3.2), 0, 0, 34 * scale);
      ctx.restore();
    }
  }

  drawShotBody(ctx, look, tint, scale);
  ctx.restore();
}

/**
 * The drawn loop that rides on a shot in flight, by element.
 *
 * Only the elements whose shots are *made* of something get one. A steel bolt
 * or an arrow is a physical object and putting a magical loop on it would make
 * every projectile in the game look enchanted, which is exactly the flattening
 * this is meant to undo.
 */
const SHOT_EFFECTS: Partial<Record<Element, EffectName>> = {
  fire: 'brightfire',
  frost: 'bluefire',
  toxic: 'felspell',
  storm: 'magickahit',
  water: 'magicbubbles',
  arcane: 'magicspell',
  holy: 'sunburn',
  shadow: 'phantom',
};

/**
 * The elemental envelope around a shot in flight.
 *
 * Drawn in the shot's own rotated space, so "behind" is always -x and the
 * flames, shards and droplets stream backwards along the flight path however
 * the shot is heading.
 */
function drawShotAura(
  ctx: CanvasRenderingContext2D,
  el: Element,
  glow: { core: string; body: string; trail: string },
  scale: number,
  progress: number,
): void {
  const s = scale;
  switch (el) {
    case 'fire': {
      // A tapering tongue streaming back from the head of the shot.
      ctx.fillStyle = glow.trail;
      ctx.beginPath();
      ctx.moveTo(-20 * s, 0);
      ctx.quadraticCurveTo(-8 * s, -6 * s, 4 * s, 0);
      ctx.quadraticCurveTo(-8 * s, 6 * s, -20 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glow.body;
      ctx.beginPath();
      ctx.moveTo(-13 * s, 0);
      ctx.quadraticCurveTo(-5 * s, -4 * s, 4 * s, 0);
      ctx.quadraticCurveTo(-5 * s, 4 * s, -13 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glow.core;
      ctx.beginPath();
      ctx.arc(0, 0, 3.4 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'frost': {
      // A shard with two smaller splinters trailing it.
      ctx.fillStyle = glow.body;
      for (const [dx, dy, r] of [[-9, -3, 2.4], [-13, 3, 2], [-5, 2, 1.6]] as const) {
        ctx.beginPath();
        ctx.moveTo(dx * s, (dy - r) * s);
        ctx.lineTo((dx + r) * s, dy * s);
        ctx.lineTo(dx * s, (dy + r) * s);
        ctx.lineTo((dx - r) * s, dy * s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = glow.core;
      ctx.beginPath();
      ctx.arc(0, 0, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'storm': {
      // Crackle: a short jagged tail that changes shape as it flies.
      ctx.strokeStyle = glow.core;
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(2 * s, 0);
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const jag = ((i * 7 + Math.round(progress * 90)) % 5) - 2;
        ctx.lineTo(-i * 4.5 * s, jag * s);
      }
      ctx.stroke();
      ctx.strokeStyle = glow.body;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha *= 0.35;
      ctx.stroke();
      ctx.globalAlpha /= 0.35;
      break;
    }
    case 'toxic': {
      ctx.fillStyle = glow.trail;
      for (const [dx, r] of [[-7, 3], [-12, 2.2], [-16, 1.5]] as const) {
        ctx.globalAlpha *= 0.55;
        ctx.beginPath();
        ctx.arc(dx * s, 0, r * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha /= 0.55;
      }
      ctx.fillStyle = glow.body;
      ctx.beginPath();
      ctx.arc(0, 0, 3.6 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'water': {
      // A teardrop, blunt end forward.
      ctx.fillStyle = glow.body;
      ctx.beginPath();
      ctx.moveTo(4 * s, 0);
      ctx.quadraticCurveTo(0, -4 * s, -12 * s, 0);
      ctx.quadraticCurveTo(0, 4 * s, 4 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glow.core;
      ctx.beginPath();
      ctx.arc(1 * s, -1 * s, 1.6 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arcane':
    case 'holy': {
      // A halo that pulses along the flight rather than a solid body.
      const pulse = 3 + Math.abs(Math.sin(progress * Math.PI * 4)) * 2;
      ctx.strokeStyle = glow.body;
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.arc(0, 0, pulse * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = glow.core;
      ctx.beginPath();
      ctx.arc(0, 0, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shadow': {
      ctx.fillStyle = glow.trail;
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.ellipse(-6 * s, 0, 9 * s, 3.4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.6;
      ctx.fillStyle = glow.body;
      ctx.beginPath();
      ctx.arc(0, 0, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'steel':
    default:
      // Nothing: a steel shot is its own silhouette and wants no glow.
      break;
  }
}

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  runner: MatchRunner,
  viewTeam: Team,
): void {
  // Fractional tick: whole ticks plus how far the renderer is between them.
  // Animation is sampled on this rather than on `state.tick` so poses advance
  // every frame, at the same cadence as the interpolated positions.
  const animTick = state.tick + runner.alpha;

  // Resolve interpolated screen positions first so the sort is on final
  // on-screen depth rather than on simulation coordinates.
  const drawList = state.entities
    .filter((entity) => entity.alive)
    .map((entity) => {
      const position = runner.interpolate(entity.id, entity.x, entity.y);
      const screen = tileToLogical(fxToFloat(position.x), fxToFloat(position.y), viewTeam);
      return { entity, screenX: screen.x, screenY: screen.y };
    })
    .sort((a, b) => a.screenY - b.screenY || a.entity.id - b.entity.id);

  for (const { entity, screenX, screenY } of drawList) {
    switch (entity.kind) {
      case 'tower':
        drawTower(ctx, entity, screenX, screenY);
        break;
      case 'building':
        drawBuilding(ctx, entity, screenX, screenY);
        break;
      case 'projectile':
        drawProjectile(ctx, entity, screenX, screenY, viewTeam, animTick);
        break;
      default:
        drawTroop(ctx, entity, screenX, screenY, animTick);
    }
  }
}

/*
 * `drawEffects` used to live here: single-frame rings for hit / spell / ability
 * events, read straight off `state.events`.
 *
 * Removed, because it was a duplicate that also flickered. `VfxSystem` already
 * handles all three event types with timed, animated rings, particle bursts and
 * screen shake, fed from the properly drained event buffer. This version read
 * `state.events` directly instead, so a frame covering two ticks dropped the
 * first tick's markers entirely and a frame covering none drew the previous
 * tick's markers a second time — the impact ring appeared for an unpredictable
 * number of frames, which is exactly the inconsistency it was meant to signal.
 */
