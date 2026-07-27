#!/bin/bash
# Start Open Design on the fixed ports the MadeEA OS embed expects.
#   daemon 7455 (tools-dev)   web 7456 (static export + /api proxy)
#
# The web app is built with Next's output:"export", so tools-dev's own web
# launcher cannot serve it — `next start` refuses an exported build. We serve
# apps/web/out ourselves and proxy /api/* to the daemon, which is what
# tools-dev was doing for the web process.
cd "$HOME/open-design" || exit 1
export PATH="$HOME/AppData/Roaming/npm:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

pnpm tools-dev start daemon --daemon-port 7455 >/dev/null 2>&1

[ -d apps/web/out ] || pnpm --filter @open-design/web build >/dev/null 2>&1

if ! curl -s -o /dev/null -m 3 http://127.0.0.1:7456; then
  nohup node od-web-server.mjs >.tmp/od-web.log 2>&1 &
fi

for i in $(seq 1 25); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:7456 && break
  sleep 1
done

echo "daemon: $(curl -s -m 5 http://127.0.0.1:7455/api/health || echo down)"
echo "web:    $(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:7456)"
