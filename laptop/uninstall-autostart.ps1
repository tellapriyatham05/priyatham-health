# Priyatham Health · removes the hidden keep-alive helper and restores ActivityWatch's own startup shortcut.
$startup = [Environment]::GetFolderPath("Startup")
$home2 = "$env:LOCALAPPDATA\PriyathamHealth"
Remove-Item (Join-Path $startup "PriyathamHealth-ActivityWatch.vbs") -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -match "aw-keepalive" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$backup = Join-Path $home2 "ActivityWatch-startup-backup.lnk"
if (Test-Path $backup) { Move-Item $backup (Join-Path $startup "ActivityWatch.lnk") -Force }
Write-Host "Auto-start helper removed. ActivityWatch itself is still installed."
