#!/usr/bin/env node
/**
 * Publishes this machine's AI services over https, so the deployed dashboards
 * can use them.
 *
 *   node tools/tunnel.mjs
 *
 * Why a tunnel: a browser forbids a public https page (vercel.app,
 * github.io) from reaching localhost. As of Chrome 150 that is a per-site
 * permission, and no response header satisfies it. Behind an https address
 * the page is making an ordinary cross-origin request, so the restriction
 * never applies.
 *
 * Starts the bridge (with a fresh token), tunnels it, and prints the one link
 * to open. The link carries the bridge URL and token once; the page stores
 * them and strips them from the address bar.
 *
 * Requires cloudflared:
 *   https://github.com/cloudflare/cloudflared/releases/latest
 *   → cloudflared-windows-amd64.exe, saved anywhere on PATH
 *
 * ⚠ The tunnel URL is reachable by anyone who has it. The token is what keeps
 *   your gateway private — do not paste the link anywhere public. Quick
 *   tunnels are ephemeral: stop this and the URL dies.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.BRIDGE_TOKEN || 'madeea-' + randomBytes(8).toString('hex');
const SITE = process.argv[2] || 'https://madeea-os.vercel.app/madeea-os/app/';

const CF = [
  join(homedir(), '.local', 'bin', 'cloudflared.exe'),
  'cloudflared',
].find((p) => p === 'cloudflared' || existsSync(p));

const children = [];
const stop = () => { for (const c of children) { try { c.kill(); } catch {} } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const up = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; } };

/** Runs a quick tunnel and resolves with its public URL. */
function tunnel(port, label) {
  return new Promise((res, rej) => {
    const c = spawn(CF, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(c);
    let done = false;
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !done) { done = true; res(m[0]); }
    };
    c.stdout.on('data', scan);
    c.stderr.on('data', scan);          // cloudflared prints the URL on stderr
    c.on('error', rej);
    setTimeout(() => { if (!done) rej(new Error(`${label}: no URL after 45s`)); }, 45000);
  });
}

console.log('\n  MadeEA OS — publishing local services\n');

if (!CF) {
  console.error('  cloudflared not found. Download the single binary from');
  console.error('  https://github.com/cloudflare/cloudflared/releases/latest');
  console.error('  and save it as ~/.local/bin/cloudflared.exe\n');
  process.exit(1);
}

// The bridge fronts OmniRoute and the Open Design daemon, and adds the CORS
// headers neither of them sends.
if (await up('http://127.0.0.1:20129/health')) {
  console.log('  ● bridge already running on :20129');
  console.log('    (restart it with this token if calls come back 401)');
} else {
  const c = spawn(process.execPath, [join(REPO, 'tools', 'bridge.mjs'), '20129'], {
    stdio: 'ignore', env: { ...process.env, BRIDGE_TOKEN: TOKEN },
  });
  children.push(c);
  console.log('  → bridge starting on :20129');
  await new Promise((r) => setTimeout(r, 2500));
}

console.log('  → opening tunnels…\n');
const bridgeUrl = await tunnel(20129, 'bridge');
console.log(`  ● bridge      ${bridgeUrl}`);

let odUrl = '';
if (await up('http://127.0.0.1:7456')) {
  odUrl = await tunnel(7456, 'open-design').catch(() => '');
  if (odUrl) console.log(`  ● open design ${odUrl}`);
} else {
  console.log('  ○ open design not running — skipped');
}

const link = `${SITE}?bridge=${bridgeUrl}&t=${TOKEN}` + (odUrl ? `&odweb=${odUrl}` : '');

console.log(`
  ── open this once ──

${link}

  The page stores the address and token, then clears them from the URL.
  Afterwards just visit ${SITE}

  Working through the tunnel: OmniRoute chat, the model list, the Mastermind,
  Free Claude Code. The Open Design *embed* will not load remotely — the
  studio navigates to its own 127.0.0.1 origin, which a public page cannot
  follow. Use it at localhost:3737.

  ⚠ Anyone with that link can use your gateway. Keep it to yourself, and
    Ctrl+C when you are done — the URLs die with this process.
`);

setInterval(() => {}, 1 << 30);
