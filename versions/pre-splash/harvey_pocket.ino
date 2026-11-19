// Harvey Pocket on the ESP32-S3-Touch-LCD-2.1: the browser prototype's blobs on the real panel. Physics
// runs on core 0 (softbody.cpp, a port of ../../softbody.mjs). Core 1, which also takes the panel's refresh
// interrupt (it follows the core that set the panel up), reads the QMI8658 and the touch panel and draws: each frame is filled straight into one of the panel's two PSRAM frame buffers,
// soft-edged blue blobs on Harvey Lounge's #2F302F, hollowing to outlines as on the prototype.
// Input, 200 times a second: the gyroscope and accelerometer are fused into device gravity, and what the
// accelerometer feels beyond that is movement. Shaking while holding the button drains, and it seeps back
// 60× as slowly once released (button.h has the rest of the button). Touch only sets the colour.
#include <math.h>
#include <string.h>
#include "I2C_Driver.h"
#include "TCA9554PWR.h"
#include "Gyro_QMI8658.h"
#include "Display_ST7701.h"
#include "softbody.h"
#include "colour_edit.h"
#include "button.h"

#pragma GCC optimize("O3,fast-math")

// How the sensor's axes lie against the panel, measured in the enclosure: with the button on top and the USB
// port at the bottom, the sensor's +X points up and its +Z into the screen.
#define ACCEL_SCREEN_X(a) (-(a).y)
#define ACCEL_SCREEN_Y(a) ((a).x)

static constexpr uint8_t BRIGHTNESS = 100;
static constexpr uint16_t BACKGROUND = 0x2985, INK = 0xEF7D;   // #2F302F and light grey as RGB565
static constexpr int SIZE = 480, SAMPLES = 4;
static constexpr float SHAKE_THRESHOLD = 1.4f, SHAKE_FULL = 16, SHAKE_MIN = .12f, FIRM_SECONDS = 10, RECOVERY_RATIO = 60, G = 9.80665f;
// Fusion: the gyro turns the estimate at once; the accelerometer pulls it true over ACCEL_TRUST_SECONDS,
// but only while it reads about 1 g (not while being shaken). Movement under MOVE_DEAD_G is sensor noise.
static constexpr float MAX_TILT_G = .3f, ACCEL_TRUST_SECONDS = .5f, MOVE_DEAD_G = .15f, MOVE_SMOOTH_SECONDS = .02f, BIAS_SECONDS = 2;

static SoftBodyWorld world;
struct Snapshot { Node nodes[BODY_COUNT][NODES]; float cx[BODY_COUNT], cy[BODY_COUNT], radius[BODY_COUNT], time; };
static Snapshot shared, drawn;
static SemaphoreHandle_t sharedLock, vsync;
static volatile float gravityX = 0, gravityY = 0, drainLevel = 0, drainSeconds = 0, shakeNow = 0, gyroAgreement = 0;
static volatile bool touchingNow = false, heldNow = false, asleepNow = false;
static volatile int touchX = 0, touchY = 0, kickBody = -1;
static volatile float kickX = 0, kickY = 0;
static ColourEdit edit;
static volatile uint32_t physicsSteps = 0, physicsMicros = 0;

// Physics: as many fixed steps as real time asks for, then publish the positions.
static void physicsTask(void *) {
  int64_t last = esp_timer_get_time();
  for (;;) {
    int64_t now = esp_timer_get_time(); float dt = (now - last) / 1e6f; last = now;
    if (asleepNow) { vTaskDelay(pdMS_TO_TICKS(50)); continue; }
    world.gravityX = gravityX; world.gravityY = gravityY; world.drain = drainLevel;
    if (kickBody >= 0) { world.bodies[kickBody].shift(kickX, kickY); kickBody = -1; }
    physicsSteps += world.advance(dt);
    physicsMicros += esp_timer_get_time() - now;
    xSemaphoreTake(sharedLock, portMAX_DELAY);
    shared.time = world.time;
    for (int i = 0; i < BODY_COUNT; i++) {
      const Body &b = world.bodies[i]; memcpy(shared.nodes[i], b.nodes, sizeof b.nodes);
      shared.cx[i] = b.cx; shared.cy[i] = b.cy; shared.radius[i] = b.radius;
    }
    xSemaphoreGive(sharedLock);
    vTaskDelay(1);
  }
}

// Drawing. PSRAM is slow to write piecemeal, so each band of rows is drawn in internal RAM (background,
// then every blob that reaches it) and copied to the frame buffer in one go.
static constexpr int BAND = 48;
// Only tiles (16 px across) holding a blob now, or in this buffer's previous frame, are copied: the rest of
// that buffer is already background. Each row's tiles are one bit each.
static constexpr int TILE = 16, TILES = SIZE / TILE;
static uint32_t rowTiles[SIZE], bufferTiles[2][SIZE];
static uint16_t band[BAND * SIZE] __attribute__((aligned(16)));
// The look is Harvey Lounge's wax (sketch.js in the ambient project): a soft edge, lightening toward white where
// the wax is thick, and no light source. The lightening is kept barely noticeable.
// Blobs are soft, so they're shaded at half resolution and scaled up smoothly. Near the edge, how far a pixel
// is inside is (edge² − distance²) / 2·edge, with the edge read from a table by angle: no square roots.
static constexpr int HALF = SIZE / 2, HALF_STRIDE = HALF + 1, HALF_ROWS = BAND / 2 + 1, ANGLES = 64, REACH = 65, STEPS = 64;   // REACH: in half pixels
// A wax drop's field is (1 − d²/kernel²)², and its visible edge is where that reaches FIELD_ISO: EDGE_SHARE of kernel².
static constexpr float SOFT_EDGE = 18, MIN_SOFT_EDGE = 2, CENTER_LIGHTEN = .2f, CENTER_LIGHT_RATE = 1.1f, FIELD_ISO = .2f, EDGE_SHARE = .553f;
static constexpr uint32_t HALF_BACKGROUND = 40u << 20 | 48u << 10 | 40u, HALF_MASK = 0x0FF3FCFF;   // 8 bits in each 10-bit field
static uint32_t half[HALF_ROWS * HALF_STRIDE];
static float edge[BODY_COUNT][ANGLES], edgeScale[BODY_COUNT][ANGLES], lightScale[BODY_COUNT][ANGLES], bodyReach[BODY_COUNT], bodyWidth[BODY_COUNT];
static float bodyInner[BODY_COUNT];   // inside this, a blob is solid
static uint16_t bodyColour[BODY_COUNT], coverOf[STEPS + 1], backgroundRow[SIZE];
static uint32_t ramps[2][STEPS + 1]; static uint16_t rampColour[2]; static bool rampUsed[2]; static int rampNext = 0;   // blob colours by depth: the two a colour change needs
static uint8_t lightOf[STEPS + 1];   // by (distance / edge)²
static uint8_t angleOf[REACH * 2 + 1][REACH * 2 + 1];
// Direction as a share of a full turn, to about 0.2°.
static inline float turn(float y, float x) {
  float ax = fabsf(x), ay = fabsf(y), a = fminf(ax, ay) / (fmaxf(ax, ay) + 1e-6f), t = a * (.785398f + .273f * (1 - a)) / 6.2831853f;
  if (ay > ax) t = .25f - t;
  if (x < 0) t = .5f - t;
  if (y < 0) t = 1 - t;
  return t;
}
// The same smooth outline as tracePath: quadratic curves between edge midpoints, sampled into the edge table.
static void IRAM_ATTR traceEdge(const Node *nodes, float cx, float cy, float soft, float *table, float *scale, float *light, float &reach, float &inner) {
  memset(table, 0, sizeof(float) * ANGLES); reach = 0;
  for (int i = 0; i < NODES; i++) {
    const Node &n = nodes[i], &p = nodes[(i + NODES - 1) % NODES], &q = nodes[(i + 1) % NODES];
    float sx = (p.x + n.x) / 2, sy = (p.y + n.y) / 2, ex = (n.x + q.x) / 2, ey = (n.y + q.y) / 2;
    for (int k = 0; k < SAMPLES; k++) {
      float t = (float)k / SAMPLES, m = 1 - t, x = m * m * sx + 2 * m * t * n.x + t * t * ex - cx, y = m * m * sy + 2 * m * t * n.y + t * t * ey - cy;
      float d = sqrtf(x * x + y * y); int bin = (int)(turn(y, x) * ANGLES + .5f) % ANGLES;
      if (d > table[bin]) table[bin] = d;
      if (d > reach) reach = d;
    }
  }
  // Angles no sample landed on: straight between their neighbours.
  int start = 0; while (start < ANGLES && table[start] == 0) start++;
  if (start == ANGLES) return;
  for (int done = 0, a = start; done < ANGLES;) {
    int gap = 1; while (gap < ANGLES && table[(a + gap) % ANGLES] == 0) gap++;
    float from = table[a], to = table[(a + gap) % ANGLES];
    for (int k = 1; k < gap; k++) table[(a + k) % ANGLES] = from + (to - from) * k / gap;
    a = (a + gap) % ANGLES; done += gap;
  }
  float least = 1e9f;
  for (int a = 0; a < ANGLES; a++) { float e = fmaxf(table[a], 1); scale[a] = STEPS / (soft * 2 * e); light[a] = STEPS / (e * e); if (e < least) least = e; }
  inner = fmaxf(0, least - soft);
}
static inline float smooth(float a) { return a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a); }
static float softness(float width, float radius) { return width < radius ? fminf(SOFT_EDGE, fmaxf(MIN_SOFT_EDGE, width * .8f)) : SOFT_EDGE; }
static void buildTables() {
  for (int k = 0; k <= STEPS; k++) coverOf[k] = (uint16_t)(smooth((float)k / STEPS) * 256);
  for (int k = 0; k <= STEPS; k++) {
    float falloff = 1 - EDGE_SHARE * k / STEPS, field = falloff * falloff;
    lightOf[k] = field > FIELD_ISO ? (uint8_t)(CENTER_LIGHTEN * (1 - expf(-(field - FIELD_ISO) * CENTER_LIGHT_RATE)) * 255) : 0;
  }
  for (int y = -REACH; y <= REACH; y++) for (int x = -REACH; x <= REACH; x++) angleOf[y + REACH][x + REACH] = (int)(turn(y, x) * ANGLES + .5f) % ANGLES;
}
static const uint32_t *rampFor(uint16_t c) {
  for (int k = 0; k < 2; k++) if (rampUsed[k] && rampColour[k] == c) return ramps[k];
  int k = rampNext; rampNext ^= 1; rampUsed[k] = true; rampColour[k] = c;
  int red = (c >> 8 & 0xF8) | c >> 13, green = (c >> 3 & 0xFC) | (c >> 9 & 3), blue = (c << 3 & 0xF8) | (c >> 2 & 7);
  for (int n = 0; n <= STEPS; n++) {
    int glow = lightOf[n], r = red + ((255 - red) * glow >> 8), g = green + ((255 - green) * glow >> 8), b = blue + ((255 - blue) * glow >> 8);
    ramps[k][n] = (uint32_t)(r > 248 ? 248 : r) << 20 | (uint32_t)(g > 252 ? 252 : g) << 10 | (uint32_t)(b > 248 ? 248 : b);   // room for the dither
  }
  return ramps[k];
}
// One blob into the half-resolution rows of this band. A half pixel j sits on panel pixel 2j.
static void IRAM_ATTR shade(int i, int bandTop) {
  const float *table = edge[i], *scale = edgeScale[i], *lights = lightScale[i]; float cx = drawn.cx[i], cy = drawn.cy[i], width = bodyWidth[i], radius = drawn.radius[i];
  float reach = fminf(bodyReach[i] + SOFT_EDGE / 2 + 1, REACH * 2 - 2), reach2 = reach * reach; bool hollow = width < radius;
  // Hollow: the same sum against the outline moved in by the ring's width.
  float holeSq[ANGLES], holeScale[ANGLES];
  if (hollow) {
    float soft = softness(width, radius);
    for (int a = 0; a < ANGLES; a++) { float e = table[a] - width; holeSq[a] = e > 1 ? e * e : -1e6f; holeScale[a] = e > 1 ? STEPS / (soft * 2 * e) : 1; }
  }
  const uint32_t *ramp = rampFor(bodyColour[i]); float solid2 = hollow ? 0 : bodyInner[i] * bodyInner[i];
  for (int row = 0; row < HALF_ROWS; row++) {
    float dy = bandTop + row * 2 + .5f - cy, dy2 = dy * dy;
    if (dy2 >= reach2) continue;
    float chord = sqrtf(reach2 - dy2); int first = (int)ceilf((cx - chord - .5f) / 2), last = (int)floorf((cx + chord - .5f) / 2);
    if (first < 0) first = 0; if (last > HALF) last = HALF;
    int iy = (int)(dy / 2 + REACH + .5f), ix = (int)((first * 2 + .5f - cx) / 2 + REACH + .5f);
    const uint8_t *angles = angleOf[iy]; uint32_t *line = half + row * HALF_STRIDE;
    float dx = first * 2 + .5f - cx;
    for (int j = first; j <= last; j++, dx += 2, ix++) {
      float dist2 = dx * dx + dy2; int a = angles[ix];
      if (dist2 < solid2) { line[j] = ramp[(int)(dist2 * lights[a])]; continue; }
      float e = table[a], step = (e * e - dist2) * scale[a] + STEPS / 2;
      if (step <= 0) continue;
      int cover = step >= STEPS ? 256 : coverOf[(int)step];
      if (hollow) {
        float hole = (dist2 - holeSq[a]) * holeScale[a] + STEPS / 2;
        if (hole <= 0) continue;
        if (hole < STEPS) cover = cover * coverOf[(int)hole] >> 8;
      }
      float depth = dist2 * lights[a]; uint32_t colour = ramp[depth >= STEPS ? STEPS : (int)depth];
      if (cover < 256) {
        uint32_t v = line[j]; int r0 = v >> 20, g0 = v >> 10 & 255, b0 = v & 255, r = colour >> 20, g = colour >> 10 & 255, b = colour & 255;
        colour = (uint32_t)(r0 + ((r - r0) * cover >> 8)) << 20 | (uint32_t)(g0 + ((g - g0) * cover >> 8)) << 10 | (uint32_t)(b0 + ((b - b0) * cover >> 8));
      }
      line[j] = colour;
    }
  }
}
static inline uint16_t toPanel(uint32_t v) { return (v >> 12 & 0xF800) | (v >> 7 & 0x7E0) | (v >> 3 & 31); }
static inline uint32_t between(uint32_t a, uint32_t b) { return (a + b) >> 1 & HALF_MASK; }
// Scale panel pixels x0..x1 of band row r up from the half-resolution rows, into that panel row at `out`.
// The panel's 16-bit colour would band such slow gradients, so a 2 × 2 dither is added; the background's values
// sit low enough in their step that it never changes them, so tiles stay seamless.
static constexpr uint32_t dither(int red, int green) { return (uint32_t)red << 20 | (uint32_t)green << 10 | (uint32_t)red; }
static void IRAM_ATTR enlarge(uint16_t *out, int r, int x0, int x1) {
  const uint32_t *a = half + (r >> 1) * HALF_STRIDE + x0 / 2, *b = a + HALF_STRIDE; uint32_t *p = (uint32_t *)(out + x0); int pairs = (x1 - x0) / 2;
  if (r & 1) {
    uint32_t v = between(*a, *b);
    while (pairs--) { uint32_t next = between(*++a, *++b); *p++ = toPanel(v + dither(7, 3)) | (uint32_t)toPanel(between(v, next) + dither(3, 1)) << 16; v = next; }
  } else {
    uint32_t v = *a;
    while (pairs--) { uint32_t next = *++a; *p++ = toPanel(v + dither(1, 0)) | (uint32_t)toPanel(between(v, next) + dither(5, 2)) << 16; v = next; }
  }
}
static inline void markTiles(int y, int x0, int x1) {
  int a = x0 / TILE, b = (x1 - 1) / TILE;
  rowTiles[y] |= (b == 31 ? ~0u : (2u << b) - 1) & ~((1u << a) - 1);
}
// The edit's marks, clipped to the band being drawn.
static uint16_t *wheel = nullptr;   // the whole wheel, drawn once into PSRAM; spans are copied from it
static void dot(float cx, float cy, float radius, uint16_t colour, int bandTop) {
  int top = (int)ceilf(cy - radius), bottom = (int)floorf(cy + radius);
  if (top < bandTop) top = bandTop; if (bottom >= bandTop + BAND) bottom = bandTop + BAND - 1; if (bottom >= SIZE) bottom = SIZE - 1;
  for (int y = top; y <= bottom; y++) {
    float dy = y - cy, half = sqrtf(fmaxf(0, radius * radius - dy * dy)); int x0 = (int)ceilf(cx - half), x1 = (int)floorf(cx + half) + 1;
    if (x0 < 0) x0 = 0; if (x1 > SIZE) x1 = SIZE; if (x1 <= x0) continue;
    uint16_t *p = band + (y - bandTop) * SIZE + x0; for (int x = x0; x < x1; x++) *p++ = colour;
    markTiles(y, x0, x1);
  }
}
static void line(float x0, float y0, float x1, float y1, int bandTop) {
  if (fmaxf(y0, y1) + 2 < bandTop || fminf(y0, y1) - 2 >= bandTop + BAND) return;
  int steps = (int)hypotf(x1 - x0, y1 - y0) + 1;
  for (int i = 0; i <= steps; i++) { float t = (float)i / steps; dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1, INK, bandTop); }
}
static void drawEdit(int bandTop) {
  if (edit.state == ColourEdit::Idle) return;
  int t = edit.target; float cx = drawn.cx[t], cy = drawn.cy[t], radius = drawn.radius[t];
  if (edit.state == ColourEdit::Pressing) {
    if (edit.held < .3f) return;
    float share = (edit.held - .3f) / (LONG_PRESS_SECONDS - .3f), r = radius + 5; int steps = (int)(share * 80);
    for (int i = 0; i <= steps; i++) { float a = -1.5707963f + i / 80.f * 6.2831853f; dot(cx + cosf(a) * r, cy + sinf(a) * r, 1, INK, bandTop); }
    return;
  }
  // The wheel, growing in from the border.
  float width = RING_WIDTH * edit.opened, inner = 240 - width;
  for (int r = 0; r < BAND; r++) {
    int y = bandTop + r; float dy = y + .5f - 240, outerHalf = sqrtf(fmaxf(0, 240.f * 240.f - dy * dy)), innerHalf = sqrtf(fmaxf(0, inner * inner - dy * dy));
    int l0 = (int)(240 - outerHalf), l1 = (int)(240 - innerHalf), r0 = (int)(240 + innerHalf), r1 = (int)(240 + outerHalf);
    if (l1 > l0) { memcpy(band + r * SIZE + l0, wheel + y * SIZE + l0, (l1 - l0) * 2); markTiles(y, l0, l1); }
    if (r1 > r0 && r0 >= l1) { memcpy(band + r * SIZE + r0, wheel + y * SIZE + r0, (r1 - r0) * 2); markTiles(y, r0, r1); }
  }
  // The line from the chosen colour to the blob.
  float ax, ay; ringPoint(edit.hue, inner, ax, ay);
  float dx = cx - ax, dy = cy - ay, dist = fmaxf(1, hypotf(dx, dy)), stop = fmaxf(0, dist - radius - 4), ex = ax + dx / dist * stop, ey = ay + dy / dist * stop;
  line(ax, ay, ex, ey, bandTop); dot(ex, ey, 3.5f, INK, bandTop);
  // The sling: two bands from either side of the chosen colour to the drop at the fingertip.
  uint16_t chosen = colourFor(edit.hue);
  if (edit.pulling) for (int side = -6; side <= 6; side += 12) { float sx, sy; ringPoint(edit.hue + side, RING_INNER, sx, sy); line(sx, sy, edit.pullX, edit.pullY, bandTop); }
  float px, py; ringPoint(edit.hue, RING_INNER + RING_WIDTH / 2, px, py);
  dot(px, py, RING_WIDTH / 2 * edit.opened + 2, INK, bandTop); dot(px, py, RING_WIDTH / 2 * edit.opened, chosen, bandTop);
  if (edit.pulling) { dot(edit.pullX, edit.pullY, 11, INK, bandTop); dot(edit.pullX, edit.pullY, 9, chosen, bandTop); }
  if (edit.state == ColourEdit::Flying) { dot(edit.dropX, edit.dropY, 11, INK, bandTop); dot(edit.dropX, edit.dropY, 9, chosen, bandTop); }
}
// Outlines and tiles for the next frame: this needs no frame buffer, so it runs while waiting for the refresh.
static void prepareFrame(float seconds) {
  memset(rowTiles, 0, sizeof rowTiles);
  for (int i = 0; i < BODY_COUNT; i++) {
    float cx = drawn.cx[i], cy = drawn.cy[i], radius = drawn.radius[i];
    bodyWidth[i] = outlineWidth(radius, seconds); bodyColour[i] = edit.colourOf(cx, cy);
    traceEdge(drawn.nodes[i], cx, cy, softness(bodyWidth[i], radius), edge[i], edgeScale[i], lightScale[i], bodyReach[i], bodyInner[i]);
    float reach = bodyReach[i] + SOFT_EDGE / 2 + 3, reach2 = reach * reach;
    int top = (int)(cy - reach), bottom = (int)(cy + reach);
    if (top < 0) top = 0; if (bottom >= SIZE) bottom = SIZE - 1;
    for (int y = top; y <= bottom; y++) {
      float dy = y + .5f - cy, chord = dy * dy < reach2 ? sqrtf(reach2 - dy * dy) : 0; int left = (int)(cx - chord), right = (int)(cx + chord) + 1;
      if (left < 0) left = 0; if (right > SIZE) right = SIZE;
      if (right > left) markTiles(y, left, right);
    }
  }
}
// Without the colour edit to draw on top, rows go straight to the frame buffer; each pixel crosses to PSRAM once.
static void drawFrame(uint16_t *fb, int buffer) {
  bool direct = edit.state == ColourEdit::Idle;
  for (int bandTop = 0; bandTop < SIZE; bandTop += BAND) {
    if (!direct) { uint32_t *w = (uint32_t *)band; for (int n = BAND * SIZE / 2; n > 0; n--) *w++ = BACKGROUND | (uint32_t)BACKGROUND << 16; }
    for (int n = 0; n < HALF_ROWS * HALF_STRIDE; n++) half[n] = HALF_BACKGROUND;
    for (int i = 0; i < BODY_COUNT; i++) {
      float reach = bodyReach[i] + SOFT_EDGE / 2 + 1;
      if (drawn.cy[i] + reach >= bandTop && drawn.cy[i] - reach < bandTop + BAND + 2) shade(i, bandTop);
    }
    for (int r = 0; r < BAND; r++) {
      uint32_t tiles = rowTiles[bandTop + r]; uint16_t *out = direct ? fb + (bandTop + r) * SIZE : band + r * SIZE;
      while (tiles) {
        int first = __builtin_ctz(tiles), run = __builtin_ctz(~(tiles >> first));
        if (run > TILES - first) run = TILES - first;
        enlarge(out, r, first * TILE, (first + run) * TILE);
        tiles &= first + run >= 32 ? 0 : ~0u << (first + run);
      }
    }
    if (!direct) drawEdit(bandTop);
    for (int r = 0; r < BAND; r++) {
      int y = bandTop + r; uint32_t tiles = direct ? bufferTiles[buffer][y] & ~rowTiles[y] : rowTiles[y] | bufferTiles[buffer][y]; bufferTiles[buffer][y] = rowTiles[y];
      const uint16_t *from = direct ? backgroundRow : band + r * SIZE;
      while (tiles) {
        int first = __builtin_ctz(tiles), run = __builtin_ctz(~(tiles >> first));
        if (run > TILES - first) run = TILES - first;
        memcpy(fb + y * SIZE + first * TILE, from + first * TILE, run * TILE * sizeof(uint16_t));
        tiles &= first + run >= 32 ? 0 : ~0u << (first + run);
      }
    }
  }
}

static bool IRAM_ATTR onVsync(esp_lcd_panel_handle_t, const esp_lcd_rgb_panel_event_data_t *, void *) {
  BaseType_t woken = pdFALSE; xSemaphoreGiveFromISR(vsync, &woken); return woken == pdTRUE;
}

// Input: fuse the sensors, read the button and the finger, run the drain.
static void inputTask(void *) {
  float upX = 0, upY = 0, upZ = 1, biasX = 0, biasY = 0, biasZ = 0, moveX = 0, moveY = 0, seconds = 0, intensity = 0, testTilt = 0;
  float prevX = 0, prevY = 0, prevZ = 0, smoothX = 0, smoothY = 0, smoothZ = 0, agree = 0, predicted = 0, seen = 0;
  PocketButton button; bool primed = false; uint16_t tx = 0, ty = 0; int tick = 0; int64_t last = esp_timer_get_time();
  TickType_t wake = xTaskGetTickCount(); int64_t streamUntil = 0;
  for (;;) {
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(5));
    int64_t now = esp_timer_get_time(); float dt = (now - last) / 1e6f; last = now; if (dt > .05f) dt = .05f;
    getAccelerometer(); getGyroscope();
    float ax = Accel.x, ay = Accel.y, az = Accel.z, length = sqrtf(ax * ax + ay * ay + az * az);
    if (!primed && length > .5f) { upX = ax / length; upY = ay / length; upZ = az / length; smoothX = ax; smoothY = ay; smoothZ = az; primed = true; }
    constexpr float RAD = .017453293f;
    float wx = (Gyro.x - biasX) * RAD, wy = (Gyro.y - biasY) * RAD, wz = (Gyro.z - biasZ) * RAD;
    // A fixed direction seen from a turning sensor turns the other way: d(up)/dt = −ω × up.
    float px = -(wy * upZ - wz * upY) * dt, py = -(wz * upX - wx * upZ) * dt, pz = -(wx * upY - wy * upX) * dt;
    upX += px; upY += py; upZ += pz;
    bool calm = fabsf(length - 1) < .12f;
    if (calm && length > 0) { float k = dt / ACCEL_TRUST_SECONDS; upX += (ax / length - upX) * k; upY += (ay / length - upY) * k; upZ += (az / length - upZ) * k; }
    float n = sqrtf(upX * upX + upY * upY + upZ * upZ); if (n > 1e-3f) { upX /= n; upY /= n; upZ /= n; }
    // Held still, whatever the gyro reads is its own bias.
    if (calm && fabsf(wx) + fabsf(wy) + fabsf(wz) < .15f) { float k = dt / BIAS_SECONDS; biasX += (Gyro.x - biasX) * k; biasY += (Gyro.y - biasY) * k; biasZ += (Gyro.z - biasZ) * k; }
    // Check on the gyro's direction: does what it predicts match how the accelerometer's reading turns?
    float s = 1 - expf(-dt / .03f); smoothX += (ax - smoothX) * s; smoothY += (ay - smoothY) * s; smoothZ += (az - smoothZ) * s;
    if (calm) { float dx = smoothX - prevX, dy = smoothY - prevY, dz = smoothZ - prevZ; agree += px * dx + py * dy + pz * dz; predicted += px * px + py * py + pz * pz; seen += dx * dx + dy * dy + dz * dz; }
    prevX = smoothX; prevY = smoothY; prevZ = smoothZ;
    // Movement: what the accelerometer feels beyond gravity. It sloshes the blobs and is the shake.
    float dx = ax - upX, dy = ay - upY, dz = az - upZ, shakeG = sqrtf(dx * dx + dy * dy + dz * dz);
    float keep = shakeG > MOVE_DEAD_G ? (shakeG - MOVE_DEAD_G) / shakeG : 0, m = 1 - expf(-dt / MOVE_SMOOTH_SECONDS);
    struct { float x, y; } up = {upX, upY}, move = {dx * keep, dy * keep};
    moveX += (ACCEL_SCREEN_X(move) - moveX) * m; moveY += (ACCEL_SCREEN_Y(move) - moveY) * m;
    // Tilt is capped low: pressed hard against the glass, blobs follow the rim instead of falling across.
    float tiltX = ACCEL_SCREEN_X(up), tiltY = ACCEL_SCREEN_Y(up), tilt = sqrtf(tiltX * tiltX + tiltY * tiltY);
    if (tilt > MAX_TILT_G) { tiltX *= MAX_TILT_G / tilt; tiltY *= MAX_TILT_G / tilt; }
    gravityX = tiltX + moveX; gravityY = tiltY + moveY + testTilt;
    float strength = (shakeG * G - SHAKE_THRESHOLD) / (SHAKE_FULL - SHAKE_THRESHOLD); if (strength < 0) strength = 0; if (strength > 1) strength = 1;
    intensity = strength > intensity ? strength : intensity * expf(-dt / .25f); shakeNow = intensity;
    button.update(digitalRead(BUTTON_PIN) == LOW, now);
    heldNow = button.held;
    // Asleep: the screen is dark and the blobs stop, but the drain keeps seeping back and the tilt stays true.
    if (button.asleep != asleepNow) { asleepNow = button.asleep; Set_Backlight(asleepNow ? 0 : BRIGHTNESS); }
    // The touch panel updates at about 60 Hz.
    if (++tick % 3 == 0) {
      bool touching = !asleepNow && Touch_Poll(&tx, &ty);
      if (touching) { touchX = tx; touchY = ty; }
      touchingNow = touching;
    }
    if (button.reset) seconds = 0;
    if (button.held && intensity > SHAKE_MIN) { seconds += dt; if (seconds > FIRM_SECONDS) seconds = FIRM_SECONDS; }
    else if (!button.held) { seconds -= dt / RECOVERY_RATIO; if (seconds < 0) seconds = 0; }
    drainSeconds = seconds; drainLevel = seconds / FIRM_SECONDS;
    while (Serial.available()) {
      int c = Serial.read();
      if (c == 't') testTilt = testTilt ? 0 : .5f;
      if (c == 'z') button.asleep = true;   // sleep now, to test waking without the ten minutes
      if (c == 'd') streamUntil = now + 5000000;   // the dashboard asks every 2 s; silence stops the stream
    }
    if (now < streamUntil && tick % 10 == 0)   // 20 lines a second for firmware/dashboard
      printf("D %.3f %.3f %.3f %.3f %.3f %d %d %.0f %.3f %.3f %d %d %d %d\n", (float)gravityX, (float)gravityY, upZ, (float)shakeNow, seconds, (int)touchingNow, (int)edit.state, edit.currentHue, upX, upY, (int)tx, (int)ty, (int)heldNow, (int)asleepNow);
    if (tick % 400 == 0) { gyroAgreement = predicted > 1e-6f && seen > 1e-6f ? agree / sqrtf(predicted * seen) : 0; agree = predicted = seen = 0; }
  }
}

// Drawing, once per panel refresh when it keeps up.
static void frameTask(void *) {
  void *buffers[2]; esp_lcd_rgb_panel_get_frame_buffer(panel_handle, 2, &buffers[0], &buffers[1]);
  // Both buffers start as plain background, so tiles only ever need covering and uncovering.
  for (int b = 0; b < 2; b++) { uint32_t *w = (uint32_t *)buffers[b]; for (int n = SIZE * SIZE / 2; n > 0; n--) *w++ = BACKGROUND | (uint32_t)BACKGROUND << 16; }
  bool wasTouching = false; int back = 0; uint32_t frames = 0, drawMicros = 0, repeats = 0; int64_t report = esp_timer_get_time(), lastFrame = report;
  float shownTime = 0, advanceMin = 1e9f, advanceMax = 0, gapMin = 1e9f, gapMax = 0;
  for (;;) {
    if (asleepNow) {
      if (wasTouching) { edit.release(touchX, touchY); wasTouching = false; }
      vTaskDelay(pdMS_TO_TICKS(50)); frames = 0; drawMicros = 0; report = lastFrame = esp_timer_get_time(); continue;
    }
    int64_t now = esp_timer_get_time();
    xSemaphoreTake(sharedLock, portMAX_DELAY); memcpy(&drawn, &shared, sizeof drawn); xSemaphoreGive(sharedLock);
    // Cadence: how much simulated time each shown frame moves on, and how evenly frames arrive.
    float advance = (drawn.time - shownTime) * 1000; shownTime = drawn.time;
    float gap = (now - lastFrame) / 1000.f; lastFrame = now;
    if (advance < 0.01f) repeats++;
    if (advance < advanceMin) advanceMin = advance; if (advance > advanceMax) advanceMax = advance;
    if (gap < gapMin) gapMin = gap; if (gap > gapMax) gapMax = gap;
    // Touch: all of it goes to the colour edit.
    float dt = gap / 1000; if (dt > .1f) dt = .1f;
    bool touching = touchingNow; float fx = touchX, fy = touchY;
    if (touching && !wasTouching) {
      if (edit.press(fx, fy, drawn.cx, drawn.cy, drawn.radius, BODY_COUNT)) edit.down = true;
    } else if (touching) edit.move(fx, fy);
    else if (wasTouching) edit.release(fx, fy);
    wasTouching = touching;
    edit.step(dt, drawn.cx, drawn.cy, drawn.radius);
    if (edit.landed) { kickX = edit.kickX; kickY = edit.kickY; kickBody = edit.landedBody; }
    prepareFrame(drainSeconds);
    xSemaphoreTake(vsync, pdMS_TO_TICKS(40));   // the last frame is on screen, so the other buffer is free
    uint16_t *fb = (uint16_t *)buffers[back]; int64_t started = esp_timer_get_time();
    drawFrame(fb, back);
    drawMicros += esp_timer_get_time() - started;
    xSemaphoreTake(vsync, 0);
    esp_lcd_panel_draw_bitmap(panel_handle, 0, 0, SIZE, SIZE, fb);
    back ^= 1; frames++;
    if (now - report > 2000000) {
      float span = (now - report) / 1e6f;
      printf("fps %.1f | draw %.1f ms | physics %.0f steps/s (want 190), %.0f%% of core | g %.2f %.2f | shake %.2f | drain %.1f s | touch %d | button %d | gyro agrees %+.2f | sim per frame %.1f-%.1f ms, frame gap %.1f-%.1f ms, repeats %u\n",
             frames / span, drawMicros / 1000.f / frames, physicsSteps / span, physicsMicros / span / 1e4f, gravityX, gravityY, shakeNow, drainSeconds, touchingNow, heldNow, gyroAgreement, advanceMin, advanceMax, gapMin, gapMax, repeats);
      advanceMin = gapMin = 1e9f; advanceMax = gapMax = 0; repeats = 0;
      frames = 0; drawMicros = 0; physicsSteps = 0; physicsMicros = 0; report = now;
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  I2C_Init();
  TCA9554PWR_Init(0x00);
  Set_EXIO(EXIO_PIN8, Low);   // buzzer off
  QMI8658_Init();
  LCD_Init();
  Set_Backlight(BRIGHTNESS);
  // The wheel, once, at the colours the blobs can take.
  wheel = (uint16_t *)heap_caps_malloc(SIZE * SIZE * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
  { uint16_t table[360]; for (int h = 0; h < 360; h++) table[h] = colourFor(h);
    for (int y = 0; y < SIZE; y++) for (int x = 0; x < SIZE; x++) { float dx = x + .5f - 240, dy = y + .5f - 240, d2 = dx * dx + dy * dy; if (d2 >= RING_INNER * RING_INNER - 900) wheel[y * SIZE + x] = table[(int)hueAt(x + .5f, y + .5f) % 360]; } }
  buildTables();
  for (int x = 0; x < SIZE; x++) backgroundRow[x] = BACKGROUND;
  vsync = xSemaphoreCreateBinary(); sharedLock = xSemaphoreCreateMutex();
  esp_lcd_rgb_panel_event_callbacks_t callbacks = {}; callbacks.on_vsync = onVsync;
  esp_lcd_rgb_panel_register_event_callbacks(panel_handle, &callbacks, nullptr);
  world.init(esp_random());
  for (int i = 0; i < BODY_COUNT; i++) { const Body &b = world.bodies[i]; memcpy(shared.nodes[i], b.nodes, sizeof b.nodes); shared.cx[i] = b.cx; shared.cy[i] = b.cy; shared.radius[i] = b.radius; }
  xTaskCreatePinnedToCore(physicsTask, "physics", 8192, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(frameTask, "frame", 8192, nullptr, 2, nullptr, 1);
  xTaskCreatePinnedToCore(inputTask, "input", 8192, nullptr, 3, nullptr, 1);
}
void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }
