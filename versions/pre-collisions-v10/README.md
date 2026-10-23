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
