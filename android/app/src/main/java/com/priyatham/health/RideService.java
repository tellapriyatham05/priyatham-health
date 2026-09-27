package com.priyatham.health;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Foreground service that records an outdoor ride with the phone's GPS.
 * Keeps recording with the screen off. Calories use MET values by speed.
 */
public class RideService extends Service implements LocationListener {
    static final int NOTIF_ID = 424242;

    // shared state, read by the plugin
    static volatile boolean running = false;
    static volatile boolean paused = false;
    static volatile double distanceM = 0, kcal = 0, climbM = 0, speedKmh = 0, maxKmh = 0;
    static volatile long startTs = 0, movingMs = 0, elapsedMs = 0;
    static volatile double weightKg = 75;
    static volatile int gpsAccuracy = -1;
    static final JSONArray points = new JSONArray();

    private Location last;
    private double lastAlt = Double.NaN;
    private long lastTick;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            if (!paused) elapsedMs += now - lastTick;
            lastTick = now;
            updateNotification();
            h.postDelayed(this, 1000);
        }
    };

    static void reset(double weight) {
        synchronized (points) {
            while (points.length() > 0) points.remove(0);
        }
        distanceM = 0;
        kcal = 0;
        climbM = 0;
        speedKmh = 0;
        maxKmh = 0;
        movingMs = 0;
        elapsedMs = 0;
        gpsAccuracy = -1;
        weightKg = weight > 20 ? weight : 75;
        startTs = System.currentTimeMillis();
        paused = false;
    }

    static double met(double kmh) {
        if (kmh < 10) return 3.5;
        if (kmh < 16) return 5.8;
        if (kmh < 19) return 6.8;
        if (kmh < 22) return 8.0;
        if (kmh < 25) return 10.0;
        if (kmh < 30) return 12.0;
        return 15.8;
    }

    static JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            o.put("running", running).put("paused", paused).put("km", distanceM / 1000.0)
                    .put("kcal", kcal).put("climb", climbM).put("speed", speedKmh).put("maxSpeed", maxKmh)
                    .put("elapsedSec", elapsedMs / 1000).put("movingSec", movingMs / 1000)
                    .put("start", startTs).put("accuracy", gpsAccuracy);
            synchronized (points) {
                o.put("points", new JSONArray(points.toString()));
            }
        } catch (Exception ignored) {}
        return o;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @SuppressLint("MissingPermission")
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        AlarmReceiver.ensureChannels(this);
        Notification n = build("Starting GPS…");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, n);
        }
        if (!running) {
            running = true;
            lastTick = System.currentTimeMillis();
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            try {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 2, this, Looper.getMainLooper());
            } catch (Exception ignored) {}
            h.post(tick);
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(@NonNull Location loc) {
        gpsAccuracy = (int) loc.getAccuracy();
        if (paused || loc.getAccuracy() > 30) return;
        if (last != null) {
            double d = last.distanceTo(loc);
            long dt = loc.getTime() - last.getTime();
            if (dt <= 0) return;
            double kmh = d / (dt / 1000.0) * 3.6;
            if (kmh > 80) return; // GPS jump
            speedKmh = loc.hasSpeed() ? loc.getSpeed() * 3.6 : kmh;
            if (speedKmh >= 2.0) { // auto-pause when stopped
                distanceM += d;
                movingMs += dt;
                kcal += met(speedKmh) * weightKg * (dt / 3_600_000.0);
                if (speedKmh > maxKmh) maxKmh = speedKmh;
            }
            if (loc.hasAltitude()) {
                double alt = loc.getAltitude();
                if (!Double.isNaN(lastAlt) && alt - lastAlt > 2) climbM += alt - lastAlt;
                if (Double.isNaN(lastAlt) || Math.abs(alt - lastAlt) > 2) lastAlt = alt;
            }
        }
        last = loc;
        synchronized (points) {
            if (points.length() < 5000) {
                try {
                    points.put(new JSONArray().put(loc.getLatitude()).put(loc.getLongitude()));
                } catch (Exception ignored) {}
            }
        }
    }

    @Override public void onStatusChanged(String p, int s, Bundle b) {}
    @Override public void onProviderEnabled(@NonNull String p) {}
    @Override public void onProviderDisabled(@NonNull String p) {}

    private Notification build(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.putExtra("route", "ride");
        PendingIntent pi = PendingIntent.getActivity(this, 424, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, AlarmReceiver.CH_RIDE)
                .setSmallIcon(R.drawable.ic_stat_logo)
                .setColor(AlarmReceiver.GOLD)
                .setContentTitle(paused ? "Ride paused" : "Recording your ride")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
    }

    private void updateNotification() {
        long s = elapsedMs / 1000;
        String t = String.format(Locale.US, "%.2f km · %d:%02d:%02d · %.0f kcal", distanceM / 1000, s / 3600, (s / 60) % 60, s % 60, kcal);
        try {
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, build(t));
        } catch (SecurityException ignored) {}
    }

    @Override
    public void onDestroy() {
        running = false;
        h.removeCallbacks(tick);
        try {
            ((LocationManager) getSystemService(Context.LOCATION_SERVICE)).removeUpdates(this);
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
