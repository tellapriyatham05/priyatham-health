package com.priyatham.jarvis;

import java.util.Locale;

/**
 * Forgiving name matching for speech: "pre atham", "priyatam" and "Priyatham" should all
 * land on the same contact. Scores run from 0 (unrelated) to 1 (identical).
 */
public final class Fuzzy {
    private Fuzzy() {}

    public static String clean(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Rough sound-alike key, tuned for Indian and English names. */
    public static String soundKey(String s) {
        String k = clean(s).replace(" ", "");
        k = k.replace("ph", "f").replace("th", "t").replace("dh", "d").replace("bh", "b")
             .replace("kh", "k").replace("gh", "g").replace("sh", "s").replace("ch", "c")
             .replace("ck", "k").replace("q", "k").replace("w", "v").replace("z", "j")
             .replace("ee", "i").replace("oo", "u").replace("aa", "a").replace("ey", "i")
             .replace("ie", "i").replace("y", "i");
        StringBuilder b = new StringBuilder();
        char last = 0;
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            if (c != last) b.append(c);
            last = c;
        }
        String out = b.toString();
        if (out.endsWith("h") && out.length() > 1) out = out.substring(0, out.length() - 1);
        return out;
    }

    public static int distance(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[b.length()];
    }

    public static double ratio(String a, String b) {
        if (a.length() == 0 && b.length() == 0) return 1;
        int max = Math.max(a.length(), b.length());
        return 1.0 - (double) distance(a, b) / max;
    }

    /** Similarity of two short phrases (names, app labels). */
    public static double score(String spoken, String candidate) {
        String a = clean(spoken), b = clean(candidate);
        if (a.length() == 0 || b.length() == 0) return 0;
        if (a.equals(b)) return 1;
        String an = a.replace(" ", ""), bn = b.replace(" ", "");
        if (an.equals(bn)) return 0.99;
        double best = Math.max(ratio(an, bn), 0.96 * ratio(soundKey(a), soundKey(b)));
        // "priyatham" against "Priyatham Reddy": compare with each word and the leading words.
        String[] words = b.split(" ");
        if (words.length > 1) {
            StringBuilder lead = new StringBuilder();
            for (int i = 0; i < words.length; i++) {
                String w = words[i];
                lead.append(w);
                double whole = Math.max(ratio(an, lead.toString()), 0.96 * ratio(soundKey(a), soundKey(lead.toString())));
                double word = Math.max(ratio(an, w), 0.96 * ratio(soundKey(a), soundKey(w)));
                best = Math.max(best, Math.max(whole, word) * (i == 0 ? 0.97 : 0.93));
            }
        }
        if (an.length() >= 3 && bn.startsWith(an)) best = Math.max(best, 0.86);
        return best;
    }
}
