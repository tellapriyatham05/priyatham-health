package com.priyatham.jarvis;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;

import java.util.ArrayList;
import java.util.List;

/** Finds contacts by a spoken name, tolerant of recognition mistakes. */
public final class Contacts {
    public static final class Person {
        public final String name, number;
        public final double score;

        Person(String name, String number, double score) {
            this.name = name;
            this.number = number;
            this.score = score;
        }
    }

    private static List<String[]> cache;
    private static long cachedAt;

    private Contacts() {}

    public static boolean allowed(Context c) {
        return c.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
    }

    static synchronized List<String[]> all(Context c) {
        if (cache != null && System.currentTimeMillis() - cachedAt < 5 * 60 * 1000) return cache;
        List<String[]> out = new ArrayList<String[]>();
        if (!allowed(c)) return out;
        Cursor cur = c.getContentResolver().query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY},
                null, null, ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY + " DESC");
        if (cur != null) {
            try {
                java.util.Set<String> seen = new java.util.HashSet<String>();
                while (cur.moveToNext()) {
                    String name = cur.getString(0), num = cur.getString(1);
                    if (name == null || num == null) continue;
                    if (seen.add(name.toLowerCase())) out.add(new String[]{name, num});
                }
            } finally {
                cur.close();
            }
        }
        cache = out;
        cachedAt = System.currentTimeMillis();
        return out;
    }

    /** Best matches first; only reasonably close ones. */
    public static List<Person> find(Context c, String spoken) {
        List<Person> out = new ArrayList<Person>();
        for (String[] p : all(c)) {
            double s = Fuzzy.score(spoken, p[0]);
            if (s >= 0.72) out.add(new Person(p[0], p[1], s));
        }
        java.util.Collections.sort(out, new java.util.Comparator<Person>() {
            @Override public int compare(Person a, Person b) { return Double.compare(b.score, a.score); }
        });
        return out;
    }

    /** Number of leading words of `words` that best name a contact (for "priyatham i'm on the way"). */
    public static int nameLength(Context c, String[] words) {
        int best = 0;
        double bestScore = 0;
        for (int k = 1; k <= Math.min(3, words.length - 1); k++) {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < k; i++) b.append(i > 0 ? " " : "").append(words[i]);
            List<Person> m = find(c, b.toString());
            if (!m.isEmpty() && m.get(0).score > bestScore + 0.02) {
                bestScore = m.get(0).score;
                best = k;
            }
        }
        return best;
    }
}
