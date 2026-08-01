/**
 * Which cards are drawn as animals rather than as people.
 *
 * The LPC pack this game's figures come from is entirely bipedal — its
 * "wolf" is a wolf's head on a man's body, which is a werewolf. So a card
 * whose whole identity is that it is a *pack of dogs* could not be drawn from
 * it at all, and Elite Hounds shipped as a small armoured humanoid with a
 * visor.
 *
 * These sheets are real quadrupeds from Stendhal, which is GPL-2-or-later and
 * so upgrades cleanly alongside the GPL-3 LPC art already in the build. See
 * `src/assets/characters/CREDITS.md`.
 *
 * Adding an animal is one entry here. The build writes straight into the
 * character atlas directory under the model's own name, and the LPC build
 * reads this list so it does not overwrite them with a humanoid.
 */

/**
 * `palette` recolours the source, keeping its shading — the Stendhal wolf is
 * grey, and a Doberman is not.
 *
 * `height` is the animal's share of the 64px logical figure box. A dog is
 * lower than a person at the same distance; drawing it at full height is the
 * single fastest way to make a hound read as a bear.
 */
export const BEASTS = {
  /*
   * Elite Hounds. Black with tan points, which is what makes a Doberman read
   * as a Doberman rather than as a large dark dog: the lightness curve of the
   * source wolf is preserved, so its lit surfaces come through as the tan and
   * its shadowed ones as the black.
   */
  eliteHound: {
    sheet: 'wolf',
    palette: { hue: 22, sat: 0.72, light: 0.7 },
    height: 0.78,
  },

  /*
   * Pounce Stalker — the card that springs at whatever is furthest away. It
   * was a lean humanoid in a mask, which said nothing about the one thing it
   * does. A big cat says all of it before you read the card.
   */
  pounceStalker: {
    sheet: 'tiger',
    palette: null,
    height: 0.78,
  },
};

/** Every distinct source sheet the recipe needs, for the fetch step. */
export function requiredSheets() {
  return [...new Set(Object.values(BEASTS).map((b) => b.sheet))];
}
