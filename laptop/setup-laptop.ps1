<#
  Priyatham Health · laptop setup
  Makes ActivityWatch on this Windows laptop readable by the phone app over home Wi-Fi,
  and keeps it running hidden in the background from every login.

  Run in a NORMAL (not Administrator) PowerShell window:
      powershell -ExecutionPolicy Bypass -File .\setup-laptop.ps1

  It does NOT change Windows security settings. At the end it prints the two steps you do yourself
  (network profile = Private, and one firewall rule).
#>
$ErrorActionPreference = "Stop"
$awDir   = "$env:LOCALAPPDATA\Programs\ActivityWatch"
$awExe   = Join-Path $awDir "aw-qt.exe"
$cfgRoot = "$env:LOCALAPPDATA\activitywatch\activitywatch"
$home2   = "$env:LOCALAPPDATA\PriyathamHealth"
$startup = [Environment]::GetFolderPath("Startup")

function Step($t) { Write-Host "`n== $t" -ForegroundColor Yellow }
function Ok($t)   { Write-Host "   OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   !!  $t" -ForegroundColor Red }
function Write-NoBom($path, $text) { [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false))) }
function Stop-AW { Get-Process aw-qt, aw-server, aw-server-rust, aw-watcher-afk, aw-watcher-window -ErrorAction SilentlyContinue | Stop-Process -Force }

# 1. ActivityWatch installed?
Step "1/5  ActivityWatch"
if (-not (Test-Path $awExe)) {
    Warn "ActivityWatch is not installed."
    Write-Host "   Download (free): https://github.com/ActivityWatch/activitywatch/releases/latest"
    Write-Host "   Install it, start it once, then run this script again."
    exit 1
}
Ok "found $awExe"
if (-not (Test-Path $cfgRoot)) {
    Write-Host "   First start to create config files..."
    Start-Process $awExe -WindowStyle Hidden; Start-Sleep 15
}

# 2. Listen on the home network
Step "2/5  Allow the phone to connect (listen on 0.0.0.0)"
$py   = Join-Path $cfgRoot "aw-server\aw-server.toml"
$rust = Join-Path $cfgRoot "aw-server-rust\config.toml"
if (Test-Path $py) {
    Copy-Item $py "$py.bak" -Force
    $t = (Get-Content $py -Raw).TrimStart([char]0xFEFF)
    if ($t -match '(?m)^#?\s*host\s*=') { $t = $t -replace '(?m)^#?\s*host\s*=\s*"[^"]*"', 'host = "0.0.0.0"' }
    else { $t = $t -replace '(?m)^\[server\]\s*$', "[server]`r`nhost = `"0.0.0.0`"" }
    Write-NoBom $py $t
    Ok "aw-server.toml -> host = 0.0.0.0 (backup: aw-server.toml.bak)"
}
if (Test-Path (Split-Path $rust)) {
    $t = if (Test-Path $rust) { (Get-Content $rust -Raw).TrimStart([char]0xFEFF) } else { "" }
    if ($t -match '(?m)^#?\s*address\s*=') { $t = $t -replace '(?m)^#?\s*address\s*=\s*"[^"]*"', 'address = "0.0.0.0"' }
    else { $t = "address = `"0.0.0.0`"`r`nport = 5600`r`n" + $t }
    Write-NoBom $rust $t
    Ok "aw-server-rust config.toml -> address = 0.0.0.0"
}

# 3. Keep-alive helper, hidden at every login
Step "3/5  Start hidden at login"
New-Item -ItemType Directory -Force $home2 | Out-Null
Copy-Item (Join-Path $PSScriptRoot "aw-keepalive.ps1") (Join-Path $home2 "aw-keepalive.ps1") -Force
$vbs = Join-Path $startup "PriyathamHealth-ActivityWatch.vbs"
$line = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + (Join-Path $home2 "aw-keepalive.ps1") + '""", 0, False'
Set-Content -Path $vbs -Value $line -Encoding ascii
$lnk = Join-Path $startup "ActivityWatch.lnk"
if (Test-Path $lnk) { Move-Item $lnk (Join-Path $home2 "ActivityWatch-startup-backup.lnk") -Force; Ok "moved ActivityWatch's own startup shortcut (avoids double start)" }
Ok "startup launcher: $vbs"

# 4. Restart and verify
Step "4/5  Restart ActivityWatch"
Stop-AW; Start-Sleep 3
Start-Process wscript.exe -ArgumentList "`"$vbs`""
$bind = $null
for ($i = 0; $i -lt 12 -and -not $bind; $i++) { Start-Sleep 3; $bind = (Get-NetTCPConnection -LocalPort 5600 -State Listen -ErrorAction SilentlyContinue).LocalAddress }
if ($bind -contains "0.0.0.0" -or $bind -contains "::") { Ok "listening on $($bind -join ', ')" }
elseif ($bind) { Warn "only listening on $($bind -join ', '). Re-run this script; if it persists, check the log in $cfgRoot\Logs" }
else { Warn "not listening yet. Check the ActivityWatch tray icon and $cfgRoot\Logs\aw-server" }

# 5. What you do yourself
Step "5/5  Your part (security settings)"
$ip  = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match "Wi-Fi|Wireless" -and $_.IPAddress -notmatch "^169" }).IPAddress
$net = Get-NetConnectionProfile | Select-Object -First 1
if ($net.NetworkCategory -ne "Private") { Warn "Wi-Fi '$($net.Name)' is $($net.NetworkCategory). Set it to Private: Settings > Network & internet > Wi-Fi > your network." } else { Ok "Wi-Fi '$($net.Name)' is Private" }
if (-not (Get-NetFirewallRule -DisplayName "ActivityWatch (home Wi-Fi)" -ErrorAction SilentlyContinue)) {
    Warn "Firewall rule missing. In Terminal (Admin) run:"
    Write-Host '   New-NetFirewallRule -DisplayName "ActivityWatch (home Wi-Fi)" -Direction Inbound -Protocol TCP -LocalPort 5600 -Action Allow -Profile Private' -ForegroundColor Cyan
} else { Ok "firewall rule present" }

Write-Host "`nDone. In the phone app: Insights > Connect laptops > IP $ip, port 5600 > Test & add." -ForegroundColor Green
Write-Host "Check from the phone's browser first: http://$($ip):5600"
