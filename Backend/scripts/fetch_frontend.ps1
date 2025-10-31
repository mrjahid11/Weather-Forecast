# fetch_frontend.ps1 - start Vite dev server if needed and fetch root HTML
param()

$fw = 'C:\Users\jahid\Downloads\Weather-Forecast\Frontend'
Set-Location -Path $fw

Write-Output "=== netstat :5173 ==="
$ns = netstat -ano | findstr :5173
Write-Output $ns

$listening = $false
if ($ns -and $ns.Trim() -ne '') { $listening = $true }

if (-not $listening) {
  Write-Output "No listener on 5173 — starting Vite (npm run dev) and redirecting logs to frontend.log/frontend.err"
  if (Test-Path frontend.log) { Remove-Item frontend.log -Force }
  if (Test-Path frontend.err) { Remove-Item frontend.err -Force }
  Start-Process -FilePath 'npm' -ArgumentList 'run','dev' -WorkingDirectory $fw -RedirectStandardOutput (Join-Path $fw 'frontend.log') -RedirectStandardError (Join-Path $fw 'frontend.err') -NoNewWindow -PassThru | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Output "Port 5173 appears in use; will attempt to fetch"
}

Write-Output "=== Fetching http://localhost:5173/ ==="
try {
  $resp = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Write-Output "--- HTML BEGIN ---"
  Write-Output $resp.Content
  Write-Output "--- HTML END ---"
} catch {
  Write-Output "FETCH_FAIL: $($_.Exception.Message)"
}

Write-Output "=== Tail frontend.log (if exists) ==="
if (Test-Path (Join-Path $fw 'frontend.log')) { Get-Content -Path (Join-Path $fw 'frontend.log') -Tail 200 } else { Write-Output 'frontend.log not found' }

Write-Output "=== Tail frontend.err (if exists) ==="
if (Test-Path (Join-Path $fw 'frontend.err')) { Get-Content -Path (Join-Path $fw 'frontend.err') -Tail 200 } else { Write-Output 'frontend.err not found' }

Write-Output 'DONE'
