@echo off
REM ===========================================================================
REM MadeEA OS backend - Next.js production server.
REM
REM This serves the UI *and* the real /api/* route handlers from a single
REM origin (127.0.0.1:3000). That is the whole point: when the page and the
REM API share an origin, the browser never makes a cross-origin call to the
REM OmniRoute gateway, so neither CORS nor Chrome's Private Network Access
REM check can block it, and app/omni-shim.js is not involved at all.
REM
REM The static export in ..\app has no server, which is why it falls back to
REM the shim and shows "Gateway offline" on an https origin.
REM
REM Started automatically at logon by the scheduled task "MadeEA OS Backend".
REM Run this file directly to start it by hand.
REM ===========================================================================

set "SRC=C:\Users\USER\OneDrive\Desktop\For Work\MadeEA OS\source"
set "LOG=%LOCALAPPDATA%\madeea-os-backend.log"

cd /d "%SRC%" || exit /b 1

echo. >> "%LOG%"
echo [%date% %time%] starting MadeEA OS backend on http://127.0.0.1:3000 >> "%LOG%"

"C:\Program Files\nodejs\node.exe" "node_modules\next\dist\bin\next" start -H 127.0.0.1 -p 3000 >> "%LOG%" 2>&1

echo [%date% %time%] backend exited with code %ERRORLEVEL% >> "%LOG%"
