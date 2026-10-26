# Removes the shortcuts created by install-autostart.ps1 and stops a running server.
#
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1

$paths = @(
    (Join-Path ([Environment]::GetFolderPath("Startup")) "Music Archive Server.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Music Archive.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Music Archive.lnk")
)
foreach ($p in $paths) {
    if (Test-Path $p) { Remove-Item $p; Write-Host "removed $p" }
}

Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; Write-Host "stopped server (pid $($_.OwningProcess))" }
