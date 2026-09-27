# Priyatham Health: keeps ActivityWatch running in the background and reachable from the phone.
# Started hidden at login by aw-keepalive.vbs in the Startup folder. No windows are shown.
$exe = "$env:LOCALAPPDATA\Programs\ActivityWatch\aw-qt.exe"
$log = "$env:LOCALAPPDATA\activitywatch\priyatham-keepalive.log"

function Write-Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -FilePath $log -Append -Encoding utf8 }
function Get-Bind { Get-NetTCPConnection -LocalPort 5600 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress }
function Restart-AW {
    Get-Process aw-qt, aw-server, aw-watcher-afk, aw-watcher-window -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Start-Process -FilePath $exe -WindowStyle Hidden
}

# only one copy of this helper at a time
$mutex = New-Object System.Threading.Mutex($false, "Global\PriyathamAWKeepAlive")
if (-not $mutex.WaitOne(0)) { exit }

Write-Log "started"
if (-not (Get-Process aw-qt -ErrorAction SilentlyContinue)) { Start-Process -FilePath $exe -WindowStyle Hidden }

while ($true) {
    Start-Sleep -Seconds 60
    $bind = Get-Bind
    if (-not (Get-Process aw-qt -ErrorAction SilentlyContinue)) {
        Write-Log "ActivityWatch not running, starting it"
        Start-Process -FilePath $exe -WindowStyle Hidden
    } elseif ($bind -and -not ($bind -contains "0.0.0.0")) {
        Write-Log "server only on $($bind -join ','), restarting so the phone can connect"
        Restart-AW
    }
    Start-Sleep -Seconds 540   # check every ~10 minutes
}
