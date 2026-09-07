# ============================================================================
#  Y70 dashboard — PC telemetry sampler.
#
#  Emits one compact JSON line per sample on stdout, forever. server.js spawns
#  this ONCE and keeps the last two samples; every rate you see in the widget is
#  a delta computed there. Counters here are raw cumulative values on purpose —
#  restarting the sampler then costs one sample, not a wrong number.
#
#  Why a long-lived process: the first call to each of these cmdlets costs
#  ~1s (module load + WMI connect); every call after that is ~20-170ms. Spawning
#  PowerShell per HTTP request would have made the widget unusable.
#
#    powershell -NoProfile -ExecutionPolicy Bypass -File pcstats.ps1 `
#              [-IntervalMs 2000] [-ParentPid <node pid>]
# ============================================================================
param(
  [int]$IntervalMs = 2000,
  # PID of the node server. Windows does not kill a child when its parent dies,
  # so the sampler watches for the server going away and exits with it rather
  # than lingering as an orphan powershell.exe.
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$hasNvidia = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)

# --- Optional CPU temperature source ----------------------------------------
# Windows exposes no CPU die temperature of its own on most desktops (AMD in
# particular: MSAcpi_ThermalZoneTemperature answers "Not supported"). Reading it
# needs a kernel driver, so this looks for LibreHardwareMonitor / OpenHardware-
# Monitor, which publish sensors over WMI while running. Re-probed periodically
# so starting LHM later is picked up without restarting the dashboard.
$tempNs = $null
$probeIn = 0

function Find-TempNamespace {
  foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
    $s = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction SilentlyContinue
    if ($s) { return $ns }
  }
  return $null
}

function Get-CpuTemp {
  if ($script:tempNs) {
    $s = Get-CimInstance -Namespace $script:tempNs -ClassName Sensor -ErrorAction SilentlyContinue |
         Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/(amdcpu|intelcpu)/' }
    if ($s) {
      # Prefer the package / Tctl sensor; otherwise the hottest core.
      $pkg = $s | Where-Object { $_.Name -match 'Package|Tctl|Tdie|Average' } | Select-Object -First 1
      $pick = if ($pkg) { $pkg } else { $s | Sort-Object Value -Descending | Select-Object -First 1 }
      if ($pick -and $pick.Value -gt 0) {
        $src = if ($script:tempNs -match 'Libre') { 'LibreHardwareMonitor' } else { 'OpenHardwareMonitor' }
        return @{ c = [math]::Round([double]$pick.Value, 1); src = $src }
      }
    }
  }
  # Last resort: the ACPI thermal zone. Present on some laptops, and it reports
  # the zone rather than the die, but it is better than nothing.
  $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($z -and $z.CurrentTemperature -gt 0) {
    return @{ c = [math]::Round(($z.CurrentTemperature / 10.0) - 273.15, 1); src = 'ACPI thermal zone' }
  }
  return $null
}

function Get-Gpu {
  if (-not $script:hasNvidia) { return $null }
  $raw = & nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total `
                      --format=csv,noheader,nounits 2>$null
  if (-not $raw) { return $null }
  $f = ($raw | Select-Object -First 1) -split '\s*,\s*'
  if ($f.Count -lt 5) { return $null }
  return @{
    name     = $f[0]
    temp     = [double]$f[1]
    util     = [double]$f[2]
    memUsed  = [double]$f[3]
    memTotal = [double]$f[4]
  }
}

while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  if ($probeIn -le 0) { $tempNs = Find-TempNamespace; $probeIn = if ($tempNs) { 150 } else { 30 } }
  $probeIn--

  # --- Network adapters: cumulative byte counters -----------------------------
  $net = @(Get-NetAdapterStatistics -ErrorAction SilentlyContinue |
    Where-Object { $_.ReceivedBytes -gt 0 } |
    ForEach-Object { @{ n = $_.Name; rx = [double]$_.ReceivedBytes; tx = [double]$_.SentBytes } })

  # --- Established connections to somewhere that is not this machine ----------
  $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.RemoteAddress -notmatch '^(127\.|0\.0\.0\.0$|::1$|::$)' } |
    ForEach-Object { @{ p = [int]$_.OwningProcess; r = $_.RemoteAddress; o = [int]$_.RemotePort } })

  # --- Per-process cumulative I/O --------------------------------------------
  # Perf instance names are suffixed for duplicates ("chrome#3"); strip that so
  # the consumer can total a multi-process app under one name.
  $procs = @(Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
    ForEach-Object {
      @{
        p  = [int]$_.IDProcess
        n  = ($_.Name -replace '#\d+$', '')
        io = [double]$_.IOReadBytesPersec + [double]$_.IOWriteBytesPersec
      }
    })

  $sample = @{
    t       = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    net     = $net
    conns   = $conns
    procs   = $procs
    gpu     = Get-Gpu
    cpuTemp = Get-CpuTemp
  }

  # Write-Output through the pipeline can sit in a buffer; go straight to the
  # console stream and flush so node sees each sample as it happens.
  [Console]::Out.WriteLine(($sample | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()

  Start-Sleep -Milliseconds $IntervalMs
}
