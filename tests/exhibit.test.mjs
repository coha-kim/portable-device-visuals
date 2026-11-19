import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { ShakeDrain, RECOVERY_RATIO } from '../softbody.mjs';
import { createHarveyServer } from '../connection-v1/server-v1.mjs';

test('exhibition recovery: a shorter ratio, so 3 s of shaking comes back in 18 s; the device keeps its own', () => {
  const shake = { held: true, intensity: .6 };
  const quick = new ShakeDrain({ recoveryRatio: 6 }), device = new ShakeDrain();
  for (let i = 0; i < 60 * 3; i++) { quick.step(1 / 60, shake); device.step(1 / 60, shake); }
  assert.ok(Math.abs(quick.remaining - 18) < 1e-6, 'counts down from 18 s');
  assert.equal(device.recoveryRatio, RECOVERY_RATIO); assert.ok(Math.abs(device.remaining - 180) < 1e-6);
  for (let i = 0; i < 60 * 17; i++) quick.step(1 / 60, { held: false });
  assert.ok(quick.seconds > 0 && quick.remaining < 1.01, 'one second left after 17 s');
  for (let i = 0; i < 60 * 2; i++) quick.step(1 / 60, { held: false });
  assert.equal(quick.seconds, 0); assert.equal(quick.remaining, 0);
});

test('exhibition page: fixed Harvey orange sent to the ambient, no colour or tuning controls, mouse and phone shaking', async () => {
  const [html, js] = await Promise.all(['exhibit.html', 'exhibit.js'].map(f => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));
  assert.match(js, /link\.sendColour\(FILL\)/);
  assert.match(js, /new ShakeDrain\(\{ recoveryRatio: EXHIBIT_RECOVERY_RATIO \}\)/);
  assert.match(js, /interaction\.sampleVector\(a\.x, a\.y, 0, now\)/, 'mouse shake feeds the shake model');
  assert.match(js, /addEventListener\('devicemotion', onMotion\)/);
  assert.doesNotMatch(html, /type="range"|id="hue"|tap-ambient/, 'nothing for visitors to tune or recolour');
  for (const id of ['scene', 'track', 'level', 'leader', 'camera', 'mirror', 'camera-button', 'shake-button', 'motion-button']) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('the bridge serves the exhibition page and its wordmark, and links to it', async t => {
  const { server } = createHarveyServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, base = `${origin}/portable/`;
  for (const [path, type] of [['exhibit.html', 'text/html; charset=utf-8'], ['exhibit.js', 'text/javascript; charset=utf-8'], ['exhibit.css', 'text/css; charset=utf-8'], ['renderer-3d.mjs', 'text/javascript; charset=utf-8'], ['presence-mirror.mjs', 'text/javascript; charset=utf-8'], ['assets/harvey-wordmark-sketch.png', 'image/png']]) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path); assert.equal(response.headers.get('content-type'), type, path);
  }
  const home = await (await fetch(`${origin}/?room=${'c'.repeat(32)}`)).text();
  assert.match(home, /\/portable\/exhibit\.html\?room=c{32}&population=1/);
});

test('bubbles on the exhibition page: sticky contacts that cling to a nudge but part under a firm pull; off by default', async () => {
  const { SoftBodyWorld } = await import('../softbody.mjs');
  const seeded = (s = 11) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const place = (body, x, y) => { const c = body.centroid; for (const n of body.nodes) { n.x += x - c.x; n.y += y - c.y; n.vx = n.vy = 0; } };
  const pair = (stick, kick) => {
    const w = new SoftBodyWorld({ random: seeded(), count: 2, stick }); w.set('stiffness', 1800);
    const [A, B] = w.bodies, t = A.radius + B.radius; place(A, 240 - t / 2 - 1.5, 240); place(B, 240 + t / 2 + 1.5, 240);
    for (let f = 0; f < 120; f++) w.advance(1 / 60);
    const settled = Math.hypot(A.centroid.x - B.centroid.x, A.centroid.y - B.centroid.y) - t;
    A.shift(-kick, 0); B.shift(kick, 0); for (let f = 0; f < 60; f++) w.advance(1 / 60);
    return { settled, after: Math.hypot(A.centroid.x - B.centroid.x, A.centroid.y - B.centroid.y) - t };
  };
  assert.equal(new SoftBodyWorld().stick, 0, 'the device has no stickiness');
  assert.ok(Math.abs(pair(0, 0).settled - 3) < 1e-6, 'without it a 3 px gap stays open');
  const nudge = pair(700, 30), pull = pair(700, 120);
  assert.ok(nudge.settled < 0, `the gap closes and they press into a shared wall (${nudge.settled.toFixed(1)} px)`);
  assert.ok(nudge.after < 1, `a 60 px/s nudge doesn't part them (${nudge.after.toFixed(1)} px)`);
  assert.ok(pull.after > 8, `a 240 px/s pull does (${pull.after.toFixed(1)} px)`);
});
