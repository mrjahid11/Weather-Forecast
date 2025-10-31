$files = @(
  'C:\Users\jahid\Downloads\Weather-Forecast\test_upstream_params.js',
  'C:\Users\jahid\Downloads\Weather-Forecast\response.json',
  'C:\Users\jahid\Downloads\Weather-Forecast\fetch_upstream.js',
  'C:\Users\jahid\Downloads\Weather-Forecast\fetch_marine_cox.js',
  'C:\Users\jahid\Downloads\Weather-Forecast\marine_cox.json',
  'C:\Users\jahid\Downloads\Weather-Forecast\server.err',
  'C:\Users\jahid\Downloads\Weather-Forecast\frontend.err',
  'C:\Users\jahid\Downloads\Weather-Forecast\Frontend\frontend.err',
  'C:\Users\jahid\Downloads\Weather-Forecast\Backend\server.err'
)
foreach ($f in $files) {
  if (Test-Path $f) {
    try {
      Remove-Item -LiteralPath $f -Force -ErrorAction Stop
      Write-Output "DELETED: $f"
    } catch {
      Write-Output "FAILED: $f -> $($_.Exception.Message)"
    }
  } else {
    Write-Output "MISSING: $f"
  }
}
