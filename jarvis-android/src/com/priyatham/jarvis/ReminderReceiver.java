package com.priyatham.jarvis;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

/** Fires a reminder: a loud notification, and JARVIS says it out loud on the HUD. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String text = intent.getStringExtra("text");
        if (text == null) text = "your reminder";
        int id = intent.getIntExtra("id", 1000);
        JarvisService.createChannels(c);
        String sentence = "Reminder, " + new Prefs(c).userTitle() + ": " + text + ".";
        Intent hud = new Intent(c, HudActivity.class).putExtra("say", sentence)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, hud, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, JarvisService.CH_ALERTS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Reminder")
                .setContentText(text)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, n);
        if (Settings.canDrawOverlays(c)) {
            try {
                c.startActivity(hud);
            } catch (Exception ignored) { }
        }
    }
}
