@echo off
REM ============================================================================
REM  Y70 Dashboard V2 launcher.
REM
REM  V2 is a native app. Unlike V1 it needs no browser, no window-placing
REM  PowerShell and no netstat wait loop: the app starts server.js itself, waits
REM  for the port properly, places itself on the panel and - the whole point -
REM  creates its window WS_EX_NOACTIVATE, so tapping the touchscreen never pulls
REM  focus off a game.
REM
REM  Quit it from the tray icon.
REM
REM  It looks for, in order:
REM    1. the installed app (what "npm run dist" + the installer produces),
REM    2. the newest v2\dist*\win-unpacked build,
REM    3. Electron running from source.
REM
REM    launch-v2.bat            run it
REM    launch-v2.bat /quiet     no pauses (used by the auto-start path)
REM ============================================================================
setlocal EnableExtensions EnableDelayedExpansion

set "QUIET="
if /i "%~1"=="/quiet" set "QUIET=1"

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "APP=%HERE%\v2"
set "EXENAME=Y70 Dashboard.exe"

REM Already up? The app enforces a single instance too, but starting a second
REM one just to have it exit wastes a second on a cold boot.
tasklist /fi "imagename eq %EXENAME%" 2>nul | find /i "%EXENAME%" >nul
if not errorlevel 1 (
  echo Dashboard is already running.
  exit /b 0
)

REM ---- 1. Installed (per-user, from the NSIS installer) ----------------------
set "TARGET="
if exist "%LOCALAPPDATA%\Programs\Y70 Dashboard\%EXENAME%" (
  set "TARGET=%LOCALAPPDATA%\Programs\Y70 Dashboard\%EXENAME%"
)

REM ---- 2. Newest local build -------------------------------------------------
REM Windows sometimes keeps a handle on dist\...\app.asar after the app exits,
REM which makes electron-builder fall back to dist2, dist3 and so on. Picking
REM the most recent one means those stale folders are simply ignored.
if not defined TARGET (
  for /f "delims=" %%D in ('dir /b /ad /o-d "%APP%\dist*" 2^>nul') do (
    if not defined TARGET (
      if exist "%APP%\%%D\win-unpacked\%EXENAME%" set "TARGET=%APP%\%%D\win-unpacked\%EXENAME%"
    )
  )
)

if defined TARGET (
  start "" "!TARGET!"
  exit /b 0
)

REM ---- 3. Straight from source -----------------------------------------------
set "ELECTRON=%APP%\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo [ERROR] No built app found and Electron is not installed.
  echo.
  echo Run this once:
  echo     cd /d "%APP%"
  echo     npm install
  echo.
  echo Then, to build the real app:
  echo     npm run dist
  echo.
  if not defined QUIET pause
  exit /b 1
)

start "" /d "%APP%" "%ELECTRON%" .
exit /b 0
