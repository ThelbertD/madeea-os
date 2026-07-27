/**
 * Serves the Open Design web UI for the MadeEA OS embed.
 *
 * apps/web is built with Next's `output: "export"`, so `next start` refuses to
 * run it — the files must be served statically from apps/web/out. The UI also
 * calls same-origin /api/*, which tools-dev normally proxies to the daemon, so
 * this does both: static files + a proxy to 127.0.0.1:7455.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(process.env.OD_WEB_ROOT || 'apps/web/out');
const PORT = Number(process.env.OD_WEB_PORT || 7456);
const DAEMON = process.env.OD_DAEMON || 'http://127.0.0.1:7455';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function proxy(req, res) {
  const target = DAEMON + req.url;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    });
    const out = {};
    r.headers.forEach((v, k) => { if (!/^(content-encoding|transfer-encoding|connection)$/i.test(k)) out[k] = v; });
    res.writeHead(r.status, out);
    if (r.body) { const { Readable } = await import('node:stream'); Readable.fromWeb(r.body).pipe(res); }
    else res.end();
  } catch (e) {
    send(res, 502, JSON.stringify({ error: 'daemon unreachable: ' + e.message }), 'application/json');
  }
}

function serveFile(res, file) {
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': file.includes('_next/static') ? 'public,max-age=31536000,immutable' : 'no-store',
  });
  createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  // The UI talks to the daemon same-origin; forward those through.
  if (path.startsWith('/api/')) return proxy(req, res);

  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');           // traversal guard
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';
  // Client-routed paths fall back to the shell, as a static host would.
  if (!existsSync(file)) file = join(ROOT, 'index.html');
  if (!existsSync(file)) return send(res, 404, 'not found');

  serveFile(res, file);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[od-web] serving ${ROOT} on http://127.0.0.1:${PORT} (api → ${DAEMON})`);
});
