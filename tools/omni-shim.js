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

  function gw(path, init) {
    return nativeFetch(GATEWAY.replace(/\/+$/, '') + path, init);
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

    'version': async function () { return json({ version: '2026-07-21' }); }
  };

  /* Pages fetch many endpoints that need a real server. Returning a shaped
     empty payload lets them render their normal empty state rather than
     hanging on a 404. */
  function emptyFor(path) {
    if (/todos|goals|journal|activity|memory|content|leads|radar|astros/.test(path)) return json({ items: [], entries: [], todos: [], goals: [], notes: [] });
    if (/workspace|builds|sessions|artifacts|library/.test(path)) return json({ builds: [], sessions: [], files: [], items: [] });
    if (/status|health|vitals|tokens/.test(path)) return json({ running: false, ok: false, unavailable: true });
    return json({ unavailable: true, reason: 'static export — no server behind this page' });
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
