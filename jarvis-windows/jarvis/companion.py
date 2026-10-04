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

    def _layout(self):
        cw, ch = self.char_size()
        pad = 40
        self.char_rect = QRectF(self.CARD_W + 16 + pad / 2, pad, cw, ch)
        self.resize(int(self.CARD_W + 16 + cw + pad), int(ch + pad * 2))
        if self.store.get("char_side") == "left":
            self.char_rect.moveLeft(pad / 2)

    def home_pos(self):
        scr = QGuiApplication.primaryScreen().availableGeometry()
        saved = self.store.get("char_pos")
        if saved and len(saved) == 2:
            x, y = saved
            if scr.contains(QPoint(int(x) + 40, int(y) + 40)):
                return QPoint(int(x), int(y))
        if self.store.get("char_side") == "left":
            return QPoint(scr.left() + 8, scr.bottom() - self.height() + 18)
        return QPoint(scr.right() - self.width() + 8, scr.bottom() - self.height() + 18)

    # ---------------------------------------------------------------- show / hide
    def appear(self):
        if self.phase in (FLY_IN, IDLE):
            self.raise_()
            return
        self._layout()
        end = self.home_pos()
        scr = QGuiApplication.primaryScreen().geometry()
        if self.store.get("fly_animation"):
            # Enter from the far top corner and sweep across the whole screen to the resting spot.
            far_left = end.x() > scr.center().x()
            start = (scr.left() - self.width() if far_left else scr.right() + 20, scr.top() + scr.height() * 0.15)
            mid1 = (scr.center().x() + (-1 if far_left else 1) * scr.width() * 0.25, scr.top() - self.height() * 0.2)
            mid2 = (scr.center().x() + (1 if far_left else -1) * scr.width() * 0.2, scr.top() + scr.height() * 0.55)
            self.path = [start, mid1, mid2, (end.x(), end.y())]
            self.phase = FLY_IN
            self.move(int(start[0]), int(start[1]))
        else:
            self.phase = IDLE
            self.move(end)
        self.phase_start = time.time()
        self.show()
        self.raise_()
        self.timer.start(16)

    def leave(self):
        if self.phase in (HIDDEN, FLY_OUT):
            return
        scr = QGuiApplication.primaryScreen().geometry()
        p = self.pos()
        right = p.x() > scr.center().x()
        self.path = [(p.x(), p.y()), (p.x(), p.y() - scr.height() * 0.3),
                     (scr.center().x(), scr.top() - self.height() * 0.3),
                     ((scr.left() - self.width() * 1.5) if right else (scr.right() + self.width() * 0.5), scr.top() - self.height())]
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
    def _tick(self):
        now = time.time()
        el = now - self.phase_start
        if self.phase == FLY_IN:
            t = min(1.0, el / 1.8)
            e = 1 - (1 - t) ** 3
            x, y = bezier(self.path, e)
            nx, ny = bezier(self.path, min(1.0, e + 0.03))
            heading = math.degrees(math.atan2(nx - x, -(ny - y)))
            self.tilt = max(-65, min(65, heading)) * (1 - t) ** 0.7
            self.move(int(x), int(y))
            if t >= 1:
                self.phase, self.phase_start, self.tilt = IDLE, now, 0
        elif self.phase == FLY_OUT:
            t = min(1.0, el / 1.2)
            e = t * t
            x, y = bezier(self.path, e)
            self.tilt = -40 * e if x < self.path[0][0] else 40 * e
            self.move(int(x), int(y))
            if t >= 1:
                self.phase = HIDDEN
                self.timer.stop()
                self.hide()
                if self.on_hidden:
                    self.on_hidden()
                return
        else:
            self.tilt = math.sin(now * 0.8) * 1.5
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
        r.translate(0, bob)
        talk = self.shown_level if self.mode == "speaking" else 0.0
        self._aura(p, r, talk, flying)
        if self.pixmap:
            self._draw_image(p, r, talk, flying)
        else:
            draw_suit(p, r.center().x(), r.center().y(), r.height(), t=now - self.t0, level=talk,
                      thrust=1.0 if flying else 0.25 + 0.08 * math.sin(now * 6), tilt=self.tilt,
                      palm=0.5 + 0.5 * max(talk, self.mic if self.mode == "listening" else 0))
        if not flying and (self.mode != "idle" or now < self.card_until):
            self._card(p, now)
        p.end()

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
        if flying and self.pixmap:
            # Thruster glow under the feet.
            fy = r.bottom() - 6
            g2 = QRadialGradient(QPointF(c.x(), fy), r.width() * 0.45)
            g2.setColorAt(0, QColor(255, 255, 255, 220))
            g2.setColorAt(0.25, QColor(125, 211, 252, 170))
            g2.setColorAt(1, QColor(56, 189, 248, 0))
            p.setBrush(QBrush(g2))
            p.drawEllipse(QPointF(c.x(), fy + 10), r.width() * 0.35, r.width() * 0.45)

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
