# Builds OCD Manager for every supported platform into ./dist
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$out = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Force $out | Out-Null

# Pure-Go, no cgo -> single static binaries, no toolchain needed on the target.
$env:CGO_ENABLED = "0"

$targets = @(
    @{ os = "windows"; arch = "amd64"; ext = ".exe" },
    @{ os = "windows"; arch = "arm64"; ext = ".exe" },
    @{ os = "linux";   arch = "amd64"; ext = "" },
    @{ os = "linux";   arch = "arm64"; ext = "" },
    @{ os = "darwin";  arch = "amd64"; ext = "" },
    @{ os = "darwin";  arch = "arm64"; ext = "" }
)

foreach ($t in $targets) {
    $env:GOOS = $t.os
    $env:GOARCH = $t.arch
    $name = "ocd-$($t.os)-$($t.arch)$($t.ext)"
    Write-Host "building $name"
    go build -trimpath -ldflags "-s -w" -o (Join-Path $out $name) .
}

Write-Host "`nDone. Binaries in ${out}:"
Get-ChildItem $out | Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
