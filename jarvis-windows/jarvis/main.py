"""JARVIS for Windows: entry point. Tray icon, hotkey, reminders, settings and the conversation loop."""
import os
import sys
import threading
import time

from PySide6.QtCore import QLockFile, QObject, QPointF, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QPainter, QPixmap, QPen, QPolygonF
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                               QMenu, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QSlider, QSystemTrayIcon,
                               QTabWidget, QVBoxLayout, QWidget)

from . import stats, winactions as wa
from .audio import Listener
from .brain import Brain
from .overlay import Overlay
from .store import Store, data_dir
from .voice import Voice

APP_STYLE = """
QWidget { background: #050B14; color: #E6FBFF; font-family: 'Bahnschrift', 'Segoe UI'; font-size: 13px; }
QLabel#title { color: #00E5FF; font-size: 26px; letter-spacing: 6px; font-weight: bold; }
QLabel#dim { color: #7FB8C4; }
QPushButton { background: #00E5FF; color: #001018; border: none; border-radius: 8px; padding: 8px 14px; font-weight: bold; }
QPushButton:hover { background: #7FF3FF; }
QLineEdit, QPlainTextEdit, QComboBox { background: #0A2230; border: 1px solid #0E4A5C; border-radius: 6px; padding: 6px; }
QTabBar::tab { background: #0A1A26; color: #7FB8C4; padding: 8px 16px; }
QTabBar::tab:selected { color: #FFC857; border-bottom: 2px solid #FFC857; }
QTabWidget::pane { border: 1px solid #0E4A5C; }
QCheckBox::indicator { width: 18px; height: 18px; }
"""


def make_icon(size=64):
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor(5, 11, 20))
    p.setPen(QPen(QColor(0, 229, 255), size * 0.06))
    p.drawEllipse(QPointF(size / 2, size / 2), size * 0.44, size * 0.44)
    p.setBrush(QColor(180, 245, 255))
    p.setPen(Qt.NoPen)
    s = size
    p.drawPolygon(QPolygonF([QPointF(s * 0.3, s * 0.34), QPointF(s * 0.7, s * 0.34), QPointF(s * 0.5, s * 0.7)]))
    p.end()
    return QIcon(pm)


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


class Jarvis(QObject):
    def __init__(self, app, background):
        super().__init__()
        self.app = app
        self.store = Store()
        self.bus = Bus()
        self.apps = wa.Apps()
        self.screen_time = stats.ScreenTime(on_limit=lambda a, m: self.bus.limit.emit(a, m), limits=self.store.limits)
        self.screen_time.start()
        self.brain = Brain(self.store, self.apps, self.screen_time, self.add_reminder,
                           clipboard_text=lambda: QApplication.clipboard().text())
        self.overlay = Overlay(self.store)
        self.overlay.screen_time = self.screen_time
        self.overlay.reminders = lambda: self.store.get("reminders")
        self.overlay.on_hidden = self._overlay_hidden
        self.voice = Voice(self.store, on_level=lambda v: self.bus.level.emit(v))
        self.listener = Listener(self.store, on_wake=self.bus.wake.emit, on_partial=self.bus.partial.emit,
                                 on_final=self.bus.final.emit, on_level=self.bus.mic.emit, on_status=self.bus.status.emit)
        self.followup = False
        self.misses = 0
        self.active = False
        self.speech_id = 0
        self.after_speech = {}
        self.engine_status = "Starting..."

        b = self.bus
        b.wake.connect(self.on_wake)
        b.partial.connect(self.on_partial)
        b.final.connect(self.on_final)
        b.level.connect(self.overlay.set_level)
        b.mic.connect(self.overlay.set_mic)
        b.status.connect(self.on_status)
        b.spoken.connect(self._spoken)
        b.hotkey.connect(self.on_wake)
        b.replied.connect(self.on_reply)
        b.limit.connect(lambda a, m: self.tray.showMessage("JARVIS", f"You've used {a} for {m} minutes today, your limit.", self.icon))

        self.icon = make_icon()
        self.tray = QSystemTrayIcon(self.icon)
        self.tray.setToolTip("JARVIS")
        menu = QMenu()
        for label, fn in (("Talk to JARVIS (Ctrl+Alt+J)", self.on_wake), ("Settings", self.show_settings),
                          ("Pause listening", self.toggle_pause), ("Quit", self.quit)):
            act = QAction(label, menu)
            act.triggered.connect(fn)
            menu.addAction(act)
            if label.startswith("Pause"):
                self.pause_action = act
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(lambda reason: self.on_wake() if reason == QSystemTrayIcon.Trigger else None)
        self.tray.show()

        self.reminder_timer = QTimer()
        self.reminder_timer.timeout.connect(self.check_reminders)
        self.reminder_timer.start(5000)
        self.settings = None
        self.listener.start()
        start_hotkey(self.bus.hotkey.emit)
        if getattr(sys, "frozen", False):
            wa.set_startup(bool(self.store.get("start_with_windows")), sys.executable)
        if not background or not os.path.exists(os.path.join(data_dir(), ".welcomed")):
            QTimer.singleShot(400, self.show_settings)

    # ---------------------------------------------------------------- conversation
    def on_status(self, text):
        self.engine_status = text
        if self.settings:
            self.settings.refresh_status()
        if text.startswith(("Speech models failed", "Microphone problem")):
            self.tray.showMessage("JARVIS", text, self.icon)

    def on_wake(self):
        if self.listener.model is None:
            self.tray.showMessage("JARVIS", "Still loading speech models, one moment...", self.icon)
            return
        self.voice.stop()
        self.active = True
        self.misses = 0
        self.brain.pending = None
        self.listener.mute()
        self.overlay.appear()
        greeting = self.store.get("greeting")
        fly = 2.2 if self.store.get("fly_animation") and self.overlay.phase == "in" else 0.1
        # Greet as the suit lands, then listen.
        QTimer.singleShot(int(fly * 1000), lambda: self.say(greeting, lambda: self.listen(False)) if greeting else self.listen(False))

    def listen(self, followup):
        if not self.active:
            return
        self.followup = followup
        self.overlay.mode = "listening"
        self.overlay.heard = ""
        self.listener.listen_command(followup)

    def on_partial(self, text):
        self.overlay.heard = text

    def on_final(self, text):
        if not self.active:
            return
        text = text.strip()
        if not text:
            if self.followup or self.misses >= 1:
                self.close()
                return
            self.misses += 1
            self.say(f"I didn't catch that{self.brain.sir()}.", lambda: self.listen(False))
            return
        self.misses = 0
        self.overlay.heard = text
        self.overlay.mode = "thinking"
        clip = QApplication.clipboard().text()
        self.brain.clipboard_text = lambda: clip
        # Work off the UI thread so the animation never freezes (PowerShell, file search...).
        threading.Thread(target=lambda: self.bus.replied.emit(self.brain.handle(text)), daemon=True).start()

    def on_reply(self, reply):
        if not self.active:
            return
        self.overlay.display = reply.display or ""

        def after():
            if reply.after:
                threading.Thread(target=reply.after, daemon=True).start()
            if reply.close:
                QTimer.singleShot(300, self.close)
            else:
                self.listen(not reply.ask)
        if reply.speech:
            self.say(reply.speech, after)
        else:
            after()

    def say(self, text, then=None):
        self.listener.mute()
        self.overlay.answer = text
        self.overlay.mode = "speaking"
        self.speech_id += 1
        sid = self.speech_id
        self.after_speech[sid] = then
        self.voice.say(text, done=lambda: self.bus.spoken.emit(sid))

    def _spoken(self, sid):
        then = self.after_speech.pop(sid, None)
        if sid == self.speech_id and then:
            then()

    def close(self):
        self.active = False
        self.overlay.mode = "idle"
        self.listener.mute()
        self.overlay.leave()

    def _overlay_hidden(self):
        if not self.active:
            self.listener.back_to_wake()

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
            self.tray.showMessage("JARVIS", r["text"], self.icon)
        text = " ".join(f"{r['text']}{self.brain.sir()}." for r in due)
        self.active = True
        self.listener.mute()
        self.overlay.appear()
        QTimer.singleShot(2300, lambda: self.say(text, self.close))

    # ---------------------------------------------------------------- tray actions
    def toggle_pause(self):
        self.listener.paused = not self.listener.paused
        self.pause_action.setText("Resume listening" if self.listener.paused else "Pause listening")

    def show_settings(self):
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
    """Ctrl+Alt+J anywhere in Windows opens JARVIS."""
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


class SettingsWindow(QWidget):
    def __init__(self, jarvis):
        super().__init__()
        self.j = jarvis
        s = jarvis.store
        self.setWindowTitle("JARVIS")
        self.setWindowIcon(jarvis.icon)
        self.resize(720, 760)
        self.setStyleSheet(APP_STYLE)
        root = QVBoxLayout(self)
        title = QLabel("J.A.R.V.I.S.")
        title.setObjectName("title")
        root.addWidget(title)
        sub = QLabel("Offline personal assistant. Say \"Hey Jarvis\" or \"Jarvis\", or press Ctrl+Alt+J.")
        sub.setObjectName("dim")
        root.addWidget(sub)
        self.status = QLabel()
        root.addWidget(self.status)
        row = QHBoxLayout()
        talk = QPushButton("Talk to JARVIS")
        talk.clicked.connect(jarvis.on_wake)
        test = QPushButton("Hear my voice")
        test.clicked.connect(lambda: jarvis.voice.say(f"Good evening, {s.get('user_title')}. All systems are online."))
        row.addWidget(talk)
        row.addWidget(test)
        row.addStretch()
        root.addLayout(row)

        tabs = QTabWidget()
        root.addWidget(tabs, 1)

        # ---- Personality ----
        form_w = QWidget()
        form = QFormLayout(form_w)
        self._combo(form, "Voice style", "voice_mode", [("Classic JARVIS (robotic)", "classic"), ("Full robot", "robot"),
                                                       ("Calm", "calm"), ("Professional (no effect)", "professional")])
        voices = QComboBox()
        voices.addItem("Automatic (best male English voice)", "")
        QTimer.singleShot(1500, lambda: [voices.addItem(v, v) for v in jarvis.voice.voices if voices.findData(v) < 0])
        voices.currentIndexChanged.connect(lambda _i: (s.set("voice_name", voices.currentData()), jarvis.voice.reload()))
        form.addRow("Voice", voices)
        self._combo(form, "Reply style", "style", [("JARVIS (\"..., sir\")", "jarvis"), ("Friendly", "friendly"), ("Short", "short")])
        self._slider(form, "Speaking speed", "speech_rate", 0.6, 1.8)
        self._slider(form, "Wake sensitivity (left = fewer false wakes)", "wake_threshold", 0.65, 0.25)
        self._line(form, "Call me", "user_title")
        self._line(form, "Greeting", "greeting")
        self._combo(form, "Speech model", "stt_model", [("English (India)", "en-in"), ("English (US)", "en-us")])
        self._check(form, "Wake on \"Jarvis\" alone (not only \"Hey Jarvis\")", "wake_plain_jarvis")
        self._check(form, "Accurate mode (better recognition, slightly slower)", "accurate_mode")
        self._check(form, "Iron Man flight animation", "fly_animation")
        self._check(form, "Start with Windows", "start_with_windows",
                    lambda v: wa.set_startup(v, sys.executable) if getattr(sys, "frozen", False) else None)
        tabs.addTab(form_w, "Personality")

        tabs.addTab(self._text_tab("Routines: one per line, name: command; command; ...\nSay the name to run it, e.g. \"coding mode\".",
                                   "routines"), "Routines")
        tabs.addTab(self._text_tab("Projects and folders: name: C:\\path\\to\\folder, one per line.\n"
                                   "\"open <name>\" opens it in VS Code (or Explorer).", "projects"), "Projects")
        tabs.addTab(self._text_tab("Daily app limits in minutes: app: minutes, one per line (e.g. youtube: 90).", "limits"), "Limits")

        mem_w = QWidget()
        mv = QVBoxLayout(mem_w)
        self.mem = QLabel()
        self.mem.setWordWrap(True)
        self.mem.setAlignment(Qt.AlignTop)
        mv.addWidget(self.mem, 1)
        clear = QPushButton("Forget everything")
        clear.clicked.connect(self._clear_memory)
        mv.addWidget(clear)
        tabs.addTab(mem_w, "Memory")

        log_w = QScrollArea()
        log_w.setWidgetResizable(True)
        self.log = QLabel()
        self.log.setWordWrap(True)
        self.log.setAlignment(Qt.AlignTop)
        self.log.setObjectName("dim")
        log_w.setWidget(self.log)
        tabs.addTab(log_w, "Recent commands")
        tabs.currentChanged.connect(lambda _i: self.refresh())
        self.refresh()

    def refresh_status(self):
        st = self.j.engine_status
        if st == "listening":
            self.status.setText("● Listening for \"Hey Jarvis\". Everything stays on this laptop.")
            self.status.setStyleSheet("color: #00E5FF;")
        else:
            self.status.setText("○ " + st)
            self.status.setStyleSheet("color: #FFC857;")

    def refresh(self):
        self.refresh_status()
        s = self.j.store
        mem = [f"• {k} → {v}" for k, v in s.get("memory").items()] + [f"• note: {n}" for n in s.get("notes")]
        self.mem.setText("\n".join(mem) or "Nothing yet. Say \"remember MediaAI is my main project\".")
        self.log.setText("\n\n".join(f"{e['t']}  “{e['heard']}”\n→ {e['reply']}" for e in reversed(s.get("log"))) or "Nothing yet.")

    def _clear_memory(self):
        if QMessageBox.question(self, "JARVIS", "Forget everything JARVIS remembers?") == QMessageBox.Yes:
            self.j.store.set("memory", {})
            self.j.store.set("notes", [])
            self.refresh()

    def _combo(self, form, label, key, options):
        c = QComboBox()
        for text, val in options:
            c.addItem(text, val)
        c.setCurrentIndex(max(0, c.findData(self.j.store.get(key))))
        c.currentIndexChanged.connect(lambda _i: self.j.store.set(key, c.currentData()))
        form.addRow(label, c)

    def _slider(self, form, label, key, lo, hi):
        sl = QSlider(Qt.Horizontal)
        sl.setRange(0, 100)
        sl.setValue(int(round((float(self.j.store.get(key)) - lo) / (hi - lo) * 100)))
        sl.valueChanged.connect(lambda v: self.j.store.set(key, round(lo + (hi - lo) * v / 100, 3)))
        form.addRow(label, sl)

    def _line(self, form, label, key):
        e = QLineEdit(self.j.store.get(key))
        e.textChanged.connect(lambda t: self.j.store.set(key, t.strip()))
        form.addRow(label, e)

    def _check(self, form, label, key, extra=None):
        cb = QCheckBox(label)
        cb.setChecked(bool(self.j.store.get(key)))

        def changed(v):
            self.j.store.set(key, bool(v))
            if extra:
                extra(bool(v))
        cb.toggled.connect(changed)
        form.addRow("", cb)

    def _text_tab(self, help_text, key):
        w = QWidget()
        v = QVBoxLayout(w)
        h = QLabel(help_text)
        h.setObjectName("dim")
        h.setWordWrap(True)
        v.addWidget(h)
        e = QPlainTextEdit(self.j.store.get(key))
        e.setFont(QFont("Consolas", 11))
        v.addWidget(e, 1)
        save = QPushButton("Save")
        save.clicked.connect(lambda: (self.j.store.set(key, e.toPlainText()), save.setText("Saved ✓"),
                                      QTimer.singleShot(1500, lambda: save.setText("Save"))))
        v.addWidget(save)
        return w

    def closeEvent(self, ev):
        ev.ignore()
        self.hide()


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
