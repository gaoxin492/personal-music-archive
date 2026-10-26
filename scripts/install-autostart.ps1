# Starts the Music Archive server in the background at Windows sign-in (no window),
# and puts a "Music Archive" app shortcut on the desktop and in the Start menu.
# Undo with scripts\uninstall-autostart.ps1.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$icon = Join-Path $root "frontend\public\icon.ico"
$launcher = Join-Path $root "scripts\launch.py"

$python = (Get-Command python -ErrorAction Stop).Source
$pythonw = Join-Path (Split-Path $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe not found next to $python" }

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut($path, $target, $arguments, $workdir, $description) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $target
    $lnk.Arguments = $arguments
    $lnk.WorkingDirectory = $workdir
    $lnk.IconLocation = $icon
    $lnk.Description = $description
    $lnk.Save()
    Write-Host "created $path"
}

$startup = [Environment]::GetFolderPath("Startup")
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")

New-Shortcut (Join-Path $startup "Music Archive Server.lnk") $pythonw "-m app" $backend "Music Archive background server"
New-Shortcut (Join-Path $desktop "Music Archive.lnk") $pythonw "`"$launcher`"" $root "Open Music Archive"
New-Shortcut (Join-Path $programs "Music Archive.lnk") $pythonw "`"$launcher`"" $root "Open Music Archive"
