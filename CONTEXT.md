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
