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
 *
 * Usage: node test/hostile-host/server.mjs [port]   (default 4329)
 */
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
}).listen(port, '127.0.0.1', () => console.log(`hostile host on http://127.0.0.1:${port}`));
