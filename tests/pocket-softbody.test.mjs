import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBodyWorld } from '../pocket-softbody.mjs';

const run = (w, seconds, each = () => {}) => { for (let t = 0; t < seconds; t += 1 / 60) { each(); w.advance(1 / 60); } };
const finite = w => w.bodies.every(b => b.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
const inside = w => w.bodies.every(b => b.nodes.every(n => n.x > -2 && n.y > -2 && n.x < w.width + 2 && n.y < w.height + 2));

test('level, the blobs wander and stay on the page', () => {
  const w = new SoftBodyWorld({ width: 768, height: 480, seed: 3 });
  run(w, 20);
  assert.ok(finite(w) && inside(w));
});

test('a held, tipped drain pulls every blob in and melts them', () => {
  const w = new SoftBodyWorld({ width: 768, height: 480, seed: 7 });
  run(w, 3);
  Object.assign(w, { drainX: 620, drainY: 110, pull: .6 });
  run(w, 4, () => { w.squish = Math.min(1, w.squish + 1 / 240); w.drain = Math.min(1, w.drain + 1 / 180); });
  assert.ok(finite(w) && inside(w));
  for (const b of w.bodies) assert.ok(Math.hypot(b.cx - 620, b.cy - 110) < 160, `blob at ${b.cx.toFixed(0)}, ${b.cy.toFixed(0)}`);
});

test('released at a flat battery, blobs keep apart', () => {
  const w = new SoftBodyWorld({ width: 768, height: 480, seed: 7 });
  Object.assign(w, { drainX: 384, drainY: 240, pull: .6, squish: 1, drain: 1 });
  run(w, 4);
  Object.assign(w, { pull: 0, squish: 0 });
  run(w, 15);
  assert.ok(finite(w) && inside(w));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const a = w.bodies[i], b = w.bodies[j];
    assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.radius - b.radius > -4, 'drained blobs overlap');
  }
});

test('tilted in a rounded tray, blobs gather on the low side and stay inside the corners', () => {
  const w = new SoftBodyWorld({ width: 576, height: 480, radius: 70, cornerRadius: 70, seed: 11 });
  Object.assign(w, { gravityX: .42, gravityY: .42, squish: .6 });
  run(w, 5);
  assert.ok(finite(w));
  const cr = 70, cx = 576 - cr, cy = 480 - cr;
  for (const b of w.bodies) {
    assert.ok(b.cx > 576 / 2 && b.cy > 480 / 2, `blob at ${b.cx.toFixed(0)}, ${b.cy.toFixed(0)}`);
    for (const n of b.nodes) if (n.x > cx && n.y > cy) assert.ok(Math.hypot(n.x - cx, n.y - cy) < cr + 2, 'outside the rounded corner');
  }
});
