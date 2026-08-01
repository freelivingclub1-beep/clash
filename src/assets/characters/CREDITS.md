# Character art — Universal LPC Spritesheet

The character sprites in this directory are **not original work**. They are
composited from the Universal LPC Spritesheet collection, a long-running
community project begun for the Liberated Pixel Cup.

- **Upstream:** https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
- **Asset release used:** `assets-v2026.06.05-initial`
  (`ochowei/Universal-LPC-Spritesheet-Character-Generator`, sha
  `212abfd21493e9957bd556250ac538fa40fe1fc9`)
- **Per-asset authorship:** the upstream `CREDITS.csv` and the `sheet_definitions`
  metadata in that release name the author of every individual layer. That file
  is the authoritative credit list and must be redistributed with any build that
  ships these sprites.

## Licensing — read this before shipping

The collection is multi-licensed, and not uniformly. Across the sheets used
here the declared licences are:

| Licence | Sheets |
| --- | --- |
| OGA-BY 3.0 (+ 3.0+, 4.0) | ~530 |
| GPL 3.0 (and GPL 2.0) | ~470 |
| CC-BY-SA 3.0 (and 4.0) | ~350 |
| CC-BY 3.0 / 4.0 (+ 3.0+) | ~150 |

Most individual sheets are offered under several of these at once, so a
distributor may pick one — but a substantial number offer **only** GPL or
CC-BY-SA, both of which are copyleft.

**This build uses the full pool, including the copyleft-only sheets.** That was
a deliberate choice. The consequence is that a distributed build of this game
carries share-alike obligations: it must be distributed under GPL-compatible
terms, with source available, and with attribution preserved.

If that is ever unwanted, the fix is mechanical rather than structural — the
recipe tables in `scripts/lpc/build.ts` choose which sheets are used, so
restricting them to the CC-BY and OGA-BY subset removes the copyleft obligation
while leaving everything else in place. The renderer does not care which
subset produced the atlas.

## How these files are produced

They are generated, not hand-drawn, and are checked in so the game builds
without a network fetch:

```
npm run assets:fetch       # download the upstream release into /tmp/lpc
npm run assets:characters  # composite one atlas per card per side
```

`scripts/lpc/build.ts` derives each card's character from the model it already
had — body plan chooses species, build chooses frame and garment, weapon kind
chooses the weapon — so no card's appearance is hand-assigned and a new card
gets art automatically.

Each atlas is a strip: nine walk frames then six strike frames, with the
back-facing row above the front-facing row. Which row a unit draws from is
decided by its side, so you see your own troops from behind and the enemy
head-on.


---

## Quadruped animals

Some cards are animals, and the Universal LPC pack has none — its wolf is a
wolf's head on a human body, which is a werewolf. Elite Hounds, a card whose
entire identity is that it is a pack of dogs, shipped as a small armoured
humanoid in a visor because nothing else was available.

The four-legged sprites come from **[Stendhal](https://github.com/arianne/stendhal)**,
by the Arianne Project — Miguel Angel Blanch Lardin and contributors. Most of
the original graphics are by **Anders Asplund (Danter)**; the wolf specifically
is credited in `doc/AUTHORS.txt` to **Kim Purnell (Samoa)**.

Stendhal is distributed under the **GNU General Public License version 2 or
later**. The "or later" matters: it is what lets these combine with the GPL-3
portion of the LPC pack in a single distributed work. This build therefore
carries GPL-3 obligations, which is the licensing position it was already in.

### What was changed

`scripts/beasts/build.mjs` rewrites each sheet into the same atlas shape the
humanoid figures use. Stendhal's grid is three frames across and four
directions down, in the same row order as LPC — away, right, toward, left — so
the two facings this game draws come from the same rows. Beyond that:

- Frames are trimmed to the sheet's shared ink box before scaling, because the
  source frames are padded and scaling the frame rather than the animal leaves
  a hound the size of a house cat. One box for the whole sheet, not one per
  frame, or the walk cycle jitters in place instead of striding.
- The walk plays out and back across the three frames rather than looping
  through them, since the middle frame is a neutral stand and cycling through
  it reads as a limp.
- There is no attack animation to borrow — Stendhal animates an attack by
  moving the sprite — so the strike frames are the extremes of the stride,
  under the forward lunge the entity renderer already applies.
- Elite Hounds is recoloured from the grey wolf toward a Doberman coat. The
  source's lightness curve is preserved, so the shading is the artist's.

Nothing is redrawn. Frames are cropped, reordered, resampled and recoloured.
