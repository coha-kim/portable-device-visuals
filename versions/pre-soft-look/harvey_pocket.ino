// Harvey Pocket on the ESP32-S3-Touch-LCD-2.1: the browser prototype's blobs on the real panel. Physics
// runs on core 0 (softbody.cpp, a port of ../../softbody.mjs). Core 1, which also takes the panel's refresh
// interrupt (it follows the core that set the panel up), reads the QMI8658 and the touch panel and draws: each frame is filled straight into one of the panel's two PSRAM frame buffers, flat
// orange on #CCCCCC with crisp edges, hollowing to outlines as on the prototype.
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

// How the sensor's axes lie against the panel, measured in the enclosure: with the button on top and the USB
// port at the bottom, the sensor's +X points up and its +Z into the screen.
#define ACCEL_SCREEN_X(a) (-(a).y)
#define ACCEL_SCREEN_Y(a) ((a).x)

static constexpr uint8_t BRIGHTNESS = 100;
static constexpr uint16_t BACKGROUND = 0xCE59, INK = 0x0000;   // #CCCCCC and black as RGB565
static constexpr int SIZE = 480, SAMPLES = 3, OUTLINE_POINTS = NODES * SAMPLES, MAX_CROSSINGS = 12;
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
// then every blob that reaches it) and copied to the frame buffer in one go. Scan conversion: the outline's
// crossings on each row, sorted, filled in pairs (even-odd, so an inset second contour makes the hole).
static constexpr int BAND = 48;
// Only tiles (16 px across) holding a blob now, or in this buffer's previous frame, are copied: the rest of
// that buffer is already background. Each row's tiles are one bit each.
static constexpr int TILE = 16, TILES = SIZE / TILE;
static uint32_t rowTiles[SIZE], bufferTiles[2][SIZE];
static uint16_t band[BAND * SIZE] __attribute__((aligned(16)));
static float outerX[BODY_COUNT][OUTLINE_POINTS], outerY[BODY_COUNT][OUTLINE_POINTS], innerX[BODY_COUNT][OUTLINE_POINTS], innerY[BODY_COUNT][OUTLINE_POINTS];
static float bodyTop[BODY_COUNT], bodyBottom[BODY_COUNT];
static bool bodyHollow[BODY_COUNT];
// The same smooth outline as tracePath: quadratic curves between edge midpoints, sampled. With `inset`
// every node is first moved that far toward the centre (the hole of an outlined body).
static void outline(const Node *nodes, float cx, float cy, float inset, float *xs, float *ys) {
  float px[NODES], py[NODES];
  for (int i = 0; i < NODES; i++) {
    float dx = nodes[i].x - cx, dy = nodes[i].y - cy, k = 1;
    if (inset > 0) { float d = sqrtf(dx * dx + dy * dy); if (d < 1e-3f) d = 1e-3f; k = (d > inset ? d - inset : 0) / d; }
    px[i] = cx + dx * k; py[i] = cy + dy * k;
  }
  int o = 0;
  for (int i = 0; i < NODES; i++) {
    int a = (i + NODES - 1) % NODES, b = (i + 1) % NODES;
    float sx = (px[a] + px[i]) / 2, sy = (py[a] + py[i]) / 2, ex = (px[i] + px[b]) / 2, ey = (py[i] + py[b]) / 2;
    for (int k = 0; k < SAMPLES; k++) {
      float t = (float)k / SAMPLES, m = 1 - t;
      xs[o] = m * m * sx + 2 * m * t * px[i] + t * t * ex; ys[o] = m * m * sy + 2 * m * t * py[i] + t * t * ey; o++;
    }
  }
}
static float crossings[BAND][MAX_CROSSINGS];
static uint8_t crossingCount[BAND];
static void addContour(const float *xs, const float *ys, int bandTop) {
  for (int i = 0; i < OUTLINE_POINTS; i++) {
    int j = i + 1 == OUTLINE_POINTS ? 0 : i + 1; float x0 = xs[i], y0 = ys[i], x1 = xs[j], y1 = ys[j];
    if (y0 > y1) { float t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    int first = (int)ceilf(y0 - .5f), last = (int)ceilf(y1 - .5f) - 1;
    if (first < bandTop) first = bandTop; if (last >= bandTop + BAND) last = bandTop + BAND - 1;
    if (first > last) continue;
    float slope = (x1 - x0) / (y1 - y0), x = x0 + (first + .5f - y0) * slope;
    for (int y = first; y <= last; y++, x += slope) { int r = y - bandTop; if (crossingCount[r] < MAX_CROSSINGS) crossings[r][crossingCount[r]++] = x; }
  }
}
static inline void markTiles(int y, int x0, int x1) {
  int a = x0 / TILE, b = (x1 - 1) / TILE;
  rowTiles[y] |= (b == 31 ? ~0u : (2u << b) - 1) & ~((1u << a) - 1);
}
static void fillRows(int bandRow, uint16_t colour) {
  for (int r = 0; r < BAND; r++) {
    int n = crossingCount[r]; if (!n) continue;
    float *c = crossings[r]; crossingCount[r] = 0;
    for (int a = 1; a < n; a++) { float v = c[a]; int b = a - 1; while (b >= 0 && c[b] > v) { c[b + 1] = c[b]; b--; } c[b + 1] = v; }
    for (int k = 0; k + 1 < n; k += 2) {
      int x0 = (int)ceilf(c[k] - .5f), x1 = (int)ceilf(c[k + 1] - .5f);
      if (x0 < 0) x0 = 0; if (x1 > SIZE) x1 = SIZE;
      if (x1 <= x0) continue;
      uint16_t *p = band + r * SIZE + x0;
      for (int x = x0; x < x1; x++) *p++ = colour;
      markTiles(bandRow + r, x0, x1);
    }
  }
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
static void drawFrame(uint16_t *fb, int buffer, float seconds) {
  memset(rowTiles, 0, sizeof rowTiles);
  for (int i = 0; i < BODY_COUNT; i++) {
    float radius = drawn.radius[i], width = outlineWidth(radius, seconds);
    outline(drawn.nodes[i], drawn.cx[i], drawn.cy[i], 0, outerX[i], outerY[i]);
    bodyHollow[i] = width < radius;
    if (bodyHollow[i]) outline(drawn.nodes[i], drawn.cx[i], drawn.cy[i], width, innerX[i], innerY[i]);
    float top = 1e9f, bottom = -1e9f;
    for (int k = 0; k < OUTLINE_POINTS; k++) { float y = outerY[i][k]; if (y < top) top = y; if (y > bottom) bottom = y; }
    bodyTop[i] = top; bodyBottom[i] = bottom;
  }
  for (int bandTop = 0; bandTop < SIZE; bandTop += BAND) {
    uint32_t *w = (uint32_t *)band;
    for (int n = BAND * SIZE / 2; n > 0; n--) *w++ = BACKGROUND | (uint32_t)BACKGROUND << 16;
    for (int i = 0; i < BODY_COUNT; i++) {
      if (bodyBottom[i] < bandTop || bodyTop[i] >= bandTop + BAND) continue;
      addContour(outerX[i], outerY[i], bandTop);
      if (bodyHollow[i]) addContour(innerX[i], innerY[i], bandTop);
      fillRows(bandTop, edit.colourOf(drawn.cx[i], drawn.cy[i]));
    }
    drawEdit(bandTop);
    for (int r = 0; r < BAND; r++) {
      int y = bandTop + r; uint32_t tiles = rowTiles[y] | bufferTiles[buffer][y]; bufferTiles[buffer][y] = rowTiles[y];
      while (tiles) {
        int first = __builtin_ctz(tiles), run = __builtin_ctz(~(tiles >> first));
        if (run > TILES - first) run = TILES - first;
        memcpy(fb + y * SIZE + first * TILE, band + r * SIZE + first * TILE, run * TILE * sizeof(uint16_t));
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
    uint16_t *fb = (uint16_t *)buffers[back]; int64_t started = esp_timer_get_time();
    drawFrame(fb, back, drainSeconds);
    drawMicros += esp_timer_get_time() - started;
    xSemaphoreTake(vsync, 0);
    esp_lcd_panel_draw_bitmap(panel_handle, 0, 0, SIZE, SIZE, fb);
    xSemaphoreTake(vsync, pdMS_TO_TICKS(40));
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
