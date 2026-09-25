# ============================================================================
#  winpin.ps1 - park another program's window on the Y70 panel and hold it.
#
#  Reads JSON commands on stdin, one per line, and writes JSON lines back:
#
#    {"cmd":"list"}                                  -> every window worth showing
#    {"cmd":"pin","hwnd":"12345"}                    -> remember where it was
#    {"cmd":"move","hwnd":"12345","x":..,"y":..,"w":..,"h":..,"topmost":true}
#    {"cmd":"unpin","hwnd":"12345"}                  -> put it back
#
#  Every move goes through SetWindowPos with SWP_NOACTIVATE. That matters more
#  here than anywhere else in this project: the whole point of the panel is
#  that it never pulls focus off a game, and moving a window normally would.
# ============================================================================
param([int]$ParentPid = 0)

$ErrorActionPreference = "Stop"

Add-Type -Namespace Y70 -Name Win -MemberDefinition @'
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(
        IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(
        IntPtr h, int attr, out int val, int size);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);

    public struct RECT { public int Left, Top, Right, Bottom; }
'@

# Without this the coordinates we are handed would be virtualised on a scaled
# display and the window would land somewhere near, but not on, the panel.
try { [void][Y70.Win]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

$GWL_EXSTYLE       = -20
$WS_EX_TOOLWINDOW  = 0x00000080
$WS_EX_TOPMOST     = 0x00000008
$GW_OWNER          = 4
$DWMWA_CLOAKED     = 14
$HWND_TOPMOST      = [IntPtr](-1)
$HWND_NOTOPMOST    = [IntPtr](-2)
$SWP_NOACTIVATE    = 0x0010
$SWP_NOZORDER      = 0x0004
$SW_SHOWNOACTIVATE = 4
$SW_HIDE           = 0

$self = [System.Diagnostics.Process]::GetCurrentProcess().Id
$saved = @{}                      # hwnd -> where the window was before we moved it

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

function Get-Title([IntPtr]$h) {
  $n = [Y70.Win]::GetWindowTextLength($h)
  if ($n -le 0) { return "" }
  $sb = New-Object System.Text.StringBuilder ($n + 1)
  [void][Y70.Win]::GetWindowText($h, $sb, $sb.Capacity)
  return $sb.ToString()
}

function Get-Rect([IntPtr]$h) {
  $r = New-Object Y70.Win+RECT
  if (-not [Y70.Win]::GetWindowRect($h, [ref]$r)) { return $null }
  return @{ x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top }
}

function Is-Cloaked([IntPtr]$h) {
  $v = 0
  # UWP keeps invisible ghost windows around; DWM is the only thing that knows.
  if ([Y70.Win]::DwmGetWindowAttribute($h, $DWMWA_CLOAKED, [ref]$v, 4) -ne 0) { return $false }
  return ($v -ne 0)
}

function List-Windows {
  $found = New-Object System.Collections.ArrayList
  $cb = [Y70.Win+EnumWindowsProc] {
    param([IntPtr]$h, [IntPtr]$l)
    try {
      if (-not [Y70.Win]::IsWindowVisible($h)) { return $true }
      if ([Y70.Win]::GetWindow($h, $GW_OWNER) -ne [IntPtr]::Zero) { return $true }
      $ex = [Y70.Win]::GetWindowLong($h, $GWL_EXSTYLE)
      if (($ex -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }
      if (Is-Cloaked $h) { return $true }

      $title = Get-Title $h
      if ([string]::IsNullOrWhiteSpace($title)) { return $true }

      # $pid is PowerShell's own automatic variable; do not shadow it.
      $wpid = 0
      [void][Y70.Win]::GetWindowThreadProcessId($h, [ref]$wpid)
      # Neither our own window nor the dashboard's is worth offering.
      if ($wpid -eq $self) { return $true }
      if ($ParentPid -gt 0 -and $wpid -eq $ParentPid) { return $true }

      $rect = Get-Rect $h
      if ($null -eq $rect -or $rect.w -lt 80 -or $rect.h -lt 60) { return $true }

      $name = ""
      try { $name = [System.Diagnostics.Process]::GetProcessById($wpid).ProcessName } catch { }

      [void]$found.Add(@{
        hwnd = [string]([int64]$h); title = $title; process = $name; pid = $wpid
        x = $rect.x; y = $rect.y; w = $rect.w; h = $rect.h
        topmost = (($ex -band $WS_EX_TOPMOST) -ne 0)
      })
    } catch { }
    return $true
  }
  [void][Y70.Win]::EnumWindows($cb, [IntPtr]::Zero)
  return ,@($found.ToArray())
}

function To-Handle($v) { return [IntPtr][int64]"$v" }

while ($true) {
  if ($ParentPid -gt 0) {
    # Never outlive the dashboard: an orphan here would go on shoving a window
    # around the screen with nothing left to tell it to stop.
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  }

  # [Console]::In is a SyncTextReader whose ReadLine blocks in a way that has
  # bitten this project before; read the raw stream instead.
  if (-not $script:stdin) {
    $script:stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
  }
  $line = $script:stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }

  try { $msg = $line | ConvertFrom-Json } catch { continue }
  $cmd = "$($msg.cmd)"

  try {
    switch ($cmd) {
      "list" {
        Send @{ type = "list"; windows = (List-Windows) }
      }

      "pin" {
        $h = To-Handle $msg.hwnd
        if (-not [Y70.Win]::IsWindow($h)) { Send @{ type = "pinned"; ok = $false; error = "that window is gone" }; break }
        $rect = Get-Rect $h
        $ex = [Y70.Win]::GetWindowLong($h, $GWL_EXSTYLE)
        $saved["$($msg.hwnd)"] = @{ rect = $rect; topmost = (($ex -band $WS_EX_TOPMOST) -ne 0) }
        Send @{ type = "pinned"; ok = $true; hwnd = "$($msg.hwnd)"; title = (Get-Title $h); where = $rect }
      }

      "move" {
        $h = To-Handle $msg.hwnd
        if (-not [Y70.Win]::IsWindow($h)) { Send @{ type = "gone"; hwnd = "$($msg.hwnd)" }; break }
        if ([Y70.Win]::IsIconic($h)) { [void][Y70.Win]::ShowWindow($h, $SW_SHOWNOACTIVATE) }
        $x = [int]$msg.x; $y = [int]$msg.y; $w = [int]$msg.w; $ht = [int]$msg.h
        $now = Get-Rect $h
        $same = ($null -ne $now -and $now.x -eq $x -and $now.y -eq $y -and $now.w -eq $w -and $now.h -eq $ht)
        if (-not $same) {
          $after = if ($msg.topmost) { $HWND_TOPMOST } else { $HWND_NOTOPMOST }
          [void][Y70.Win]::SetWindowPos($h, $after, $x, $y, $w, $ht, $SWP_NOACTIVATE)
        }
      }

      "hide" {
        # The widget's slot is closed, so park the window out of sight rather
        # than leaving it floating over whatever took the slot's place.
        $h = To-Handle $msg.hwnd
        if ([Y70.Win]::IsWindow($h)) { [void][Y70.Win]::ShowWindow($h, $SW_HIDE) }
      }

      "show" {
        $h = To-Handle $msg.hwnd
        if ([Y70.Win]::IsWindow($h)) { [void][Y70.Win]::ShowWindow($h, $SW_SHOWNOACTIVATE) }
      }

      "unpin" {
        $key = "$($msg.hwnd)"
        $h = To-Handle $msg.hwnd
        $back = $saved[$key]
        $saved.Remove($key)
        if ([Y70.Win]::IsWindow($h) -and $null -ne $back) {
          # Always make it visible again, even if it was parked when unpinned:
          # a window nobody can find is worse than one in the wrong place.
          [void][Y70.Win]::ShowWindow($h, $SW_SHOWNOACTIVATE)
          $after = if ($back.topmost) { $HWND_TOPMOST } else { $HWND_NOTOPMOST }
          [void][Y70.Win]::SetWindowPos($h, $after, $back.rect.x, $back.rect.y, $back.rect.w, $back.rect.h, $SWP_NOACTIVATE)
        }
        Send @{ type = "unpinned"; ok = $true; hwnd = $key }
      }

      default { Send @{ type = "error"; error = "unknown command: $cmd" } }
    }
  } catch {
    Send @{ type = "error"; error = "$($_.Exception.Message)" }
  }
}
