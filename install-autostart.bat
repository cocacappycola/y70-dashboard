@echo off
REM ============================================================================
REM  Installs (or removes) the Y70 Dashboard auto-start.
REM
REM  Puts a shortcut in your Startup folder that runs autostart-hidden.vbs,
REM  which waits 30 seconds for Windows to settle and then launches the
REM  dashboard hidden (no console window flashes).
REM
REM  It picks V2 (the native app) automatically when v2
ode_modules is present,
REM  because that is the build that does not steal focus from games; otherwise it
REM  falls back to the V1 browser launcher. Force one with /v1 or /v2.
REM
REM    install-autostart.bat            install / re-install
REM    install-autostart.bat /remove    uninstall
REM
REM  No administrator rights required.
REM ============================================================================
setlocal EnableExtensions

set "LINKNAME=Y70 Dashboard"
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "VBS=%HERE%\autostart-hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\%LINKNAME%.lnk"

set "WHICH="
if /i "%~1"=="/v1" set "WHICH=v1"
if /i "%~1"=="/v2" set "WHICH=v2"

if /i "%~1"=="/remove" goto :remove

if not exist "%VBS%" (
  echo [ERROR] Missing "%VBS%".
  pause
  exit /b 1
)

echo Installing auto-start...
echo   shortcut: %LINK%
echo   runs:     wscript "%VBS%"
echo   delay:    30 seconds after logon
if defined WHICH echo   version:  %WHICH% (forced)
if not defined WHICH echo   version:  V2 if installed, else V1
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "$s = $w.CreateShortcut($env:LINK);" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"' + $env:VBS + '\" 30 ' + $env:WHICH;" ^
  "$s.WorkingDirectory = $env:HERE;" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'Start the Y70 Dashboard 30s after logon';" ^
  "$s.Save()"

if not exist "%LINK%" (
  echo.
  echo [ERROR] Could not create the shortcut.
  pause
  exit /b 1
)

echo Done. The dashboard will start 30s after each logon.
echo.
echo   Test the unattended path now (no wait):
echo     wscript "%VBS%" 0
echo   Remove it later:
echo     install-autostart.bat /remove
echo.
pause
exit /b 0

:remove
echo Removing auto-start...
if exist "%LINK%" (
  del /f /q "%LINK%"
  echo Removed "%LINK%".
) else (
  echo Not installed - nothing to remove.
)
REM Also clear the scheduled task, in case an earlier version installed one.
schtasks /query /tn "%LINKNAME%" >nul 2>&1
if not errorlevel 1 schtasks /delete /tn "%LINKNAME%" /f >nul 2>&1
pause
exit /b 0
