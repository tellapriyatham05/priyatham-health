package com.priyatham.jarvis;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a spoken sentence into a {@link Command}. No AI: a fixed set of sentence shapes,
 * tried in order. Plain Java so it can be tested off the phone.
 */
public final class CommandParser {

    private static final String[] NUMBER_WORDS = {
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
        "nineteen", "twenty"
    };
    private static final String[][] TENS = {
        {"thirty", "30"}, {"forty", "40"}, {"fifty", "50"}, {"sixty", "60"}, {"seventy", "70"},
        {"eighty", "80"}, {"ninety", "90"}
    };

    private static final String ON = "(?:on|enable|start|activate)";
    private static final String OFF = "(?:off|disable|stop|deactivate)";

    /** Lower-cases, strips the wake word, filler and punctuation; spells numbers as digits. */
    public static String normalize(String text) {
        String t = " " + text.toLowerCase(Locale.ROOT) + " ";
        t = t.replace("wi-fi", "wifi").replace("wi fi", "wifi").replace("whats app", "whatsapp")
             .replace("what's app", "whatsapp").replace("you tube", "youtube").replace("blue tooth", "bluetooth")
             .replace("flash light", "flashlight").replace("e-mail", "email").replace("o'clock", "")
             .replace("a.m.", "am").replace("p.m.", "pm").replace(" a m ", " am ").replace(" p m ", " pm ")
             .replace("%", " percent ").replace("&", " and ");
        t = t.replaceAll("[^a-z0-9:.' ]", " ");
        t = t.replaceAll("(?<![0-9])\\.|\\.(?![0-9a-z])", " ");
        t = t.replaceAll("\\s+", " ");
        t = " " + t.trim() + " ";
        // Wake word and politeness.
        t = t.replaceAll("^ (?:(?:hey|hi|ok|okay|yo) )?(?:jarvis|jarvis's|travis|service) ", " ");
        t = t.replaceAll("^ (?:please |kindly |just |can you |could you |would you |will you |i want you to |i need you to |go ahead and |jarvis )+", " ");
        t = t.replaceAll(" (?:please|jarvis|for me|right now|now)\\s*$", " ");
        t = wordsToDigits(t);
        return t.replaceAll("\\s+", " ").trim();
    }

    static String wordsToDigits(String t) {
        for (String[] tens : TENS) {
            for (int i = 9; i >= 1; i--) {
                t = t.replace(" " + tens[0] + " " + NUMBER_WORDS[i] + " ",
                        " " + (Integer.parseInt(tens[1]) + i) + " ");
                t = t.replace(" " + tens[0] + "-" + NUMBER_WORDS[i] + " ",
                        " " + (Integer.parseInt(tens[1]) + i) + " ");
            }
            t = t.replace(" " + tens[0] + " ", " " + tens[1] + " ");
        }
        for (int i = NUMBER_WORDS.length - 1; i >= 0; i--) {
            t = t.replace(" " + NUMBER_WORDS[i] + " ", " " + i + " ");
        }
        t = t.replace(" a hundred ", " 100 ").replace(" hundred ", " 100 ");
        t = t.replace(" half an hour ", " 30 minutes ").replace(" an hour ", " 1 hour ")
             .replace(" a minute ", " 1 minute ").replace(" a couple of ", " 2 ");
        return t;
    }

    private static Matcher m(String regex, String text) {
        Matcher mm = Pattern.compile(regex).matcher(text);
        return mm.matches() ? mm : null;
    }

    private static boolean has(String regex, String text) {
        return Pattern.compile(regex).matcher(text).find();
    }

    private static String stateOf(String t) {
        if (has("\\b" + OFF + "\\b", t)) return "off";
        if (has("\\b" + ON + "\\b", t)) return "on";
        return "toggle";
    }

    public static Command parse(String raw) {
        String t = normalize(raw);
        Matcher x;
        if (t.length() == 0) return new Command("empty");

        // Conversation control.
        if (m("(?:stop|cancel|never ?mind|nothing|that's all|thats all|that is all|close|exit|dismiss|"
                + "go to sleep|sleep|goodbye|bye|bye bye|shut up|be quiet|quiet|no thanks|no thank you|no)", t) != null)
            return new Command("stop");
        if (m("(?:thank you|thanks|thank you jarvis|thanks a lot|good job|well done)", t) != null)
            return new Command("thanks");
        if (m("(?:hello|hi|hey|hey there|are you there|you there|wake up)", t) != null)
            return new Command("hello");
        if (m("(?:how are you|how are you doing|how's it going|what's up|whats up)", t) != null)
            return new Command("how_are_you");
        if (m("(?:who are you|what are you|what is your name|what's your name|introduce yourself)", t) != null)
            return new Command("who_are_you");
        if (has("^(?:what can you do|help|what are your (?:skills|features|commands)|list (?:your )?commands|"
                + "what do you do|show (?:me )?commands)", t))
            return new Command("help");

        // Memory.
        if ((x = m("remember (?:that )?(.+?) (?:is|are|equals|means) (.+)", t)) != null) {
            String a = x.group(1), b = x.group(2);
            if (a.startsWith("my ") || a.startsWith("the ")) return new Command("remember").with("key", a).with("value", b);
            return new Command("remember").with("key", b).with("value", a);
        }
        if ((x = m("(?:remember|note|note down|save) (?:that )?(.+)", t)) != null)
            return new Command("note").with("text", x.group(1));
        if (m("(?:what do you remember|what have you remembered|what do you know about me|list (?:my )?memories|"
                + "show (?:my )?memories|what are my notes|read my notes)", t) != null)
            return new Command("list_memory");
        if ((x = m("(?:forget|delete memory|remove memory)(?: about)? (.+)", t)) != null)
            return new Command("forget").with("key", x.group(1));

        // Voice and personality settings.
        if (has("^(?:speak|talk) (?:a bit |a little |little )?(?:faster|quicker)", t)) return new Command("voice").with("speed", "up");
        if (has("^(?:speak|talk) (?:a bit |a little |little )?(?:slower|slowly)", t)) return new Command("voice").with("speed", "down");
        if ((x = m("(?:switch to |use |change (?:to |your voice to )?|set voice (?:to )?)?(classic|jarvis|robot|robotic|calm|professional|normal|human)(?: voice| mode)?", t)) != null
                && has("voice|mode|switch|use|change", t))
            return new Command("voice").with("mode", x.group(1));
        if (has("^(?:change|switch) (?:your )?voice", t)) return new Command("voice").with("mode", "next");

        // Calls.
        if ((x = m("(?:call|phone|ring|dial|make a call to|place a call to|call up|give a call to|video call)(?: to)? (.+?)"
                + "(?: on (?:mobile|phone|his phone|her phone|whatsapp))?", t)) != null)
            return new Command("call").with("target", x.group(1));

        // Messages.
        if ((x = m("(?:send )?(?:a )?(?:whatsapp|whatsapp message|whatsapp text)(?: message)?(?: to)? (.+)", t)) != null)
            return splitMessage("whatsapp", x.group(1));
        if ((x = m("(?:send )?(?:a )?(?:message|msg|text|sms|text message)(?: to)? (.+?) on whatsapp(?: (?:saying|that) (.+))?", t)) != null)
            return splitMessage("whatsapp", x.group(1) + (x.group(2) != null ? " that " + x.group(2) : ""));
        if ((x = m("(?:send )?(?:a |an )?(?:sms|text|text message|sms message)(?: to)? (.+)", t)) != null)
            return splitMessage("sms", x.group(1));
        if ((x = m("(?:send )?(?:a )?(?:message|msg)(?: to)? (.+)", t)) != null)
            return splitMessage("default", x.group(1));
        if ((x = m("(?:tell|inform|let) (.+)", t)) != null) {
            String rest = x.group(1).replaceFirst(" know (?:that )?", " that ");
            return splitMessage("auto", rest);
        }
        if ((x = m("reply(?: to (.+?))?(?: (?:saying|that|with))? (.+)", t)) != null)
            return new Command("reply").with("who", x.group(1)).with("text", x.group(2));

        // Notifications.
        if (has("^(?:clear|dismiss|remove|delete)(?: all)?(?: my| the)? notifications", t)) return new Command("clear_notifications");
        if ((x = m("(?:read|check|show|tell me|any|do i have any|did i get any|what are|open)(?: me)?(?: all)?(?: my| the)?(?: new| latest| recent| unread)? (.*?)\\s*(?:notifications?|messages?|texts?|mails?|emails?|chats?)(?: from (.+))?", t)) != null) {
            String app = x.group(1).trim();
            return new Command("read_notifications").with("app", app.length() > 0 ? app : null).with("from", x.group(2));
        }
        if ((x = m("what did (.+?) (?:say|send|text|message)(?: me)?", t)) != null)
            return new Command("read_notifications").with("from", x.group(1));
        if (has("^(?:any|anything) new|^what did i miss|^any updates", t)) return new Command("read_notifications");

        // Settings and toggles.
        if (has("brightness|brighter|dimmer|dim the screen|dim screen", t)) return brightness(t);
        if (has("volume|louder|quieter|softer|^mute|^unmute|sound (?:up|down)", t)) return volume(t);
        if (has("\\bwifi\\b|\\bwireless\\b|\\binternet\\b", t) && !has("^(?:open|search|google)", t) && !has("settings", t))
            return new Command("toggle").with("device", "wifi").with("state", stateOf(t));
        if (has("\\bbluetooth\\b", t) && !has("settings", t)) return new Command("toggle").with("device", "bluetooth").with("state", stateOf(t));
        if (has("\\b(?:torch|flashlight|flash)\\b", t)) return new Command("toggle").with("device", "torch").with("state", stateOf(t));
        if (has("do not disturb|\\bdnd\\b|focus mode", t)) return new Command("toggle").with("device", "dnd").with("state", stateOf(t));
        if (has("silent mode|^(?:go |be |put (?:the )?phone (?:on |in )?)?silent|^silence", t)) return new Command("ringer").with("mode", has("\\b" + OFF + "\\b", t) ? "normal" : "silent");
        if (has("vibrate mode|vibration mode|^(?:put (?:the )?phone (?:on |in )?)?vibrate", t)) return new Command("ringer").with("mode", has("\\b" + OFF + "\\b", t) ? "normal" : "vibrate");
        if (has("ring mode|normal mode|general mode|ringer on|sound mode", t)) return new Command("ringer").with("mode", "normal");
        if (has("mobile data|cellular data|\\bdata\\b|airplane mode|aeroplane mode|flight mode|hotspot|location|\\bgps\\b|nfc|auto ?rotate|rotation", t)) {
            String what = has("airplane|aeroplane|flight", t) ? "airplane" : has("hotspot", t) ? "hotspot"
                    : has("location|gps", t) ? "location" : has("nfc", t) ? "nfc" : has("rotate|rotation", t) ? "rotation" : "data";
            return new Command("toggle").with("device", what).with("state", stateOf(t));
        }
        if (m("(?:lock|lock the|lock my)(?: phone| screen| device)?", t) != null && t.startsWith("lock")) return new Command("lock");
        if (has("^(?:take|capture|grab) (?:a )?screenshot|^screenshot", t)) return new Command("screenshot");
        if (m("(?:go )?(?:home|home screen|go to home(?: screen)?)", t) != null) return new Command("nav").with("to", "home");
        if (m("(?:go )?back", t) != null) return new Command("nav").with("to", "back");
        if (m("(?:show )?recent(?:s| apps)?", t) != null) return new Command("nav").with("to", "recents");

        // Media.
        if (m("(?:pause|pause (?:the )?(?:music|song|video|it)|stop (?:the )?(?:music|song|playing|video))", t) != null) return new Command("media").with("action", "pause");
        if (m("(?:next|skip|next (?:song|track|video)|skip (?:this )?(?:song|track))", t) != null) return new Command("media").with("action", "next");
        if (m("(?:previous|last|go back) (?:song|track|video)|previous", t) != null) return new Command("media").with("action", "previous");
        if (m("(?:resume|continue|play|resume (?:the )?(?:music|song)|continue (?:the )?(?:music|song)|unpause)", t) != null) return new Command("media").with("action", "play");
        if ((x = m("(?:play|search|find|watch|open|show me|search for)(?: me)? (.+?) on youtube", t)) != null) return new Command("youtube").with("query", x.group(1));
        if ((x = m("(?:youtube|search youtube for|search on youtube for|search on youtube) (.+)", t)) != null) return new Command("youtube").with("query", x.group(1));
        if ((x = m("(?:play|put on|start playing)(?: me)?(?: some| the| my)? (.+?)(?: on (spotify|youtube music|music|jiosaavn|saavn|gaana|wynk))?", t)) != null) {
            String q = x.group(1);
            if (q.matches("(?:music|songs?|something|a song|some music|my music|my songs)")) return new Command("play_music").with("app", x.group(2));
            return new Command("play").with("query", q).with("app", x.group(2)).with("raw", t);
        }

        // Clock.
        if ((x = m("(?:set|create|add|make|put)(?: an?)? alarm(?: for| at)? (.+)", t)) != null) return timed("alarm", x.group(1), null);
        if ((x = m("(?:wake me up|wake me)(?: at| by| in)? (.+)", t)) != null) return timed("alarm", x.group(1), null);
        if ((x = m("(?:set|start|create|put)(?: an?)?(?: timer)?(?: for)? (\\d+) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: timer)?", t)) != null)
            return new Command("timer").with("seconds", String.valueOf(toSeconds(x.group(1), x.group(2))));
        if ((x = m("(\\d+) ?(seconds?|minutes?|mins?|hours?) timer", t)) != null)
            return new Command("timer").with("seconds", String.valueOf(toSeconds(x.group(1), x.group(2))));
        if ((x = m("remind me (.+)", t)) != null) return reminder(x.group(1));
        if ((x = m("(?:set|create|add) (?:a )?reminder (.+)", t)) != null) return reminder(x.group(1).replaceFirst("^(?:for|that) ", ""));

        // Questions about the phone and the day.
        if (m("(?:what(?:'s| is) the time|what time is it|time|time now|tell me the time|current time|what's the time now)", t) != null) return new Command("time");
        if (has("^(?:what(?:'s| is) (?:the |today's )?(?:date|day)|what day is (?:it|today)|today's date|date today|which day is today|date)", t)) return new Command("date");
        if (has("battery|charge level|charging|how much charge", t)) return new Command("battery");
        if (has("\\bram\\b|memory usage|how much memory", t)) return new Command("ram");
        if (has("storage|space left|free space|disk", t)) return new Command("storage");
        if (has("system status|phone status|status report|how is my phone|phone health|diagnostics", t)) return new Command("status");
        if ((x = m("(?:how (?:long|much time)|how much)(?: have| did)? i (?:used|use|spent|spend|been)(?: on)?(?: my)? (.+?)(?: today)?", t)) != null)
            return new Command("screen_time").with("app", x.group(1).replaceAll("(?:phone|screen|time)", "").trim());
        if (has("screen time|usage today|phone usage|app usage|screen usage", t)) return new Command("screen_time");

        // Health (from Priyatham Health).
        if ((x = m("(?:log|add|record|i drank|i had|drank|had)(?: an?)? (\\d+(?:\\.\\d+)?) ?(ml|milliliters?|millilitres?|liters?|litres?|l|glass(?:es)?|cups?|bottles?)(?: of)? water", t)) != null)
            return new Command("water").with("amount", x.group(1)).with("unit", x.group(2));
        if ((x = m("(?:log|add|i drank|i had|drank|had)(?: an?| one)? (glass|cup|bottle) of water", t)) != null)
            return new Command("water").with("amount", "1").with("unit", x.group(1));
        if (has("how much water|water (?:today|status|intake|count)", t)) return new Command("water_status");
        if ((x = m("(?:log|record)(?: my)? weight(?: as| is)? (\\d+(?:\\.\\d+)?)(?: ?(?:kg|kgs|kilos?|kilograms?))?", t)) != null)
            return new Command("weight").with("kg", x.group(1));
        if ((x = m("(?:i walked|steps|log) (\\d+) steps", t)) != null) return new Command("note").with("text", "walked " + x.group(1) + " steps");

        // Say something.
        if ((x = m("(?:say|repeat after me|repeat) (.+)", t)) != null) return new Command("say").with("text", x.group(1));

        // Web.
        if ((x = m("(?:search|google|look up|search for|search google for|google search|search the web for|find)(?: for| about)? (.+)", t)) != null)
            return new Command("search").with("query", x.group(1));
        if ((x = m("(?:what is|what's|who is|who's|where is|how to|how do i) (.+)", t)) != null)
            return new Command("search").with("query", t);

        // Camera.
        if (has("^(?:take|click|capture) (?:a |my )?(?:photo|picture|pic|selfie)|^open (?:the )?camera|^camera$", t))
            return new Command("camera").with("selfie", has("selfie", t) ? "yes" : null);

        // Open apps, sites and settings.
        if ((x = m("(?:open|launch|start|run|show|go to|take me to|switch to)(?: the| my)? (.+?)(?: app| application)?", t)) != null) {
            String what = x.group(1);
            if (has("settings$", what)) return new Command("open_settings").with("which", what.replaceFirst("\\s*settings$", ""));
            return new Command("open").with("target", what);
        }

        // Bare app or routine name ("instagram", "coding mode") is decided by the brain.
        return new Command("unknown").with("text", t);
    }

    /** "priyatham that I'll be late" / "priyatham I'll be late" → who + text (the brain refines the split). */
    private static Command splitMessage(String channel, String rest) {
        Command c = new Command("message").with("channel", channel);
        Matcher x = Pattern.compile("^(.+?) (?:that|saying|to say|say|message|text|with the message) (.+)$").matcher(rest);
        if (x.matches() && x.group(1).split(" ").length <= 4) return c.with("who", x.group(1)).with("text", x.group(2));
        return c.with("rest", rest);
    }

    private static Command brightness(String t) {
        Command c = new Command("brightness");
        Matcher n = Pattern.compile("(\\d{1,3})").matcher(t);
        if (has("\\b(?:max|maximum|full|highest)\\b", t)) return c.with("level", "100");
        if (has("\\b(?:min|minimum|lowest|least)\\b", t)) return c.with("level", "1");
        if (n.find() && !has("\\bby\\b", t)) return c.with("level", n.group(1));
        int step = 20;
        Matcher by = Pattern.compile("by (\\d{1,3})").matcher(t);
        if (by.find()) step = Integer.parseInt(by.group(1));
        if (has("increase|raise|\\bup\\b|more|higher|brighter|turn up", t)) return c.with("delta", String.valueOf(step));
        if (has("decrease|lower|reduce|\\bdown\\b|less|dim|darker|turn down", t)) return c.with("delta", String.valueOf(-step));
        if (has("auto|adaptive|automatic", t)) return c.with("auto", stateOf(t).equals("off") ? "off" : "on");
        return c.with("query", "yes");
    }

    private static Command volume(String t) {
        Command c = new Command("volume");
        if (has("^unmute|unmute", t)) return c.with("mute", "off");
        if (has("\\bmute\\b", t)) return c.with("mute", "on");
        Matcher n = Pattern.compile("(\\d{1,3})").matcher(t);
        if (has("\\b(?:max|maximum|full|highest)\\b", t)) return c.with("level", "100");
        if (has("\\b(?:min|minimum|lowest)\\b", t)) return c.with("level", "0");
        if (n.find() && !has("\\bby\\b", t)) return c.with("level", n.group(1));
        if (has("increase|raise|\\bup\\b|louder|more|higher|turn up", t)) return c.with("delta", "15");
        if (has("decrease|lower|reduce|\\bdown\\b|quieter|softer|less|turn down", t)) return c.with("delta", "-15");
        return c.with("query", "yes");
    }

    static int toSeconds(String n, String unit) {
        int v = Integer.parseInt(n);
        if (unit.startsWith("h")) return v * 3600;
        if (unit.startsWith("m")) return v * 60;
        return v;
    }

    private static final Pattern IN_TIME = Pattern.compile("\\bin (\\d+) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b");
    private static final Pattern AT_TIME = Pattern.compile(
            "\\b(?:at |by |for )?(\\d{1,2})(?:[:. ](\\d{2}))? ?(am|pm|in the morning|in the evening|at night|tonight|in the afternoon)?\\b");
    private static final Pattern DAY = Pattern.compile("\\b(tomorrow|today|tonight|day after tomorrow)\\b");

    /** Fills hour/minute/day or in_seconds slots from phrases like "tomorrow at 10 am" or "in 20 minutes". */
    static Command timed(String intent, String phrase, String task) {
        Command c = new Command(intent).with("task", task);
        Matcher in = IN_TIME.matcher(phrase);
        if (in.find()) return c.with("in_seconds", String.valueOf(toSeconds(in.group(1), in.group(2))));
        Matcher d = DAY.matcher(phrase);
        String day = d.find() ? d.group(1) : null;
        if ("tonight".equals(day)) day = "today";
        c.with("day", day);
        String forClock = phrase.replaceAll("\\b(?:tomorrow|today|day after tomorrow)\\b", " ");
        Matcher a = AT_TIME.matcher(forClock);
        while (a.find()) {
            int h = Integer.parseInt(a.group(1));
            if (h > 24) continue;
            int min = a.group(2) != null ? Integer.parseInt(a.group(2)) : 0;
            String suffix = a.group(3);
            if (a.group(2) == null && suffix == null && !phrase.matches(".*\\b(?:at|by|for) " + a.group(1) + "\\b.*")
                    && !phrase.trim().equals(a.group(1))) continue;
            if (suffix != null) {
                boolean pm = suffix.equals("pm") || suffix.contains("evening") || suffix.contains("night") || suffix.contains("afternoon");
                if (pm && h < 12) h += 12;
                if (!pm && h == 12) h = 0;
            } else if (has("tonight|evening|night", phrase) && h < 12) {
                h += 12;
            }
            c.with("hour", String.valueOf(h)).with("minute", String.valueOf(min))
             .with("ampm_known", suffix != null || h > 12 ? "yes" : null);
            return c;
        }
        if (has("morning", phrase)) return c.with("hour", "8").with("minute", "0").with("ampm_known", "yes");
        if (has("evening", phrase)) return c.with("hour", "18").with("minute", "0").with("ampm_known", "yes");
        if (has("night", phrase)) return c.with("hour", "21").with("minute", "0").with("ampm_known", "yes");
        if (day != null) return c.with("hour", "9").with("minute", "0").with("ampm_known", "yes");
        return c.with("missing_time", "yes");
    }

    private static Command reminder(String rest) {
        String task = null;
        Matcher to = Pattern.compile("(?:^| )(?:to|that|about) (.+?)(?= (?:in \\d|at \\d|tomorrow|today|tonight|this evening|by \\d)|$)").matcher(rest);
        if (to.find()) task = to.group(1);
        String timePart = task == null ? rest : rest.replace(task, " ");
        Command c = timed("reminder", timePart, task);
        if (task == null) c.with("task", rest.replaceAll(IN_TIME.pattern(), "").replaceAll("\\b(?:tomorrow|today|tonight|at \\d{1,2}(?:[:. ]\\d{2})? ?(?:am|pm)?)\\b", "").trim());
        return c;
    }
}
