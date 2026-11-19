# Portable Device Visuals — current project context

Independent local project: /Users/seoha.kim/portable-device-visuals. Repository: https://github.com/coha-kim/portable-device-visuals. Keep ambient-device-visuals and capstone-poc separate.

The user wants the current files updated directly. Do not make a new numbered version unless explicitly asked. Existing old versions remain inactive history. The 400-particle model (physics-v15.mjs) is inactive; its active-file copies before the blob change are in versions/pre-blobs-v16/.

Current model (2026-10-23, second pass) ports the ambient-device-visuals sketch.js working tree (the version the user served on :8000) to the native 480 × 480 round display (Waveshare ESP32-S3-Touch-LCD-2.1B). The user asked to drop the earlier split/repulsion description in favour of this. Background #594F47 (confirmed). Wax: rim #97D3B2 lightening toward #CFE0BD with field depth; dulls fully to #729B82.

Four orbs (one larger master), sized from the ambient overallSize scaled 480/600 (~67–92 px radius), each wander on their own seeded Perlin walk at the ambient speed (0.72 px per 60 Hz frame × 0.35–1.10). Attraction acts only while two orbs overlap: above 0 it pulls them together so the field fuses them; at 0 a hard floor makes them bounce. Attraction never changes wander speed or direction.

Interaction mapping (interaction-v15.mjs): hold duration (protocol period) lowers attraction linearly from 0.8 to 0 over 8 s and shrinks radii to 50%, so orbs read as separate smaller blobs. Live shake intensity alone dulls the colour. No sensor force moves the orbs. After release the shared protocol (5× hold, 30–120 s) recovers attraction, size and colour together. The WebSocket protocol is unchanged.

Active files: app.js; blobs.mjs (OrbPhysics, fixed 60 Hz frames); interaction-v15.mjs; renderer.mjs (ambient kernel (1 - d²)², iso 0.20 ± 0.10, at 240 × 240 upscaled; the ambient wall mirror is omitted because orbs are always fully inside the glass); index.html/style.css; connection-v1/server-v1.mjs. Preview: http://127.0.0.1:8038/ (.claude/launch.json). Tests: tests/blobs.test.mjs, tests/renderer.test.mjs. The previous split/merge model is in git history (d798e07).

Desktop Node cost: about 0.9 ms per 240 × 240 field frame for four orbs. ESP32-S3 frame rate, IMU calibration and panel colours remain unverified.
