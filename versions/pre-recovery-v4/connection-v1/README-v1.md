# Harvey connection v1

Run both independent projects through one local WebSocket relay. Keep the repositories as sibling directories:

- `portable-device-visuals/`
- `ambient-device-visuals/`

From `portable-device-visuals`:

```sh
npm install
npm run bridge
```

Open `http://127.0.0.1:8787/`. The pairing page creates a private random room and gives a portable link and an ambient link. Open both links from the same pairing page. The base-teal population (#2A9284, zero-based index 1) is the owner. Other populations retain their baseline attraction. Use `population=0` or `population=2` in another portable link to control a different population in the same room.

## Phone access

Motion access requires HTTPS on a phone. With Cloudflare's `cloudflared` installed, leave the relay running and use another terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:8787
```

Open the generated HTTPS URL, then use its pairing links. WebSockets automatically use WSS. Keep the laptop awake and both processes running. A quick tunnel is temporary and changes URL when restarted; it is for prototype testing. A continuously available installation needs a persistent server or named tunnel.

GitHub Pages continues serving static files; it cannot run this Node relay. Once changes are published there, both Pages links can optionally connect to a separate relay using `?ws=wss%3A%2F%2FHOST%2Fsocket&room=YOUR_32_HEX_ROOM&population=1`. No Pages deployment is part of this v1 change.

## Interaction

- Shake intensity: number from 0 to 1, accumulated only while held with fresh motion.
- Hold duration: full press-to-release duration in seconds, including pauses in shaking. The relay measures it using its own clock.
- Recovery duration: hold duration × 10. This is a provisional tuning value, exported as `RECOVERY_MULTIPLIER` in `harvey-link-v1.mjs` in both projects; keep the copies identical.
- After release, a normalized exponential curve returns intensity and background period to zero, reaching the exact baseline at the computed end.
- Ambient attraction is `1.3 × (1 − intensity)` for the owner: a stronger shake reduces attraction and increases separation from other populations. Size, drift and speed are independent.
- Local portable recovery also works without a relay. A paired relay is authoritative when connected.
- A new press during recovery begins from the current appearance. Its own hold duration sets the next recovery period.
- Closing, hiding or losing focus on the portable releases the hold. A closed socket or 2.5 seconds without a held heartbeat also starts recovery. Clients reconnect and receive the current room state.
- One portable at a time may hold a given population. Rooms and population state are isolated.

The pairing URL is access to the prototype room; share it only with the devices participating in the demo. No accounts, history or sensor samples are stored. Relay state is in memory and resets when the process restarts. Only app assets are served; source history and context files are excluded. At most 100 rooms are retained, with unused rooms removed after 24 hours.

## Files and validation

`server-v1.mjs` serves both applications and relays numeric JSON state. `harvey-link-v1.mjs` is copied identically to both projects. `interaction-v1.mjs` is the active portable interaction model; `interaction.mjs` retains the original motion reader and legacy model. Original entry files and the ambient's pre-existing unsaved edits are preserved in `versions/pre-websocket-v1/`.

`npm test` includes model timing and real WebSocket integration checks: strength/duration independence, full hold duration, recovery after long frame gaps, clock conversion, selected population, room isolation, validation, writer conflicts, reconnect snapshots, dropped connections and heartbeat timeout. The pre-existing renderer and legacy model tests remain.

Real-device motion sensitivity and phone-to-display feel still require testing on the physical phone/display. Browser tests with synthetic sensor data do not verify those.

Optional environment variables: `PORT` (default 8787), `HOST` (default 127.0.0.1), and `HARVEY_AMBIENT_DIR` (absolute ambient project path if it is not a sibling).

## Current laptop input: v3

The default paired portable page now uses hold-only input, without motion setup. Hold the corner button, or focus it and hold Space/Enter. Intensity grows at 0.16 per held second; release starts recovery lasting 10× the full hold duration. This replaces shake strength with elapsed hold time only for this temporary testing mode. Add `&input=shake` to the portable URL for the original motion-based input. The relay and v1 recovery protocol are unchanged. The controlled ambient population is now yellow (#FFD84D, index 1) for visibility.
