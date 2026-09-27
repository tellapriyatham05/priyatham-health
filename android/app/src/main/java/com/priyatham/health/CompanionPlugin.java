package com.priyatham.health;

import android.Manifest;
import android.app.AlarmManager;
import android.app.AppOpsManager;
import android.app.NotificationManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(
        name = "Companion",
        permissions = {
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"}),
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "activity", strings = {"android.permission.ACTIVITY_RECOGNITION"})
        }
)
public class CompanionPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void load() {
        AlarmReceiver.ensureChannels(getContext());
        tts = new TextToSpeech(getContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("en", "IN"));
                tts.setSpeechRate(1.0f);
                ttsReady = true;
            }
        });
    }

    // ---------------- reminders & alarms ----------------
    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            JSONArray list = call.getArray("alarms");
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.getJSONObject(i);
                if (a.optLong("at") <= System.currentTimeMillis()) {
                    long n = AlarmScheduler.next(a, System.currentTimeMillis());
                    if (n < 0) continue;
                    a.put("at", n);
                }
                AlarmScheduler.schedule(getContext(), a);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            JSONArray ids = call.getArray("ids");
            for (int i = 0; i < ids.length(); i++) AlarmScheduler.cancel(getContext(), ids.getInt(i));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Cancels every alarm whose key starts with the prefix (e.g. "prep:" or "rem:"). */
    @PluginMethod
    public void cancelPrefix(PluginCall call) {
        String prefix = call.getString("prefix", "");
        for (JSONObject a : Store.alarmList(getContext())) {
            if (a.optString("key").startsWith(prefix)) AlarmScheduler.cancel(getContext(), a.optInt("id"));
        }
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        for (JSONObject a : Store.alarmList(getContext())) arr.put(a);
        JSObject r = new JSObject();
        r.put("alarms", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void drainEvents(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("events", new JSArray(Store.drainEvents(getContext()).toString()));
        } catch (Exception e) {
            r.put("events", new JSArray());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void markEvent(PluginCall call) {
        Store.setLastEvent(getContext(), call.getString("key", ""));
        call.resolve();
    }

    @PluginMethod
    public void testAlarm(PluginCall call) {
        try {
            JSONObject a = new JSONObject();
            a.put("id", 99_000_001).put("key", "test").put("title", call.getString("title", "Test alarm"))
                    .put("body", "This is how your reminders ring. On silent, it vibrates.")
                    .put("mode", call.getString("mode", "alarm")).put("at", System.currentTimeMillis() + 5000)
                    .put("actions", new JSONArray().put("done").put("snooze"));
            AlarmScheduler.schedule(getContext(), a);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---------------- permissions & settings ----------------
    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("notifications", getPermissionState("notifications") == PermissionState.GRANTED || Build.VERSION.SDK_INT < 33);
        r.put("location", getPermissionState("location") == PermissionState.GRANTED);
        r.put("activity", getPermissionState("activity") == PermissionState.GRANTED || Build.VERSION.SDK_INT < 29);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        r.put("exactAlarm", Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms());
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        r.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("battery", pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        r.put("usage", hasUsage());
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(r);
    }

    @PluginMethod
    public void request(PluginCall call) {
        String alias = call.getString("alias", "notifications");
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            status(call);
        } else {
            requestPermissionForAlias(alias, call, "permCallback");
        }
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        status(call);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "app");
        Context c = getContext();
        Intent i;
        switch (which) {
            case "exactAlarm":
                i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + c.getPackageName()));
                break;
            case "fullScreen":
                i = Build.VERSION.SDK_INT >= 34
                        ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.getPackageName()))
                        : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
                break;
            case "battery":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
                break;
            case "usage":
                i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                break;
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception e) {
            Intent f = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
            f.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(f);
        }
        call.resolve();
    }

    // ---------------- steps ----------------
    @PluginMethod
    public void steps(PluginCall call) {
        if (getPermissionState("activity") != PermissionState.GRANTED && Build.VERSION.SDK_INT >= 29) {
            JSObject r = new JSObject();
            r.put("steps", Steps.stored(getContext()));
            r.put("allowed", false);
            call.resolve(r);
            return;
        }
        Steps.read(getContext(), () -> {
            JSObject r = new JSObject();
            r.put("steps", Steps.stored(getContext()));
            r.put("allowed", true);
            call.resolve(r);
        });
    }

    // ---------------- screen time ----------------
    private boolean hasUsage() {
        AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        int mode = Build.VERSION.SDK_INT >= 29
                ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName())
                : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    @PluginMethod
    public void usage(PluginCall call) {
        if (!hasUsage()) {
            call.reject("NO_USAGE_ACCESS");
            return;
        }
        long start = call.getLong("start", 0L);
        long end = Math.min(call.getLong("end", System.currentTimeMillis()), System.currentTimeMillis());
        Context c = getContext();
        UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
        PackageManager pm = c.getPackageManager();

        Set<String> skip = new HashSet<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)) {
            skip.add(ri.activityInfo.packageName);
        }
        skip.add("com.android.systemui");

        Map<String, Long> totals = new HashMap<>();
        long lateNight = 0;
        long nightA0 = start, nightA1 = start + 5 * 3_600_000L;              // 00:00 – 05:00
        long nightB0 = start + 23 * 3_600_000L, nightB1 = start + 24 * 3_600_000L; // 23:00 – 24:00
        String cur = null;
        long curStart = 0;
        long firstTs = -1;
        UsageEvents events = usm.queryEvents(start - 3 * 3_600_000L, end);
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            int type = e.getEventType();
            long ts = e.getTimeStamp();
            if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                if (cur != null) lateNight += add(totals, cur, curStart, ts, start, nightA0, nightA1, nightB0, nightB1);
                cur = e.getPackageName();
                curStart = ts;
            } else if ((type == UsageEvents.Event.ACTIVITY_PAUSED && e.getPackageName().equals(cur))
                    || type == UsageEvents.Event.SCREEN_NON_INTERACTIVE
                    || type == UsageEvents.Event.DEVICE_SHUTDOWN) {
                if (cur != null) lateNight += add(totals, cur, curStart, ts, start, nightA0, nightA1, nightB0, nightB1);
                cur = null;
            }
        }
        if (cur != null) lateNight += add(totals, cur, curStart, end, start, nightA0, nightA1, nightB0, nightB1);

        JSArray apps = new JSArray();
        long total = 0;
        for (Map.Entry<String, Long> en : totals.entrySet()) {
            if (skip.contains(en.getKey()) || en.getValue() < 60_000L) continue;
            String label = en.getKey();
            try {
                ApplicationInfo ai = pm.getApplicationInfo(en.getKey(), 0);
                label = pm.getApplicationLabel(ai).toString();
            } catch (Exception ignored) {}
            JSObject o = new JSObject();
            o.put("pkg", en.getKey());
            o.put("label", label);
            o.put("ms", en.getValue());
            apps.put(o);
            total += en.getValue();
        }
        JSObject r = new JSObject();
        r.put("apps", apps);
        r.put("total", total);
        r.put("lateNight", lateNight);
        call.resolve(r);
    }

    private static long add(Map<String, Long> t, String pkg, long s, long e, long dayStart,
                            long a0, long a1, long b0, long b1) {
        s = Math.max(s, dayStart);
        if (e <= s) return 0;
        Long v = t.get(pkg);
        t.put(pkg, (v == null ? 0 : v) + (e - s));
        return Math.max(0, Math.min(e, a1) - Math.max(s, a0)) + Math.max(0, Math.min(e, b1) - Math.max(s, b0));
    }

    // ---------------- voice coach ----------------
    @PluginMethod
    public void speak(PluginCall call) {
        if (ttsReady) tts.speak(call.getString("text", ""), TextToSpeech.QUEUE_FLUSH, null, "ph");
        call.resolve();
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        AlarmReceiver.vibrate(getContext(), new long[]{0, call.getInt("ms", 200)});
        call.resolve();
    }

    // ---------------- GPS ride ----------------
    @PluginMethod
    public void startRide(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("NO_LOCATION");
            return;
        }
        RideService.reset(call.getDouble("weightKg", 75.0));
        ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RideService.class));
        try {
            call.resolve(JSObject.fromJSONObject(RideService.state()));
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void pauseRide(PluginCall call) {
        RideService.paused = call.getBoolean("paused", true);
        call.resolve();
    }

    @PluginMethod
    public void rideState(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(RideService.state()));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopRide(PluginCall call) {
        try {
            JSObject s = JSObject.fromJSONObject(RideService.state());
            getContext().stopService(new Intent(getContext(), RideService.class));
            RideService.running = false;
            call.resolve(s);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
    }
}
