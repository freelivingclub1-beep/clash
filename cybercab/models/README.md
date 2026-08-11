# Dropping in real vehicle models

This directory is empty on purpose. The configurator ships with a generated
placeholder body so it runs out of the box; put a real glTF here and it takes
over completely.

## Fastest way to try one

You do not have to edit any code. Append `?model=<url>` to the page:

```
index.html?vehicle=model3&model=./models/model3.glb
index.html?vehicle=model3&model=https://your-cdn.example/model3.glb
```

The loader takes over immediately. A remote URL needs CORS open on that host.
Use this to audition models before committing to one.

## Making it the default

1. Put `model3.glb` (or whatever you licensed) in this directory.
2. In `src/vehicles.js`, set that vehicle's `asset.url`:

```js
asset: {
  url: './models/model3.glb',
  scaleToLength: 4.72,
  roles: { /* see below */ },
}
```

3. Reload. The placeholder disappears and so does the badge over the render.

Nothing else in the app changes. Paint, tint, wheel finish, caliper colour and
trim finish all address the car through *roles*, not through geometry the app
generated, so they work on a downloaded model the moment the names line up.

## Where to get models

The demo ships no vehicle assets because Tesla's designs and the models people
make of them are not ours to redistribute. Sources worth checking, in rough
order of how much trouble they save you:

- **Sketchfab** — filter by *Downloadable* and license. CC-BY models are free to
  use commercially with attribution; CC-BY-NC are demo/personal only. There is a
  CC-BY Cybercab scan, and several Model 3 / Model Y models.
- **TurboSquid / CGTrader** — paid, generally cleaner topology and properly
  separated materials, which matters a lot for the role mapping below.
- **Your own** — if you have CAD or a Blender model, export glTF 2.0 Binary.

Whatever you pick, check the licence covers what you're doing. A model licensed
for personal use does not become commercial because it's on your site.

## What a model needs

**Format.** glTF 2.0 binary (`.glb`). Draco compression is supported — the
decoder is vendored in `vendor/three/draco/`. Meshopt is not.

**Scale and orientation.** Handled for you. The loader recentres the model,
drops it onto y=0, scales it so its length matches `scaleToLength`, and rotates
it 90° if the longest horizontal axis runs along Z instead of X. You do not need
to pre-process anything.

**Separated materials.** This is the one that actually matters. If the body,
glass and wheels share a single material, nothing can be recoloured
independently and you get a car in one colour forever. Ask for — or check for —
distinct materials per part before you buy.

**Budget.** Aim under ~300k triangles. Configurator cameras never get close
enough to justify more, and phones will thank you.

## Role mapping

`asset.roles` maps each role to a list of substrings. Any mesh whose **name** or
**material name** contains one of them takes that role:

```js
roles: {
  paint:    ['body', 'carpaint', 'paint'],   // gets the selected paint
  glass:    ['glass', 'window', 'windshield'], // gets the selected tint
  chrome:   ['chrome', 'trim', 'brightwork'],  // gets the trim finish
  dark:     ['rubber', 'plastic', 'cladding'], // stays dark
  wheel:    ['wheel', 'rim', 'tyre', 'tire'],  // gets the wheel finish
  interior: ['interior', 'seat', 'dash'],
}
```

Matching is case-insensitive substring, checked in the order
caliper → rotor → tyre → wheel → glass → paint → chrome → light → dark →
interior. The order carries meaning: a caliper is part of a wheel assembly but
has to stay separately colourable, and `tyre` precedes `wheel` so rubber never
picks up the rim finish.

`ROLES` in `src/loader.js` already covers the conventions Blender's glTF
exporter and the major marketplaces use — `car_main_paint`, `Glass_mid_tint`,
`Brake_Disc`, `Sidewall`, `calipers`. Most models need no configuration at all.
The `roles` block in `vehicles.js` only has to list *overrides*.

**Tyres and rotors are normalised, not inherited.** Downloaded models are wildly
inconsistent here — one real production model tested against this loader ships
its tyres at Blender's default 0.8 grey, which renders as white sidewalls. A
tyre is black rubber on every car ever made, so the loader replaces those
materials rather than reproducing the mistake.

**Anything that matches nothing keeps the material the artist authored.** That
is deliberate: an unmapped mesh renders as the artist intended rather than
vanishing, so a model with unusual naming still looks right while you work out
the strings.

You do not have to guess which those are. On load, the console prints a count
per role and then lists every unmapped material by name:

```
[configurator] role mapping: { paint: 2, glass: 6, wheel: 4, … , unmapped: 3 }
[configurator] 3 unmapped material(s), keeping authored look: ['ior_1', 'mirror', 'licence_plate_light']
```

Paste those strings into the appropriate role list and reload. Pale grey patches
on an otherwise correct car are almost always an unmapped material.

## Known gaps

Two things do not yet work on a loaded model, and both are honest limitations
rather than oversights:

- **Aero parts** (splitters, skirts, ducktails, wings) are swept along the
  body's own outline, and that query only exists for the generated surface. A
  loaded glTF needs either an outline sampled from its geometry or per-model
  aero meshes. `car.shape` is `null` on the loaded path and `rebuildAero()`
  returns early — that is the hook to fill in.
- **Wheel swapping** replaces the finish material on the model's own wheels, but
  does not substitute a different wheel *style*. Doing that properly means
  hiding the model's wheels and instancing separate wheel GLBs at the four hub
  positions, which the loader already collects.
