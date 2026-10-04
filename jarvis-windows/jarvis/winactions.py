"""Things JARVIS can do on Windows. Every function fails softly (returns False) instead of raising."""
import ctypes
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

from .parser import score

IS_WINDOWS = os.name == "nt"
CREATE_NO_WINDOW = 0x08000000
HOME = os.path.expanduser("~")

WEBSITES = {
    "youtube": "https://www.youtube.com", "google": "https://www.google.com", "gmail": "https://mail.google.com",
    "github": "https://github.com", "linkedin": "https://www.linkedin.com", "instagram": "https://www.instagram.com",
    "whatsapp": "https://web.whatsapp.com", "whatsapp web": "https://web.whatsapp.com", "netflix": "https://www.netflix.com",
    "amazon": "https://www.amazon.in", "flipkart": "https://www.flipkart.com", "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com", "drive": "https://drive.google.com", "google drive": "https://drive.google.com",
    "chatgpt": "https://chat.openai.com", "claude": "https://claude.ai", "facebook": "https://www.facebook.com",
    "twitter": "https://x.com", "x": "https://x.com", "spotify web": "https://open.spotify.com", "wikipedia": "https://www.wikipedia.org",
    "stack overflow": "https://stackoverflow.com", "calendar": "https://calendar.google.com", "news": "https://news.google.com",
}
ALIASES = {
    "vs code": "visual studio code", "code": "visual studio code", "vscode": "visual studio code",
    "terminal": "terminal", "command prompt": "command prompt", "cmd": "command prompt", "powershell": "windows powershell",
    "explorer": "file explorer", "files": "file explorer", "file manager": "file explorer", "my computer": "this pc",
    "browser": "google chrome", "chrome": "google chrome", "edge": "microsoft edge", "word": "word", "excel": "excel",
    "powerpoint": "powerpoint", "store": "microsoft store", "calculator": "calculator", "notepad": "notepad",
    "paint": "paint", "camera": "camera", "photos": "photos", "task manager": "task manager", "control panel": "control panel",
    "spotify": "spotify", "teams": "microsoft teams", "outlook": "outlook", "telegram": "telegram",
}
BUILTIN = {  # always-available Windows commands
    "notepad": "notepad.exe", "calculator": "calc.exe", "paint": "mspaint.exe", "task manager": "taskmgr.exe",
    "command prompt": "cmd.exe", "control panel": "control.exe", "file explorer": "explorer.exe",
    "this pc": "explorer.exe shell:MyComputerFolder", "windows powershell": "powershell.exe",
    "camera": "start microsoft.windows.camera:", "snipping tool": "snippingtool.exe", "settings": "start ms-settings:",
}
FOLDERS = {
    "downloads": "Downloads", "download": "Downloads", "documents": "Documents", "desktop": "Desktop",
    "pictures": "Pictures", "photos folder": "Pictures", "music": "Music", "videos": "Videos", "screenshots": "Pictures/Screenshots",
}
SETTINGS = {
    "wifi": "network-wifi", "internet": "network-wifi", "network": "network-status", "bluetooth": "bluetooth",
    "display": "display", "brightness": "display", "sound": "sound", "volume": "sound", "night light": "nightlight",
    "airplane": "network-airplanemode", "battery": "batterysaver", "power": "powersleep", "update": "windowsupdate",
    "updates": "windowsupdate", "windows update": "windowsupdate", "apps": "appsfeatures", "storage": "storagesense",
    "notifications": "notifications", "personalization": "personalization", "wallpaper": "personalization-background",
    "background": "personalization-background", "mouse": "mousetouchpad", "keyboard": "typing", "privacy": "privacy",
    "accounts": "yourinfo", "time": "dateandtime", "date": "dateandtime", "language": "regionlanguage", "": "",
}


def run(cmd, wait=False, timeout=15):
    try:
        if wait:
            return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout,
                                  creationflags=CREATE_NO_WINDOW if IS_WINDOWS else 0)
        subprocess.Popen(cmd, shell=isinstance(cmd, str), creationflags=CREATE_NO_WINDOW if IS_WINDOWS else 0)
        return True
    except Exception:
        return None


def powershell(script, timeout=15):
    r = run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], wait=True, timeout=timeout)
    return r.stdout.strip() if r and r.returncode == 0 else None


def open_path(path):
    try:
        os.startfile(path)  # type: ignore[attr-defined]
        return True
    except Exception:
        return bool(run(f'start "" "{path}"'))


def open_url(url):
    if not url.startswith("http"):
        url = "https://" + url.replace(" dot ", ".").replace(" ", "")
    return webbrowser.open(url)


# ---------------------------------------------------------------- app index

class Apps:
    """Start-menu shortcuts and Store apps, indexed once in the background."""

    def __init__(self):
        self.items = {}   # label(lower) -> ("lnk", path) | ("uwp", appid)
        self.ready = threading.Event()
        threading.Thread(target=self._index, daemon=True).start()

    def _index(self):
        items = {}
        roots = [os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), r"Microsoft\Windows\Start Menu\Programs"),
                 os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs"),
                 os.path.join(HOME, "Desktop"), os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "Desktop")]
        for root in roots:
            for path in glob.glob(os.path.join(root, "**", "*.lnk"), recursive=True):
                label = os.path.splitext(os.path.basename(path))[0].lower()
                if "uninstall" in label or "readme" in label:
                    continue
                items.setdefault(label, ("lnk", path))
        if IS_WINDOWS:
            out = powershell("Get-StartApps | ConvertTo-Json -Compress", timeout=25)
            try:
                for a in json.loads(out) if out else []:
                    items.setdefault(a["Name"].lower(), ("uwp", a["AppID"]))
            except (ValueError, TypeError, KeyError):
                pass
        self.items = items
        self.ready.set()

    def find(self, spoken):
        self.ready.wait(8)
        want = ALIASES.get(spoken.lower().strip(), spoken.lower().strip())
        best, best_score = None, 0.0
        for label, target in self.items.items():
            s = score(want, label)
            if s > best_score:
                best, best_score = (label, target), s
        if want in BUILTIN and best_score < 0.95:
            return want, ("cmd", BUILTIN[want]), 1.0
        return (best[0], best[1], best_score) if best and best_score >= 0.8 else None

    @staticmethod
    def launch(target):
        kind, value = target
        if kind == "lnk":
            return open_path(value)
        if kind == "uwp":
            return bool(run(f'explorer.exe "shell:AppsFolder\\{value}"'))
        return bool(run(value))


# ---------------------------------------------------------------- folders and projects

PROJECT_ROOTS = ["Documents", "Desktop", "Downloads", "Projects", "projects", "Code", "code", "dev", "workspace",
                 "source/repos", "OneDrive/Documents", "OneDrive/Desktop", "PycharmProjects", "IdeaProjects", "StudioProjects"]


def known_folder(name):
    sub = FOLDERS.get(name.lower().strip())
    if sub:
        for base in (HOME, os.path.join(HOME, "OneDrive")):
            p = os.path.join(base, sub)
            if os.path.isdir(p):
                return p
    return None


def find_folder(name, extra=None):
    """Finds a project/folder by spoken name in the usual places (two levels deep) and on other drives."""
    candidates = dict(extra or {})
    roots = [os.path.join(HOME, r) for r in PROJECT_ROOTS]
    if IS_WINDOWS:
        roots += [f"{d}:\\" for d in "DEFG" if os.path.isdir(f"{d}:\\")]
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            for entry in os.scandir(root):
                if entry.is_dir() and not entry.name.startswith((".", "$")):
                    candidates.setdefault(entry.name.lower(), entry.path)
                    if root.endswith(":\\") or os.path.basename(root).lower() in ("projects", "code", "dev", "workspace", "repos"):
                        try:
                            for sub in os.scandir(entry.path):
                                if sub.is_dir() and not sub.name.startswith((".", "$")):
                                    candidates.setdefault(sub.name.lower(), sub.path)
                        except OSError:
                            pass
        except OSError:
            continue
    best, best_score = None, 0.0
    for label, path in candidates.items():
        s = score(name, label)
        if s > best_score:
            best, best_score = path, s
    return best if best_score >= 0.82 else None


def vscode():
    exe = shutil.which("code")
    if exe:
        return exe
    for p in (os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Programs\Microsoft VS Code\Code.exe"),
              r"C:\Program Files\Microsoft VS Code\Code.exe"):
        if os.path.exists(p):
            return p
    return None


def open_project(path, in_editor=True):
    code = vscode() if in_editor else None
    if code:
        return bool(run([code, path]))
    return open_path(path)


def open_terminal(cwd=None):
    if shutil.which("wt"):
        return bool(run(["wt", "-d", cwd or HOME]))
    return bool(run(f'start "" cmd /K "cd /d {cwd or HOME}"'))


# ---------------------------------------------------------------- web

def youtube(query, autoplay=True):
    q = urllib.parse.quote_plus(query)
    if autoplay:
        try:
            req = urllib.request.Request(f"https://www.youtube.com/results?search_query={q}", headers={"User-Agent": "Mozilla/5.0"})
            html = urllib.request.urlopen(req, timeout=4).read().decode("utf-8", "ignore")
            m = re.search(r'"videoId":"([\w-]{11})"', html)
            if m:
                return webbrowser.open(f"https://www.youtube.com/watch?v={m.group(1)}")
        except Exception:
            pass
    return webbrowser.open(f"https://www.youtube.com/results?search_query={q}")


def google(query):
    return webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote_plus(query))


def spotify(query):
    if IS_WINDOWS and (shutil.which("spotify") or os.path.isdir(os.path.join(os.environ.get("APPDATA", ""), "Spotify"))):
        return open_path("spotify:search:" + urllib.parse.quote(query))
    return False


def settings_page(which):
    key = (which or "").lower().strip()
    page = SETTINGS.get(key)
    if page is None:
        page = next((v for k, v in SETTINGS.items() if k and k in key), "")
    return bool(run(f"start ms-settings:{page}"))


# ---------------------------------------------------------------- keyboard

KEYS = {"ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B, "tab": 0x09, "enter": 0x0D, "esc": 0x1B,
        "pagedown": 0x22, "pageup": 0x21, "up": 0x26, "down": 0x28, "f4": 0x73, "prtsc": 0x2C, "d": 0x44,
        "playpause": 0xB3, "next": 0xB0, "prev": 0xB1, "volup": 0xAF, "voldown": 0xAE, "mute": 0xAD}


def keys(combo):
    """Press a key combination like "ctrl+t" or "win+d"."""
    if not IS_WINDOWS:
        return False
    user32 = ctypes.windll.user32
    codes = []
    for k in combo.lower().split("+"):
        codes.append(KEYS.get(k) or ord(k.upper()))
    for c in codes:
        user32.keybd_event(c, 0, 0, 0)
    for c in reversed(codes):
        user32.keybd_event(c, 0, 2, 0)
    return True


def media(action):
    return keys({"pause": "playpause", "play": "playpause", "next": "next", "previous": "prev"}[action])


def type_text(text):
    """Types text into whatever has focus, character by character (Unicode)."""
    if not IS_WINDOWS:
        return False
    from ctypes import wintypes

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

    class INPUT(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _U)]

    for ch in text:
        for flags in (0x0004, 0x0004 | 0x0002):  # KEYEVENTF_UNICODE, then key up
            inp = INPUT(type=1)
            inp.ki = KEYBDINPUT(0, ord(ch), flags, 0, None)
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
        time.sleep(0.004)
    return True


# ---------------------------------------------------------------- volume and brightness

def _endpoint():
    from pycaw.pycaw import AudioUtilities
    dev = AudioUtilities.GetSpeakers()
    return dev.EndpointVolume


def get_volume():
    try:
        return round(_endpoint().GetMasterVolumeLevelScalar() * 100)
    except Exception:
        return None


def set_volume(percent):
    try:
        ep = _endpoint()
        ep.SetMute(0, None)
        ep.SetMasterVolumeLevelScalar(max(0, min(100, percent)) / 100.0, None)
        return True
    except Exception:
        return False


def duck_other_apps(factor=0.3):
    """Turns every other app's audio (YouTube, Spotify, games) down while JARVIS listens.
    Returns what to restore. JARVIS's own voice is left alone."""
    saved = []
    try:
        from pycaw.pycaw import AudioUtilities
        me = os.getpid()
        for session in AudioUtilities.GetAllSessions():
            proc = session.Process
            if proc is None or proc.pid == me:
                continue
            vol = session.SimpleAudioVolume
            level = vol.GetMasterVolume()
            if level > 0.05:
                saved.append((proc.pid, level))
                vol.SetMasterVolume(max(0.02, level * factor), None)
    except Exception:
        pass
    return saved


def restore_other_apps(saved):
    if not saved:
        return
    try:
        from pycaw.pycaw import AudioUtilities
        levels = dict(saved)
        for session in AudioUtilities.GetAllSessions():
            proc = session.Process
            if proc is not None and proc.pid in levels:
                session.SimpleAudioVolume.SetMasterVolume(levels[proc.pid], None)
    except Exception:
        pass


def set_mute(on):
    try:
        _endpoint().SetMute(1 if on else 0, None)
        return True
    except Exception:
        return keys("mute")


def get_brightness():
    try:
        import screen_brightness_control as sbc
        return sbc.get_brightness(display=0)[0]
    except Exception:
        return None


def set_brightness(percent):
    try:
        import screen_brightness_control as sbc
        sbc.set_brightness(max(1, min(100, percent)))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- radios (Wi-Fi / Bluetooth), no admin needed

RADIO_SCRIPT = r"""
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
Function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$r = $radios | ? { $_.Kind -eq '__KIND__' } | Select-Object -First 1
if (-not $r) { 'none'; exit }
$want = '__STATE__'
if ($want -eq 'toggle') { if ($r.State -eq 'On') { $want = 'Off' } else { $want = 'On' } }
[Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
Await ($r.SetStateAsync($want)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$want
"""


def set_radio(kind, state):
    """kind: WiFi | Bluetooth, state: on | off | toggle. Returns the new state ("On"/"Off") or None."""
    script = RADIO_SCRIPT.replace("__KIND__", kind).replace("__STATE__", {"on": "On", "off": "Off"}.get(state, "toggle"))
    out = powershell(script, timeout=20)
    if not out or out.endswith("none"):
        return None
    return out.splitlines()[-1].strip()


# ---------------------------------------------------------------- power and misc

def power(action):
    cmds = {"lock": "rundll32.exe user32.dll,LockWorkStation", "sleep": "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
            "shutdown": "shutdown /s /t 5", "restart": "shutdown /r /t 5", "logoff": "shutdown /l"}
    return bool(run(cmds[action]))


def close_app(name):
    """Closes running apps whose process or window title matches the spoken name."""
    import psutil
    want = ALIASES.get(name.lower(), name.lower())
    exe_names = {"google chrome": "chrome", "visual studio code": "code", "microsoft edge": "msedge", "file explorer": None,
                 "spotify": "spotify", "word": "winword", "excel": "excel", "powerpoint": "powerpnt", "notepad": "notepad",
                 "microsoft teams": "ms-teams", "terminal": "windowsterminal", "command prompt": "cmd"}
    target = exe_names.get(want, want.replace(" ", ""))
    if not target:
        return 0
    killed = 0
    for p in psutil.process_iter(["name", "pid"]):
        pname = (p.info["name"] or "").lower().replace(".exe", "")
        if pname and (pname == target or score(target, pname) >= 0.88):
            try:
                p.terminate()
                killed += 1
            except Exception:
                pass
    return killed


def empty_recycle_bin():
    try:
        ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 7)
        return True
    except Exception:
        return False


def ip_address():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def set_startup(enabled, exe_path):
    if not IS_WINDOWS:
        return False
    import winreg
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    try:
        if enabled:
            winreg.SetValueEx(key, "JARVIS", 0, winreg.REG_SZ, f'"{exe_path}" --background')
        else:
            try:
                winreg.DeleteValue(key, "JARVIS")
            except FileNotFoundError:
                pass
    finally:
        winreg.CloseKey(key)
    return True
