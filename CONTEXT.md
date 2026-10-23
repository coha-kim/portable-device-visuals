# Portable Device Visuals — current project context

Independent local project: /Users/seoha.kim/portable-device-visuals. Repository: https://github.com/coha-kim/portable-device-visuals. Keep ambient-device-visuals and capstone-poc separate.

The user wants the current files updated directly. Do not make a new numbered version unless explicitly asked. Existing old versions remain inactive history. The 400-particle model (physics-v15.mjs) is inactive; its active-file copies before the blob change are in versions/pre-blobs-v16/.

Current model (2026-10-23) returns to the v9 lava-lamp metaball look on the native 480 × 480 round display (Waveshare ESP32-S3-Touch-LCD-2.1B). Background #594F47 (fixed during interaction; confirmed by the user 2026-10-23). Wax colour: rim #97D3B2 to a lighter core #CFE0BD by field depth; dulls fully to #729B82 with energy. Colour dulling replaces the earlier opacity fade.

A fixed pool of 14 sub-blobs (radii 21–38 px) is held together by short-range cohesion, so at rest it reads as one slowly drifting, morphing blob. While held, live shake strength sets repulsion: each blob has a size-based grip (bigger holds on longer), so gentle shaking keeps one blob, medium shaking sheds small pieces from a core, and hard shaking breaks it into separate blobs. Split pieces wander independently, bounce off the circular wall and fuse again only when they collide (soft, partly inelastic contact). Energy (shake strength + held time) slows movement and dulls the colour. After release, the shared protocol decays repulsion and energy over 5× hold time (30–120 s), so the pieces gradually gather back into one blob. The WebSocket protocol is unchanged.

Active files: app.js; blobs.mjs (blob physics, fixed 60 Hz step); interaction-v15.mjs (repulsion/energy/dullness mapping, updated in place); renderer.mjs (compact-support metaball field at half resolution 240 × 240, upscaled); index.html/style.css; connection-v1/server-v1.mjs. The local preview is http://127.0.0.1:8038/ (.claude/launch.json). Tests: tests/blobs.test.mjs, tests/renderer.test.mjs.

Reference repos: huynonstop/metaball-canvas and mx0c/metaball-fluid-simulation (metaball field + bouncing balls). Concepts only; no code copied. Visual reference: lava lamp.

Desktop Node cost: ~0.8 ms per 240 × 240 field frame, <0.01 ms physics. ESP32-S3 frame rate, IMU calibration and panel colours remain unverified.
