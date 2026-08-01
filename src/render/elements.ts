/**
 * What a card's magic *is*, for the renderer.
 *
 * The simulation has never needed this — damage is damage — but the screen very
 * much does. Before this, every impact in the game drew the same warm yellow
 * puff: a fireball, an ice spell, a poison cloud, a lightning bolt and an arrow
 * were pixel-identical on landing, and the only thing distinguishing one
 * ranged card from another was the small shape of the projectile. That is why
 * a board full of different mechanics all read as "everyone shoots a dot".
 *
 * An element is derived rather than authored, so all hundred-odd cards get one
 * without a data-entry pass, and a card added tomorrow gets one for free. The
 * derivation runs in priority order:
 *
 *   1. A short table of signature cards, where the name *is* the element.
 *   2. The card's on-hit status — a card that freezes is frost, whatever else
 *      it looks like.
 *   3. Its model's weapon: a lantern is holy, a bomb is fire, a blade is steel.
 *   4. Its own tint. Card colours were already chosen to say what a card is,
 *      so a red card lands as fire and a green one as toxin.
 */

import type { CardDefinition } from '@cards/schema';
import { MODELS } from './models';

export type Element =
  | 'fire'
  | 'frost'
  | 'toxic'
  | 'storm'
  | 'water'
  | 'arcane'
  | 'holy'
  | 'shadow'
  | 'steel';

export interface ElementLook {
  /** Bright inner colour — the core of a bolt, the hottest part of a flame. */
  core: string;
  /** Mid tone, used for the body of a projectile and most impact particles. */
  body: string;
  /** Dim tone for trails, smoke and lingering residue. */
  trail: string;
  /** Shape drawn for the shot itself. */
  shot: 'flame' | 'crystal' | 'glob' | 'spark' | 'droplet' | 'rune' | 'star' | 'wisp' | 'solid';
}

export const ELEMENT_LOOKS: Record<Element, ElementLook> = {
  fire: { core: '#fff2c2', body: '#ff8b3d', trail: '#8a3a12', shot: 'flame' },
  frost: { core: '#eaffff', body: '#7fd8ff', trail: '#3a6f8a', shot: 'crystal' },
  toxic: { core: '#e6ffb0', body: '#7fd24a', trail: '#2f5a1f', shot: 'glob' },
  storm: { core: '#ffffff', body: '#9fd0ff', trail: '#4a5f9a', shot: 'spark' },
  water: { core: '#dff6ff', body: '#4aa8e0', trail: '#1f4f7a', shot: 'droplet' },
  arcane: { core: '#f0d8ff', body: '#b45fe0', trail: '#4f2a6a', shot: 'rune' },
  holy: { core: '#fffbe0', body: '#ffd84a', trail: '#8a6f1f', shot: 'star' },
  shadow: { core: '#c9b0e0', body: '#6a4a8a', trail: '#241533', shot: 'wisp' },
  steel: { core: '#f2f5fa', body: '#b8c2d0', trail: '#5a6472', shot: 'solid' },
};

/**
 * Cards whose element is not negotiable.
 *
 * Everything else is inferred, but a card called Fireball has exactly one
 * correct answer and should not depend on what colour someone picked for it.
 */
const SIGNATURE: Record<string, Element> = {
  card_spell_fireball: 'fire',
  card_spell_zap: 'storm',
  card_spell_arrows: 'steel',
  card_spell_glacier: 'frost',
  card_spell_sunbeam: 'holy',
  card_spell_miasma: 'toxic',
  card_spell_snare: 'toxic',
  card_spell_warcry: 'holy',
  card_spell_splinter_bomb: 'fire',
  card_troop_wizard: 'fire',
  card_troop_ember_jack: 'fire',
  card_troop_pyre_drake: 'fire',
  card_troop_emberwing: 'fire',
  card_troop_bomber: 'fire',
  card_troop_baby_dragon: 'fire',
  card_troop_stormcaller: 'storm',
  card_troop_bolt_pair: 'storm',
  card_troop_arc_warden: 'storm',
  card_troop_arc_lance: 'storm',
  card_troop_tesla: 'storm',
  card_building_tesla: 'storm',
  card_troop_frost_wisp: 'frost',
  card_building_frost_pylon: 'frost',
  card_troop_glasscaster: 'frost',
  card_troop_tide_caller: 'water',
  card_troop_marsh_walker: 'water',
  card_troop_gale_monk: 'water',
  card_troop_blight_fang: 'toxic',
  card_troop_plague_bearer: 'toxic',
  card_troop_doomseed: 'toxic',
  card_troop_aether_leech: 'arcane',
  card_troop_void_stalker: 'shadow',
  card_troop_grave_titan: 'shadow',
  card_troop_bone_reaper: 'shadow',
  card_troop_nightblade: 'shadow',
  card_troop_gloom_archer: 'shadow',
  card_troop_lantern_bearer: 'holy',
  card_troop_shield_chaplain: 'holy',
  card_troop_aegis_matron: 'holy',
  card_troop_undying_sentinel: 'holy',
  card_troop_rune_bearer: 'arcane',
  card_troop_spotter: 'arcane',
  card_troop_mirror_shade: 'arcane',
  card_troop_seraph_of_dusk: 'shadow',
};

const BY_STATUS: Record<string, Element> = {
  Freeze: 'frost',
  Slow: 'frost',
  Poison: 'toxic',
  ElectroReset: 'storm',
  Stun: 'storm',
  Knockback: 'water',
  Rage: 'holy',
  Heal: 'holy',
};

const BY_WEAPON: Record<string, Element> = {
  staff: 'arcane',
  lantern: 'holy',
  bomb: 'fire',
  cannon: 'steel',
  drill: 'steel',
  bow: 'steel',
  spear: 'steel',
  sword: 'steel',
  axe: 'steel',
  dagger: 'steel',
  hammer: 'steel',
  scythe: 'shadow',
  claws: 'steel',
};

/** Hue of a `#rrggbb` tint, 0-360. */
function hueOf(hex: string): number {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function byTint(card: CardDefinition): Element {
  const v = card.tint.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  // Near-grey cards have no colour opinion; they are simply made of metal.
  if (Math.max(r, g, b) - Math.min(r, g, b) < 26) return 'steel';

  const h = hueOf(card.tint);
  if (h < 20 || h >= 330) return 'fire';
  if (h < 45) return 'fire';
  if (h < 70) return 'holy';
  if (h < 160) return 'toxic';
  if (h < 200) return 'water';
  if (h < 250) return 'frost';
  return 'arcane';
}

const cache = new Map<string, Element>();

export function elementOf(card: CardDefinition): Element {
  const hit = cache.get(card.id);
  if (hit) return hit;

  let element = SIGNATURE[card.id];
  if (!element && card.onHitStatus && card.onHitStatus !== 'None') {
    element = BY_STATUS[card.onHitStatus];
  }
  if (!element) {
    const weapon = MODELS[card.modelId]?.weapon;
    // A weapon only decides it when the weapon is *distinctive*. Plain steel
    // arms fall through to the tint, which carries more of the card's identity.
    if (weapon && BY_WEAPON[weapon] && BY_WEAPON[weapon] !== 'steel') {
      element = BY_WEAPON[weapon];
    }
  }
  if (!element) element = byTint(card);

  cache.set(card.id, element);
  return element;
}

export function lookOf(card: CardDefinition): ElementLook {
  return ELEMENT_LOOKS[elementOf(card)];
}
