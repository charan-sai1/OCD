# Verifies what actually landed on the drives after a phone send.
# Usage: powershell -ExecutionPolicy Bypass -File tools\check-uploads.ps1 [-Drive E:,F:]
param(
  [string[]]$Drive = @('E:\', 'F:\')
)

$ErrorActionPreference = 'Continue'

foreach ($root in $Drive) {
  Write-Output "== $root"
  if (-not (Test-Path $root)) { Write-Output "  not connected"; continue }

  $phone = Join-Path $root 'Phone'
  if (Test-Path $phone) {
    $files = Get-ChildItem $phone -Recurse -File
    Write-Output ("  Phone files: {0}  ({1:N1} MB)" -f $files.Count, (($files | Measure-Object Length -Sum).Sum / 1MB))
    $files | Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
      ForEach-Object { Write-Output ("  {0}  {1,10:N0}  {2}" -f $_.LastWriteTime.ToString('HH:mm:ss'), $_.Length, $_.FullName.Substring($root.Length)) }
  }
  else {
    Write-Output "  Phone folder: missing"
  }

  $audit = Join-Path $root '.ocd\audit.jsonl'
  if (Test-Path $audit) {
    $rows = Get-Content $audit | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }
    Write-Output ("  audit rows: {0}" -f $rows.Count)
    $rows | Select-Object -Last 5 | ForEach-Object {
      Write-Output ("  op={0} verified={1} size={2} sha={3} {4}" -f $_.op, $_.verified, $_.size, ($_.sha256 -replace '^(.{12}).*', '$1...'), $_.path)
    }
  }
  else {
    Write-Output "  audit.jsonl: missing"
  }

  $staging = Join-Path $root '.ocd-incoming'
  if ($staging -and (Test-Path $staging)) {
    $leftovers = Get-ChildItem $staging -Recurse -File -ErrorAction SilentlyContinue
    Write-Output ("  staging leftovers: {0}" -f $leftovers.Count)
    $leftovers | ForEach-Object { Write-Output ("    {0}" -f $_.Name) }
  }
  else {
    Write-Output "  staging leftovers: none"
  }
}
