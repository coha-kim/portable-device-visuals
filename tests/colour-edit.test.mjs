import test from 'node:test';
import assert from 'node:assert/strict';
import { ColourEdit, LONG_PRESS_SECONDS, RING_GRAB, hueAt, ringPoint, pickBlob } from '../colour-edit.mjs';
import { SoftBodyWorld } from '../softbody.mjs';
import { colourFor } from '../renderer.mjs';

const seeded = (s = 11) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
function setup() {
  const world = new SoftBodyWorld({ random: seeded(), count: 6 }); let hue = 20; const picked = [];
  const edit = new ColourEdit({ colourFor, getHue: () => hue, onColour(value) { hue = value; picked.push(value); } });
  const blob = world.bodies[0], c = blob.centroid;
  return { world, edit, blob, c, picked };
}
const hold = (edit, world, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) edit.step(1 / 60, world.bodies); };
function open({ edit, world, c }) { edit.press(c.x, c.y, world.bodies); edit.down = true; hold(edit, world, LONG_PRESS_SECONDS + .1); edit.release(c.x, c.y); }

test('wheel positions: hue 0 at the top, clockwise, and back again', () => {
  assert.deepEqual(ringPoint(0, 100), { x: 240, y: 140 });
  for (const hue of [0, 90, 200, 359]) { const p = ringPoint(hue); assert.ok(Math.abs(hueAt(p.x, p.y) - hue) < 1e-6); }
});
test('a press only counts on a blob, and opens the wheel after 3 s, not before', () => {
  const s = setup(), { edit, world, c, blob } = s;
  assert.equal(pickBlob(world.bodies, c.x, c.y), blob);
  assert.equal(edit.press(c.x, c.y, world.bodies), false, 'the display still gets the press');
  hold(edit, world, LONG_PRESS_SECONDS - .1); assert.equal(edit.state, 'pressing');
  hold(edit, world, .2); assert.equal(edit.state, 'open'); assert.equal(edit.hue, 20, 'starts on the current colour');
  const other = setup(); other.edit.press(240, 240, []); assert.equal(other.edit.state, 'idle');
});
test('moving or lifting early cancels the long press', () => {
  const a = setup(); a.edit.press(a.c.x, a.c.y, a.world.bodies); a.edit.move(a.c.x + 20, a.c.y); hold(a.edit, a.world, 4); assert.equal(a.edit.state, 'idle');
  const b = setup(); b.edit.press(b.c.x, b.c.y, b.world.bodies); hold(b.edit, b.world, 1); b.edit.release(b.c.x, b.c.y); assert.equal(b.edit.state, 'idle');
});
test('the wheel picks a colour; a short pull fires nothing; a press inside closes it', () => {
  const s = setup(), { edit, world, picked } = s; open(s);
  const p = ringPoint(200); assert.equal(edit.press(p.x, p.y, world.bodies), true);
  assert.ok(Math.abs(edit.hue - 200) < 1e-6);
  const q = ringPoint(200, RING_GRAB - 2); edit.move(q.x, q.y); assert.ok(edit.pull, 'off the wheel: the sling is stretched'); edit.release(q.x, q.y);
  assert.equal(edit.state, 'open'); assert.equal(picked.length, 0, 'not fired');
  assert.equal(edit.press(240, 240, world.bodies), true); assert.equal(edit.state, 'idle');
});
test('the sling flies into the selected blob wherever it has gone, then the colour spreads', () => {
  const s = setup(), { edit, world, blob, picked } = s; open(s);
  const p = ringPoint(200); edit.press(p.x, p.y, world.bodies);
  const q = ringPoint(200, 120); edit.move(q.x, q.y); edit.release(q.x, q.y); assert.equal(edit.state, 'flying');
  for (const n of blob.nodes) { n.x += 30; n.y -= 20; }
  hold(edit, world, 1.5);
  assert.deepEqual(picked.map(Math.round), [200]); assert.equal(edit.state, 'idle');
  assert.ok(Math.hypot(blob.velocity.x, blob.velocity.y) > 0, 'the hit nudges the blob');
  edit.ripple = { x: 0, y: 0, from: '#123456', time: 0 };
  assert.equal(edit.colourOf(blob), '#123456', 'not reached yet: old colour');
  edit.ripple.time = 2; assert.equal(edit.colourOf(blob), null, 'reached: the new fill');
});
test('a press spares the blob being long-pressed', () => {
  const { world, blob, c } = setup(), other = world.bodies[1], o = other.centroid;
  world.blast((c.x + o.x) / 2, (c.y + o.y) / 2, 1, blob);
  assert.deepEqual(blob.velocity, { x: 0, y: 0 }); assert.ok(Math.hypot(other.velocity.x, other.velocity.y) > 0, 'its neighbour is still kicked');
});
