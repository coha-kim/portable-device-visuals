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

// stiffness·dt² stays well inside the tests' 0.1 bound.
static constexpr float STEP = 1 / 240.f, TAU = 6.2831853f, POINT_RADIUS = 1.5f, WALL_GAP = 1;
static constexpr float RESTING_SPEED = 20, PRESSURE = 3000, PRESSURE_CAP = 4, GRAVITY_DEAD_ZONE = .2f, DEAD_ZONE_GAIN = 1.5f;
static constexpr float REBOUND_EASE = .06f, PEEL = 10, CONTACT_LINGER = .25f, BOUNCE_MIN = 60, MOVE_DRAIN = .55f, SETTLE_AFTER = .4f, SETTLE_DAMPING = 12;
// Vertex forces. Skin: springs along the outline carry a dent around the whole blob. Stretch: fast blobs lengthen along their flight.
static constexpr float SKIN_STIFFNESS = 1500, BEND = 1200, SKIN_VISCOSITY = 25, MAX_PUSH = 1.5f, STRETCH = .28f;
// Level, each blob steers along its own slow path, swinging around its part of the plate; the swings line up now and
// then, the paths cross, and that's when blobs merge.
static constexpr float WANDER_PULL = 2, WANDER_DAMPING = 3, WANDER_ORBIT = 140, WANDER_SWAY = 15, WANDER_SWING = .7f, WANDER_FADE = .1f;
static constexpr float WANDER_RATE[BODY_COUNT] = {.083f, .061f, .047f};
// Merging, all scaled by merge = 1 − drain. Facing skin within STICK_RANGE reaches for the other blob; blobs may sink
// MERGE_OVERLAP into each other; a pair parting faster than BREAK_SPEED lets go. With no merging left, blobs keep MIN_GAP
// apart, and anything closing inside AVOID_RANGE turns aside before it gets there. Repelling grows with the square of the
// drain, so it's only strong near the lowest point, and pushes blobs apart from REPEL_RANGE in.
// PART_PUSH keeps them from sinking further, so merged blobs stay two blobs joined by a neck.
static constexpr float STICK = 70, STICK_RANGE = 16, MERGE_OVERLAP = 34, MIN_GAP = 2, AVOID_RANGE = 10, REPEL = 500, REPEL_RANGE = 70, PART_PUSH = 70, BREAK_SPEED = 240, PAIR_ELASTICITY = .05f, PAIR_FRICTION = 4;
// Baseline pace: the whole simulation runs this much faster than real time, easing to real time with the drain.
static constexpr float BASELINE_PACE = 1.6f;
// Shaking with the button held: the hand's movement drives the blobs directly, harder on the side facing it, so they
// slosh and jiggle with it; everything also speeds up, whatever the drain.
static constexpr float SHAKE_FORCE = 2600, SHAKE_MAX = 7000, SHAKE_SQUASH = .7f, STIR_PACE = .5f, STIR_SPEED = .8f;
// A merge doesn't last: a pair within MERGED_GAP for MERGE_LIMIT real seconds has its paths steered apart until PART_GAP clear,
// starting PART_LEAD early. Only the way they're heading changes: they ease to parting at PART_SPEED and no faster, so
// it reads as a change of course, never a push. Sideways motion is left alone. The limit
// is inversely proportional to the interaction: MERGE_LIMIT / (1 + seconds of shaking held in the drain).
static constexpr float MERGE_LIMIT = 1.5f, INTERACTION_SECONDS = 10, MERGED_GAP = 12, PART_GAP = 30, PART_SPEED = 90, PART_STEER = 6000, PART_LEAD = .25f, PART_EASE = .25f;
// Held, squish rises from a third to 1 as the tipping goes on: the pull to the rest shape, the skin springs and the
// damping fall toward these shares, so blobs sag, lose their round form and run together like jelly melting in a
// container, pressure keeping their area. The bend that keeps the outline from tearing stays whole. While squish is
// above 0 they merge whatever the drain, and the merge limit is off; both return once it eases back to 0 after release.
static constexpr float SQUISH_STIFFNESS = .05f, SQUISH_SKIN = .5f, SQUISH_DAMPING = .5f;
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
HOT void Body::shapeMatch(float h, float stiffness, float blend, float stretch) {
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
  float omega = I > 1e-9f ? L / I : 0, speed = sqrtf(vx * vx + vy * vy), ux = speed > 1e-3f ? vx / speed : 1, uy = speed > 1e-3f ? vy / speed : 0, squeeze = 1 / (1 + stretch) - 1;
  for (int i = 0; i < NODES; i++) {
    Node &n = nodes[i]; const Rest &q = rest[i];
    float ox = q.x * cosA - q.y * sinA, oy = q.x * sinA + q.y * cosA, along = ox * ux + oy * uy, across = oy * ux - ox * uy;
    along *= stretch; across *= squeeze;
    float tx = cx + ox + along * ux - across * uy, ty = cy + oy + along * uy + across * ux;
    n.vx += stiffness * (tx - n.x) * h; n.vy += stiffness * (ty - n.y) * h;
    float rx = n.x - cx, ry = n.y - cy, rvx = vx - omega * ry, rvy = vy + omega * rx;
    n.vx += (rvx - n.vx) * blend; n.vy += (rvy - n.vy) * blend;
  }
  pressurise(h);
}
HOT void Body::skin(float h, float strength) {
  for (int i = 0; i < NODES; i++) {
    Node &a = nodes[i], &b = nodes[(i + 1) % NODES]; float dx = b.x - a.x, dy = b.y - a.y, d = sqrtf(dx * dx + dy * dy) + 1e-6f, f = strength * (d - edgeLength[i]) / d * h;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  // Without these, one point can be flung out of line and the outline tears or crosses itself, which draws as streaks.
  // Each point is drawn to the line between its neighbours, and moves more like them.
  float keepIn = BEND * h, share = 1 - expf(-SKIN_VISCOSITY * h), mx[NODES], my[NODES], ux[NODES], uy[NODES];
  for (int i = 0; i < NODES; i++) {
    const Node &p = nodes[(i + NODES - 1) % NODES], &q = nodes[(i + 1) % NODES];
    mx[i] = (p.x + q.x) / 2 - nodes[i].x; my[i] = (p.y + q.y) / 2 - nodes[i].y; ux[i] = (p.vx + q.vx) / 2 - nodes[i].vx; uy[i] = (p.vy + q.vy) / 2 - nodes[i].vy;
  }
  for (int i = 0; i < NODES; i++) { nodes[i].vx += mx[i] * keepIn + ux[i] * share; nodes[i].vy += my[i] * keepIn + uy[i] * share; }
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
    // Round, but never a perfect circle.
    float p2 = random() * TAU, p3 = random() * TAU;
    for (int i = 0; i < NODES; i++) {
      float a = i * TAU / NODES, s = r * (1 + .02f * cosf(2 * a + p2) + .01f * cosf(3 * a + p3));
      b.rest[i] = {cosf(a) * s, sinf(a) * s};
      b.nodes[i] = {x + b.rest[i].x, y + b.rest[i].y, 0, 0};
    }
    for (int i = 0; i < NODES; i++) { const Rest &p = b.rest[i], &q = b.rest[(i + 1) % NODES]; b.edgeLength[i] = hypotf(q.x - p.x, q.y - p.y); }
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
void SoftBodyWorld::wanderSpot(int path, float &x, float &y) const {
  float at = path * TAU / BODY_COUNT + WANDER_SWING * sinf(WANDER_RATE[path] * time + path * 1.7f), orbit = WANDER_ORBIT + WANDER_SWAY * sinf(time * .17f + path * 2.1f);
  x = CENTER + cosf(at) * orbit; y = CENTER + sinf(at) * orbit;
}
// Each blob takes the path nearest it, so none has to push through another to reach its own.
void SoftBodyWorld::choosePaths() {
  static constexpr int ORDERS[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
  float spotX[BODY_COUNT], spotY[BODY_COUNT], best = 1e18f; pathsChosen_ = time;
  for (int p = 0; p < BODY_COUNT; p++) wanderSpot(p, spotX[p], spotY[p]);
  for (const auto &order : ORDERS) {
    float cost = 0; bool current = true;
    for (int i = 0; i < BODY_COUNT; i++) { float dx = spotX[order[i]] - bodies[i].cx, dy = spotY[order[i]] - bodies[i].cy; cost += dx * dx + dy * dy; current = current && order[i] == path_[i]; }
    if (current) cost *= .8f;   // no swapping over a near tie
    if (cost < best) { best = cost; for (int i = 0; i < BODY_COUNT; i++) path_[i] = order[i]; }
  }
}
// Magnetism: skin facing a nearby blob is pulled toward it, so the two reach out into a neck and then hold.
HOT void SoftBodyWorld::cohere(float merge, float tilted, float h) {
  float apart = 1 - squish, sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge) * apart, drain = 1 - merge, pace = (BASELINE_PACE + (1 - BASELINE_PACE) * drain) * (1 + STIR_PACE * stir);
  for (int i = 0; i < BODY_COUNT; i++) for (int j = i + 1; j < BODY_COUNT; j++) {
    Body &a = bodies[i], &b = bodies[j]; float dx = b.cx - a.cx, dy = b.cy - a.cy, d = sqrtf(dx * dx + dy * dy) + 1e-6f, gap = d - a.radius - b.radius;
    int pair = i + j - 1;
    if (squish > 0) { mergedFor_[pair] = parting_[pair] = 0; }   // no merge limit while held
    if (parting_[pair] > 0) {
      if (gap > PART_GAP) { parting_[pair] = mergedFor_[pair] = 0; }
      else {
        float nx = dx / d, ny = dy / d, avx, avy, bvx, bvy; a.velocity(avx, avy); b.velocity(bvx, bvy);
        float missing = PART_SPEED - ((bvx - avx) * nx + (bvy - avy) * ny), steer = PART_STEER * (.2f + .8f * tilted) * clampf(parting_[pair] / PART_EASE, .05f, 1) * h;
        if (missing > 0) { float turn = (missing < steer ? missing : steer) / 2; a.shift(-nx * turn, -ny * turn); b.shift(nx * turn, ny * turn); }
        parting_[pair] += h / pace;
        continue;
      }
    }
    // Near the lowest point there's no merging to limit: blobs that close are only keeping their distance.
    if (gap < MERGED_GAP && gap < sink + MERGED_GAP * merge) { mergedFor_[pair] += h / pace; if (mergedFor_[pair] > fmaxf(MERGE_LIMIT / (1 + INTERACTION_SECONDS * drain) - PART_LEAD * (2 - tilted), .02f)) parting_[pair] = 1e-4f; }
    else mergedFor_[pair] = 0;
    if (gap > STICK_RANGE && gap > REPEL_RANGE) continue;
    float nx = dx / d, ny = dy / d, avx, avy, bvx, bvy; a.velocity(avx, avy); b.velocity(bvx, bvy);
    if (gap < -sink) { float push = PART_PUSH * (-gap - sink) * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); continue; }
    if (gap < REPEL_RANGE) { float near = 1 - fmaxf(gap, 0) / REPEL_RANGE, push = REPEL * drain * drain * apart * near * near * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); }
    if (gap > STICK_RANGE) continue;
    float closing = (avx - bvx) * nx + (avy - bvy) * ny;
    if (gap < AVOID_RANGE && closing > 0) { float take = closing * drain * apart / 2; a.shift(-nx * take, -ny * take); b.shift(nx * take, ny * take); }
    if (merge <= 0 || (bvx - avx) * nx + (bvy - avy) * ny > BREAK_SPEED) continue;
    float pull = STICK * merge * (gap > 0 ? 1 - gap / STICK_RANGE : 1 + gap / fmaxf(sink, 1)) * h;
    for (Node &p : a.nodes) { float f = ((p.x - a.cx) * nx + (p.y - a.cy) * ny) / a.radius; if (f > 0) { p.vx += nx * pull * f * 2; p.vy += ny * pull * f * 2; } }
    for (Node &p : b.nodes) { float f = -((p.x - b.cx) * nx + (p.y - b.cy) * ny) / b.radius; if (f > 0) { p.vx -= nx * pull * f * 2; p.vy -= ny * pull * f * 2; } }
  }
}
HOT void SoftBodyWorld::restitution(float wallE, float pairE, float h) {
  for (int k = 0; k < liveCount_;) {
    int lo = liveContacts_[k] / (BODY_COUNT + 1), hi = liveContacts_[k] % (BODY_COUNT + 1);
    Contact &c = contacts_[lo][hi];
    if (time - c.last > CONTACT_LINGER) { c.live = false; liveContacts_[k] = liveContacts_[--liveCount_]; continue; }
    k++;
    Body &A = bodies[lo]; Body *B = hi == BODY_COUNT ? nullptr : &bodies[hi]; float e = B ? pairE : wallE;
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
static HOT bool bodyCollision(const Node &p, Body &body, int index, float r2, float sink, Hit &out) {
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
  if (best < 0 || bestS - d <= sink) return false;
  out = {ux, uy, bestS - d - sink, index, &body.nodes[best], &body.nodes[best + 1 == NODES ? 0 : best + 1], bestT};
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
  accumulator += clampf(dt, 0, .05f) * (BASELINE_PACE + (1 - BASELINE_PACE) * drain) * (1 + STIR_PACE * stir); int steps = 0;
  while (accumulator >= STEP) { step(STEP); accumulator -= STEP; steps++; }
  return steps;
}
HOT void SoftBodyWorld::step(float h) {
  time += h;
  float merge = 1 - drain * (1 - squish), sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge) * (1 - squish), movement = 1 - MOVE_DRAIN * drain * (1 - stir), e = elasticity + (DRAINED_ELASTICITY - elasticity) * drain;
  float pairE = PAIR_ELASTICITY;
  float liveFriction = friction + (DRAINED_FRICTION - friction) * drain, liveDrag = drag + (DRAINED_DRAG - drag) * drain, dragKeep = expf(-liveDrag * h);
  float m = hypotf(gravityX, gravityY), gx = 0, gy = 0;
  if (m > GRAVITY_DEAD_ZONE) { // A board lying on a desk reads up to about 0.15 g: that counts as level, so the blobs float. The gain
  // brings a full 0.6 g tilt back to full force.
  float k = (m - GRAVITY_DEAD_ZONE) * DEAD_ZONE_GAIN / m * gravity * movement; gx = gravityX * k; gy = gravityY * k; }
  float level = (1 - clampf((m - GRAVITY_DEAD_ZONE) / WANDER_FADE, 0, 1)) * (1 - stir), shake = hypotf(shakeX, shakeY), jolt = fminf(shake * SHAKE_FORCE, SHAKE_MAX), joltX = shake > 1e-3f ? shakeX / shake : 0, joltY = shake > 1e-3f ? shakeY / shake : 0;
  if (level > 0 && time - pathsChosen_ > 1) choosePaths();
  for (int i = 0; i < BODY_COUNT; i++) {
    float wx = 0, wy = 0;
    if (level > 0) {
      Body &b = bodies[i]; float vx, vy, tx, ty, k = level * movement; b.velocity(vx, vy); wanderSpot(path_[i], tx, ty);
      wx = (WANDER_PULL * (tx - b.cx) - WANDER_DAMPING * vx) * k; wy = (WANDER_PULL * (ty - b.cy) - WANDER_DAMPING * vy) * k;
    }
    const Body &b = bodies[i];
    for (Node &n : bodies[i].nodes) {
      float push = jolt > 0 ? jolt * (1 + SHAKE_SQUASH * ((n.x - b.cx) * joltX + (n.y - b.cy) * joltY) / b.radius) : 0;
      n.vx = (n.vx + (gx + wx + joltX * push) * h) * dragKeep; n.vy = (n.vy + (gy + wy + joltY * push) * h) * dragKeep;
      n.x += n.vx * h; n.y += n.vy * h;
    }
  }
  for (Body &b : bodies) b.centre();
  float r2[BODY_COUNT];
  for (int i = 0; i < BODY_COUNT; i++) { float r = bodies[i].reach + 2; r2[i] = r * r; }
  float keep = expf(-liveFriction * h), pairKeep = expf(-(liveFriction + PAIR_FRICTION * merge) * h), resolveE = e < 1 ? e : 1, wallLimit = DISPLAY_RADIUS - WALL_GAP - POINT_RADIUS;
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
      for (int k = 0; k < count; k++) if (bodyCollision(p, bodies[near[k]], near[k], r2[near[k]], sink, other) && other.depth > hit.depth) hit = other;
      if (hit.depth <= 0) continue;
      // Blob against blob, a point eases out rather than jumping out of line with its neighbours.
      if (hit.body < 0) resolve(p, hit, resolveE, keep); else { if (hit.depth > MAX_PUSH) hit.depth = MAX_PUSH; resolve(p, hit, pairE, pairKeep); }
      touch(i, hit.body);
      bi.lastTouch = time; if (bi.touchingSince < 0) bi.touchingSince = time;
    }
  }
  cohere(merge, 1 - level, h);
  float soft = 1 - squish, liveStiffness = (stiffness + (DRAINED_STIFFNESS - stiffness) * drain) * (soft + SQUISH_STIFFNESS * squish);
  float liveDamping = (damping + (DRAINED_DAMPING - damping) * drain) * (soft + SQUISH_DAMPING * squish), skinStrength = SKIN_STIFFNESS * (soft + SQUISH_SKIN * squish);
  float blend = 1 - expf(-liveDamping * h), restingBlend = 1 - expf(-(liveDamping > SETTLE_DAMPING ? liveDamping : SETTLE_DAMPING) * h);
  for (Body &b : bodies) {
    if (time - b.lastTouch > CONTACT_LINGER) b.touchingSince = -1;
    bool resting = b.touchingSince >= 0 && time - b.touchingSince > SETTLE_AFTER;
    float vx, vy; b.velocity(vx, vy);
    b.shapeMatch(h, liveStiffness, resting ? restingBlend : blend, STRETCH * clampf(sqrtf(vx * vx + vy * vy) / maxSpeed, 0, 1));
    b.skin(h, skinStrength);
  }
  restitution(e, pairE, h);
  float top = maxSpeed * movement * (1 + STIR_SPEED * stir);
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
