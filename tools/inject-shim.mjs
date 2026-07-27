#!/usr/bin/env node
/**
 * Injects omni-shim.js into every page of the static export.
 *
 * The shim must patch window.fetch BEFORE any Next.js bundle runs, so it goes
 * in as the first <script> in <head> and is NOT deferred.
 *
 *   node tools/inject-shim.mjs app /madeea-os/app
 *
 * Idempotent — re-running skips files that already carry the tag.
 */
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.argv[2] || 'app';
const basePath = (process.argv[3] || '/madeea-os/app').replace(/\/+$/, '');

const SHIM = 'omni-shim.js';
const TAG = `<script src="${basePath}/${SHIM}"></script>`;

copyFileSync(join(here, SHIM), join(appDir, SHIM));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

let injected = 0, skipped = 0;
for (const file of walk(appDir)) {
  const html = readFileSync(file, 'utf8');
  if (html.includes(SHIM)) { skipped++; continue; }
  if (!html.includes('<head>')) { skipped++; continue; }
  writeFileSync(file, html.replace('<head>', '<head>' + TAG), 'utf8');
  injected++;
}

console.log(`shim injected into ${injected} page(s), ${skipped} skipped`);
