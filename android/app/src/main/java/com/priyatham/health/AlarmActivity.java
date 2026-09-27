package com.priyatham.health;

import android.app.Activity;
import android.app.KeyguardManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Animation;
import android.view.animation.ScaleAnimation;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Full-screen "alarm ringing" screen shown over the lock screen. */
public class AlarmActivity extends Activity {
    private int alarmId;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#0A0A0B"));
        getWindow().setNavigationBarColor(Color.parseColor("#0A0A0B"));

        alarmId = getIntent().getIntExtra(AlarmScheduler.EXTRA_ID, -1);
        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");

        int gold = Color.parseColor("#C9A45C");
        int white = Color.parseColor("#F5F3EE");
        int muted = Color.parseColor("#A3A09A");
        float d = getResources().getDisplayMetrics().density;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0A0A0B"));
        root.setPadding((int) (24 * d), (int) (56 * d), (int) (24 * d), (int) (32 * d));

        TextView time = new TextView(this);
        time.setText(new SimpleDateFormat("h:mm a", Locale.getDefault()).format(new Date()));
        time.setTextColor(white);
        time.setTextSize(56);
        time.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        time.setGravity(Gravity.CENTER);
        root.addView(time);

        View bell = new View(this);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(gold);
        bell.setBackground(circle);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams((int) (110 * d), (int) (110 * d));
        bp.topMargin = (int) (40 * d);
        bp.bottomMargin = (int) (36 * d);
        root.addView(bell, bp);
        ScaleAnimation pulse = new ScaleAnimation(1f, 1.12f, 1f, 1.12f, Animation.RELATIVE_TO_SELF, .5f, Animation.RELATIVE_TO_SELF, .5f);
        pulse.setDuration(700);
        pulse.setRepeatMode(Animation.REVERSE);
        pulse.setRepeatCount(Animation.INFINITE);
        bell.startAnimation(pulse);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(white);
        t.setTextSize(28);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        root.addView(t);

        TextView bd = new TextView(this);
        bd.setText(body);
        bd.setTextColor(muted);
        bd.setTextSize(16);
        bd.setGravity(Gravity.CENTER);
        bd.setPadding(0, (int) (12 * d), 0, 0);
        root.addView(bd);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        root.addView(button("Done", gold, Color.parseColor("#0A0A0B"), d, v -> finishWith("done")));
        root.addView(button("Snooze 10 min", Color.parseColor("#1C1C1F"), white, d, v -> finishWith("snooze")));
        root.addView(button("Open app", Color.parseColor("#1C1C1F"), white, d, v -> {
            android.content.Intent i = new android.content.Intent(this, MainActivity.class);
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(alarmId);
            finish();
        }));
        setContentView(root);
    }

    private Button button(String label, int bg, int fg, float d, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(17);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(fg);
        GradientDrawable g = new GradientDrawable();
        g.setColor(bg);
        g.setCornerRadius(30 * d);
        b.setBackground(g);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (58 * d));
        p.topMargin = (int) (10 * d);
        b.setLayoutParams(p);
        return b;
    }

    private void finishWith(String act) {
        ActionReceiver.handle(this, alarmId, act);
        finish();
    }
}
