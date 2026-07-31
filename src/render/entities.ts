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
import { fxToFloat } from '@sim/math/fixed';
import { TOWER_LAYOUTS } from '@sim/nav/grid';
import { DAMAGE_RAMP_STACK_CAP } from '@sim/constants';
import type { Entity, MatchState, Team } from '@sim/types';
import type { MatchRunner } from '@game/match';
import { TILE_W, TILE_H, tileToLogical } from './camera';
import { spriteFor } from './sprites';
import { texturePattern } from './textures';

const TEAM_COLOURS: Record<Team, { primary: string; dark: string }> = {
  0: { primary: '#4a9eff', dark: '#1b4f8a' },
  1: { primary: '#ff6b5b', dark: '#8a2f24' },
};

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
 * Driven by the simulation tick and the unit's own speed, so a Very Fast troop
 * visibly strides faster than a Slow one, and a stationary unit holds a pose
 * instead of marching on the spot. Offset by entity id so a spawned group does
 * not move in lockstep like a single organism.
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

  if (entity.invisibleTicks > 0) ctx.globalAlpha = 0.35;

  const sprite = spriteFor(card, entity.team, walkPhase(entity, tick));
  // Sprites are authored feet-at-the-bottom, so the draw box is anchored to
  // the entity's ground position rather than centred on it.
  const drawHeight = radius * 4.2 * spawnScale;
  const drawWidth = drawHeight * (sprite.width / sprite.height);
  const footY = screenY - lift;

  // Attack lunge: for a few ticks after a swing the figure is shoved toward
  // whatever it hit, so a melee exchange reads as an exchange rather than as
  // two idle figures and a silently draining health bar.
  const sinceSwing = entity.attackCooldown;
  const lungeStrength = sinceSwing > 0 && entity.windupDone ? Math.min(1, sinceSwing / 6) : 0;
  const facingLength = Math.hypot(fxToFloat(entity.faceX), fxToFloat(entity.faceY)) || 1;
  const lungeX = (fxToFloat(entity.faceX) / facingLength) * lungeStrength * radius * 0.45;
  const lungeY = (fxToFloat(entity.faceY) / facingLength) * lungeStrength * radius * 0.25;

  ctx.drawImage(
    sprite.source,
    screenX - drawWidth / 2 + lungeX,
    footY - drawHeight - lungeY,
    drawWidth,
    drawHeight,
  );

  ctx.globalAlpha = 1;

  const topY = footY - drawHeight;

  // Evolved units get a bright halo — the clearest tell available in a fight.
  if (entity.evolved) {
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, radius * 1.15, radius * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (entity.shield > 0) {
    ctx.strokeStyle = 'rgba(159,216,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(screenX, footY - drawHeight / 2, drawWidth * 0.55, drawHeight * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Status tells, drawn over the figure so they are never hidden by it.
  if (entity.freezeTicks > 0 || entity.stunTicks > 0) {
    ctx.fillStyle = 'rgba(140,220,255,0.35)';
    ctx.fillRect(screenX - drawWidth / 2, topY, drawWidth, drawHeight);
  }
  if (entity.rageTicks > 0) {
    ctx.strokeStyle = 'rgba(224,91,213,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, radius * 1.3, radius * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (entity.poisonTicks > 0) {
    ctx.fillStyle = 'rgba(120,200,90,0.28)';
    ctx.fillRect(screenX - drawWidth / 2, topY, drawWidth, drawHeight);
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

  const sprite = spriteFor(card, entity.team, 0);
  ctx.drawImage(sprite.source, screenX - size / 2, screenY - size, size, size);

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

function drawProjectile(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const card = tryGetCard(entity.cardId);
  const radius = entity.splashRadius > 0 ? 9 : 6;
  ctx.fillStyle = card?.tint ?? '#ffffff';
  ctx.beginPath();
  ctx.arc(screenX, screenY - TILE_H * 0.6, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  runner: MatchRunner,
  viewTeam: Team,
): void {
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
        drawProjectile(ctx, entity, screenX, screenY);
        break;
      default:
        drawTroop(ctx, entity, screenX, screenY, state.tick);
    }
  }
}

/** Short-lived hit and spell markers, driven by this tick's sim events. */
export function drawEffects(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  viewTeam: Team,
): void {
  for (const event of state.events) {
    if (event.type === 'hit' && event.splash) {
      const centre = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
      ctx.strokeStyle = 'rgba(255,220,120,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, TILE_W * 0.8, TILE_H * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (event.type === 'spell') {
      const centre = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
      const radius = fxToFloat(event.radius);
      ctx.fillStyle = 'rgba(255,140,60,0.35)';
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, radius * TILE_W, radius * TILE_H, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (event.type === 'ability') {
      const centre = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
      ctx.strokeStyle = 'rgba(255,216,74,0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, TILE_W * 1.6, TILE_H * 1.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
