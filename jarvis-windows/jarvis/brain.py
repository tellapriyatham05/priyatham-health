"""Understands → acts → answers. Keeps short-term context and uses memory and routines."""
import datetime
import os
import re
import time

from . import stats, winactions as wa
from .parser import Command, normalize, parse, score


class Reply:
    def __init__(self, speech="", after=None, close=False, ask=False, display=None):
        self.speech, self.after, self.close, self.ask, self.display = speech, after, close, ask, display


class Brain:
    def __init__(self, store, apps, screen_time, add_reminder, clipboard_text=lambda: ""):
        self.store, self.apps, self.screen_time = store, apps, screen_time
        self.add_reminder = add_reminder
        self.clipboard_text = clipboard_text
        self.pending = None            # ("confirm_power", action)
        self.last_target = None        # last thing opened ("it" / "that")
        self.depth = 0

    # ---------------------------------------------------------------- helpers
    def sir(self):
        return f", {self.store.get('user_title')}" if self.store.get("style") == "jarvis" else ""

    def r(self, text, **kw):
        text = text.replace("{sir}", self.sir())
        if self.store.get("style") == "short" and ". " in text:
            text = text.split(". ")[0] + "."
        return Reply(text, **kw)

    def handle(self, heard):
        reply = self._handle(heard)
        if self.depth == 0:
            self.store.log(heard, reply.speech)
        return reply

    # ---------------------------------------------------------------- main flow
    def _handle(self, heard):
        text = normalize(heard)
        if not text:
            return self.r("Yes{sir}?", ask=True)

        if self.pending:
            kind, value = self.pending
            self.pending = None
            c = parse(text)
            if kind == "confirm_power":
                if c.intent == "yes":
                    return self.r({"shutdown": "Shutting down in five seconds{sir}.", "restart": "Restarting in five seconds{sir}.",
                                   "logoff": "Signing out{sir}."}[value], after=lambda: wa.power(value), close=True)
                return self.r("Cancelled{sir}.", close=True)

        routine = self._match_routine(text)
        if routine:
            return self._run_routine(routine)

        text = self._apply_memory(text)
        if self.last_target and re.search(r"\b(?:it|that)\b", text) and re.match(r"^(?:close|open|kill|quit)\b", text):
            text = re.sub(r"\b(?:it|that)\b", self.last_target, text, count=1)
        return self.execute(parse(text), heard)

    def _apply_memory(self, text):
        if text.startswith(("remember", "forget")):
            return text
        mem = self.store.get("memory")
        for k in sorted(mem, key=len, reverse=True):
            v = mem[k].lower()
            for key in (k, k[3:] if k.startswith("my ") else None):
                if key and re.search(rf"\b{re.escape(key)}\b", text):
                    return re.sub(rf"\b{re.escape(key)}\b", lambda _m: v, text)
        return text

    def _match_routine(self, text):
        t = re.sub(r"^(?:start|activate|begin|enable|run|turn on|switch to|go to|enter|set) ", "", text)
        t = re.sub(r" (?:on|please|now|activate|activated)$", "", t)
        for name in self.store.routines():
            bare = re.sub(r" mode$", "", name)
            if t in (name, bare, bare + " mode", bare + " routine", bare + " protocol"):
                return name
        return None

    def _run_routine(self, name):
        steps = self.store.routines()[name]
        said, afters = [], []
        self.depth += 1
        try:
            for step in steps:
                if re.match(r"(?i)^\s*say\s+", step):
                    said.append(re.sub(r"(?i)^\s*say\s+", "", step))
                    continue
                rep = self._handle(step)
                if rep.after:
                    afters.append(rep.after)
                if parse(step).intent in ("time", "date", "battery", "status", "cpu", "ram", "storage", "screen_time"):
                    said.append(rep.speech)
        finally:
            self.depth -= 1
        title = name[0].upper() + name[1:]
        speech = " ".join(said) or (f"{title} is on{{sir}}." if name.endswith("mode") else f"{title} done{{sir}}.")

        def run_all():
            for a in afters:
                a()
                time.sleep(0.6)
        return self.r(speech, after=run_all if afters else None, close=True)

    # ---------------------------------------------------------------- the big switch
    def execute(self, c: Command, heard=""):
        i = c.intent
        if i == "stop":
            return Reply("", close=True)
        if i == "yes":
            return self.r("Yes{sir}?", ask=True)
        if i == "thanks":
            return self.r("Always a pleasure{sir}.", close=True)
        if i in ("hello", "empty"):
            return self.r("At your service{sir}." if i == "hello" else "Yes{sir}?", ask=True)
        if i == "how_are_you":
            s = stats.snapshot()
            return self.r(f"All systems running smoothly{{sir}}. CPU at {s['cpu']:.0f} percent.")
        if i == "who_are_you":
            return self.r("I am JARVIS, your personal assistant. I run entirely on this laptop, no cloud needed.")
        if i == "help":
            return self.r("I can open apps, projects, folders and websites, control volume, brightness, Wi-Fi and Bluetooth, "
                          "play music, set timers and reminders, remember things, and run your routines{sir}.",
                          display="Try: open VS Code · open my main project · coding mode · volume 40 · wifi off · "
                                  "play lofi on YouTube · remind me in 20 minutes to stretch · system status · lock my laptop")
        if i == "phone_only":
            return self.r("Calls and messages happen on your phone{sir}. The phone link is coming in the next version.")

        if i == "remember":
            value = c["value"]
            path = re.search(r"[A-Za-z]:\\[^\"<>|]+", heard)
            if path:
                value = path.group(0).strip().rstrip(".")
            else:  # keep the capitals as spoken ("MediaAI", not "mediaai")
                found = re.search(re.escape(value).replace(r"\ ", r"\s+"), heard, re.I)
                if found:
                    value = found.group(0)
            self.store.remember(c["key"], value)
            return self.r(f"Got it. {c['key'][0].upper() + c['key'][1:]} is {value}.")
        if i == "note":
            self.store.add_note(c["text"])
            return self.r("Noted{sir}.")
        if i == "list_memory":
            mem, notes = self.store.get("memory"), self.store.get("notes")
            if not mem and not notes:
                return self.r("I haven't been asked to remember anything yet{sir}.")
            speech = "Here's what I remember. " + " ".join(f"{k} is {v}." for k, v in mem.items())
            speech += " " + " ".join(f"Note: {n}." for n in notes[-3:])
            disp = "\n".join([f"{k} → {v}" for k, v in mem.items()] + [f"note: {n}" for n in notes])
            return self.r(speech.strip(), display=disp)
        if i == "forget":
            return self.r("Forgotten.") if self.store.forget(c["key"]) else self.r(f"I had nothing saved for {c['key']}.")
        if i == "voice":
            return self._voice(c)

        if i == "power":
            a = c["action"]
            if a == "lock":
                return self.r("Locking{sir}.", after=lambda: wa.power("lock"), close=True)
            if a == "sleep":
                return self.r("Going to sleep{sir}.", after=lambda: wa.power("sleep"), close=True)
            self.pending = ("confirm_power", a)
            word = {"shutdown": "shut down", "restart": "restart", "logoff": "sign out"}[a]
            return self.r(f"Are you sure you want me to {word} the laptop{{sir}}?", ask=True)

        if i == "brightness":
            now = wa.get_brightness()
            if c.get("query"):
                return self.r(f"Brightness is at {now} percent." if now is not None else "I can't read the brightness on this screen.")
            target = c.get("level", (now or 50) + c.get("delta", 0))
            target = max(1, min(100, target))
            return self.r(f"Brightness {target} percent{{sir}}.") if wa.set_brightness(target) \
                else self.r("This screen doesn't let me change its brightness{sir}.")
        if i == "volume":
            if "mute" in c:
                wa.set_mute(c["mute"] == "on")
                return self.r("Muted." if c["mute"] == "on" else "Unmuted.")
            now = wa.get_volume()
            if c.get("query"):
                return self.r(f"Volume is at {now} percent.")
            target = max(0, min(100, c.get("level", (now or 50) + c.get("delta", 0))))
            wa.set_volume(target)
            return self.r(f"Volume {target} percent.")
        if i == "toggle":
            kind = "WiFi" if c["device"] == "wifi" else "Bluetooth"
            label = "Wi-Fi" if kind == "WiFi" else "Bluetooth"
            state = wa.set_radio(kind, c["state"])
            if state:
                return self.r(f"{label} {state.lower()}{{sir}}.")
            return self.r(f"Windows wants you to switch {label} yourself. Opening the settings{{sir}}.",
                          after=lambda: wa.settings_page("wifi" if kind == "WiFi" else "bluetooth"), close=True)
        if i == "open_settings":
            which = c.get("which", "")
            return self.r(f"Opening {which + ' ' if which else ''}settings.", after=lambda: wa.settings_page(which), close=True)

        if i == "screenshot":
            return Reply("", after=lambda: (time.sleep(1.2), wa.keys("win+prtsc")), close=True)
        if i == "window":
            combo = {"desktop": "win+d", "minimize": "win+down", "maximize": "win+up", "switch": "alt+tab", "close": "alt+f4"}[c["action"]]
            return Reply("", after=lambda: (time.sleep(0.6), wa.keys(combo)), close=True)
        if i == "keys":
            return Reply("", after=lambda: (time.sleep(0.6), wa.keys(c["combo"])), close=True)
        if i == "type":
            text = c["text"]
            return self.r("Typing.", after=lambda: (time.sleep(0.9), wa.type_text(text)), close=True)
        if i == "clipboard":
            clip = (self.clipboard_text() or "").strip()
            return self.r(f"Your clipboard says: {clip[:300]}" if clip else "Your clipboard is empty{sir}.")
        if i == "recycle_bin":
            return self.r("Recycle bin emptied{sir}.") if wa.empty_recycle_bin() else self.r("I couldn't empty the recycle bin.")

        if i == "media":
            wa.media(c["action"])
            if self.depth:
                return Reply("")
            return self.r({"pause": "Paused.", "next": "Next track.", "previous": "Previous track.", "play": "Playing{sir}."}[c["action"]], close=True)
        if i == "youtube":
            q = c["query"]
            return self.r(f"Playing {q} on YouTube{{sir}}.", after=lambda: wa.youtube(q), close=True)
        if i == "play":
            q = c["query"]
            if c.get("spotify"):
                return self.r(f"Playing {q} on Spotify{{sir}}.", after=lambda: wa.spotify(q) or wa.youtube(q), close=True)
            return self.r(f"Playing {q}{{sir}}.", after=lambda: wa.youtube(q), close=True)
        if i == "search":
            q = c["query"]
            return self.r(f"Searching for {q}.", after=lambda: wa.google(q), close=True)
        if i == "open":
            return self._open(c["target"])
        if i == "close":
            name = c["target"]
            n = wa.close_app(name)
            self.last_target = name
            return self.r(f"Closed {name}{{sir}}.") if n else self.r(f"{name[0].upper() + name[1:]} isn't running{{sir}}.")

        if i == "timer":
            secs = c["seconds"]
            self.add_reminder(time.time() + secs, f"Your {stats.spoken_duration(secs)} timer is done")
            return self.r(f"Timer set for {stats.spoken_duration(secs)}{{sir}}.")
        if i in ("reminder", "alarm"):
            return self._schedule(c)
        if i == "cancel_reminders":
            self.store.set("reminders", [])
            return self.r("All reminders and timers cancelled{sir}.")
        if i == "list_reminders":
            items = sorted(self.store.get("reminders"), key=lambda x: x["at"])
            if not items:
                return self.r("You have no reminders{sir}.")
            parts = [f"{x['text']} at {datetime.datetime.fromtimestamp(x['at']).strftime('%I:%M %p').lstrip('0')}" for x in items[:5]]
            return self.r("Your reminders: " + "; ".join(parts) + ".")

        if i == "time":
            return self.r(f"It's {datetime.datetime.now().strftime('%I:%M %p').lstrip('0')}{{sir}}.")
        if i == "date":
            return self.r(f"Today is {datetime.datetime.now().strftime('%A, %d %B').replace(' 0', ' ')}.")
        s = stats.snapshot()
        if i == "battery":
            if s["battery"] is None:
                return self.r("This computer has no battery{sir}.")
            left = f" About {stats.spoken_duration(s['secs_left'])} left." if s["secs_left"] and not s["plugged"] else ""
            return self.r(f"Battery is at {s['battery']} percent" + (", charging." if s["plugged"] else ".") + left)
        if i == "cpu":
            return self.r(f"CPU usage is {s['cpu']:.0f} percent.")
        if i == "ram":
            return self.r(f"You're using {s['ram_used'] / 1073741824:.1f} of {s['ram_total'] / 1073741824:.1f} gigabytes of RAM.")
        if i == "storage":
            free = (s["disk_total"] - s["disk_used"]) / 1073741824
            return self.r(f"{s['disk_pct']:.0f} percent of your main drive is used. {free:.0f} gigabytes free.")
        if i == "status":
            bat = f" Battery {s['battery']} percent." if s["battery"] is not None else ""
            return self.r(f"All systems normal{{sir}}. CPU {s['cpu']:.0f} percent, RAM {s['ram_pct']:.0f} percent, "
                          f"disk {s['disk_pct']:.0f} percent.{bat}")
        if i == "ip":
            ip = wa.ip_address()
            return self.r(f"Your local IP address is {ip}." if ip else "You're not connected to a network{sir}.")
        if i == "screen_time":
            return self._screen_time(c.get("app"))
        if i == "say":
            return self.r(c["text"])

        # Unknown: maybe a bare app or folder name ("spotify", "downloads").
        t = c.get("text", "")
        if t and len(t.split()) <= 3:
            rep = self._open(t, quiet_fail=True)
            if rep:
                return rep
        return self.r("Sorry{sir}, I don't know how to do that yet.")

    # ---------------------------------------------------------------- pieces
    def _voice(self, c):
        if "speed" in c:
            rate = float(self.store.get("speech_rate")) + (0.15 if c["speed"] == "up" else -0.15)
            self.store.set("speech_rate", max(0.6, min(1.8, rate)))
            return self.r("Speaking faster{sir}." if c["speed"] == "up" else "Speaking slower{sir}.")
        modes = ["classic", "robot", "calm", "professional"]
        m = c["mode"]
        if m == "next":
            new = modes[(modes.index(self.store.get("voice_mode")) + 1) % len(modes)]
        else:
            new = "robot" if m.startswith("robot") else "calm" if m == "calm" else \
                "professional" if m in ("professional", "normal", "human") else "classic"
        self.store.set("voice_mode", new)
        return self.r(f"Voice changed to {new} mode{{sir}}.")

    def _open(self, target, quiet_fail=False):
        t = target.strip()
        routine = self._match_routine(t)
        if routine:
            return self._run_routine(routine)
        self.last_target = t
        # A remembered path ("my main project" → D:\Projects\MediaAI) or a project from settings.
        if re.match(r"^[a-z]:\\", t, re.I) or os.path.isdir(t):
            return self.r(f"Opening {os.path.basename(t.rstrip(os.sep)) or t}{{sir}}.", after=lambda: wa.open_project(t), close=True)
        projects = self.store.projects()
        for name, path in projects.items():
            if score(t, name) >= 0.85:
                return self.r(f"Opening {name}{{sir}}.", after=lambda: wa.open_project(path), close=True)
        if t in ("terminal", "the terminal", "a terminal"):
            return self.r("Opening the terminal{sir}.", after=wa.open_terminal, close=True)
        if re.search(r"\b[a-z0-9-]+(?:\.| dot )(?:com|in|org|net|io|ai|dev|co|app|edu|gov|me|tv)\b", t):
            return self.r(f"Opening {t.replace(' dot ', '.')}.", after=lambda: wa.open_url(t), close=True)
        folder = wa.known_folder(t)
        if folder:
            return self.r(f"Opening {t}{{sir}}.", after=lambda: wa.open_path(folder), close=True)
        app = self.apps.find(t)
        if app and (app[2] >= 0.9 or t not in wa.WEBSITES):
            label, target, _ = app
            return self.r(f"Opening {label.title()}{{sir}}.", after=lambda: wa.Apps.launch(target), close=True)
        if t in wa.WEBSITES:
            url = wa.WEBSITES[t]
            return self.r(f"Opening {t.title()}{{sir}}.", after=lambda: wa.open_url(url), close=True)
        path = wa.find_folder(t, projects)
        if path:
            name = os.path.basename(path)
            in_editor = not os.path.dirname(path).rstrip("\\").endswith(":")  # top-level drive folders open in Explorer
            return self.r(f"Opening {name}{{sir}}.", after=lambda: wa.open_project(path, in_editor), close=True)
        if quiet_fail:
            return None
        return self.r(f"I couldn't find {t} on this laptop{{sir}}. Tell me \"remember {t} is at\" followed by its folder, "
                      f"or add it under Projects in my settings.")

    def _schedule(self, c):
        now = datetime.datetime.now()
        if "in_seconds" in c:
            when = now + datetime.timedelta(seconds=c["in_seconds"])
        elif "hour" in c:
            h, m = c["hour"], c["minute"]
            when = now.replace(hour=h % 24, minute=m, second=0, microsecond=0)
            day = c.get("day")
            if day == "tomorrow":
                when += datetime.timedelta(days=1)
            elif day == "day after tomorrow":
                when += datetime.timedelta(days=2)
            if not c.get("ampm_known") and h < 12 and when < now and not day:
                when += datetime.timedelta(hours=12)
            if when < now and not day:
                when += datetime.timedelta(days=1)
        else:
            return self.r("For what time{sir}?")
        text = c.get("task") or ("Alarm" if c.intent == "alarm" else "your reminder")
        self.add_reminder(when.timestamp(), ("Alarm. Time to wake up" if c.intent == "alarm" else f"Reminder: {text}"))
        days = (when.date() - now.date()).days
        clock = when.strftime("%I:%M %p").lstrip("0").replace(":00 ", " ")
        day_word = "today" if days == 0 else "tomorrow" if days == 1 else when.strftime("%A")
        if c.intent == "alarm":
            return self.r(f"Alarm set for {clock} {day_word}{{sir}}. Keep the laptop awake for it to ring.")
        return self.r(f"I'll remind you {day_word} at {clock} to {text}{{sir}}.")

    def _screen_time(self, app=None):
        day = self.screen_time.today() if self.screen_time else {}
        if app:
            best = max(day.items(), key=lambda kv: score(app, kv[0]), default=None)
            if not best or score(app, best[0]) < 0.8:
                return self.r(f"You haven't used {app} today.")
            limit = self.store.limits().get(app.lower())
            extra = f" Your limit is {limit} minutes." if limit else ""
            return self.r(f"You've used {best[0]} for {stats.spoken_duration(best[1])} today.{extra}")
        total = sum(day.values())
        if not total:
            return self.r("No screen time recorded yet today{sir}.")
        top = sorted(day.items(), key=lambda kv: -kv[1])[:3]
        return self.r(f"Screen time today is {stats.spoken_duration(total)}. Most on "
                      + ", ".join(f"{k} {stats.spoken_duration(v)}" for k, v in top) + ".")
