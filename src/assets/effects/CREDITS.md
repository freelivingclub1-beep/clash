# Animated effects

The spell, impact, cast and summon animations in this directory come from the
**Free Pixel Effects Pack** by **CodeManu** and **DavitMasia**, built with their
Pixel FX Designer.

The pack's own README states:

> This is a public domain asset, you can use it for both personal and comercial
> purposes. No credit required but feel free to show us where you used it on
> @DavitMasia and @CodeManuPro at twitter. :)
>
> Frame size is 100x100px.

No credit is required. It is given here anyway, because the pack is the
difference between effects that look drawn and effects that look computed.

## What was changed

`scripts/fx/build.mjs` rewrites each sheet. The originals are square grids of
100px frames — up to eleven by eleven — with the tail of every grid empty,
because they were exported at a fixed size whatever the effect's real length.
The build finds the last frame with any ink in it, samples sixteen frames
evenly across that range, lays them out in a single row, and re-encodes as
indexed colour. Nothing is redrawn; frames are dropped and reordered only.

Sixteen frames is a little over half a second at 30Hz, which is roughly the
length of a blow landing. The originals run to a hundred and twenty frames —
played in full, an impact would still be burning three seconds after the unit
that caused it had died.

## Sourcing

Fetched by `scripts/fx/fetch.mjs`. The author's own hosts (itch.io,
opengameart) are unreachable under this environment's network policy, so the
files come from a copy vendored in a public game repository, together with the
author's README so the licence travels with the art.
