"""Settings, memory, routines and logs, stored as JSON in %APPDATA%\\JARVIS."""
import datetime
import json
import os
import threading

DEFAULTS = {
    "user_title": "sir",
    "style": "jarvis",            # jarvis | friendly | short
    "voice_mode": "natural",      # natural | classic | robot (natural = no filter)
    "voice_name": "",             # SAPI voice name ("" = best male English voice)
    "speech_rate": 1.0,
    "wake_threshold": 0.45,       # "Hey Jarvis" detector
    "wake_plain_jarvis": True,    # also wake on "Jarvis" alone
    "stt_model": "en-in",         # en-in | en-us
    "accurate_mode": True,        # use Whisper for the final transcript when available
    "greeting": "",               # spoken greeting on wake ("" = just a soft chime, fastest)
    "chime": True,
    "char_image": "",             # your character picture
    "char_cutout": "",            # the same picture with its background removed
    "char_remove_bg": True,
    "char_size": "medium",        # small | medium | large
    "char_side": "right",         # right | left
    "char_pos": [],               # where you dragged it
    "config_version": 2,
    "start_with_windows": True,
    "fly_animation": True,
    "memory": {},
    "notes": [],
    "projects": "",               # "name: C:\\path" per line
    "routines": (
        "coding mode: open vs code; open my main project; open terminal; play lofi coding music on youtube; "
        "say Coding mode activated. Let's build something, sir.\n"
        "study mode: close youtube; volume 30; set a timer for 25 minutes; say Study mode on. Twenty five minutes of focus.\n"
        "good night: pause; volume 10; say Good night, sir. Shutting things down.; lock\n"
        "good morning: what's the date; battery; system status\n"
        "break time: pause; say Take a break, sir. Stretch and drink some water."
    ),
    "limits": "youtube: 90\nchrome: 180",
    "reminders": [],
    "log": [],
}


def data_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    path = os.path.join(base, "JARVIS")
    os.makedirs(path, exist_ok=True)
    return path


class Store:
    def __init__(self, path=None):
        self.path = path or os.path.join(data_dir(), "config.json")
        self._lock = threading.Lock()
        self.data = dict(DEFAULTS)
        try:
            with open(self.path, encoding="utf-8") as f:
                saved = json.load(f)
            if saved.get("config_version", 1) < 2:
                # v1 → v2: natural Indian-English voice and no spoken greeting by default.
                saved.update(voice_mode="natural", greeting="", voice_name="", config_version=2)
            self.data.update(saved)
        except (OSError, ValueError):
            pass

    def get(self, key):
        return self.data.get(key, DEFAULTS.get(key))

    def set(self, key, value):
        with self._lock:
            self.data[key] = value
            self.save()

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, self.path)

    # ---- memory ----
    def remember(self, key, value):
        mem = dict(self.get("memory"))
        mem[key.strip().lower()] = value.strip()
        self.set("memory", mem)

    def forget(self, key):
        mem = dict(self.get("memory"))
        k = key.strip().lower()
        for cand in (k, k[3:] if k.startswith("my ") else "my " + k):
            if cand in mem:
                del mem[cand]
                self.set("memory", mem)
                return True
        return False

    def add_note(self, text):
        notes = list(self.get("notes"))[-49:] + [text]
        self.set("notes", notes)

    # ---- routines: "name: step; step" per line ----
    def routines(self):
        out = {}
        for line in self.get("routines").splitlines():
            if ":" not in line:
                continue
            name, steps = line.split(":", 1)
            steps = [s.strip() for s in steps.split(";") if s.strip()]
            if name.strip() and steps:
                out[name.strip().lower()] = steps
        return out

    def projects(self):
        out = {}
        for line in self.get("projects").splitlines():
            if ":" in line:
                name, path = line.split(":", 1)
                # "name: C:\path" — the drive letter colon belongs to the path.
                if len(name.strip()) == 1 and path.startswith("\\"):
                    continue
                out[name.strip().lower()] = path.strip()
        return out

    def limits(self):
        out = {}
        for line in self.get("limits").splitlines():
            if ":" in line:
                name, mins = line.split(":", 1)
                try:
                    out[name.strip().lower()] = int(mins.strip())
                except ValueError:
                    pass
        return out

    def log(self, heard, reply):
        entries = list(self.get("log"))[-59:]
        entries.append({"t": datetime.datetime.now().strftime("%b %d %H:%M"), "heard": heard, "reply": reply})
        self.set("log", entries)
