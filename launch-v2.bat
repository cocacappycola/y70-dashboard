@echo off
REM ============================================================================
REM  Y70 Dashboard V2 launcher.
REM
REM  V2 is a native app. Unlike V1 it needs no browser, no window-placing
REM  PowerShell and no netstat wait loop: the app starts server.js itself, waits
REM  for the port properly, places itself on the panel and — the whole point —
REM  creates its window WS_EX_NOACTIVATE, so tapping the touchscreen never pulls
REM  focus off a game.
REM
REM  Quit it from the tray icon.
REM
REM    launch-v2.bat            run it
REM    launch-v2.bat /quiet     no pauses (used by the auto-start path)
REM ============================================================================
setlocal EnableExtensions

set "QUIET="
if /i "%~1"=="/quiet" set "QUIET=1"

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "APP=%HERE%\v2"
set "ELECTRON=%APP%\node_modules\electron\dist\electron.exe"
set "PACKAGED=%APP%\dist\win-unpacked\Y70 Dashboard.exe"
REM A locked dist\ (Defender sometimes keeps a handle on app.asar) makes
REM electron-builder fall back to dist2\; look there too.
if not exist "%PACKAGED%" set "PACKAGED=%APP%\dist2\win-unpacked\Y70 Dashboard.exe"

REM Prefer the built app when it exists: it carries the icon and the real
REM process name, and its "Start with Windows" toggle actually works.
if exist "%PACKAGED%" (
  tasklist /fi "imagename eq Y70 Dashboard.exe" 2>nul | find /i "Y70 Dashboard.exe" >nul
  if not errorlevel 1 (
    echo Dashboard is already running.
    exit /b 0
  )
  start "" "%PACKAGED%"
  exit /b 0
)

if not exist "%ELECTRON%" (
  echo [ERROR] Electron is not installed yet.
  echo.
  echo Run this once:
  echo     cd /d "%APP%"
  echo     npm install
  echo.
  if not defined QUIET pause
  exit /b 1
)

REM Only one panel at a time; the app enforces this too, but starting a second
REM Electron just to have it exit is a wasted second on a cold boot.
tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul
if not errorlevel 1 (
  echo Dashboard is already running.
  exit /b 0
)

start "" /d "%APP%" "%ELECTRON%" .
exit /b 0
