# fetch_html.ps1 - fetch root HTML from dev server
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173/' -TimeoutSec 10 -ErrorAction Stop
  Write-Output '=== HTML START ==='
  Write-Output $resp.Content
  Write-Output '=== HTML END ==='
} catch {
  Write-Output ('FETCH_FAIL: ' + $_.Exception.Message)
}

# Tail logs if present
$log = Join-Path (Get-Location) 'frontend.log'
$err = Join-Path (Get-Location) 'frontend.err'
Write-Output '=== TAIL frontend.log ==='
if (Test-Path $log) { Get-Content -Path $log -Tail 200 } else { Write-Output 'frontend.log not found' }
Write-Output '=== TAIL frontend.err ==='
if (Test-Path $err) { Get-Content -Path $err -Tail 200 } else { Write-Output 'frontend.err not found' }
