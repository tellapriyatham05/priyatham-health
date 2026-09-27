package com.priyatham.health;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Handles the Done / Snooze / +250 ml buttons on notifications and the full-screen alarm. */
public class ActionReceiver extends BroadcastReceiver {
    static PendingIntent pi(Context c, int id, String action, int slot) {
        Intent i = new Intent(c, ActionReceiver.class);
        i.setAction("com.priyatham.health.ACTION_" + action);
        i.putExtra(AlarmScheduler.EXTRA_ID, id);
        i.putExtra("act", action);
        return PendingIntent.getBroadcast(c, id * 10 + slot + 1_000_000, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        handle(c, intent.getIntExtra(AlarmScheduler.EXTRA_ID, -1), intent.getStringExtra("act"));
    }

    static void handle(Context c, int id, String act) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(id);
        JSONObject a = Store.getAlarm(c, id);
        String key = a != null ? a.optString("key", "") : "";
        String skipKey = a != null ? a.optString("skipKey", "") : "";
        long now = System.currentTimeMillis();
        try {
            JSONObject ev = new JSONObject().put("id", id).put("key", key).put("type", act).put("ts", now);
            if ("done".equals(act)) {
                Store.setLastEvent(c, skipKey.isEmpty() ? key : skipKey);
                // one-off series (prep steps) end when done; repeating ones (daily/interval) keep going
                if (a != null && a.optLong("until", 0) > 0) AlarmScheduler.cancel(c, id);
                Store.addEvent(c, ev);
            } else if ("snooze".equals(act)) {
                if (a != null) {
                    JSONObject s = new JSONObject(a.toString());
                    s.put("id", 60_000_000 + (id % 1_000_000)); // separate one-off snooze alarm
                    s.put("at", now + 10 * 60_000L);
                    s.put("recur", "none");
                    s.put("repeatMin", 0);
                    s.put("until", 0);
                    AlarmScheduler.schedule(c, s);
                }
            } else if ("water".equals(act)) {
                Store.setLastEvent(c, "water");
                ev.put("ml", 250);
                Store.addEvent(c, ev);
            }
        } catch (Exception ignored) {}
    }
}
