# Portable Device Visuals — current project context

Independent local project: /Users/seoha.kim/portable-device-visuals. Repository: https://github.com/coha-kim/portable-device-visuals. Keep ambient-device-visuals and capstone-poc separate.

The user now wants the current files updated directly. Do not make a new numbered version or a backup unless explicitly asked. Existing old versions remain inactive history.

Current model is a fixed population of 400 small particles suspended inside the native 480 × 480 round display, inspired by a snow globe and https://magnum.graphics/showcase/fluidsimulation2d/. Keep #594F47 background and #97D3B2 particles. No emitter, gravity, merging or membrane deformation in the active model.

At rest particles move steadily with independent smooth drift, local viscosity, hard particle contact and circular wall bounce. While held, intensity and elapsed hold raise repulsion, lower speed and lower opacity immediately. Stronger sensor input changes motion direction without exceeding the reduced speed ceiling. After release, keep the low-energy state and recover over 5× the full hold duration, clamped 30–120 seconds. The shared WebSocket protocol is unchanged.

Active files: app.js; physics-v15.mjs (now particle physics, updated in place); interaction-v15.mjs (particle behaviour); renderer.mjs (small separate particle drawing); index.html/style.css; connection-v1/server-v1.mjs. No extra runtime library or network asset is needed. The local preview is http://127.0.0.1:8038/. Update existing model/renderer tests when the active behaviour changes.

The Magnum source is APIC with grid pressure/particle transfer. This is an original lightweight adaptation of fluid-like neighbour pressure and motion for 400 particles, not a port of that complete engine. The reference implementation and source were inspected; no code was copied.

Physical ESP32 firmware implementation, actual IMU calibration, panel colours and long event endurance remain unverified by browser tests. No Pi or GitHub deployment is part of this change.
