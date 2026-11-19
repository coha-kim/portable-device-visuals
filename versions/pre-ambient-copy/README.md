# Portable Device Visuals

Harvey palm-device prototype on the native 480 × 480 round display: six small jelly soft bodies on #594F47. Each is filled with one solid colour, the ambient owner teal #00E2B7, with no outline, highlight or gradient, and a blurry, translucent border (thin bands fading in over about 18 px, plus a half-resolution buffer smoothed up to 480 × 480). Each is a ring of spring-linked nodes with internal pressure. Each wanders loosely along its own random path with a free random drift on top (Free wander slider); collisions never change the path or the drift. Blobs keep a little personal space: they bump, squash and slide past each other instead of clumping. Speed runs ×0–8. They gently change shape on their own, and squash and spring back when they meet each other or the round glass.

## Controls

The page is unstyled, with browser-default controls on white. Only the round display has styling. Jelly sliders:

- **Spring stiffness:** 0.02 (floppy) to 0.40 (firm). Default 0.15, as in the reference. Sets how hard the shape springs back.
- **Size of blobs:** ×0.5 to ×2 of the 36 px radius.
- **Collision deformation:** 0–100% (default 75%). Sets how much of each contact becomes a local dent, versus pushing the whole blob away. This is separate from stiffness: deformation is how much a blob gives, and stiffness is how fast it recovers.
- **Number of blobs:** 1–10 (default 6).
- **Gravity:** off to 0.05 px/frame². The reference uses 0.025.
- **Translucency:** opaque (default) to 90% see-through. Overlapping blobs and the background show through.
- **Speed:** ×0 to ×8 of the pace along each random path (about 22 px/s at ×1, 65 at ×3, 165 at ×8).
- **Sliminess (at rest):** 0–100% (default 80%): gooey, slow-oozing outlines; touching blobs (and the glass) stick with strands that stretch and snap. Shaking drains it in proportion to shake time (plain jelly after 10 s of shaking); it seeps back over ~30 s after release.
- **Free wander:** 0–100% (default 60%): how loosely each blob follows its path; higher adds more random drift.
- **Wobble:** 0–30% self-morphing (default 11%).
- **Reset** returns all sliders to their defaults.

The hold button and shake test still drive the shared ambient protocol, but are not mapped to the jelly yet.

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. The ambient project and shared `harvey-link-v1.mjs` protocol are unchanged. GitHub Pages remains on its last deployed release until a deployment.

Active entry points are `app.js`, `softbody.mjs` (spring-mass soft bodies), `renderer.mjs` (jelly drawing) and `interaction-v15.mjs` (hold/shake state for the protocol). Existing older files are inactive history. Update current files directly; create a separate version or backup only when the user explicitly requests it.

## Reference and checks

Soft-body reference: [makoto-lee/softbody-physics-simulation](https://github.com/makoto-lee/softbody-physics-simulation), which uses a spring-mass model with anti-collapse and edge-projection collisions. It cites the [Matyka pressure soft-body paper](https://www.researchgate.net/publication/228574502_How_to_implement_a_pressure_soft_body_model). Here the bodies are circular rings rather than rectangular grids, with pressure added. No code was copied. Physics takes about 0.04 ms per frame on a desktop.

`npm test` checks six round bodies, drift and morphing without contact, slider mapping, collision deformation versus push, adding and removing blobs, gravity settling, softer springs denting more on collision, squash and recovery against the border, two-minute stability at every stiffness, frame-rate consistency and paired delivery. This is a browser prototype; ESP32 performance, IMU axes and panel colours need device testing.
