// C++ port of ../../colour-edit.mjs. Pressing a blob for 3 s opens a colour wheel around the border; a light
// line runs from the chosen colour to that blob and follows it. Pressing the wheel picks a colour, pulling
// away stretches a sling, and letting go flings a drop from the fingertip into the blob. The colour then
// spreads from there through the whole population. Canvas px throughout; no hardware here.
#pragma once
#include <math.h>
#include <stdint.h>

constexpr float LONG_PRESS_SECONDS = 3, PRESS_SLOP = 14, RING_WIDTH = 26, RING_INNER = 240 - RING_WIDTH, RING_GRAB = RING_INNER - 8, PULL_MIN = 24;
constexpr float EDIT_OPEN_SECONDS = .18f, FLIGHT_SPEED = 420, PULL_SPEED = 6, FLIGHT_MAX_SPEED = 1400, STEER = 10, MAX_FLIGHT = 2, RIPPLE_SPEED = 520, EDIT_KICK = .2f;
constexpr float FILL_HUE = 211.5f;   // the wheel's nearest hue to the baseline colour
constexpr uint16_t BASELINE_COLOUR = 0x3BD7;   // #3F7ABB as RGB565, until a colour is picked

// Hue 0 sits at the top of the wheel, running clockwise.
inline float hueAt(float x, float y) { float h = atan2f(y - 240, x - 240) * 57.29578f + 90; return h < 0 ? h + 360 : h >= 360 ? h - 360 : h; }
inline void ringPoint(float hue, float r, float &x, float &y) { float a = (hue - 90) * .017453293f; x = 240 + cosf(a) * r; y = 240 + sinf(a) * r; }
// The hue at #F47839's saturation and lightness, as RGB565: every choice equally vivid.
inline uint16_t colourFor(float hue) {
  constexpr float S = .895f, L = .590f;
  float h = fmodf(fmodf(hue, 360) + 360, 360), c = (1 - fabsf(2 * L - 1)) * S, x = c * (1 - fabsf(fmodf(h / 60, 2) - 1)), m = L - c / 2, r, g, b;
  if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  return (uint16_t)((int)((r + m) * 31 + .5f) << 11 | (int)((g + m) * 63 + .5f) << 5 | (int)((b + m) * 31 + .5f));
}

class ColourEdit {
 public:
  enum State { Idle, Pressing, Open, Aiming, Flying };
  State state = Idle;
  int target = -1;
  float held = 0, opened = 0, hue = FILL_HUE, currentHue = FILL_HUE, pullX = 0, pullY = 0, dropX = 0, dropY = 0;
  bool pulling = false, down = false;
  // Set for one step when the drop lands: the blob to nudge and by how much.
  bool landed = false; int landedBody = -1; float kickX = 0, kickY = 0;

  bool active() const { return state != Idle && state != Pressing; }
  void close() { state = Idle; target = -1; pulling = false; opened = 0; }
  // Returns true when the press belongs to the edit, not to the display.
  bool press(float x, float y, const float *cx, const float *cy, const float *radius, int count) {
    if (state == Flying) return true;
    if (state == Open) { if (radiusOf(x, y) >= RING_GRAB) grab(x, y); else close(); return true; }
    target = -1; float gap = 1e9f;
    for (int i = 0; i < count; i++) { float d = hypotf(cx[i] - x, cy[i] - y); if (d < radius[i] + 6 && d < gap) { target = i; gap = d; } }
    if (target >= 0) { state = Pressing; held = 0; atX = x; atY = y; }
    return false;
  }
  void move(float x, float y) {
    if (state == Pressing && hypotf(x - atX, y - atY) > PRESS_SLOP) { close(); return; }
    // Still down after the long press: sliding out to the wheel picks a colour in the same gesture.
    if (state == Open && down && radiusOf(x, y) >= RING_GRAB) grab(x, y);
    if (state != Aiming) return;
    if (radiusOf(x, y) >= RING_GRAB) { hue = hueAt(x, y); pulling = false; } else { pulling = true; pullX = x; pullY = y; }
  }
  void release(float x, float y) {
    down = false;
    if (state == Pressing) { close(); return; }
    if (state != Aiming) return;
    if (pulling) { pullX = x; pullY = y; }
    float ax, ay; ringPoint(hue, RING_INNER + RING_WIDTH / 2, ax, ay);
    float length = pulling ? hypotf(pullX - ax, pullY - ay) : 0;
    if (length < PULL_MIN) { state = Open; pulling = false; return; }
    // The drop leaves the fingertip still heading away from the wheel, then homes in on the blob.
    speed = fminf(FLIGHT_MAX_SPEED, FLIGHT_SPEED + length * PULL_SPEED);
    dropX = pullX; dropY = pullY; vx = (pullX - ax) / length * speed; vy = (pullY - ay) / length * speed; flight = 0;
    pulling = false; state = Flying;
  }
  void step(float dt, const float *cx, const float *cy, const float *radius) {
    landed = false;
    if (rippling && (rippleTime += dt) * RIPPLE_SPEED > 720) rippling = false;
    if (state == Idle) return;
    if (state == Pressing) { held += dt; if (held >= LONG_PRESS_SECONDS) { state = Open; hue = currentHue; down = true; } return; }
    opened = fminf(1, opened + dt / EDIT_OPEN_SECONDS);
    if (state != Flying) return;
    float dx = cx[target] - dropX, dy = cy[target] - dropY, dist = fmaxf(1e-6f, hypotf(dx, dy)), k = 1 - expf(-STEER * dt);
    flight += dt;
    if (dist < radius[target] + speed * dt || flight > MAX_FLIGHT) {
      landed = true; landedBody = target; kickX = vx * EDIT_KICK; kickY = vy * EDIT_KICK;
      rippling = true; rippleX = cx[target]; rippleY = cy[target]; rippleTime = 0; oldColour = colour();
      currentHue = hue; picked = true; close(); return;
    }
    vx += (dx / dist * speed - vx) * k; vy += (dy / dist * speed - vy) * k; dropX += vx * dt; dropY += vy * dt;
  }
  uint16_t settled() const { return colour(); }
  // While a colour spreads: where from, how far it has reached, and the colour beyond that.
  bool spreading(float &x, float &y, float &reached, uint16_t &old) const {
    if (!rippling) return false;
    x = rippleX; y = rippleY; reached = rippleTime * RIPPLE_SPEED; old = oldColour; return true;
  }
 private:
  float atX = 0, atY = 0, vx = 0, vy = 0, speed = 0, flight = 0, rippleX = 0, rippleY = 0, rippleTime = 0;
  bool rippling = false, picked = false; uint16_t oldColour = 0;
  uint16_t colour() const { return picked ? colourFor(currentHue) : BASELINE_COLOUR; }
  static float radiusOf(float x, float y) { return hypotf(x - 240, y - 240); }
  void grab(float x, float y) { state = Aiming; hue = hueAt(x, y); pulling = false; }
};
