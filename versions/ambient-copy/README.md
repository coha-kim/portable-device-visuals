# Portable Device Visuals

Harvey palm-device prototype on the native 480 × 480 round display. It shows an exact copy of the latest [ambient-device-visuals](../ambient-device-visuals) sketch (v40: three colours of lava-lamp wax drops that heat, rise, cool, sink, split and merge, with surface tension, convection, free wander, momentum and a three-screen-wide world). The ambient `sketch.js` is kept byte for byte in `ambient/sketch.js`; the page runs `ambient/sketch-portable.js`, generated from it with only these patches (`ambient-portable.mjs`):

- **Square lamp:** `CANVAS_H` 1024 → 600, so the lamp is 600 × 600 instead of 600 × 1024 portrait. The width stays 600, so every px-tuned ambient value keeps the same proportion to the screen; the canvas is shown at 480 × 480 inside the round display.
- **Teal only:** one population (`POP_COUNT` 1) in the ambient teal #00E2B7; the green and blue wax are removed.
- **Adjustable fusing:** `DRAIN_FRAMES`, `SEPARATING_SPEED` and `FUSE_REACH` become `let` so the Merging slider can change them.
- **Background:** #594F47 (the portable's standing background) instead of ambient's #2F302F.

Everything else (drop sizes, physics, rendering, `?tune` panel, `window.harveyWax`) is the ambient code unchanged. Open http://127.0.0.1:8038/?tune for the ambient wax tuning panel.

## Wax sliders

Each slider sets the sketch's own live value, and Reset returns to the ambient defaults:

- **Blob size:** `overallSize` 30–110 (ambient 65, shown as 100%).
- **Merging:** 0–1 (default 0.5 = the ambient fusing rules exactly). 0: drops never fuse. Higher: touching drops fuse after less contact (40 → 14 frames), from further apart and even while drifting apart, with a pull toward each other. Measured over 4 × 3 simulated minutes: 0, 6.5, 8, 9 and 10 merges per 3 minutes at 0, 0.25, 0.5, 0.75 and 1.
- **Speed:** the population speed ×0–3 (ambient 1): wander and rise/sink speed.
- **Gravity:** `BUOYANCY_PX` 0–2.5 px/frame (ambient 0.8): how fast warm wax rises and cool wax sinks. 0 = no rising or sinking, only wander and convection.

## Interaction

Hold and shake exactly as on the ambient display: `app.js` provides the `window.harveyAmbientV1` hook the sketch calls each frame, mapping each population's intensity to its colour attraction with the shared `attractionFor` (baseline 0.8, lower with shake). Paired, it uses the room's states; standalone, this portable's own hold/shake. With one colour on the portable, attraction (which only acts between different colours) has no visible effect here; it still reaches the ambient display. Instead, shaking reduces merging in proportion to how long it lasts (`shake-drain.mjs`): the live merging is the slider × (1 − drain). Each second of held shaking (intensity > 0.12) drains a tenth, so after 10 s drops stop merging; holding still pauses it, and after release merging seeps back over 30 s. The status line shows live and slider merging.

## Sync

After the ambient sketch changes, run `npm run sync-ambient` (optionally with the path to ambient-device-visuals). It copies `sketch.js` and p5, and regenerates the portable build. `npm test` fails if the copy is out of date, if a patch no longer matches exactly once, or if the build differs from the ambient file by anything but the patches.

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. `harvey-link-v1.mjs` now matches the ambient repository's copy (baseline attraction 0.8).

The previous soft-body jelly (softbody.mjs, renderer.mjs, its sliders and tests) is saved in `versions/pre-ambient-copy/`. This is a browser prototype; ESP32 performance, IMU axes and panel colours need device testing.
