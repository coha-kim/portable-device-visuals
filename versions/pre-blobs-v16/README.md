# Portable Device Visuals

Harvey palm-device prototype: exactly 400 suspended particles inside the existing native 480 × 480 circular display. Background #594F47, particles #97D3B2. Particle radii are 1.4–2.15 pixels, half the previous size. The particles are created once, remain separate and bounce off the circular edge. There is no emitter, gravity, metaball merge or deformable mesh in the active rendering.

## Interaction

At rest, particles drift steadily with independent, smoothly changing headings and a small local viscosity that shares motion with nearby neighbours. Holding the external button starts an immediate visible response. Stronger held shaking and longer holds increase near-neighbour repulsion, reduce the speed ceiling to 22 percent and fade opacity toward 18 percent. Repulsion acts over a wider short-range neighbourhood as input increases. It remains a pair force rather than a shared centre or orbital force. Even strong sensor input cannot exceed the current reduced speed ceiling.

Release retains the low-energy appearance and motion, recovering with the existing shared protocol: 5 × full hold duration, clamped to 30–120 seconds. Pressing again continues from the remaining state. Sensor acceleration and gyro forces are accepted only while held. On a laptop, hold the round button for the basic interaction or hold **Hold + shake test**; the strength slider changes the simulated shake. There is no canvas grab or particle emission.

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. The ambient project and shared `harvey-link-v1.mjs` protocol are unchanged. GitHub Pages remains on its last deployed release until a deployment.

Active entry points are `app.js`, `physics-v15.mjs` (particle solver, updated in place), `interaction-v15.mjs` (particle mapping, updated in place) and `renderer.mjs` (particle drawing). Existing older files are inactive history. Update current files directly; create a separate version or backup only when the user explicitly requests it.

## Reference and checks

Movement reference: [Magnum 2D fluid simulation](https://magnum.graphics/showcase/fluidsimulation2d/) and its [APIC solver source](https://doc.magnum.graphics/magnum/fluidsimulation2d_2FluidSolver_2ApicSolver2D_8cpp-example.html), also in [magnum-examples](https://github.com/mosra/magnum-examples). This browser implementation adapts the local pressure, neighbourhood motion and boundary response to a fixed, sparse snow-globe population. It uses a small particle pair solver rather than compiling the complete APIC engine. No reference code or assets were copied.

`npm test` checks fixed population, immediate repulsion and slowing, speed ceilings, collisions, opacity/recovery, frame-rate consistency, extended runs and paired delivery. This is a browser prototype; actual ESP32 firmware performance, IMU axes and physical panel colours require device testing.
