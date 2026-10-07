import test from 'node:test';
import assert from 'node:assert/strict';
import { Interaction, MotionReader } from '../interaction.mjs';
function shake(model, strength, seconds, hz = 60) {
  for (let i = 1; i <= seconds * hz; i++) { const now = i * 1000 / hz; model.sample(strength, now); model.step(1 / hz, now); }
}
test('shaking without holding and holding without shaking leave appearance unchanged', () => {
  const m = new Interaction(); shake(m, 20, 2); assert.equal(m.intensity, 0); assert.equal(m.period, 0);
  m.hold(true); shake(m, 0, 2); assert.equal(m.opacity, 1); assert.equal(m.period, 0);
});
test('harder shakes fade faster; equal active duration gives equal period', () => {
  const a = new Interaction(), b = new Interaction(); a.hold(true); b.hold(true);
  shake(a, 4, 3); shake(b, 14, 3);
  assert.ok(b.opacity < a.opacity); assert.equal(a.period, b.period);
});
test('release retains result even if device keeps shaking', () => {
  const m = new Interaction(); m.hold(true); shake(m, 12, 2); const saved = m.values;
  m.hold(false); shake(m, 20, 6); assert.deepEqual(m.values, saved);
});
test('stale motion and pre-hold motion cannot accumulate', () => {
  const m = new Interaction(); m.sample(20, 0); m.hold(true); m.step(.05, 1); assert.equal(m.period, 0);
  m.sample(20, 10); m.step(.05, 1000); assert.equal(m.period, 0);
});
test('opacity bounded; exact background endpoints and duration cap', () => {
  const m = new Interaction(); assert.deepEqual(m.background, [236,234,219]); m.hold(true); shake(m, 99, 40);
  assert.ok(Math.abs(m.opacity - .12) < 1e-10); assert.equal(m.period, 20); assert.deepEqual(m.background, [226,221,177]);
});
test('interaction integration is independent of normal frame rate', () => {
  const a = new Interaction(), b = new Interaction(); a.hold(true); b.hold(true); shake(a, 8, 3, 30); shake(b, 8, 3, 120);
  assert.ok(Math.abs(a.intensity-b.intensity)<1e-10); assert.ok(Math.abs(a.period-b.period)<1e-10);
});
test('stationary gravity is not shaking; invalid samples are ignored', () => {
  const r = new MotionReader();
  for (let i=0;i<100;i++) assert.equal(r.read({accelerationIncludingGravity:{x:0,y:0,z:9.81}}, i*16), 0);
  assert.equal(r.read({acceleration:{x:null,y:null,z:null}}, 1700), null);
  assert.equal(r.read({acceleration:{x:3,y:4,z:0}}, 1700), 5);
});
