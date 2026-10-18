# Stops OCD Manager and the Photofield gallery.
Get-Process ocd -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process photofield -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Stopped OCD Manager and Photofield."
