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
   * Elite Hounds — a Doberman, which is two colours and not one.
   *
   * A hue-and-saturation replacement can only ever make a monochrome dog: a
   * tan one, a red one, a grey one. The breed's whole read is black over the
   * mass of the body with rust on the muzzle, brows, chest and legs — and on
   * a side-on sprite those markings sit exactly where the artist put the
   * highlights, because they are the parts of the animal that catch light.
   *
   * So the source wolf's brightness is mapped through a ramp instead. The
   * shadowed mass lands on near-black, the mid-tones on the dark transition a
   * real coat has, and the lit edges on rust. That reproduces the marking
   * pattern rather than imitating it, and it stays legible at fifty pixels
   * tall because the rust carries the silhouette that pure black would lose
   * against a dark field.
   */
  eliteHound: {
    sheet: 'wolf',
    palette: {
      ramp: [
        [0.0, 14, 13, 16],    // deepest shadow — near black
        [0.34, 32, 30, 34],   // the black of the coat
        [0.5, 58, 44, 36],    // where black gives way to rust
        [0.62, 112, 60, 26],  // rust, shadowed
        [0.78, 164, 88, 34],  // rust
        [0.9, 200, 118, 50],  // rust, lit
        [1.0, 226, 158, 88],  // the brightest points: muzzle and brows
      ],
    },
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
