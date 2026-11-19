// The link to the relay: joins the network in relay_secrets.h and speaks the relay's WebSocket protocol (pi/README-pi.md in the ambient
// project). The button's hold goes out as hold, intensity every 100 ms, release; the drain is the intensity, so
// shaking raises it and holding still pauses it. Release reports this board's recovery time, which the ambient
// follows; so it stays level, the drain is also reported on connecting and after a reset. Snapshots come back ten times a second. Asleep, the radio is off;
// waking reconnects. The wax colour goes out on connecting and whenever it changes, for the ambient to take on.
// Included from harvey_pocket.ino, whose heldNow, asleepNow, drainLevel, drainSeconds, resets and chosenColour it reads.
#pragma once
#include <WiFi.h>
#include "relay_secrets.h"   // RELAY_SSID, RELAY_PASSWORD, RELAY_HOST, RELAY_ROOM; copy relay_secrets.example.h

static constexpr int RELAY_POPULATION = 2;   // this board's wax on the ambient: 2 is the blue
static constexpr uint16_t RELAY_PORT = 8787;
static constexpr int RELAY_FRAME_MAX = 4096;
static constexpr uint32_t RELAY_RETRY_MS = 2000, WIFI_RETRY_MS = 15000, INTENSITY_MS = 100, HANDSHAKE_MS = 3000;

static WiFiClient relay;
static char relayFrame[RELAY_FRAME_MAX + 1], relayPhase[16] = "";
static float relayRemaining = 0;   // natural decay left for this population, in seconds

static bool relayRead(uint8_t *out, int count) {
  uint32_t started = millis();
  for (int got = 0; got < count;) {
    int ready = relay.available();
    if (ready > 0) { int n = relay.read(out + got, ready < count - got ? ready : count - got); if (n > 0) got += n; }
    else if (!relay.connected() || millis() - started > HANDSHAKE_MS) return false;
    else vTaskDelay(1);
  }
  return true;
}

// A client's frames are masked; ours are always short.
static void relaySendFrame(uint8_t opcode, const char *text, int length) {
  uint8_t frame[128] = {(uint8_t)(0x80 | opcode), (uint8_t)(0x80 | length)};
  uint32_t mask = esp_random(); memcpy(frame + 2, &mask, 4);
  for (int i = 0; i < length; i++) frame[6 + i] = text[i] ^ frame[2 + i % 4];
  relay.write(frame, 6 + length);
}
static void relaySend(const char *text) { relaySendFrame(1, text, strlen(text)); }
static void relaySendIntensity() {
  char message[64]; snprintf(message, sizeof message, "{\"version\":1,\"type\":\"intensity\",\"intensity\":%.3f}", (float)drainLevel); relaySend(message);
}
static void relaySendRelease() {
  char message[80]; snprintf(message, sizeof message, "{\"version\":1,\"type\":\"release\",\"recoverySeconds\":%.1f}", drainSeconds * RECOVERY_RATIO); relaySend(message);
  printf("relay: released, %.0f s to recover\n", drainSeconds * RECOVERY_RATIO);
}

static bool relayOpen() {
  if (!relay.connect(RELAY_HOST, RELAY_PORT, 3000)) return false;
  relay.setNoDelay(true);
  relay.printf("GET /socket?room=%s&role=portable&population=%d HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n", RELAY_ROOM, RELAY_POPULATION, RELAY_HOST, RELAY_PORT);
  char head[256]; int length = 0;
  while (length < (int)sizeof head - 1) {
    if (!relayRead((uint8_t *)head + length, 1)) break;
    head[++length] = 0;
    if (length >= 4 && !memcmp(head + length - 4, "\r\n\r\n", 4)) return !strncmp(head, "HTTP/1.1 101", 12);
  }
  return false;
}

// This population's phase and decay, from a snapshot: states are in population order.
static void relayOnText(const char *text) {
  if (strstr(text, "\"type\":\"error\"")) { printf("relay: %s\n", text); return; }
  const char *state = strstr(text, "\"states\":");
  for (int i = 0; state && i <= RELAY_POPULATION; i++) state = strstr(state + 1, "\"phase\":\"");
  if (!state) return;
  char phase[16] = ""; const char *from = state + 9, *end = strchr(from, '"');
  if (end && end - from < (int)sizeof phase) memcpy(phase, from, end - from);
  const char *remaining = strstr(state, "\"recoveryRemainingSeconds\":");
  relayRemaining = remaining ? atof(remaining + 27) : 0;
  if (strcmp(phase, relayPhase)) { strcpy(relayPhase, phase); printf("relay: %s, %.0f s of decay left\n", relayPhase, relayRemaining); }
}

// Everything waiting on the socket; false once it should close.
static bool relayPoll() {
  while (relay.available() >= 2) {
    uint8_t head[2], extended[2];
    if (!relayRead(head, 2)) return false;
    int opcode = head[0] & 15, length = head[1] & 127;
    if (length == 127) return false;
    if (length == 126) { if (!relayRead(extended, 2)) return false; length = extended[0] << 8 | extended[1]; }
    if (length > RELAY_FRAME_MAX) { for (; length > 0; length -= RELAY_FRAME_MAX < length ? RELAY_FRAME_MAX : length) if (!relayRead((uint8_t *)relayFrame, RELAY_FRAME_MAX < length ? RELAY_FRAME_MAX : length)) return false; continue; }
    if (!relayRead((uint8_t *)relayFrame, length)) return false;
    relayFrame[length] = 0;
    if (opcode == 1) relayOnText(relayFrame);
    else if (opcode == 8) return false;
    else if (opcode == 9 && length < 120) relaySendFrame(10, relayFrame, length);
  }
  return true;
}

// The relay's snapshot leaving "holding" is the proof a release arrived; no sign of it in time and the ring turns red.
static constexpr uint32_t RELEASE_ACK_MS = 1500;
static void linkTask(void *) {
  bool awaitingAck = false; uint32_t ackFrom = 0;
  bool radioOn = false, linked = false, holding = false, colourSent = false, levelSent = false; uint32_t wifiStarted = 0, relayTried = 0, sent = 0, resetsSeen = 0; uint16_t sentColour = 0;
  auto closeRelay = [&](const char *why) { if (linked) printf("relay: closed (%s)\n", why); relay.stop(); linked = holding = colourSent = levelSent = false; relayPhase[0] = 0; };
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10));
    uint32_t now = millis();
    if (releaseWaiting && (!linked || !holding)) { releaseWaiting = false; showRing(RING_FAILED); printf("relay: release not sent\n"); }
    if (awaitingAck && !linked) { awaitingAck = false; showRing(RING_FAILED); printf("relay: link lost before the release was confirmed\n"); }
    if (asleepNow || linkPaused) {
      if (radioOn) { closeRelay("asleep"); WiFi.disconnect(true); WiFi.mode(WIFI_OFF); radioOn = false; }
      continue;
    }
    if (!radioOn) { WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.begin(RELAY_SSID, RELAY_PASSWORD); radioOn = true; wifiStarted = now; printf("relay: joining %s\n", RELAY_SSID); }
    if (WiFi.status() != WL_CONNECTED) {
      closeRelay("wifi lost");
      if (now - wifiStarted > WIFI_RETRY_MS) { WiFi.disconnect(); WiFi.begin(RELAY_SSID, RELAY_PASSWORD); wifiStarted = now; printf("relay: still looking for %s\n", RELAY_SSID); }
      continue;
    }
    if (!linked) {
      if (now - relayTried < RELAY_RETRY_MS) continue;
      relayTried = now; linked = relayOpen();
      printf(linked ? "relay: connected as population %d, board %s\n" : "relay: no answer from " RELAY_HOST " (population %d, board %s)\n", RELAY_POPULATION, WiFi.localIP().toString().c_str());
      if (!linked) relay.stop();
      continue;
    }
    if (!relay.connected() || !relayPoll()) { closeRelay("dropped"); continue; }
    char message[64]; bool held = heldNow; uint16_t c = chosenColour;
    if (!colourSent || c != sentColour) {
      // RGB565 widened the way buildRamp does.
      snprintf(message, sizeof message, "{\"version\":1,\"type\":\"colour\",\"colour\":\"#%02X%02X%02X\"}", (c >> 8 & 0xF8) | c >> 13, (c >> 3 & 0xFC) | (c >> 9 & 3), (c << 3 & 0xF8) | (c >> 2 & 7));
      relaySend(message); colourSent = true; sentColour = c; printf("relay: sent %s\n", message);
    }
    if (held && !holding) { relaySend("{\"version\":1,\"type\":\"hold\"}"); holding = true; sent = 0; }
    if (holding && now - sent >= INTENSITY_MS) { relaySendIntensity(); sent = now; }
    if (awaitingAck && relayPhase[0] && strcmp(relayPhase, "holding")) { awaitingAck = false; showRing(RING_SENT); }
    else if (awaitingAck && now - ackFrom > RELEASE_ACK_MS) { awaitingAck = false; showRing(RING_FAILED); printf("relay: release not confirmed\n"); }
    if (!held && holding) { relaySendIntensity(); relaySendRelease(); holding = false; levelSent = true; if (releaseWaiting) { releaseWaiting = false; awaitingAck = true; ackFrom = now; } }
    // A quick hold and release puts the ambient where this board is now.
    if (!held && (!levelSent || resets != resetsSeen)) {
      resetsSeen = resets; levelSent = true;
      relaySend("{\"version\":1,\"type\":\"hold\"}"); relaySendIntensity(); relaySendRelease();
    }
  }
}
