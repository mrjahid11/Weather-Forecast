<#
Run-dev.ps1 — helper to start backend and frontend for Windows PowerShell

Usage:
  # build frontend into Backend/public and start backend (mock disabled)
  .\scripts\run-dev.ps1

  # force mock data (no upstream calls)
  .\scripts\run-dev.ps1 -Mock

  # run frontend dev server (hot reload) and backend; open two terminals
  .\scripts\run-dev.ps1 -Dev

Options:
  -Mock   Set USE_MOCK=true so backend returns generated mock data (good for offline/dev)
  -Dev    Start frontend dev server (`npm run dev`) in a new PowerShell window instead of building
  -NoBuild Skip building frontend when not using dev mode

#> 
param(
  [switch]$Mock,
  [switch]$Dev,
  [switch]$NoBuild
)

function Write-Info($m){ Write-Host "[run-dev] $m" -ForegroundColor Cyan }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

if ($Mock) { Write-Info 'Mock mode enabled (USE_MOCK=true)'; $env:USE_MOCK = 'true' } else { Remove-Item env:USE_MOCK -ErrorAction SilentlyContinue }

if (-not $Dev) {
  if (-not $NoBuild) {
    Write-Info 'Building frontend to Backend/public (production build)...'
    Push-Location (Join-Path $root '..\Frontend')
    npm install | Out-Null
    npm run build
    Pop-Location
  }
  Write-Info 'Starting backend (node server.js) in background...'
  Push-Location (Join-Path $root '..\Backend')
  Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory (Get-Location) -NoNewWindow -PassThru | Out-Null
  Pop-Location
  Write-Info 'Backend started. Open http://localhost:4000'
} else {
  # Dev mode: start backend in one background process and frontend dev server in a new terminal
  Write-Info 'Starting backend for dev (node server.js)'
  Push-Location (Join-Path $root '..\Backend')
  Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory (Get-Location) -NoNewWindow -PassThru | Out-Null
  Pop-Location

  Write-Info 'Starting frontend dev server in a new PowerShell window (npm run dev)'
  $psCmd = "cd '$($root)\..\Frontend'; npm install; npm run dev"
  Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$psCmd -WindowStyle Normal
  Write-Info 'Frontend dev server started in a new window (http://localhost:5173)'
}

Pop-Location

Write-Info 'run-dev helper finished.'
