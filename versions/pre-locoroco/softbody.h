// C++ port of ../../softbody.mjs for the ESP32-S3: the same lisyarus-style soft bodies, device gravity and
// body-level restitution, in px and seconds. See that file and the README for what each rule is for.
#pragma once
#include <stdint.h>

constexpr int BODY_COUNT = 24, BASE_BODIES = 3, NODES = 16;   // slots: BASE_BODIES blobs at rest, the rest for droplets
constexpr float BODY_RADIUS = 75, CENTER = 240, DISPLAY_RADIUS = 240;   // the browser baseline is 13 px
// Fully drained feel: elasticity, friction and drag move from the baseline to these with the drain.
// maxSpeed is 300, not the browser's 600: real tilting drives blobs harder than a mouse, and fast 13 px blobs
// sink deep into each other (compression is about closing speed / √stiffness).
constexpr float DRAINED_ELASTICITY = .12f, DRAINED_FRICTION = 9, DRAINED_DRAG = .72f;

struct Node { float x, y, vx, vy; };
struct Rest { float x, y; };
struct Body {
  float baseRadius, radius, cx, cy, reach, lastTouch, touchingSince;  // touchingSince < 0: not touching
  float turnCos = 1, turnSin = 0;   // best-fit rotation from the last shape match
  bool alive = false;
  float target = 0, born = -1e9f, splitAt = -1e9f, ghostUntil = -1e9f;   // target: the radius being eased to
  int family = 0, absorbInto = -1;   // family: a blob and its fresh droplets pass through each other until ghostUntil
  Node nodes[NODES];
  Rest rest[NODES];
  void centre();
  void velocity(float &x, float &y) const;
  void shift(float dvx, float dvy);
  void shapeMatch(float h, float stiffness, float blend);
  void pressurise(float h);
};
struct Contact { float approach, start, last; bool toppedUp, live; float easing, easeRate; };   // easing: rebound seconds left

class SoftBodyWorld {
 public:
  Body bodies[BODY_COUNT];
  float time = 0, accumulator = 0, drain = 0, gravityX = 0, gravityY = 0;
  int liveBodies = 0;
  float stiffness = 1500, damping = 10, gravity = 1002, maxSpeed = 300, drag = .6f, push = 500, pushRadius = 220, elasticity = .99f, friction = .2f;
  void init(uint32_t seed);
  int advance(float dt);   // returns the fixed steps taken
  void step(float h);
  void blast(float x, float y, int spare = -1);   // spare: the blob being long-pressed stays put
 private:
  uint32_t seed_;
  uint16_t liveContacts_[BODY_COUNT * (BODY_COUNT + 1) / 2 + BODY_COUNT], liveCount_ = 0;
  struct Impact { int body; float nx, ny, speed; } impacts_[8];
  int impactCount_ = 0, nextFamily_ = 1;
  Contact contacts_[BODY_COUNT][BODY_COUNT + 1];   // [lower id][higher id], column BODY_COUNT: the glass
  float random();
  void touch(int a, int b);
  void restitution(float elasticity, float h);
  void impact(int body, float nx, float ny, float speed);
  void splash(const Impact &hit);
  void shape(Body &b, float radius);
  void coalesce(float h);
  void remove(int body);
};
float outlineWidth(float radius, float seconds);
