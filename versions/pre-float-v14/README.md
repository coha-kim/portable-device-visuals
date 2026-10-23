# Portable Device Visuals

A mobile POC: one owner's turquoise (#3CBDAF) gradient metaballs, a blank recessed corner button, and hold-to-shake interaction. A compact Canvas 2D scalar field renders smooth fused shapes without SVG filters, blur passes, or external libraries. Every frame fully replaces the background to prevent trails.

## Use

For connected v1 testing, use the HTTPS pairing links from the relay below. The existing [GitHub Pages preview](https://coha-kim.github.io/portable-device-visuals/) stays on its previously published version until a deployment.

Open the HTTPS site on a phone, tap **Enable motion**, and grant motion access. Hold the bottom-left button while shaking:

- Harder shaking accumulates **intensity** faster and lowers opacity, down to 12%.
- Full button-hold time controls the background period, transitioning #ECEADB to #E2DDB1 over 20 seconds. Holds longer than that still extend recovery.
- Holding still extends the period without increasing intensity. Shaking without holding adds no intensity.
- Release starts recovery: the full button-hold duration sets how long opacity and background take to return to baseline (5× hold time, limited to 30–120 seconds).

The requested endpoint is more yellow and darker numerically than the starting colour; the exact supplied colours are preserved.

WebSocket v1 connects this portable to the ambient display. Run `npm run bridge` and open http://127.0.0.1:8787/ for paired links. See [connection-v1/README-v1.md](connection-v1/README-v1.md) for HTTPS phone access, recovery tuning and testing. Phone sensor feel must be tested on the actual device.

## Development

`npm start` (or `python3 -m http.server 8000`) serves the files locally. Motion on a separate phone requires HTTPS; a plain LAN HTTP URL is for visual preview only. `npm install` installs the relay dependency; `npm test` runs model, renderer and real socket integration tests. No build is necessary.

`interaction-v1.mjs` contains the active interaction and recovery model. `interaction.mjs` retains the original thresholds and motion reader. `app.js` handles sensors, holding, and animation. See [CONTEXT.md](CONTEXT.md) for scope and intended future integration.

Longer holds now set recovery duration independently of shake strength. Movement remains independent. Previous files are saved under `versions/pre-websocket-v1/`.

## Hold-only laptop testing v3

Default input now uses button-hold duration alone. Open the paired portable link, then hold the corner button with the mouse (or focus it and hold Space/Enter). Intensity grows at 0.16 per second: approximately 3.4 seconds reaches the ambient bounce-only setting, and 6.25 seconds reaches maximum intensity. No motion permission is needed. Release keeps the 5× hold-duration recovery, limited to 30–120 seconds. Re-holding starts from the current remaining intensity. The background still follows full hold duration. For the original phone interaction, append `&input=shake` to a paired portable URL. Pre-change files are under `versions/pre-hold-v3/`.

Recovery v5: after any positive hold, recovery lasts at least 30 seconds and at most 2 minutes. The middle range follows 5× the full hold duration (e.g. 10 seconds held → 50 seconds recovery). Holds of 24 seconds or longer reach the 2-minute maximum.

Palette v6: the portable uses #3CBDAF, matching the second ambient population. The ambient palette uses the first three reference swatches: #009A8A, #3CBDAF, #77EDD7. Previous files are backed up in `versions/pre-palette-v6/`.

## Round display prototype v8 — 2026-10-22

Current local preview targets the Waveshare ESP32-S3-Touch-LCD-2.1: fixed 480 × 480 canvas pixels and a 480 px diameter circular viewport. The scalar field also renders at native 480 × 480 resolution, independently of browser size and device pixel ratio. Browser zoom and monitor scaling affect apparent physical size; this is a pixel-layout preview, not calibrated to a physical 2.1-inch diameter.

The eight blobs retain palette v6, v7 proportional radius (51 px at 480 px), breathing, and independent drift. Steering and containment use the circular edge. The test button and instructions sit below the screen to represent an external physical button. Hold/shake, recovery, and WebSocket protocol are preserved. This remains a browser prototype; ESP32 firmware performance and panel colour are not verified by it. Pre-change files: `versions/pre-round-display-v8/`.

## Palm palette v9 — 2026-10-22

The round preview now uses background `#594F47` and blob base colour `#97D3B2`, retaining the existing lighter centres. The supplied brown stays fixed during interaction; hold/shake still fades blob opacity and uses the existing recovery timing. Size, drift, circular bounds and networking are unchanged. Backup: `versions/pre-palette-v9/`.

## Separate collision blobs v10 — 2026-10-22

Current local prototype uses eight independent gradient circles, nominal radius 51 px, inside the existing 480 × 480 circular screen. Colours remain #594F47 / #97D3B2. Active rendering uses `renderer-v10.mjs` (Canvas paths), not a shared metaball field. The older renderer is retained only for backup/history and legacy tests.

`physics-v10.mjs` uses pinned, locally vendored Matter.js 0.20.0, 96 static wall segments, fixed 60 Hz simulation, zero gravity and bounded input. Baseline restitution is zero: collisions resolve without elastic rebound or deformation. Gentle autonomous drift remains. More duration increases restitution to 0.88; stronger current shake enables impact squash and a damped shape recovery. Collision squash is a visual approximation on rigid collision bodies, not a full soft-body simulation. Matter Wrap is deliberately absent because wrapping teleports bodies across boundaries; this prototype uses a bouncing circular boundary.

`interaction-v10.mjs` gates vector acceleration to button-held, fresh readings. Shake strength is normalized from 1.4–16 m/s², independently of hold duration. The full hold including still time drives opacity from 1 to 0.12 over 20 seconds and rebound from 0 to maximum over 12 seconds. Deformation is enabled by rebound and scaled by shake intensity and impact speed. On release, the existing 5× full-hold recovery clamped 30–120 seconds restores appearance/rebound; only fresh held samples can add physical shake force. Re-holding retains current recovery state. The unchanged WebSocket protocol still publishes intensity and hold/release to the ambient display.

Laptop testing: hold the physical-style button and drag to simulate container acceleration, or hold `Hold + simulate shake`; its strength slider changes shake intensity independently of hold duration. Space/Enter on the focused controls works too. `Use phone motion` requests motion access only through the Enable motion gesture. Vector input uses acceleration without gravity where available, filtered gravity fallback otherwise, and screen orientation mapping. Phone axes, IMU calibration and physical display performance still require device testing. This is a browser prototype, not ESP32 firmware. Pre-change files: `versions/pre-collisions-v10/`.

## Fluid-inspired movement v11 — 2026-10-22

Reference inspected: https://magnum.graphics/showcase/fluidsimulation2d/ (APIC / WebAssembly / WebGL2). This version adapts its inertial motion, sweeping circular boundary contacts and directional sloshing to eight separate blobs. It is not a port of the full APIC fluid solver. The native 480 × 480 circle, 51 px nominal radii, #594F47 background, #97D3B2 gradient blobs and independent contours remain.

Active physics: `physics-v11.mjs`. Removed destination/velocity-chasing drift, lowered air drag, seeded persistent movement, added modest along-path propulsion and symmetric near-neighbour momentum sharing. The user selected gentle baseline bounce; restitution now starts at 0.28 and rises toward 0.88 with duration. This supersedes v10's zero-restitution baseline. Baseline deformation remains zero. Bodies remain independent and cannot merge. Motion is integrated at a fixed 60 Hz; maximum speed and circular containment protect against sensor spikes.

`interaction-v11.mjs` retains v10's full-hold opacity/rebound mapping and 30–120-second recovery. Held linear acceleration applies inertial pushes; orientation supplies projected gravity, and gyroscope angular speed drives bounded rotational-frame forces. Rotation can contribute to input intensity/deformation. Input is gated while held and expires if stale; releasing removes incoming sensor force while existing momentum continues. Browser `rotationRate.alpha` is converted from degrees/sec around the screen-normal Z axis into screen-coordinate radians/sec. Beta/gamma orientation and screen orientation determine the tilt direction. These are approximations requiring actual phone/IMU calibration.

Laptop buttons `Hold + shake test` and `Hold + tilt / turn` simulate both inputs. `Test strength` varies input amplitude without changing duration. Phone permission requests for motion and orientation start from the Enable motion button. This remains a local browser prototype, not deployed ESP32 firmware. Pre-change files: `versions/pre-fluid-motion-v11/`.

## Gravity and direct attraction v12 — 2026-10-22

Corrected reference: https://www.grantkot.com/blob/ . Inspected the running demo and its public `blob2.js`: separate blobs fall under downward gravity, are pulled toward the pointer and deform against a moving terrain. This prototype adapts the directional gravity and direct pointer attraction to the existing round boundary; it does not reproduce the moving terrain or its full deformable vertex solver. No reference source was copied.

Active `physics-v12.mjs` removes v11's seeded velocities, along-path propulsion, curl, neighbour-velocity field and centrifugal/Coriolis forces. Bodies start from rest, accelerate downward at 120 canvas px/s², bounce at the boundary and can settle/sleep. A pointer-held attractor uses softened inverse-distance attraction with damping. Releasing removes attraction and leaves gravity active. Baseline restitution remains the user-approved 0.28, rising to 0.88 with duration; colours, 480 × 480 round canvas, separate contours and collision squash remain.

`interaction-v12.mjs` retains duration/opacity/rebound, intensity/deformation and 30–120-second recovery. Live orientation changes passive gravity direction, while shaking remains button-gated. Gyro predicts gravity direction instead of injecting swirl forces. Physical axis direction, scale and IMU calibration require hardware verification. Laptop: drag within the circle to pull blobs; `Hold + tilt test` applies the selected fixed direction, with no automatic rotating tilt. The shake test remains an explicit simulated input. Browser prototype only; no hardware deployment. Pre-change files: `versions/pre-gravity-v12/`.

## Deformable membranes without gravity v13 — 2026-10-22

User rejected global oval scaling and gravity. Active v13 uses a position-based particle membrane: 24 independent boundary particles plus a centre particle per blob, linked by edge, bending and radial distance constraints, with an area constraint. Contact pushes local vertices and the constraints transmit displacement through neighbouring vertices. Compliance increases with input intensity; constraints and particle momentum produce deformation/recovery, with no ellipse scale or circle-morph animation. This is a cloth-like enclosed membrane, not a textile-material or full 3D cloth model. Gradient colour is drawn inside the actual simulated boundary.

`physics-v13.mjs` runs at 120 Hz with six XPBD constraint passes. Contacts use vertex/edge collision constraints and restitution. Boundary constraints account for every surface vertex. Gravity, tilt gravity, ongoing swirl and propulsion are absent. Gentle initial momentum and held linear input move bodies; changes in held gyro rate create a bounded transient inertial response. Bodies remain separate. The eight nominal radii remain 51 px inside the native 480 × 480 round display; colours stay #594F47 / #97D3B2.

`interaction-v13.mjs` maps intensity directly to material flexibility, independently of hold duration. Full hold time retains the existing opacity/rebound mapping and 30–120-second recovery. Laptop: grab and drag a blob edge to directly test its material, or hold the shake test. The drag test supplies the selected test intensity without a global force. Active rendering no longer loads Matter.js or uses rigid collision proxies; older versions/dependencies are retained for history and legacy tests. Physical IMU tuning and ESP32 implementation remain unverified. Backup: `versions/pre-mesh-v13/`.
