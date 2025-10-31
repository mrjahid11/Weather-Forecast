$url = 'http://localhost:4000/api/marine?lat=55.6761&lon=12.5683&forecast_minutely_15=48&past_minutely_15=0'
try {
  $r = Invoke-RestMethod -UseBasicParsing -Uri $url -TimeoutSec 30 -ErrorAction Stop
  $r | ConvertTo-Json -Depth 5
} catch {
  Write-Output ('MARINE_FAIL: ' + $_.Exception.Message)
}
