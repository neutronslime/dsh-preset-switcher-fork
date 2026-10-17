# Restart the dsh web server so the updated dsh-preset-switcher bundle mounts.
# Run this SCRIPT from a DETACHED process (the dsh host it kills also hosts
# the calling agent, so an in-tree job dies with it):
#   Start-Process pwsh -ArgumentList '-NoProfile','-File',restart-web.ps1 -WindowStyle Hidden
param(
  [string]$Port = "5096"
)
$ErrorActionPreference = "Continue"
$base = "C:\Users\Lenovo\.dsh\plugins\dsh-preset-switcher\scripts"
$log = Join-Path $base "web-restart.log"
$serverLog = Join-Path $base "web-server.log"
$resultFile = Join-Path $base "web-verify-result.json"

function Write-Step($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}
Write-Step "=== restart begin (port $Port) ==="

# 1. kill the old server on this port
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $oldPid = $conn[0].OwningProcess
  Write-Step "killing old server pid $oldPid"
  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
for ($i = 0; $i -lt 30; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 1
}

# 2. start the fresh server (same command the user runs)
$dshBin = "C:\Users\Lenovo\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
$proc = Start-Process -FilePath "node" -ArgumentList @("$dshBin", "web", "--port", $Port) `
  -WorkingDirectory "C:\Users\Lenovo\.dsh" `
  -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err" `
  -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1
$proc.Refresh()
Write-Step "started new server pid $($proc.Id)"

# 3. poll the web server until it answers
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
Write-Step ("web server up: " + $ok)

# 4. probe the plugin artifacts
$clientBundle = $false
$hostRoute = $false
$repairRoute = $false
try {
  $b = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/plugins/dsh-preset-switcher/client.js" -UseBasicParsing -TimeoutSec 5
  $clientBundle = ($b.StatusCode -eq 200)
} catch { }
try {
  $body = @{ method = "list" } | ConvertTo-Json -Compress
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/preset-switch/api" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 5
  $hostRoute = ($h.StatusCode -eq 200)
} catch { }
try {
  $body = @{ method = "repair" } | ConvertTo-Json -Compress
  $m = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/preset-switch/api" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 10
  $repairRoute = ($m.StatusCode -eq 200)
} catch { }
Write-Step ("client bundle: " + $clientBundle + ", host route: " + $hostRoute + ", repair route: " + $repairRoute)

$verdict = [ordered]@{
  ok = $ok
  clientBundle = $clientBundle
  hostRoute = $hostRoute
  repairRoute = $repairRoute
  serverPid = $proc.Id
  time = (Get-Date -Format "o")
}
$verdict | ConvertTo-Json | Set-Content -Path $resultFile -Encoding UTF8
Write-Step "=== restart done ==="