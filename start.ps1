# One-click launcher for OCD Manager (+ Photofield gallery).
#   powershell -ExecutionPolicy Bypass -File start.ps1
$ErrorActionPreference = "Stop"
$root   = $PSScriptRoot
$engine = Join-Path $root "engine"

# Prefer a locally built binary, fall back to the shipping Windows build.
$exe = Join-Path $engine "ocd.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $engine "dist\ocd-windows-amd64.exe" }
if (-not (Test-Path $exe)) {
    Write-Error "ocd.exe not found. Build it first:  cd engine; .\build.ps1"
}

$photofield = Join-Path $root "photofield\photofield.exe"

# Already running?
if (Get-Process ocd -ErrorAction SilentlyContinue) {
    Write-Host "OCD Manager is already running -> http://localhost:8090"
    Start-Process "http://localhost:8090"
    exit 0
}

Write-Host "Starting OCD Manager..."
Start-Process -FilePath $exe -WindowStyle Hidden -ArgumentList @(
    "serve",
    "--port", "8090",
    "--data", (Join-Path $root "engine-data"),
    "--photofield", $photofield,
    "--photofield-data", (Join-Path $root "data")
)

Start-Sleep -Seconds 2
Write-Host "Open http://localhost:8090  (Browse tab starts the gallery)"
Start-Process "http://localhost:8090"
