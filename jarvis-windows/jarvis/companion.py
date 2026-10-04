"""The on-screen companion: your character flies across the screen, lands in a corner and stays
there next to a small, clean reply card. "Jarvis, hide" sends it flying away.

Click the character to talk, drag it to move it, right-click for the menu."""
import math
import os
import time

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import (QBrush, QColor, QFont, QFontMetrics, QGuiApplication, QImage, QLinearGradient, QPainter,
                           QPainterPath, QPen, QPixmap, QRadialGradient)
from PySide6.QtWidgets import QWidget

from .suit import draw_suit

HIDDEN, FLY_IN, IDLE, FLY_OUT = "hidden", "in", "idle", "out"
INK = QColor(17, 24, 39)
MUTED = QColor(107, 114, 128)
ACCENT = QColor(37, 99, 235)
CARD = QColor(255, 255, 255, 246)
GLOW = QColor(56, 189, 248)


def bezier(p, t):
    u = 1 - t
    return (u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0],
            u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1])


class Companion(QWidget):
    clicked = Signal()
    menu_requested = Signal(QPoint)
    moved = Signal(int, int)

    CARD_W = 300

    def __init__(self, store):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.store = store
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setFocusPolicy(Qt.NoFocus)
        self.phase = HIDDEN
        self.t0 = time.time()
        self.phase_start = 0.0
        self.level = self.shown_level = self.mic = 0.0
        self.mode = "idle"            # idle | listening | thinking | speaking
        self.heard = self.answer = self.display = ""
        self.card_until = 0.0
        self.tilt = 0.0
        self.scale = 1.0
        self.thrust = 0.0
        self.trail = []
        self.vel = (0.0, 0.0)
        self.path = None
        self.on_hidden = None
        self._drag = None
        self._press_pos = None
        self.pixmap = None
        self.cutout = True
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.load_character()

    # ---------------------------------------------------------------- character
    def char_height(self):
        scr = QGuiApplication.primaryScreen().availableGeometry()
        frac = {"small": 0.26, "medium": 0.34, "large": 0.44}.get(self.store.get("char_size"), 0.34)
        return int(scr.height() * frac)

    def load_character(self):
        """The user's image (background removed when available) or the built-in suit."""
        self.pixmap = None
        path = self.store.get("char_cutout") if self.store.get("char_remove_bg") else ""
        path = path if path and os.path.exists(path) else self.store.get("char_image")
        if path and os.path.exists(path):
            img = QImage(path)
            if not img.isNull():
                self.pixmap = QPixmap.fromImage(img)
                self.cutout = img.hasAlphaChannel() and path == self.store.get("char_cutout")
        self._layout()

    def char_size(self):
        h = self.char_height()
        if self.pixmap:
            w = int(h * self.pixmap.width() / max(1, self.pixmap.height()))
            return min(w, int(h * 1.1)), h
        return int(h * 0.62), h

    def _layout(self, flying=False):
        """Normal: card + character. Flying: a larger window around the character, so it can be
        drawn bigger (close to the camera) with its motion trail and thrusters."""
        cw, ch = self.char_size()
        if flying:
            m = int(ch * 0.55)
            w, h = int(cw * self.MAX_SCALE + 2 * m), int(ch * self.MAX_SCALE + 2 * m)
            self.char_rect = QRectF((w - cw) / 2, (h - ch) / 2, cw, ch)
            self.resize(w, h)
            return
        pad = 40
        self.char_rect = QRectF(self.CARD_W + 16 + pad / 2, pad, cw, ch)
        if self.store.get("char_side") == "left":
            self.char_rect.moveLeft(pad / 2)
        self.resize(int(self.CARD_W + 16 + cw + pad), int(ch + pad * 2))

    MAX_SCALE = 1.7

    def home_pos(self):
        scr = QGuiApplication.primaryScreen().availableGeometry()
        cw, ch = self.char_size()
        w, h = int(self.CARD_W + 16 + cw + 40), int(ch + 80)
        saved = self.store.get("char_pos")
        if saved and len(saved) == 2:
            x, y = saved
            if scr.contains(QPoint(int(x) + 40, int(y) + 40)):
                return QPoint(int(x), int(y))
        if self.store.get("char_side") == "left":
            return QPoint(scr.left() + 8, scr.bottom() - h + 18)
        return QPoint(scr.right() - w + 8, scr.bottom() - h + 18)

    def _char_origin(self):
        """Where the character's top-left sits on screen when resting at home."""
        self._layout(False)
        home = self.home_pos()
        return QPointF(home.x() + self.char_rect.x(), home.y() + self.char_rect.y())

    # ---------------------------------------------------------------- show / hide
    def appear(self):
        if self.phase in (FLY_IN, IDLE):
            self.raise_()
            return
        target = self._char_origin()
        scr = QGuiApplication.primaryScreen().geometry()
        self.trail = []
        if self.store.get("fly_animation"):
            self._layout(True)
            ox, oy = self.char_rect.x(), self.char_rect.y()
            ex, ey = target.x() - ox, target.y() - oy           # flight-window position when landed
            from_left = target.x() > scr.center().x()
            sx = scr.left() - self.width() * 0.6 if from_left else scr.right() - self.width() * 0.4
            # Swoop in from the upper corner, dive across the middle of the screen, curl up into the corner.
            self.path = [(sx, scr.top() - self.height() * 0.3),
                         (scr.center().x() - self.width() / 2 + (-1 if from_left else 1) * scr.width() * 0.1, scr.top() + scr.height() * 0.45),
                         (ex + (-1 if from_left else 1) * scr.width() * 0.25, ey + scr.height() * 0.15),
                         (ex, ey)]
            self.phase = FLY_IN
            self.move(int(self.path[0][0]), int(self.path[0][1]))
        else:
            self._layout(False)
            self.phase = IDLE
            self.move(self.home_pos())
        self.phase_start = time.time()
        self.show()
        self.raise_()
        self.timer.start(16)

    def leave(self):
        if self.phase in (HIDDEN, FLY_OUT):
            return
        scr = QGuiApplication.primaryScreen().geometry()
        glob = QPointF(self.x() + self.char_rect.x(), self.y() + self.char_rect.y())
        self._layout(True)
        sx, sy = glob.x() - self.char_rect.x(), glob.y() - self.char_rect.y()
        self.move(int(sx), int(sy))
        right = sx > scr.center().x()
        self.trail = []
        # Crouch, then blast off upward and away.
        self.path = [(sx, sy), (sx, sy - scr.height() * 0.25), (sx + (-1 if right else 1) * scr.width() * 0.2, scr.top() - self.height() * 0.2),
                     (sx + (-1 if right else 1) * scr.width() * 0.45, scr.top() - self.height() * 1.4)]
        self.phase = FLY_OUT
        self.phase_start = time.time()
        self.card_until = 0

    def visible_companion(self):
        return self.phase in (FLY_IN, IDLE)

    # ---------------------------------------------------------------- state from the app
    def set_level(self, v):
        self.level = v

    def set_mic(self, v):
        self.mic = v

    def show_card(self, seconds=8.0):
        self.card_until = time.time() + seconds

    # ---------------------------------------------------------------- animation
    FLY_IN_TIME = 2.1
    FLY_OUT_TIME = 1.4

    def _tick(self):
        now = time.time()
        el = now - self.phase_start
        if self.phase in (FLY_IN, FLY_OUT):
            dur = self.FLY_IN_TIME if self.phase == FLY_IN else self.FLY_OUT_TIME
            t = min(1.0, el / dur)
            # Fly in: fast, then braking for the landing. Fly out: slow lift-off, then accelerate.
            e = (1 - (1 - t) ** 3) if self.phase == FLY_IN else t ** 2.2
            x, y = bezier(self.path, e)
            nx, ny = bezier(self.path, min(1.0, e + 0.02))
            self.vel = (nx - x, ny - y)
            speed = math.hypot(*self.vel)
            heading = math.degrees(math.atan2(self.vel[0], -self.vel[1])) if speed > 0.5 else 0
            if self.phase == FLY_IN:
                upright = max(0.0, (t - 0.72) / 0.28)            # straighten up for the landing
                self.tilt = max(-70, min(70, heading)) * (1 - upright)
                self.scale = 1 + (self.MAX_SCALE - 1) * (1 - e) ** 1.6   # close to the camera, then away
                self.thrust = 1.0 - 0.6 * upright
            else:
                self.tilt = max(-55, min(55, heading)) * min(1.0, t * 3)
                self.scale = 1 + 0.25 * t
                self.thrust = 0.6 + 0.4 * min(1.0, t * 4)
            self.trail = ([(x, y)] + getattr(self, "trail", []))[:7]
            self.move(int(x), int(y))
            if t >= 1:
                if self.phase == FLY_IN:
                    self.phase, self.phase_start = IDLE, now
                    self.tilt, self.scale, self.thrust, self.trail = 0.0, 1.0, 0.0, []
                    self._layout(False)
                    self.move(self.home_pos())
                else:
                    self.phase = HIDDEN
                    self.timer.stop()
                    self.hide()
                    if self.on_hidden:
                        self.on_hidden()
                    return
        else:
            self.tilt = math.sin(now * 0.8) * 1.5
            self.scale, self.thrust = 1.0, 0.0
        self.shown_level += (self.level - self.shown_level) * 0.4
        self.update()

    # ---------------------------------------------------------------- painting
    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        now = time.time()
        flying = self.phase in (FLY_IN, FLY_OUT)
        bob = 0 if flying else math.sin((now - self.t0) * 1.6) * 6
        r = QRectF(self.char_rect)
        scale = getattr(self, "scale", 1.0)
        if scale != 1.0:
            c = r.center()
            r = QRectF(c.x() - r.width() * scale / 2, c.y() - r.height() * scale / 2, r.width() * scale, r.height() * scale)
        r.translate(0, bob)
        talk = self.shown_level if self.mode == "speaking" else 0.0
        if flying:
            self._trail(p, r)
            self._thrusters(p, r, now)
        self._aura(p, r, talk, flying)
        if self.pixmap:
            self._draw_image(p, r, talk, flying)
        else:
            draw_suit(p, r.center().x(), r.center().y(), r.height(), t=now - self.t0, level=talk,
                      thrust=getattr(self, "thrust", 0) if flying else 0.25 + 0.08 * math.sin(now * 6), tilt=self.tilt,
                      palm=0.5 + 0.5 * max(talk, self.mic if self.mode == "listening" else 0))
        if not flying and (self.mode != "idle" or now < self.card_until):
            self._card(p, now)
        p.end()

    def _trail(self, p, r):
        """Motion blur: faded copies where the character was a moment ago."""
        if not self.pixmap or len(self.trail) < 2:
            return
        cx, cy = self.trail[0]
        for k, (tx, ty) in enumerate(self.trail[1:], start=1):
            dx, dy = tx - cx, ty - cy
            if abs(dx) + abs(dy) < 2:
                continue
            p.save()
            p.setOpacity(0.22 * (1 - k / len(self.trail)))
            p.translate(r.center().x() + dx, r.center().y() + dy)
            p.rotate(self.tilt)
            p.drawPixmap(QRectF(-r.width() / 2, -r.height() / 2, r.width(), r.height()), self.pixmap, QRectF(self.pixmap.rect()))
            p.restore()

    def _thrusters(self, p, r, now):
        """Repulsor jets from both boots (and a glow at the palms), pointing away from the direction of travel."""
        thrust = getattr(self, "thrust", 1.0)
        if thrust <= 0.02 or not self.pixmap:
            return
        p.save()
        p.translate(r.center())
        p.rotate(self.tilt)
        flick = 0.85 + 0.15 * math.sin(now * 47)
        length = r.height() * 0.32 * thrust * flick
        for fx in (-0.17, 0.17):
            x0, y0 = fx * r.width(), r.height() * 0.47
            g = QLinearGradient(QPointF(x0, y0), QPointF(x0, y0 + length))
            g.setColorAt(0.0, QColor(255, 255, 255, 240))
            g.setColorAt(0.18, QColor(165, 243, 252, 220))
            g.setColorAt(0.55, QColor(56, 189, 248, 120))
            g.setColorAt(1.0, QColor(14, 116, 244, 0))
            w = r.width() * 0.09
            path = QPainterPath()
            path.moveTo(x0 - w / 2, y0)
            path.quadTo(x0 - w * 0.7, y0 + length * 0.45, x0, y0 + length)
            path.quadTo(x0 + w * 0.7, y0 + length * 0.45, x0 + w / 2, y0)
            p.setPen(Qt.NoPen)
            p.setBrush(QBrush(g))
            p.drawPath(path)
            core = QRadialGradient(QPointF(x0, y0 + 4), w * 0.9)
            core.setColorAt(0, QColor(255, 255, 255, 230))
            core.setColorAt(1, QColor(125, 211, 252, 0))
            p.setBrush(QBrush(core))
            p.drawEllipse(QPointF(x0, y0 + 4), w * 0.9, w * 0.9)
        for hx in (-0.42, 0.42):                                   # palm repulsors
            glow = QRadialGradient(QPointF(hx * r.width(), r.height() * 0.05), r.width() * 0.09)
            glow.setColorAt(0, QColor(255, 255, 255, int(200 * thrust)))
            glow.setColorAt(1, QColor(125, 211, 252, 0))
            p.setBrush(QBrush(glow))
            p.drawEllipse(QPointF(hx * r.width(), r.height() * 0.05), r.width() * 0.09, r.width() * 0.09)
        p.restore()

    def _aura(self, p, r, talk, flying):
        c = r.center()
        rad = r.height() * (0.42 + 0.05 * talk)
        strength = 0.18 + 0.35 * talk + (0.25 if self.mode == "listening" else 0)
        g = QRadialGradient(QPointF(c.x(), c.y() + r.height() * 0.05), rad)
        g.setColorAt(0, QColor(GLOW.red(), GLOW.green(), GLOW.blue(), int(110 * strength)))
        g.setColorAt(1, QColor(GLOW.red(), GLOW.green(), GLOW.blue(), 0))
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(g))
        p.drawEllipse(QPointF(c.x(), c.y() + r.height() * 0.05), rad * 0.75, rad)

    def _draw_image(self, p, r, talk, flying):
        p.save()
        p.translate(r.center())
        p.rotate(self.tilt)
        s = 1.0 + 0.012 * talk
        p.scale(s, s)
        target = QRectF(-r.width() / 2, -r.height() / 2, r.width(), r.height())
        if self.cutout:
            p.drawPixmap(target, self.pixmap, QRectF(self.pixmap.rect()))
        else:
            # A full picture (background kept): show it as a rounded, softly framed portrait.
            path = QPainterPath()
            path.addRoundedRect(target, 18, 18)
            p.setClipPath(path)
            p.drawPixmap(target, self.pixmap, QRectF(self.pixmap.rect()))
            p.setClipping(False)
            p.setPen(QPen(QColor(255, 255, 255, 180), 2))
            p.setBrush(Qt.NoBrush)
            p.drawPath(path)
        p.restore()

    def _card(self, p, now):
        x = 4 if self.store.get("char_side") != "left" else self.char_rect.right() + 12
        w = self.CARD_W
        fm_main = QFont("Segoe UI", 11)
        fm_small = QFont("Segoe UI", 9)
        status = {"listening": "Listening", "thinking": "Working on it", "speaking": "JARVIS"}.get(self.mode, "JARVIS")
        body = self.answer if self.mode in ("speaking", "idle") else ""
        heard = self.heard
        lines_h = 0
        main_metrics = QFontMetrics(fm_main)
        body_rect = main_metrics.boundingRect(0, 0, w - 32, 400, Qt.TextWordWrap, body) if body else QRectF()
        disp = self.display if self.mode in ("speaking", "idle") else ""
        disp_rect = QFontMetrics(fm_small).boundingRect(0, 0, w - 32, 400, Qt.TextWordWrap, disp) if disp else QRectF()
        h = 44 + (24 if heard else 0) + (body_rect.height() + 8 if body else 0) + (disp_rect.height() + 10 if disp else 0) + 8
        y = self.char_rect.bottom() - h - 10
        card = QRectF(x, max(4, y), w, h)
        # Soft shadow, then the card.
        for i, a in ((6, 18), (3, 26), (1, 34)):
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(0, 0, 0, a))
            p.drawRoundedRect(card.adjusted(-i, -i + 2, i, i + 2), 16 + i, 16 + i)
        p.setBrush(CARD)
        p.drawRoundedRect(card, 16, 16)
        # Status row: coloured dot + label (+ animated bars while listening).
        cx, cy = card.x() + 18, card.y() + 22
        dot = ACCENT if self.mode in ("listening", "speaking") else MUTED
        p.setBrush(dot)
        p.drawEllipse(QPointF(cx, cy), 4, 4)
        f = QFont("Segoe UI Semibold", 10)
        p.setFont(f)
        p.setPen(INK)
        p.drawText(QRectF(cx + 12, cy - 10, 200, 20), Qt.AlignVCenter | Qt.AlignLeft, status)
        if self.mode in ("listening", "thinking"):
            for k in range(4):
                amp = (self.mic if self.mode == "listening" else 0.5) * (0.5 + 0.5 * math.sin(now * 9 + k * 1.3))
                bh = 4 + 12 * amp
                p.setPen(Qt.NoPen)
                p.setBrush(ACCENT)
                p.drawRoundedRect(QRectF(card.right() - 54 + k * 9, cy - bh / 2, 5, bh), 2, 2)
        yy = card.y() + 40
        if heard:
            p.setFont(fm_small)
            p.setPen(MUTED)
            p.drawText(QRectF(card.x() + 16, yy, w - 32, 20), Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetrics(fm_small).elidedText(f"“{heard}”", Qt.ElideRight, int(w - 32)))
            yy += 24
        if body:
            p.setFont(fm_main)
            p.setPen(INK)
            p.drawText(QRectF(card.x() + 16, yy, w - 32, body_rect.height() + 4), Qt.TextWordWrap, body)
            yy += body_rect.height() + 8
        if disp:
            p.setPen(QPen(QColor(229, 231, 235), 1))
            p.drawLine(QPointF(card.x() + 16, yy), QPointF(card.right() - 16, yy))
            p.setFont(fm_small)
            p.setPen(MUTED)
            p.drawText(QRectF(card.x() + 16, yy + 6, w - 32, disp_rect.height() + 4), Qt.TextWordWrap, disp)

    # ---------------------------------------------------------------- mouse: click to talk, drag to move
    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._drag = e.globalPosition().toPoint() - self.pos()
            self._press_pos = e.globalPosition().toPoint()
        elif e.button() == Qt.RightButton:
            self.menu_requested.emit(e.globalPosition().toPoint())

    def mouseMoveEvent(self, e):
        if self._drag is not None and self.phase == IDLE:
            self.move(e.globalPosition().toPoint() - self._drag)

    def mouseReleaseEvent(self, e):
        if e.button() != Qt.LeftButton or self._press_pos is None:
            return
        moved = (e.globalPosition().toPoint() - self._press_pos).manhattanLength() > 6
        self._drag = self._press_pos = None
        if moved:
            self.store.set("char_pos", [self.x(), self.y()])
        else:
            self.clicked.emit()
