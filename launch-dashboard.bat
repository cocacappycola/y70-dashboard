@echo off
REM ============================================================================
REM  Y70 Dashboard launcher
REM  Starts the local server (if it isn't already running), waits until it is
REM  actually accepting connections, then opens the dashboard fullscreen on the
REM  small screen (Windows display 1 - the Y70 Touch panel).
REM
REM  Double-click to run, point a Nexus Macro Touchpad button at it, or let the
REM  installed "Y70 Dashboard" scheduled task run it 30s after logon.
REM ============================================================================
setlocal EnableExtensions

REM /quiet suppresses the error pauses so an unattended (scheduled) run can
REM never hang on a hidden prompt.
set "QUIET="
if /i "%~1"=="/quiet" set "QUIET=1"

set "SCREEN=1"
set "PORT=8888"
set "URL=http://127.0.0.1:%PORT%"
set "HERE=%~dp0"
REM Strip the trailing backslash - a path ending in \" confuses cmd quoting.
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

REM ---- 1. Locate node --------------------------------------------------------
REM PATH is not always inherited when launched from Task Scheduler or a Nexus
REM macro, so fall back to the standard install locations.
set "NODE="
for %%N in (node.exe) do if not defined NODE set "NODE=%%~$PATH:N"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined NODE (
  echo [ERROR] Could not find node.exe. Install Node.js from https://nodejs.org
  if not defined QUIET pause
  exit /b 1
)

REM ---- 2. Start the server if nothing is listening yet ------------------------
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Starting server...
  REM /d sets the working directory, so no nested-quote "cd && node" is needed.
  start "Y70 Dashboard Server" /d "%HERE%" /min "%NODE%" server.js
) else (
  echo Server already running.
)

REM ---- 3. Wait until the port actually accepts connections --------------------
REM This is what prevents "127.0.0.1 refused to connect": the browser must not
REM open before the server is listening. Polls for up to ~20 seconds.
set "READY="
for /l %%i in (1,1,40) do (
  if not defined READY (
    netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
    if not errorlevel 1 (
      set "READY=1"
    ) else (
      REM ~0.5s pause without needing timeout.exe (unavailable in some contexts)
      ping -n 1 -w 500 192.0.2.1 >nul 2>&1
    )
  )
)

if not defined READY (
  echo [ERROR] Server did not start listening on port %PORT%.
  echo Try running "node server.js" in this folder to see the error.
  if not defined QUIET pause
  exit /b 1
)
echo Server is up.

REM ---- 4. Open it fullscreen on the target screen ----------------------------
REM Delegated to PowerShell: browser --window-position flags are ignored once
REM the profile has saved window state, so the window has to be moved onto the
REM screen explicitly after it appears. See open-dashboard.ps1.
echo Opening dashboard on screen %SCREEN%...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%\open-dashboard.ps1" -Screen %SCREEN% -Url "%URL%"

if errorlevel 1 (
  echo [ERROR] Could not open the dashboard window.
  if not defined QUIET pause
  exit /b 1
)

exit /b 0
