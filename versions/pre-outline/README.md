# Portable Device Visuals

Harvey palm-device prototype on the native 480 × 480 round display: fourteen small jelly soft bodies (radius about 22 px) on #594F47. Each is filled with one solid colour, the ambient owner teal #00E2B7, with no outline, highlight or gradient (the **Colour** slider changes the hue: every hue keeps the teal's saturation and lightness, so all choices are equally vivid on the background, and the slider's readout shows a swatch and hex code). Edges are crisp: each blob is a single fill drawn straight onto the 480 × 480 canvas, with no blur or soft border.

**Real size:** the **Display size** box above the sliders has a **Real size (53.28 mm diameter)** checkbox. A browser can't measure a screen's physical size (CSS millimetres assume 96 px per inch; a MacBook screen shows about 127), so it needs a one-time calibration:

1. Hold a bank card (85.60 mm wide) against the screen.
2. Drag **Screen calibration** until the card outline matches the card.

The calibration and the checkbox are remembered in that browser. Keep the browser zoom at 100%. The canvas still renders 480 × 480 pixels and is scaled to fit.

## Physics

`softbody.mjs` follows lisyarus, [Making a 2D soft-body physics engine](https://lisyarus.github.io/blog/posts/soft-body-physics.html), driven only by the device's own gravity. Units are px and seconds, in fixed 1/240 s steps.

Rules from the article:

- **Point masses:** each body is a ring of 16 unit-mass points, integrated with symplectic Euler (forces update velocities, then velocities update positions).
- **Shape matching:** instead of a spring mesh, each body has a rest shape. Every step the best-fit rotation θ = −atan2(Σ r×q, Σ r·q) places the rest shape on the current centre of mass, and a spring pulls each point toward its matched position. This keeps the shape without turning inside out.
- **Damping:** each point's velocity is blended toward the body's rigid motion (centre velocity plus average spin) by 1 − exp(−damping·dt). Wobble dies down, but the glide and spin survive.
- **Stability:** stiffness·dt² stays well below 1 (at most 0.05).
- **Collision detection:** each point checks the round glass and every other nearby body. Only the collision with the largest penetration depth is resolved.
- **Collision resolution:** the point is pushed out along the normal (no sinking). The normal velocity becomes −elasticity·vn and the tangential velocity is multiplied by exp(−friction·dt). Velocity is only resolved while the point moves into the collider. Against another body the correction is shared with that edge's two points, so momentum is kept.

Modifications:

- **Device gravity is the only driving force.** Tilting or moving the device gives every blob the same acceleration (`gravity.mjs`): the accelerometer's reading includes gravity, and the contents feel the opposite of it. Lying level and still, nothing moves: blobs coast to a stop under drag and stay put. Below 0.05 g (a device on a table, slightly off level) counts as level.
- **Perfect circles at rest:** the rest shape is an exact circle (wobble defaults to 0). Blobs squash on contact through the same shape-matching springs and turn round again once free.
- **Exit along the radius:** a point inside another blob leaves along the line from that blob's centre, not through the nearest edge. Under a pile's weight the nearest-edge rule let points exit through the far side and fold blobs inside out.
- **Area-keeping pressure:** pushes a squashed outline back out, so heavy piles can't crush a blob flat.
- **Resting contact:** contacts slower than 20 px/s don't bounce, and there is no extra contact gap. Together these stop piles jiggling: a pile under a steady tilt drifts at most about 1 px/s, under 0.2 mm/s on the panel.
- **Speed control:** drag (exp(−drag·dt)) lets blobs settle, and a top speed caps each blob's centre speed. The wobble about the centre is untouched.
- **Interaction forces:** attraction (up to 3× the touching distance) and repulsion (up to 1.6×), both fading linearly with distance. Both default to off: with the device level they would keep a pile creeping for 30 s or more.
- **Body-level elasticity:** bouncing single points barely changes how bodies rebound. The shape springs store the impact and push them apart again: 65 px/s at elasticity 1 and 58 at 0, before this rule. So while two bodies touch, or a body touches the glass, their parting speed is capped at elasticity × the speed they met at. The cap eases off by 10 px/s per second of contact, so inelastic contacts still come apart. Measured rebound from an 80 px/s head-on meeting: 65, 40 and 8 px/s at elasticity 1, 0.5 and 0.
- **Wobble (optional):** above 0, the rest shape slowly morphs (a rotating oval plus a smaller trefoil).

## Controls

The page is unstyled, with browser-default controls on white. Only the round display has styling. Jelly sliders, with Reset:

| Slider | Range | Default |
|---|---|---|
| Shape stiffness | 50–3000 /s² | 600 |
| Wobble damping | 0–20 /s | 4 |
| Elasticity | 0–1 | 1 (shaking lowers it) |
| Friction (on contact) | 0–50 /s | 4 |
| Gravity strength | 0–2000 px/s² per g | 600 |
| Max speed | 10–600 px/s | 300 |
| Drag | 0–5 /s | 1.2 |
| Attraction | 0–100 px/s² | 0 |
| Repulsion | 0–300 px/s² | 0 |
| Size of blobs | ×0.5–2 of 22 px | ×1 |
| Number of blobs | 1–30 | 14 |
| Wobble (shape morph) | 0–30% | 0% (perfect circles) |
| Colour | hue 0–360° | 169° (the ambient teal #00E2B7) |
| Translucency | opaque–90% | opaque |

**Tilt:** a phone uses its motion sensor once **Use phone motion → Enable motion** is on. On a laptop, the **Tilt** box has *Tilt right* and *Tilt toward you* sliders (degrees) and a **Level** button; its readout shows the gravity in g and where it comes from. The **Hold + shake test** also shakes the device virtually, so the blobs slosh.

At 0.5 g a falling pile settles at the low side within about 5 s. When the device is level again, blobs stop within about 5 s and return to perfect circles.

**Shaking:** holding and shaking lowers elasticity in proportion to how long it lasts. Live elasticity is the slider × (1 − drain); each second of held shaking adds 1/10 of drain. Shaking also lowers the top speed by up to 60%. Holding still pauses the drain, and after release it seeps back over 30 s. The status line shows live and slider elasticity. Shaking still drives the shared ambient protocol.

## Colour transfer (prepared, not yet on hardware)

Picking a colour and then tapping the portable near the ambient display sends that colour to the ambient display, where it becomes this portable's population colour. Built so far:
- the protocol message (`colour`, additive to v1);
- the relay server storing it and broadcasting `snapshot.colours`;
- `link.sendColour()`;
- the tap rules in `proximity.mjs` (`NearDetector`: smoothed Bluetooth signal strength, dwell, hysteresis, cooldown);
- a **Tap ambient: send colour** button that stands in for the sensing in the browser.

Still to do: the ambient sketch fading to the received colour, and the real sensing on the ESP32 and Pi. Both are written up in [docs/colour-tap.md](docs/colour-tap.md).

## Run and connect

`npm start` serves the standalone prototype. The current local preview runs at http://127.0.0.1:8038/. `npm run bridge` serves paired portable and ambient links at http://127.0.0.1:8787/. Phone motion needs HTTPS and an explicit **Enable motion** gesture. GitHub Pages remains on its last deployed release until a deployment.

Backups:

- The wander-driven version (before device gravity) is in `versions/pre-gravity/`.
- The previous spring-mass jelly (random paths, slime) is in `versions/pre-lisyarus/`.
- The ambient-sketch copy is in `versions/ambient-copy/`.

Tests in both are saved as `.orig`.

Active entry points are `app.js`, `softbody.mjs`, `renderer.mjs` (jelly drawing) and `interaction-v15.mjs` (hold/shake state for the protocol). Update current files directly; create a separate version or backup only when the user explicitly requests it.

## Checks

`npm test` checks:

- the article's rules: straight gliding with nothing acting, rotation-invariant shape matching and recovery from a squash, damping toward rigid motion, deepest-collision choice, and the exact bounce and friction formulas, with momentum kept;
- device gravity: level and still means settled perfect circles that stay put (also inside the dead zone); a tilt moves every blob; a steady tilt piles them up at rest; level again, they turn round;
- accelerometer-to-screen mapping (upright, sideways, landscape, a push), the tilt sliders, and the smoothing that prefers a fresh sensor;
- drag and top speed; resting contact; no blob folded inside out under a 1 g pile;
- elasticity at body level, and that inelastic contacts never glue;
- attraction and repulsion;
- the shake drain;
- stability and full shape recovery after hard tilting at slider extremes;
- frame-rate consistency, sliders and paired delivery.

Physics takes about 0.1–0.3 ms per frame for 14 blobs on a desktop. The phone's accelerometer sign convention (W3C) should be checked on an iPhone and an Android phone. This is a browser prototype; ESP32 performance, IMU axes and panel colours need device testing.
