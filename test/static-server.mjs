#!/usr/bin/env node
/**
 * Tiny static server for the end-to-end tests (Node `http`, no packages).
 *   /<host>/                       → test/hosts/<host>/index.html (angular, react, plain)
 *   /plain/vendor/debug-capture/*  → dist/*: the plain page's vendored copy (HLD §6.6)
 *   /hosts-out/*                   → .test-out/hosts/*, the host bundles (test/hosts/build.mjs)
 *   /dist/*                        → the prebuilt bundles (`npm run build` first)
 *   /api/ping                      → a small JSON reply, for the page to fetch
 * Usage: node test/static-server.mjs [port]   (default 4319)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? 4319);
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.map': 'application/json' };

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pong: true }));
    return;
  }
  const file = path.resolve(root, toFile(pathname));
  const allowed = [
    path.join(root, 'dist') + path.sep,
    path.join(root, 'test', 'hosts') + path.sep,
    path.join(root, '.test-out', 'hosts') + path.sep,
  ];
  if (!allowed.some((dir) => file.startsWith(dir))) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`e2e static server on http://127.0.0.1:${port}`));

/** The repo-relative file a URL path names (checked against `allowed` by the caller). */
function toFile(pathname) {
  const vendor = '/plain/vendor/debug-capture/';
  if (pathname.startsWith(vendor)) return `dist/${pathname.slice(vendor.length)}`;
  if (pathname.startsWith('/hosts-out/')) return `.test-out/hosts/${pathname.slice('/hosts-out/'.length)}`;
  const host = /^\/(angular|react|plain)\/$/.exec(pathname);
  if (host) return `test/hosts/${host[1]}/index.html`;
  return pathname.slice(1);
}
