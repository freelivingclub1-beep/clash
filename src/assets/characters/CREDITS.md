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
