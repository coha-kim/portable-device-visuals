# Portable Device Visuals — project context

Updated: 2026-10-07

## Project and scope

Repository: https://github.com/coha-kim/portable-device-visuals

HTTPS preview: https://coha-kim.github.io/portable-device-visuals/ (GitHub Pages, main branch / root).

Independent project at ~/portable-device-visuals, with a separate public GitHub repository named portable-device-visuals. Do not modify ambient-device-visuals or capstone-poc as part of this POC.

User requested mobile visuals, a hold button and shake interaction. The reference is a round recessed physical-looking button; implement bottom-left with no visible icon or text. It retains an accessible label. Full viewport, one owner's colour #2A9284, lighter gradient centres, ongoing jellyfish/lava-lamp movement and merging.

## Implemented interaction

- A real Enable motion button requests iOS permission in its user gesture; HTTPS is required.
- Hold captures the pointer, so drifting outside the button while shaking does not release it. Pointer up/cancel/lost capture, focus loss and hidden page release it safely.
- Only held, fresh motion readings above threshold change appearance.
- Intensity is accumulated normalized strength: harder shake reduces opacity faster. Opacity floor 0.12, rate 0.16/s at full shake; thresholds are provisional POC tuning.
- Period measures active shaking seconds, capped at 20 for this POC. It drives #ECEADB → #E2DDB1 independently of shake strength. Exact requested colours preserved; the endpoint is actually darker/more yellow, despite the original verbal description of lighter.
- Release preserves the result. Reload resets it. Movement runs independently and never speeds up with shaking.
- No automatic recovery or ambient networking in this iteration.

## Rendering

Eight smooth gradient blobs breathe and drift on the same independent slow paths. The user reported severe phone lag and residual traces with the original SVG filter. Rendering now uses a reusable half-resolution Canvas 2D scalar field capped near 90,000 pixels, with compact-support fields accumulated only inside each blob's bounds. Full opaque background and blob pixels are written every frame; no blur, SVG filter, or retained transparent frame. The visible canvas is capped to CSS resolution rather than device pixel ratio. Opacity blends the finished field shape into the background. Background CSS/theme updates occur only when the colour changes. Motion, hold and shake mappings are unchanged. No external dependencies.

## Overall intended user flow (future)

Ambient device shows one colour/population for each user. Portable device belongs to one owner and eventually uses a physical button. Holding/shaking creates intensity and period; these will be sent to ambient-device-visuals. Intensity will control that owner's population attraction; period sets how long attraction returns to baseline. Portable opacity will also slowly return to normal over a period-dependent duration. Direction and numeric mapping to ambient attraction, recovery curve, networking transport and hardware sensor calibration remain undecided.

## Validation

All ten tests pass, including new pixel-level checks for clearing previous positions, fading without changing geometry, and fusion across a gap. Updated Canvas preview checked in Chrome at 390 x 844 without console errors. At 195 x 422 internal resolution, a desktop Node benchmark measured about 0.31 ms median / 0.32 ms p95 for pixel calculation only (not phone frame time or total rendering cost). Actual phone improvement awaits user verification.

Node tests cover hold gating, harder-shake response, active duration, persistent release result, stale sensor data, opacity/background bounds, frame-rate independence and gravity fallback. Real phone permission flow, shake sensitivity, Safari rendering and physical hardware require device validation.

## Working preferences

Ask about material ambiguity before changing scope. Keep this repository separate; keep this context file current. Do not repeat explanations already given in chat.

## WebSocket v1 — 2026-10-19 (supersedes recovery/network status above)

`app.js` now uses `interaction-v1.mjs` and `harvey-link-v1.mjs`. Full button-hold duration, including pauses in shaking, sets recovery at 10× hold time. Intensity still comes from held shaking. Both portable appearance and the owner's ambient attraction recover on the same curve. The relay in `connection-v1/server-v1.mjs` serves both sibling projects; `npm run bridge` opens a pairing page on port 8787. Phone access uses an HTTPS/WSS tunnel. The base-teal population (index 1) is the default owner. Stronger shakes reduce its attraction to spread it farther from other populations; speed stays independent. Snapshots restore recovery on reconnect; socket closure and held-heartbeat timeout release holds. State is memory-only. See `connection-v1/README-v1.md`. Original files are in `versions/pre-websocket-v1/`. Physical-phone testing remains pending.

## Hold-only laptop testing v3 — 2026-10-19 (current default input)

The user requested hold duration alone while testing on a laptop. `app.js` now imports `interaction-v3.mjs`, defaulting to hold-only input. Held time increases intensity at 0.16/s, using absolute elapsed time; around 3.4 seconds reaches the <=0.6 ambient attraction setting. Recovery remains exactly 10× the full hold duration. The motion setup is hidden in hold mode and keyboard holds work too. `input=shake` explicitly restores the v1 phone interaction and setup. The relay allowlist serves the new module. Existing files are backed up in `versions/pre-hold-v3/`. Yellow ambient colour, autonomous speed and physics remain unchanged.

## Recovery tuning v4 — 2026-10-19

Current recovery multiplier is 5: a hold lasting N seconds returns both visuals to baseline over 5N seconds after release. This supersedes earlier 10× values. Hold-only input, intensity build-up, yellow population and the recovery curve are unchanged. Backups are in `versions/pre-recovery-v4/`.

## Recovery range v5 — 2026-10-19

Current recovery is 5× the full hold duration, clamped to 30–120 seconds for any positive hold. A zero-duration no-op has zero recovery. Examples: 3s → 30s; 10s → 50s; 24s or longer → 120s. This supersedes the unbounded v4 timing. Both copies of `harvey-link-v1.mjs` use `recoverySecondsFor`. The hold-only input and decay curve are unchanged. Backups are in `versions/pre-recovery-v5/`.

## Reference palette v6 — 2026-10-20

Sampled the centres of the supplied palette image: #009A8A, #3CBDAF, #77EDD7, #E1EBD7, #CAE7AD, left to right. There are three ambient populations, so their base colours use the first three in that order. The portable renderer matches its default owner, population index 1, with #3CBDAF. Both retain lightened centres. The temporary yellow is replaced by this palette. Recovery, interaction, population counts and background colours are unchanged. Pre-change files are saved in `versions/pre-palette-v6/`.

## Larger blobs v7 — 2026-10-20

Blob radius increased by 25% in both visuals. Ambient overallSize is 65 (previously 52). Portable uses 0.10625 of the shorter viewport dimension, clamped to 27.5–65 px (previously 0.085, clamped to 22–52 px). Palette v6 and the 30–120 second recovery remain. Pre-change files are saved in `versions/pre-size-v7/`.

## Round display prototype v8 — 2026-10-22

The current preview uses a fixed 480 × 480 native canvas and native scalar-field buffer, clipped to a circle for the confirmed Waveshare ESP32-S3-Touch-LCD-2.1. Eight existing blobs use a 51 px nominal radius (v7 ratio 0.10625 × 480), existing palette and breathing. Circular steering replaces rectangular edge steering; a radial limit keeps individual blob centres within the screen with their nominal radius. Controls are outside the circular display. Interaction, recovery and networking are unchanged. Browser pixel layout is not a calibrated physical-size or ESP32 frame-rate preview. Backup: `versions/pre-round-display-v8/`.

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
