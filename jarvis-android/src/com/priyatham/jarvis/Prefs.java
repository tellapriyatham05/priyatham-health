package com.priyatham.jarvis;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Everything JARVIS stores lives here, on the phone only. */
public final class Prefs {
    public static final String DEFAULT_ROUTINES =
            "good night: do not disturb on; brightness 5; pause; say Good night, sir. Sleep well.\n"
          + "good morning: do not disturb off; brightness 60; what's the date; battery; read my notifications\n"
          + "coding mode: do not disturb on; brightness 70; play coding music; say Coding mode is on. Let's build something.\n"
          + "study mode: do not disturb on; brightness 60; set a timer for 25 minutes; say Study mode is on. Twenty five minutes of focus, starting now.\n"
          + "gym mode: play workout music; volume 80; say Let's go. Gym mode activated.\n"
          + "driving mode: do not disturb off; bluetooth on; play music; say Drive safe, sir.";

    private final SharedPreferences sp;

    public Prefs(Context c) {
        sp = c.getApplicationContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE);
    }

    public String getString(String k, String def) { return sp.getString(k, def); }
    public void putString(String k, String v) { sp.edit().putString(k, v).apply(); }
    public boolean getBool(String k, boolean def) { return sp.getBoolean(k, def); }
    public void putBool(String k, boolean v) { sp.edit().putBoolean(k, v).apply(); }
    public float getFloat(String k, float def) { return sp.getFloat(k, def); }
    public void putFloat(String k, float v) { sp.edit().putFloat(k, v).apply(); }
    public int getInt(String k, int def) { return sp.getInt(k, def); }
    public void putInt(String k, int v) { sp.edit().putInt(k, v).apply(); }

    // ---- Personality and voice ----
    public String userTitle() { return getString("user_title", "sir"); }
    public String style() { return getString("style", "jarvis"); }           // jarvis | friendly | short
    public String voiceMode() { return getString("voice_mode", "classic"); }  // classic | robot | calm | professional
    public float speechRate() { return getFloat("speech_rate", 1.0f); }
    public String voiceName() { return getString("voice_name", ""); }
    public String language() { return getString("language", "en-IN"); }
    public float wakeThreshold() { return getFloat("wake_threshold", 0.45f); }
    public boolean wakeEnabled() { return getBool("wake_enabled", true); }

    // ---- Memory: aliases ("my main project" → "mediaai") ----
    public Map<String, String> memory() {
        Map<String, String> out = new LinkedHashMap<String, String>();
        try {
            JSONObject o = new JSONObject(getString("memory", "{}"));
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                out.put(k, o.getString(k));
            }
        } catch (JSONException ignored) { }
        return out;
    }

    public void remember(String key, String value) {
        Map<String, String> m = memory();
        m.put(key.toLowerCase(Locale.ROOT).trim(), value.trim());
        putString("memory", new JSONObject(m).toString());
    }

    public boolean forget(String key) {
        Map<String, String> m = memory();
        String k = key.toLowerCase(Locale.ROOT).trim();
        boolean removed = m.remove(k) != null;
        if (!removed && k.startsWith("my ")) removed = m.remove(k.substring(3)) != null;
        if (!removed && !k.startsWith("my ")) removed = m.remove("my " + k) != null;
        putString("memory", new JSONObject(m).toString());
        return removed;
    }

    // ---- Notes ----
    public List<String> notes() {
        List<String> out = new ArrayList<String>();
        try {
            JSONArray a = new JSONArray(getString("notes", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (JSONException ignored) { }
        return out;
    }

    public void addNote(String text) {
        List<String> n = notes();
        n.add(text);
        while (n.size() > 50) n.remove(0);
        putString("notes", new JSONArray(n).toString());
    }

    // ---- Routines: "name: command; command; ..." one per line ----
    public String routinesText() { return getString("routines", DEFAULT_ROUTINES); }

    public Map<String, List<String>> routines() {
        Map<String, List<String>> out = new LinkedHashMap<String, List<String>>();
        for (String line : routinesText().split("\n")) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            List<String> steps = new ArrayList<String>();
            for (String s : line.substring(colon + 1).split(";")) {
                if (s.trim().length() > 0) steps.add(s.trim());
            }
            if (name.length() > 0 && !steps.isEmpty()) out.put(name, steps);
        }
        return out;
    }

    // ---- Water (from Priyatham Health) ----
    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
    }

    public int waterToday() {
        return today().equals(getString("water_day", "")) ? getInt("water_ml", 0) : 0;
    }

    public int addWater(int ml) {
        int total = waterToday() + ml;
        sp.edit().putString("water_day", today()).putInt("water_ml", total).apply();
        return total;
    }

    public int waterGoal() { return getInt("water_goal", 3000); }

    // ---- Command log: what was said, to add new phrasings later ----
    public void log(String heard, String reply) {
        try {
            JSONArray a = new JSONArray(getString("log", "[]"));
            JSONObject o = new JSONObject();
            o.put("t", new SimpleDateFormat("MMM d HH:mm", Locale.ROOT).format(new Date()));
            o.put("heard", heard);
            o.put("reply", reply);
            a.put(o);
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, a.length() - 60); i < a.length(); i++) trimmed.put(a.get(i));
            putString("log", trimmed.toString());
        } catch (JSONException ignored) { }
    }

    public String logText() {
        StringBuilder b = new StringBuilder();
        try {
            JSONArray a = new JSONArray(getString("log", "[]"));
            for (int i = a.length() - 1; i >= 0; i--) {
                JSONObject o = a.getJSONObject(i);
                b.append(o.optString("t")).append("  \"").append(o.optString("heard")).append("\"\n   → ")
                 .append(o.optString("reply")).append("\n");
            }
        } catch (JSONException ignored) { }
        return b.length() == 0 ? "Nothing yet." : b.toString();
    }
}
