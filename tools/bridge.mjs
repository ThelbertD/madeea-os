#!/usr/bin/env node
/**
 * Local bridge that lets the GitHub Pages site talk to this machine.
 *
 *   node tools/bridge.mjs        → http://127.0.0.1:20129
 *
 * Chrome's Private Network Access blocks a public https origin from reaching
 * localhost — but it is a handshake, not a wall. Chrome sends a preflight
 * carrying `Access-Control-Request-Private-Network: true` and allows the call
 * only if the response includes
 *
 *     Access-Control-Allow-Private-Network: true
 *
 * Neither OmniRoute nor the Open Design daemon sends it, which is why calls
 * from thelbertd.github.io were refused. This bridge does, then forwards:
 *
 *     /omni/*   → http://localhost:20128/*     (OmniRoute)
 *     /od/*     → http://127.0.0.1:7455/*      (Open Design daemon)
 *     /odweb/*  → http://127.0.0.1:7456/*      (Open Design web UI)
 *     /health   → what is up right now
 *
 * Only the origins listed in ALLOWED are accepted, so a random site cannot
 * use it to reach your machine.
 */
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.argv[2] || process.env.BRIDGE_PORT || 20129);
const ALLOWED = [
  'https://thelbertd.github.io',
  ...(process.env.BRIDGE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
];

const TARGETS = {
  omni:  'http://localhost:20128',
  od:    'http://127.0.0.1:7455',
  odweb: 'http://127.0.0.1:7456',
};

function cors(res, origin) {
  if (origin && (ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept,X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', '*');
  // The header that makes this whole thing possible.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  cors(res, origin);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const seg = url.pathname.split('/').filter(Boolean);

  if (seg[0] === 'health') {
    const probe = async (u) => {
      try { const r = await fetch(u, { signal: AbortSignal.timeout(3000) }); return r.ok; }
      catch { return false; }
    };
    const [omni, od, odweb] = await Promise.all([
      probe(TARGETS.omni + '/v1/models'),
      probe(TARGETS.od + '/api/health'),
      probe(TARGETS.odweb),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ bridge: true, omniroute: omni, opendesign: od, opendesignWeb: odweb }));
  }

  const base = TARGETS[seg[0]];
  if (!base) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unknown target', targets: Object.keys(TARGETS) }));
  }

  const target = base + '/' + seg.slice(1).join('/') + url.search;
  const chunks = [];
  for await (const c of req) chunks.push(c);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!/^(host|origin|referer|connection|content-length|sec-|accept-encoding)/i.test(k)) headers[k] = v;
  }

  try {
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    });
    r.headers.forEach((v, k) => {
      // Keep our CORS/PNA headers; drop hop-by-hop and any upstream CORS.
      if (!/^(access-control-|content-encoding|transfer-encoding|connection)/i.test(k)) res.setHeader(k, v);
    });
    res.writeHead(r.status);
    if (r.body) Readable.fromWeb(r.body).pipe(res);
    else res.end();
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unreachable: ' + (e.message || e), target }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  MadeEA OS bridge  →  http://127.0.0.1:${PORT}`);
  console.log(`  allows: ${ALLOWED.join(', ')}`);
  console.log(`  routes: ${Object.entries(TARGETS).map(([k, v]) => `/${k}/* → ${v}`).join('\n          ')}`);
  console.log('\n  Ctrl+C to stop.\n');
});
