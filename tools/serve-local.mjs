#!/usr/bin/env node
/**
 * Serves the exported dashboard over plain HTTP from this machine.
 *
 *   node tools/serve-local.mjs           → http://localhost:4173/madeea-os/app/
 *   node tools/serve-local.mjs 8080      → a different port
 *
 * Why this exists
 * ───────────────
 * The same pages on GitHub Pages cannot reach anything on your computer.
 * Chrome refuses it outright:
 *
 *   Access to fetch at 'http://localhost:20128/v1/models' from origin
 *   'https://thelbertd.github.io' has been blocked by CORS policy:
 *   Permission was denied for this request to access the `loopback`
 *   address space.
 *
 * That is Private Network Access, and it applies to iframes too — the Open
 * Design embed never loads either. It is a browser rule about https pages
 * touching localhost, so no amount of page code gets around it.
 *
 * Served from http://localhost the restriction does not apply, and the very
 * same files light up: OmniRoute chat, the Mastermind, and the Open Design
 * iframe all work.
 *
 * The URL keeps the /madeea-os/ prefix because the export was built with
 * basePath '/madeea-os/app' — every asset and the shim tag are absolute.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const PREFIX = '/madeea-os';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip',
};

/**
 * Server-side proxy for local services that send no CORS headers.
 *
 * OmniRoute reflects the request origin, so the page calls it directly. The
 * Open Design daemon does not — a browser fetch to :7455 dies with "No
 * 'Access-Control-Allow-Origin' header". Node has no such restriction, so we
 * relay it and add the header ourselves.
 */
async function relay(res, target) {
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(6000) });
    const body = await r.text();
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}

const server = http.createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (path === '/') { res.writeHead(302, { Location: `${PREFIX}/app/` }); return res.end(); }

  // Proxy endpoints the shim looks for. Kept outside PREFIX so they are
  // unambiguous, and named with __ so they cannot collide with exported paths.
  if (path === '/__od/health') return relay(res, 'http://127.0.0.1:7455/api/health');
  if (path === `${PREFIX}/__od/health`) return relay(res, 'http://127.0.0.1:7455/api/health');

  if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/';

  let file = join(REPO, path);
  if (!file.startsWith(REPO)) { res.writeHead(403); return res.end('forbidden'); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';

  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<body style="background:#09141f;color:#f4f4f5;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
      <div style="text-align:center"><h1 style="font-weight:600">404</h1>
      <p style="color:#6b7d8f">Nothing at ${path} — try <a style="color:#fd5812" href="${PREFIX}/app/">the dashboard</a>.</p></div></body>`);
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': file.includes('_next/static') ? 'public,max-age=31536000,immutable' : 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}${PREFIX}/app/`;
  console.log(`\n  MadeEA OS  →  ${url}\n`);

  const probe = async (u, label) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
      console.log(`  ${r.ok ? '●' : '○'} ${label}`);
    } catch { console.log(`  ○ ${label} — not running`); }
  };
  await probe('http://localhost:20128/v1/models', 'OmniRoute (AI tabs)      :20128');
  await probe('http://127.0.0.1:7455/api/health', 'Open Design daemon        :7455');
  await probe('http://127.0.0.1:7456', 'Open Design web (iframe)  :7456');
  console.log('\n  Ctrl+C to stop.\n');
});
