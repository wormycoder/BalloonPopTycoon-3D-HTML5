# Balloon Pop Tycoon 3D

A first-person idle shooter that runs in a browser tab. Walk around an arena, aim at
balloons and they pop themselves, spend the money on kiosks scattered around the plaza,
then rebirth for permanent multipliers and unlock new worlds.

**Everything you see is drawn by a WebGL2 renderer written from scratch for this project.**
No engine, no libraries, no bundler, no build step, no binary assets — the ground texture,
the balloon mesh, the kiosk signs and every sound effect are generated at runtime in about
3,000 lines of plain JavaScript.

![Sunny Meadow](screenshots/01-meadow.jpg)

## Play

Clone it and open `index.html`. That's the whole setup — it works straight off the
filesystem, no server required.

```bash
git clone https://github.com/<you>/balloon-pop-tycoon-3d.git
cd balloon-pop-tycoon-3d
open index.html          # or xdg-open / just double-click it
```

To publish it: push the repo, then **Settings → Pages → Deploy from branch → `main` / root**.
It will be live at `https://<you>.github.io/balloon-pop-tycoon-3d/` a minute later. A
`.nojekyll` file is already included so Pages serves everything verbatim.

There is also a one-file build at `dist/balloon-pop-tycoon-3d.html` if you would rather
hand someone a single download. Regenerate it with `node tools/bundle.mjs`.

## Controls

| | |
|---|---|
| `W` `A` `S` `D` | move |
| Mouse | look and aim (click the canvas to capture the pointer) |
| `Shift` | sprint |
| `Space` | jump |
| `E` | buy at the kiosk you are standing at |
| `Shift` + `E` | buy as many levels as you can afford |
| `R` | rebirth |
| `Tab` | statistics |
| `Esc` | pause |
| `M` | mute |

Aiming *is* shooting — whatever is under the crosshair takes damage at your fire rate, out
to your range. Hold the left mouse button to fire twice as fast. Arrow keys also turn the
camera, and if pointer lock is blocked (some embeds do) you can click-drag to look instead.

## What's in it

- **Ten balloon tiers**, from one-hit Reds up to 1,800 HP Prisms, weighted by how much
  firepower you actually have rather than by how many upgrades you own.
- **Eight upgrade kiosks** ringing the plaza — spawn rate, spawn limit, cash per hit, pop
  power, fire rate, range, crit chance and auto-popping drones. Each is a physical thing
  you walk to, with a live price sign that lights up when you can afford it.
- **Combos.** Every pop inside 2.4 seconds of the last one raises the multiplier, up to
  x3.80 and higher once you start rebirthing.
- **Golden balloons** drift up and away every 40–70 seconds. Catch one for a cash lump and
  20 seconds of triple income.
- **Bloatoons** — giant boss balloons that show up every few hundred pops and pay out like it.
- **Rebirth** for prestige points that permanently multiply income, and unlock arenas.
- **Five arenas**, each with its own sky, sun, fog, ground, props and income multiplier:
  Sunny Meadow, Sunset Dunes, Neon Night, Frostfield and Cloud Nine.
- **26 achievements**, a full statistics screen, autosave, offline earnings, export/import
  save strings, and settings for FOV, sensitivity, volume, render scale and effects.

![Standing in the swarm](screenshots/02-swarm.jpg)
![An upgrade kiosk](screenshots/03-kiosk.jpg)
![Neon Night](screenshots/04-neon.jpg)
![Sunset Dunes](screenshots/05-dunes.jpg)

## How the renderer works

`src/render.js` is a small forward renderer built directly on the WebGL2 API.

- **Sky** — one fullscreen triangle. The fragment shader reconstructs a world-space ray from
  the inverse view-projection matrix and shades it: a vertical gradient, a sun disc plus two
  glow lobes, a five-octave value-noise cloud layer projected onto a virtual plane, and
  hashed stars for the night arenas.
- **Ground** — a single subdivided plane that is translated to follow the camera every frame,
  so the world is effectively infinite. The plaza is not geometry; it is drawn *into* the
  ground shader as a radius-based blend with procedural paving rings, radial spokes and a
  glowing rim.
- **Instancing** — balloons, trees, kiosk boxes, drones and grass all go through one
  instanced shader. Each instance is three `vec4`s: position + scale, colour + emissive,
  and yaw + non-uniform scale ratios + glow.
- **Balloons** are a lathe (surface of revolution) built from a hand-tuned profile, so they
  have a real balloon silhouette and a knot, in one mesh. Lighting is wrapped diffuse plus
  fake subsurface transmission, a rim term and a Blinn highlight — the combination is what
  makes latex look like latex. They squash when hit.
- **Shadows** are soft blob decals: instanced quads laid flat on the ground, scaled by the
  balloon's height and faded by distance.
- **Particles** are camera-facing billboards built in the vertex shader from the camera's
  right/up vectors — alpha-blended confetti and additive sparks and shockwave rings.
- **Post** — the scene renders into an `RGBA16F` framebuffer, then a threshold pass, two
  ping-pong Gaussian blurs at quarter resolution, and a composite that adds bloom, applies
  an ACES filmic curve, a vignette and gamma.
- Everything is authored in sRGB and converted to linear in the shaders, so the lighting
  maths happens in the right space and the tone curve has something real to work with.

Textures are painted into offscreen 2D canvases at load: tileable value-noise for the
ground, a grass-blade alpha sprite, soft radial dots for shadows and glows, and the kiosk
signs, which are re-rendered whenever a price or level changes.

Audio is a handful of oscillators and a noise buffer wired up through the Web Audio API —
the pop is a pitch-dropping sine plus a swept band-pass noise burst.

![Statistics](screenshots/07-stats.jpg)

## Project layout

```
index.html          markup + HUD + menus
style.css           all the UI
src/math.js         mat4 / vec3
src/gl.js           shader, mesh, instancing, texture and framebuffer helpers
src/assets.js       procedural geometry and canvas textures
src/config.js       ALL balance and content data — start here to tune the game
src/render.js       shaders and render passes
src/game.js         simulation: player, balloons, shooting, economy, events
src/audio.js        Web Audio synth
src/save.js         localStorage + offline earnings
src/ui.js           HUD, minimap, floating numbers, menus
src/main.js         input, scene assembly, main loop
tools/bundle.mjs    optional single-file build
```

## Tuning it

`src/config.js` holds every number: balloon tiers, upgrade costs and effects, arena
palettes, achievements and the tuning block (walk speed, FOV of the arena, combo window,
rebirth curve). The effect functions are all multiplicative, so an upgrade level is worth
the same proportional amount at level 2 as at level 20:

```js
cashMult: (l) => Math.pow(1.20, l),
damage:   (l) => Math.pow(1.20, l),
fireRate: (l) => 3.2 * Math.pow(1.055, l),
```

The pacing was tuned by simulating the whole economy headlessly: first rebirth around ten
minutes, tenth around an hour of attentive play.

## Browser support

Needs WebGL2, which means any Chrome, Edge, Firefox or Safari from the last several years.
If the context cannot be created the game says so instead of failing silently. There is
basic touch support (left half of the screen moves, right half looks) but this is built for
a mouse and keyboard.

If it runs slowly, drop **Render scale** in Settings — the whole scene renders into an
offscreen buffer, so 70% costs about half the pixels and still looks sharp thanks to the
post pass.

## License

MIT — see [LICENSE](LICENSE). Do whatever you like with it.
