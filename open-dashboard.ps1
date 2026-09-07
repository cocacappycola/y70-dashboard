# ============================================================================
#  Opens the Y70 Dashboard fullscreen on a chosen monitor.
#
#  Browser --window-position flags are unreliable: once the profile has saved
#  window state, Chromium restores the previous placement and ignores them. So
#  this launches windowed, then *explicitly* moves the window to the target
#  screen with SetWindowPos before fullscreening it with F11.
#
#    powershell -File open-dashboard.ps1 [-Screen 1] [-Url http://127.0.0.1:8888]
# ============================================================================
param(
  [int]$Screen = 1,
  [string]$Url = "http://127.0.0.1:8888",
  [string]$Title = "Y70 Dashboard"
)

Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
"@

# ---- 1. Target screen ------------------------------------------------------
$all = [System.Windows.Forms.Screen]::AllScreens
$target = $all | Where-Object { $_.DeviceName -like "*DISPLAY$Screen" } | Select-Object -First 1
if (-not $target) {
  # Fall back to the physically smallest screen — that's the Y70 panel.
  $target = $all | Sort-Object { $_.Bounds.Width * $_.Bounds.Height } | Select-Object -First 1
}
$b = $target.Bounds
Write-Host ("Target screen {0}: {1},{2} {3}x{4}" -f $target.DeviceName, $b.X, $b.Y, $b.Width, $b.Height)

# ---- 2. Browser ------------------------------------------------------------
# Brave first: the dashboard runs in your normal Brave profile, which is
# already signed in to Spotify, so the app connects without logging in again.
# NOTE: ${env:ProgramFiles(x86)} needs the braces — "$env:ProgramFiles(x86)"
# parses as $env:ProgramFiles followed by a literal "(x86)" and silently builds
# a path that does not exist.
$candidates = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { Write-Error "No Brave, Edge or Chrome found."; exit 1 }
Write-Host "Browser: $browser"

# Deliberately NO --user-data-dir: that would spin up a blank profile with no
# Spotify session. Using the default profile is what makes the login stick.
# Launched WINDOWED on purpose — a fullscreen window can't be relocated, so it
# is placed first and fullscreened afterwards.
$args = @(
  "--app=$Url",
  "--window-position=$($b.X),$($b.Y)",
  "--window-size=$($b.Width),$($b.Height)",
  "--autoplay-policy=no-user-gesture-required",
  "--no-default-browser-check"
)
try {
  Start-Process -FilePath $browser -ArgumentList $args -ErrorAction Stop | Out-Null
} catch {
  Write-Error "Could not start the browser: $_"
  exit 1
}

# ---- 3. Wait for the window, then force it onto the target screen ----------
$name = [System.IO.Path]::GetFileNameWithoutExtension($browser)
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 400
  $p = Get-Process $name -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } |
       Select-Object -First 1
  if ($p) { $hwnd = $p.MainWindowHandle; break }
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Error "Dashboard window never appeared - the browser may have failed to start."
  exit 1
}

# SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) is not used here — we *want* focus so
# the F11 keystroke lands on this window.
[void][Win]::ShowWindow($hwnd, 9)                       # SW_RESTORE
[void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0040)  # SWP_SHOWWINDOW
Start-Sleep -Milliseconds 350
[void][Win]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 250

# ---- 4. Fullscreen it on that monitor --------------------------------------
[System.Windows.Forms.SendKeys]::SendWait("{F11}")
Write-Host "Dashboard opened fullscreen on $($target.DeviceName)."
exit 0
