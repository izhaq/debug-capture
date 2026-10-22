#!/usr/bin/env node
/**
 * Server for the hostile host (research §4, HLD §8.2), Node `http`, no packages.
 * Every HTML page is sent with the strict CSP + Trusted Types header the
 * panel must live under (NFR-SEC-02, ISO-04):
 *   default-src 'self'; style-src 'self'; script-src 'self';
 *   require-trusted-types-for 'script'; trusted-types 'none'
 *
 *   /                → test/hostile-host/index.html (everything hostile at once)
 *   /<file>          → test/hostile-host/<file> (calm.html, zone.html, *.mjs, *.css)
 *   /dist/*          → the prebuilt bundles (`npm run build` first)
 *   /zone.js         → zone.js's browser bundle (dev dependency), for zone.html
 *   /ws-echo         → a WebSocket echo (upgrade only), for the S-06 e2e
 *
 * Usage: node test/hostile-host/server.mjs [port]   (default 4329)
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const port = Number(process.argv[2] ?? process.env.E2E_HOSTILE_PORT ?? 4329);
const CSP =
  "default-src 'self'; style-src 'self'; script-src 'self'; require-trusted-types-for 'script'; trusted-types 'none'";
const TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file;
  if (pathname === '/zone.js') file = path.join(root, 'node_modules', 'zone.js', 'bundles', 'zone.umd.js');
  else if (pathname.startsWith('/dist/')) file = path.resolve(root, pathname.slice(1));
  else file = path.resolve(here, pathname === '/' ? 'index.html' : pathname.slice(1));
  const allowed = [path.join(root, 'dist') + path.sep, here + path.sep, path.join(root, 'node_modules', 'zone.js')];
  if (!allowed.some((dir) => file.startsWith(dir))) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-store' };
    if (type === 'text/html') headers['content-security-policy'] = CSP;
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
})
  .on('upgrade', (req, socket) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname === '/ws-echo') echo(req, socket);
    else socket.destroy();
  })
  .listen(port, '127.0.0.1', () => console.log(`hostile host on http://127.0.0.1:${port}`));

/** A server frame (RFC 6455 §5.2): FIN set, not masked, any payload length. */
function frame(opcode, payload) {
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 0x10000) head = Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * `/ws-echo`: the smallest WebSocket server the S-06 e2e needs — no package
 * (brief 06). Text and binary frames come back as they went, a ping gets its
 * pong, and a close is answered with the same code and reason, so the page
 * sees a clean close with the code it chose. Browsers send small messages
 * unfragmented, so continuation frames are not handled.
 */
function echo(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // One chunk may hold several frames, or part of one: take whole frames, keep the rest.
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        at = 10;
      }
      const start = at + (masked ? 4 : 0);
      if (buffer.length < start + length) return;
      const payload = Buffer.from(buffer.subarray(start, start + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[at + (i % 4)];
      buffer = buffer.subarray(start + length);
      if (opcode === 0x8) {
        socket.end(frame(0x8, payload));
        return;
      }
      if (opcode === 0x9) socket.write(frame(0xa, payload));
      else if (opcode === 0x1 || opcode === 0x2) socket.write(frame(opcode, payload));
    }
  });
  socket.on('error', () => socket.destroy());
}
