package com.priyatham.jarvis;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.View;

/**
 * The holographic JARVIS figure: head, eyes, a mouth that opens with the voice, neck and
 * shoulders, inside rotating arc-reactor rings. Pure Canvas drawing, animated every frame.
 */
public final class FaceView extends View {
    public static final int IDLE = 0, LISTENING = 1, THINKING = 2, SPEAKING = 3;

    private static final int CYAN = 0xFF00E5FF;
    private static final int GOLD = 0xFFFFC857;

    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path head = new Path(), body = new Path(), tmp = new Path();
    private final RectF oval = new RectF();
    private final long born = System.currentTimeMillis();

    private int state = IDLE;
    private float level, shownLevel, micLevel;
    private long nextBlink = System.currentTimeMillis() + 2500;
    private int lastW, lastH;

    public FaceView(Context c) {
        super(c);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeCap(Paint.Cap.ROUND);
    }

    public void setState(int s) {
        state = s;
        invalidate();
    }

    public int getState() {
        return state;
    }

    /** Voice loudness 0..1 while speaking. */
    public void setLevel(float l) {
        level = Math.max(0, Math.min(1, l));
    }

    /** Microphone loudness 0..1 while listening. */
    public void setMicLevel(float l) {
        micLevel = Math.max(0, Math.min(1, l));
    }

    @Override
    protected void onMeasure(int wSpec, int hSpec) {
        int w = MeasureSpec.getSize(wSpec);
        int h = MeasureSpec.getMode(hSpec) == MeasureSpec.UNSPECIFIED ? (int) (w * 0.95f) : Math.min(MeasureSpec.getSize(hSpec), (int) (w * 0.95f));
        setMeasuredDimension(w, h);
    }

    private void buildPaths(float cx, float cy, float s) {
        // Head: a slightly egg-shaped outline, wider at the temples, narrowing to the chin.
        float hw = s * 0.17f, hh = s * 0.23f;
        head.reset();
        head.moveTo(cx, cy - hh);
        head.cubicTo(cx + hw * 1.15f, cy - hh, cx + hw * 1.12f, cy - hh * 0.15f, cx + hw * 0.98f, cy + hh * 0.25f);
        head.cubicTo(cx + hw * 0.85f, cy + hh * 0.7f, cx + hw * 0.45f, cy + hh * 0.98f, cx, cy + hh);
        head.cubicTo(cx - hw * 0.45f, cy + hh * 0.98f, cx - hw * 0.85f, cy + hh * 0.7f, cx - hw * 0.98f, cy + hh * 0.25f);
        head.cubicTo(cx - hw * 1.12f, cy - hh * 0.15f, cx - hw * 1.15f, cy - hh, cx, cy - hh);
        head.close();
        // Neck and shoulders.
        float ny = cy + hh * 0.88f;
        body.reset();
        body.moveTo(cx - hw * 0.42f, ny);
        body.lineTo(cx - hw * 0.46f, ny + s * 0.07f);
        body.cubicTo(cx - hw * 1.2f, ny + s * 0.09f, cx - hw * 2.4f, ny + s * 0.11f, cx - hw * 2.7f, ny + s * 0.22f);
        body.lineTo(cx + hw * 2.7f, ny + s * 0.22f);
        body.cubicTo(cx + hw * 2.4f, ny + s * 0.11f, cx + hw * 1.2f, ny + s * 0.09f, cx + hw * 0.46f, ny + s * 0.07f);
        body.lineTo(cx + hw * 0.42f, ny);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int w = getWidth(), h = getHeight();
        float s = Math.min(w, h * 1.05f);
        float cx = w / 2f, cy = h * 0.47f;
        if (w != lastW || h != lastH) {
            buildPaths(cx, cy, s);
            lastW = w;
            lastH = h;
        }
        long now = System.currentTimeMillis();
        float t = (now - born) / 1000f;
        shownLevel += (level - shownLevel) * 0.45f;

        // Soft halo behind the figure.
        float pulse = state == LISTENING ? 0.55f + micLevel * 0.45f : state == SPEAKING ? 0.5f + shownLevel * 0.5f : 0.4f;
        fill.setShader(new RadialGradient(cx, cy, s * 0.48f,
                new int[]{Color.argb((int) (90 * pulse), 0, 229, 255), Color.argb(0, 0, 229, 255)}, null, Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, cy, s * 0.48f, fill);
        fill.setShader(null);

        drawRings(canvas, cx, cy, s, t);

        // Body first so the head sits on top.
        drawGlowPath(canvas, body, s, 0.55f);
        fill.setShader(new LinearGradient(0, cy + s * 0.2f, 0, cy + s * 0.45f,
                Color.argb(70, 0, 229, 255), Color.argb(0, 0, 229, 255), Shader.TileMode.CLAMP));
        canvas.drawPath(body, fill);
        fill.setShader(null);
        // Chest arc reactor.
        float ry = cy + s * 0.37f;
        fill.setColor(Color.argb(200, 159, 246, 255));
        canvas.drawCircle(cx, ry, s * (0.018f + 0.006f * (float) Math.sin(t * 3)), fill);
        stroke.setColor(CYAN);
        stroke.setStrokeWidth(s * 0.004f);
        canvas.drawCircle(cx, ry, s * 0.032f, stroke);

        // Head fill and hologram contour lines.
        fill.setShader(new LinearGradient(0, cy - s * 0.23f, 0, cy + s * 0.23f,
                Color.argb(60, 0, 229, 255), Color.argb(25, 0, 120, 255), Shader.TileMode.CLAMP));
        canvas.drawPath(head, fill);
        fill.setShader(null);
        canvas.save();
        canvas.clipPath(head);
        stroke.setStrokeWidth(Math.max(1, s * 0.0022f));
        stroke.setColor(Color.argb(55, 0, 229, 255));
        for (float y = cy - s * 0.23f; y < cy + s * 0.24f; y += s * 0.022f) {
            tmp.reset();
            tmp.moveTo(cx - s * 0.2f, y);
            tmp.quadTo(cx, y + s * 0.012f, cx + s * 0.2f, y);
            canvas.drawPath(tmp, stroke);
        }
        // Scanning beam.
        float scan = cy - s * 0.23f + ((t * 0.35f) % 1f) * s * 0.46f;
        fill.setShader(new LinearGradient(0, scan - s * 0.03f, 0, scan + s * 0.005f,
                Color.argb(0, 0, 229, 255), Color.argb(110, 0, 229, 255), Shader.TileMode.CLAMP));
        canvas.drawRect(cx - s * 0.2f, scan - s * 0.03f, cx + s * 0.2f, scan + s * 0.005f, fill);
        fill.setShader(null);
        canvas.restore();
        drawGlowPath(canvas, head, s, 1f);

        drawFace(canvas, cx, cy, s, t, now);
        postInvalidateOnAnimation();
    }

    private void drawGlowPath(Canvas canvas, Path p, float s, float strength) {
        glow.setColor(Color.argb((int) (40 * strength), 0, 229, 255));
        glow.setStrokeWidth(s * 0.02f);
        canvas.drawPath(p, glow);
        glow.setColor(Color.argb((int) (90 * strength), 0, 229, 255));
        glow.setStrokeWidth(s * 0.009f);
        canvas.drawPath(p, glow);
        stroke.setColor(Color.argb((int) (255 * strength), 140, 245, 255));
        stroke.setStrokeWidth(s * 0.004f);
        canvas.drawPath(p, stroke);
    }

    private void drawRings(Canvas canvas, float cx, float cy, float s, float t) {
        float speed = state == THINKING ? 3.5f : state == LISTENING ? 1.6f : 1f;
        float[] radii = {0.44f, 0.4f, 0.355f};
        for (int r = 0; r < radii.length; r++) {
            float rad = s * radii[r];
            oval.set(cx - rad, cy - rad, cx + rad, cy + rad);
            float rot = (r % 2 == 0 ? 1 : -1) * t * (18 + r * 14) * speed;
            int segs = 3 + r * 2;
            float sweep = 360f / segs;
            stroke.setStrokeWidth(s * (r == 0 ? 0.006f : 0.004f));
            for (int k = 0; k < segs; k++) {
                stroke.setColor(r == 1 && k % 2 == 0 ? GOLD : Color.argb(r == 0 ? 220 : 150, 0, 229, 255));
                canvas.drawArc(oval, rot + k * sweep, sweep * (r == 2 ? 0.35f : 0.62f), false, stroke);
            }
        }
        // Tick marks on the outer ring.
        stroke.setStrokeWidth(Math.max(1, s * 0.0025f));
        stroke.setColor(Color.argb(120, 0, 229, 255));
        for (int k = 0; k < 60; k++) {
            double a = Math.toRadians(k * 6 - t * 6);
            float r1 = s * 0.462f, r2 = s * (k % 5 == 0 ? 0.478f : 0.47f);
            canvas.drawLine(cx + (float) Math.cos(a) * r1, cy + (float) Math.sin(a) * r1,
                    cx + (float) Math.cos(a) * r2, cy + (float) Math.sin(a) * r2, stroke);
        }
        if (state == LISTENING) {
            // Microphone level ring.
            stroke.setColor(Color.argb(200, 255, 200, 87));
            stroke.setStrokeWidth(s * 0.006f);
            float lr = s * (0.3f + micLevel * 0.035f);
            canvas.drawCircle(cx, cy, lr, stroke);
        }
    }

    private void drawFace(Canvas canvas, float cx, float cy, float s, float t, long now) {
        // Eyes: glowing almonds that blink now and then.
        float blink = 1f;
        if (now > nextBlink) {
            float p = (now - nextBlink) / 160f;
            if (p >= 1f) {
                nextBlink = now + 2500 + (long) (Math.random() * 3500);
            } else {
                blink = Math.abs(1f - 2f * p);
            }
        }
        float ey = cy - s * 0.035f, ex = s * 0.068f, eW = s * 0.05f, eH = s * 0.017f * Math.max(0.12f, blink);
        float bright = state == SPEAKING ? 0.75f + shownLevel * 0.25f : state == LISTENING ? 0.9f : 0.7f + 0.1f * (float) Math.sin(t * 2);
        for (int side = -1; side <= 1; side += 2) {
            float x = cx + side * ex;
            tmp.reset();
            tmp.moveTo(x - eW / 2, ey);
            tmp.quadTo(x, ey - eH * 1.6f, x + eW / 2, ey);
            tmp.quadTo(x, ey + eH * 1.4f, x - eW / 2, ey);
            tmp.close();
            fill.setColor(Color.argb((int) (90 * bright), 0, 229, 255));
            canvas.drawCircle(x, ey, eW * 0.75f, fill);
            fill.setColor(Color.argb((int) (255 * bright), 190, 250, 255));
            canvas.drawPath(tmp, fill);
            // Brows.
            stroke.setColor(Color.argb(170, 140, 245, 255));
            stroke.setStrokeWidth(s * 0.004f);
            float lift = state == LISTENING ? s * 0.006f : 0;
            canvas.drawLine(x - eW * 0.55f, ey - s * 0.035f - lift + (side < 0 ? 0 : s * 0.002f), x + eW * 0.55f,
                    ey - s * 0.04f - lift - (side < 0 ? 0 : s * 0.002f), stroke);
        }
        // Nose.
        stroke.setStrokeWidth(s * 0.0035f);
        stroke.setColor(Color.argb(140, 140, 245, 255));
        tmp.reset();
        tmp.moveTo(cx, cy - s * 0.01f);
        tmp.lineTo(cx - s * 0.012f, cy + s * 0.055f);
        tmp.lineTo(cx + s * 0.008f, cy + s * 0.06f);
        canvas.drawPath(tmp, stroke);

        // Mouth: opens with the voice.
        float my = cy + s * 0.115f, mw = s * 0.07f;
        float open = state == SPEAKING ? s * (0.004f + 0.05f * shownLevel) : s * 0.003f;
        float smile = state == IDLE ? s * 0.006f : 0;
        fill.setColor(Color.argb(state == SPEAKING ? 200 : 120, 0, 40, 60));
        tmp.reset();
        tmp.moveTo(cx - mw / 2, my);
        tmp.quadTo(cx, my - open * 0.6f + smile, cx + mw / 2, my);
        tmp.quadTo(cx, my + open * 1.6f + smile, cx - mw / 2, my);
        tmp.close();
        canvas.drawPath(tmp, fill);
        stroke.setColor(Color.argb(state == SPEAKING ? 255 : 190, 160, 248, 255));
        stroke.setStrokeWidth(s * 0.005f);
        canvas.drawPath(tmp, stroke);
        if (state == SPEAKING && shownLevel > 0.15f) {
            glow.setColor(Color.argb((int) (120 * shownLevel), 0, 229, 255));
            glow.setStrokeWidth(s * 0.018f);
            canvas.drawPath(tmp, glow);
        }
    }
}
