# Colour transfer: tap the portable near the ambient display

Visitors pick a blob colour on the portable (the **Colour** slider). When they bring the portable close to the ambient display, that colour is sent across, and their population's wax on the ambient display changes to it.

Status (2026-10-30): the protocol, relay server, portable sending and the proximity rules are built and tested. The proximity sensing and the ambient display's reaction are **not** built yet, because there is no hardware to test on and the ambient project is kept separate. This document is the handover for those two parts.

Update (2026-11-05): the ambient display's reaction is built, and the board sends its colour on connecting and whenever it changes, with no tap needed, because the user wants the ambient to reflect the portable. The Bluetooth tap below is not built; if it is wanted later, it decides when the board sends.

## Flow

1. The visitor picks a colour on the portable.
2. They bring the portable near the ambient display. The portable sees the Pi's Bluetooth beacon get strong and holds there briefly (`NearDetector` fires).
3. The portable sends `{ version: 1, type: "colour", colour: "#9700E2" }` over its existing WebSocket.
4. The relay server, which runs on the Pi, stores it for that portable's population and pushes a snapshot to everyone in the room. The snapshot now carries `colours: [null, "#9700E2", null]`.
5. The ambient display reads `snapshot.colours` and fades that population's wax to the new colour.

The portable decides "near" itself (option A) because it already owns the colour and the socket. The Pi only needs to advertise a beacon. Option B would have the Pi scan for the portables and apply a colour they had pre-sent. That is more work on the Pi and is not needed unless several portables crowd the display at once.

## Protocol (additive to v1)

| Direction | Message | Notes |
|---|---|---|
| portable → server | `{ version: 1, type: "colour", colour: "#RRGGBB" }` | Sets the sender's own population colour. Needs no hold, so it never conflicts with the writer lock. Bad values get the error `invalid-colour`. |
| portable → server | `{ version: 1, type: "colour", colour: null }` | Hands back the ambient's own colour for that population. |
| server → all | `snapshot.colours: [c0, c1, c2]` | `#RRGGBB` (upper case) or `null` = the ambient default. Lasts as long as the room. |

Ambient displays never send `colour`; the server rejects it from them. Older ambient code ignores the extra `colours` field, so nothing breaks before step 2 below is done.

## Done in this repo

- `connection-v1/server-v1.mjs`: validates, stores and broadcasts colours. The Pi imports this server (`ambient-device-visuals/pi/exhibition-server.mjs`), so it is live there on the next deploy.
- `harvey-link-v1.mjs`: `link.sendColour(hex)` and `link.colour(population)`.
  - The ambient repo has its own copy of this file. Copy the updated one across when convenient. The change is additive, so the ambient display still works without it; only `link.colour()` needs it.
- `proximity.mjs`: `NearDetector`, the tap rules with no browser APIs, ready to port to firmware.
  - It smooths RSSI (0.3 s time constant).
  - A tap needs a signal at or above −45 dBm for 0.8 s.
  - It fires once, then re-arms only after the signal drops below −55 dBm (the visitor moved away), with a 3 s cooldown.
  - Readings older than 1 s count as away.
- `app.js` / `index.html`:
  - **Tap ambient: send colour** button: stands in for the sensing in the browser. Without a pairing it says the colour was not sent.
  - `window.harveyProximity.near.reading(rssi, seconds)`: lets the tap rules be fed by hand.

## To do: ambient display (ambient-device-visuals)

1. In `ambient-link-v1.mjs`, inside `update()`, read `link.snapshot.colours` and pass changes to the sketch, e.g. `window.setPopulationColour?.(population, hex)`. Pass `null` to restore the default.
2. In `sketch.js`, add `setPopulationColour(p, hex)`. It sets a target for `popColors[p]` / `popRgb[p]` (the per-population colour arrays built from `POP_COLORS` in `setup()`), with `null` meaning `POP_COLORS[p]`.
   - Ease toward the target over about 1.5 s each frame instead of snapping, so the change reads as the colour "pouring in".
   - Keep any per-drop gradient or lightening logic reading from the same arrays.
3. Optional: a short ripple or glow from the edge nearest the visitor when a colour arrives, to confirm the tap.

## To do: hardware

- **Pi (ambient):** advertise a BLE beacon with a fixed name or UUID (e.g. `harvey-ambient`). The Pi 4/5 has Bluetooth built in; `bluetoothctl` advertising or a small `bleno`/BlueZ script started by systemd alongside the kiosk is enough.
- **ESP32-S3 (portable):**
  - Scan for that beacon every 100–200 ms.
  - Feed each RSSI into the ported `NearDetector`.
  - On a tap, send the `colour` message over its Wi-Fi WebSocket (the same socket used for hold and shake).
  - Show a short on-screen confirmation, e.g. a ring pulse in the chosen colour.
  - Scanning can run alongside Wi-Fi on the S3, but test the frame rate with both on.
- **Fallback if Bluetooth signal strength is too noisy in the room:** an NFC tag in the portable with a PN532 reader on the ambient frame, or a magnet with a hall sensor.
  - Both make the detection happen on the Pi, so the server would apply the portable's last-chosen colour. That would need a `pendingColour` the portable sends whenever the slider changes (option B above).

## Tuning on site

- Log the smoothed RSSI at 5, 10, 20 and 50 cm in the exhibition room, then set `ENTER_DBM` and `EXIT_DBM` about 10 dB apart around the 10 cm reading.
- If taps fire while visitors are just walking past, raise `DWELL_SECONDS`. If they feel sluggish, lower it.
- Check that two portables near the display at once each change only their own population.

## Testing without hardware

- `npm test` covers the server (valid and invalid colours, broadcast, ambient can't send, null reset) and the tap rules (noise, dwell, hysteresis, cooldown, stale readings).
- Paired in the browser:
  1. Run `npm run bridge` and open the two links.
  2. Pick a colour, then press **Tap ambient: send colour**.
  3. The snapshots reaching the ambient tab (visible in the browser's WebSocket inspector) will carry `colours`, but nothing changes visibly there until the ambient to-do above is done.
- Simulated RSSI in the portable console: `for (let t = 0; t < 2; t += .1) harveyProximity.near.reading(-40, t)` fires one tap.
