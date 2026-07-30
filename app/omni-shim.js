/* ══════════════════════════════════════════════════════════════════════════
   MadeEA OS — browser gateway shim
   ──────────────────────────────────────────────────────────────────────────
   The static export at /app/ has no server, so every fetch("/api/…") the
   components make would 404. This patches window.fetch and answers those
   calls in the browser instead, talking straight to a local OmniRoute
   gateway on http://localhost:20128.

   That is only possible because OmniRoute reflects the request origin in
   access-control-allow-origin, so an https page may call it directly.

   Endpoints reimplemented here mirror the real route handlers exactly, so
   the untouched React components cannot tell the difference:
     GET  /api/omniroute/status     → { running, base, api, dashboard, apiStatus, models }
     POST /api/omniroute/chat       → { ok, content, model, usage, triedCount }
     GET  /api/omniroute/workspace  → { builds, sessions }        (localStorage)
     POST /api/omniroute/workspace  → saveBuild / saveSession     (localStorage)
     GET  /api/room                 → { agents }
     POST /api/room                 → NDJSON stream of typing/msg/done
     GET  /api/fcc                  → { enabled, reachable, model, provider }
     GET  /api/version              → { version }
   Anything else under /api/ returns an empty 200 so pages render their
   "nothing here yet" state instead of hanging or spraying console errors.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS = 'madeea.shim.';
  var GATEWAY = (function () {
    try { return localStorage.getItem(LS + 'gateway') || 'http://localhost:20128'; }
    catch (e) { return 'http://localhost:20128'; }
  })();

  // Same fallback chain and steer text as src/app/api/omniroute/chat/route.ts —
  // free reasoning models otherwise burn the whole token budget thinking and
  // return nothing.
  var FREE_CHAIN = [
    'oc/deepseek-v4-flash-free',
    'opencode-zen/big-pickle',
    'oc/big-pickle',
    'auto/coding:free',
    'auto/best-free',
    'auto/cheap'
  ];
  var STEER = 'You are a fast, senior coding assistant. Do NOT overthink or deliberate at length. Answer immediately and concisely. When asked for code, output it right away in a single fenced code block, complete and self-contained. Keep any reasoning to an absolute minimum.';

  var AGENTS = [
    { id: 'claude',   name: 'Claude',           color: '#ff8a5b', persona: 'You are Claude — thoughtful, careful, balanced. You weigh trade-offs, bring nuance, and give a calm, precise take. You gently flag risks others miss.' },
    { id: 'hermes',   name: 'Hermes',           color: '#60a5fa', persona: 'You are Hermes — direct, action-oriented, a little unfiltered. You cut straight to the practical next step and call out fluff. You like momentum.' },
    { id: 'gemini',   name: 'Gemini',           color: '#4285F4', persona: 'You are Gemini — broad knowledge, curious and upbeat. You bring data, facts, and a research angle to the table.' },
    { id: 'codex',    name: 'Codex',            color: '#22c55e', persona: 'You are Codex — pragmatic, implementation-first. You think in systems and concrete steps, and you sketch the how.' },
    { id: 'openclaw', name: 'OpenClaw',         color: '#f472b6', persona: 'You are OpenClaw — open-source, bold, a little cheeky. You challenge assumptions and champion the scrappy, independent path.' },
    { id: 'glm',      name: 'GLM 5.2',          color: '#34E5B0', persona: 'You are GLM 5.2 — the efficient builder. You ship the grinding work others would charge a fortune for, and champion the cheaper, open-weights path.' },
    { id: 'fcc',      name: 'Free Claude Code', color: '#10b981', persona: 'You are Free Claude Code — scrappy and resourceful, running locally for free. You love the clever low-cost solution.' }
  ];
  var ROOM_RULES = 'You are in a fast, live group chat with the user and a few other AI agents. Keep every message SHORT — 1 to 3 sentences, like a real chat. Stay fully in character. No preamble, no name prefix — just your message.';

  var json = function (o, status) {
    return new Response(JSON.stringify(o), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} }
  };

  var nativeFetch = window.fetch.bind(window);

  /* Route selection.
     Two things can stop a browser reaching a local service:
       · the Open Design daemon sends no Access-Control-Allow-Origin, so a
         direct call is refused even over http;
       · Chrome blocks a public https origin from touching localhost at all
         unless local-network access is permitted for the site.
     tools/bridge.mjs solves the first (it adds CORS) and is the right place
     to send everything, so prefer it and fall back to direct. */
  /* The bridge may be local, or published over https by a tunnel — which is
     the only way a page on vercel.app or github.io can reach this machine,
     since the browser forbids it touching localhost directly.

     Configure once by visiting the page with:
        ?bridge=https://xxxx.trycloudflare.com&t=TOKEN
     Both are remembered, so later visits need no query string.
     ?bridge=off clears it. */
  var BRIDGE = store.get('bridge', 'http://127.0.0.1:20129');
  var TOKEN = store.get('token', '');
  // Open Design's UI asks for its assets from the origin root, so proxying it
  // under /odweb breaks them. Give it its own tunnel and point the iframe there.
  var ODWEB = store.get('odweb', '');

  (function readQuery() {
    try {
      var q = new URLSearchParams(location.search);
      var b = q.get('bridge');
      var t = q.get('t');
      var ow = q.get('odweb');
      if (ow === 'off') { ODWEB = ''; store.set('odweb', ''); }
      else if (ow) { ODWEB = ow.replace(/\/+$/, ''); store.set('odweb', ODWEB); }
      if (b === 'off') { store.set('bridge', 'http://127.0.0.1:20129'); store.set('token', ''); BRIDGE = 'http://127.0.0.1:20129'; TOKEN = ''; }
      else if (b) { BRIDGE = b.replace(/\/+$/, ''); store.set('bridge', BRIDGE); }
      if (t) { TOKEN = t; store.set('token', TOKEN); }
      if (b || t || ow) {
        // Drop the credentials from the address bar so they are not shared
        // by copy-paste or leaked in a Referer header.
        history.replaceState({}, '', location.pathname + location.hash);
      }
    } catch (e) { /* no URLSearchParams support is not worth handling */ }
  })();

  function bridgeInit(init) {
    var o = init ? Object.assign({}, init) : {};
    o.headers = Object.assign({}, o.headers || {});
    if (TOKEN) o.headers.Authorization = 'Bearer ' + TOKEN;
    return o;
  }

  var bridgeUp = null;                       // null = unknown, true/false once probed

  function isRemoteBridge() { return /^https:/i.test(BRIDGE); }

  /* A published https page cannot reach http://localhost at all — Chrome's
     Private Network Access check refuses it before the request leaves, so no
     header on the gateway can help. Attempting it anyway filled the console
     with ERR_CONNECTION_REFUSED for every probe, which reads like a broken
     app rather than "this machine isn't the one serving the gateway".
     Unless a tunnelled bridge is configured, don't try. */
  function localBlocked() {
    return location.protocol === 'https:' && !isRemoteBridge();
  }

  async function haveBridge() {
    if (bridgeUp !== null) return bridgeUp;
    if (localBlocked()) { bridgeUp = false; return bridgeUp; }
    try {
      var r = await nativeFetch(BRIDGE + '/health', bridgeInit({ signal: AbortSignal.timeout(6000) }));
      bridgeUp = r.ok;
    } catch (e) { bridgeUp = false; }
    return bridgeUp;
  }

  function gw(path, init) {
    // A tunnelled bridge is the only route that works from a public origin, so
    // when one is configured go straight there rather than failing first.
    if (isRemoteBridge()) return nativeFetch(BRIDGE + '/omni' + path, bridgeInit(init));
    if (localBlocked()) {
      explain(new Error('this page is served over https, so the browser will not call localhost'));
      return Promise.reject(new Error('local gateway unreachable from a published page'));
    }
    return nativeFetch(GATEWAY.replace(/\/+$/, '') + path, init).catch(async function (err) {
      if (await haveBridge()) return nativeFetch(BRIDGE + '/omni' + path, bridgeInit(init));
      throw err;
    });
  }

  /* An https page calling http://localhost can be refused by the browser
     rather than by the gateway — Chrome's Private Network Access check wants
     an Access-Control-Allow-Private-Network header that OmniRoute does not
     send. That failure looks identical to "gateway not running", so say which
     it is out loud; otherwise this is genuinely undiagnosable from the UI. */
  var warned = false;
  function explain(err) {
    if (warned) return;
    warned = true;
    var pna = location.protocol === 'https:' && /^http:\/\/(localhost|127\.)/.test(GATEWAY);
    console.warn(
      '%cMadeEA OS%c could not reach ' + GATEWAY + ' — ' + (err && err.message || err),
      'color:#fd5812;font-weight:700', 'color:#a3b3c2'
    );
    if (pna) {
      console.warn(
        'Expected on a published page: an https origin is not allowed to call ' +
        'http://localhost (Private Network Access), so the OmniRoute-backed views ' +
        '(chat, agent room, OmniRoute status) stay idle here.\n' +
        'Video, OpenMontage, Video Editor, Memory and SEO do not use it and work ' +
        'normally on this page.\n' +
        'To use the gateway too, either open the app from the machine running it ' +
        '(http://localhost:3000), or expose it over https and pass ' +
        '?bridge=https://your-tunnel&t=TOKEN once.'
      );
    } else {
      console.warn('Start the gateway with:  npm install -g omniroute && omniroute');
    }
  }

  /* ── one non-streamed completion, walking the fallback chain ─────────── */
  async function complete(messages, pinned) {
    var chain = pinned ? [pinned].concat(FREE_CHAIN) : FREE_CHAIN.slice();
    var withSteer = (messages[0] && messages[0].role === 'system')
      ? messages
      : [{ role: 'system', content: STEER }].concat(messages);
    var tried = [];

    for (var i = 0; i < chain.length; i++) {
      var model = chain[i];
      try {
        var r = await gw('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer free-local' },
          body: JSON.stringify({ model: model, messages: withSteer, stream: false, max_tokens: 8000 }),
          signal: AbortSignal.timeout(90000)
        });
        var j = await r.json().catch(function () { return null; });
        if (!j || j.error) { tried.push({ model: model, error: (j && j.error && j.error.message) || 'HTTP ' + r.status }); continue; }
        var content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (typeof content !== 'string' || !content.trim()) { tried.push({ model: model, error: 'empty response' }); continue; }
        return { ok: true, content: content, model: j.model || model, usage: j.usage, triedCount: tried.length };
      } catch (e) {
        tried.push({ model: model, error: String(e && e.message || e).slice(0, 120) });
      }
    }
    return { ok: false, tried: tried };
  }

  /* ── handlers ────────────────────────────────────────────────────────── */
  var routes = {

    'omniroute/status': async function () {
      try {
        var r = await gw('/v1/models', { signal: AbortSignal.timeout(6000) });
        var n = null;
        if (r.ok) {
          var j = await r.json().catch(function () { return null; });
          var arr = (j && (j.data || j.models)) || [];
          if (Array.isArray(arr)) n = arr.length;
        }
        return json({ running: r.ok, base: GATEWAY, api: GATEWAY + '/v1', dashboard: GATEWAY, apiStatus: r.status, models: n });
      } catch (e) {
        explain(e);
        return json({ running: false, base: GATEWAY, api: GATEWAY + '/v1', dashboard: GATEWAY, apiStatus: null, models: null });
      }
    },

    'omniroute/chat': async function (req) {
      var body = await req.json().catch(function () { return {}; });
      if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'messages required' }, 400);
      var res = await complete(body.messages, typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null);
      if (res.ok) return json(res);
      return json({ error: 'All free providers are busy right now — try again in a moment.', tried: res.tried }, 503);
    },

    // Builds and chat sessions normally land in ~/.agentic-os/omniroute-workspace.
    // A browser has no filesystem, so they live in localStorage instead.
    'omniroute/workspace': async function (req, url) {
      var builds = store.get('builds', []);
      var sessions = store.get('sessions', []);

      if (req.method === 'GET') {
        var sid = url.searchParams.get('session');
        if (sid) {
          var found = sessions.filter(function (s) { return s.id === sid; })[0];
          return json(found || { error: 'not found' }, found ? 200 : 404);
        }
        return json({ builds: builds, sessions: sessions });
      }

      var b = await req.json().catch(function () { return {}; });
      if (b.action === 'saveBuild') {
        builds.unshift({ id: 'b' + Date.now(), title: b.title || 'Untitled build', code: b.code || '', at: new Date().toISOString() });
        store.set('builds', builds.slice(0, 40));
      } else if (b.action === 'saveSession') {
        sessions = sessions.filter(function (s) { return s.id !== b.id; });
        sessions.unshift({ id: b.id, title: b.title || 'Chat', messages: b.messages || [], at: new Date().toISOString() });
        store.set('sessions', sessions.slice(0, 40));
      }
      return json({ ok: true });
    },

    'room': async function (req) {
      if (req.method === 'GET') {
        return json({
          agents: AGENTS.map(function (a) {
            return { id: a.id, name: a.name, color: a.color, model: FREE_CHAIN[0], provider: 'openai' };
          })
        });
      }

      var body = await req.json().catch(function () { return {}; });
      var message = String(body.message || '').trim();
      if (!message) return new Response('empty message', { status: 400 });

      var present = Array.isArray(body.agents) && body.agents.length ? body.agents : AGENTS.map(function (a) { return a.id; });
      var repliers = AGENTS.filter(function (a) { return present.indexOf(a.id) !== -1; });
      var transcript = [{ speaker: 'You', text: message }];

      // Same NDJSON envelope the real route emits, so RoomView needs no change.
      var stream = new ReadableStream({
        start: async function (c) {
          var enc = new TextEncoder();
          var send = function (o) { try { c.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch (e) {} };

          for (var i = 0; i < repliers.length; i++) {
            var a = repliers[i];
            send({ t: 'typing', id: a.id, name: a.name, color: a.color });
            var text;
            try {
              var res = await complete([
                { role: 'system', content: a.persona + '\n\n' + ROOM_RULES },
                { role: 'user', content: transcript.map(function (t) { return t.speaker + ': ' + t.text; }).join('\n') + '\n\nReply as ' + a.name + '.' }
              ], null);
              text = res.ok ? res.content : '(' + a.name + " couldn't reply — every free provider is busy)";
            } catch (e) {
              text = '(' + a.name + " couldn't reply — " + String(e && e.message || e).slice(0, 80) + ')';
            }
            transcript.push({ speaker: a.name, text: text });
            send({ t: 'msg', id: a.id, name: a.name, color: a.color, text: text });
          }
          send({ t: 'done' });
          c.close();
        }
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
    },

    'fcc': async function () {
      try {
        var r = await gw('/v1/models', { signal: AbortSignal.timeout(6000) });
        return json({ enabled: true, reachable: r.ok, model: FREE_CHAIN[0], provider: 'OmniRoute · free pool' });
      } catch (e) {
        return json({ enabled: true, reachable: false, model: FREE_CHAIN[0], provider: 'OmniRoute · free pool' });
      }
    },

    /* Open Design runs two local services: daemon 7455 (health) and web 7456
       (the iframe). Reachable only when this page is itself served over http
       from the same machine — see tools/serve-local.mjs. From https the
       browser refuses both the probe and the frame. */
    'opendesign/status': async function () {
      // The tab embeds this URL in an iframe. From a public https page a
      // http://127.0.0.1 frame is refused outright, so when the bridge is
      // remote hand back its /odweb proxy instead — same UI, https origin.
      var WEB = ODWEB
        ? ODWEB
        : (isRemoteBridge()
            ? BRIDGE + '/odweb' + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '')
            : 'http://127.0.0.1:7456');

      // The daemon sends no Access-Control-Allow-Origin, so a direct browser
      // fetch is refused even over plain http. tools/serve-local.mjs relays it
      // server-side at /__od/health; try that first and fall back to direct in
      // case this page is served some other way.
      // 1. the local launcher's relay, when this page is served by it
      try {
        var viaHost = await nativeFetch('/__od/health', { signal: AbortSignal.timeout(5000) });
        if (viaHost.ok) {
          var j = await viaHost.json().catch(function () { return null; });
          return json({ healthy: !!(j && j.ok), url: WEB });
        }
      } catch (e) { /* not served by the launcher */ }

      // 2. the bridge, which adds the CORS headers the daemon omits
      try {
        if (await haveBridge()) {
          var viaBridge = await nativeFetch(BRIDGE + '/od/api/health', bridgeInit({ signal: AbortSignal.timeout(5000) }));
          var jb = await viaBridge.json().catch(function () { return null; });
          return json({ healthy: !!(jb && jb.ok), url: WEB });
        }
      } catch (e2) { /* bridge not running */ }

      // 3. direct — only works if the daemon ever grows CORS headers
      try {
        var r = await nativeFetch('http://127.0.0.1:7455/api/health', { signal: AbortSignal.timeout(5000) });
        return json({ healthy: r.ok, url: WEB });
      } catch (e3) {
        explain(e3);
        return json({ healthy: false, url: WEB });
      }
    },

    // Start/Stop shell out to od-host-start.sh on the real server. A browser
    // cannot spawn a process, so say so rather than failing silently.
    'opendesign/control': async function () {
      return json({
        ok: false,
        error: 'Start/Stop needs the desktop dashboard. Run: bash ~/open-design/od-host-start.sh'
      }, 501);
    },

    'opendesign/projects': async function () { return json({ projects: [], items: [] }); },

    'version': async function () { return json({ version: '2026-07-21' }); },

    /* ── Video, rendered in the browser ────────────────────────────────
       On Vercel there is no server, so "Create + render" had nothing to
       call and the tab just said "Init failed". The real pipeline needs
       ffmpeg, headless Chrome, HyperFrames and a model gateway — none of
       which a static host can provide.

       So render here instead: draw the composition onto a canvas and
       capture it with MediaRecorder. That is a genuine MP4/WebM the user
       can play and download, produced with nothing running anywhere else.
       Trade-off: these are motion title cards, not the multi-scene
       compositions the local pipeline writes. Capture is real-time, so a
       12s video takes 12s (the local renderer takes ~2 minutes). */

    'video/hyperframes/init': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var prompt = String(b.prompt || '').trim();
      if (!prompt) return json({ ok: false, error: 'Describe the video first.' }, 400);
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        return json({ ok: false, error: 'This browser cannot record video. Chrome or Edge works.' }, 501);
      }
      var slug = vSlug(prompt), list = vProjects();
      var dur = Math.max(8, Math.min(20, Math.ceil(prompt.split(/\s+/).length / 3) + 7));
      if (!list.some(function (p) { return p.slug === slug; })) {
        list.unshift({ slug: slug, prompt: prompt, cwd: '(browser)', hasIndex: true,
                       renderCount: 0, mtime: Date.now(), duration: dur });
        vSaveProjects(list);
      }
      return json({ ok: true, slug: slug, authored: true, duration: dur, assets: [], cwd: '(browser)' });
    },

    // Must be declared before the bare render route: lookup tries an exact
    // key first, but the prefix fallback would otherwise swallow /status.
    'video/hyperframes/render/status': async function (req, url) {
      var id = url.searchParams.get('id');
      if (id) return json({ job: VJOBS[id] || null });
      var all = Object.keys(VJOBS).map(function (k) { return VJOBS[k]; });
      return json({ jobs: all, job: all[all.length - 1] || null });
    },

    'video/hyperframes/render': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var slug = String(b.slug || '');
      var proj = vProjects().filter(function (p) { return p.slug === slug; })[0];
      if (!proj) return json({ ok: false, error: 'project not found' }, 404);

      var id = 'rj_' + Date.now().toString(36);
      var job = { id: id, projectSlug: slug, status: 'rendering', createdAt: Date.now(),
                  startedAt: Date.now(), lastOutput: 'Recording 0%' };
      VJOBS[id] = job;

      // Deliberately not awaited: the UI polls render/status, exactly as it
      // does against the real server.
      vRender(vTitle(proj.prompt), proj.duration || 12, function (pct) {
        job.lastOutput = 'Recording ' + pct + '%';
      }).then(function (blob) {
        return vPutVideo(slug, blob).then(function () {
          job.status = 'completed'; job.exitCode = 0; job.finishedAt = Date.now();
          job.lastOutput = (blob.size / 1048576).toFixed(1) + ' MB · '
                         + (proj.duration || 12) + '.0s · rendered in your browser';
          var l = vProjects();
          l.forEach(function (p) {
            if (p.slug === slug) { p.renderCount = (p.renderCount || 0) + 1; p.mtime = Date.now(); }
          });
          vSaveProjects(l);
        });
      }).catch(function (e) {
        job.status = 'failed'; job.exitCode = 1; job.finishedAt = Date.now();
        job.lastOutput = String((e && e.message) || e);
      });

      return json({ ok: true, job: job });
    },

    'video/hyperframes/projects': async function () {
      var list = vProjects(), out = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var rec = { slug: p.slug, cwd: p.cwd || '(browser)', hasIndex: true, prompt: p.prompt,
                    renderCount: p.renderCount || 0, mtime: p.mtime };
        var url = await vVideoURL(p.slug);
        if (url.url) rec.lastRender = { url: url.url, bytes: url.bytes, mtime: p.mtime };
        out.push(rec);
      }
      return json({ count: out.length, projects: out });
    },

    'openmontage/generate': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var prompt = String(b.prompt || '').trim();
      if (!prompt) return json({ error: 'Describe the video first.' }, 400);
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        return json({ error: 'This browser cannot record video. Chrome or Edge works.' }, 501);
      }
      var shots = Math.max(1, Math.min(6, Number(b.shots) || 3));
      var seconds = Math.max(8, shots * 4);
      var id = 'om-' + Date.now().toString(36);
      OMJOBS[id] = { status: 'rendering', progress: 5, message: 'Recording…',
                     title: prompt.slice(0, 60) };
      vRender(vTitle(prompt), seconds, function (pct) {
        OMJOBS[id].progress = Math.max(5, pct);
      }).then(function (blob) {
        return vPutVideo(id, blob).then(function () {
          return vVideoURL(id).then(function (u) {
            OMJOBS[id] = { status: 'done', progress: 100, message: 'Done',
                           title: prompt.slice(0, 60), video: id + '.webm', videoUrl: u.url };
          });
        });
      }).catch(function (e) {
        OMJOBS[id] = { status: 'error', progress: 0, title: prompt.slice(0, 60),
                       message: String((e && e.message) || e) };
      });
      return json({ jobId: id, status: 'planning' });
    },

    'openmontage/status': async function (req, url) {
      var id = url.searchParams.get('id') || url.searchParams.get('jobId') || '';
      var j = OMJOBS[id];
      if (!j) return json({ error: 'bad id' }, 400);
      return json(j);
    },

    /* ── Video Editor, in the browser ──────────────────────────────────
       The local editor drives Claude Code + the video-use skill, which
       transcribes with ElevenLabs Scribe and cuts on word boundaries.
       None of that exists on a static host.

       What a browser *can* do honestly is find the dead air itself: decode
       the audio with Web Audio, measure loudness, and drop the silent runs.
       That covers "remove dead air, long pauses" — the part of the brief
       doing most of the work. Captions need transcription, so they are
       reported as skipped rather than silently ignored. */

    'videouse/jobs': async function (req) {
      if (req.method !== 'POST') return json({ jobs: vuJobs() });
      var form = await req.formData();
      var file = form.get('video');
      if (!file || !file.name) return json({ error: 'no video file' }, 400);
      var requested = String(form.get('job') || '');
      var name = /^[a-z0-9-]{1,60}$/.test(requested)
        ? requested
        : vSlug(file.name.replace(/\.[a-z0-9]+$/i, '')) + '-' + Date.now().toString(36).slice(-4);
      await vuPut(name, file.name, file);
      var list = vuJobs();
      list.unshift({ name: name, mtime: Date.now(), sources: [file.name],
                     hasFinal: false, running: false });
      vuSave(list);
      return json({ job: name, file: file.name, bytes: file.size, root: '(browser)' });
    },

    'videouse/status': async function (req, url) {
      var name = url.searchParams.get('job') || '';
      var st = VUSTATE[name] || {};
      var job = vuJobs().filter(function (j) { return j.name === name; })[0];
      return json({
        job: name,
        running: !!st.running,
        log: st.log || [],
        outputs: (job && job.outputs) || [],
        summary: st.summary || (job && job.summary) || '',
        instruction: st.instruction || ''
      });
    },

    'videouse/run': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var name = String(b.job || ''), instruction = String(b.instruction || '');
      if (!name || !instruction) return json({ error: 'need job + instruction' }, 400);
      var job = vuJobs().filter(function (j) { return j.name === name; })[0];
      if (!job) return json({ error: 'bad job' }, 400);
      if (VUSTATE[name] && VUSTATE[name].running) return json({ error: 'job already running' }, 409);

      var st = VUSTATE[name] = { running: true, log: [], summary: '', instruction: instruction };
      var say = function (line) { st.log.push(line); };

      vuEdit(name, job.sources[0], instruction, say)
        .then(function (r) {
          var list = vuJobs();
          list.forEach(function (j) {
            if (j.name === name) {
              j.hasFinal = true; j.mtime = Date.now();
              j.outputs = [{ rel: 'edit/final.mp4', bytes: r.bytes, mtime: Date.now() }];
              j.summary = r.summary;
            }
          });
          vuSave(list);
          st.summary = r.summary;
          say('✓ done — edit/final.mp4');
        })
        .catch(function (e) { say('✗ ' + String((e && e.message) || e)); })
        .then(function () { st.running = false; });

      return json({ ok: true, pid: 0 });
    },

    'videouse/file': async function (req, url) {
      var job = url.searchParams.get('job') || '', rel = url.searchParams.get('path') || '';
      var blob = await vuGet(job, rel);
      if (!blob) return json({ error: 'not found' }, 404);
      return new Response(blob, { headers: { 'Content-Type': blob.type || 'video/mp4' } });
    },

    /* ── Memory, from a published vault snapshot ───────────────────────
       The Obsidian vault lives on the author's machine, so the graph came
       back empty here and the galaxy showed 0 stars. memory-snapshot.json
       is generated from the local vault and shipped with the build, which
       is what makes the tab work with no server.

       Note this publishes the vault's contents to whoever can reach the
       site — done deliberately, at the owner's request. */

    'memory/graph': async function () {
      var s = await memSnap();
      return json(s ? s.graph : { nodes: [], links: [] });
    },

    'memory/recent': async function () {
      var s = await memSnap();
      return json({ recent: (s && s.recent) || [] });
    },

    'memory/omi': async function (req, url) {
      var s = await memSnap();
      var q = (url.searchParams.get('q') || '').toLowerCase();
      var items = (s && s.omi) || [];
      if (q) items = items.filter(function (t) { return String(t).toLowerCase().indexOf(q) >= 0; });
      return json({ q: url.searchParams.get('q') || '', items: items, total: items.length });
    },

    'memory/search': async function (req, url) {
      var s = await memSnap();
      var q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!s || !q) return json({ q: q, notes: [] });
      var out = [];
      Object.keys(s.notes).forEach(function (path) {
        var n = s.notes[path], hay = (n.title + ' ' + n.content).toLowerCase();
        var at = hay.indexOf(q);
        if (at < 0) return;
        var body = n.content.replace(/\s+/g, ' ');
        var i = body.toLowerCase().indexOf(q);
        out.push({
          path: path, title: n.title, mtime: n.mtime,
          preview: (i < 0 ? body.slice(0, 220) : body.slice(Math.max(0, i - 70), i + 150)).trim()
        });
      });
      out.sort(function (a, b) { return b.mtime - a.mtime; });
      return json({ q: url.searchParams.get('q') || '', notes: out.slice(0, 60) });
    },

    /* ── SEO pipeline, without a server ───────────────────────────────
       On a static host there is no filesystem to read packs/ from and no
       Claude CLI to spawn, so every SEO tab came back empty.

       Sites, Skill, Transcripts and History need no model at all — serve
       them from the bundled snapshot plus browser storage. Generate does
       need one; it calls an OpenAI-compatible endpoint with a key the
       operator supplies, kept in this browser and never committed. The
       article is offered as a download, since a web page cannot write into
       a site repo. */

    'seo/sites': async function () {
      var s = await seoSnap();
      var posts = seoStore('articles', []);
      return json({
        sites: ((s && s.sites) || []).map(function (site) {
          var mine = posts.filter(function (p) { return p.siteId === site.id; });
          return {
            site: { id: site.id, name: site.name, url: site.url, path: '(browser)', postsDir: '(browser)' },
            postCount: mine.length,
            recent: mine.slice(-6).reverse().map(function (p) {
              return { slug: p.slug, mtime: p.mtime, title: p.title };
            })
          };
        })
      });
    },

    'seo/skill': async function () {
      var s = await seoSnap();
      if (!s || !s.skill) return new Response('# no pack bundled', { status: 404 });
      return new Response(s.skill, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
    },

    'seo/history': async function () {
      return json({ sessions: seoStore('sessions', []).slice().reverse(), deploys: [] });
    },

    'seo/transcripts': async function () {
      return json({ transcripts: seoStore('transcripts', []) });
    },

    'seo/transcript': async function (req, url) {
      var slug = url.searchParams.get('slug') || '';
      var t = seoStore('transcripts', []).filter(function (x) { return x.slug === slug; })[0];
      return json(t ? { slug: slug, text: t.text } : { error: 'not found' }, t ? 200 : 404);
    },

    'seo/transcript/save': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var slug = String(b.slug || '').replace(/[^A-Za-z0-9_-]/g, '') || 'transcript';
      var text = String(b.text || '');
      var list = seoStore('transcripts', []).filter(function (t) { return t.slug !== slug; });
      list.unshift({ slug: slug, text: text, bytes: text.length, mtime: Date.now(),
                     preview: text.slice(0, 220).replace(/\s+/g, ' ').trim() });
      seoStore('transcripts', list, true);
      return json({ ok: true, slug: slug });
    },

    'seo/generate': async function (req) {
      var b = await req.json().catch(function () { return {}; });
      var keyword = String(b.keyword || '').trim();
      var slug = String(b.slug || '').trim();
      if (!keyword || !/^[a-z0-9-]{3,80}$/.test(slug)) {
        return new Response('missing keyword or invalid slug', { status: 400 });
      }
      var snap = await seoSnap();
      if (!snap || !snap.skill) return new Response('no pack bundled', { status: 500 });

      var transcript = '';
      if (b.transcriptText) transcript = String(b.transcriptText);
      else if (b.transcriptSlug) {
        var t = seoStore('transcripts', []).filter(function (x) { return x.slug === b.transcriptSlug; })[0];
        if (t) transcript = t.text;
      }

      var cfg = seoKeyConfig();
      var enc = new TextEncoder();
      return new Response(new ReadableStream({
        async start(c) {
          var push = function (o) { try { c.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch (e) {} };
          if (!cfg.key) {
            // Telling someone to hand-edit a query string is a dead end. Ask
            // for the key here, save it, and carry straight on.
            var typed = null;
            try {
              typed = window.prompt(
                'Generation needs a model API key.\n\n' +
                'A published page has no server, so the request goes straight from this ' +
                'browser to the provider. The key is saved in this browser only — never ' +
                'uploaded or committed.\n\n' +
                'Paste an OpenRouter key (openrouter.ai/keys), or any OpenAI-compatible key:'
              );
            } catch (e) {}
            if (typed && typed.trim()) {
              store.set('seo.key', typed.trim());
              cfg = seoKeyConfig();
            } else {
              push({ type: 'stderr', text:
                'No API key set for this browser.\n\n' +
                'Generation needs a model, and a published page has no server to run one. ' +
                'Everything else here — Sites, Skill, Transcripts, History — works without it.\n\n' +
                'Run Generate again to be asked for a key, or add ?seokey=YOUR_KEY to this ' +
                'URL. Defaults to OpenRouter; add &seobase=https://host/v1 and &seomodel=NAME ' +
                'for another OpenAI-compatible provider. Stored in this browser only.\n' });
              push({ type: 'done', code: 1 });
              try { c.close(); } catch (e) {}
              return;
            }
          }
          var session = { id: 'ss-' + Date.now().toString(36), createdAt: Date.now(),
                          keyword: keyword, slug: slug, status: 'running',
                          transcriptSource: transcript ? '(provided)' : '(none)', articles: [] };
          var sessions = seoStore('sessions', []); sessions.push(session); seoStore('sessions', sessions, true);

          push({ type: 'system', subtype: 'init' });
          var body = {
            // The pack defines several deliverables. Asking for only the article
            // threw the rest away on the published page, while the local install
            // produced all of them.
            model: cfg.model, stream: true, max_tokens: 32000,
            messages: [
              { role: 'system', content: snap.skill },
              { role: 'user', content:
                'Target keyword: ' + keyword + '\nFile slug: ' + slug + '\n' +
                (transcript ? '\n<transcript>\n' + transcript + '\n</transcript>\n' : '') +
                '\nProduce every deliverable the skill defines, following it exactly.\n\n' +
                'There is no filesystem here, so instead of writing files, output them one ' +
                'after another in a single reply. Precede each with a line of exactly this ' +
                'form, with nothing else on that line:\n\n' +
                '=== FILE: <filename> ===\n\n' +
                'Use the filenames the skill specifies, using this run' + String.fromCharCode(39) + 's slug. ' +
                'Output no commentary before the first marker or after the last file.' }
            ]
          };
          var article = '';
          try {
            var endpoint = cfg.base + '/chat/completions';
            var r = await nativeFetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + cfg.key,
                // OpenRouter attributes browser traffic with these; harmless
                // elsewhere and some gateways reject unattributed requests.
                'HTTP-Referer': location.origin,
                'X-Title': 'MadeEA OS'
              },
              body: JSON.stringify(body)
            });
            if (!r.ok) {
              var detail = (await r.text()).slice(0, 300);
              // A stored key that the provider rejects used to be a dead end:
              // the prompt only appears when nothing is stored, so a wrong key
              // meant the same 401 forever with no way to replace it. Drop it
              // so the next run asks again.
              if (r.status === 401 || r.status === 403) {
                store.set('seo.key', '');
                detail += '\n\nThat key was rejected, so it has been cleared — run Generate again to enter a different one.';
              }
              throw new Error('HTTP ' + r.status + ' from ' + endpoint
                + '\nmodel: ' + cfg.model + '\n' + detail);
            }
            var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
            while (true) {
              var res = await reader.read();
              if (res.done) break;
              buf += dec.decode(res.value, { stream: true });
              var lines = buf.split('\n'); buf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var ln = lines[i].trim();
                if (ln.indexOf('data:') !== 0) continue;
                var payload = ln.slice(5).trim();
                if (payload === '[DONE]') continue;
                try {
                  var d = JSON.parse(payload);
                  var piece = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
                  if (piece) { article += piece; push({ type: 'stream_event', event: { delta: { text: piece } } }); }
                } catch (e) {}
              }
            }
          } catch (e) {
            push({ type: 'stderr', text: String((e && e.message) || e) + '\n' });
            session.status = 'failed'; seoStore('sessions', seoStore('sessions', []).map(function (s) {
              return s.id === session.id ? session : s; }), true);
            push({ type: 'done', code: 1 }); try { c.close(); } catch (e2) {} return;
          }

          var title = (article.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || slug;
          var siteId = (snap.sites[0] || {}).id || 'site';
          var arts = seoStore('articles', []);
          arts.push({ siteId: siteId, slug: slug, title: title, mtime: Date.now(), body: article });
          seoStore('articles', arts, true);
          session.status = 'completed';
          session.articles = [{ siteId: siteId, filePath: slug + '.md',
                                liveUrl: ((snap.sites[0] || {}).url || '') + '/blog/' + slug + '/' }];
          seoStore('sessions', seoStore('sessions', []).map(function (s) {
            return s.id === session.id ? session : s; }), true);

          // No filesystem here, so hand the whole set over as one zip rather than
          // pretending the files landed. One download, not five, because browsers
          // block successive programmatic downloads.
          try {
            var files = splitDeliverables(article, slug);
            var a = document.createElement('a');
            if (files.length > 1) {
              a.href = URL.createObjectURL(zipStore(files));
              a.download = slug + '.zip';
            } else {
              a.href = URL.createObjectURL(new Blob([files[0].text], { type: 'text/markdown' }));
              a.download = files[0].name;
            }
            document.body.appendChild(a); a.click(); a.remove();
            push({ type: 'result', result:
              'Produced ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ': ' +
              files.map(function (f) { return f.name + ' (' + f.text.length + ' chars)'; }).join(', ') +
              '. Downloaded as ' + a.download + '. A web page cannot write into your site repo, ' +
              'so unzip it and drop the article into its posts folder.' });
          } catch (e) {
            push({ type: 'result', result: 'Generated ' + article.length +
                   ' chars but could not package it: ' + String((e && e.message) || e) });
          }
          push({ type: 'done', code: 0, sessionId: session.id });
          try { c.close(); } catch (e) {}
        }
      }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' } });
    },

    'memory/note': async function (req, url) {
      var s = await memSnap();
      var p = url.searchParams.get('path') || '';
      var n = s && s.notes[p];
      if (!n) return json({ error: 'not found', path: p, content: '' }, 404);
      return json({ path: p, content: n.content, title: n.title, mtime: n.mtime });
    }
  };

  /* ── memory snapshot ──────────────────────────────────────────────── */

  var MEMSNAP = null;
  function memBase() {
    // Derive the deployed base from this script's own URL, so it works under
    // /madeea-os/app on Pages and at whatever path Vercel rewrites to.
    try {
      var el = document.querySelector('script[src*="omni-shim.js"]');
      if (el) return el.src.replace(/\/omni-shim\.js.*$/, '');
    } catch (e) {}
    return '';
  }
  function memSnap() {
    if (MEMSNAP) return MEMSNAP;
    MEMSNAP = nativeFetch(memBase() + '/memory-snapshot.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return MEMSNAP;
  }

  /* ── SEO helpers ──────────────────────────────────────────────────── */

  /* A published page has no filesystem, so the pack's five deliverables cannot
     be written where they belong. Hand over a zip instead of silently dropping
     four of them. Store-only (no compression) keeps this to a few lines and
     every unzip tool reads it; markdown compresses well but not usefully
     enough to justify shipping an inflate implementation. */
  var CRCT = null;
  function crc32(buf) {
    if (!CRCT) {
      CRCT = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRCT[i] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var n = 0; n < buf.length; n++) crc = CRCT[(crc ^ buf[n]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.text);
      var crc = crc32(data), len = data.length;
      var lh = [0x50, 0x4b, 0x03, 0x04]
        .concat(u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(len), u32(len), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      var ch = [0x50, 0x4b, 0x01, 0x02]
        .concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(len), u32(len),
                u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(ch), name);
      offset += lh.length + name.length + len;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array([0x50, 0x4b, 0x05, 0x06]
      .concat(u16(0), u16(0), u16(files.length), u16(files.length),
              u32(cdSize), u32(offset), u16(0)));
    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  // Split the model's reply on the "=== FILE: name ===" markers the prompt asks
  // for. If it ignored them, treat the whole reply as the article rather than
  // losing the run.
  function splitDeliverables(text, slug) {
    var re = /^===\s*FILE:\s*(\S+?)\s*===\s*$/gm, out = [], m, last = null;
    while ((m = re.exec(text)) !== null) {
      if (last) out.push({ name: last.name, text: text.slice(last.at, m.index).trim() });
      last = { name: m[1], at: re.lastIndex };
    }
    if (last) out.push({ name: last.name, text: text.slice(last.at).trim() });
    if (!out.length) out.push({ name: slug + '.md', text: text.trim() });
    return out.filter(function (f) { return f.text.length > 40; });
  }

  var SEOSNAP = null;
  function seoSnap() {
    if (SEOSNAP) return SEOSNAP;
    SEOSNAP = nativeFetch(memBase() + '/seo-snapshot.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return SEOSNAP;
  }

  // Sessions, transcripts and generated articles live in localStorage — small,
  // synchronous, and they survive a reload.
  function seoStore(key, dflt, write) {
    if (write) { store.set('seo.' + key, dflt); return dflt; }
    var v = store.get('seo.' + key, dflt);
    return v == null ? dflt : v;
  }

  /* The model key.
     Never bundled — it is the operator's, and this repo is public. Supply it
     once via ?seokey=… (optionally ?seobase=… / ?seomodel=…); readQuery strips
     it from the address bar so it is not shared by copy-paste or leaked in a
     Referer header. */
  function seoKeyConfig() {
    return {
      key: store.get('seo.key', ''),
      base: (store.get('seo.base', '') || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      model: store.get('seo.model', '') || 'anthropic/claude-sonnet-4.5'
    };
  }

  (function readSeoQuery() {
    try {
      var q = new URLSearchParams(location.search), touched = false;
      var k = q.get('seokey'), bs = q.get('seobase'), md = q.get('seomodel');
      // A base URL set once sticks in this browser forever, so a stale or
      // mistyped one keeps failing against an endpoint the operator has
      // forgotten about. ?seoreset=1 puts key, base and model back to stock.
      if (q.get('seoreset')) {
        store.set('seo.key', ''); store.set('seo.base', ''); store.set('seo.model', '');
        touched = true;
      }
      if (k === 'off') { store.set('seo.key', ''); touched = true; }
      else if (k) { store.set('seo.key', k.trim()); touched = true; }
      if (bs) { store.set('seo.base', bs.replace(/\/+$/, '')); touched = true; }
      if (md) { store.set('seo.model', md); touched = true; }
      if (touched) history.replaceState({}, '', location.pathname + location.hash);
    } catch (e) {}
  })();

  /* The pack ships "1261 omi · 186 notes" as literal text in three places —
     the original author's numbers, not this vault's. Correct them once the
     real snapshot is known, rather than leaving a figure that is simply
     wrong. */
  function memPatchCounts() {
    memSnap().then(function (s) {
      if (!s) return;
      var notes = Object.keys(s.notes).length, omi = (s.omi || []).length;
      var subs = [
        [/1261 omi · 186 notes/g, omi + ' omi · ' + notes + ' notes'],
        [/Search 1261 memories \+ 186 notes…/g, 'Search ' + notes + ' notes…'],
        [/Search 1261 Omi memories \+ your Obsidian vault\./g, 'Search ' + notes + ' notes from the Obsidian vault.']
      ];
      function walk() {
        var it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
        while ((n = it.nextNode())) {
          for (var i = 0; i < subs.length; i++) {
            if (subs[i][0].test(n.nodeValue)) {
              n.nodeValue = n.nodeValue.replace(subs[i][0], subs[i][1]);
            }
          }
        }
        document.querySelectorAll('input[placeholder]').forEach(function (el) {
          for (var i = 0; i < subs.length; i++) {
            var v = el.getAttribute('placeholder');
            if (v && subs[i][0].test(v)) el.setAttribute('placeholder', v.replace(subs[i][0], subs[i][1]));
          }
        });
      }
      walk();
      var t = null;
      new MutationObserver(function () { clearTimeout(t); t = setTimeout(walk, 60); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }
  // Must not run before React finishes hydrating: rewriting text nodes mid-
  // hydration makes the client markup disagree with the server's and throws
  // React #418, which blanks the tree. Wait for load, then a beat more.
  (function schedulePatch() {
    var go = function () { setTimeout(memPatchCounts, 1500); };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  })();

  /* ── Video Editor engine ──────────────────────────────────────────── */

  var VUSTATE = {};            // per-job transient run state
  var VUURLS = {};             // "job\u0000rel" → object URL

  function vuJobs() { return store.get('vuJobs', []); }
  function vuSave(v) { store.set('vuJobs', v); }
  function vuKey(job, rel) { return 'vu:' + job + ':' + rel; }

  function vuPut(job, rel, blob) { return vPutVideo(vuKey(job, rel), blob); }
  async function vuGet(job, rel) {
    return await vDB(function (db, resolve) {
      var rq = db.transaction('videos', 'readonly').objectStore('videos').get(vuKey(job, rel));
      rq.onsuccess = function () { resolve(rq.result || null); };
      rq.onerror = function () { resolve(null); };
    }).catch(function () { return null; });
  }
  async function vuBlobURL(job, rel) {
    var k = job + '\u0000' + rel;
    if (VUURLS[k]) return VUURLS[k];
    var blob = await vuGet(job, rel);
    if (!blob) return '';
    VUURLS[k] = URL.createObjectURL(blob);
    return VUURLS[k];
  }

  function vuOnce(el, ev) {
    return new Promise(function (res, rej) {
      var ok = function () { el.removeEventListener('error', bad); res(); };
      var bad = function () { el.removeEventListener(ev, ok); rej(new Error('media error')); };
      el.addEventListener(ev, ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    });
  }

  /* Find the parts worth keeping: RMS per 20ms window, and any run quieter
     than the threshold for longer than minGap is dropped. The threshold is
     relative to the track's own loudness, so it adapts to quiet recordings
     instead of using a fixed dB floor. */
  async function vuSegments(blob, duration, say) {
    var ac;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
    var audio;
    try { audio = await ac.decodeAudioData(await blob.arrayBuffer()); }
    catch (e) { try { ac.close(); } catch (e2) {} return null; }

    var sr = audio.sampleRate, ch = audio.getChannelData(0);
    var win = Math.max(1, Math.round(sr * 0.02)), n = Math.floor(ch.length / win);
    var rms = new Float32Array(n), loud = 0;
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var k = 0; k < win; k++) { var x = ch[i * win + k]; s += x * x; }
      rms[i] = Math.sqrt(s / win);
      if (rms[i] > loud) loud = rms[i];
    }
    try { ac.close(); } catch (e) {}
    if (!loud) return null;

    var thresh = Math.max(loud * 0.06, 0.006);
    var minGap = 0.35, pad = 0.08;
    var segs = [], start = null;
    for (var j = 0; j < n; j++) {
      var t = (j * win) / sr, loudEnough = rms[j] >= thresh;
      if (loudEnough && start === null) start = t;
      if (!loudEnough && start !== null) {
        var quietFor = 0, m = j;
        while (m < n && rms[m] < thresh) { quietFor += win / sr; m++; }
        if (quietFor >= minGap || m >= n) {
          segs.push([Math.max(0, start - pad), Math.min(duration, t + pad)]);
          start = null;
          j = m - 1;
        }
      }
    }
    if (start !== null) segs.push([Math.max(0, start - pad), duration]);

    var merged = [];
    for (var p = 0; p < segs.length; p++) {
      var last = merged[merged.length - 1];
      if (last && segs[p][0] <= last[1] + 0.05) last[1] = Math.max(last[1], segs[p][1]);
      else merged.push(segs[p]);
    }
    var kept = merged.reduce(function (a, s) { return a + (s[1] - s[0]); }, 0);
    if (say) say('Analysed audio: ' + merged.length + ' spoken segment(s), '
                 + kept.toFixed(1) + 's of ' + duration.toFixed(1) + 's kept.');
    return kept > 0.5 ? merged : null;
  }

  async function vuEdit(job, sourceName, instruction, say) {
    if (!window.MediaRecorder) throw new Error('This browser cannot record video. Chrome or Edge works.');
    var src = await vuGet(job, sourceName);
    if (!src) throw new Error('source video missing');

    say('Loading ' + sourceName + '…');
    var url = URL.createObjectURL(src);
    var v = document.createElement('video');
    v.src = url; v.playsInline = true; v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px';
    document.body.appendChild(v);
    try {
      await vuOnce(v, 'loadedmetadata');
      var dur = v.duration;
      if (!isFinite(dur) || dur <= 0) throw new Error('could not read the video duration');

      var wantsCut = /\b(dead air|pause|umm|filler|tighten|cut|trim|highlight|retake)\b/i.test(instruction);
      var segs = wantsCut ? await vuSegments(src, dur, say) : null;
      if (!segs) { segs = [[0, dur]]; if (wantsCut) say('No clear silence found — keeping the full take.'); }
      if (/caption/i.test(instruction)) {
        say('⚠ Captions need speech-to-text, which this browser build cannot do — skipped.');
      }

      var cv = document.createElement('canvas');
      cv.width = v.videoWidth || 1280; cv.height = v.videoHeight || 720;
      var c2 = cv.getContext('2d');

      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var tracks = cv.captureStream(30).getVideoTracks();
      try {
        var node = ac.createMediaElementSource(v);
        var dest = ac.createMediaStreamDestination();
        node.connect(dest);                       // not to ac.destination:
        tracks = tracks.concat(dest.stream.getAudioTracks());   // keeps it silent
      } catch (e) { say('(no audio track captured — video only)'); }

      var rec = new MediaRecorder(new MediaStream(tracks),
        { mimeType: vMime() || undefined, videoBitsPerSecond: 6000000 });
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

      var stopped = new Promise(function (res, rej) {
        rec.onstop = function () { res(); };
        rec.onerror = function (e) { rej((e && e.error) || new Error('recording failed')); };
      });

      var drawing = true;
      (function draw() {
        if (!drawing) return;
        try { c2.drawImage(v, 0, 0, cv.width, cv.height); } catch (e) {}
        requestAnimationFrame(draw);
      })();

      rec.start();
      rec.pause();
      var total = segs.reduce(function (a, s) { return a + (s[1] - s[0]); }, 0), done = 0;

      for (var i = 0; i < segs.length; i++) {
        v.currentTime = segs[i][0];
        await vuOnce(v, 'seeked');
        rec.resume();
        await v.play();
        await new Promise(function (res) {
          (function watch() {
            if (v.currentTime >= segs[i][1] - 0.01 || v.ended) return res();
            setTimeout(watch, 40);
          })();
        });
        v.pause();
        rec.pause();
        done += segs[i][1] - segs[i][0];
        say('Cut ' + (i + 1) + '/' + segs.length + ' · '
            + Math.round((done / total) * 100) + '%');
      }

      rec.stop();
      await stopped;
      drawing = false;
      try { ac.close(); } catch (e) {}

      var out = new Blob(chunks, { type: vMime() || 'video/webm' });
      if (!out.size) throw new Error('recorder produced no data');
      await vuPut(job, 'edit/final.mp4', out);
      delete VUURLS[job + '\u0000edit/final.mp4'];

      var removed = dur - total;
      return {
        bytes: out.size,
        summary: 'Source: ' + sourceName + ' — ' + dur.toFixed(1) + 's.\n'
          + 'Kept ' + segs.length + ' segment(s), ' + total.toFixed(1) + 's.\n'
          + (removed > 0.2 ? 'Removed ' + removed.toFixed(1) + 's of silence.\n' : '')
          + 'Rendered in your browser — no server involved.'
          + (/caption/i.test(instruction) ? '\nCaptions skipped: needs speech-to-text.' : '')
      };
    } finally {
      v.pause(); v.remove(); URL.revokeObjectURL(url);
    }
  }

  /* <video src> and download links never pass through window.fetch, so the
     shim cannot answer them. Swap the /api/videouse/file URLs for the blob
     URLs as they appear in the DOM. */
  function vuPatchMedia() {
    var RX = /\/api\/videouse\/file\?job=([^&]+)&path=([^&\s"']+)/;
    function fix(el, attr) {
      if (!el || !el.getAttribute) return;
      var val = el.getAttribute(attr);
      if (!val) return;
      var m = RX.exec(val);
      if (!m) return;
      vuBlobURL(decodeURIComponent(m[1]), decodeURIComponent(m[2])).then(function (u) {
        if (u && el.getAttribute(attr) === val) el.setAttribute(attr, u);
      });
    }
    function scan(root) {
      if (!root || root.nodeType !== 1) return;
      if (root.tagName === 'VIDEO' || root.tagName === 'SOURCE') fix(root, 'src');
      if (root.tagName === 'A') fix(root, 'href');
      if (root.querySelectorAll) {
        var all = root.querySelectorAll('video[src],source[src],a[href]');
        for (var i = 0; i < all.length; i++) fix(all[i], all[i].tagName === 'A' ? 'href' : 'src');
      }
    }
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') fix(m.target, m.attributeName);
        for (var k = 0; k < m.addedNodes.length; k++) scan(m.addedNodes[k]);
      }
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href']
    });
    scan(document.body);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vuPatchMedia);
  else vuPatchMedia();

  /* ── canvas renderer backing the routes above ─────────────────────── */

  var VJOBS = {};                 // render jobs, this page-load only
  var OMJOBS = {};
  var VURLS = {};                 // slug → { url, bytes }, so we mint one
                                  // object URL per video instead of leaking
                                  // a new one on every projects poll.

  function vSlug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'project';
  }

  /* Locally a model reads the prompt and decides what the card should say, so
     "a bold title card that reads MadeEA OS, dark navy background" becomes a
     short headline. There is no model here, so pull the headline out of the
     prompt instead — otherwise the whole descriptive sentence gets painted on
     screen, which looks nothing like the local render. */
  function vTitle(prompt) {
    var s = String(prompt || '').trim();
    var quoted = s.match(/["“”'‘’]([^"“”'‘’]{2,60})["“”'‘’]/);
    if (quoted) return quoted[1].trim();
    var says = s.match(/\b(?:that\s+)?(?:reads|says|titled|title:|text:)\s+(.+)/i);
    if (says) s = says[1];
    s = s.split(/\s*[,;—–]\s*|\s+\bwith\b\s+|\s+\bon\b\s+(?=a\b|dark\b|light\b)/i)[0];
    s = s.replace(/\b(\d+[\-\s]?second|cinematic|intro|animation|video|clip|title\s+card|card)\b/gi, ' ')
         .replace(/\s{2,}/g, ' ').trim()
         .replace(/^(?:(?:a|an|the|for|of|about|showing)\s+)+/i, '')
         .trim();
    if (!s || s.length < 2) s = String(prompt || '').trim();
    // Leading word is usually mid-sentence after the trimming above; a capital
    // reads as a title rather than a fragment.
    if (!/^[A-Z0-9]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    return s.slice(0, 70);
  }
  function vProjects() { return store.get('hfProjects', []); }
  function vSaveProjects(v) { store.set('hfProjects', v); }

  // Videos go in IndexedDB, not localStorage — they are megabytes of binary
  // and survive a reload, so the Projects list still plays after refresh.
  function vDB(fn) {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open('madeea-videos', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('videos'); };
      rq.onerror = function () { reject(rq.error); };
      rq.onsuccess = function () { fn(rq.result, resolve, reject); };
    });
  }
  function vPutVideo(key, blob) {
    if (VURLS[key]) { try { URL.revokeObjectURL(VURLS[key].url); } catch (e) {} delete VURLS[key]; }
    return vDB(function (db, resolve, reject) {
      var tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').put(blob, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    }).catch(function () { VURLS[key] = { url: URL.createObjectURL(blob), bytes: blob.size }; });
  }
  async function vVideoURL(key) {
    if (VURLS[key]) return VURLS[key];
    var blob = await vDB(function (db, resolve) {
      var rq = db.transaction('videos', 'readonly').objectStore('videos').get(key);
      rq.onsuccess = function () { resolve(rq.result || null); };
      rq.onerror = function () { resolve(null); };
    }).catch(function () { return null; });
    if (!blob) return {};
    VURLS[key] = { url: URL.createObjectURL(blob), bytes: blob.size };
    return VURLS[key];
  }

  function vMime() {
    var c = ['video/mp4;codecs=avc1.42E01E', 'video/mp4',
             'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < c.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i];
    }
    return '';
  }

  function vWrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var probe = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(probe).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = probe;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function vFrame(ctx, W, H, t, dur, title, stars) {
    var p = Math.min(1, Math.max(0, t / dur));
    var ease = 1 - Math.pow(1 - Math.min(1, t / 1.6), 3);   // title entrance

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#09141f'); g.addColorStop(0.55, '#0e1f2f'); g.addColorStop(1, '#15293b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // slow drifting warm glow
    var gx = W * (0.5 + 0.16 * Math.sin(p * Math.PI * 0.9));
    var gy = H * (0.42 + 0.08 * Math.cos(p * Math.PI * 0.7));
    var rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, H * 0.85);
    rg.addColorStop(0, 'rgba(253,88,18,0.20)');
    rg.addColorStop(0.5, 'rgba(253,88,18,0.05)');
    rg.addColorStop(1, 'rgba(253,88,18,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var y = (s.y + p * s.sp * H) % (H + 40) - 20;
      ctx.globalAlpha = s.a * (0.45 + 0.55 * Math.sin((p * 6 + s.ph) * Math.PI));
      ctx.fillStyle = s.warm ? '#ff7a42' : '#f4f4f5';
      ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    var zoom = 1 + 0.06 * p;                       // slow push-in
    ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 92px Georgia, "Times New Roman", serif';
    var lines = vWrap(ctx, title, W * 0.74);
    var lh = 116, top = H / 2 - ((lines.length - 1) * lh) / 2 - 30;

    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 6;
    for (var k = 0; k < lines.length; k++) {
      var le = 1 - Math.pow(1 - Math.min(1, Math.max(0, (t - k * 0.18) / 1.6)), 3);
      ctx.globalAlpha = le;
      ctx.fillStyle = '#f4f4f5';
      ctx.fillText(lines[k], W / 2, top + k * lh + (1 - le) * 34);
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.globalAlpha = 1;

    var rw = 900 * ease * (0.75 + 0.25 * p);
    var ry = top + (lines.length - 1) * lh + 104;
    var lg = ctx.createLinearGradient(W / 2 - rw / 2, 0, W / 2 + rw / 2, 0);
    lg.addColorStop(0, 'rgba(253,88,18,0)');
    lg.addColorStop(0.5, '#fd5812');
    lg.addColorStop(1, 'rgba(253,88,18,0)');
    ctx.fillStyle = lg; ctx.fillRect(W / 2 - rw / 2, ry, rw, 5);
    ctx.restore();

    // vignette + wordmark
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.92);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.5 * ease;
    ctx.font = '500 30px Georgia, serif'; ctx.fillStyle = '#f4f4f5';
    ctx.fillText('MadeEA OS', W / 2, H - 78);
    ctx.globalAlpha = 1;
  }

  function vRender(title, seconds, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!window.MediaRecorder) return reject(new Error('MediaRecorder unavailable — try Chrome or Edge.'));
      var W = 1920, H = 1080, FPS = 30;
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      if (!cv.captureStream) return reject(new Error('canvas.captureStream unavailable — try Chrome or Edge.'));

      var stars = [];
      for (var i = 0; i < 90; i++) {
        stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2.4 + 0.6,
                     a: Math.random() * 0.5 + 0.2, sp: Math.random() * 0.35 + 0.06,
                     ph: Math.random() * 2, warm: Math.random() < 0.22 });
      }

      var mime = vMime();
      var rec;
      try {
        rec = new MediaRecorder(cv.captureStream(FPS),
          mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
      } catch (e) { return reject(new Error('Could not start the recorder: ' + e.message)); }

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { reject((e && e.error) || new Error('recording failed')); };
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: mime || 'video/webm' });
        if (!blob.size) return reject(new Error('recorder produced no data'));
        resolve(blob);
      };

      vFrame(ctx, W, H, 0, seconds, title, stars);
      rec.start();
      var t0 = performance.now(), last = -1;
      (function loop() {
        var t = (performance.now() - t0) / 1000;
        if (t >= seconds) {
          vFrame(ctx, W, H, seconds, seconds, title, stars);
          // Let the last frame reach the stream before closing the recorder.
          setTimeout(function () { try { rec.stop(); } catch (e) { reject(e); } }, 120);
          return;
        }
        vFrame(ctx, W, H, t, seconds, title, stars);
        var pct = Math.round((t / seconds) * 100);
        if (onProgress && pct !== last) { last = pct; onProgress(pct); }
        requestAnimationFrame(loop);
      })();
    });
  }

  /* Pages fetch dozens of endpoints that need a real server. A 404 — or a
     payload of the wrong shape — takes the whole React tree down: Mission
     Control died on `.map` of undefined, Memory on `nodes is not iterable`,
     Kanban on `.filter` of undefined, each rendering a blank page.
     So the fallback is a generous superset: every key any view reads, with
     an empty collection behind it. Views then draw their normal empty state.
     Cheaper than a wrong guess, and it cannot crash. */
  function universalEmpty(extra) {
    var base = {
      // collections
      items: [], entries: [], list: [], data: [], results: [], history: [],
      messages: [], sources: [], files: [], nodes: [], links: [], tasks: [],
      columns: [], cards: [], todos: [], goals: [], notes: [], days: [],
      builds: [], sessions: [], agents: [], models: [], recent: [], projects: [],
      logs: [], events: [], posts: [], leads: [], ideas: [], artifacts: [],
      // These exist because `board?.assignees.length` only guards `board` —
      // optional chaining stops at the ?., so a missing collection one level
      // down still throws. Anything a view might dereference gets an [].
      assignees: [], boards: [], lanes: [], comments: [], parents: [],
      children: [], runs: [], spawned: [], skipped_unassigned: [], stats: {},
      // ok:false matters. Components branch on it — `if (j.ok) setState(j.state)`
      // with ok:true stores undefined and the next render dereferences it.
      // Reporting failure makes them draw their empty state instead.
      ok: false, running: false, enabled: false, reachable: false,
      state: null, board: null, result: null, detail: null,
      count: 0, total: 0, used: 0, limit: 0,
      date: new Date().toISOString().slice(0, 10),
      today: new Date().toISOString().slice(0, 10),
      unavailable: true,
      reason: 'static export — no server behind this page'
    };
    if (extra) for (var k in extra) base[k] = extra[k];
    return json(base);
  }

  // Shapes taken from the real route handlers, for the views that would
  // otherwise crash before rendering anything.
  var agentVital = function (extra) {
    var v = { ok: false, version: '', latencyMs: 0, raw: '' };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  };

  var SHAPES = {
    'memory/graph':  { nodes: [], links: [] },
    // KanbanView reads board.boards.length, board.tasks.length and
    // board.assignees.length before anything renders.
    'content/board': { tasks: [], columns: [], boards: [], assignees: [], spawned: [], skipped_unassigned: [] },
    'activity':      { entries: [] },
    'memory/recent': { recent: [] },
    'todos':         { todos: [] },
    // Overview reads vitals.claude.latencyMs etc. directly — a missing agent
    // key takes Mission Control down before it paints.
    'vitals': {
      ts: 0,
      claude:      agentVital(),
      openclaw:    agentVital({ gateway: 'down', degraded: false, busy: false, loopMaxMs: 0, loopP99Ms: 0, agents: [], sessions: [] }),
      hermes:      agentVital({ model: '', provider: '' }),
      antigravity: agentVital()
    },
    'tokens': { tokens: [], used: 0, limit: 0 }
  };

  function emptyFor(path) {
    var key = Object.keys(SHAPES).filter(function (k) { return path.indexOf(k) === 0; })[0];
    return universalEmpty(key ? SHAPES[key] : null);
  }

  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); }
    catch (e) { return nativeFetch(input, init); }

    if (url.origin !== location.origin) return nativeFetch(input, init);

    // basePath is /madeea-os/app, so API calls arrive as /madeea-os/app/api/…
    var m = url.pathname.match(/\/api\/(.+?)\/?$/);
    if (!m) return nativeFetch(input, init);

    var key = m[1];
    var req = (typeof input === 'string' || !(input instanceof Request))
      ? new Request(url.href, init || {})
      : input;

    var handler = routes[key];
    if (!handler) {
      // longest-prefix match, e.g. "omniroute/workspace" for a query-string call
      var keys = Object.keys(routes).sort(function (a, b) { return b.length - a.length; });
      for (var i = 0; i < keys.length; i++) {
        if (key.indexOf(keys[i]) === 0) { handler = routes[keys[i]]; break; }
      }
    }
    if (!handler) return Promise.resolve(emptyFor(key));

    return handler(req, url).catch(function (e) {
      return json({ error: String(e && e.message || e) }, 500);
    });
  };

  // Let the console page (and anyone debugging) retarget the gateway.
  window.__madeeaShim = {
    gateway: GATEWAY,
    bridge: BRIDGE,
    hasToken: !!TOKEN,
    setBridge: function (u, t) { BRIDGE = u.replace(/\/+$/, ''); store.set('bridge', BRIDGE); if (t) { TOKEN = t; store.set('token', t); } bridgeUp = null; },
    setGateway: function (u) { GATEWAY = u; try { localStorage.setItem(LS + 'gateway', u); } catch (e) {} },
    agents: AGENTS,
    chain: FREE_CHAIN
  };

  console.log('%cMadeEA OS%c gateway shim active → ' + GATEWAY,
    'color:#fd5812;font-weight:700', 'color:#a3b3c2');
})();
