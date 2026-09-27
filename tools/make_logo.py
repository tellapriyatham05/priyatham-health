"""Generates the Priyatham Health logo in every format the app and guide need.

Mark: a gold progress ring (82% closed, like the in-app rings) ending in a gold
bead, around a bold white "P". Brand: black, white, muted warm gold.
All geometry lives in a 108x108 box (Android adaptive-icon space).
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
WWW = os.path.join(ROOT, "www")
OUT = os.path.join(ROOT, "brand")
os.makedirs(OUT, exist_ok=True)

BLACK = "#0A0A0B"
GOLD = "#C9A45C"
WHITE = "#F5F3EE"
C, R, SW, TRIM = 54.0, 26.0, 4.5, 0.82
ANG = TRIM * 360.0
DOT = (C + R * math.sin(math.radians(ANG)), C - R * math.cos(math.radians(ANG)))
DOT_R = 3.6
P_OUTER = "M43.5,38 H55 A9.5,9.5 0 0 1 55,57 H50 V70 H43.5 Z"
P_INNER = "M50,43 V52 H55 A4.5,4.5 0 0 0 55,43 Z"
RING = "M54,28 a26,26 0 1,1 0,52 a26,26 0 1,1 0,-52"
DOT_PATH = f"M{DOT[0]-DOT_R:.2f},{DOT[1]:.2f} a{DOT_R},{DOT_R} 0 1,0 {2*DOT_R},0 a{DOT_R},{DOT_R} 0 1,0 {-2*DOT_R},0"


def vector(ring, p, dot, viewport=108, shift=0):
    g_open = f'<group android:translateX="{shift}" android:translateY="{shift}">' if shift else ""
    g_close = "</group>" if shift else ""
    return f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{viewport}dp" android:height="{viewport}dp"
    android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">
    {g_open}
    <path android:pathData="{RING}" android:strokeColor="{ring}" android:strokeWidth="{SW}"
        android:strokeLineCap="round" android:trimPathEnd="{TRIM}" android:fillColor="#00000000"/>
    <path android:pathData="{DOT_PATH}" android:fillColor="{dot}"/>
    <path android:pathData="{P_OUTER} {P_INNER}" android:fillColor="{p}" android:fillType="evenOdd"/>
    {g_close}
</vector>
'''


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


# ---------- Android vectors ----------
write(os.path.join(RES, "drawable", "ic_logo_fg.xml"), vector(GOLD, WHITE, GOLD))
write(os.path.join(RES, "drawable", "ic_logo_mono.xml"), vector("#FFFFFFFF", "#FFFFFFFF", "#FFFFFFFF"))
write(os.path.join(RES, "drawable", "ic_stat_logo.xml"), vector("#FFFFFFFF", "#FFFFFFFF", "#FFFFFFFF", viewport=72, shift=-18))
adaptive = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_logo_fg"/>
    <monochrome android:drawable="@drawable/ic_logo_mono"/>
</adaptive-icon>
'''
write(os.path.join(RES, "mipmap-anydpi-v26", "ic_launcher.xml"), adaptive)
write(os.path.join(RES, "mipmap-anydpi-v26", "ic_launcher_round.xml"), adaptive)
write(os.path.join(RES, "values", "ic_launcher_background.xml"),
      f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{BLACK}</color>\n</resources>\n')

# ---------- SVG (web + guide) ----------
svg_mark = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <rect width="108" height="108" rx="24" fill="{BLACK}"/>
  <path d="{RING}" fill="none" stroke="{GOLD}" stroke-width="{SW}" stroke-linecap="round" pathLength="100" stroke-dasharray="{TRIM*100} 100"/>
  <circle cx="{DOT[0]:.2f}" cy="{DOT[1]:.2f}" r="{DOT_R}" fill="{GOLD}"/>
  <path d="{P_OUTER} {P_INNER}" fill="{WHITE}" fill-rule="evenodd"/>
</svg>
'''
write(os.path.join(WWW, "logo.svg"), svg_mark)
write(os.path.join(OUT, "logo-mark.svg"), svg_mark)


# ---------- PNG rendering ----------
def draw_mark(img, box_x, box_y, size, ring=GOLD, p=WHITE, bg=None):
    """Draws the mark into img at (box_x, box_y) with the 108-unit box scaled to size px."""
    s = size / 108.0
    d = ImageDraw.Draw(img)

    def X(v):
        return box_x + v * s

    def Y(v):
        return box_y + v * s

    if bg:
        d.rounded_rectangle([X(0), Y(0), X(108), Y(108)], radius=24 * s, fill=bg)
    w = max(1, round(SW * s))
    h = w / 2
    bb = [X(C - R) - h, Y(C - R) - h, X(C + R) + h, Y(C + R) + h]
    d.arc(bb, start=-90, end=-90 + ANG, fill=ring, width=w)
    cap = SW * s / 2
    for ang in (0, ANG):  # round caps
        cx = X(C + R * math.sin(math.radians(ang)) - SW * 0 / 2)
        cy = Y(C - R * math.cos(math.radians(ang)))
        d.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=ring)
    d.ellipse([X(DOT[0] - DOT_R), Y(DOT[1] - DOT_R), X(DOT[0] + DOT_R), Y(DOT[1] + DOT_R)], fill=ring)
    # P: stem + bowl
    d.rectangle([X(43.5), Y(38), X(50), Y(70)], fill=p)
    d.rectangle([X(43.5), Y(38), X(55), Y(57)], fill=p)
    d.pieslice([X(45.5), Y(38), X(64.5), Y(57)], start=-90, end=90, fill=p)
    hole = bg or BLACK
    d.rectangle([X(50), Y(43), X(55), Y(52)], fill=hole)
    d.pieslice([X(50.5), Y(43), X(59.5), Y(52)], start=-90, end=90, fill=hole)


def render(size, bg=BLACK, pad=0.0, rounded=False, circle=False, transparent=False):
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0) if transparent else BLACK)
    if circle or rounded:
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        dd = ImageDraw.Draw(img)
        if circle:
            dd.ellipse([0, 0, S - 1, S - 1], fill=BLACK)
        else:
            dd.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=BLACK)
    inner = S * (1 - 2 * pad)
    draw_mark(img, S * pad, S * pad, inner, bg=None)
    if transparent:
        # draw on transparent: hole must be transparent-ish → redraw hole as black is fine on dark bg
        pass
    return img.resize((size, size), Image.LANCZOS)


dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for k, f in dens.items():
    n = int(48 * f)
    render(n, rounded=True, pad=-0.12).save(os.path.join(RES, f"mipmap-{k}", "ic_launcher.png"))
    render(n, circle=True, pad=-0.12).save(os.path.join(RES, f"mipmap-{k}", "ic_launcher_round.png"))
    render(int(108 * f)).save(os.path.join(RES, f"mipmap-{k}", "ic_launcher_foreground.png"))


def font(sz, bold=True):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", name), sz)
        except OSError:
            continue
    return ImageFont.load_default()


def splash(w, h):
    ss = 2
    img = Image.new("RGB", (w * ss, h * ss), BLACK)
    m = int(min(w, h) * ss * 0.34)
    x = (w * ss - m) // 2
    y = int(h * ss / 2 - m * 0.62)
    draw_mark(img, x, y, m)
    d = ImageDraw.Draw(img)
    f1 = font(int(m * 0.16))
    f2 = font(int(m * 0.085), bold=False)
    t1, t2 = "PRIYATHAM", "H E A L T H"
    tw = d.textlength(t1, font=f1)
    d.text(((w * ss - tw) / 2, y + m * 1.0), t1, font=f1, fill=WHITE)
    tw2 = d.textlength(t2, font=f2)
    d.text(((w * ss - tw2) / 2, y + m * 1.22), t2, font=f2, fill=GOLD)
    return img.resize((w, h), Image.LANCZOS)


for folder in os.listdir(RES):
    p = os.path.join(RES, folder, "splash.png")
    if os.path.exists(p):
        w, h = Image.open(p).size
        splash(w, h).save(p)

# large brand assets for the guide / Drive
render(1024, rounded=True, pad=-0.12).save(os.path.join(OUT, "logo-icon-1024.png"))
splash(1200, 1200).save(os.path.join(OUT, "logo-lockup-1200.png"))
print("logo assets written")
