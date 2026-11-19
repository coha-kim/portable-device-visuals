# Portable Device Visuals

Harvey palm-device prototype on the native 480 × 480 round display. It is a port of the ambient-device-visuals lava-lamp sketch for a single owner: four wax orbs on #594F47 that wander on their own noise paths and fuse where they touch. The wax shades from #97D3B2 at the rim to #CFE0BD at thick centres.

## Interaction

Three independent channels:

- **Hold duration → attraction and size.** Holding lowers contact attraction from 0.8 to 0 over 8 seconds, and orbs shrink to half size, so they read as separate smaller blobs. At 0 they bounce instead of fusing.
- **Shake intensity → colour.** Harder shaking dulls the wax toward #729B82.
- **Movement is never changed by interaction.** Wander speed and direction come only from each orb's own noise path. Attraction acts only where orbs touch.

Release starts the shared recovery (5× hold time, 30–120 s): attraction, size and colour return together.

On a laptop, hold **Hold + shake test** and set the strength slider. The metrics line shows visible blobs, attraction, size and dullness.

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. The ambient project and shared `harvey-link-v1.mjs` protocol are unchanged. GitHub Pages remains on its last deployed release until a deployment.

Active entry points are `app.js`, `blobs.mjs` (ambient orb physics), `interaction-v15.mjs` (duration/intensity mapping) and `renderer.mjs` (ambient metaball field at half resolution). Existing older files are inactive history. Update current files directly; create a separate version or backup only when the user explicitly requests it.

## Reference and checks

Ported from `~/ambient-device-visuals/sketch.js` (same wander, contact attraction and field kernel; p5 noise replaced by a seeded Perlin implementation, no runtime library). The field runs at 240 × 240, upscaled to 480, at about 0.9 ms per frame on a desktop.

`npm test` checks that duration drives attraction and size, that intensity drives colour, that wander is independent of attraction, contact pull versus bounce, recovery, palette, fusing, trail-free repaint, frame-rate consistency, a six-minute run and paired delivery. This is a browser prototype; actual ESP32 firmware performance, IMU axes and physical panel colours require device testing.
