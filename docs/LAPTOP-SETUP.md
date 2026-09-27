# Connect your laptops (screen time)

[← Back to README](../README.md)

The phone app can add your **Windows laptops'** screen time to its Insights. Each laptop runs **[ActivityWatch](https://activitywatch.net)**, which is free and open source and records which apps you use, locally. When the phone and a laptop are on the **same Wi-Fi**, the app asks the laptop for today's totals.

```text
 Laptop 1 (ActivityWatch :5600) ──┐
                                  ├── home Wi-Fi ──►  📱 Priyatham Health → Insights
 Laptop 2 (ActivityWatch :5600) ──┘
```

- [Quick setup (script)](#quick-setup-script)
- [Manual setup](#manual-setup)
- [Connect in the app](#connect-in-the-app)
- [Auto-start and self-healing](#auto-start-and-self-healing)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Quick setup (script)

Do this on **each** laptop.

1. **Install ActivityWatch**: download the Windows installer from the [latest release](https://github.com/ActivityWatch/activitywatch/releases/latest) (`activitywatch-vX.Y.Z-windows-x86_64-setup.exe`), install it and start it once.
2. **Get this repo** onto the laptop: `git clone https://github.com/priyathamtella/priyatham-health.git`, or **Code → Download ZIP** and extract it.
3. Open a **normal** PowerShell window (not *Run as administrator*) in the repo folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\laptop\setup-laptop.ps1
   ```
   The script:
   - sets ActivityWatch to listen on your network (`host = "0.0.0.0"`), keeping a `.bak` backup of the config;
   - installs a **hidden auto-start helper** (no windows at login; see below);
   - restarts ActivityWatch and checks it's reachable;
   - prints this laptop's **IP address**, plus any step you still need to do.
4. **Your two security steps** (the script never changes these for you):
   - **Wi-Fi → Private**: *Settings → Network & internet → Wi-Fi → your network → Network profile type → **Private***.
   - **Firewall rule**: right-click Start → **Terminal (Admin)** → paste:
     ```powershell
     New-NetFirewallRule -DisplayName "ActivityWatch (home Wi-Fi)" -Direction Inbound -Protocol TCP -LocalPort 5600 -Action Allow -Profile Private
     ```
5. **Test from the phone**: on the same Wi-Fi, open `http://<laptop-IP>:5600` in Chrome. You should see the ActivityWatch dashboard.

---

## Manual setup

If you'd rather not run the script:

1. Install and start ActivityWatch (step 1 above).
2. Quit it: tray icon → **Quit ActivityWatch**.
3. Edit the server config. Press **Win + R** and run:
   ```text
   notepad %LOCALAPPDATA%\activitywatch\activitywatch\aw-server\aw-server.toml
   ```
   Under `[server]`, change `#host = "localhost"` to:
   ```toml
   [server]
   host = "0.0.0.0"
   ```
   *(If your install uses the Rust server, meaning an `aw-server-rust` folder exists, put `address = "0.0.0.0"` in `aw-server-rust\config.toml` instead.)*
   > ⚠️ Save as **UTF-8 without BOM**. Notepad does this by default. PowerShell 5's `Set-Content -Encoding utf8` does **not**, and the server then fails to start.
4. Do the two security steps from the quick setup.
5. Start ActivityWatch again, and check that it listens on all addresses:
   ```powershell
   Get-NetTCPConnection -LocalPort 5600 -State Listen | Select LocalAddress   # should show 0.0.0.0
   ```
6. Find the IP: `ipconfig` → **IPv4 Address** under *Wireless LAN adapter Wi-Fi*.

---

## Connect in the app

1. **Insights → + Connect your 2 laptops** (or *Settings → Laptops*).
2. Name (e.g. `Laptop 1`), the **IP**, port **5600** → **Test & add**. You should see *"Connected to &lt;hostname&gt;"*.
3. Insights syncs automatically when opened. Each device card shows *synced 1:25 pm*, or the reason it couldn't connect. Tap **Refresh** any time.
4. Repeat for the second laptop.

**What's counted:** only time you're actively using the laptop (ActivityWatch's AFK watcher removes idle time), per app, since ActivityWatch was installed. Tap an app in *Top apps* to switch it between work, leisure and other.

---

## Auto-start and self-healing

`setup-laptop.ps1` installs:

| File | Location | Purpose |
|---|---|---|
| `aw-keepalive.ps1` | `%LOCALAPPDATA%\PriyathamHealth\` | Starts ActivityWatch hidden. Every ~10 min it checks that it's running and reachable from the network, and restarts it if not. Logs to `%LOCALAPPDATA%\activitywatch\priyatham-keepalive.log`. |
| `PriyathamHealth-ActivityWatch.vbs` | Startup folder (`shell:startup`) | Launches the helper at login with **no visible window**. |
| `ActivityWatch-startup-backup.lnk` | `%LOCALAPPDATA%\PriyathamHealth\` | ActivityWatch's own startup shortcut, moved here so it doesn't start twice. |

To remove it: `powershell -ExecutionPolicy Bypass -File .\laptop\uninstall-autostart.ps1`

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Phone shows **ERR_CONNECTION_REFUSED** | ActivityWatch is only listening on `127.0.0.1`. Re-run `setup-laptop.ps1`, or restart ActivityWatch and check with `Get-NetTCPConnection -LocalPort 5600 -State Listen`. |
| Phone **times out** / *Not reachable* | Different Wi-Fi, laptop asleep, Wi-Fi not set to *Private*, or firewall rule missing. |
| Nothing listening on 5600 after editing the config | The config was saved **with a BOM** or has a typo. Re-run the script (it rewrites the file without a BOM) and check `%LOCALAPPDATA%\activitywatch\activitywatch\Logs\aw-server\`. |
| Laptop card shows little or no time | ActivityWatch only records from when it was installed, and only while you're active. Tap **Refresh**. |
| IP changed after a router restart | Run `ipconfig`, then remove and re-add the laptop in the app. Better: reserve the IP in your router (*DHCP reservation / Address reservation*). |
| Firewall rule shows *EnforcementStatus: NotApplicable* | Normal while the network is *Public*. Set Wi-Fi to *Private*. |

---

## Security notes

- The firewall rule opens port 5600 **only on Private networks**, so on café or office Wi-Fi (Public) the laptop stays closed.
- On your home Wi-Fi, **any device** on that network could read the laptop's ActivityWatch data. Only enable this on a network you trust.
- ActivityWatch logs a warning that its host-header check is disabled when it listens on `0.0.0.0`. This is expected for LAN access.
