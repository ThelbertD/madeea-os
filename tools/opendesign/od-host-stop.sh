#!/bin/bash
cd "$HOME/open-design" || exit 1
export PATH="$HOME/AppData/Roaming/npm:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
pnpm tools-dev stop >/dev/null 2>&1
# Stop the static web server we started (matched on its script name).
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*od-web-server.mjs*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null
echo stopped
