"""The armoured suit, drawn with QPainter (an original red-and-gold design).

Coordinates are in a 600 x 1000 design box; draw_suit() scales and positions it.
"""
import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QBrush, QColor, QLinearGradient, QPainter, QPainterPath,
                           QPen, QRadialGradient, QPolygonF)

RED_DARK = QColor(92, 8, 14)
RED = QColor(178, 22, 30)
RED_LIGHT = QColor(232, 70, 62)
GOLD_DARK = QColor(122, 92, 40)
GOLD = QColor(206, 168, 92)
GOLD_LIGHT = QColor(250, 226, 160)
STEEL = QColor(40, 44, 52)
GLOW = QColor(160, 240, 255)
CYAN = QColor(0, 229, 255)


def _metal(p1, p2, dark, mid, light):
    g = QLinearGradient(p1, p2)
    g.setColorAt(0.0, dark)
    g.setColorAt(0.45, light)
    g.setColorAt(0.6, mid)
    g.setColorAt(1.0, dark)
    return QBrush(g)


def _limb(painter, a, b, wa, wb, colors, outline=True):
    """A tapered armour segment from point a (width wa) to point b (width wb)."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length, dx / length
    path = QPainterPath()
    path.moveTo(ax + nx * wa / 2, ay + ny * wa / 2)
    path.lineTo(bx + nx * wb / 2, by + ny * wb / 2)
    path.quadTo(bx + dx / length * wb * 0.35, by + dy / length * wb * 0.35, bx - nx * wb / 2, by - ny * wb / 2)
    path.lineTo(ax - nx * wa / 2, ay - ny * wa / 2)
    path.quadTo(ax - dx / length * wa * 0.35, ay - dy / length * wa * 0.35, ax + nx * wa / 2, ay + ny * wa / 2)
    path.closeSubpath()
    mid_x, mid_y = (ax + bx) / 2, (ay + by) / 2
    w = max(wa, wb)
    painter.setBrush(_metal(QPointF(mid_x - nx * w / 2, mid_y - ny * w / 2), QPointF(mid_x + nx * w / 2, mid_y + ny * w / 2), *colors))
    painter.setPen(QPen(QColor(20, 4, 6, 200), 2.2) if outline else Qt.NoPen)
    painter.drawPath(path)
    return path


def _poly(points):
    return QPolygonF([QPointF(x, y) for x, y in points])


def _glow(painter, x, y, r, strength, color=GLOW):
    g = QRadialGradient(QPointF(x, y), r)
    c = QColor(color)
    c.setAlpha(int(230 * strength))
    g.setColorAt(0.0, QColor(255, 255, 255, int(255 * strength)))
    g.setColorAt(0.25, c)
    c2 = QColor(CYAN)
    c2.setAlpha(0)
    g.setColorAt(1.0, c2)
    painter.setBrush(QBrush(g))
    painter.setPen(Qt.NoPen)
    painter.drawEllipse(QPointF(x, y), r, r)


def _flame(painter, x, y, length, width, angle_deg, t):
    """Repulsor thrust flame pointing along angle (degrees, 90 = down)."""
    painter.save()
    painter.translate(x, y)
    painter.rotate(angle_deg - 90)
    flicker = 0.85 + 0.15 * math.sin(t * 40 + x)
    ln = length * flicker
    g = QLinearGradient(QPointF(0, 0), QPointF(0, ln))
    g.setColorAt(0.0, QColor(255, 255, 255, 250))
    g.setColorAt(0.15, QColor(170, 245, 255, 230))
    g.setColorAt(0.5, QColor(0, 200, 255, 140))
    g.setColorAt(1.0, QColor(0, 120, 255, 0))
    path = QPainterPath()
    path.moveTo(-width / 2, 0)
    path.quadTo(-width * 0.6, ln * 0.4, 0, ln)
    path.quadTo(width * 0.6, ln * 0.4, width / 2, 0)
    path.closeSubpath()
    painter.setBrush(QBrush(g))
    painter.setPen(Qt.NoPen)
    painter.drawPath(path)
    painter.restore()


def draw_suit(painter: QPainter, cx, cy, height, t=0.0, level=0.0, thrust=0.0, tilt=0.0, palm=1.0):
    """Draw the suit centred at (cx, cy).

    level: voice loudness 0..1 (eyes and reactor pulse). thrust: 0..1 boot/palm flames.
    tilt: body rotation in degrees (banking while flying). palm: raised-hand repulsor glow 0..1.
    """
    s = height / 1000.0
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.translate(cx, cy)
    painter.rotate(tilt)
    painter.scale(s, s)
    painter.translate(-300, -500)

    pulse = 0.75 + 0.25 * math.sin(t * 3.0)
    energy = min(1.0, 0.55 + 0.45 * max(level, pulse * 0.6))

    # Boot thrusters (behind the suit).
    if thrust > 0.02:
        _flame(painter, 240, 975, 260 * thrust, 46, 90, t)
        _flame(painter, 362, 975, 260 * thrust, 46, 90, t + 1.3)
        _flame(painter, 140, 545, 140 * thrust, 30, 100, t + 2.1)

    red = (RED_DARK, RED, RED_LIGHT)
    gold = (GOLD_DARK, GOLD, GOLD_LIGHT)
    steel = (QColor(18, 20, 24), STEEL, QColor(110, 116, 128))

    # ---- Legs ----
    for (hip, knee, ankle, foot) in (((262, 560), (246, 740), (240, 900), (226, 975)),
                                     ((340, 560), (356, 740), (362, 900), (378, 975))):
        _limb(painter, hip, knee, 78, 56, gold)            # gold thigh
        _limb(painter, (hip[0], hip[1] + 10), (hip[0] + (knee[0] - hip[0]) * 0.55, hip[1] + 110), 40, 26, red)
        _limb(painter, knee, ankle, 58, 50, red)           # red shin
        _limb(painter, (knee[0], knee[1] + 18), ((knee[0] + ankle[0]) / 2, knee[1] + 90), 26, 16, gold)
        _limb(painter, ankle, foot, 56, 70, red)           # boot
        painter.setBrush(QBrush(GOLD))
        painter.setPen(QPen(QColor(20, 4, 6, 200), 2))
        painter.drawEllipse(QPointF(knee[0], knee[1]), 26, 20)

    # ---- Hips ----
    hips = QPainterPath()
    hips.addPolygon(_poly([(228, 470), (372, 470), (382, 540), (330, 600), (270, 600), (218, 540)]))
    painter.setBrush(_metal(QPointF(218, 0), QPointF(382, 0), *red))
    painter.setPen(QPen(QColor(20, 4, 6, 200), 2.2))
    painter.drawPath(hips)
    painter.setBrush(_metal(QPointF(220, 0), QPointF(380, 0), *gold))
    painter.drawPolygon(_poly([(226, 470), (374, 470), (378, 492), (222, 492)]))

    # ---- Left arm, down by the side with a fist ----
    _limb(painter, (186, 238), (158, 382), 70, 56, red)
    _limb(painter, (158, 382), (146, 512), 58, 50, red)
    _limb(painter, (154, 400), (148, 480), 26, 20, gold)
    painter.setBrush(_metal(QPointF(118, 0), QPointF(176, 0), *red))
    painter.drawRoundedRect(QRectF(118, 505, 58, 60), 18, 18)
    _glow(painter, 147, 548, 10 + 6 * thrust, 0.35 + 0.6 * thrust)

    # ---- Torso ----
    torso = QPainterPath()
    torso.addPolygon(_poly([(176, 205), (424, 205), (408, 330), (372, 472), (228, 472), (192, 330)]))
    painter.setBrush(_metal(QPointF(176, 0), QPointF(424, 0), *red))
    painter.setPen(QPen(QColor(20, 4, 6, 220), 2.4))
    painter.drawPath(torso)
    # Gold abdomen plates.
    painter.setBrush(_metal(QPointF(240, 0), QPointF(360, 0), *gold))
    for i, y in enumerate((338, 372, 406, 440)):
        inset = 6 + i * 6
        painter.drawPolygon(_poly([(244 + inset, y), (356 - inset, y), (352 - inset, y + 28), (248 + inset, y + 28)]))
    # Pecs, with gold trim.
    painter.setBrush(_metal(QPointF(200, 220), QPointF(300, 320), *red))
    painter.drawPolygon(_poly([(200, 228), (292, 236), (292, 318), (214, 318)]))
    painter.drawPolygon(_poly([(400, 228), (308, 236), (308, 318), (386, 318)]))
    painter.setPen(QPen(GOLD, 4))
    painter.drawLine(QPointF(214, 324), QPointF(290, 324))
    painter.drawLine(QPointF(310, 324), QPointF(386, 324))

    # Arc reactor: a glowing inverted triangle.
    _glow(painter, 300, 268, 70 * energy, 0.45 * energy)
    painter.setBrush(QBrush(QColor(190, 248, 255, int(255 * energy))))
    painter.setPen(QPen(QColor(220, 252, 255), 3))
    painter.drawPolygon(_poly([(262, 240), (338, 240), (300, 300)]))
    painter.setBrush(QBrush(QColor(255, 255, 255, int(240 * energy))))
    painter.setPen(Qt.NoPen)
    painter.drawPolygon(_poly([(280, 250), (320, 250), (300, 282)]))

    # Shoulders.
    for x in (186, 414):
        painter.setBrush(_metal(QPointF(x - 46, 190), QPointF(x + 46, 250), *red))
        painter.setPen(QPen(QColor(20, 4, 6, 220), 2.2))
        painter.drawEllipse(QPointF(x, 228), 48, 40)
        painter.setBrush(_metal(QPointF(x - 30, 210), QPointF(x + 30, 240), *gold))
        painter.drawEllipse(QPointF(x, 224), 26, 16)

    # ---- Right arm raised, palm out ----
    _limb(painter, (414, 238), (470, 360), 68, 56, red)
    _limb(painter, (470, 360), (504, 236), 56, 48, red)
    _limb(painter, (474, 342), (496, 262), 24, 18, gold)
    palm_path = QPainterPath()
    palm_path.addRoundedRect(QRectF(478, 150, 62, 74), 16, 16)
    painter.setBrush(_metal(QPointF(478, 0), QPointF(540, 0), *red))
    painter.setPen(QPen(QColor(20, 4, 6, 220), 2.2))
    painter.drawPath(palm_path)
    for i, fx in enumerate((484, 498, 512, 526)):          # fingers
        top = 104 + abs(i - 1.5) * 9
        _limb(painter, (fx + 3, 156), (fx + 1 + (i - 1.5) * 4, top), 13, 11, red)
    _limb(painter, (480, 200), (452, 168), 15, 12, red)    # thumb
    _glow(painter, 509, 188, 60 * palm * (0.8 + 0.2 * pulse), 0.9 * palm)
    painter.setBrush(QBrush(QColor(235, 252, 255, int(255 * palm))))
    painter.setPen(Qt.NoPen)
    painter.drawEllipse(QPointF(509, 188), 13, 13)
    if thrust > 0.02:
        _flame(painter, 509, 188, 90 * thrust, 34, -90, t + 0.7)

    # ---- Neck and helmet ----
    painter.setBrush(_metal(QPointF(268, 0), QPointF(332, 0), *steel))
    painter.setPen(QPen(QColor(10, 10, 12), 2))
    painter.drawRect(QRectF(272, 160, 56, 50))
    helmet = QPainterPath()
    helmet.moveTo(300, 22)
    helmet.cubicTo(362, 22, 372, 80, 368, 126)
    helmet.cubicTo(364, 160, 340, 184, 300, 190)
    helmet.cubicTo(260, 184, 236, 160, 232, 126)
    helmet.cubicTo(228, 80, 238, 22, 300, 22)
    painter.setBrush(_metal(QPointF(232, 0), QPointF(368, 0), *red))
    painter.setPen(QPen(QColor(20, 4, 6, 230), 2.4))
    painter.drawPath(helmet)
    face = QPainterPath()
    face.moveTo(300, 52)
    face.cubicTo(336, 54, 350, 84, 348, 110)
    face.lineTo(342, 150)
    face.cubicTo(330, 170, 314, 178, 300, 180)
    face.cubicTo(286, 178, 270, 170, 258, 150)
    face.lineTo(252, 110)
    face.cubicTo(250, 84, 264, 54, 300, 52)
    painter.setBrush(_metal(QPointF(252, 0), QPointF(348, 0), *gold))
    painter.drawPath(face)
    painter.setPen(QPen(QColor(90, 66, 30), 2))
    painter.drawLine(QPointF(300, 128), QPointF(300, 176))       # faceplate seam
    painter.drawLine(QPointF(282, 150), QPointF(318, 150))       # mouth line
    # Eyes.
    eye = 0.65 + 0.35 * max(level, 0.6 * pulse)
    for side in (-1, 1):
        ex = 300 + side * 25
        _glow(painter, ex, 110, 26 * eye, 0.55 * eye)
        painter.setBrush(QBrush(QColor(235, 252, 255, int(255 * eye))))
        painter.setPen(Qt.NoPen)
        painter.drawPolygon(_poly([(ex - side * 6, 104), (ex + side * 20, 106), (ex + side * 16, 116), (ex - side * 8, 114)]))
    painter.restore()
