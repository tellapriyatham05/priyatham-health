package com.priyatham.jarvis;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Always-on listener. Runs the offline "Hey Jarvis" detector on the microphone and opens the
 * HUD when it hears you. Nothing is recorded or sent anywhere: audio is processed in 80 ms
 * slices and thrown away.
 */
public class JarvisService extends Service {
    private static final String TAG = "Jarvis";
    static final String ACTION_START = "start", ACTION_STOP = "stop", ACTION_PAUSE = "pause", ACTION_RESUME = "resume";
    static final String CH_LISTEN = "listening", CH_WAKE = "wake", CH_ALERTS = "alerts";
    private static final int NOTIF_ID = 7, WAKE_NOTIF_ID = 8, SILENT_NOTIF_ID = 9;

    private static volatile boolean running;
    private static volatile String lastError;
    private static volatile float lastScore;

    private final Object lock = new Object();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean paused, stopping;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private Prefs prefs;

    public static boolean isRunning() { return running; }
    public static String lastError() { return lastError; }
    public static float lastScore() { return lastScore; }

    public static void start(Context c) {
        c.startForegroundService(new Intent(c, JarvisService.class).setAction(ACTION_START));
    }

    public static void stop(Context c) {
        c.startService(new Intent(c, JarvisService.class).setAction(ACTION_STOP));
    }

    static void pauseListening(Context c) {
        if (running) c.startService(new Intent(c, JarvisService.class).setAction(ACTION_PAUSE));
    }

    static void resumeListening(Context c) {
        if (running) {
            try {
                c.startService(new Intent(c, JarvisService.class).setAction(ACTION_RESUME));
            } catch (IllegalStateException ignored) { }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new Prefs(this);
        createChannels(this);
    }

    static void createChannels(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel listen = new NotificationChannel(CH_LISTEN, "Listening for Hey Jarvis", NotificationManager.IMPORTANCE_MIN);
        listen.setShowBadge(false);
        nm.createNotificationChannel(listen);
        NotificationChannel wake = new NotificationChannel(CH_WAKE, "JARVIS screen", NotificationManager.IMPORTANCE_HIGH);
        wake.setSound(null, null);
        nm.createNotificationChannel(wake);
        NotificationChannel alerts = new NotificationChannel(CH_ALERTS, "Reminders and alerts", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(alerts);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null || intent.getAction() == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            prefs.putBool("wake_enabled", false);
            shutdown();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIF_ID, buildNotification());
        running = true;
        if (ACTION_PAUSE.equals(action)) {
            paused = true;
        } else if (ACTION_RESUME.equals(action)) {
            setPaused(false);
        } else {
            prefs.putBool("wake_enabled", true);
            setPaused(false);
            startWorker();
        }
        return START_STICKY;
    }

    private void setPaused(boolean p) {
        synchronized (lock) {
            paused = p;
            lock.notifyAll();
        }
    }

    private Notification buildNotification() {
        PendingIntent talk = PendingIntent.getActivity(this, 1, new Intent(this, HudActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, JarvisService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent open = PendingIntent.getActivity(this, 3, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CH_LISTEN)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("JARVIS is listening")
                .setContentText("Say \"Hey Jarvis\". Everything stays on this phone.")
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Talk", talk).build())
                .addAction(new Notification.Action.Builder(null, "Turn off", stop).build())
                .build();
    }

    private void startWorker() {
        if (worker != null && worker.isAlive()) return;
        stopping = false;
        worker = new Thread(new Runnable() {
            @Override public void run() { listenLoop(); }
        }, "jarvis-wake");
        worker.setPriority(Thread.NORM_PRIORITY + 1);
        worker.start();
    }

    private static byte[] asset(AssetManager am, String name) throws IOException {
        InputStream in = am.open(name);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    private void listenLoop() {
        WakeWordEngine engine;
        try {
            AssetManager am = getAssets();
            engine = new WakeWordEngine(asset(am, "models/melspectrogram.onnx"), asset(am, "models/embedding_model.onnx"),
                    asset(am, "models/hey_jarvis_v0.1.onnx"));
        } catch (Throwable t) {
            lastError = "Wake word engine failed to load: " + t;
            Log.e(TAG, lastError, t);
            return;
        }
        lastError = null;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jarvis:listen");
        AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        short[] frame = new short[WakeWordEngine.FRAME];
        long silentSince = 0;
        long lastLimitCheck = 0;
        try {
            while (!stopping) {
                synchronized (lock) {
                    while (paused && !stopping) {
                        try { lock.wait(); } catch (InterruptedException e) { return; }
                    }
                }
                if (stopping) break;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    lastError = "Microphone permission missing.";
                    paused = true;
                    continue;
                }
                int minBuf = AudioRecord.getMinBufferSize(WakeWordEngine.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                AudioRecord rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, WakeWordEngine.SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuf, WakeWordEngine.FRAME * 2 * 6));
                if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                    rec.release();
                    lastError = "Microphone busy. Retrying...";
                    sleep(2000);
                    continue;
                }
                if (!wakeLock.isHeld()) wakeLock.acquire();
                engine.reset();
                rec.startRecording();
                lastError = null;
                try {
                    while (!stopping && !paused) {
                        int got = 0;
                        while (got < frame.length && !paused && !stopping) {
                            int n = rec.read(frame, got, frame.length - got);
                            if (n <= 0) break;
                            got += n;
                        }
                        if (got < frame.length) {
                            if (!paused && !stopping) { sleep(200); break; }
                            continue;
                        }
                        // Android hands apps silence when it won't share the mic (calls, other recorders, background limits).
                        boolean silent = true;
                        for (short s : frame) if (s > 8 || s < -8) { silent = false; break; }
                        long now = System.currentTimeMillis();
                        if (silent) {
                            if (silentSince == 0) silentSince = now;
                            else if (now - silentSince > 20000 && audioManager.getMode() == AudioManager.MODE_NORMAL) {
                                notifySilent();
                                silentSince = now + 600000;
                            }
                        } else {
                            silentSince = 0;
                        }
                        int mode = audioManager.getMode();
                        if (mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION) continue;
                        float score = engine.process(frame);
                        lastScore = score;
                        if (score >= prefs.wakeThreshold()) {
                            paused = true;
                            engine.reset();
                            main.post(new Runnable() { @Override public void run() { onWake(); } });
                        }
                        if (now - lastLimitCheck > 10 * 60 * 1000) {
                            lastLimitCheck = now;
                            checkLimits();
                        }
                    }
                } finally {
                    try { rec.stop(); } catch (IllegalStateException ignored) { }
                    rec.release();
                    if (wakeLock.isHeld()) wakeLock.release();
                }
            }
        } catch (Throwable t) {
            lastError = "Listening stopped: " + t;
            Log.e(TAG, lastError, t);
        } finally {
            engine.close();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    private void onWake() {
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null && prefs.getBool("wake_vibrate", true)) v.vibrate(VibrationEffect.createOneShot(40, 120));
        Intent hud = new Intent(this, HudActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Wake the screen so the HUD is visible.
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        @SuppressWarnings("deprecation")
        PowerManager.WakeLock screen = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "jarvis:wake");
        screen.acquire(3000);
        if (Settings.canDrawOverlays(this)) {
            try {
                startActivity(hud);
                return;
            } catch (Exception e) {
                Log.w(TAG, "direct launch failed", e);
            }
        }
        // Fallback: a full-screen notification, which Android shows like an incoming call.
        PendingIntent pi = PendingIntent.getActivity(this, 4, hud, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH_WAKE)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("JARVIS")
                .setContentText("Yes, sir?")
                .setCategory(Notification.CATEGORY_CALL)
                .setFullScreenIntent(pi, true)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setTimeoutAfter(15000)
                .build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(WAKE_NOTIF_ID, n);
        // If nothing opens within a few seconds, listen again.
        main.postDelayed(new Runnable() {
            @Override public void run() { if (paused && !HudVisible.visible) setPaused(false); }
        }, 15000);
    }

    private void notifySilent() {
        PendingIntent pi = PendingIntent.getService(this, 5, new Intent(this, JarvisService.class).setAction(ACTION_START),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH_ALERTS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("JARVIS can't hear the microphone")
                .setContentText("Tap to reconnect. If it keeps happening, open JARVIS and check battery settings.")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(SILENT_NOTIF_ID, n);
    }

    /** Your own daily app limits ("instagram: 60"): one heads-up per app per day. */
    private void checkLimits() {
        if (!SystemStats.hasUsageAccess(this)) return;
        LinkedHashMap<String, Long> usage = SystemStats.screenTimeToday(this);
        String day = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        int id = 100;
        for (Map.Entry<String, Integer> l : SystemStats.limits(prefs).entrySet()) {
            id++;
            long used = SystemStats.usedMillisFor(this, usage, l.getKey());
            if (used < l.getValue() * 60000L) continue;
            String key = "limit_warned_" + l.getKey();
            if (day.equals(prefs.getString(key, ""))) continue;
            prefs.putString(key, day);
            Notification n = new Notification.Builder(this, CH_ALERTS)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle("Limit reached: " + l.getKey())
                    .setContentText("You've used " + l.getKey() + " for " + SystemStats.spokenDuration(used) + " today (limit " + l.getValue() + " min).")
                    .setAutoCancel(true)
                    .build();
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(id, n);
        }
    }

    private void shutdown() {
        running = false;
        stopping = true;
        setPaused(false);
        synchronized (lock) { lock.notifyAll(); }
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    /** Tracks whether the HUD is on screen (used by the fallback timer). */
    static final class HudVisible {
        static volatile boolean visible;
    }
}
