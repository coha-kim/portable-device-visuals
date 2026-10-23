# Portable Device Visuals

Harvey palm-device prototype on the native 480 × 480 round display: a lava-lamp metaball blob on #594F47. The wax shades from #97D3B2 at the rim to #CFE0BD in thicker areas and dulls toward #729B82 as energy rises.

## Interaction

- **Idle:** 14 sub-blobs held together by cohesion read as one blob that drifts and slowly changes shape.
- **Hold + shake:** shake strength sets repulsion. Gentle shaking keeps the blob together (only the wall can pull it apart), medium shaking sheds smaller pieces, and hard shaking splits it into separate blobs. These bounce off the circular edge and fuse only when they collide.
- **Energy:** shake strength plus held time slows movement and dulls the colour.
- **Release:** the shared recovery (5× hold time, 30–120 s) gradually lowers repulsion, so the pieces drift back together into one blob.

On a laptop, hold **Hold + shake test** and set the strength slider. The metrics line shows how many visible blobs there are, plus speed, dullness and repulsion.

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. The ambient project and shared `harvey-link-v1.mjs` protocol are unchanged. GitHub Pages remains on its last deployed release until a deployment.

Active entry points are `app.js`, `blobs.mjs` (blob physics), `interaction-v15.mjs` (repulsion/energy mapping) and `renderer.mjs` (half-resolution metaball field). Existing older files are inactive history. Update current files directly; create a separate version or backup only when the user explicitly requests it.

## Reference and checks

Metaball references: [huynonstop/metaball-canvas](https://github.com/huynonstop/metaball-canvas) and [mx0c/metaball-fluid-simulation](https://github.com/mx0c/metaball-fluid-simulation). This implementation uses the v9 compact-support field (no sqrt per pixel) at 240 × 240, upscaled to 480. It costs about 0.8 ms per frame on a desktop. No reference code was copied.

`npm test` checks that idle stays one blob, that the split is graded by shake strength, that collided blobs fuse, slowing and speed ceilings, re-merging after release, palette and dulling, trail-free repaint, frame-rate consistency, a six-minute run and paired delivery. This is a browser prototype; actual ESP32 firmware performance, IMU axes and physical panel colours require device testing.
