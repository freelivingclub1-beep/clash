# Tesla-style 3D configurator

A working car configurator in the shape of Tesla's, with more customisation than
Tesla offers: three vehicles, aftermarket wheels by brand, tint levels, bolt-on
aero, caliper colours, lowering, chrome delete. The camera flies to whatever you
are editing — open Wheels and it drops to the wheel, open Paint and it pulls
back to the hero angle.

Drag to rotate, scroll to zoom, arrow keys change view. The whole configuration
lives in the URL, so any build is a link.

> Unofficial technical demo. Not affiliated with, endorsed by, or sourced from
> Tesla. Aftermarket brand names are fictional. Every price and performance
> figure is invented; only the published exterior dimensions are real.

## Run it

```bash
python3 -m http.server 8080     # or any static server
open http://localhost:8080/cybercab/
```

No install, no build step: `index.html` uses an import map pointing at the
vendored three.js. For a single self-contained file:

```bash
npm install && npm run build      # -> dist/cybercab.html
```

## Read this first: the car bodies are placeholders

**The three bodies are generated in code and are not accurate models.** They are
approximations built from curve tables, and the app says so with a badge over
the render. They exist so the configurator runs, and so option logic could be
built and tested without assets.

Getting real cars in is a file drop — or just a URL. Append
`?model=https://your-host/model3.glb` to the page and the loader takes over
immediately, no code change. See [`models/README.md`](models/README.md) for the
full contract.

**The loader is validated against a real production car model**, not written
speculatively. Role mapping, orientation and scale normalisation, tyre/rotor
handling and the unmapped-material diagnostic were all built against an actual
downloaded glTF — 105 meshes, 26 materials — and its paint, glass tint, wheel
finish and caliper colour all drive correctly from the panel.

You supply a licensed glTF; the loader does the rest. Everything downstream
addresses the car through *roles* rather than through geometry the app produced,
which is what makes the swap free.

Two features do not survive the swap yet (aero parts and wheel-style
substitution). Both are documented in `models/README.md` with the exact hook to
fill in.

## Why not use Tesla's own renders?

Tesla's configurator is **image-based**. A compositor service renders every
combination of model, paint, wheels and view server-side and returns a PNG; the
page swaps images as you click. That is why the real site has a handful of fixed
camera angles and a dot strip rather than free orbit — the dots are the frames
that exist.

It wins on fidelity, because those are offline renders with ray-traced paint,
and on the low end, because a phone that cannot hold a WebGL context can still
show a JPEG. What it costs is a render farm and a combinatorial pile of images.

It also cannot do what this project is for. You can never put an aftermarket
wheel, a carbon lip or 5% tint on a pre-rendered image — every combination would
have to have been rendered in advance by Tesla. Aftermarket customisation
requires real geometry, which is why this is WebGL.

## What you can configure

| Group | Options | Camera flies to |
| --- | --- | --- |
| Vehicle | Model 3, Model Y, Cybercab | hero |
| Paint | 9, including two matte wraps | hero |
| Wheels | 9 across 4 brands, 18″–22″ | wheel |
| Wheel finish | 6, applied over any style | wheel |
| Calipers | 5 — visible through the spokes | wheel |
| Tint | 6 levels, 78% VLT down to 5% limo | side |
| Front aero | splitter, deep splitter | front, low |
| Side skirts | on/off | side |
| Rear aero | ducktail, track spoiler, pedestal wing | rear |
| Diffuser | on/off | rear |
| Exterior trim | chrome, chrome delete, carbon | side |
| Suspension | stock, −25mm, −50mm | side |
| Interior | 3 colourways | cabin |

Wheel choice changes range. Every option carries a price and the running total
is sticky at the foot of the panel.

## How it works

### Cost of a change

The interesting engineering decision is what each change costs:

- **Paint, tint, wheel finish, calipers, trim** — material writes. Three
  assignments, no allocation, no rebuild.
- **Aero** — rebuilds one small group.
- **Suspension** — one transform on the body group. The wheels stay on the
  ground because they are siblings, not children.
- **Wheels** — rebuild the car, because wheel diameter changes the arch geometry.
- **Vehicle** — rebuild everything and reframe the camera.

### The placeholder bodies

Each car is a *loft*: cross-sections swept along its length, each section a
superellipse `|z/w|ⁿ + |y/h|ⁿ = 1`. Four curves per vehicle say what its
dimensions are anywhere: `roofline`, `halfWidth`, `boxiness` (the exponent), and
`claddingLine`. A Model Y is a Model 3 with a higher, flatter roofline and a
bigger exponent.

Paint, glass, cladding and the cabin liner are all the same vertex grid with
different index buffers, and normals are computed once analytically from the
grid tangents — per-mesh normals would put a shading seam everywhere paint meets
glass.

### Aero that fits any car

Splitters, skirts, ducktails and wings are **swept along the body's own
outline**, not modelled per vehicle. `shape.outline(y, side, limit)` traces the
plan-view edge at a height, and a 2D cross-section is swept along it. One
catalogue entry therefore fits all three cars — and will fit a real glTF as soon
as that path can answer the same outline query.

### Things that are cheated, deliberately

- **Wheel faces are drawn, not modelled** — canvas draw calls on a disc, with a
  real alpha channel so the spoke gaps are holes. That is what lets the caliper
  read through. Nine styles cost nine textures; six finishes are a material
  colour on top, not fifty-four textures.
- **The ground shadow is a painted ellipse.** Cheaper than a shadow map and it
  never shimmers when the camera moves.
- **Lighting is a procedural room** through `PMREMGenerator` — the soft box
  reflections that make paint look wet, with no HDR file to ship.

### What cost the most time

Every one of these looked like a rendering bug and was a geometry bug:

- **End caps.** Capping the loft at full width gives a flat plate that reads as
  a plate whatever you do to its normals, and dishing it inward drives the fan
  through the last body quads and fills the seam with z-fighting. Fixed by
  rolling the section to nothing over the last 15cm so the surface closes itself.
- **Anchoring sections to the wheel arch.** It makes the section squash and
  stretch as the arch rises, walking the widest point of the flank up and down
  the car. The arch has to be a trim applied afterwards.
- **Vertex spacing.** A boxy superellipse has near-vertical sides, so spacing by
  the shape parameter dumps almost every vertex into the roof. Arc-length
  spacing fixed banded shading along the doors.
- **Stair-stepped material boundaries.** Asking each quad "are you above the
  canopy line?" rounds every boundary to the nearest edge loop. Fixed by giving
  each ring a fixed vertex budget per zone and putting the zone edges exactly on
  the boundary curves.
- **A curve fed control points in descending order.** The interpolator
  binary-searches, so it silently returned the first control point for every
  input and the entire glass canopy never appeared. It looked exactly like a
  feature that had not been written.
- **Aero that ran off the end of the car.** A trace with only a width limit runs
  until the body reaches that width, which on a long tapering nose is most of
  the way to the doors — the "front splitter" came out as a shelf half the
  length of the car.

## Layout

```
index.html          markup + import map (runs with no build step)
styles.css          configurator chrome
build.mjs           optional: bundle to one self-contained HTML file
models/             drop licensed glTF here -- see models/README.md
src/
  vehicles.js       the three cars: dimensions, asset slot, curve tables
  catalog.js        every option, price and camera focus -- all the data
  surface.js        loft generation for the placeholder bodies
  parts.js          bolt-on aero, swept along the body outline
  model.js          assembly: body, wheels, calipers, light bars
  loader.js         the real-glTF path
  interior.js       cabin, placed against whichever body is loaded
  materials.js      paint, glass, and every texture, drawn to canvas
  scene.js          renderer, image-based lighting, camera rig
  views.js          camera presets, derived from each car's dimensions
  ui.js             the designer panel
  main.js           state, URL sync, rebuild scoping
vendor/             three.js r185 + GLTF/Draco loaders (MIT), so this runs offline
```

## Where you'd go from here

- **Real models** — the single biggest quality jump available. See
  `models/README.md`.
- **Wheel GLBs** — instance real wheel models at the hub positions the loader
  already collects, instead of drawing faces.
- **Shadows** — a ground-projected shadow map or SSAO under the arches is the
  largest remaining fidelity gap.
- **Real car paint** — a flake normal map and coloured clearcoat, so metallics
  sparkle at grazing angles instead of just being shiny.
- **Save and share builds** — the URL already encodes everything; a short-link
  service and a render-to-PNG button are small additions.
