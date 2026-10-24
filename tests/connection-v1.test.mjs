import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { newState, beginHold, endHold, sampleState, attractionFor, connectionOptions } from '../harvey-link-v1.mjs';
import { Interaction } from '../interaction-v1.mjs';
import { createHarveyServer } from '../connection-v1/server-v1.mjs';
const WebSocket = createRequire(import.meta.url)('ws');
const roomA = 'a'.repeat(32), roomB = 'b'.repeat(32);
function next(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error('WebSocket message timeout')); }, 2000);
    function listener(bytes) { const value = JSON.parse(bytes); if (predicate(value)) { clearTimeout(timeout); ws.off('message', listener); resolve(value); } }
    ws.on('message', listener);
  });
}
test('whole hold including pauses sets proportional recovery; both appearance channels return to baseline', () => {
  const m = new Interaction(); m.hold(true, 1000); m.sample(16, 1000); m.step(.05, 1000);
  m.step(.05, 6000); m.hold(false, 6000);
  assert.equal(m.state.holdDurationSeconds, 5); assert.equal(m.state.recoverySeconds, 30);
  const peak = m.intensity; m.step(.016, 16000); assert.ok(m.intensity > 0 && m.intensity < peak);
  m.step(.016, 36000); assert.equal(m.intensity, 0); assert.deepEqual(m.background, [236, 234, 219]);
});
test('shake strength controls intensity independently from hold and recovery duration', () => {
  const models = [new Interaction(), new Interaction()];
  models.forEach((m, i) => { m.hold(true, 0); for (let n = 1; n <= 60; n++) { m.sample(i ? 16 : 4, n * 1000 / 60); m.step(1 / 60, n * 1000 / 60); } m.hold(false, 1000); });
  assert.ok(models[1].intensity > models[0].intensity); assert.equal(models[0].state.recoverySeconds, 30); assert.equal(models[1].state.recoverySeconds, 30);
});
test('recovery survives long frame gaps and re-holding preserves the current appearance', () => {
  let state = beginHold(newState(), 100000); state.intensity = .8; state = endHold(state, 102000);
  assert.equal(beginHold(state, 117000).intensity, sampleState(state, 117000).intensity);
  const m = new Interaction(); m.adopt(state, 102000, 500); m.step(.016, 30500); assert.equal(m.intensity, 0);
  assert.equal(attractionFor(1), 0); assert.equal(attractionFor(0), 1.3);
});
test('pairing selects WSS for secure pages and validates room and population', () => {
  const loc = { protocol: 'https:', host: 'example.test', pathname: '/portable/', search: `?room=${roomA}` };
  assert.equal(connectionOptions(loc).url.protocol, 'wss:'); assert.equal(connectionOptions(loc).population, 1);
  assert.equal(connectionOptions({ ...loc, search: `?room=${roomA}&ws=ws://example.test/socket` }), null);
  assert.equal(connectionOptions({ ...loc, search: '?room=short' }), null);
  assert.equal(connectionOptions({ ...loc, search: `?room=${roomA}&population=no` }), null);
});
test('relay verifies numeric state, population targeting, room isolation, writer locks, reconnect and disconnect recovery', async t => {
  let clock = 10000; const { server, wss } = createHarveyServer({ now: () => clock, tickMs: 10 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`;
  const clients = []; t.after(async () => { clients.forEach(ws => ws.terminate()); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => server.close(resolve)); });
  async function connect(role, room = roomA) { const ws = new WebSocket(`${origin.replace('http', 'ws')}/socket?role=${role}&room=${room}&population=1`); clients.push(ws); await next(ws, m => m.type === 'snapshot'); return ws; }
  const portable = await connect('portable'), ambient = await connect('ambient'), other = await connect('ambient', roomB);
  const send = (ws, type, intensity) => ws.send(JSON.stringify({ version: 1, type, intensity }));
  send(portable, 'hold'); await next(portable, m => m.states?.[1].phase === 'holding');
  send(portable, 'intensity', .8); const live = await next(ambient, m => m.states?.[1].intensity === .8);
  assert.equal(live.states[0].intensity, 0); assert.equal(live.states[2].intensity, 0); assert.equal(typeof live.states[1].intensity, 'number');
  send(portable, 'intensity', '1'); assert.equal((await next(portable, m => m.type === 'error')).code, 'invalid-intensity');
  const intruder = await connect('portable'); send(intruder, 'hold'); assert.equal((await next(intruder, m => m.type === 'error')).code, 'population-busy');
  send(ambient, 'hold'); assert.equal((await next(ambient, m => m.type === 'error')).code, 'invalid-message');
  assert.equal((await next(other, m => m.type === 'snapshot')).states[1].intensity, 0);
  clock += 2000; send(portable, 'release'); const released = await next(ambient, m => m.states?.[1].phase === 'recovering');
  assert.equal(released.states[1].holdDurationSeconds, 2); assert.equal(released.states[1].recoverySeconds, 30);
  clock += 15000; const halfway = await next(ambient, m => m.type === 'snapshot'); assert.ok(halfway.states[1].intensity > 0 && halfway.states[1].intensity < .8);
  const reconnected = await connect('ambient'); assert.ok((await next(reconnected, m => m.type === 'snapshot')).states[1].intensity > 0);
  clock += 15000; assert.equal((await next(ambient, m => m.type === 'snapshot')).states[1].intensity, 0);
  send(portable, 'hold'); await next(portable, m => m.states?.[1].phase === 'holding'); send(portable, 'intensity', .5); await next(portable, m => m.states?.[1].intensity === .5);
  clock += 1000; portable.close(); assert.equal((await next(ambient, m => m.states?.[1].phase === 'recovering')).states[1].recoverySeconds, 30);
  assert.equal((await fetch(`${origin}/portable/CONTEXT.md`)).status, 404); assert.equal((await fetch(`${origin}/portable/.git/config`)).status, 404);
});
test('unresponsive held clients automatically release', async t => {
  let clock = 0; const { server, wss } = createHarveyServer({ now: () => clock, tickMs: 10, holdTimeoutMs: 100 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket?role=portable&room=${roomA}&population=1`);
  t.after(async () => { ws.terminate(); for (const c of wss.clients) c.terminate(); await new Promise(resolve => server.close(resolve)); });
  await next(ws, m => m.type === 'snapshot'); ws.send(JSON.stringify({ version: 1, type: 'hold' })); await next(ws, m => m.states?.[1].phase === 'holding');
  clock = 200; assert.equal((await next(ws, m => m.states?.[1].phase === 'recovering')).states[1].recoverySeconds, 30);
});
test('a portable waking mid-recovery gets relative elapsed and remaining seconds; ambient stats stay out of room state', async t => {
  let clock = 50000; const { server, wss } = createHarveyServer({ now: () => clock, tickMs: 10 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `ws://127.0.0.1:${server.address().port}/socket?room=${roomA}&population=1`;
  const clients = []; t.after(async () => { clients.forEach(ws => ws.terminate()); for (const c of wss.clients) c.terminate(); await new Promise(resolve => server.close(resolve)); });
  async function connect(role) { const ws = new WebSocket(`${base}&role=${role}`); clients.push(ws); await next(ws, m => m.type === 'snapshot'); return ws; }
  const portable = await connect('portable'), ambient = await connect('ambient');
  portable.send(JSON.stringify({ version: 1, type: 'hold' })); await next(portable, m => m.states?.[1].phase === 'holding');
  clock += 10000; portable.send(JSON.stringify({ version: 1, type: 'release' })); await next(portable, m => m.states?.[1].phase === 'recovering');
  portable.close(); clock += 20000;
  const woken = await next(await connect('portable'), m => m.states?.[1].phase === 'recovering');
  assert.equal(woken.states[1].recoverySeconds, 50); assert.equal(woken.states[1].recoveryElapsedSeconds, 20); assert.equal(woken.states[1].recoveryRemainingSeconds, 30);
  assert.equal(woken.states[0].recoveryRemainingSeconds, 0);
  ambient.send(JSON.stringify({ version: 1, type: 'stats', fps: 59.8, width: 1024, height: 600 })); clock += 10;
  await next(ambient, m => m.type === 'snapshot');
  const reported = [...wss.clients].find(ws => ws.role === 'ambient'); assert.equal(reported.stats.fps, 59.8); assert.equal(reported.stats.width, 1024);
});
