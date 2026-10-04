"""The full-screen see-through overlay: the suit flies across the screen, hovers in the centre with
the HUD around it, then flies away. Clicks pass straight through to your apps."""
import datetime
import math
import time

from PySide6.QtCore import QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen, QRadialGradient, QBrush
from PySide6.QtWidgets import QWidget

from . import stats
from .suit import draw_suit

CYAN = QColor(0, 229, 255)
GOLD = QColor(255, 200, 87)
TEXT = QColor(230, 251, 255)
DIM = QColor(127, 184, 196)
RED = QColor(255, 83, 112)

FLY_IN, HOVER, FLY_OUT, HIDDEN = "in", "hover", "out", "hidden"


def bezier(p, t):
    """Point on a cubic Bezier curve p = [p0, p1, p2, p3]."""
    u = 1 - t
    x = u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0]
    y = u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1]
    return x, y


def ease_out(t):
    return 1 - (1 - t) ** 3


class Overlay(QWidget):
    def __init__(self, store):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool | Qt.WindowTransparentForInput)
        self.store = store
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_NoSystemBackground)
        self.phase = HIDDEN
        self.phase_start = 0.0
        self.level = 0.0
        self.shown_level = 0.0
        self.mic = 0.0
        self.status = ""
        self.heard = ""
        self.answer = ""
        self.display = ""
        self.mode = "idle"           # idle | listening | thinking | speaking
        self.on_hidden = None
        self.snap = stats.snapshot()
        self.net = stats.NetSpeed()
        self.net_text = ("", "")
        self.screen_time = None
        self.reminders = lambda: []
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.stat_timer = QTimer(self)
        self.stat_timer.timeout.connect(self._refresh_stats)
        self.t0 = time.time()
        self.path = None
        self.exit_path = None
        self.suit_pos = (0.0, 0.0)
        self.suit_tilt = 0.0

    # ---------------------------------------------------------------- control
    def appear(self):
        from PySide6.QtGui import QGuiApplication
        g = QGuiApplication.primaryScreen().geometry()
        self.setGeometry(g)
        w, h = g.width(), g.height()
        cx, cy = w / 2, h * 0.44
        self.heard = self.answer = self.display = ""
        self._refresh_stats()
        if self.phase in (HOVER, FLY_IN):
            return
        if self.store.get("fly_animation"):
            # Enter from the bottom-left corner, sweep high across the screen, curl back to the centre.
            self.path = [(-0.15 * w, h * 1.15), (w * 0.35, h * 0.05), (w * 1.05, h * 0.05), (cx, cy)]
            self.phase = FLY_IN
        else:
            self.phase = HOVER
        self.phase_start = time.time()
        self.show()
        self.raise_()
        self.timer.start(16)
        self.stat_timer.start(2000)

    def leave(self):
        if self.phase in (HIDDEN, FLY_OUT):
            return
        w, h = self.width(), self.height()
        x, y = self.suit_pos
        self.exit_path = [(x, y), (x + w * 0.1, y - h * 0.2), (w * 0.9, -h * 0.1), (w * 1.2, -h * 0.5)]
        self.phase = FLY_OUT
        self.phase_start = time.time()

    def set_level(self, v):
        self.level = v

    def set_mic(self, v):
        self.mic = v

    # ---------------------------------------------------------------- animation
    def _refresh_stats(self):
        self.snap = stats.snapshot()
        d, u = self.net.update()
        self.net_text = (stats.speed(d), stats.speed(u))

    def _tick(self):
        now = time.time()
        el = now - self.phase_start
        w, h = self.width(), self.height()
        cx, cy = w / 2, h * 0.44
        if self.phase == FLY_IN:
            dur = 2.4
            t = min(1.0, el / dur)
            e = ease_out(t)
            x, y = bezier(self.path, e)
            nx, ny = bezier(self.path, min(1.0, e + 0.02))
            heading = math.degrees(math.atan2(nx - x, -(ny - y)))      # 0 = straight up
            self.suit_tilt = max(-70, min(70, heading)) * (1 - t) ** 0.6
            self.suit_pos = (x, y)
            if t >= 1:
                self.phase, self.phase_start = HOVER, now
        elif self.phase == HOVER:
            self.suit_pos = (cx + math.sin(now * 0.9) * 6, cy + math.sin(now * 1.7) * 9)
            self.suit_tilt = math.sin(now * 0.8) * 2
        elif self.phase == FLY_OUT:
            t = min(1.0, el / 1.3)
            e = t * t
            x, y = bezier(self.exit_path, e)
            self.suit_tilt = 35 * e
            self.suit_pos = (x, y)
            if t >= 1:
                self.phase = HIDDEN
                self.timer.stop()
                self.stat_timer.stop()
                self.hide()
                if self.on_hidden:
                    self.on_hidden()
                return
        self.shown_level += (self.level - self.shown_level) * 0.4
        self.update()

    def hud_alpha(self):
        now = time.time()
        if self.phase == HOVER:
            return min(1.0, (now - self.phase_start) / 0.6)
        if self.phase == FLY_OUT:
            return max(0.0, 1 - (now - self.phase_start) / 0.4)
        if self.phase == FLY_IN:
            return max(0.0, ((now - self.phase_start) - 1.9) / 0.5)
        return 0.0

    # ---------------------------------------------------------------- painting
    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        now = time.time()
        a = self.hud_alpha()
        # Dim the screen a little so the HUD reads, but keep your work visible.
        if a > 0:
            p.fillRect(self.rect(), QColor(0, 8, 16, int(150 * a)))
        x, y = self.suit_pos
        suit_h = h * 0.56
        if a > 0:
            self._rings(p, x, y, suit_h, now, a)
        flying = self.phase in (FLY_IN, FLY_OUT)
        thrust = 1.0 if flying else 0.28 + 0.1 * math.sin(now * 6)
        if flying:
            self._trail(p, x, y, suit_h)
        talk = self.shown_level if self.mode == "speaking" else 0.0
        draw_suit(p, x, y, suit_h, t=now - self.t0, level=talk, thrust=thrust, tilt=self.suit_tilt,
                  palm=0.5 + 0.5 * (self.mic if self.mode == "listening" else talk))
        if a > 0:
            p.setOpacity(a)
            self._panels(p, w, h, now)
            p.setOpacity(1.0)
        p.end()

    def _trail(self, p, x, y, suit_h):
        g = QRadialGradient(QPointF(x, y + suit_h * 0.45), suit_h * 0.35)
        g.setColorAt(0, QColor(120, 230, 255, 90))
        g.setColorAt(1, QColor(0, 160, 255, 0))
        p.setBrush(QBrush(g))
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(x, y + suit_h * 0.45), suit_h * 0.35, suit_h * 0.35)

    def _rings(self, p, x, y, suit_h, now, a):
        speed = 3.0 if self.mode == "thinking" else 1.6 if self.mode == "listening" else 1.0
        base = suit_h * 0.62
        # Floor platform under the suit, like the hangar pad.
        p.setPen(QPen(QColor(0, 229, 255, int(170 * a)), 3))
        p.setBrush(QBrush(QColor(0, 229, 255, int(25 * a))))
        p.drawEllipse(QPointF(x, y + suit_h * 0.53), base * 0.75, base * 0.12)
        p.setPen(QPen(QColor(255, 255, 255, int(120 * a)), 1.5))
        p.drawEllipse(QPointF(x, y + suit_h * 0.53), base * 0.55, base * 0.085)
        for i, (r, segs, w, col) in enumerate(((base, 6, 3, CYAN), (base * 0.9, 9, 2, GOLD), (base * 0.82, 4, 5, CYAN))):
            rot = (1 if i % 2 == 0 else -1) * (now - self.t0) * (20 + i * 12) * speed
            c = QColor(col)
            c.setAlpha(int((200 if i != 1 else 160) * a))
            p.setPen(QPen(c, w, Qt.SolidLine, Qt.RoundCap))
            p.setBrush(Qt.NoBrush)
            rect = QRectF(x - r, y - r, 2 * r, 2 * r)
            sweep = 360 / segs
            for k in range(segs):
                p.drawArc(rect, int((rot + k * sweep) * 16), int(sweep * (0.35 if i == 2 else 0.62) * 16))
        if self.mode == "listening":
            p.setPen(QPen(QColor(255, 200, 87, int(220 * a)), 3))
            r = base * (0.74 + self.mic * 0.08)
            p.drawEllipse(QPointF(x, y), r, r)

    def _panel(self, p, rect, title):
        path = QPainterPath()
        path.addRoundedRect(rect, 12, 12)
        p.setPen(QPen(QColor(0, 229, 255, 110), 1.4))
        p.setBrush(QColor(2, 20, 31, 175))
        p.drawPath(path)
        p.setPen(GOLD)
        f = QFont("Bahnschrift", 10)
        f.setBold(True)
        f.setLetterSpacing(QFont.AbsoluteSpacing, 3)
        p.setFont(f)
        p.drawText(QRectF(rect.x() + 16, rect.y() + 10, rect.width() - 32, 20), Qt.AlignLeft, title)

    def _bar(self, p, x, y, w, label, value, frac):
        p.setFont(QFont("Bahnschrift", 10))
        p.setPen(DIM)
        p.drawText(QRectF(x, y, w, 18), Qt.AlignLeft, label)
        p.setPen(TEXT)
        p.drawText(QRectF(x, y, w, 18), Qt.AlignRight, value)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 229, 255, 50))
        p.drawRoundedRect(QRectF(x, y + 22, w, 6), 3, 3)
        frac = max(0.0, min(1.0, frac))
        p.setBrush(RED if frac > 0.9 else GOLD if frac > 0.7 else CYAN)
        p.drawRoundedRect(QRectF(x, y + 22, max(6, w * frac), 6), 3, 3)

    def _panels(self, p, w, h, now):
        m = max(24, w * 0.025)
        pw = min(380, w * 0.24)
        # Time and date (top left).
        dt = datetime.datetime.now()
        p.setPen(TEXT)
        p.setFont(QFont("Bahnschrift Light", 54))
        p.drawText(QRectF(m, m, pw * 1.4, 80), Qt.AlignLeft, dt.strftime("%I:%M").lstrip("0"))
        p.setPen(DIM)
        f = QFont("Bahnschrift", 13)
        f.setLetterSpacing(QFont.AbsoluteSpacing, 2)
        p.setFont(f)
        p.drawText(QRectF(m, m + 82, pw * 1.6, 24), Qt.AlignLeft, dt.strftime("%A, %d %B").upper())
        hour = dt.hour
        greet = "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"
        p.setPen(CYAN)
        p.drawText(QRectF(m, m + 110, pw * 1.6, 24), Qt.AlignLeft, f"{greet}, {self.store.get('user_title')}.")

        # System (right).
        s = self.snap
        rect = QRectF(w - m - pw, m, pw, 252)
        self._panel(p, rect, "SYSTEM")
        x, y, bw = rect.x() + 16, rect.y() + 40, pw - 32
        self._bar(p, x, y, bw, "CPU", f"{s['cpu']:.0f}%", s["cpu"] / 100)
        self._bar(p, x, y + 40, bw, "RAM", f"{stats.gb(s['ram_used'])} / {stats.gb(s['ram_total'])}", s["ram_pct"] / 100)
        self._bar(p, x, y + 80, bw, "DISK", f"{stats.gb(s['disk_used'])} / {stats.gb(s['disk_total'])}", s["disk_pct"] / 100)
        if s["battery"] is not None:
            self._bar(p, x, y + 120, bw, "BATTERY", f"{'⚡ ' if s['plugged'] else ''}{s['battery']}%", s["battery"] / 100)
        p.setPen(DIM)
        p.setFont(QFont("Bahnschrift", 10))
        up = stats.duration(s["uptime"])
        p.drawText(QRectF(x, y + 165, bw, 36), Qt.AlignLeft | Qt.TextWordWrap,
                   f"NET ↓ {self.net_text[0]}  ↑ {self.net_text[1]}\nUPTIME {up}")

        # Screen time and reminders (right, below).
        rect2 = QRectF(w - m - pw, m + 268, pw, 210)
        self._panel(p, rect2, "SCREEN TIME TODAY")
        day = self.screen_time.today() if self.screen_time else {}
        total = sum(day.values())
        p.setPen(TEXT)
        p.setFont(QFont("Bahnschrift Light", 22))
        p.drawText(QRectF(rect2.x() + 16, rect2.y() + 34, pw, 34), Qt.AlignLeft, stats.duration(total))
        limits = self.store.limits()
        yy = rect2.y() + 76
        for app, secs in sorted(day.items(), key=lambda kv: -kv[1])[:3]:
            lim = next((v for k, v in limits.items() if k in app.lower()), None)
            frac = secs / (lim * 60) if lim else secs / max(total, 1)
            self._bar(p, rect2.x() + 16, yy, pw - 32, app.upper(), stats.duration(secs) + (f" / {lim}m" if lim else ""), frac)
            yy += 40

        rems = sorted(self.reminders(), key=lambda r: r["at"])[:3]
        rect3 = QRectF(m, m + 160, pw, 46 + 26 * max(1, len(rems)))
        self._panel(p, rect3, "REMINDERS")
        p.setFont(QFont("Bahnschrift", 11))
        p.setPen(TEXT if rems else DIM)
        if not rems:
            p.drawText(QRectF(rect3.x() + 16, rect3.y() + 38, pw - 32, 22), Qt.AlignLeft, "Nothing scheduled.")
        for k, r in enumerate(rems):
            when = datetime.datetime.fromtimestamp(r["at"]).strftime("%I:%M %p").lstrip("0")
            p.drawText(QRectF(rect3.x() + 16, rect3.y() + 38 + 26 * k, pw - 32, 22), Qt.AlignLeft,
                       f"{when}  {r['text'].replace('Reminder: ', '')}"[:44])

        # Status, what you said, and the answer (bottom centre).
        status = {"listening": "LISTENING", "thinking": "PROCESSING", "speaking": "J.A.R.V.I.S."}.get(self.mode, self.status.upper())
        p.setPen(CYAN)
        f = QFont("Bahnschrift", 13)
        f.setBold(True)
        f.setLetterSpacing(QFont.AbsoluteSpacing, 6)
        p.setFont(f)
        p.drawText(QRectF(0, h - 190, w, 26), Qt.AlignHCenter, status)
        if self.heard:
            p.setPen(DIM)
            p.setFont(QFont("Bahnschrift", 15))
            p.drawText(QRectF(w * 0.15, h - 160, w * 0.7, 28), Qt.AlignHCenter, f"“{self.heard}”")
        if self.answer:
            p.setPen(TEXT)
            p.setFont(QFont("Bahnschrift", 19))
            p.drawText(QRectF(w * 0.15, h - 126, w * 0.7, 70), Qt.AlignHCenter | Qt.TextWordWrap, self.answer)
        if self.display:
            rect4 = QRectF(m, h * 0.45, pw, 220)
            self._panel(p, rect4, "INFO")
            p.setPen(TEXT)
            p.setFont(QFont("Bahnschrift", 11))
            p.drawText(rect4.adjusted(16, 36, -16, -12), Qt.AlignLeft | Qt.TextWordWrap, self.display)
        p.setPen(DIM)
        p.setFont(QFont("Bahnschrift", 10))
        p.drawText(QRectF(0, h - 40, w, 20), Qt.AlignHCenter, "Say \"stop\" to close · Ctrl+Alt+J to talk")
