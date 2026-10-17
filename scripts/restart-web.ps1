# Restart the DSH web server so a freshly installed or updated
# dsh-preset-switcher bundle mounts again, then probe the plugin.
#
# Nothing here is tied to one machine: the profile name defaults to "web", the
# port is discovered from the DSH process that is already listening (pass -Port
# to override), `dsh` comes from PATH, and the logs are written next to this
# script.
#
# Run it DETACHED - the server it stops is the one hosting the agent, so an
# in-session run kills itself halfway through:
#   Start-Process pwsh -ArgumentList '-NoProfile','-File',$PSCommandPath -WindowStyle Hidden
# Running it from an ordinary terminal (outside DSH) is the simplest option.
#
#   .\restart-web.ps1                      # profile "web", port auto-detected
#   .\restart-web.ps1 -Port 6862           # explicit port
#   .\restart-web.ps1 -ProfileName work # another profile
[CmdletBinding()]
param(
  [string]$ProfileName = "web",
  [int]$Port = 0,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$log = Join-Path $PSScriptRoot "web-restart.log"
$serverLog = Join-Path $PSScriptRoot "web-server.log"
$resultFile = Join-Path $PSScriptRoot "web-verify-result.json"

function Write-Step([string]$msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

function Get-ListeningPids([int]$p) {
  @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Find-DshPort {
  # Prefer a listener whose process command line looks like `dsh ... --port N`.
  $candidates = @()
  foreach ($conn in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
    $pid0 = $conn.OwningProcess
    if (-not $pid0) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid0" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.CommandLine -notmatch 'dsh') { continue }
    $candidates += [pscustomobject]@{ Port = $conn.LocalPort; Pid = $pid0; CommandLine = $proc.CommandLine }
  }
  $candidates = @($candidates | Sort-Object Port -Unique)
  if ($candidates.Count -eq 0) { return 0 }
  if ($candidates.Count -gt 1) {
    Write-Step ("several DSH listeners found: " + (($candidates | ForEach-Object { $_.Port }) -join ", "))
    Write-Host "Several DSH servers are listening; pass -Port explicitly:"
    $candidates | ForEach-Object { Write-Host ("  port {0} (pid {1})" -f $_.Port, $_.Pid) }
    return 0
  }
  return [int]$candidates[0].Port
}

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
  Write-Host "dsh was not found on PATH. Install DeepSeek Harness or add its bin directory to PATH."
  exit 1
}

if ($Port -le 0) {
  $Port = Find-DshPort
  if ($Port -le 0) {
    Write-Host "Could not determine the DSH web port. Start the server once, then re-run with -Port <port>."
    exit 1
  }
}

Write-Step "=== restart begin (profile $ProfileName, port $Port) ==="

# 1. stop whatever holds the port
foreach ($existingPid in (Get-ListeningPids $Port)) {
  Write-Step "stopping pid $existingPid on port $Port"
  Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
}
for ($i = 0; $i -lt 30; $i++) {
  if (-not (Get-ListeningPids $Port)) { break }
  Start-Sleep -Seconds 1
}

# 2. start the fresh server (the same command line the user would run)
$startArgs = @("-NoProfile", "-Command", "`$ProgressPreference='SilentlyContinue'; dsh --profile $ProfileName --port $Port --no-open")
$proc = Start-Process -FilePath "pwsh" -ArgumentList $startArgs `
  -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err" `
  -PassThru -WindowStyle Hidden
Write-Step "started dsh web (launcher pid $($proc.Id))"

# 3. wait until the port answers (401/403 is fine - auth is on, the server is up)
$up = $false
for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
  if (Get-ListeningPids $Port) {
    try {
      $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
      $up = $true; break
    } catch {
      if ($_.Exception.Response) { $up = $true; break }
    }
  }
  Start-Sleep -Seconds 1
}
Write-Step ("web server answering on port {0}: {1}" -f $Port, $up)

# 4. probe the plugin's host routes
$listOk = $false
$repairOk = $false
if ($up) {
  $api = "http://127.0.0.1:$Port/preset-switch/api"
  try {
    $body = @{ method = "list" } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri $api -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 10
    $listOk = ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch {}
  try {
    $body = @{ method = "repair" } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri $api -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 30
    $repairOk = ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch {}
}
Write-Step ("plugin routes: list=$listOk repair=$repairOk")

# 5. record the verdict next to this script
$verdict = [ordered]@{
  ok          = ($up -and $listOk)
  port        = $Port
  profile     = $ProfileName
  serverUp    = $up
  listRoute   = $listOk
  repairRoute = $repairOk
  launcherPid = $proc.Id
  time        = (Get-Date -Format "o")
  log         = $log
  serverLog   = $serverLog
}
$verdict | ConvertTo-Json | Set-Content -Path $resultFile -Encoding UTF8
Write-Step "=== restart done ==="
Write-Host ("DSH web: port {0}, up={1}, /preset-switch/api list={2} repair={3}" -f $Port, $up, $listOk, $repairOk)
if (-not $listOk) {
  Write-Host "The plugin route did not answer. Check $serverLog and $log."
  exit 2
}
