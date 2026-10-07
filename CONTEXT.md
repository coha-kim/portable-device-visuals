# Portable Device Visuals — project context

Updated: 2026-10-07

## Project and scope

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

Eight smooth gradient discs breathe gently and drift on independent slow paths. Native SVG Gaussian blur and alpha matrix (gain 16, bias -6) produce reversible fused contours like Orbmerge. Group opacity is applied AFTER the goo filter so transparency does not alter the threshold or shrink the blobs. Native SVG was chosen for phone compatibility rather than CanvasRenderingContext2D.filter. No external assets/libraries or runtime network calls.

## Overall intended user flow (future)

Ambient device shows one colour/population for each user. Portable device belongs to one owner and eventually uses a physical button. Holding/shaking creates intensity and period; these will be sent to ambient-device-visuals. Intensity will control that owner's population attraction; period sets how long attraction returns to baseline. Portable opacity will also slowly return to normal over a period-dependent duration. Direction and numeric mapping to ambient attraction, recovery curve, networking transport and hardware sensor calibration remain undecided.

## Validation

Node tests cover hold gating, harder-shake response, active duration, persistent release result, stale sensor data, opacity/background bounds, frame-rate independence and gravity fallback. Real phone permission flow, shake sensitivity, Safari rendering and physical hardware require device validation.

## Working preferences

Ask about material ambiguity before changing scope. Keep this repository separate; keep this context file current. Do not repeat explanations already given in chat.
