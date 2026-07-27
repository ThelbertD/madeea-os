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
  var BRIDGE = 'http://127.0.0.1:20129';
  var bridgeUp = null;                       // null = unknown, true/false once probed

  async function haveBridge() {
    if (bridgeUp !== null) return bridgeUp;
    try {
      var r = await nativeFetch(BRIDGE + '/health', { signal: AbortSignal.timeout(2500) });
      bridgeUp = r.ok;
    } catch (e) { bridgeUp = false; }
    return bridgeUp;
  }

  function gw(path, init) {
    // OmniRoute reflects the origin, so a direct call works wherever the page
    // itself is allowed to reach localhost. Try it, then the bridge.
    return nativeFetch(GATEWAY.replace(/\/+$/, '') + path, init).catch(async function (err) {
      if (await haveBridge()) return nativeFetch(BRIDGE + '/omni' + path, init);
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
        'This page is https and the gateway is http://localhost. If OmniRoute IS running, ' +
        'your browser is blocking the call (Private Network Access). Two ways round it:\n' +
        '  1. Open this app from your own machine instead of GitHub Pages.\n' +
        '  2. Chrome → chrome://flags → "Block insecure private network requests" → Disabled.'
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
      var WEB = 'http://127.0.0.1:7456';

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
          var viaBridge = await nativeFetch(BRIDGE + '/od/api/health', { signal: AbortSignal.timeout(5000) });
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

    'version': async function () { return json({ version: '2026-07-21' }); }
  };

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
    setGateway: function (u) { GATEWAY = u; try { localStorage.setItem(LS + 'gateway', u); } catch (e) {} },
    agents: AGENTS,
    chain: FREE_CHAIN
  };

  console.log('%cMadeEA OS%c gateway shim active → ' + GATEWAY,
    'color:#fd5812;font-weight:700', 'color:#a3b3c2');
})();
