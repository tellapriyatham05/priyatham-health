package com.priyatham.jarvis;

import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ResolveInfo;
import android.os.BatteryManager;
import android.os.Environment;
import android.os.Process;
import android.os.StatFs;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Live phone numbers for the HUD: RAM, storage, battery, screen time. */
public final class SystemStats {
    private SystemStats() {}

    public static long[] ram(Context c) {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        return new long[]{mi.totalMem - mi.availMem, mi.totalMem};
    }

    public static long[] storage() {
        StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
        long total = fs.getTotalBytes();
        return new long[]{total - fs.getAvailableBytes(), total};
    }

    public static int batteryPercent(Context c) {
        BatteryManager bm = (BatteryManager) c.getSystemService(Context.BATTERY_SERVICE);
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
    }

    public static boolean charging(Context c) {
        Intent i = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (i == null) return false;
        int status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
    }

    public static float batteryTemp(Context c) {
        Intent i = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        return i == null ? 0 : i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10f;
    }

    public static String gb(long bytes) {
        return String.format(Locale.US, "%.1f GB", bytes / 1073741824.0);
    }

    public static boolean hasUsageAccess(Context c) {
        AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /** Foreground minutes per app since midnight, largest first. Empty without usage access. */
    public static LinkedHashMap<String, Long> screenTimeToday(Context c) {
        LinkedHashMap<String, Long> out = new LinkedHashMap<String, Long>();
        if (!hasUsageAccess(c)) return out;
        UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        long start = cal.getTimeInMillis(), now = System.currentTimeMillis();
        UsageEvents events = usm.queryEvents(start, now);
        Map<String, Long> openSince = new HashMap<String, Long>();
        final Map<String, Long> total = new HashMap<String, Long>();
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            String pkg = e.getPackageName();
            int type = e.getEventType();
            if (type == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                if (!openSince.containsKey(pkg)) openSince.put(pkg, e.getTimeStamp());
            } else if (type == UsageEvents.Event.MOVE_TO_BACKGROUND) {
                Long s = openSince.remove(pkg);
                if (s != null) add(total, pkg, e.getTimeStamp() - s);
            }
        }
        // Whatever is still open counts until now (only the most recent one is really on screen).
        String latest = null;
        long latestTs = 0;
        for (Map.Entry<String, Long> en : openSince.entrySet()) {
            if (en.getValue() > latestTs) { latestTs = en.getValue(); latest = en.getKey(); }
        }
        if (latest != null) add(total, latest, now - latestTs);

        String home = homePackage(c);
        total.remove(home);
        total.remove("com.android.systemui");
        List<String> keys = new ArrayList<String>(total.keySet());
        Collections.sort(keys, new Comparator<String>() {
            @Override public int compare(String a, String b) { return Long.compare(total.get(b), total.get(a)); }
        });
        for (String k : keys) if (total.get(k) >= 30000) out.put(k, total.get(k));
        return out;
    }

    private static void add(Map<String, Long> m, String k, long v) {
        if (v <= 0) return;
        Long old = m.get(k);
        m.put(k, (old == null ? 0 : old) + v);
    }

    private static String homePackage(Context c) {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_HOME);
        ResolveInfo ri = c.getPackageManager().resolveActivity(i, 0);
        return ri == null || ri.activityInfo == null ? "" : ri.activityInfo.packageName;
    }

    public static long totalMillis(Map<String, Long> m) {
        long t = 0;
        for (long v : m.values()) t += v;
        return t;
    }

    public static String duration(long ms) {
        long min = ms / 60000;
        if (min < 60) return min + "m";
        return (min / 60) + "h " + (min % 60) + "m";
    }

    public static String spokenDuration(long ms) {
        long min = Math.round(ms / 60000.0);
        if (min < 1) return "less than a minute";
        if (min < 60) return min + (min == 1 ? " minute" : " minutes");
        long h = min / 60, m = min % 60;
        return h + (h == 1 ? " hour" : " hours") + (m > 0 ? " and " + m + (m == 1 ? " minute" : " minutes") : "");
    }

    /** Your own daily limits, "app: minutes" per line, e.g. "instagram: 60". */
    public static LinkedHashMap<String, Integer> limits(Prefs p) {
        LinkedHashMap<String, Integer> out = new LinkedHashMap<String, Integer>();
        for (String line : p.getString("limits", "instagram: 60\nyoutube: 90\nchrome: 120").split("\n")) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            try {
                out.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), Integer.parseInt(line.substring(colon + 1).trim()));
            } catch (NumberFormatException ignored) { }
        }
        return out;
    }

    /** Minutes used today by the app whose name matches, or -1. */
    public static long usedMillisFor(Context c, Map<String, Long> usage, String appName) {
        double best = 0;
        long found = -1;
        for (Map.Entry<String, Long> e : usage.entrySet()) {
            String label = NotifListener.appLabel(c, e.getKey());
            double s = Math.max(Fuzzy.score(appName, label), Fuzzy.score(appName, e.getKey().replace('.', ' ')));
            if (s > best && s >= 0.8) { best = s; found = e.getValue(); }
        }
        return found;
    }
}
