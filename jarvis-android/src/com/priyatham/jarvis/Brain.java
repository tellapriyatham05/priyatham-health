package com.priyatham.jarvis;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.view.KeyEvent;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Understands → acts → answers. Keeps short-term context (the last person mentioned, an
 * unfinished message) and uses the long-term memory and routines from {@link Prefs}.
 */
public final class Brain {

    /** What the HUD should do after a command. */
    public static final class Reply {
        public String speech = "";
        /** Runs after JARVIS finishes speaking (calls, opening apps). */
        public Runnable after;
        /** Close the HUD once done. */
        public boolean close;
        /** Listen again straight away (JARVIS asked a question). */
        public boolean ask;
        /** Extra lines to show on screen (lists). */
        public String display;
        /** The follow-up action works on the lock screen (calls, lock, screenshot). */
        public boolean noUnlock;

        Reply say(String s) { speech = s; return this; }
        Reply anyScreen() { noUnlock = true; return this; }
        Reply then(Runnable r) { after = r; return this; }
        Reply closing() { close = true; return this; }
        Reply asking() { ask = true; return this; }
    }

    private static Brain instance;

    public static synchronized Brain get(Context c) {
        if (instance == null) instance = new Brain(c.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final Prefs prefs;

    // Short-term context.
    private String lastName, lastNumber, lastChannel;
    private long lastContextAt;
    private String pending;            // "message_text" | "choose_contact"
    private Command pendingCommand;
    private List<Contacts.Person> pendingChoices;
    private NotifListener.Item lastNotification;
    private int depth;

    private Brain(Context c) {
        ctx = c;
        prefs = new Prefs(c);
    }

    private String sir() {
        return "jarvis".equals(prefs.style()) ? ", " + prefs.userTitle() : "";
    }

    private Reply reply(String s) {
        String out = s.replace("{sir}", sir());
        if ("short".equals(prefs.style())) {
            int dot = out.indexOf(". ");
            if (dot > 0) out = out.substring(0, dot + 1);
        }
        return new Reply().say(out);
    }

    public void clearPending() {
        pending = null;
        pendingCommand = null;
        pendingChoices = null;
    }

    public boolean hasPending() {
        return pending != null;
    }

    private void remember(String name, String number, String channel) {
        lastName = name;
        lastNumber = number;
        if (channel != null) lastChannel = channel;
        lastContextAt = System.currentTimeMillis();
    }

    private boolean contextFresh() {
        return lastName != null && System.currentTimeMillis() - lastContextAt < 15 * 60 * 1000;
    }

    // ------------------------------------------------------------------

    public Reply handle(String heard) {
        Reply r = handleInner(heard);
        if (depth == 0) prefs.log(heard, r.speech);
        return r;
    }

    private Reply handleInner(String heard) {
        String text = CommandParser.normalize(heard);
        if (text.length() == 0) return reply("Yes{sir}?").asking();

        // 1. An unfinished conversation ("What should I say?").
        if (pending != null) {
            Reply r = continuePending(text);
            if (r != null) return r;
        }

        // 2. Routines ("good night", "coding mode", "start study mode").
        String routine = matchRoutine(text);
        if (routine != null) return runRoutine(routine);

        // 3. Long-term memory: "my main project" → "mediaai".
        text = applyMemory(text);

        // 4. Pronouns: "tell him I'll be late" → the last person mentioned.
        if (contextFresh() && text.matches("^(?:call|ring|phone|dial|message|msg|text|tell|send|whatsapp|inform|let|reply)\\b.*\\b(?:him|her|them)\\b.*")) {
            text = text.replaceFirst("\\b(?:him|her|them)\\b", lastName.toLowerCase(Locale.ROOT));
        }

        Command c = CommandParser.parse(text);
        if (text.contains("on my laptop") || text.contains("on the laptop") || text.contains("on laptop")) {
            return reply("Laptop control arrives with the laptop app in the next version{sir}. For now I can only work on this phone.");
        }
        return execute(c);
    }

    private Reply continuePending(String text) {
        Command c = CommandParser.parse(text);
        if ("stop".equals(c.intent)) {
            clearPending();
            return reply("Cancelled{sir}.").closing();
        }
        if ("message_text".equals(pending) && pendingCommand != null) {
            String msg = text.replaceFirst("^(?:tell (?:him|her|them) |say |that |tell (?:him|her|them) that |message |write )+", "");
            Command m = pendingCommand;
            clearPending();
            return sendMessage(m.get("channel"), m.get("name"), m.get("number"), msg);
        }
        if ("choose_contact".equals(pending) && pendingChoices != null) {
            Contacts.Person chosen = null;
            if (text.matches(".*\\b(?:first|1st|one|1)\\b.*")) chosen = pendingChoices.get(0);
            else if (text.matches(".*\\b(?:second|2nd|two|2)\\b.*") && pendingChoices.size() > 1) chosen = pendingChoices.get(1);
            else {
                double best = 0;
                for (Contacts.Person p : pendingChoices) {
                    double s = Fuzzy.score(text, p.name);
                    if (s > best) { best = s; chosen = p; }
                }
                if (best < 0.6) chosen = null;
            }
            Command original = pendingCommand;
            clearPending();
            if (chosen == null) return null; // treat as a fresh command
            return afterContact(original, chosen.name, chosen.number);
        }
        clearPending();
        return null;
    }

    private String applyMemory(String text) {
        Map<String, String> mem = prefs.memory();
        List<String> keys = new ArrayList<String>(mem.keySet());
        Collections.sort(keys, new Comparator<String>() {
            @Override public int compare(String a, String b) { return b.length() - a.length(); }
        });
        if (text.startsWith("remember") || text.startsWith("forget")) return text;
        for (String k : keys) {
            String v = mem.get(k);
            String pattern = "\\b" + java.util.regex.Pattern.quote(k) + "\\b";
            if (text.matches(".*" + pattern + ".*")) {
                return text.replaceAll(pattern, java.util.regex.Matcher.quoteReplacement(v.toLowerCase(Locale.ROOT)));
            }
            // "open main project" when the memory says "my main project".
            if (k.startsWith("my ")) {
                String bare = "\\b" + java.util.regex.Pattern.quote(k.substring(3)) + "\\b";
                if (text.matches(".*" + bare + ".*")) return text.replaceAll(bare, java.util.regex.Matcher.quoteReplacement(v.toLowerCase(Locale.ROOT)));
            }
        }
        return text;
    }

    // ---- Routines ----

    private String matchRoutine(String text) {
        Map<String, List<String>> all = prefs.routines();
        String t = text.replaceFirst("^(?:start|activate|begin|enable|run|turn on|switch to|go to|enter|set) ", "")
                       .replaceFirst(" (?:on|please|now|activate|activated)$", "");
        for (String name : all.keySet()) {
            String bare = name.replaceFirst(" mode$", "");
            if (t.equals(name) || t.equals(bare) || t.equals(bare + " mode") || t.equals(bare + " routine")) return name;
        }
        return null;
    }

    private Reply runRoutine(String name) {
        List<String> steps = prefs.routines().get(name);
        StringBuilder said = new StringBuilder();
        final List<Runnable> afters = new ArrayList<Runnable>();
        depth++;
        try {
            for (String step : steps) {
                Command c = CommandParser.parse(step);
                if ("say".equals(c.intent)) {
                    said.append(step.replaceFirst("(?i)^\\s*say\\s+", "")).append(" ");
                    continue;
                }
                Reply r = handleInner(step);
                if (r.after != null) afters.add(r.after);
                // Questions inside a routine ("battery", "read my notifications") are answered aloud.
                if (c.intent.matches("time|date|battery|read_notifications|status|water_status|screen_time|ram|storage")
                        && r.speech.length() > 0) {
                    said.append(r.speech).append(" ");
                }
            }
        } finally {
            depth--;
        }
        clearPending();
        String title = Character.toUpperCase(name.charAt(0)) + name.substring(1);
        Reply out = reply(said.length() > 0 ? said.toString().trim() : title + (name.endsWith("mode") ? " is on{sir}." : " routine done{sir}."));
        if (!afters.isEmpty()) {
            out.then(new Runnable() {
                @Override public void run() { for (Runnable a : afters) a.run(); }
            });
        }
        return out.closing();
    }

    // ---- The big switch ----

    private Reply execute(final Command c) {
        String i = c.intent;
        if (i.equals("stop")) { clearPending(); return reply("").closing(); }
        if (i.equals("thanks")) return reply("Always a pleasure{sir}.").closing();
        if (i.equals("hello")) return reply("At your service{sir}.").asking();
        if (i.equals("how_are_you")) return reply("All systems running smoothly{sir}. Battery is at " + SystemStats.batteryPercent(ctx) + " percent.");
        if (i.equals("who_are_you")) return reply("I am JARVIS, your personal assistant. I run entirely on this phone, no internet needed.");
        if (i.equals("help")) return help();
        if (i.equals("empty")) return reply("Yes{sir}?").asking();

        if (i.equals("remember")) {
            prefs.remember(c.get("key"), c.get("value"));
            return reply("Got it. " + cap(c.get("key")) + " is " + c.get("value") + ".");
        }
        if (i.equals("note")) {
            prefs.addNote(c.get("text"));
            return reply("Noted{sir}.");
        }
        if (i.equals("list_memory")) return listMemory();
        if (i.equals("forget")) {
            return prefs.forget(c.get("key")) ? reply("Forgotten.") : reply("I had nothing saved for " + c.get("key") + ".");
        }
        if (i.equals("voice")) return voice(c);

        if (i.equals("call")) return call(c);
        if (i.equals("message")) return message(c);
        if (i.equals("reply")) return replyToNotification(c);
        if (i.equals("read_notifications")) return readNotifications(c);
        if (i.equals("clear_notifications")) {
            return NotifListener.clearAll() ? reply("Notifications cleared{sir}.") : needNotificationAccess();
        }

        if (i.equals("brightness")) return brightness(c);
        if (i.equals("volume")) return volume(c);
        if (i.equals("toggle")) return toggle(c);
        if (i.equals("ringer")) return ringer(c);
        if (i.equals("lock")) {
            if (!JarvisAccessibility.isOn()) return needAccessibility("lock the screen");
            return reply("Locking{sir}.").then(new Runnable() {
                @Override public void run() { JarvisAccessibility.global(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN); }
            }).closing().anyScreen();
        }
        if (i.equals("screenshot")) {
            if (!JarvisAccessibility.isOn()) return needAccessibility("take screenshots");
            return reply("").then(new Runnable() {
                @Override public void run() {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                        @Override public void run() { JarvisAccessibility.global(AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT); }
                    }, 900);
                }
            }).closing().anyScreen();
        }
        if (i.equals("nav")) {
            final String to = c.get("to");
            return reply("").then(new Runnable() {
                @Override public void run() {
                    if ("home".equals(to)) Actions.goHome(ctx);
                    else if ("back".equals(to)) JarvisAccessibility.global(AccessibilityService.GLOBAL_ACTION_BACK);
                    else JarvisAccessibility.global(AccessibilityService.GLOBAL_ACTION_RECENTS);
                }
            }).closing();
        }

        if (i.equals("media")) return media(c);
        if (i.equals("play_music")) {
            if (!Actions.musicActive(ctx)) {
                Actions.mediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY);
                final boolean[] opened = {false};
                return reply("Playing music{sir}.").then(new Runnable() {
                    @Override public void run() {
                        if (!Actions.musicActive(ctx) && !opened[0]) { opened[0] = true; Actions.openMusicApp(ctx); }
                    }
                }).closing().anyScreen();
            }
            return reply("Music is already playing{sir}.");
        }
        if (i.equals("play")) return play(c);
        if (i.equals("youtube")) {
            final String q = c.get("query");
            return reply("Searching YouTube for " + q + ".").then(new Runnable() {
                @Override public void run() { Actions.youtube(ctx, q); }
            }).closing();
        }
        if (i.equals("search")) {
            final String q = c.get("query");
            return reply("Searching for " + q + ".").then(new Runnable() {
                @Override public void run() { Actions.webSearch(ctx, q); }
            }).closing();
        }
        if (i.equals("camera")) {
            final boolean selfie = c.has("selfie");
            return reply("Opening the camera{sir}.").then(new Runnable() {
                @Override public void run() { Actions.camera(ctx, selfie); }
            }).closing();
        }
        if (i.equals("open_settings")) {
            final String which = c.get("which");
            return reply("Opening " + (which == null ? "" : which + " ") + "settings.").then(new Runnable() {
                @Override public void run() { Actions.openSettings(ctx, which); }
            }).closing();
        }
        if (i.equals("open")) return open(c.get("target"));

        if (i.equals("alarm")) return alarm(c);
        if (i.equals("timer")) {
            final int s = Integer.parseInt(c.get("seconds"));
            Actions.setTimer(ctx, s, null);
            return reply("Timer set for " + SystemStats.spokenDuration(s * 1000L) + "{sir}.");
        }
        if (i.equals("reminder")) return reminder(c);

        if (i.equals("time")) {
            return reply("It's " + new SimpleDateFormat("h:mm a", Locale.US).format(new Date()) + "{sir}.");
        }
        if (i.equals("date")) {
            return reply("Today is " + new SimpleDateFormat("EEEE, d MMMM", Locale.US).format(new Date()) + ".");
        }
        if (i.equals("battery")) {
            int b = SystemStats.batteryPercent(ctx);
            return reply("Battery is at " + b + " percent" + (SystemStats.charging(ctx) ? " and charging." : b < 20 ? ". You should charge soon{sir}." : "."));
        }
        if (i.equals("ram")) {
            long[] r = SystemStats.ram(ctx);
            return reply(String.format(Locale.US, "You're using %.1f of %.1f gigabytes of RAM.", r[0] / 1073741824.0, r[1] / 1073741824.0));
        }
        if (i.equals("storage")) {
            long[] s = SystemStats.storage();
            return reply(String.format(Locale.US, "%.0f of %.0f gigabytes of storage used. %.0f gigabytes free.",
                    s[0] / 1073741824.0, s[1] / 1073741824.0, (s[1] - s[0]) / 1073741824.0));
        }
        if (i.equals("status")) {
            long[] r = SystemStats.ram(ctx), s = SystemStats.storage();
            return reply(String.format(Locale.US, "All systems normal{sir}. Battery %d percent, RAM %d percent used, storage %d percent used, %d notifications waiting.",
                    SystemStats.batteryPercent(ctx), Math.round(100.0 * r[0] / r[1]), Math.round(100.0 * s[0] / s[1]), NotifListener.snapshot().size()));
        }
        if (i.equals("screen_time")) return screenTime(c);

        if (i.equals("water")) {
            double amt = Double.parseDouble(c.get("amount"));
            String u = c.get("unit");
            int ml = (int) Math.round(u.startsWith("l") || u.startsWith("lit") ? amt * 1000 : u.startsWith("glass") ? amt * 250
                    : u.startsWith("cup") ? amt * 200 : u.startsWith("bottle") ? amt * 1000 : amt);
            int total = prefs.addWater(ml);
            return reply("Logged " + ml + " millilitres. That's " + total + " of your " + prefs.waterGoal() + " today.");
        }
        if (i.equals("water_status")) {
            return reply("You've had " + prefs.waterToday() + " millilitres of water today, out of " + prefs.waterGoal() + ".");
        }
        if (i.equals("weight")) {
            prefs.putString("weight_kg", c.get("kg"));
            prefs.addNote("weight " + c.get("kg") + " kg on " + new SimpleDateFormat("d MMM", Locale.US).format(new Date()));
            return reply("Weight logged: " + c.get("kg") + " kilos.");
        }
        if (i.equals("say")) return reply(c.get("text"));

        // Unknown: maybe it's just an app or a routine name.
        String t = c.get("text");
        if (t != null) {
            Actions.App app = Actions.findApp(ctx, t);
            if (app != null && app.score >= 0.88) return openApp(app);
        }
        return reply("Sorry{sir}, I don't know how to do that yet.");
    }

    private static String cap(String s) {
        return s == null || s.isEmpty() ? "" : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private Reply help() {
        Reply r = reply("I can make calls, send messages, read your notifications, open apps, play music, control brightness, "
                + "Wi-Fi, Bluetooth, the torch and volume, set alarms, timers and reminders, remember things, and run your routines{sir}.");
        r.display = "Try:\n• call Priyatham\n• message Priyatham I'll reach in 10 minutes\n• read my WhatsApp messages\n"
                + "• brightness 40 percent · wifi off · torch on\n• play Believer · next song\n• open Instagram\n"
                + "• remind me tomorrow at 10 am to pay rent\n• remember MediaAI is my main project\n• good night · coding mode\n"
                + "• battery · screen time · system status";
        return r;
    }

    private Reply listMemory() {
        Map<String, String> m = prefs.memory();
        List<String> notes = prefs.notes();
        if (m.isEmpty() && notes.isEmpty()) return reply("I haven't been asked to remember anything yet{sir}.");
        StringBuilder b = new StringBuilder("Here's what I remember. ");
        StringBuilder d = new StringBuilder();
        for (Map.Entry<String, String> e : m.entrySet()) {
            b.append(cap(e.getKey())).append(" is ").append(e.getValue()).append(". ");
            d.append("• ").append(e.getKey()).append(" → ").append(e.getValue()).append("\n");
        }
        for (int k = Math.max(0, notes.size() - 3); k < notes.size(); k++) {
            b.append("Note: ").append(notes.get(k)).append(". ");
        }
        for (String n : notes) d.append("• note: ").append(n).append("\n");
        Reply r = reply(b.toString().trim());
        r.display = d.toString().trim();
        return r;
    }

    private Reply voice(Command c) {
        if (c.has("speed")) {
            float r = prefs.speechRate() + ("up".equals(c.get("speed")) ? 0.15f : -0.15f);
            r = Math.max(0.6f, Math.min(1.8f, r));
            prefs.putFloat("speech_rate", r);
            return reply("up".equals(c.get("speed")) ? "Speaking faster{sir}." : "Speaking slower{sir}.");
        }
        String m = c.get("mode");
        String[] modes = {"classic", "robot", "calm", "professional"};
        String next;
        if ("next".equals(m)) {
            int idx = java.util.Arrays.asList(modes).indexOf(prefs.voiceMode());
            next = modes[(idx + 1) % modes.length];
        } else if (m.startsWith("robot")) next = "robot";
        else if (m.equals("calm")) next = "calm";
        else if (m.equals("professional") || m.equals("normal") || m.equals("human")) next = "professional";
        else next = "classic";
        prefs.putString("voice_mode", next);
        return reply("Voice changed to " + next + " mode{sir}.");
    }

    // ---- Calls and messages ----

    private Reply resolveContact(Command c, String who) {
        if (who.matches("[0-9 +\\-]{5,}")) return afterContact(c, who.trim(), who.replaceAll("[^0-9+]", ""));
        if (!Contacts.allowed(ctx)) return reply("I need permission to read your contacts first. Open the JARVIS app to allow it.");
        List<Contacts.Person> found = Contacts.find(ctx, who);
        if (found.isEmpty()) return reply("I couldn't find " + who + " in your contacts{sir}.");
        if (found.size() > 1 && found.get(0).score - found.get(1).score < 0.03 && found.get(0).score < 0.99) {
            pending = "choose_contact";
            pendingCommand = c;
            pendingChoices = found.subList(0, Math.min(3, found.size()));
            StringBuilder q = new StringBuilder("Which one: ");
            for (int k = 0; k < pendingChoices.size(); k++) {
                q.append(k == 0 ? "" : k == pendingChoices.size() - 1 ? " or " : ", ").append(pendingChoices.get(k).name);
            }
            return reply(q.append("?").toString()).asking();
        }
        Contacts.Person p = found.get(0);
        return afterContact(c, p.name, p.number);
    }

    private Reply afterContact(Command c, final String name, final String number) {
        if ("call".equals(c.intent)) {
            remember(name, number, null);
            if (!Actions.granted(ctx, Manifest.permission.CALL_PHONE)) {
                return reply("Opening the dialer for " + name + ". Allow phone calls in the JARVIS app to call directly.")
                        .then(new Runnable() { @Override public void run() { Actions.call(ctx, number); } }).closing().anyScreen();
            }
            return reply("Calling " + name + "{sir}.").then(new Runnable() {
                @Override public void run() { Actions.call(ctx, number); }
            }).closing().anyScreen();
        }
        // message
        String channel = c.get("channel");
        remember(name, number, channel);
        String text = c.get("text");
        if (text == null || text.length() == 0) {
            pending = "message_text";
            pendingCommand = new Command("message").with("channel", channel).with("name", name).with("number", number);
            return reply("What should I say to " + name + "?").asking();
        }
        return sendMessage(channel, name, number, text);
    }

    private Reply call(Command c) {
        return resolveContact(c, c.get("target"));
    }

    private Reply message(Command c) {
        String channel = c.get("channel");
        if ("auto".equals(channel)) channel = lastChannel != null ? lastChannel : prefs.getString("default_channel", "whatsapp");
        if ("default".equals(channel)) channel = prefs.getString("default_channel", "whatsapp");
        Command m = new Command("message").with("channel", channel).with("text", c.get("text"));
        String who = c.get("who");
        if (who == null) {
            String rest = c.get("rest");
            String[] words = rest.split(" ");
            int n = words.length == 1 ? 1 : Contacts.nameLength(ctx, words);
            if (n == 0) n = 1; // no contact matched: assume a one-word name
            StringBuilder name = new StringBuilder(), text = new StringBuilder();
            for (int k = 0; k < words.length; k++) (k < n ? name : text).append(k == 0 || k == n ? "" : " ").append(words[k]);
            who = name.toString();
            m.with("text", text.toString());
        }
        return resolveContact(m, who);
    }

    private Reply sendMessage(String channel, final String name, final String number, final String text) {
        final String msg = text.length() > 0 ? Character.toUpperCase(text.charAt(0)) + text.substring(1) : text;
        if ("whatsapp".equals(channel)) {
            String note = JarvisAccessibility.isOn() ? "" : " Tap send to finish.";
            return reply("Sending to " + name + " on WhatsApp{sir}." + note).then(new Runnable() {
                @Override public void run() {
                    if (!Actions.whatsapp(ctx, number, msg)) Actions.sms(ctx, number, msg);
                }
            }).closing();
        }
        if (!Actions.granted(ctx, Manifest.permission.SEND_SMS)) {
            return reply("I need permission to send SMS. Open the JARVIS app to allow it.");
        }
        return Actions.sms(ctx, number, msg) ? reply("Message sent to " + name + "{sir}.").closing()
                : reply("The message to " + name + " didn't go through.");
    }

    // ---- Notifications ----

    private Reply needNotificationAccess() {
        return reply("I need notification access first. Open the JARVIS app and turn it on.");
    }

    private Reply readNotifications(Command c) {
        if (!NotifListener.isConnected()) return needNotificationAccess();
        List<NotifListener.Item> all = NotifListener.snapshot();
        String app = c.get("app"), from = c.get("from");
        if (app != null && app.matches("(?:new|unread|latest|recent|my|all|the|any)")) app = null;
        List<NotifListener.Item> pick = new ArrayList<NotifListener.Item>();
        for (NotifListener.Item it : all) {
            if (app != null) {
                String a = app.replaceAll("\\b(?:text|sms)\\b", "messages");
                if (Fuzzy.score(a, it.app) < 0.75 && !it.pkg.contains(a.replace(" ", ""))) continue;
            }
            if (from != null && Fuzzy.score(from, it.title) < 0.72) continue;
            pick.add(it);
        }
        if (pick.isEmpty()) {
            return reply(all.isEmpty() ? "You have no notifications{sir}."
                    : "Nothing " + (from != null ? "from " + from : app != null ? "from " + app : "new") + "{sir}.");
        }
        StringBuilder b = new StringBuilder();
        if (pick.size() > 1) b.append("You have ").append(pick.size()).append(pick.size() == 1 ? " notification. " : " notifications. ");
        int n = Math.min(5, pick.size());
        for (int k = 0; k < n; k++) {
            NotifListener.Item it = pick.get(k);
            b.append(it.app);
            if (it.title.length() > 0 && !it.title.equals(it.app)) b.append(", ").append(it.title);
            String body = it.text.length() > 160 ? it.text.substring(0, 160) : it.text;
            b.append(": ").append(body).append(". ");
        }
        if (pick.size() > n) b.append("And ").append(pick.size() - n).append(" more.");
        lastNotification = pick.get(0);
        for (NotifListener.Item it : pick) {
            if (it.reply != null) { lastNotification = it; break; }
        }
        return reply(b.toString().trim());
    }

    private Reply replyToNotification(Command c) {
        if (!NotifListener.isConnected()) return needNotificationAccess();
        NotifListener.Item target = null;
        String who = c.get("who");
        for (NotifListener.Item it : NotifListener.snapshot()) {
            if (it.reply == null) continue;
            if (who != null) {
                if (Fuzzy.score(who, it.title) >= 0.72) { target = it; break; }
            } else if (lastNotification != null && it.key.equals(lastNotification.key)) {
                target = it;
                break;
            } else if (target == null) {
                target = it;
            }
        }
        if (target == null) return reply("There's nothing I can reply to{sir}.");
        return NotifListener.reply(ctx, target, c.get("text")) ? reply("Replied to " + target.title + "{sir}.")
                : reply("I couldn't send that reply.");
    }

    // ---- Settings ----

    private Reply needWriteSettings() {
        return reply("I need permission to change system settings. Open the JARVIS app and allow it.");
    }

    private Reply brightness(Command c) {
        if (c.has("auto")) {
            return Actions.setAutoBrightness(ctx, "on".equals(c.get("auto"))) ? reply("Auto brightness " + c.get("auto") + ".") : needWriteSettings();
        }
        int now = Actions.brightnessPercent(ctx);
        if (c.has("query")) return reply("Brightness is at " + now + " percent.");
        int target = c.has("level") ? Integer.parseInt(c.get("level")) : now + Integer.parseInt(c.get("delta"));
        target = Math.max(1, Math.min(100, target));
        return Actions.setBrightness(ctx, target) ? reply("Brightness set to " + target + " percent{sir}.") : needWriteSettings();
    }

    private Reply volume(Command c) {
        if (c.has("mute")) {
            boolean m = "on".equals(c.get("mute"));
            Actions.mute(ctx, m);
            return reply(m ? "Muted." : "Unmuted.");
        }
        int now = Actions.volumePercent(ctx);
        if (c.has("query")) return reply("Volume is at " + now + " percent.");
        int target = c.has("level") ? Integer.parseInt(c.get("level")) : now + Integer.parseInt(c.get("delta"));
        target = Math.max(0, Math.min(100, target));
        Actions.setVolume(ctx, target);
        return reply("Volume " + target + " percent.");
    }

    private Reply toggle(Command c) {
        String d = c.get("device"), s = c.get("state");
        if (d.equals("wifi")) {
            boolean on = s.equals("toggle") ? !Actions.wifiOn(ctx) : s.equals("on");
            if (Actions.setWifi(ctx, on)) return reply("Wi-Fi " + (on ? "on" : "off") + "{sir}.");
            if (JarvisAccessibility.toggleTile(new String[]{"Wi-Fi", "Wifi", "Internet", "WLAN"}, on, null)) return reply("Switching Wi-Fi " + (on ? "on" : "off") + ".").closing();
            final String dev = d;
            return reply("Android wants you to confirm this one{sir}.").then(new Runnable() {
                @Override public void run() { Actions.openPanel(ctx, dev); }
            }).closing();
        }
        if (d.equals("bluetooth")) {
            boolean on = s.equals("toggle") ? !Actions.bluetoothOn() : s.equals("on");
            if (Actions.setBluetooth(on)) return reply("Bluetooth " + (on ? "on" : "off") + "{sir}.");
            if (JarvisAccessibility.toggleTile(new String[]{"Bluetooth"}, on, null)) return reply("Switching Bluetooth " + (on ? "on" : "off") + ".").closing();
            return reply("Android wants you to confirm this one{sir}.").then(new Runnable() {
                @Override public void run() { Actions.openPanel(ctx, "bluetooth"); }
            }).closing();
        }
        if (d.equals("torch")) {
            boolean on = s.equals("toggle") ? !Actions.torchOn() : s.equals("on");
            return Actions.setTorch(ctx, on) ? reply("Torch " + (on ? "on" : "off") + ".") : reply("I couldn't reach the torch.");
        }
        if (d.equals("dnd")) {
            boolean on = s.equals("toggle") ? !Actions.dndOn(ctx) : s.equals("on");
            if (Actions.setDnd(ctx, on)) return reply("Do not disturb " + (on ? "on" : "off") + "{sir}.");
            return reply("I need Do Not Disturb access. Open the JARVIS app and allow it.");
        }
        if (d.equals("rotation")) {
            boolean on = !s.equals("off");
            return Actions.setAutoRotate(ctx, on) ? reply("Auto rotate " + (on ? "on." : "off.")) : needWriteSettings();
        }
        final String dev = d;
        String name = d.equals("data") ? "Mobile data" : d.equals("airplane") ? "Airplane mode" : d.equals("hotspot") ? "Hotspot"
                : d.equals("location") ? "Location" : "NFC";
        return reply(name + " can only be switched by you on Android. Opening it now{sir}.").then(new Runnable() {
            @Override public void run() { Actions.openPanel(ctx, dev); }
        }).closing();
    }

    private Reply ringer(Command c) {
        String mode = c.get("mode");
        if (Actions.setRinger(ctx, mode)) return reply(cap(mode) + " mode{sir}.");
        return reply("I need Do Not Disturb access to change that. Open the JARVIS app and allow it.");
    }

    // ---- Media and apps ----

    private Reply media(Command c) {
        String a = c.get("action");
        int key = a.equals("pause") ? KeyEvent.KEYCODE_MEDIA_PAUSE : a.equals("next") ? KeyEvent.KEYCODE_MEDIA_NEXT
                : a.equals("previous") ? KeyEvent.KEYCODE_MEDIA_PREVIOUS : KeyEvent.KEYCODE_MEDIA_PLAY;
        Actions.mediaKey(ctx, key);
        String say = a.equals("pause") ? "Paused." : a.equals("next") ? "Next track." : a.equals("previous") ? "Previous track." : "Resuming.";
        return depth > 0 ? reply("") : reply(say).closing();
    }

    private Reply play(Command c) {
        final String q = c.get("query");
        final String app = c.get("app");
        if (q.matches("(?:my )?playlist|(?:my )?favou?rites?|(?:my )?liked songs")) {
            String saved = prefs.memory().get("my playlist");
            if (saved == null) {
                Actions.mediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY);
                return reply("Playing{sir}. Tell me \"remember my playlist is\" followed by its name, and I'll play it by name next time.").closing();
            }
        }
        return reply("Playing " + q + "{sir}.").then(new Runnable() {
            @Override public void run() {
                if (!Actions.playFromSearch(ctx, q, app)) Actions.youtube(ctx, q);
            }
        }).closing();
    }

    private Reply openApp(final Actions.App app) {
        return reply("Opening " + app.label + "{sir}.").then(new Runnable() {
            @Override public void run() { Actions.openApp(ctx, app); }
        }).closing();
    }

    private Reply open(final String target) {
        if (target == null) return reply("Open what{sir}?").asking();
        String routine = matchRoutine(target);
        if (routine != null) return runRoutine(routine);
        if (Actions.looksLikeWebsite(target)) {
            return reply("Opening " + target.replace(" dot ", ".") + ".").then(new Runnable() {
                @Override public void run() { Actions.openUrl(ctx, target); }
            }).closing();
        }
        if (target.matches("(?:the )?camera")) return execute(new Command("camera"));
        Actions.App app = Actions.findApp(ctx, target);
        if (app != null) return openApp(app);
        if (target.matches("(?:google|youtube|gmail|maps|instagram|facebook|twitter|linkedin|github|netflix|amazon|flipkart|wikipedia)")) {
            return reply("Opening " + target + ".").then(new Runnable() {
                @Override public void run() { Actions.openUrl(ctx, target + ".com"); }
            }).closing();
        }
        return reply("I couldn't find an app called " + target + "{sir}.");
    }

    // ---- Clock ----

    private Reply alarm(Command c) {
        if (c.has("in_seconds")) {
            Calendar cal = Calendar.getInstance();
            cal.add(Calendar.SECOND, Integer.parseInt(c.get("in_seconds")));
            c.with("hour", String.valueOf(cal.get(Calendar.HOUR_OF_DAY))).with("minute", String.valueOf(cal.get(Calendar.MINUTE)));
        }
        if (!c.has("hour")) return reply("For what time{sir}?");
        int h = Integer.parseInt(c.get("hour")), m = Integer.parseInt(c.get("minute"));
        if (!c.has("ampm_known") && h <= 12) {
            // "wake me up at 7": the next 7 o'clock that is still ahead.
            Calendar now = Calendar.getInstance();
            int nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
            int am = (h % 12) * 60 + m, pm = am + 12 * 60;
            h = (am > nowMin || pm <= nowMin) ? h % 12 : h % 12 + 12;
        }
        Actions.setAlarm(ctx, h, m, null);
        return reply("Alarm set for " + clock(h, m) + "{sir}.");
    }

    private static String clock(int h, int m) {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, m);
        return new SimpleDateFormat(m == 0 ? "h a" : "h:mm a", Locale.US).format(cal.getTime());
    }

    private Reply reminder(Command c) {
        String task = c.get("task");
        if (task == null || task.length() == 0) task = "your reminder";
        Calendar when = Calendar.getInstance();
        if (c.has("in_seconds")) {
            when.add(Calendar.SECOND, Integer.parseInt(c.get("in_seconds")));
        } else if (c.has("hour")) {
            int h = Integer.parseInt(c.get("hour")), m = Integer.parseInt(c.get("minute"));
            String day = c.get("day");
            if ("tomorrow".equals(day)) when.add(Calendar.DAY_OF_YEAR, 1);
            if ("day after tomorrow".equals(day)) when.add(Calendar.DAY_OF_YEAR, 2);
            when.set(Calendar.HOUR_OF_DAY, h);
            when.set(Calendar.MINUTE, m);
            when.set(Calendar.SECOND, 0);
            if (!c.has("ampm_known") && h < 12 && when.before(Calendar.getInstance()) && day == null) when.add(Calendar.HOUR_OF_DAY, 12);
            if (when.before(Calendar.getInstance()) && day == null) when.add(Calendar.DAY_OF_YEAR, 1);
        } else {
            return reply("When should I remind you{sir}?");
        }
        Actions.setReminder(ctx, when.getTimeInMillis(), task);
        String whenText;
        Calendar today = Calendar.getInstance();
        int days = when.get(Calendar.DAY_OF_YEAR) - today.get(Calendar.DAY_OF_YEAR);
        String time = new SimpleDateFormat(when.get(Calendar.MINUTE) == 0 ? "h a" : "h:mm a", Locale.US).format(when.getTime());
        whenText = days == 0 ? "today at " + time : days == 1 ? "tomorrow at " + time
                : new SimpleDateFormat("EEEE", Locale.US).format(when.getTime()) + " at " + time;
        return reply("I'll remind you " + whenText + " to " + task + "{sir}.");
    }

    // ---- Screen time ----

    private Reply screenTime(Command c) {
        if (!SystemStats.hasUsageAccess(ctx)) return reply("I need usage access to see screen time. Open the JARVIS app and allow it.");
        LinkedHashMap<String, Long> usage = SystemStats.screenTimeToday(ctx);
        String app = c.get("app");
        if (app != null && app.length() > 0) {
            long ms = SystemStats.usedMillisFor(ctx, usage, app);
            if (ms < 0) return reply("You haven't used " + app + " today.");
            Integer limit = SystemStats.limits(prefs).get(app.toLowerCase(Locale.ROOT));
            return reply("You've used " + app + " for " + SystemStats.spokenDuration(ms) + " today."
                    + (limit != null ? " Your limit is " + limit + " minutes." : ""));
        }
        long total = SystemStats.totalMillis(usage);
        StringBuilder b = new StringBuilder("Screen time today is " + SystemStats.spokenDuration(total) + ".");
        int k = 0;
        for (Map.Entry<String, Long> e : usage.entrySet()) {
            if (k++ == 3) break;
            b.append(k == 1 ? " Most on " : ", ").append(NotifListener.appLabel(ctx, e.getKey()))
             .append(" ").append(SystemStats.spokenDuration(e.getValue()));
        }
        return reply(b.append(".").toString());
    }

    // ---- Permission hints ----

    private Reply needAccessibility(String what) {
        return reply("To " + what + ", turn on the JARVIS helper in Accessibility settings. Open the JARVIS app for the button.");
    }
}
