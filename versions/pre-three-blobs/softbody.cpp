#pragma GCC optimize("O3,fast-math")
#include "softbody.h"
#include <math.h>
#include <string.h>
// On the ESP32 the hot path runs from internal RAM, clear of the cache the display traffic thrashes.
#ifdef ESP_PLATFORM
#include "esp_attr.h"
#define HOT IRAM_ATTR
#else
#define HOT
#endif

// 1/190 s (the browser uses 1/240): what the board sustains in a full pile. stiffness·dt² is 0.042, inside the tests' 0.1 bound.
static constexpr float STEP = 1 / 190.f, TAU = 6.2831853f, POINT_RADIUS = 1.5f, WALL_GAP = 1;
static constexpr float RESTING_SPEED = 20, PRESSURE = 400, PRESSURE_CAP = 4, GRAVITY_DEAD_ZONE = .2f, DEAD_ZONE_GAIN = 1.5f;
static constexpr float REBOUND_EASE = .06f, PEEL = 10, CONTACT_LINGER = .25f, BOUNCE_MIN = 60, MOVE_DRAIN = .6f, SETTLE_AFTER = .4f, SETTLE_DAMPING = 30;
static constexpr int NEAR_MAX = 16;
static inline float clampf(float x, float a, float b) { return x < a ? a : x > b ? b : x; }
static inline float cross(float ax, float ay, float bx, float by) { return ax * by - ay * bx; }

HOT void Body::centre() {
  float x = 0, y = 0;
  for (const Node &n : nodes) { x += n.x; y += n.y; }
  cx = x / NODES; cy = y / NODES;
  float r2 = 0;
  for (const Node &n : nodes) { float dx = n.x - cx, dy = n.y - cy, d = dx * dx + dy * dy; if (d > r2) r2 = d; }
  reach = sqrtf(r2);
}
HOT void Body::velocity(float &x, float &y) const {
  x = y = 0;
  for (const Node &n : nodes) { x += n.vx; y += n.vy; }
  x /= NODES; y /= NODES;
}
HOT void Body::shift(float dvx, float dvy) { for (Node &n : nodes) { n.vx += dvx; n.vy += dvy; } }

static HOT float polygonArea(const Body &b, bool rest) {
  float a = 0;
  for (int i = 0; i < NODES; i++) {
    int j = (i + 1) % NODES;
    if (rest) a += b.rest[i].x * b.rest[j].y - b.rest[j].x * b.rest[i].y;
    else a += b.nodes[i].x * b.nodes[j].y - b.nodes[j].x * b.nodes[i].y;
  }
  return a / 2;
}
HOT void Body::shapeMatch(float h, float stiffness, float blend) {
  centre();
  float vx, vy, A = 0, B = 0, I = 0, L = 0; velocity(vx, vy);
  for (int i = 0; i < NODES; i++) {
    const Node &n = nodes[i]; const Rest &q = rest[i]; float rx = n.x - cx, ry = n.y - cy;
    A += rx * q.x + ry * q.y; B += cross(rx, ry, q.x, q.y);
    I += rx * rx + ry * ry; L += cross(rx, ry, n.vx - vx, n.vy - vy);
  }
  // cos and sin of the best-fit angle −atan2(B, A), without the trig.
  float m = sqrtf(A * A + B * B), cosA = m > 1e-9f ? A / m : 1, sinA = m > 1e-9f ? -B / m : 0;
  turnCos = cosA; turnSin = sinA;
  float omega = I > 1e-9f ? L / I : 0;
  for (int i = 0; i < NODES; i++) {
    Node &n = nodes[i]; const Rest &q = rest[i];
    float tx = cx + q.x * cosA - q.y * sinA, ty = cy + q.x * sinA + q.y * cosA;
    n.vx += stiffness * (tx - n.x) * h; n.vy += stiffness * (ty - n.y) * h;
    float rx = n.x - cx, ry = n.y - cy, rvx = vx - omega * ry, rvy = vy + omega * rx;
    n.vx += (rvx - n.vx) * blend; n.vy += (rvy - n.vy) * blend;
  }
  pressurise(h);
}
HOT void Body::pressurise(float h) {
  float restArea = polygonArea(*this, true), current = polygonArea(*this, false), sign = restArea < 0 ? -1 : 1;
  float denom = current * sign; if (denom < 1e-6f) denom = 1e-6f;
  float ratio = clampf(fabsf(restArea) / denom, 0, PRESSURE_CAP), p = PRESSURE * (ratio - 1) * .5f * h;
  if (p <= 0) return;
  for (int i = 0; i < NODES; i++) {
    Node &a = nodes[i], &b = nodes[(i + 1) % NODES]; float nx = (b.y - a.y) * sign, ny = -(b.x - a.x) * sign;
    a.vx += nx * p; a.vy += ny * p; b.vx += nx * p; b.vy += ny * p;
  }
}

float SoftBodyWorld::random() { seed_ = seed_ * 1664525u + 1013904223u; return seed_ / 4294967296.f; }
void SoftBodyWorld::init(uint32_t seed) {
  seed_ = seed; memset(contacts_, 0, sizeof contacts_); liveCount_ = 0;
  for (int k = 0; k < BODY_COUNT; k++) {
    // Best candidate: of many random spots, the one with the most room to its nearest neighbour.
    float r = BODY_RADIUS * (.9f + random() * .2f), x = CENTER, y = CENTER, room = -1e9f;
    for (int attempt = 0; attempt < 300; attempt++) {
      float a = random() * TAU, d = sqrtf(random()) * (DISPLAY_RADIUS - r - 4), px = CENTER + cosf(a) * d, py = CENTER + sinf(a) * d;
      float gap = DISPLAY_RADIUS - r - d;
      for (int j = 0; j < k; j++) { float g = hypotf(bodies[j].cx - px, bodies[j].cy - py) - bodies[j].reach - r; if (g < gap) gap = g; }
      if (gap > room) { room = gap; x = px; y = py; }
      if (room > 8) break;
    }
    Body &b = bodies[k]; b.baseRadius = b.radius = r; b.lastTouch = -1e9f; b.touchingSince = -1;
    for (int i = 0; i < NODES; i++) {
      float a = i * TAU / NODES;
      b.rest[i] = {cosf(a) * r, sinf(a) * r};
      b.nodes[i] = {x + b.rest[i].x, y + b.rest[i].y, 0, 0};
    }
    b.centre();
  }
}
HOT void SoftBodyWorld::touch(int a, int b) {
  int lo = b < 0 || a < b ? a : b, hi = b < 0 ? BODY_COUNT : a < b ? b : a;
  Contact &c = contacts_[lo][hi];
  if (c.live) { c.last = time; return; }
  c = {0, time, time, false, true};
  liveContacts_[liveCount_++] = lo * (BODY_COUNT + 1) + hi;
}
HOT void SoftBodyWorld::restitution(float e, float h) {
  for (int k = 0; k < liveCount_;) {
    int lo = liveContacts_[k] / (BODY_COUNT + 1), hi = liveContacts_[k] % (BODY_COUNT + 1);
    Contact &c = contacts_[lo][hi];
    if (time - c.last > CONTACT_LINGER) { c.live = false; liveContacts_[k] = liveContacts_[--liveCount_]; continue; }
    k++;
    Body &A = bodies[lo]; Body *B = hi == BODY_COUNT ? nullptr : &bodies[hi];
    float vax, vay, nx, ny, speed; A.velocity(vax, vay);
    if (!B) { float dx = A.cx - CENTER, dy = A.cy - CENTER, d = sqrtf(dx * dx + dy * dy); if (d < 1e-6f) d = 1e-6f; nx = dx / d; ny = dy / d; speed = vax * nx + vay * ny; }
    else { float vbx, vby; B->velocity(vbx, vby); float dx = B->cx - A.cx, dy = B->cy - A.cy, d = sqrtf(dx * dx + dy * dy); if (d < 1e-6f) d = 1e-6f; nx = dx / d; ny = dy / d; speed = (vax - vbx) * nx + (vay - vby) * ny; }
    if (speed > c.approach) c.approach = speed;
    if (speed < 0 && !c.toppedUp && c.approach >= BOUNCE_MIN) {
      c.toppedUp = true; float extra = e * c.approach + speed;
      if (extra > 0) { c.easing = REBOUND_EASE; c.easeRate = extra / REBOUND_EASE; }
    }
    // The rebound is eased in over REBOUND_EASE, not added in one step: a one-step kick reads as a stutter.
    // Each slice is limited by what is still missing, as the shape springs push too.
    if (c.easing > 0) {
      c.easing -= h; float missing = e * c.approach + speed, slice = c.easeRate * h; if (slice > missing) slice = missing;
      if (missing <= 0) c.easing = 0;
      else { if (!B) A.shift(-nx * slice, -ny * slice); else { A.shift(-nx * slice / 2, -ny * slice / 2); B->shift(nx * slice / 2, ny * slice / 2); } continue; }
    }
    float excess = -speed - e * c.approach - PEEL * (time - c.start); if (excess <= 0) continue;
    if (!B) { A.shift(nx * excess, ny * excess); continue; }
    A.shift(nx * excess / 2, ny * excess / 2); B->shift(-nx * excess / 2, -ny * excess / 2);
  }
}
struct Hit { float nx, ny, depth; int body; Node *a, *b; float t; };
// atan2 to about 0.3°, in 0..2π: plenty for choosing an edge.
static inline float fastAngle(float y, float x) {
  float ax = fabsf(x), ay = fabsf(y), lo = ax < ay ? ax : ay, hi = ax < ay ? ay : ax, t = hi > 1e-9f ? lo / hi : 0, z = t * t;
  float a = t * (.99538f + z * (-.28869f + z * .07917f));
  if (ay > ax) a = 1.5707963f - a;
  if (x < 0) a = 3.1415927f - a;
  return y < 0 ? TAU - a : a;
}
// A point is inside a body when the outline lies beyond it on the line from the centre (the bodies are
// star-shaped around their centre), so one pass finds both that and the way out. Only edges the line
// actually crosses cost a division.
static HOT bool bodyCollision(const Node &p, Body &body, int index, float r2, Hit &out) {
  float ox = p.x - body.cx, oy = p.y - body.cy, d2 = ox * ox + oy * oy;
  if (d2 > r2) return false;
  float d = sqrtf(d2), ux = 1, uy = 0;
  if (d > 1e-6f) { ux = ox / d; uy = oy / d; } else d = 1e-6f;
  float bestS = -1, bestT = 0; int best = -1;
  auto tryEdge = [&](int i) {
    int j = i + 1 == NODES ? 0 : i + 1;
    float ax = body.nodes[i].x - body.cx, ay = body.nodes[i].y - body.cy, bx = body.nodes[j].x - body.cx, by = body.nodes[j].y - body.cy;
    float sideA = cross(ux, uy, ax, ay), sideB = cross(ux, uy, bx, by);
    if ((sideA <= 0) == (sideB <= 0)) return;
    float t = sideA / (sideA - sideB), s = (ax + (bx - ax) * t) * ux + (ay + (by - ay) * t) * uy;
    if (s > 0 && s > bestS) { best = i; bestS = s; bestT = t; }
  };
  // Nodes keep their order around the centre, so the direction, turned back by the body's rotation, says
  // which edge to look at. Its neighbours cover a squashed body; if that misses, every edge is checked.
  float rx = ux * body.turnCos + uy * body.turnSin, ry = uy * body.turnCos - ux * body.turnSin;
  int edge = (int)floorf(fastAngle(ry, rx) * (NODES / TAU));
  for (int k = -1; k <= 1; k++) tryEdge((edge + k + 2 * NODES) % NODES);
  if (best < 0) for (int i = 0; i < NODES; i++) tryEdge(i);
  if (best < 0 || bestS <= d) return false;
  out = {ux, uy, bestS - d, index, &body.nodes[best], &body.nodes[best + 1 == NODES ? 0 : best + 1], bestT};
  return true;
}
static HOT void resolve(Node &p, const Hit &c, float elasticity, float keep) {
  float nx = c.nx, ny = c.ny;
  if (c.body < 0) {
    p.x += nx * c.depth; p.y += ny * c.depth;
    // No bounce per point: sixteen points each bouncing off the glass make rolling chatter. The body-level
    // rebound decides how lively the glass is.
    float vn = p.vx * nx + p.vy * ny; if (vn >= 0) return;
    float tx = p.vx - nx * vn, ty = p.vy - ny * vn;
    p.vx = tx * keep; p.vy = ty * keep; return;
  }
  Node &a = *c.a, &b = *c.b; float wa = 1 - c.t, wb = c.t, w = 1 + wa * wa + wb * wb, move = c.depth / w;
  p.x += nx * move; p.y += ny * move; a.x -= nx * move * wa; a.y -= ny * move * wa; b.x -= nx * move * wb; b.y -= ny * move * wb;
  float rvx = p.vx - (a.vx * wa + b.vx * wb), rvy = p.vy - (a.vy * wa + b.vy * wb), vn = rvx * nx + rvy * ny;
  if (vn >= 0) return; if (-vn < RESTING_SPEED) elasticity = 0;
  float tx = rvx - nx * vn, ty = rvy - ny * vn;
  float dx = (tx * keep - nx * vn * elasticity - rvx) / w, dy = (ty * keep - ny * vn * elasticity - rvy) / w;
  p.vx += dx; p.vy += dy; a.vx -= dx * wa; a.vy -= dy * wa; b.vx -= dx * wb; b.vy -= dy * wb;
}
int SoftBodyWorld::advance(float dt) {
  accumulator += clampf(dt, 0, .05f); int steps = 0;
  while (accumulator >= STEP) { step(STEP); accumulator -= STEP; steps++; }
  return steps;
}
HOT void SoftBodyWorld::step(float h) {
  time += h;
  float movement = 1 - MOVE_DRAIN * drain, e = elasticity + (DRAINED_ELASTICITY - elasticity) * drain;
  float liveFriction = friction + (DRAINED_FRICTION - friction) * drain, liveDrag = drag + (DRAINED_DRAG - drag) * drain, dragKeep = expf(-liveDrag * h);
  float m = hypotf(gravityX, gravityY), gx = 0, gy = 0;
  if (m > GRAVITY_DEAD_ZONE) { // A board lying on a desk reads up to about 0.15 g: that counts as level, so the blobs float. The gain
  // brings a full 0.6 g tilt back to full force.
  float k = (m - GRAVITY_DEAD_ZONE) * DEAD_ZONE_GAIN / m * gravity; gx = gravityX * k; gy = gravityY * k; }
  for (Body &b : bodies) for (Node &n : b.nodes) {
    n.vx = (n.vx + gx * h) * dragKeep; n.vy = (n.vy + gy * h) * dragKeep;
    n.x += n.vx * h; n.y += n.vy * h;
  }
  for (Body &b : bodies) b.centre();
  float r2[BODY_COUNT];
  for (int i = 0; i < BODY_COUNT; i++) { float r = bodies[i].reach + 2; r2[i] = r * r; }
  float keep = expf(-liveFriction * h), resolveE = e < 1 ? e : 1, wallLimit = DISPLAY_RADIUS - WALL_GAP - POINT_RADIUS;
  for (int i = 0; i < BODY_COUNT; i++) {
    Body &bi = bodies[i]; int near[NEAR_MAX], count = 0;
    for (int j = 0; j < BODY_COUNT && count < NEAR_MAX; j++) {
      if (j == i) continue;
      float dx = bodies[j].cx - bi.cx, dy = bodies[j].cy - bi.cy, reach = bi.reach + bodies[j].reach + POINT_RADIUS * 2;
      if (dx * dx + dy * dy < reach * reach) near[count++] = j;
    }
    float wx = bi.cx - CENTER, wy = bi.cy - CENTER; bool wallPossible = sqrtf(wx * wx + wy * wy) + bi.reach + 3 > wallLimit;
    if (!count && !wallPossible) continue;
    for (Node &p : bi.nodes) {
      float dx = p.x - CENTER, dy = p.y - CENTER, d = sqrtf(dx * dx + dy * dy); if (d < 1e-6f) d = 1e-6f;
      Hit hit = {-dx / d, -dy / d, d - wallLimit, -1, nullptr, nullptr, 0}, other;
      for (int k = 0; k < count; k++) if (bodyCollision(p, bodies[near[k]], near[k], r2[near[k]], other) && other.depth > hit.depth) hit = other;
      if (hit.depth <= 0) continue;
      resolve(p, hit, resolveE, keep);
      touch(i, hit.body);
      bi.lastTouch = time; if (bi.touchingSince < 0) bi.touchingSince = time;
    }
  }
  float blend = 1 - expf(-damping * h), restingBlend = 1 - expf(-(damping > SETTLE_DAMPING ? damping : SETTLE_DAMPING) * h);
  for (Body &b : bodies) {
    if (time - b.lastTouch > CONTACT_LINGER) b.touchingSince = -1;
    bool resting = b.touchingSince >= 0 && time - b.touchingSince > SETTLE_AFTER;
    b.shapeMatch(h, stiffness, resting ? restingBlend : blend);
  }
  restitution(e, h);
  float top = maxSpeed * movement;
  for (Body &b : bodies) { float vx, vy; b.velocity(vx, vy); float s = sqrtf(vx * vx + vy * vy); if (s > top) b.shift(vx * (top / s - 1), vy * (top / s - 1)); }
}
void SoftBodyWorld::blast(float x, float y, int spare) {
  for (int i = 0; i < BODY_COUNT; i++) {
    if (i == spare) continue;
    Body &b = bodies[i]; b.centre(); float dx = b.cx - x, dy = b.cy - y, d = hypotf(dx, dy), k = 1 - d / pushRadius;
    if (k <= 0) continue;
    float f = k * k * push;
    if (d < 1e-3f) { dx = CENTER - x; dy = CENTER - y; d = hypotf(dx, dy); if (d < 1e-3f) { dx = 0; dy = 1; d = 1; } }
    b.shift(dx / d * f, dy / d * f);
  }
}
float outlineWidth(float radius, float seconds) {
  float t = seconds > 0 ? seconds : 0, w = radius / (1 + t), floorW = radius < 1.5f ? radius : 1.5f;
  return w > floorW ? w : floorW;
}
