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
