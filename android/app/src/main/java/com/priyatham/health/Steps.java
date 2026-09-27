package com.priyatham.health;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Daily steps from the phone's hardware step counter (no watch needed). */
public final class Steps {
    private Steps() {}

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static int stored(Context c) {
        SharedPreferences p = Store.prefs(c);
        return today().equals(p.getString("steps_date", "")) ? p.getInt("steps_today", 0) : 0;
    }

    /** Reads the counter once, folds the change into today's total, then calls done. */
    static void read(Context c, Runnable done) {
        SensorManager sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        Sensor s = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (s == null) {
            done.run();
            return;
        }
        Handler h = new Handler(Looper.getMainLooper());
        final boolean[] finished = {false};
        SensorEventListener l = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent e) {
                if (finished[0]) return;
                finished[0] = true;
                sm.unregisterListener(this);
                fold(c, (long) e.values[0]);
                done.run();
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {}
        };
        sm.registerListener(l, s, SensorManager.SENSOR_DELAY_NORMAL);
        h.postDelayed(() -> {
            if (!finished[0]) {
                finished[0] = true;
                sm.unregisterListener(l);
                done.run();
            }
        }, 4000);
    }

    static synchronized void fold(Context c, long raw) {
        SharedPreferences p = Store.prefs(c);
        long last = p.getLong("steps_last_raw", -1);
        String date = p.getString("steps_date", "");
        int total = today().equals(date) ? p.getInt("steps_today", 0) : 0;
        long delta = last < 0 ? 0 : (raw >= last ? raw - last : raw); // counter resets on reboot
        if (delta > 60_000) delta = 0; // ignore glitches
        total += (int) delta;
        p.edit().putLong("steps_last_raw", raw).putString("steps_date", today()).putInt("steps_today", total).apply();
    }
}
