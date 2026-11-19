// C++ port of ../../softbody.mjs for the ESP32-S3: the same lisyarus-style soft bodies, device gravity and
// body-level restitution, in px and seconds. See that file and the README for what each rule is for.
#pragma once
#include <stdint.h>

constexpr int BODY_COUNT = 3, NODES = 32;
constexpr float BODY_RADIUS = 75, CENTER = 240, DISPLAY_RADIUS = 240;   // the browser baseline is 13 px
// Fully drained feel: these are what the baseline values move to with the drain. Firm blobs keep their shape
// and only dent where they're hit; soft ones squash as a whole.
// maxSpeed is 300, not the browser's 600: real tilting drives blobs harder than a mouse, and fast 13 px blobs
// sink deep into each other (compression is about closing speed / √stiffness).
constexpr float DRAINED_ELASTICITY = .05f, DRAINED_FRICTION = 1, DRAINED_DRAG = 1.2f, FIRM_STIFFNESS = 2400, FIRM_DAMPING = 14;

struct Node { float x, y, vx, vy; };
struct Rest { float x, y; };
struct Body {
  float baseRadius, radius, cx, cy, reach, lastTouch, touchingSince;  // touchingSince < 0: not touching
  float edgeLength[NODES];   // rest length of each edge of the skin
  float turnCos = 1, turnSin = 0;   // best-fit rotation from the last shape match
  Node nodes[NODES];
  Rest rest[NODES];
  void centre();
  void velocity(float &x, float &y) const;
  void shift(float dvx, float dvy);
  void shapeMatch(float h, float stiffness, float blend, float stretch);
  void skin(float h, float strength);
  void pressurise(float h);
};
struct Contact { float approach, start, last; bool toppedUp, live; float easing, easeRate; };   // easing: rebound seconds left

class SoftBodyWorld {
 public:
  Body bodies[BODY_COUNT];
  float time = 0, accumulator = 0, drain = 0, gravityX = 0, gravityY = 0;
  float stiffness = 260, damping = 5, gravity = 1100, maxSpeed = 700, drag = .25f, push = 500, pushRadius = 220, elasticity = .55f, friction = .2f;
  void init(uint32_t seed);
  int advance(float dt);   // returns the fixed steps taken
  void step(float h);
  void blast(float x, float y, int spare = -1);   // spare: the blob being long-pressed stays put
 private:
  uint32_t seed_;
  uint16_t liveContacts_[BODY_COUNT * (BODY_COUNT + 1) / 2 + BODY_COUNT], liveCount_ = 0;
  Contact contacts_[BODY_COUNT][BODY_COUNT + 1];   // [lower id][higher id], column BODY_COUNT: the glass
  float random();
  void touch(int a, int b);
  void restitution(float elasticity, float pairElasticity, float h);
  void cohere(float merge, float h);
  void wanderSpot(int path, float &x, float &y) const;
  void choosePaths();
  int path_[BODY_COUNT] = {0, 1, 2};
  float pathsChosen_ = -1e9f;
};
