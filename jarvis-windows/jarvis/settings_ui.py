"""The settings window: a plain, light, sidebar layout."""
import os
import shutil
import sys
import threading

from PySide6.QtCore import QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QImage, QLinearGradient, QPainter, QPixmap
from PySide6.QtWidgets import (QCheckBox, QComboBox, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget,
                               QMessageBox, QPlainTextEdit, QProgressBar, QPushButton, QScrollArea, QSlider,
                               QStackedWidget, QVBoxLayout, QWidget)

from . import winactions as wa
from .store import data_dir

STYLE = """
* { font-family: 'Segoe UI'; font-size: 10pt; color: #111827; }
QWidget#root, QWidget#page { background: #F7F8FA; }
QWidget#navwrap { background: #FFFFFF; border-right: 1px solid #E5E7EB; }
QListWidget#nav { background: #FFFFFF; border: none; border-right: 1px solid #E5E7EB; padding: 12px 8px; outline: 0; }
QListWidget#nav::item { padding: 9px 12px; border-radius: 8px; color: #374151; margin: 1px 0; }
QListWidget#nav::item:selected { background: #EEF2FF; color: #1D4ED8; }
QListWidget#nav::item:hover:!selected { background: #F3F4F6; }
QLabel#brand { font-size: 15pt; font-weight: 600; padding: 4px 12px 14px 12px; }
QLabel#h1 { font-size: 16pt; font-weight: 600; }
QLabel#sub, QLabel#hint { color: #6B7280; }
QFrame#card { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; }
QLabel#rowlabel { font-weight: 500; }
QPushButton { background: #FFFFFF; border: 1px solid #D1D5DB; border-radius: 8px; padding: 7px 14px; }
QPushButton:hover { background: #F9FAFB; }
QPushButton#primary { background: #2563EB; border: 1px solid #2563EB; color: #FFFFFF; font-weight: 600; }
QPushButton#primary:hover { background: #1D4ED8; }
QLineEdit, QComboBox, QPlainTextEdit { background: #FFFFFF; border: 1px solid #D1D5DB; border-radius: 8px; padding: 6px 8px; }
QLineEdit:focus, QComboBox:focus, QPlainTextEdit:focus { border: 1px solid #2563EB; }
QSlider::groove:horizontal { height: 4px; background: #E5E7EB; border-radius: 2px; }
QSlider::sub-page:horizontal { background: #2563EB; border-radius: 2px; }
QSlider::handle:horizontal { background: #FFFFFF; border: 1px solid #9CA3AF; width: 16px; margin: -7px 0; border-radius: 8px; }
QScrollArea { border: none; background: transparent; }
"""


DARK = """
* { font-family: 'Segoe UI'; font-size: 10pt; color: #F3F4F6; }
QWidget#root, QWidget#page, QScrollArea, QScrollArea > QWidget > QWidget { background: transparent; }
QWidget#navwrap { background: rgba(10, 14, 22, 205); border-right: 1px solid rgba(255,255,255,30); }
QListWidget#nav { background: transparent; border: none; padding: 12px 8px; outline: 0; }
QListWidget#nav::item { padding: 9px 12px; border-radius: 8px; color: #D1D5DB; margin: 1px 0; }
QListWidget#nav::item:selected { background: rgba(220, 38, 38, 150); color: #FFFFFF; }
QListWidget#nav::item:hover:!selected { background: rgba(255,255,255,20); }
QLabel#brand { font-size: 15pt; font-weight: 600; padding: 4px 12px 14px 12px; color: #FBBF24; }
QLabel#h1 { font-size: 18pt; font-weight: 600; color: #FFFFFF; }
QLabel#sub, QLabel#hint { color: #CBD5E1; }
QFrame#card { background: rgba(12, 16, 26, 200); border: 1px solid rgba(251, 191, 36, 60); border-radius: 12px; }
QLabel#rowlabel { font-weight: 500; }
QPushButton { background: rgba(255,255,255,18); border: 1px solid rgba(255,255,255,60); border-radius: 8px; padding: 7px 14px; color: #F9FAFB; }
QPushButton:hover { background: rgba(255,255,255,34); }
QPushButton#primary { background: #DC2626; border: 1px solid #DC2626; color: #FFFFFF; font-weight: 600; }
QPushButton#primary:hover { background: #B91C1C; }
QLineEdit, QComboBox, QPlainTextEdit { background: rgba(0,0,0,120); border: 1px solid rgba(255,255,255,50); border-radius: 8px; padding: 6px 8px; color: #F9FAFB; }
QComboBox QAbstractItemView { background: #111827; color: #F9FAFB; selection-background-color: #DC2626; }
QLineEdit:focus, QComboBox:focus, QPlainTextEdit:focus { border: 1px solid #FBBF24; }
QSlider::groove:horizontal { height: 4px; background: rgba(255,255,255,40); border-radius: 2px; }
QSlider::sub-page:horizontal { background: #FBBF24; border-radius: 2px; }
QSlider::handle:horizontal { background: #FFFFFF; border: 1px solid #9CA3AF; width: 16px; margin: -7px 0; border-radius: 8px; }
QCheckBox::indicator { width: 18px; height: 18px; border: 1px solid rgba(255,255,255,140); border-radius: 4px; background: rgba(0,0,0,120); }
QCheckBox::indicator:checked { background: #DC2626; border: 1px solid #FCA5A5; }
QProgressBar { background: rgba(255,255,255,25); border: none; border-radius: 4px; height: 8px; }
QProgressBar::chunk { background: #22C55E; border-radius: 4px; }
"""


class SettingsWindow(QWidget):
    def __init__(self, jarvis):
        super().__init__()
        self.j = jarvis
        self.s = jarvis.store
        self.setObjectName("root")
        self.setWindowTitle("JARVIS")
        self.setWindowIcon(jarvis.icon)
        self.resize(900, 660)
        self.bg = None
        self.apply_theme()
        jarvis.bus.cutout_done.connect(self._cutout_done)

        outer = QHBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        side = QVBoxLayout()
        side.setContentsMargins(0, 0, 0, 0)
        brand = QLabel("JARVIS")
        brand.setObjectName("brand")
        nav_wrap = QWidget()
        nav_wrap.setObjectName("navwrap")
        nv = QVBoxLayout(nav_wrap)
        nv.setContentsMargins(8, 18, 0, 8)
        nv.addWidget(brand)
        self.nav = QListWidget()
        self.nav.setObjectName("nav")
        self.nav.setFixedWidth(190)
        nv.addWidget(self.nav, 1)
        outer.addWidget(nav_wrap)
        self.pages = QStackedWidget()
        outer.addWidget(self.pages, 1)

        for name, builder in (("General", self.page_general), ("Voice", self.page_voice), ("Character", self.page_character),
                              ("Routines", lambda: self.page_text("Routines", "Say a routine's name to run it. One per line — "
                                                                   "name: command; command; …", "routines")),
                              ("Projects", lambda: self.page_text("Projects", "Folders you open by name. One per line — "
                                                                   "name: C:\\path\\to\\folder", "projects")),
                              ("App limits", lambda: self.page_text("App limits", "Daily minutes per app. One per line — "
                                                                     "app: minutes", "limits")),
                              ("Memory", self.page_memory), ("Activity", self.page_activity)):
            self.nav.addItem(name)
            self.pages.addWidget(self._scroll(builder()))
        self.nav.currentRowChanged.connect(self._switch)
        self.nav.setCurrentRow(0)

    # ---------------------------------------------------------------- theme
    def apply_theme(self):
        dark = self.s.get("theme") == "ironman"
        self.setStyleSheet(DARK if dark else STYLE)
        self.bg = None
        if dark:
            path = self.s.get("char_cutout") or self.s.get("char_image")   # the cut-out blends best
            if path and os.path.exists(path):
                self.bg = QImage(path)
            else:  # the built-in suit, drawn once
                from .suit import draw_suit
                img = QImage(600, 1000, QImage.Format_ARGB32)
                img.fill(QColor(0, 0, 0, 0))
                p = QPainter(img)
                draw_suit(p, 300, 500, 960)
                p.end()
                self.bg = img
        self.update()

    def paintEvent(self, ev):
        if self.s.get("theme") != "ironman":
            return super().paintEvent(ev)
        p = QPainter(self)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        w, h = self.width(), self.height()
        g = QLinearGradient(0, 0, w, h)
        g.setColorAt(0, QColor(8, 10, 16))
        g.setColorAt(1, QColor(40, 10, 14))
        p.fillRect(self.rect(), g)
        if self.bg is not None and not self.bg.isNull():
            # Your character on the right, fading into the dark background.
            ih = h * 1.05
            iw = ih * self.bg.width() / max(1, self.bg.height())
            p.setOpacity(0.55)
            p.drawImage(QRectF(w - iw * 0.92, h - ih, iw, ih), self.bg)
            p.setOpacity(1.0)
            fade = QLinearGradient(w * 0.35, 0, w, 0)
            fade.setColorAt(0, QColor(8, 10, 16, 235))
            fade.setColorAt(1, QColor(8, 10, 16, 40))
            p.fillRect(self.rect(), fade)
        p.end()

    # ---------------------------------------------------------------- building blocks
    def _scroll(self, w):
        sa = QScrollArea()
        sa.setWidgetResizable(True)
        sa.setWidget(w)
        return sa

    def _page(self, title, subtitle):
        w = QWidget()
        w.setObjectName("page")
        v = QVBoxLayout(w)
        v.setContentsMargins(32, 28, 32, 28)
        v.setSpacing(14)
        h = QLabel(title)
        h.setObjectName("h1")
        sub = QLabel(subtitle)
        sub.setObjectName("sub")
        sub.setWordWrap(True)
        v.addWidget(h)
        v.addWidget(sub)
        return w, v

    def _card(self, v):
        card = QFrame()
        card.setObjectName("card")
        cv = QVBoxLayout(card)
        cv.setContentsMargins(18, 14, 18, 14)
        cv.setSpacing(12)
        v.addWidget(card)
        return cv

    def _row(self, cv, label, widget, hint=None):
        row = QHBoxLayout()
        left = QVBoxLayout()
        left.setSpacing(2)
        l = QLabel(label)
        l.setObjectName("rowlabel")
        left.addWidget(l)
        if hint:
            hl = QLabel(hint)
            hl.setObjectName("hint")
            hl.setWordWrap(True)
            left.addWidget(hl)
        row.addLayout(left, 1)
        widget.setMinimumWidth(230)
        row.addWidget(widget, 0, Qt.AlignRight | Qt.AlignVCenter)
        cv.addLayout(row)

    def _combo(self, key, options, on_change=None):
        c = QComboBox()
        for text, val in options:
            c.addItem(text, val)
        c.setCurrentIndex(max(0, c.findData(self.s.get(key))))

        def changed(_i):
            self.s.set(key, c.currentData())
            if on_change:
                on_change()
        c.currentIndexChanged.connect(changed)
        return c

    def _check(self, key, on_change=None):
        cb = QCheckBox()
        cb.setChecked(bool(self.s.get(key)))

        def changed(v):
            self.s.set(key, bool(v))
            if on_change:
                on_change(bool(v))
        cb.toggled.connect(changed)
        return cb

    def _slider(self, key, lo, hi):
        sl = QSlider(Qt.Horizontal)
        sl.setRange(0, 100)
        sl.setValue(int(round((float(self.s.get(key)) - lo) / (hi - lo) * 100)))
        sl.valueChanged.connect(lambda val: self.s.set(key, round(lo + (hi - lo) * val / 100, 3)))
        return sl

    def _line(self, key):
        e = QLineEdit(self.s.get(key))
        e.textChanged.connect(lambda t: self.s.set(key, t.strip()))
        return e

    def _button(self, text, fn, primary=False):
        b = QPushButton(text)
        if primary:
            b.setObjectName("primary")
        b.setCursor(Qt.PointingHandCursor)
        if fn:
            b.clicked.connect(fn)
        return b

    def _switch(self, i):
        self.pages.setCurrentIndex(i)
        self.refresh()

    # ---------------------------------------------------------------- pages
    def page_general(self):
        w, v = self._page("General", "Say “Jarvis” (or “Hey Jarvis”), click the character, or press Ctrl+Alt+J. "
                                     "Say “Jarvis, hide” to send it away.")
        cv = self._card(v)
        self.status = QLabel()
        self.status.setWordWrap(True)
        cv.addWidget(self.status)
        row = QHBoxLayout()
        row.addWidget(self._button("Talk now", self.j.talk, primary=True))
        row.addWidget(self._button("Show JARVIS", self.j.companion.appear))
        row.addWidget(self._button("Hide JARVIS", self.j.hide))
        self.listen_btn = self._button("Stop listening", lambda: self.j.set_listening(self.j.listener.paused))
        row.addWidget(self.listen_btn)
        row.addStretch()
        row.addWidget(self._button("Quit JARVIS", self._quit))
        cv.addLayout(row)

        cv = self._card(v)
        self._row(cv, "Look", self._combo("theme", [("Iron Man (dark, your character in the background)", "ironman"),
                                                   ("Light", "light")], self.apply_theme))
        self.mics = QComboBox()
        self.mics.addItem("Windows default microphone", "")
        try:
            import sounddevice as sd
            for d in sd.query_devices():
                if d.get("max_input_channels", 0) > 0 and self.mics.findData(d["name"]) < 0:
                    self.mics.addItem(d["name"], d["name"])
        except Exception:
            pass
        self.mics.setCurrentIndex(max(0, self.mics.findData(self.s.get("mic_device"))))
        self.mics.currentIndexChanged.connect(self._mic_changed)
        self._row(cv, "Microphone", self.mics, "Pick the one you talk into.")
        self.meter = QProgressBar()
        self.meter.setRange(0, 100)
        self.meter.setTextVisible(False)
        self.meter.setFixedHeight(8)
        self._row(cv, "Microphone level", self.meter, "Talk: the bar should move. If it doesn't, pick another microphone.")
        self.meter_timer = QTimer(self)
        self.meter_timer.timeout.connect(lambda: self.meter.setValue(int(min(1.0, getattr(self.j.listener, "level_now", 0) * 3) * 100)))
        self.meter_timer.start(80)
        self._row(cv, "Call me", self._line("user_title"), "How JARVIS addresses you.")
        self._row(cv, "Wake on “Jarvis” alone", self._check("wake_plain_jarvis"), "Otherwise only “Hey Jarvis”.")
        self._row(cv, "Wake sensitivity", self._slider("wake_threshold", 0.65, 0.25), "Move left if it wakes by mistake.")
        self._row(cv, "Speech recognition", self._combo("stt_model", [("English (India)", "en-in"), ("English (US)", "en-us")]),
                  "Takes effect after restarting JARVIS.")
        self._row(cv, "Extra accuracy", self._check("accurate_mode"),
                  "Double-checks commands JARVIS didn't understand the first time.")
        self._row(cv, "Listening sound", self._check("chime"), "A soft chime when JARVIS starts listening.")
        self._row(cv, "Lower other sounds while listening", self._check("duck_audio"),
                  "Turns YouTube, music and games down to 30% so JARVIS hears you clearly.")
        self._row(cv, "Start with Windows", self._check("start_with_windows",
                  lambda val: wa.set_startup(val, sys.executable) if getattr(sys, "frozen", False) else None))
        row2 = QHBoxLayout()
        row2.addWidget(self._button("Open log", lambda: wa.open_path(os.path.join(data_dir(), "jarvis.log"))))
        hint = QLabel("If something doesn't work, send me this file.")
        hint.setObjectName("hint")
        row2.addWidget(hint)
        row2.addStretch()
        v.addLayout(row2)
        v.addStretch()
        return w

    def page_voice(self):
        w, v = self._page("Voice", "JARVIS uses Windows' built-in offline voices.")
        cv = self._card(v)
        self.voices = QComboBox()
        self.voices.addItem("Automatic (Indian English male if installed)", "")
        self.voices.currentIndexChanged.connect(lambda _i: self.s.set("voice_name", self.voices.currentData() or ""))
        QTimer.singleShot(1200, self._fill_voices)
        self._row(cv, "Voice", self.voices)
        self._row(cv, "Sound", self._combo("voice_mode", [("Natural", "natural"), ("Light robotic (JARVIS)", "classic"),
                                                          ("Full robot", "robot")]))
        self._row(cv, "Reply style", self._combo("style", [("Formal (“…, sir”)", "jarvis"), ("Friendly", "friendly"),
                                                           ("Short", "short")]))
        self._row(cv, "Speaking speed", self._slider("speech_rate", 0.6, 1.8))
        self._row(cv, "Greeting", self._line("greeting"), "Said when JARVIS wakes. Leave empty to reply faster.")
        row = QHBoxLayout()
        row.addWidget(self._button("Test voice", lambda: self.j.voice.say(
            f"Hello {self.s.get('user_title')}. I'm ready when you are.")))
        row.addStretch()
        cv.addLayout(row)
        self.voice_hint = QLabel()
        self.voice_hint.setObjectName("hint")
        self.voice_hint.setWordWrap(True)
        v.addWidget(self.voice_hint)
        self.voice_help = self._button("Add the Indian English voice", lambda: wa.run("start ms-settings:speech"))
        v.addWidget(self.voice_help, 0, Qt.AlignLeft)
        v.addStretch()
        return w

    def _fill_voices(self):
        names = list(getattr(self.j.voice, "voices", []))
        for n in names:
            if self.voices.findData(n) < 0:
                self.voices.addItem(n, n)
        self.voices.setCurrentIndex(max(0, self.voices.findData(self.s.get("voice_name"))))
        has_ravi = any("ravi" in n.lower() for n in names)
        self.voice_hint.setText("" if has_ravi else
                                "The Indian English male voice (Microsoft Ravi) isn't installed yet. In Windows: Settings → "
                                "Time & language → Speech → Add voices → English (India). Then restart JARVIS.")
        self.voice_help.setVisible(not has_ravi)

    def page_character(self):
        w, v = self._page("Character", "Pick your own picture (for example your Iron Man image). JARVIS removes the "
                                       "background on this laptop and animates it.")
        cv = self._card(v)
        top = QHBoxLayout()
        self.preview = QLabel()
        self.preview.setFixedSize(220, 260)
        self.preview.setAlignment(Qt.AlignCenter)
        self.preview.setStyleSheet("background: #F3F4F6; border-radius: 10px;")
        top.addWidget(self.preview)
        side = QVBoxLayout()
        side.addWidget(self._button("Choose image…", self._choose_image, primary=True))
        side.addWidget(self._button("Use built-in suit", self._use_builtin))
        side.addWidget(self._button("Reset position", lambda: (self.s.set("char_pos", []), self.j.companion.move(
            self.j.companion.home_pos()))))
        self.cut_status = QLabel()
        self.cut_status.setObjectName("hint")
        self.cut_status.setWordWrap(True)
        side.addWidget(self.cut_status)
        side.addStretch()
        top.addLayout(side, 1)
        cv.addLayout(top)

        cv = self._card(v)
        self._row(cv, "Remove background", self._check("char_remove_bg", lambda val: self._apply_character()),
                  "Turn off to show the whole picture in a rounded frame.")
        self._row(cv, "Size", self._combo("char_size", [("Small", "small"), ("Medium", "medium"), ("Large", "large")],
                                          self._apply_character))
        self._row(cv, "Corner", self._combo("char_side", [("Bottom right", "right"), ("Bottom left", "left")],
                                            lambda: (self.s.set("char_pos", []), self._apply_character())))
        self._row(cv, "Fly-in animation", self._check("fly_animation"))
        v.addStretch()
        return w

    def _choose_image(self):
        path, _ = QFileDialog.getOpenFileName(self, "Choose your character image", os.path.expanduser("~/Pictures"),
                                              "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if not path:
            return
        dst = os.path.join(data_dir(), "character" + os.path.splitext(path)[1].lower())
        shutil.copyfile(path, dst)
        self.s.set("char_image", dst)
        self.s.set("char_cutout", "")
        self._apply_character()
        self.cut_status.setText("Removing the background…")

        def work():
            try:
                from .cutout import remove_background
                out = remove_background(dst, os.path.join(data_dir(), "character_cutout.png"))
                self.j.bus.cutout_done.emit(out)
            except Exception as e:  # keep the picture with its background
                self.j.bus.cutout_done.emit("ERROR:" + str(e))
        threading.Thread(target=work, daemon=True).start()

    def _cutout_done(self, result):
        if result.startswith("ERROR:"):
            self.cut_status.setText("Couldn't remove the background, so the whole picture is used. " + result[6:])
        else:
            self.s.set("char_cutout", result)
            self.cut_status.setText("Background removed.")
        self._apply_character()

    def _use_builtin(self):
        self.s.set("char_image", "")
        self.s.set("char_cutout", "")
        self.cut_status.setText("")
        self._apply_character()

    def _apply_character(self):
        self.j.companion.load_character()
        self.apply_theme()
        if self.j.companion.isVisible():
            self.j.companion.move(self.j.companion.home_pos())
        self._refresh_preview()

    def _refresh_preview(self):
        c = self.j.companion
        if c.pixmap:
            self.preview.setPixmap(c.pixmap.scaled(210, 250, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            self.preview.setText("Built-in suit")

    def page_text(self, title, subtitle, key):
        w, v = self._page(title, subtitle)
        e = QPlainTextEdit(self.s.get(key))
        e.setFont(QFont("Consolas", 10))
        e.setMinimumHeight(320)
        v.addWidget(e)
        save = self._button("Save", None, primary=True)
        save.clicked.connect(lambda: (self.s.set(key, e.toPlainText()), save.setText("Saved"),
                                      QTimer.singleShot(1400, lambda: save.setText("Save"))))
        v.addWidget(save, 0, Qt.AlignLeft)
        v.addStretch()
        return w

    def page_memory(self):
        w, v = self._page("Memory", "Things you asked JARVIS to remember. Say “remember MediaAI is my main project”.")
        cv = self._card(v)
        self.mem = QLabel()
        self.mem.setWordWrap(True)
        self.mem.setTextInteractionFlags(Qt.TextSelectableByMouse)
        cv.addWidget(self.mem)
        v.addWidget(self._button("Forget everything", self._clear_memory), 0, Qt.AlignLeft)
        v.addStretch()
        return w

    def page_activity(self):
        w, v = self._page("Activity", "What you said recently and how JARVIS replied. Everything stays on this laptop.")
        cv = self._card(v)
        self.log = QLabel()
        self.log.setWordWrap(True)
        self.log.setTextInteractionFlags(Qt.TextSelectableByMouse)
        cv.addWidget(self.log)
        v.addStretch()
        return w

    # ---------------------------------------------------------------- refresh
    def _mic_changed(self, _i):
        self.s.set("mic_device", self.mics.currentData() or "")
        self.j.listener.reopen = True        # reconnect to the new microphone

    def _quit(self):
        if QMessageBox.question(self, "JARVIS", "Quit JARVIS? It won't listen until you open it again.") == QMessageBox.Yes:
            self.j.quit()

    def refresh_status(self):
        st = self.j.engine_status
        paused = getattr(self.j.listener, "paused", False)
        if hasattr(self, "listen_btn"):
            self.listen_btn.setText("Start listening" if paused else "Stop listening")
        if paused:
            self.status.setText("<span style='color:#9CA3AF'>●</span>&nbsp; Not listening for “Jarvis”. "
                                "Ctrl+Alt+J or “Talk now” still work.")
        elif st == "listening":
            self.status.setText("<span style='color:#16A34A'>●</span>&nbsp; Ready. Listening for “Jarvis”.")
        else:
            self.status.setText(f"<span style='color:#D97706'>●</span>&nbsp; {st}")

    def refresh(self):
        self.refresh_status()
        mem = [f"{k} → {v}" for k, v in self.s.get("memory").items()] + [f"Note: {n}" for n in self.s.get("notes")]
        self.mem.setText("\n".join(mem) or "Nothing yet.")
        entries = list(reversed(self.s.get("log")))[:40]
        self.log.setText("\n\n".join(f"{e['t']}   “{e['heard']}”\n{e['reply']}" for e in entries) or "Nothing yet.")
        self._refresh_preview()

    def _clear_memory(self):
        if QMessageBox.question(self, "JARVIS", "Forget everything JARVIS remembers?") == QMessageBox.Yes:
            self.s.set("memory", {})
            self.s.set("notes", [])
            self.refresh()

    def closeEvent(self, ev):
        ev.ignore()
        self.hide()
