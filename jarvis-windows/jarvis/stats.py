"""Live laptop numbers for the HUD, plus a small screen-time tracker (which app is in front)."""
import datetime
import json
import os
import threading
import time

import psutil

from .parser import score
from .store import data_dir


def gb(n):
    return f"{n / 1073741824:.1f} GB"


def snapshot():
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else "/")
    bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
    return {
        "cpu": psutil.cpu_percent(interval=None),
        "ram_used": vm.used, "ram_total": vm.total, "ram_pct": vm.percent,
        "disk_used": disk.used, "disk_total": disk.total, "disk_pct": disk.percent,
        "battery": round(bat.percent) if bat else None, "plugged": bool(bat.power_plugged) if bat else None,
        "secs_left": bat.secsleft if bat and bat.secsleft not in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) else None,
        "uptime": time.time() - psutil.boot_time(),
    }


class NetSpeed:
    def __init__(self):
        self.last = psutil.net_io_counters()
        self.t = time.time()
        self.down = self.up = 0.0

    def update(self):
        now, cur = time.time(), psutil.net_io_counters()
        dt = max(0.5, now - self.t)
        self.down = (cur.bytes_recv - self.last.bytes_recv) / dt
        self.up = (cur.bytes_sent - self.last.bytes_sent) / dt
        self.last, self.t = cur, now
        return self.down, self.up


def speed(bps):
    return f"{bps / 1048576:.1f} MB/s" if bps > 1048576 else f"{bps / 1024:.0f} KB/s"


def duration(seconds):
    m = int(seconds // 60)
    return f"{m}m" if m < 60 else f"{m // 60}h {m % 60}m"


def spoken_duration(seconds):
    m = round(seconds / 60)
    if m < 1:
        return "less than a minute"
    if m < 60:
        return f"{m} minute{'s' if m != 1 else ''}"
    h, m = divmod(m, 60)
    return f"{h} hour{'s' if h != 1 else ''}" + (f" and {m} minute{'s' if m != 1 else ''}" if m else "")


class ScreenTime(threading.Thread):
    """Every 5 seconds, adds time to whichever app is in front (unless you've been idle 3+ minutes)."""

    NAMES = {"chrome": "Chrome", "msedge": "Edge", "code": "VS Code", "explorer": "File Explorer", "firefox": "Firefox",
             "windowsterminal": "Terminal", "spotify": "Spotify", "winword": "Word", "excel": "Excel", "powerpnt": "PowerPoint",
             "whatsapp": "WhatsApp", "ms-teams": "Teams", "discord": "Discord", "notepad": "Notepad", "jarvis": "JARVIS"}

    def __init__(self, on_limit=None, limits=None):
        super().__init__(daemon=True, name="jarvis-screentime")
        self.path = os.path.join(data_dir(), "usage.json")
        self.on_limit = on_limit
        self.limits = limits or (lambda: {})
        self.warned = set()
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            self.data = {}

    def today(self):
        return self.data.get(datetime.date.today().isoformat(), {})

    def run(self):
        last_save = time.time()
        while True:
            time.sleep(5)
            try:
                app = self._front_app()
                if app:
                    day = self.data.setdefault(datetime.date.today().isoformat(), {})
                    day[app] = day.get(app, 0) + 5
                    self._check_limit(app, day)
                if time.time() - last_save > 60:
                    self._save()
                    last_save = time.time()
            except Exception:
                pass

    def _save(self):
        keep = sorted(self.data)[-30:]
        self.data = {k: self.data[k] for k in keep}
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f)

    def _check_limit(self, app, day):
        for name, mins in self.limits().items():
            if score(name, app) >= 0.85 and day.get(app, 0) >= mins * 60 and (app, mins) not in self.warned:
                self.warned.add((app, mins))
                if self.on_limit:
                    self.on_limit(app, mins)

    def _front_app(self):
        if os.name != "nt":
            return None
        import ctypes
        from ctypes import wintypes

        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]
        lii = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
        ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
        if (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) > 180000:
            return None
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.lower()
        try:
            name = psutil.Process(pid.value).name().lower().replace(".exe", "")
        except Exception:
            return None
        # Browsers: count well-known sites by the tab title.
        if name in ("chrome", "msedge", "firefox", "brave", "opera"):
            for site in ("youtube", "instagram", "netflix", "whatsapp", "linkedin", "github", "gmail"):
                if site in title:
                    return site.capitalize() if site != "youtube" else "YouTube"
        return self.NAMES.get(name, name.capitalize())
