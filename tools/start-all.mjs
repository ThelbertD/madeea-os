#!/usr/bin/env node
/**
 * Brings up everything the published dashboard needs, in one command.
 *
 *   node tools/start-all.mjs
 *
 * Starts, and leaves running:
 *   · OmniRoute            :20128   free AI for the model tabs
 *   · Open Design host     :7455 / :7456   daemon + the embedded studio
 *   · Bridge               :20129   lets https://thelbertd.github.io reach them
 *   · Local host           :4173    serves the exported pages over plain http
 *
 * Anything already running is left alone. Ctrl+C stops what this started.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OD = join(homedir(), 'open-design');
const children = [];

const up = async (url, ms = 2500) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok; }
  catch { return false; }
};

function run(label, cmd, args, opts = {}) {
  const c = spawn(cmd, args, { stdio: 'ignore', detached: false, shell: process.platform === 'win32', ...opts });
  c.on('error', (e) => console.log(`  ✖ ${label} — ${e.message}`));
  children.push(c);
  return c;
}

console.log('\n  MadeEA OS — starting services\n');

// 1. OmniRoute
if (await up('http://localhost:20128/v1/models')) {
  console.log('  ● OmniRoute        :20128  already running');
} else {
  run('OmniRoute', 'omniroute', []);
  console.log('  → OmniRoute        :20128  starting…');
}

// 2. Open Design — its own start script handles daemon + web
if (await up('http://127.0.0.1:7455/api/health')) {
  console.log('  ● Open Design      :7455   already running');
} else if (existsSync(join(OD, 'od-host-start.sh'))) {
  run('Open Design', 'bash', [join(OD, 'od-host-start.sh')]);
  console.log('  → Open Design      :7455   starting…');
} else {
  console.log('  ○ Open Design      :7455   not installed — see tools/opendesign/README.md');
}

// 3. Bridge
if (await up('http://127.0.0.1:20129/health')) {
  console.log('  ● Bridge           :20129  already running');
} else {
  run('bridge', process.execPath, [join(REPO, 'tools', 'bridge.mjs')]);
  console.log('  → Bridge           :20129  starting…');
}

// 4. Local host for the exported pages
if (await up('http://localhost:4173/madeea-os/app/')) {
  console.log('  ● Local host       :4173   already running');
} else {
  run('local host', process.execPath, [join(REPO, 'tools', 'serve-local.mjs'), '4173']);
  console.log('  → Local host       :4173   starting…');
}

// Give the slow ones a moment, then report what is actually up.
await new Promise((r) => setTimeout(r, 12000));

console.log('\n  ── status ──');
const checks = [
  ['OmniRoute        :20128', 'http://localhost:20128/v1/models'],
  ['Open Design      :7455 ', 'http://127.0.0.1:7455/api/health'],
  ['Open Design web  :7456 ', 'http://127.0.0.1:7456'],
  ['Bridge           :20129', 'http://127.0.0.1:20129/health'],
  ['Local host       :4173 ', 'http://localhost:4173/madeea-os/app/'],
];
for (const [label, url] of checks) console.log(`  ${(await up(url, 4000)) ? '●' : '○'} ${label}`);

console.log(`
  ── open it ──

  Local          http://localhost:4173/madeea-os/app/
                 works as-is, nothing else to configure

  Published      https://thelbertd.github.io/madeea-os/app/
                 needs Chrome's local-network check turned off once:
                 chrome://flags/#local-network-access-checks  → Disabled
                 chrome://flags/#block-insecure-private-network-requests → Disabled
                 then relaunch Chrome

  Ctrl+C to stop.
`);

const bye = () => { for (const c of children) { try { c.kill(); } catch {} } process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
setInterval(() => {}, 1 << 30);
