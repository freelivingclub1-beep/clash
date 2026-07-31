/**
 * Entity rendering.
 *
 * Placeholder geometry rather than sprite sheets: troops are discs, buildings
 * rounded squares, towers keeps. Each card's `tint` supplies its colour, so a
 * card authored in the Card Maker is immediately visible on the field without
 * anyone having to draw art for it first — which is the point of shipping the
 * authoring tool alongside the engine.
 *
 * Draw order is back-to-front by screen Y so overlapping units stack the way
 * the eye expects.
 */

import { tryGetCard } from '@cards/registry';
import { fxToFloat } from '@sim/math/fixed';
import { TOWER_LAYOUTS } from '@sim/nav/grid';
import type { Entity, MatchState, Team } from '@sim/types';
import type { MatchRunner } from '@game/match';
import { TILE_W, TILE_H, tileToLogical } from './camera';

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

function drawTroop(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const card = tryGetCard(entity.cardId);
  const tint = card?.tint ?? '#cccccc';
  const colours = TEAM_COLOURS[entity.team];
  const radius = Math.max(10, fxToFloat(entity.radius) * TILE_W);

  // Flying units are lifted off the ground with their shadow left behind, so
  // air and ground are distinguishable at a glance.
  const lift = entity.flying ? TILE_H * 0.9 : 0;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(screenX, screenY, radius * 0.9, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyY = screenY - lift - radius * 0.4;

  // Team ring, then the card's own colour inside it.
  ctx.fillStyle = colours.dark;
  ctx.beginPath();
  ctx.arc(screenX, bodyY, radius + 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(screenX, bodyY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Evolved units get a bright halo — the clearest possible tell in a fight.
  if (entity.evolved) {
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(screenX, bodyY, radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Champions carry a crown marker.
  if (entity.isHero) {
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.moveTo(screenX - radius * 0.6, bodyY - radius - 8);
    ctx.lineTo(screenX, bodyY - radius - 22);
    ctx.lineTo(screenX + radius * 0.6, bodyY - radius - 8);
    ctx.closePath();
    ctx.fill();
  }

  if (entity.shield > 0) {
    ctx.strokeStyle = '#9fd8ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, bodyY, radius + 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Status tells.
  if (entity.freezeTicks > 0 || entity.stunTicks > 0) {
    ctx.fillStyle = 'rgba(140,220,255,0.5)';
    ctx.beginPath();
    ctx.arc(screenX, bodyY, radius + 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (entity.rageTicks > 0) {
    ctx.strokeStyle = '#e05bd5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, bodyY, radius + 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (entity.invisibleTicks > 0) {
    ctx.globalAlpha = 0.4;
  }

  if (entity.hp < entity.maxHp) {
    healthBar(ctx, screenX, bodyY - radius - 20, radius * 2.2, entity.hp / entity.maxHp, entity.team);
  }
  ctx.globalAlpha = 1;

  // Deploy freeze: a shrinking ring, so the delay is legible.
  if (entity.deployTimer > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius + 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const card = tryGetCard(entity.cardId);
  const size = Math.max(24, fxToFloat(entity.radius) * TILE_W * 1.8);
  const colours = TEAM_COLOURS[entity.team];

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(screenX - size / 2, screenY - size / 4, size, size / 2);

  ctx.fillStyle = colours.dark;
  ctx.fillRect(screenX - size / 2 - 3, screenY - size - 3, size + 6, size + 6);
  ctx.fillStyle = card?.tint ?? '#999999';
  ctx.fillRect(screenX - size / 2, screenY - size, size, size);

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

function drawTower(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
): void {
  const layout = TOWER_LAYOUTS[entity.towerIndex];
  const isKing = layout?.kind === 'king';
  const tiles = isKing ? 4 : 3;
  const width = tiles * TILE_W * 0.72;
  const height = tiles * TILE_H * 1.35;
  const colours = TEAM_COLOURS[entity.team];

  // screenY is the footprint's centre. Sit the keep on that centre with a
  // modest lift, so the structure reads as standing *on* its platform rather
  // than floating above it.
  const footprintHalf = (tiles * TILE_H) / 2;
  const base = screenY + footprintHalf;
  const top = base - height;

  ctx.fillStyle = colours.dark;
  ctx.fillRect(screenX - width / 2, top, width, height);
  ctx.fillStyle = entity.dormant ? '#6a7078' : colours.primary;
  ctx.fillRect(screenX - width / 2 + 6, top + 6, width - 12, height - 12);

  // Crenellations, purely so a tower reads as a tower.
  ctx.fillStyle = colours.dark;
  const merlons = isKing ? 5 : 4;
  for (let i = 0; i < merlons; i++) {
    const w = width / (merlons * 2 - 1);
    ctx.fillRect(screenX - width / 2 + i * w * 2, top - 10, w, 14);
  }

  healthBar(ctx, screenX, top - 26, width * 1.15, entity.hp / entity.maxHp, entity.team);
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
        drawTroop(ctx, entity, screenX, screenY);
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
