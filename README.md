# Portable Device Visuals

A mobile POC: one owner's teal (#2A9284) gradient metaballs, a blank recessed corner button, and hold-to-shake interaction. Native SVG renders the same blur/alpha-threshold style of fusion as Orbmerge, without a canvas-filter dependency or external libraries.

## Use

[Open on your phone](https://coha-kim.github.io/portable-device-visuals/).

Open the HTTPS site on a phone, tap **Enable motion**, and grant motion access. Hold the bottom-left button while shaking:

- Harder shaking accumulates **intensity** faster and lowers opacity, down to 12%.
- Active shaking time accumulates **period** and transitions the background from #ECEADB to #E2DDB1 over 20 seconds.
- Holding still or shaking without holding changes neither value.
- Release retains the resulting opacity/background while the blobs continue drifting. Reload resets the POC.

The requested endpoint is more yellow and darker numerically than the starting colour; the exact supplied colours are preserved.

Automatic recovery and transmission to the ambient display are future work. No data is sent anywhere by this app. Phone sensor feel must be tested on the actual device.

## Development

`npm start` (or `python3 -m http.server 8000`) serves the files locally. Motion on a separate phone requires HTTPS; a plain LAN HTTP URL is for visual preview only. `npm test` runs interaction tests. No npm installation or build is necessary.

`interaction.mjs` contains thresholds and the intensity/period model. `app.js` handles sensors, holding, and animation. See [CONTEXT.md](CONTEXT.md) for scope and intended future integration.
