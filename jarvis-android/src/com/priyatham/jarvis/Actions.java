package com.priyatham.jarvis;

import android.Manifest;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.SearchManager;
import android.bluetooth.BluetoothAdapter;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Resources;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.provider.AlarmClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.view.KeyEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The things JARVIS can physically do on the phone. */
public final class Actions {
    private Actions() {}

    static boolean granted(Context c, String perm) {
        return c.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean start(Context c, Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (SecurityException e) {
            return false;
        }
    }

    // ---- Calls and messages ----

    public static boolean call(Context c, String number) {
        String n = number.replaceAll("[^0-9+]", "");
        if (granted(c, Manifest.permission.CALL_PHONE)) return start(c, new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + n)));
        return start(c, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + n)));
    }

    public static boolean sms(Context c, String number, String text) {
        if (!granted(c, Manifest.permission.SEND_SMS)) return false;
        try {
            SmsManager sm = SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(text);
            sm.sendMultipartTextMessage(number.replaceAll("[^0-9+]", ""), null, parts, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** International digits for WhatsApp links: 10-digit Indian numbers get the country code. */
    static String waNumber(Prefs p, String number) {
        String d = number.replaceAll("[^0-9+]", "");
        if (d.startsWith("+")) return d.substring(1);
        if (d.startsWith("00")) return d.substring(2);
        if (d.startsWith("0") && d.length() == 11) d = d.substring(1);
        if (d.length() == 10) return p.getString("country_code", "91") + d;
        return d;
    }

    public static boolean whatsapp(Context c, String number, String text) {
        Prefs p = new Prefs(c);
        Uri uri = Uri.parse("https://api.whatsapp.com/send?phone=" + waNumber(p, number) + "&text=" + Uri.encode(text));
        for (String pkg : new String[]{"com.whatsapp", "com.whatsapp.w4b"}) {
            Intent i = new Intent(Intent.ACTION_VIEW, uri).setPackage(pkg);
            if (start(c, i)) {
                JarvisAccessibility.armWhatsAppSend();
                return true;
            }
        }
        return false;
    }

    // ---- Apps, web, media ----

    public static final class App {
        public final String label;
        public final ComponentName component;
        public final double score;

        App(String label, ComponentName component, double score) {
            this.label = label;
            this.component = component;
            this.score = score;
        }
    }

    public static App findApp(Context c, String spoken) {
        PackageManager pm = c.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        String want = synonym(spoken);
        App best = null;
        for (ResolveInfo ri : apps) {
            if (ri.activityInfo.packageName.equals(c.getPackageName())) continue;
            String label = ri.loadLabel(pm).toString();
            double s = Fuzzy.score(want, label);
            if (best == null || s > best.score) {
                best = new App(label, new ComponentName(ri.activityInfo.packageName, ri.activityInfo.name), s);
            }
        }
        return best != null && best.score >= 0.78 ? best : null;
    }

    private static String synonym(String s) {
        String t = s.toLowerCase(Locale.ROOT).trim();
        if (t.equals("insta") || t.equals("ig")) return "instagram";
        if (t.equals("yt")) return "youtube";
        if (t.equals("browser") || t.equals("google chrome")) return "chrome";
        if (t.equals("gallery") || t.equals("pictures")) return "photos";
        if (t.equals("dialer") || t.equals("phone app")) return "phone";
        if (t.equals("sms") || t.equals("text messages")) return "messages";
        if (t.equals("mail")) return "gmail";
        if (t.equals("play store") || t.equals("store")) return "play store";
        if (t.equals("fb")) return "facebook";
        if (t.equals("twitter")) return "x";
        if (t.equals("code") || t.equals("vs code")) return "github";
        return t;
    }

    public static boolean openApp(Context c, App a) {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(a.component);
        i.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return start(c, i);
    }

    static boolean looksLikeWebsite(String t) {
        return t.matches(".*\\b[a-z0-9-]+(?:\\.| dot )(?:com|in|org|net|io|ai|dev|co|app|edu|gov|me|tv)\\b.*");
    }

    public static boolean openUrl(Context c, String target) {
        String u = target.trim().replace(" dot ", ".").replace(" ", "");
        if (!u.startsWith("http")) u = "https://" + u;
        return start(c, new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
    }

    public static boolean webSearch(Context c, String q) {
        Intent i = new Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, q);
        if (start(c, i)) return true;
        return start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
    }

    public static boolean youtube(Context c, String q) {
        Intent i = new Intent(Intent.ACTION_SEARCH).setPackage("com.google.android.youtube").putExtra("query", q);
        if (start(c, i)) return true;
        return start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))));
    }

    static String musicPackage(Context c, String spokenApp) {
        String app = spokenApp == null ? "" : spokenApp;
        if (app.contains("spotify")) return "com.spotify.music";
        if (app.contains("youtube")) return "com.google.android.apps.youtube.music";
        if (app.contains("saavn")) return "com.jio.media.jiobeats";
        if (app.contains("gaana")) return "com.gaana";
        if (app.contains("wynk")) return "com.bsbportal.music";
        String pref = new Prefs(c).getString("music_app", "");
        if (pref.length() > 0) return pref;
        PackageManager pm = c.getPackageManager();
        for (String pkg : new String[]{"com.spotify.music", "com.google.android.apps.youtube.music", "com.jio.media.jiobeats",
                "com.gaana", "com.bsbportal.music", "com.oneplus.music", "com.heytap.music"}) {
            if (pm.getLaunchIntentForPackage(pkg) != null) return pkg;
        }
        return null;
    }

    /** Asks the music app to find and play something ("Believer", "my workout playlist"). */
    public static boolean playFromSearch(Context c, String query, String spokenApp) {
        Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        i.putExtra(SearchManager.QUERY, query);
        i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        String pkg = musicPackage(c, spokenApp);
        if (pkg != null) {
            i.setPackage(pkg);
            if (start(c, i)) return true;
            i.setPackage(null);
        }
        return start(c, i);
    }

    public static boolean openMusicApp(Context c) {
        String pkg = musicPackage(c, null);
        if (pkg == null) return false;
        Intent i = c.getPackageManager().getLaunchIntentForPackage(pkg);
        return i != null && start(c, i);
    }

    public static void mediaKey(Context c, int keyCode) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
    }

    public static boolean musicActive(Context c) {
        return ((AudioManager) c.getSystemService(Context.AUDIO_SERVICE)).isMusicActive();
    }

    // ---- Settings ----

    static int brightnessMax() {
        try {
            Resources r = Resources.getSystem();
            int id = r.getIdentifier("config_screenBrightnessSettingMaximum", "integer", "android");
            if (id != 0) {
                int v = r.getInteger(id);
                if (v > 0) return v;
            }
        } catch (Exception ignored) { }
        return 255;
    }

    /** Current brightness as the slider percentage (Android's slider is not linear). */
    public static int brightnessPercent(Context c) {
        try {
            int v = Settings.System.getInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            return (int) Math.round(100 * Math.pow(Math.min(1.0, v / (double) brightnessMax()), 1 / 2.2));
        } catch (Settings.SettingNotFoundException e) {
            return 50;
        }
    }

    /** @return false when JARVIS is not allowed to modify system settings yet. */
    public static boolean setBrightness(Context c, int percent) {
        if (!Settings.System.canWrite(c)) return false;
        int p = Math.max(1, Math.min(100, percent));
        int max = brightnessMax();
        int value = (int) Math.max(1, Math.round(max * Math.pow(p / 100.0, 2.2)));
        Settings.System.putInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
        Settings.System.putInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, value);
        return true;
    }

    public static boolean setAutoBrightness(Context c, boolean on) {
        if (!Settings.System.canWrite(c)) return false;
        return Settings.System.putInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE,
                on ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
    }

    public static boolean setAutoRotate(Context c, boolean on) {
        if (!Settings.System.canWrite(c)) return false;
        return Settings.System.putInt(c.getContentResolver(), Settings.System.ACCELEROMETER_ROTATION, on ? 1 : 0);
    }

    public static boolean wifiOn(Context c) {
        WifiManager wm = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        return wm != null && wm.isWifiEnabled();
    }

    @SuppressWarnings("deprecation")
    public static boolean setWifi(Context c, boolean on) {
        WifiManager wm = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        try {
            return wm != null && wm.setWifiEnabled(on);
        } catch (SecurityException e) {
            return false;
        }
    }

    public static boolean bluetoothOn() {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        try {
            return a != null && a.isEnabled();
        } catch (SecurityException e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    public static boolean setBluetooth(boolean on) {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null) return false;
        try {
            return on ? a.enable() : a.disable();
        } catch (SecurityException e) {
            return false;
        }
    }

    private static boolean torchState;

    public static boolean torchOn() {
        return torchState;
    }

    public static boolean setTorch(Context c, boolean on) {
        CameraManager cm = (CameraManager) c.getSystemService(Context.CAMERA_SERVICE);
        try {
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                if (Boolean.TRUE.equals(flash) && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cm.setTorchMode(id, on);
                    torchState = on;
                    return true;
                }
            }
        } catch (CameraAccessException e) {
            return false;
        } catch (IllegalArgumentException e) {
            return false;
        }
        return false;
    }

    public static boolean dndAllowed(Context c) {
        return ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).isNotificationPolicyAccessGranted();
    }

    public static boolean dndOn(Context c) {
        return ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).getCurrentInterruptionFilter()
                != NotificationManager.INTERRUPTION_FILTER_ALL;
    }

    public static boolean setDnd(Context c, boolean on) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (!nm.isNotificationPolicyAccessGranted()) return false;
        nm.setInterruptionFilter(on ? NotificationManager.INTERRUPTION_FILTER_PRIORITY : NotificationManager.INTERRUPTION_FILTER_ALL);
        return true;
    }

    /** @param mode silent | vibrate | normal */
    public static boolean setRinger(Context c, String mode) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        int m = "silent".equals(mode) ? AudioManager.RINGER_MODE_SILENT
                : "vibrate".equals(mode) ? AudioManager.RINGER_MODE_VIBRATE : AudioManager.RINGER_MODE_NORMAL;
        try {
            am.setRingerMode(m);
            return am.getRingerMode() == m;
        } catch (SecurityException e) {
            return false;
        }
    }

    public static int volumePercent(Context c) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        return Math.round(100f * am.getStreamVolume(AudioManager.STREAM_MUSIC) / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
    }

    public static void setVolume(Context c, int percent) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int v = Math.round(Math.max(0, Math.min(100, percent)) / 100f * max);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, v, AudioManager.FLAG_SHOW_UI);
    }

    public static void mute(Context c, boolean mute) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, mute ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI);
    }

    public static boolean openSettings(Context c, String which) {
        String w = which == null ? "" : which.toLowerCase(Locale.ROOT);
        String action = Settings.ACTION_SETTINGS;
        if (w.contains("wifi") || w.contains("internet")) action = Settings.ACTION_WIFI_SETTINGS;
        else if (w.contains("bluetooth")) action = Settings.ACTION_BLUETOOTH_SETTINGS;
        else if (w.contains("display") || w.contains("brightness")) action = Settings.ACTION_DISPLAY_SETTINGS;
        else if (w.contains("sound") || w.contains("volume")) action = Settings.ACTION_SOUND_SETTINGS;
        else if (w.contains("battery")) action = Intent.ACTION_POWER_USAGE_SUMMARY;
        else if (w.contains("location")) action = Settings.ACTION_LOCATION_SOURCE_SETTINGS;
        else if (w.contains("airplane") || w.contains("flight")) action = Settings.ACTION_AIRPLANE_MODE_SETTINGS;
        else if (w.contains("data") || w.contains("mobile") || w.contains("network")) action = Settings.ACTION_DATA_ROAMING_SETTINGS;
        else if (w.contains("hotspot") || w.contains("tether")) action = Settings.ACTION_WIRELESS_SETTINGS;
        else if (w.contains("nfc")) action = Settings.ACTION_NFC_SETTINGS;
        else if (w.contains("app")) action = Settings.ACTION_APPLICATION_SETTINGS;
        else if (w.contains("notification")) action = "android.settings.NOTIFICATION_SETTINGS";
        else if (w.contains("storage")) action = Settings.ACTION_INTERNAL_STORAGE_SETTINGS;
        else if (w.contains("date") || w.contains("time")) action = Settings.ACTION_DATE_SETTINGS;
        else if (w.contains("accessibility")) action = Settings.ACTION_ACCESSIBILITY_SETTINGS;
        else if (w.contains("security") || w.contains("lock")) action = Settings.ACTION_SECURITY_SETTINGS;
        else if (w.contains("developer")) action = Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS;
        if (start(c, new Intent(action))) return true;
        return start(c, new Intent(Settings.ACTION_SETTINGS));
    }

    /** Android's own on/off panel (used when a switch can't be flipped directly). */
    public static boolean openPanel(Context c, String device) {
        if ("wifi".equals(device) || "data".equals(device)) {
            if (start(c, new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY))) return true;
        }
        if ("nfc".equals(device) && start(c, new Intent(Settings.Panel.ACTION_NFC))) return true;
        if ("bluetooth".equals(device)) return start(c, new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
        return openSettings(c, device);
    }

    // ---- Clock ----

    public static boolean setAlarm(Context c, int hour, int minute, String label) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        if (label != null) i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
        return start(c, i);
    }

    public static boolean setTimer(Context c, int seconds, String label) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        if (label != null) i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
        return start(c, i);
    }

    public static void setReminder(Context c, long atMillis, String text) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        int id = (int) (atMillis / 1000 % Integer.MAX_VALUE);
        Intent i = new Intent(c, ReminderReceiver.class).putExtra("text", text).putExtra("id", id);
        PendingIntent pi = PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pi);
    }

    // ---- Camera and screen ----

    public static boolean camera(Context c, boolean selfie) {
        Intent i = new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
        if (selfie) {
            i.putExtra("android.intent.extras.CAMERA_FACING", 1);
            i.putExtra("android.intent.extras.LENS_FACING_FRONT", 1);
            i.putExtra("android.intent.extra.USE_FRONT_CAMERA", true);
        }
        return start(c, i);
    }

    public static boolean goHome(Context c) {
        if (JarvisAccessibility.global(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)) return true;
        return start(c, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
    }

    public static boolean isLocked(Context c) {
        return ((KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked();
    }
}
