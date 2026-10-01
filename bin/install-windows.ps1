# Installs the Win+R "llm-monitor" command and the login autostart (HKCU only, no admin). Idempotent.
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'llm-monitor.vbs'
if (-not (Test-Path $vbs)) { throw "Missing $vbs" }
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

# Win+R: App Paths entry
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\llm-monitor.exe'
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value $vbs
Write-Host "App Paths set: $key -> $vbs"

# Login: Startup shortcut, hidden, no browser
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\LLM Monitor.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $wscript
$s.Arguments = "`"$vbs`" --no-open"
$s.WorkingDirectory = $PSScriptRoot
$s.WindowStyle = 7
$s.Description = 'Starts LLM Monitor hidden at login'
$s.Save()
Write-Host "Startup shortcut: $lnk"
Write-Host "Done. Press Win+R and type: llm-monitor"
