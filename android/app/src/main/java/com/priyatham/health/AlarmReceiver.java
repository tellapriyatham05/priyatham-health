package com.priyatham.health;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** Fires a reminder: rings (sound on), vibrates (silent/vibrate) and always posts a notification. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String CH_RING = "ph_alarm_ring";
    static final String CH_QUIET = "ph_alarm_quiet";
    static final String CH_NUDGE = "ph_nudge";
    static final String CH_RIDE = "ph_ride";
    static final int GOLD = Color.parseColor("#C9A45C");

    @Override
    public void onReceive(Context c, Intent intent) {
        int id = intent.getIntExtra(AlarmScheduler.EXTRA_ID, -1);
        JSONObject a = Store.getAlarm(c, id);
        if (a == null) return;
        long now = System.currentTimeMillis();

        if ("steps".equals(a.optString("kind"))) {
            PendingResult pr = goAsync();
            Steps.read(c, () -> pr.finish());
        } else {
            String skipKey = a.optString("skipKey", "");
            int skipMin = a.optInt("skipMin", 0);
            boolean skip = !skipKey.isEmpty() && skipMin > 0 && now - Store.lastEvent(c, skipKey) < skipMin * 60_000L;
            if (!skip) show(c, a, now);
        }

        long n = AlarmScheduler.next(a, now);
        try {
            if (n > 0) {
                a.put("at", n);
                AlarmScheduler.schedule(c, a);
            } else {
                Store.removeAlarm(c, id);
            }
        } catch (Exception ignored) {}
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_RING) == null) {
            NotificationChannel ring = new NotificationChannel(CH_RING, "Alarms (ringing)", NotificationManager.IMPORTANCE_HIGH);
            ring.setDescription("Cooking prep, workouts and weekly planning alarms when your phone's sound is on");
            Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            ring.setSound(alarm, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ring.enableVibration(true);
            ring.setVibrationPattern(new long[]{0, 700, 400, 700, 400, 700});
            ring.enableLights(true);
            ring.setLightColor(GOLD);
            ring.setBypassDnd(true);
            ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ring);
        }
        if (nm.getNotificationChannel(CH_QUIET) == null) {
            NotificationChannel q = new NotificationChannel(CH_QUIET, "Alarms (silent mode)", NotificationManager.IMPORTANCE_HIGH);
            q.setDescription("Alarms while your phone is on silent or vibrate: the app vibrates instead of ringing");
            q.setSound(null, null);
            q.enableVibration(false);
            q.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(q);
        }
        if (nm.getNotificationChannel(CH_NUDGE) == null) {
            NotificationChannel n = new NotificationChannel(CH_NUDGE, "Gentle reminders", NotificationManager.IMPORTANCE_HIGH);
            n.setDescription("Water, stand breaks, bedtime and check-ins");
            n.enableVibration(true);
            n.setVibrationPattern(new long[]{0, 250, 150, 250});
            nm.createNotificationChannel(n);
        }
        if (nm.getNotificationChannel(CH_RIDE) == null) {
            NotificationChannel r = new NotificationChannel(CH_RIDE, "Ride recording", NotificationManager.IMPORTANCE_LOW);
            r.setDescription("Shown while a GPS ride is being recorded");
            nm.createNotificationChannel(r);
        }
    }

    static void show(Context c, JSONObject a, long now) {
        ensureChannels(c);
        int id = a.optInt("id");
        String mode = a.optString("mode", "notify");
        String title = a.optString("title", "Reminder");
        String body = a.optString("body", "");

        long until = a.optLong("until", 0);
        if (until > 0) {
            long left = (until - now) / 60_000L;
            if (left <= 1) {
                title = "FINAL CALL · " + title;
                body = "Do it now, or the planned meal won't be ready. " + body;
            } else if (left <= 45) {
                body = left + " min left before the final call. " + body;
            } else {
                long h = left / 60, m = left % 60;
                body = (h > 0 ? h + " h " : "") + m + " min left. " + body;
            }
        }

        AudioManager audio = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        boolean soundOn = audio.getRingerMode() == AudioManager.RINGER_MODE_NORMAL;
        String channel;
        if ("alarm".equals(mode)) {
            channel = soundOn ? CH_RING : CH_QUIET;
            if (!soundOn) vibrate(c, new long[]{0, 800, 400, 800, 400, 800, 400, 800});
        } else if ("vibrate".equals(mode)) {
            channel = CH_QUIET;
            vibrate(c, new long[]{0, 350, 200, 350});
        } else {
            channel = CH_NUDGE;
        }

        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("route", a.optString("route", ""));
        PendingIntent openPi = PendingIntent.getActivity(c, 500000 + id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_logo)
                .setColor(GOLD)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(openPi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory("alarm".equals(mode) ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        JSONArray actions = a.optJSONArray("actions");
        if (actions == null) actions = new JSONArray().put("done").put("snooze");
        for (int i = 0; i < actions.length(); i++) {
            String act = actions.optString(i);
            String label = "done".equals(act) ? "Done" : "snooze".equals(act) ? "Snooze 10 min" : "water".equals(act) ? "+250 ml" : act;
            b.addAction(0, label, ActionReceiver.pi(c, id, act, i));
        }

        if ("alarm".equals(mode)) {
            Intent full = new Intent(c, AlarmActivity.class);
            full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            full.putExtra(AlarmScheduler.EXTRA_ID, id);
            full.putExtra("title", title);
            full.putExtra("body", body);
            PendingIntent fullPi = PendingIntent.getActivity(c, 700000 + id, full,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.setFullScreenIntent(fullPi, true);
            b.setOngoing(true);
            b.setTimeoutAfter(10 * 60_000L);
        }

        Notification n = b.build();
        if ("alarm".equals(mode) && soundOn) n.flags |= Notification.FLAG_INSISTENT;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(id, n);
        } catch (SecurityException ignored) {}
    }

    static void vibrate(Context c, long[] pattern) {
        Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
            v.vibrate(VibrationEffect.createWaveform(pattern, -1), attrs);
        } else {
            v.vibrate(pattern, -1);
        }
    }
}
