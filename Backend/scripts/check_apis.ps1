# Check APIs script - start server and call endpoints, capturing logs
Set-Location -Path (Split-Path -Path $MyInvocation.MyCommand.Definition -Parent)
# Move to Backend root
Set-Location -Path '..' | Out-Null

# Stop any existing node processes
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { Try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } Catch { } }
Start-Sleep -Milliseconds 300

# Start server with redirected logs
$log = Join-Path -Path (Get-Location) -ChildPath 'server.log'
$err = Join-Path -Path (Get-Location) -ChildPath 'server.err'
if (Test-Path $log) { Remove-Item $log -Force }
if (Test-Path $err) { Remove-Item $err -Force }

Write-Output "Starting node server (background), stdout -> $log, stderr -> $err"
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory (Get-Location) -RedirectStandardOutput $log -RedirectStandardError $err -NoNewWindow -PassThru | Out-Null
Start-Sleep -Seconds 1

Write-Output "=== SERVER STARTED ==="

Function SafeInvoke($label, $uri, $timeoutSeconds=30, $depth=3) {
    Write-Output "--- $label ---"
    try {
        $r = Invoke-RestMethod -Uri $uri -UseBasicParsing -TimeoutSec $timeoutSeconds -ErrorAction Stop
        $json = $r | ConvertTo-Json -Depth $depth
        Write-Output $json
    } catch {
        Write-Output "$label FAILED: $($_.Exception.Message)"
    }
}

# Calls
SafeInvoke 'FORECAST' 'http://localhost:4000/api/forecast?city=Dhaka' 30 3
SafeInvoke 'MARINE_COPENHAGEN' 'http://localhost:4000/api/marine?lat=55.6761&lon=12.5683&forecast_minutely_15=48&past_minutely_15=0' 30 4
SafeInvoke 'MARINE_DHAKA' 'http://localhost:4000/api/marine?lat=23.7643863&lon=90.3890144&forecast_minutely_15=48&past_minutely_15=0' 30 4
SafeInvoke 'AIR_QUALITY' 'http://localhost:4000/api/air-quality?lat=23.7643863&lon=90.3890144' 30 3
SafeInvoke 'CLIMATE' 'http://localhost:4000/api/climate?lat=23.7643863&lon=90.3890144&years=30' 60 3

Write-Output '=== TAIL server.log ==='
if (Test-Path $log) { Get-Content -Path $log -Tail 300 } else { Write-Output 'server.log not found' }
Write-Output '=== TAIL server.err ==='
if (Test-Path $err) { Get-Content -Path $err -Tail 300 } else { Write-Output 'server.err not found' }

Write-Output '=== DONE ===' 
