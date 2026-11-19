#!/usr/bin/env python3
# Live dashboard for the board: reads its serial port and passes the values to index.html as server-sent
# events. Run it, open http://127.0.0.1:8041/, and stop it before flashing (it holds the port).
import glob, json, os, queue, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import serial

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8041
SUMMARY = re.compile(r'fps ([\d.]+) \| draw ([\d.]+) ms \| physics (\d+) steps/s .*?, (\d+)% of core')
FIELDS = ('gx', 'gy', 'upZ', 'tip', 'drain', 'touch', 'edit', 'hue', 'upX', 'upY', 'tx', 'ty', 'held', 'asleep')
listeners, lock = [], threading.Lock()

def send(message):
    data = json.dumps(message)
    with lock:
        for q in listeners:
            if q.qsize() < 200: q.put(data)

def read_board():
    while True:
        ports = glob.glob('/dev/cu.usbmodem*')
        if not ports:
            send({'status': 'no board'}); time.sleep(1); continue
        try:
            s = serial.Serial(); s.port = ports[0]; s.baudrate = 115200; s.timeout = .2; s.dtr = False; s.rts = False; s.open()
            send({'status': 'connected', 'port': ports[0]})
            asked, buffer, heard = 0, b'', time.time()
            while True:
                if time.time() - asked > 2: s.write(b'd'); asked = time.time()
                buffer += s.read(4096)
                *lines, buffer = buffer.split(b'\n')
                for raw in lines:
                    line = raw.decode('utf8', 'replace').strip()
                    if line.startswith('D '):
                        parts = line.split()[1:]
                        if len(parts) == len(FIELDS):
                            send(dict(zip(FIELDS, map(float, parts)), t=time.time())); heard = time.time()
                    else:
                        m = SUMMARY.search(line)
                        if m: send({'fps': float(m[1]), 'draw': float(m[2]), 'steps': float(m[3]), 'core': float(m[4])})
                if time.time() - heard > 4: send({'status': 'silent'}); heard = time.time()
        except (OSError, serial.SerialException, ValueError):
            send({'status': 'reconnecting'}); time.sleep(1)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/events':
            q = queue.Queue()
            with lock: listeners.append(q)
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
            try:
                while True:
                    try: self.wfile.write(f'data: {q.get(timeout=5)}\n\n'.encode())
                    except queue.Empty: self.wfile.write(b': keep-alive\n\n')
                    self.wfile.flush()
            except OSError: pass
            finally:
                with lock: listeners.remove(q)
        elif self.path == '/':
            with open(os.path.join(HERE, 'index.html'), 'rb') as f: body = f.read()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)
        else:
            self.send_error(404)

threading.Thread(target=read_board, daemon=True).start()
print(f'Dashboard on http://127.0.0.1:{PORT}/', flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
