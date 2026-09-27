package com.priyatham.health;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/** Small SharedPreferences-backed store shared by the plugin, receivers and services. */
public final class Store {
    private static final String PREFS = "companion";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_EVENTS = "events";

    private Store() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- alarms ----------
    static synchronized JSONObject alarms(Context c) {
        try {
            return new JSONObject(prefs(c).getString(KEY_ALARMS, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static synchronized void saveAlarm(Context c, JSONObject a) {
        JSONObject all = alarms(c);
        try {
            all.put(String.valueOf(a.getInt("id")), a);
        } catch (JSONException ignored) {}
        prefs(c).edit().putString(KEY_ALARMS, all.toString()).apply();
    }

    static synchronized JSONObject getAlarm(Context c, int id) {
        return alarms(c).optJSONObject(String.valueOf(id));
    }

    static synchronized void removeAlarm(Context c, int id) {
        JSONObject all = alarms(c);
        all.remove(String.valueOf(id));
        prefs(c).edit().putString(KEY_ALARMS, all.toString()).apply();
    }

    static synchronized List<JSONObject> alarmList(Context c) {
        List<JSONObject> out = new ArrayList<>();
        JSONObject all = alarms(c);
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            JSONObject a = all.optJSONObject(it.next());
            if (a != null) out.add(a);
        }
        return out;
    }

    // ---------- events (actions taken outside the app, drained by JS) ----------
    static synchronized void addEvent(Context c, JSONObject e) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(KEY_EVENTS, "[]"));
            arr.put(e);
            prefs(c).edit().putString(KEY_EVENTS, arr.toString()).apply();
        } catch (JSONException ignored) {}
    }

    static synchronized JSONArray drainEvents(Context c) {
        JSONArray arr;
        try {
            arr = new JSONArray(prefs(c).getString(KEY_EVENTS, "[]"));
        } catch (JSONException e) {
            arr = new JSONArray();
        }
        prefs(c).edit().putString(KEY_EVENTS, "[]").apply();
        return arr;
    }

    static void setLastEvent(Context c, String key) {
        if (key == null || key.isEmpty()) return;
        prefs(c).edit().putLong("last_" + key, System.currentTimeMillis()).apply();
    }

    static long lastEvent(Context c, String key) {
        return prefs(c).getLong("last_" + key, 0L);
    }
}
