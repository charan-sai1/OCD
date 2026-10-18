# Allows phones on your Wi-Fi to reach the apps. RUN AS ADMINISTRATOR.
#   powershell -ExecutionPolicy Bypass -File allow-lan.ps1
$ErrorActionPreference = "Stop"

foreach ($port in 8090, 8080) {
    $name = "OCD Manager ($port)"
    if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $port -Profile Private | Out-Null
        Write-Host "Added firewall rule for TCP $port (private networks)"
    } else {
        Write-Host "Rule for TCP $port already exists"
    }
}

Write-Host "`nFind this PC's address with:  ipconfig"
Write-Host "Then open from your phone:    http://<PC-IP>:8090"
