"""JARVIS for Windows: tray icon, hotkey, reminders and the conversation loop."""
import os
import sys
import threading
import time

import numpy as np
from PySide6.QtCore import QLockFile, QObject, QPointF, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QIcon, QPainter, QPen, QPixmap, QPolygonF
from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon

from . import stats, winactions as wa
from .audio import Listener
from .brain import Brain
from .companion import Companion
from .parser import parse
from .store import Store, data_dir
from .voice import Voice


def make_icon(size=64):
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor(37, 99, 235))
    p.setPen(Qt.NoPen)
    p.drawEllipse(QPointF(size / 2, size / 2), size * 0.46, size * 0.46)
    p.setBrush(QColor(255, 255, 255))
    s = size
    p.drawPolygon(QPolygonF([QPointF(s * 0.3, s * 0.34), QPointF(s * 0.7, s * 0.34), QPointF(s * 0.5, s * 0.7)]))
    p.end()
    return QIcon(pm)


def chime():
    """A short, soft two-note sound so you know JARVIS is listening."""
    try:
        import sounddevice as sd
        rate = 22050
        t = np.arange(int(rate * 0.09)) / rate
        fade = np.minimum(1, np.minimum(t, t[::-1]) * 60)
        tone = np.concatenate([np.sin(2 * np.pi * 880 * t), np.sin(2 * np.pi * 1320 * t)]) * np.concatenate([fade, fade])
        sd.play((tone * 0.12 * 32767).astype(np.int16), rate)
    except Exception:
        pass


class Bus(QObject):
    """Cross-thread events, delivered on the UI thread."""
    wake = Signal()
    partial = Signal(str)
    final = Signal(str)
    level = Signal(float)
    mic = Signal(float)
    status = Signal(str)
    spoken = Signal(int)
    hotkey = Signal()
    limit = Signal(str, int)
    replied = Signal(object)
    cutout_done = Signal(str)


class Jarvis(QObject):
    def __init__(self, app, background):
        super().__init__()
        self.app = app
        self.store = Store()
        self.bus = Bus()
        self.icon = make_icon()
        self.apps = wa.Apps()
        self.screen_time = stats.ScreenTime(on_limit=lambda a, m: self.bus.limit.emit(a, m), limits=self.store.limits)
        self.screen_time.start()
        self.brain = Brain(self.store, self.apps, self.screen_time, self.add_reminder)
        self.companion = Companion(self.store)
        self.voice = Voice(self.store, on_level=lambda v: self.bus.level.emit(v))
        self.listener = Listener(self.store, on_wake=self.bus.wake.emit, on_partial=self.bus.partial.emit,
                                 on_final=self.bus.final.emit, on_level=self.bus.mic.emit, on_status=self.bus.status.emit,
                                 understood=lambda text: parse(text).intent not in ("unknown", "empty"))
        self.active = False
        self.followup = False
        self.misses = 0
        self.speech_id = 0
        self.after_speech = {}
        self.engine_status = "Starting..."
        self.settings = None

        b = self.bus
        b.wake.connect(self.on_wake)
        b.hotkey.connect(self.talk)
        b.partial.connect(self.on_partial)
        b.final.connect(self.on_final)
        b.replied.connect(self.on_reply)
        b.level.connect(self.companion.set_level)
        b.mic.connect(self.companion.set_mic)
        b.status.connect(self.on_status)
        b.spoken.connect(self._spoken)
        b.limit.connect(lambda a, m: self.notify(f"You've used {a} for {m} minutes today — that's your limit."))
        self.companion.clicked.connect(self.talk)
        self.companion.menu_requested.connect(self._companion_menu)

        self.tray = QSystemTrayIcon(self.icon)
        self.tray.setToolTip("JARVIS")
        self.menu = QMenu()
        for label, fn in (("Talk to JARVIS    Ctrl+Alt+J", self.talk), ("Show JARVIS", self.companion.appear),
                          ("Hide JARVIS", self.hide), ("Settings", self.show_settings),
                          ("Pause listening", self.toggle_pause), ("Quit", self.quit)):
            act = QAction(label, self.menu)
            act.triggered.connect(fn)
            self.menu.addAction(act)
            if label.startswith("Pause"):
                self.pause_action = act
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(lambda reason: self.talk() if reason == QSystemTrayIcon.Trigger else None)
        self.tray.show()

        self.reminder_timer = QTimer()
        self.reminder_timer.timeout.connect(self.check_reminders)
        self.reminder_timer.start(5000)
        self.listener.start()
        start_hotkey(self.bus.hotkey.emit)
        if getattr(sys, "frozen", False):
            wa.set_startup(bool(self.store.get("start_with_windows")), sys.executable)
        if not background or not os.path.exists(os.path.join(data_dir(), ".welcomed")):
            QTimer.singleShot(400, self.show_settings)

    # ---------------------------------------------------------------- conversation
    def notify(self, text):
        self.tray.showMessage("JARVIS", text, self.icon, 6000)

    def on_status(self, text):
        self.engine_status = text
        if self.settings:
            self.settings.refresh_status()
        if text.startswith(("Speech models failed", "Microphone problem")):
            self.notify(text)

    def talk(self):
        """Clicked, hotkey or tray: start listening (the wake word path calls on_wake directly)."""
        if self.listener.model is None:
            self.notify("Still loading speech models, one moment...")
            return
        self.listener.listen_command(False)
        self.on_wake()

    def on_wake(self):
        self.voice.stop()
        self.active = True
        self.followup = False
        self.misses = 0
        self.brain.pending = None
        self.companion.heard = self.companion.answer = self.companion.display = ""
        self.companion.appear()
        greeting = self.store.get("greeting")
        if greeting:
            self.listener.mute()
            self.say(greeting, lambda: self.listen(False))
            return
        if self.store.get("chime"):
            threading.Thread(target=chime, daemon=True).start()
        self.companion.mode = "listening"

    def listen(self, followup):
        if not self.active:
            return
        self.followup = followup
        self.companion.mode = "listening"
        self.companion.heard = ""
        self.listener.listen_command(followup)

    def on_partial(self, text):
        self.companion.heard = text

    def on_final(self, text):
        if not self.active:
            return
        text = text.strip()
        if not text:
            if self.followup or self.misses >= 1:
                self.end_conversation()
                return
            self.misses += 1
            self.say("Sorry, I didn't catch that.", lambda: self.listen(False))
            return
        self.misses = 0
        self.companion.heard = text
        self.companion.mode = "thinking"
        clip = QApplication.clipboard().text()
        self.brain.clipboard_text = lambda: clip
        # Work off the UI thread so the animation never stalls (PowerShell, file search...).
        threading.Thread(target=lambda: self.bus.replied.emit(self.brain.handle(text)), daemon=True).start()

    def on_reply(self, reply):
        if not self.active:
            return
        self.companion.display = reply.display or ""
        if reply.show:
            self.companion.appear()
        if reply.after and not reply.wait:
            threading.Thread(target=reply.after, daemon=True).start()   # act right away, talk at the same time

        def done():
            if reply.after and reply.wait:
                threading.Thread(target=reply.after, daemon=True).start()
            if reply.hide:
                self.end_conversation()
                self.companion.leave()
            elif reply.close:
                self.end_conversation()
            else:
                self.listen(not reply.ask)
        if reply.speech:
            self.say(reply.speech, done)
        else:
            done()

    def say(self, text, then=None):
        self.listener.mute()
        self.companion.answer = text
        self.companion.mode = "speaking"
        self.companion.show_card(10)
        self.speech_id += 1
        sid = self.speech_id
        self.after_speech[sid] = then
        self.voice.say(text, done=lambda: self.bus.spoken.emit(sid))

    def _spoken(self, sid):
        then = self.after_speech.pop(sid, None)
        if sid == self.speech_id and then:
            then()

    def end_conversation(self):
        self.active = False
        self.companion.mode = "idle"
        self.companion.show_card(6)
        self.listener.back_to_wake()

    def hide(self):
        self.end_conversation()
        self.companion.leave()

    def _companion_menu(self, pos):
        self.menu.popup(pos)

    # ---------------------------------------------------------------- reminders
    def add_reminder(self, at, text):
        items = list(self.store.get("reminders"))
        items.append({"at": at, "text": text})
        self.store.set("reminders", items)

    def check_reminders(self):
        now = time.time()
        items = list(self.store.get("reminders"))
        due = [r for r in items if r["at"] <= now]
        if not due:
            return
        self.store.set("reminders", [r for r in items if r["at"] > now])
        for r in due:
            self.notify(r["text"])
        text = " ".join(f"{r['text']}{self.brain.sir()}." for r in due)
        self.active = True
        self.companion.appear()
        QTimer.singleShot(1900, lambda: self.say(text, self.end_conversation))

    # ---------------------------------------------------------------- tray actions
    def toggle_pause(self):
        self.listener.paused = not self.listener.paused
        self.pause_action.setText("Resume listening" if self.listener.paused else "Pause listening")

    def show_settings(self):
        from .settings_ui import SettingsWindow
        if self.settings is None:
            self.settings = SettingsWindow(self)
        self.settings.show()
        self.settings.raise_()
        self.settings.activateWindow()
        open(os.path.join(data_dir(), ".welcomed"), "w").close()

    def quit(self):
        self.listener.stop()
        self.tray.hide()
        self.app.quit()


def start_hotkey(callback):
    """Ctrl+Alt+J anywhere in Windows talks to JARVIS."""
    if os.name != "nt":
        return

    def loop():
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        if not user32.RegisterHotKey(None, 1, 0x0002 | 0x0001 | 0x4000, ord("J")):  # ALT | CTRL | NOREPEAT
            return
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            if msg.message == 0x0312:
                callback()
    threading.Thread(target=loop, daemon=True, name="jarvis-hotkey").start()


def main():
    if os.name == "nt":
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            pass
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Priyatham.JARVIS")
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    app.setApplicationName("JARVIS")
    lock = QLockFile(os.path.join(data_dir(), "jarvis.lock"))
    if not lock.tryLock(100):
        QMessageBox.information(None, "JARVIS", "JARVIS is already running. Look for the blue icon in the system tray.")
        return
    jarvis = Jarvis(app, background="--background" in sys.argv)
    app.jarvis = jarvis
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
