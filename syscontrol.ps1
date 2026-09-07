# ============================================================================
#  Y70 dashboard — system control helper.
#
#  A single long-lived PowerShell process that server.js talks to over stdin
#  and stdout, one JSON object per line:
#
#     ->  {"id":7,"cmd":"audio.setDefault","args":{"id":"{0.0.0...}"}}
#     <-  {"id":7,"ok":true,"data":{...}}
#     <-  {"push":"state","data":{"audio":{...},"media":{...}}}
#
#  Spawning PowerShell per action costs ~1s (module load + COM/WinRT init), so
#  it stays resident and pushes state on a tick instead. Reading stdin without
#  blocking that tick is done with ReadLineAsync + a short Wait, not ReadLine.
#
#  Covers:
#    · Core Audio  — output/input device list, one-tap default switching
#                    (IPolicyConfig), master + per-app volume and mute, live
#                    peak meters
#    · GSMTC       — Windows' own "what is playing" bus, so the panel controls
#                    Spotify, a browser tab, VLC, a game, anything
# ============================================================================
param(
  [int]$IntervalMs = 1000,
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------- Core Audio
Add-Type -Language CSharp @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class Y70Audio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class DevEnum {}
  // Undocumented but stable since Vista; the only way to set the default
  // endpoint, and what every audio-switcher utility on Windows uses.
  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] public class PolicyConfigClient {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore s);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k);
    int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig {
    int GetMixFormat(); int GetDeviceFormat(); int ResetDeviceFormat(); int SetDeviceFormat();
    int GetProcessingPeriod(); int SetProcessingPeriod(); int GetShareMode(); int SetShareMode();
    int GetPropertyValue(); int SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    int SetEndpointVisibility();
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n); int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float d, ref Guid g);
    int SetMasterVolumeLevelScalar(float d, ref Guid g);
    int GetMasterVolumeLevel(out float d);
    int GetMasterVolumeLevelScalar(out float d);
    int SetChannelVolumeLevel(int i, float d, ref Guid g);
    int SetChannelVolumeLevelScalar(int i, float d, ref Guid g);
    int GetChannelVolumeLevel(int i, out float d);
    int GetChannelVolumeLevelScalar(int i, out float d);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation { int GetPeakValue(out float p); }

  // IAudioSessionManager has 2 methods; GetSessionEnumerator is slot 3.
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    int GetAudioSessionControl(); int GetSimpleAudioVolume();
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl2 s); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    int GetState(out int s);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string s);
    int SetDisplayName(); int GetIconPath(); int SetIconPath(); int GetGroupingParam();
    int SetGroupingParam(); int RegisterAudioSessionNotification(); int UnregisterAudioSessionNotification();
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISimpleAudioVolume {
    int SetMasterVolume(float v, ref Guid ctx); int GetMasterVolume(out float v);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }

  public class Dev { public string id; public string name; public bool isDefault; public float volume; public bool muted; public float peak; }
  public class Sess { public uint pid; public string name; public float volume; public bool muted; public float peak; public int state; }

  static Guid ctxGuid = Guid.Empty;
  static IMMDeviceEnumerator Enum2() { return (IMMDeviceEnumerator)(new DevEnum()); }

  static string NameOf(IMMDevice d) {
    IPropertyStore ps; d.OpenPropertyStore(0, out ps);
    var key = new PROPERTYKEY();
    key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); key.pid = 14;  // FriendlyName
    PROPVARIANT v; ps.GetValue(ref key, out v);
    return Marshal.PtrToStringUni(v.p);
  }
  static IAudioEndpointVolume Vol(IMMDevice d) {
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    d.Activate(ref iid, 1, IntPtr.Zero, out o); return (IAudioEndpointVolume)o;
  }
  static IAudioMeterInformation Meter(IMMDevice d) {
    Guid iid = typeof(IAudioMeterInformation).GUID; object o;
    d.Activate(ref iid, 1, IntPtr.Zero, out o); return (IAudioMeterInformation)o;
  }

  // flow: 0 = render (outputs), 1 = capture (inputs)
  public static List<Dev> Devices(int flow) {
    var e = Enum2();
    IMMDevice def = null; string defId = "";
    try { e.GetDefaultAudioEndpoint(flow, 0, out def); def.GetId(out defId); } catch {}
    IMMDeviceCollection col; e.EnumAudioEndpoints(flow, 1, out col);   // 1 = DEVICE_STATE_ACTIVE
    int n; col.GetCount(out n);
    var list = new List<Dev>();
    for (int i = 0; i < n; i++) {
      IMMDevice d; col.Item(i, out d);
      string id; d.GetId(out id);
      var dev = new Dev(); dev.id = id; dev.name = NameOf(d); dev.isDefault = (id == defId);
      try { var v = Vol(d); float s; v.GetMasterVolumeLevelScalar(out s); dev.volume = s; bool m; v.GetMute(out m); dev.muted = m; } catch {}
      // Only the default endpoint is metered; polling every device is wasteful.
      if (dev.isDefault) { try { float p; Meter(d).GetPeakValue(out p); dev.peak = p; } catch {} }
      list.Add(dev);
    }
    return list;
  }

  public static void SetDefault(string id) {
    var pc = (IPolicyConfig)(new PolicyConfigClient());
    // Console, Multimedia and Communications, so one tap really does move
    // everything rather than leaving chat on the old device.
    for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role);
  }

  public static void SetDeviceVolume(int flow, float level) {
    var e = Enum2(); IMMDevice d; e.GetDefaultAudioEndpoint(flow, 0, out d);
    Vol(d).SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref ctxGuid);
  }
  public static void SetDeviceMute(int flow, bool mute) {
    var e = Enum2(); IMMDevice d; e.GetDefaultAudioEndpoint(flow, 0, out d);
    Vol(d).SetMute(mute, ref ctxGuid);
  }
  public static bool GetDeviceMute(int flow) {
    var e = Enum2(); IMMDevice d; e.GetDefaultAudioEndpoint(flow, 0, out d);
    bool m; Vol(d).GetMute(out m); return m;
  }

  static IAudioSessionEnumerator SessionEnum() {
    var e = Enum2(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 0, out d);
    Guid iid = typeof(IAudioSessionManager2).GUID; object o;
    d.Activate(ref iid, 1, IntPtr.Zero, out o);
    IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
    return se;
  }

  public static List<Sess> Sessions() {
    var se = SessionEnum();
    int n; se.GetCount(out n);
    var byName = new Dictionary<string, Sess>();
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 c; se.GetSession(i, out c);
      uint pid; c.GetProcessId(out pid);
      string nm = "System sounds";
      if (pid > 0) { try { nm = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { continue; } }
      var s = new Sess(); s.pid = pid; s.name = nm;
      try { var sv = (ISimpleAudioVolume)c; float v; sv.GetMasterVolume(out v); s.volume = v; bool m; sv.GetMute(out m); s.muted = m; } catch {}
      try { float p; ((IAudioMeterInformation)c).GetPeakValue(out p); s.peak = p; } catch {}
      int st; c.GetState(out st); s.state = st;
      // An app can hold several sessions (Discord keeps one per voice/UI
      // stream). Fold them into one row, keeping the liveliest.
      Sess prev;
      if (byName.TryGetValue(nm, out prev)) {
        if (s.peak > prev.peak) prev.peak = s.peak;
        if (s.state == 1) { prev.state = 1; prev.pid = s.pid; }
        prev.muted = prev.muted || s.muted;
      } else byName[nm] = s;
    }
    return new List<Sess>(byName.Values);
  }

  // Applies to EVERY session owned by that program, so muting "Discord"
  // silences all of its streams rather than whichever one came back first.
  public static int SetSession(string name, float volume, bool setVolume, bool mute, bool setMute) {
    var se = SessionEnum();
    int n; se.GetCount(out n); int hit = 0;
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 c; se.GetSession(i, out c);
      uint pid; c.GetProcessId(out pid);
      string nm = "System sounds";
      if (pid > 0) { try { nm = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { continue; } }
      if (!string.Equals(nm, name, StringComparison.OrdinalIgnoreCase)) continue;
      try {
        var sv = (ISimpleAudioVolume)c;
        if (setVolume) sv.SetMasterVolume(Math.Max(0f, Math.Min(1f, volume)), ref ctxGuid);
        if (setMute) sv.SetMute(mute, ref ctxGuid);
        hit++;
      } catch {}
    }
    return hit;
  }
}
"@

# ---------------------------------------------------------------- GSMTC
$script:mediaOk = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
  $script:mediaMgr = $null
  $script:mediaOk = $true
} catch { $script:mediaOk = $false }

function Await($op, $type) {
  $m = $script:asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  if (-not $t.Wait(4000)) { throw "winrt timeout" }
  $t.Result
}
function MediaManager {
  if ($null -eq $script:mediaMgr) {
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $script:mediaMgr = Await ($mgrType::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  $script:mediaMgr
}

# The app id is a package/AUMID string; turn it into something showable.
function PrettyApp($aumid) {
  if (-not $aumid) { return "" }
  $s = [string]$aumid
  if ($s.Contains("!")) { $s = $s.Split("!")[-1] }
  $s = $s -replace '\.exe$', ''
  if ($s -match '^[0-9a-zA-Z]+\.([A-Za-z]+)') { }
  return $s
}

$script:artKey = ""
$script:artB64 = ""

function ReadThumb($props) {
  # GSMTC hands back the thumbnail as IRandomAccessStreamReference. Opening it
  # returns a bare System.__ComObject that Windows PowerShell 5.1 will not
  # project onto the WinRT interface (`does not contain a method named
  # GetInputStreamAt`, and an explicit cast is refused too), so the bytes are
  # unreachable from here without a compiled WinRT helper. The widget falls back
  # to art the Spotify app already publishes, or a themed placeholder.
  return ""
}

function MediaState {
  if (-not $script:mediaOk) { return $null }
  try {
    $mgr = MediaManager
    $s = $mgr.GetCurrentSession()
    if ($null -eq $s) { $script:artKey = ""; $script:artB64 = ""; return $null }
    $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $pb = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $key = "$($props.Artist)|$($props.Title)"
    if ($key -ne $script:artKey) { $script:artKey = $key; $script:artB64 = ReadThumb $props }
    $ctl = $pb.Controls
    [pscustomobject]@{
      app       = PrettyApp $s.SourceAppUserModelId
      appId     = [string]$s.SourceAppUserModelId
      title     = [string]$props.Title
      artist    = [string]$props.Artist
      album     = [string]$props.AlbumTitle
      playing   = ($pb.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
      position  = [int]$tl.Position.TotalMilliseconds
      duration  = [int]$tl.EndTime.TotalMilliseconds
      art       = $script:artB64
      canNext   = [bool]$ctl.IsNextEnabled
      canPrev   = [bool]$ctl.IsPreviousEnabled
      canSeek   = [bool]$ctl.IsPlaybackPositionEnabled
    }
  } catch { return $null }
}

function MediaCommand($action, $args) {
  $mgr = MediaManager
  $s = $mgr.GetCurrentSession()
  if ($null -eq $s) { throw "no media session" }
  switch ($action) {
    "toggle" { $null = $s.TryTogglePlayPauseAsync() }
    "play"   { $null = $s.TryPlayAsync() }
    "pause"  { $null = $s.TryPauseAsync() }
    "next"   { $null = $s.TrySkipNextAsync() }
    "prev"   { $null = $s.TrySkipPreviousAsync() }
    "seek"   { $null = $s.TryChangePlaybackPositionAsync([long]([double]$args.ms * 10000)) }
    default  { throw "unknown media action $action" }
  }
  $true
}

# ---------------------------------------------------------------- Protocol
function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Handle($msg) {
  $cmd = [string]$msg.cmd
  $a = $msg.args
  switch ($cmd) {
    "audio.setDefault"  { [Y70Audio]::SetDefault([string]$a.id); return @{ ok = $true } }
    "audio.setVolume"   { [Y70Audio]::SetDeviceVolume(0, [float]$a.level); return @{ ok = $true } }
    "audio.setMute"     { [Y70Audio]::SetDeviceMute(0, [bool]$a.mute); return @{ ok = $true } }
    "audio.micVolume"   { [Y70Audio]::SetDeviceVolume(1, [float]$a.level); return @{ ok = $true } }
    "audio.micMute"     { [Y70Audio]::SetDeviceMute(1, [bool]$a.mute); return @{ ok = $true } }
    "audio.micToggle"   { $m = [Y70Audio]::GetDeviceMute(1); [Y70Audio]::SetDeviceMute(1, -not $m); return @{ ok = $true; muted = (-not $m) } }
    "audio.setInput"    { [Y70Audio]::SetDefault([string]$a.id); return @{ ok = $true } }
    "audio.session"     {
      $setVol = $null -ne $a.volume
      $setMute = $null -ne $a.mute
      $vol = if ($setVol) { [float]$a.volume } else { 0 }
      $mute = if ($setMute) { [bool]$a.mute } else { $false }
      $hit = [Y70Audio]::SetSession([string]$a.name, $vol, $setVol, $mute, $setMute)
      return @{ ok = ($hit -gt 0); matched = $hit }
    }
    "media.command"     { $null = MediaCommand ([string]$a.action) $a; return @{ ok = $true } }
    "ping"              { return @{ ok = $true; pong = $true } }
    default             { throw "unknown command: $cmd" }
  }
}

function SnapshotState {
  $audio = $null
  try {
    $audio = @{
      outputs = @([Y70Audio]::Devices(0) | ForEach-Object {
        @{ id = $_.id; name = $_.name; isDefault = $_.isDefault; volume = [math]::Round($_.volume, 3); muted = $_.muted; peak = [math]::Round($_.peak, 4) } })
      inputs = @([Y70Audio]::Devices(1) | ForEach-Object {
        @{ id = $_.id; name = $_.name; isDefault = $_.isDefault; volume = [math]::Round($_.volume, 3); muted = $_.muted; peak = [math]::Round($_.peak, 4) } })
      sessions = @([Y70Audio]::Sessions() | ForEach-Object {
        @{ pid = $_.pid; name = $_.name; volume = [math]::Round($_.volume, 3); muted = $_.muted; peak = [math]::Round($_.peak, 4); active = ($_.state -eq 1) } })
    }
  } catch { $audio = $null }
  @{ audio = $audio; media = (MediaState); t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
}

# ---------------------------------------------------------------- Loop
# [Console]::In is a SyncTextReader whose ReadLineAsync() blocks the caller
# until a line arrives, which would stop the push tick dead. Wrapping the raw
# standard-input stream gives a StreamReader whose async read really is async.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $null
$nextPush = [DateTime]::MinValue

while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }

  if ($null -eq $pending) { $pending = $stdin.ReadLineAsync() }
  # A short slice: long enough not to spin, short enough that a tap feels instant.
  if ($pending.Wait(60)) {
    $line = $pending.Result
    $pending = $null
    if ($null -eq $line) { exit 0 }          # stdin closed -> server is gone
    $line = $line.Trim()
    if ($line) {
      $msg = $null
      try { $msg = $line | ConvertFrom-Json } catch {}
      if ($msg) {
        try {
          $res = Handle $msg
          Emit ([pscustomobject]@{ id = $msg.id; ok = $true; data = $res })
        } catch {
          Emit ([pscustomobject]@{ id = $msg.id; ok = $false; error = $_.Exception.Message })
        }
        # Anything that changed state should show up immediately, not a tick later.
        $nextPush = [DateTime]::MinValue
      }
    }
  }

  if ([DateTime]::UtcNow -ge $nextPush) {
    $nextPush = [DateTime]::UtcNow.AddMilliseconds($IntervalMs)
    try { Emit ([pscustomobject]@{ push = "state"; data = (SnapshotState) }) } catch {}
  }
}
