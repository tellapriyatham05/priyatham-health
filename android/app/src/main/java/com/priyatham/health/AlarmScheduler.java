package com.priyatham.health;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * Schedules reminder alarms.
 *
 * Alarm JSON fields:
 *  id (int), key (string), kind, title, body, at (ms), mode ("alarm" | "notify" | "vibrate"),
 *  repeatMin + until (repeat every N min until a deadline, the last one is the "final call"),
 *  recur ("none" | "daily" | "weekly" | "interval"), everyMin, winStart/winEnd ("HH:mm") for interval,
 *  skipKey + skipMin (skip if that event happened recently), actions (array of "done","snooze","water").
 */
public final class AlarmScheduler {
    static final String EXTRA_ID = "alarm_id";

    private AlarmScheduler() {}

    static PendingIntent firePi(Context c, int id) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction("com.priyatham.health.FIRE");
        i.putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context c, JSONObject a) {
        Store.saveAlarm(c, a);
        arm(c, a);
    }

    static void arm(Context c, JSONObject a) {
        int id = a.optInt("id");
        long at = a.optLong("at");
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePi(c, id);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if ("alarm".equals(a.optString("mode")) && exact) {
            Intent show = new Intent(c, MainActivity.class);
            PendingIntent showPi = PendingIntent.getActivity(c, 900000 + id, show, PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), pi);
        } else if (exact) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancel(Context c, int id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(firePi(c, id));
        Store.removeAlarm(c, id);
    }

    /** Computes the next fire time after one has fired. Returns -1 when the series is over. */
    static long next(JSONObject a, long now) {
        long at = a.optLong("at");
        int repeat = a.optInt("repeatMin", 0);
        long until = a.optLong("until", 0);
        if (repeat > 0 && until > 0) {
            if (at >= until) return -1; // the final call already fired
            long n = Math.max(at, now) + repeat * 60_000L;
            return Math.min(n, until);
        }
        String recur = a.optString("recur", "none");
        switch (recur) {
            case "daily": {
                long n = at;
                while (n <= now) n += 86_400_000L;
                return n;
            }
            case "weekly": {
                long n = at;
                while (n <= now) n += 7 * 86_400_000L;
                return n;
            }
            case "interval":
                return nextInWindow(a, now + a.optInt("everyMin", 60) * 60_000L);
            default:
                return -1;
        }
    }

    /** Moves t into the daily window [winStart, winEnd]; if after the window, jumps to the next day's start. */
    static long nextInWindow(JSONObject a, long t) {
        int[] s = hm(a.optString("winStart", "07:00"));
        int[] e = hm(a.optString("winEnd", "22:00"));
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(t);
        Calendar start = (Calendar) cal.clone();
        start.set(Calendar.HOUR_OF_DAY, s[0]);
        start.set(Calendar.MINUTE, s[1]);
        start.set(Calendar.SECOND, 0);
        start.set(Calendar.MILLISECOND, 0);
        Calendar end = (Calendar) start.clone();
        end.set(Calendar.HOUR_OF_DAY, e[0]);
        end.set(Calendar.MINUTE, e[1]);
        if (t < start.getTimeInMillis()) return start.getTimeInMillis();
        if (t > end.getTimeInMillis()) {
            start.add(Calendar.DAY_OF_YEAR, 1);
            return start.getTimeInMillis();
        }
        return t;
    }

    static int[] hm(String s) {
        try {
            String[] p = s.split(":");
            return new int[]{Integer.parseInt(p[0]), Integer.parseInt(p[1])};
        } catch (Exception ex) {
            return new int[]{0, 0};
        }
    }

    /** Re-arms every stored alarm (after reboot or app update). */
    static void rearmAll(Context c) {
        long now = System.currentTimeMillis();
        for (JSONObject a : Store.alarmList(c)) {
            try {
                if (a.optLong("at") < now - 60_000L) {
                    long n = next(a, now);
                    if (n < 0) {
                        Store.removeAlarm(c, a.optInt("id"));
                        continue;
                    }
                    a.put("at", n);
                    Store.saveAlarm(c, a);
                }
                arm(c, a);
            } catch (Exception ignored) {}
        }
    }
}
