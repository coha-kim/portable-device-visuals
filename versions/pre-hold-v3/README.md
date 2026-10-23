# Portable Device Visuals

A mobile POC: one owner's teal (#2A9284) gradient metaballs, a blank recessed corner button, and hold-to-shake interaction. A compact Canvas 2D scalar field renders smooth fused shapes without SVG filters, blur passes, or external libraries. Every frame fully replaces the background to prevent trails.

## Use

For connected v1 testing, use the HTTPS pairing links from the relay below. The existing [GitHub Pages preview](https://coha-kim.github.io/portable-device-visuals/) stays on its previously published version until a deployment.

Open the HTTPS site on a phone, tap **Enable motion**, and grant motion access. Hold the bottom-left button while shaking:

- Harder shaking accumulates **intensity** faster and lowers opacity, down to 12%.
- Full button-hold time controls the background period, transitioning #ECEADB to #E2DDB1 over 20 seconds. Holds longer than that still extend recovery.
- Holding still extends the period without increasing intensity. Shaking without holding adds no intensity.
- Release starts recovery: the full button-hold duration sets how long opacity and background take to return to baseline (10× hold time in v1).

The requested endpoint is more yellow and darker numerically than the starting colour; the exact supplied colours are preserved.

WebSocket v1 connects this portable to the ambient display. Run `npm run bridge` and open http://127.0.0.1:8787/ for paired links. See [connection-v1/README-v1.md](connection-v1/README-v1.md) for HTTPS phone access, recovery tuning and testing. Phone sensor feel must be tested on the actual device.

## Development

`npm start` (or `python3 -m http.server 8000`) serves the files locally. Motion on a separate phone requires HTTPS; a plain LAN HTTP URL is for visual preview only. `npm install` installs the relay dependency; `npm test` runs model, renderer and real socket integration tests. No build is necessary.

`interaction-v1.mjs` contains the active interaction and recovery model. `interaction.mjs` retains the original thresholds and motion reader. `app.js` handles sensors, holding, and animation. See [CONTEXT.md](CONTEXT.md) for scope and intended future integration.

Longer holds now set recovery duration independently of shake strength. Movement remains independent. Previous files are saved under `versions/pre-websocket-v1/`.
