package com.priyatham.jarvis;

import java.util.LinkedHashMap;
import java.util.Map;

/** One understood command: what to do (intent) plus the details (slots). */
public final class Command {
    public final String intent;
    public final Map<String, String> slots = new LinkedHashMap<String, String>();

    public Command(String intent) {
        this.intent = intent;
    }

    public Command with(String key, String value) {
        if (value != null) {
            String v = value.trim();
            if (v.length() > 0) slots.put(key, v);
        }
        return this;
    }

    public String get(String key) {
        return slots.get(key);
    }

    public boolean has(String key) {
        return slots.containsKey(key);
    }

    @Override
    public String toString() {
        return intent + slots;
    }
}
