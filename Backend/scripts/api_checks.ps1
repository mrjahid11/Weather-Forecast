Write-Output '--- FORECAST (Dhaka) ---'
try {
  $f = Invoke-RestMethod -Uri 'http://localhost:4000/api/forecast?city=Dhaka' -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
  $f | ConvertTo-Json -Depth 5 | Write-Output
} catch {
  Write-Output "FORECAST_FAIL: $($_.Exception.Message)"
}

Write-Output '--- MARINE (Copenhagen) ---'
try {
  $m = Invoke-RestMethod -Uri 'http://localhost:4000/api/marine?lat=55.6761&lon=12.5683&forecast_minutely_15=48&past_minutely_15=0' -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
  $m | ConvertTo-Json -Depth 5 | Write-Output
} catch {
  Write-Output "MARINE_FAIL: $($_.Exception.Message)"
}
