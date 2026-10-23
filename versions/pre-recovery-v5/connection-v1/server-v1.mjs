import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { newState, beginHold, endHold, sampleState, RECOVERY_MULTIPLIER } from '../harvey-link-v1.mjs';
const { WebSocketServer } = createRequire(import.meta.url)('ws');
const portableRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ambientRoot = process.env.HARVEY_AMBIENT_DIR || resolve(portableRoot, '..', 'ambient-device-visuals');
const allowed = {
  portable: new Set(['index.html', 'app.js', 'style.css', 'renderer.mjs', 'interaction.mjs', 'interaction-v1.mjs', 'interaction-v3.mjs', 'harvey-link-v1.mjs']),
  ambient: new Set(['index.html', 'sketch.js', 'ambient-link-v1.mjs', 'harvey-link-v1.mjs'])
};
const mime = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css' };
export function createHarveyServer({ now = Date.now, holdTimeoutMs = 2500, tickMs = 100 } = {}) {
  const rooms = new Map();
  function roomFor(id) {
    if (!rooms.has(id)) {
      if (rooms.size >= 100) return null;
      rooms.set(id, { states: Array.from({ length: 3 }, newState), holders: [null, null, null], lastSeen: [0, 0, 0], touched: now() });
    }
    return rooms.get(id);
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/') {
      let room = url.searchParams.get('room');
      if (!/^[a-f0-9]{32}$/.test(room || '')) { res.writeHead(302, { Location: `/?room=${randomBytes(16).toString('hex')}` }); res.end(); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harvey connection v1</title><style>body{font:18px system-ui;max-width:620px;margin:12vh auto;padding:24px;background:#eceadb;color:#15443c}a{display:block;padding:20px;margin:16px 0;border:1px solid;border-radius:12px;color:inherit}p{line-height:1.6}</style><h1>Harvey connection v1</h1><p>Open the portable in another window and the ambient on your display. Use these two links to keep them paired.</p><a href="/portable/?room=${room}&population=1">Open portable visuals</a><a href="/ambient/?room=${room}">Open ambient visuals</a><p>Hold the portable button to create more space. Each second held gives ${RECOVERY_MULTIPLIER} seconds of recovery after release.</p></html>`); return;
    }
    if (url.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"version":1}'); return; }
    const match = url.pathname.match(/^\/(portable|ambient)\/([^/]*)$/);
    const kind = match?.[1], name = match?.[2] || 'index.html';
    if (!kind || !allowed[kind].has(name)) { res.writeHead(404); res.end('Not found'); return; }
    try { const body = await readFile(resolve(kind === 'portable' ? portableRoot : ambientRoot, name));
      res.setHeader('Content-Type', `${mime[name.split('.').pop()]}; charset=utf-8`); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('room'), role = url.searchParams.get('role');
    const population = Number(url.searchParams.get('population'));
    const origin = req.headers.origin;
    const hostOrigin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
    if (url.pathname !== '/socket' || !/^[a-f0-9]{32}$/.test(roomId || '') || !['portable', 'ambient'].includes(role)
      || !Number.isInteger(population) || population < 0 || population > 2
      || (origin && origin !== hostOrigin && origin !== 'https://coha-kim.github.io')) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
    }
    const room = roomFor(roomId);
    if (!room) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => { Object.assign(ws, { roomId, role, population }); wss.emit('connection', ws); });
  });
  const send = (ws, data) => { if (ws.readyState === 1 && ws.bufferedAmount < 65536) ws.send(JSON.stringify(data)); };
  function snapshot(ws) {
    const room = rooms.get(ws.roomId); if (!room) return;
    const time = now(); send(ws, { version: 1, type: 'snapshot', serverNow: time, states: room.states.map(s => sampleState(s, time)) });
  }
  function release(ws) {
    const room = rooms.get(ws.roomId), p = ws.population;
    if (room?.holders[p] !== ws) return;
    room.states[p] = endHold(room.states[p], now()); room.holders[p] = null;
  }
  wss.on('connection', ws => {
    snapshot(ws); let windowStart = now(), count = 0;
    ws.on('message', bytes => {
      if (now() - windowStart >= 1000) { windowStart = now(); count = 0; }
      if (++count > 60) { ws.close(1008, 'Too many messages'); return; }
      let message; try { message = JSON.parse(bytes.toString()); } catch { send(ws, { type: 'error', code: 'invalid-message' }); return; }
      if (!message || message.version !== 1 || !['hold', 'intensity', 'release'].includes(message.type) || ws.role !== 'portable') {
        send(ws, { type: 'error', code: 'invalid-message' }); return;
      }
      const room = rooms.get(ws.roomId), p = ws.population, time = now(); room.touched = time;
      if (room.holders[p] && room.holders[p] !== ws) { send(ws, { type: 'error', code: 'population-busy' }); return; }
      if (message.type === 'hold') {
        if (!room.holders[p]) { room.states[p] = beginHold(room.states[p], time); room.holders[p] = ws; }
        room.lastSeen[p] = time;
      } else if (room.holders[p] === ws) {
        if (message.type === 'release') release(ws);
        else if (typeof message.intensity === 'number' && Number.isFinite(message.intensity) && message.intensity >= 0 && message.intensity <= 1) {
          room.states[p].intensity = message.intensity; room.lastSeen[p] = time;
        } else send(ws, { type: 'error', code: 'invalid-intensity' });
      }
      snapshot(ws);
    });
    ws.on('error', () => {}); ws.on('close', () => release(ws));
  });
  const tick = setInterval(() => {
    for (const [id, room] of rooms) {
      for (let p = 0; p < 3; p++) if (room.holders[p] && now() - room.lastSeen[p] > holdTimeoutMs) release(room.holders[p]);
      if (now() - room.touched > 86400000 && ![...wss.clients].some(ws => ws.roomId === id)) rooms.delete(id);
    }
    for (const ws of wss.clients) snapshot(ws);
  }, tickMs);
  tick.unref();
  server.on('close', () => { clearInterval(tick); wss.close(); });
  return { server, wss, rooms };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createHarveyServer();
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Harvey WebSocket v1: http://${host}:${port}/`));
}
