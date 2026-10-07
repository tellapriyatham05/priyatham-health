package com.priyatham.jarvis;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayList;
import java.util.List;

/** Keeps a live list of your notifications so JARVIS can show, read and reply to them. */
public class NotifListener extends NotificationListenerService {

    public static final class Item {
        public String key, pkg, app, title, text;
        public long when;
        public Notification.Action reply;
    }

    public interface ChangeListener {
        void onNotificationsChanged();
    }

    private static NotifListener instance;
    private static final List<Item> items = new ArrayList<Item>();
    private static ChangeListener changeListener;

    public static boolean isConnected() {
        return instance != null;
    }

    public static void setChangeListener(ChangeListener l) {
        changeListener = l;
    }

    /** Newest first. */
    public static List<Item> snapshot() {
        synchronized (items) {
            return new ArrayList<Item>(items);
        }
    }

    @Override
    public void onListenerConnected() {
        instance = this;
        reload();
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        reload();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        reload();
    }

    private void reload() {
        StatusBarNotification[] active;
        try {
            active = getActiveNotifications();
        } catch (Exception e) {
            return;
        }
        List<Item> fresh = new ArrayList<Item>();
        if (active != null) {
            for (StatusBarNotification s : active) {
                Item it = toItem(this, s);
                if (it != null) fresh.add(it);
            }
        }
        java.util.Collections.sort(fresh, new java.util.Comparator<Item>() {
            @Override public int compare(Item a, Item b) { return Long.compare(b.when, a.when); }
        });
        synchronized (items) {
            items.clear();
            items.addAll(fresh);
        }
        ChangeListener l = changeListener;
        if (l != null) l.onNotificationsChanged();
    }

    private static Item toItem(Context c, StatusBarNotification s) {
        Notification n = s.getNotification();
        if (s.getPackageName().equals(c.getPackageName())) return null;
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return null;
        if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0 && !Notification.CATEGORY_CALL.equals(n.category)) return null;
        Bundle e = n.extras;
        CharSequence title = e.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = e.getCharSequence(Notification.EXTRA_TEXT);
        if (title == null && text == null) return null;
        Item it = new Item();
        it.key = s.getKey();
        it.pkg = s.getPackageName();
        it.app = appLabel(c, s.getPackageName());
        it.title = title == null ? "" : title.toString();
        it.text = text == null ? "" : text.toString();
        it.when = n.when > 0 ? n.when : s.getPostTime();
        if (n.actions != null) {
            for (Notification.Action a : n.actions) {
                RemoteInput[] ri = a.getRemoteInputs();
                if (ri != null && ri.length > 0) { it.reply = a; break; }
            }
        }
        return it;
    }

    static String appLabel(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    public static boolean clearAll() {
        NotifListener l = instance;
        if (l == null) return false;
        l.cancelAllNotifications();
        return true;
    }

    /** Sends a reply through the notification's own reply button (WhatsApp, Messages, Telegram...). */
    public static boolean reply(Context c, Item it, String message) {
        if (it == null || it.reply == null) return false;
        RemoteInput[] inputs = it.reply.getRemoteInputs();
        Intent fill = new Intent();
        Bundle results = new Bundle();
        for (RemoteInput r : inputs) results.putCharSequence(r.getResultKey(), message);
        RemoteInput.addResultsToIntent(inputs, fill, results);
        try {
            it.reply.actionIntent.send(c, 0, fill);
            return true;
        } catch (PendingIntent.CanceledException e) {
            return false;
        }
    }
}
