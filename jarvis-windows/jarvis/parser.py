"""Sentence → command. No AI: fixed sentence shapes tried in order (laptop edition of the
phone's CommandParser)."""
import re

NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
                "nineteen", "twenty"]
TENS = [("thirty", 30), ("forty", 40), ("fifty", 50), ("sixty", 60), ("seventy", 70), ("eighty", 80), ("ninety", 90)]
ON = r"(?:on|enable|start|activate|connect)"
OFF = r"(?:off|disable|stop|deactivate|disconnect)"


# Every word JARVIS's commands use. The command-word recogniser is limited to these (plus app,
# project and memory names added at runtime), which makes short commands far more reliable.
VOCAB_PHRASES = """
jarvis hey okay hi hello please can you could would will
what is the time what's time now tell me current date day today tomorrow battery charge charging level
how much ram memory cpu usage processor storage disk space free left system status report diagnostics ip address
open close quit launch start run show go to switch hide yourself come here back appear stay go away disappear
volume up down mute unmute louder quieter softer increase decrease raise lower set turn to by percent max maximum
minimum brightness brighter dimmer dim screen wifi bluetooth on off enable disable internet airplane mode night light
play pause stop resume next previous song track music video youtube spotify search google for find look up
set a an timer alarm reminder remind me in at am pm minutes minute seconds hours hour morning evening night tonight
cancel all my reminders timers list lock laptop computer pc shut down shutdown restart sleep sign out log
screenshot take type write read clipboard copy paste save select undo new tab window minimize maximize desktop
remember forget what do you know notes note that
yes no yeah sure okay confirm cancel thank thanks you good job never mind that's all
screen time used today how long have i spent
coding study good night morning break mode routine
offline turn off yourself stop listening go wake
vs code chrome edge notepad calculator terminal explorer file files downloads documents pictures music videos
settings word excel powerpoint whatsapp instagram gmail github linkedin netflix amazon flipkart maps drive
recycle bin empty voice faster slower robot calm natural change
one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty sixty
"""
VOCAB = sorted(set(VOCAB_PHRASES.split()))


class Command(dict):
    def __init__(self, intent, **slots):
        super().__init__({k: v.strip() if isinstance(v, str) else v for k, v in slots.items() if v not in (None, "")})
        self.intent = intent

    def __repr__(self):
        return f"{self.intent}{dict(self)}"


# ---------------------------------------------------------------- fuzzy matching

def clean(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def sound_key(s):
    k = clean(s).replace(" ", "")
    for a, b in (("ph", "f"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("kh", "k"), ("gh", "g"), ("sh", "s"),
                 ("ch", "c"), ("ck", "k"), ("q", "k"), ("w", "v"), ("z", "j"), ("ee", "i"), ("oo", "u"),
                 ("aa", "a"), ("ey", "i"), ("ie", "i"), ("y", "i")):
        k = k.replace(a, b)
    out = "".join(c for i, c in enumerate(k) if i == 0 or c != k[i - 1])
    return out[:-1] if len(out) > 1 and out.endswith("h") else out


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        prev = cur
    return prev[len(b)]


def ratio(a, b):
    if not a and not b:
        return 1.0
    return 1.0 - distance(a, b) / max(len(a), len(b))


def score(spoken, candidate):
    """How well a spoken name matches a candidate (0..1)."""
    a, b = clean(spoken), clean(candidate)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    an, bn = a.replace(" ", ""), b.replace(" ", "")
    if an == bn:
        return 0.99
    best = max(ratio(an, bn), 0.96 * ratio(sound_key(a), sound_key(b)))
    words = b.split(" ")
    if len(words) > 1:
        lead = ""
        for i, w in enumerate(words):
            lead += w
            whole = max(ratio(an, lead), 0.96 * ratio(sound_key(a), sound_key(lead)))
            word = max(ratio(an, w), 0.96 * ratio(sound_key(a), sound_key(w)))
            best = max(best, max(whole, word) * (0.97 if i == 0 else 0.93))
    if len(an) >= 3 and bn.startswith(an):
        best = max(best, 0.86)
    return best


# ---------------------------------------------------------------- normalising

def words_to_digits(t):
    for word, val in TENS:
        for i in range(9, 0, -1):
            t = t.replace(f" {word} {NUMBER_WORDS[i]} ", f" {val + i} ").replace(f" {word}-{NUMBER_WORDS[i]} ", f" {val + i} ")
        t = t.replace(f" {word} ", f" {val} ")
    for i in range(len(NUMBER_WORDS) - 1, -1, -1):
        t = t.replace(f" {NUMBER_WORDS[i]} ", f" {i} ")
    for a, b in ((" a hundred ", " 100 "), (" hundred ", " 100 "), (" half an hour ", " 30 minutes "),
                 (" an hour ", " 1 hour "), (" a minute ", " 1 minute "), (" a couple of ", " 2 ")):
        t = t.replace(a, b)
    return t


def normalize(text):
    t = " " + (text or "").lower() + " "
    for a, b in (("wi-fi", "wifi"), ("wi fi", "wifi"), ("why fi", "wifi"), ("whats app", "whatsapp"),
                 ("you tube", "youtube"), ("blue tooth", "bluetooth"), ("v s code", "vs code"), ("vscode", "vs code"),
                 ("visual studio code", "vs code"), ("o'clock", ""), ("a.m.", "am"), ("p.m.", "pm"),
                 (" a m ", " am "), (" p m ", " pm "), ("%", " percent "), ("&", " and ")):
        t = t.replace(a, b)
    t = re.sub(r"[^a-z0-9:.' ]", " ", t)
    t = re.sub(r"(?<![0-9])\.|\.(?![0-9a-z])", " ", t)
    t = " " + re.sub(r"\s+", " ", t).strip() + " "
    t = re.sub(r"^ (?:(?:hey|hi|ok|okay|yo) )?(?:jarvis|jarvis's|travis|service|charvis|javis) ", " ", t)
    t = re.sub(r"^ (?:(?:please|kindly|just|can you|could you|would you|will you|i want you to|i need you to|go ahead and|jarvis) )+", " ", t)
    t = re.sub(r" (?:please|jarvis|for me|right now|now)\s*$", " ", t)
    t = words_to_digits(t)
    return re.sub(r"\s+", " ", t).strip()


def _m(regex, text):
    return re.fullmatch(regex, text)


def _has(regex, text):
    return re.search(regex, text) is not None


def _state(t):
    if _has(rf"\b{OFF}\b", t):
        return "off"
    if _has(rf"\b{ON}\b", t):
        return "on"
    return "toggle"


def to_seconds(n, unit):
    v = int(n)
    return v * 3600 if unit.startswith("h") else v * 60 if unit.startswith("m") else v


IN_TIME = re.compile(r"\bin (\d+) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b")
AT_TIME = re.compile(r"\b(?:at |by |for )?(\d{1,2})(?:[:. ](\d{2}))? ?(am|pm|in the morning|in the evening|at night|tonight|in the afternoon)?\b")
DAY = re.compile(r"\b(tomorrow|today|tonight|day after tomorrow)\b")


def timed(intent, phrase, task=None):
    c = Command(intent, task=task)
    m = IN_TIME.search(phrase)
    if m:
        c["in_seconds"] = to_seconds(m.group(1), m.group(2))
        return c
    d = DAY.search(phrase)
    day = d.group(1) if d else None
    if day == "tonight":
        day = "today"
    if day:
        c["day"] = day
    clock = re.sub(r"\b(?:tomorrow|today|day after tomorrow)\b", " ", phrase)
    for a in AT_TIME.finditer(clock):
        h = int(a.group(1))
        if h > 24:
            continue
        minute = int(a.group(2)) if a.group(2) else 0
        suffix = a.group(3)
        if not a.group(2) and not suffix and not re.search(rf"\b(?:at|by|for) {a.group(1)}\b", phrase) and phrase.strip() != a.group(1):
            continue
        if suffix:
            pm = suffix == "pm" or any(w in suffix for w in ("evening", "night", "afternoon"))
            if pm and h < 12:
                h += 12
            if not pm and h == 12:
                h = 0
        elif _has("tonight|evening|night", phrase) and h < 12:
            h += 12
        c.update(hour=h, minute=minute)
        if suffix or h > 12:
            c["ampm_known"] = True
        return c
    for word, h in (("morning", 8), ("evening", 18), ("night", 21)):
        if word in phrase:
            c.update(hour=h, minute=0, ampm_known=True)
            return c
    if day:
        c.update(hour=9, minute=0, ampm_known=True)
        return c
    c["missing_time"] = True
    return c


def reminder(rest):
    m = re.search(r"(?:^| )(?:to|that|about) (.+?)(?= (?:in \d|at \d|tomorrow|today|tonight|this evening|by \d)|$)", rest)
    task = m.group(1) if m else None
    c = timed("reminder", rest.replace(task, " ") if task else rest, task)
    if not task:
        c["task"] = re.sub(r"\b(?:tomorrow|today|tonight|at \d{1,2}(?:[:. ]\d{2})? ?(?:am|pm)?)\b", "", IN_TIME.sub("", rest)).strip() or "your reminder"
    return c


def _level(intent, t, step):
    c = Command(intent)
    n = re.search(r"(\d{1,3})", t)
    if _has(r"\b(?:max|maximum|full|highest)\b", t):
        c["level"] = 100
    elif _has(r"\b(?:min|minimum|lowest|least)\b", t):
        c["level"] = 0 if intent == "volume" else 5
    elif n and not _has(r"\bby\b", t):
        c["level"] = int(n.group(1))
    elif _has(r"increase|raise|\bup\b|louder|more|higher|brighter|turn up", t):
        by = re.search(r"by (\d{1,3})", t)
        c["delta"] = int(by.group(1)) if by else step
    elif _has(r"decrease|lower|reduce|\bdown\b|quieter|softer|less|dim|darker|turn down", t):
        by = re.search(r"by (\d{1,3})", t)
        c["delta"] = -(int(by.group(1)) if by else step)
    else:
        c["query"] = True
    return c


def parse(raw):
    t = normalize(raw)
    if not t:
        return Command("empty")
    m = None

    if _m(r"(?:stop|cancel|never ?mind|nothing|that's all|thats all|that is all|close|exit|dismiss|go to sleep|sleep jarvis|"
          r"goodbye|bye|bye bye|shut up|be quiet|quiet|no thanks|no thank you|no)", t):
        return Command("stop")
    if _m(r"(?:turn (?:yourself )?off(?: yourself)?|turn off jarvis|stop listening|go offline|shut yourself down|"
          r"switch (?:yourself )?off|sleep mode|go to sleep mode|power down|deactivate(?: yourself)?|mute yourself|"
          r"stop jarvis|jarvis stop listening|disable yourself)", t):
        return Command("go_offline")
    if _m(r"(?:hide|hide yourself|go hide|go away|disappear|vanish|leave|dismiss yourself|you can go|get lost|go back|"
          r"minimi[sz]e yourself|hide jarvis|jarvis hide|fly away)", t):
        return Command("hide")
    if _m(r"(?:show yourself|show up|come here|come back|appear|come out|where are you|stay|stay here|stay on screen)", t):
        return Command("show")
    if _m(r"(?:yes|yeah|yep|sure|do it|confirm|go ahead|yes please|of course|okay|ok)", t):
        return Command("yes")
    if _m(r"(?:thank you|thanks|thank you jarvis|thanks a lot|good job|well done|nice)", t):
        return Command("thanks")
    if _m(r"(?:hello|hi|hey|hey there|are you there|you there|wake up|wake up daddy's home|daddy's home|i'm home)", t):
        return Command("hello")
    if _m(r"(?:how are you|how are you doing|how's it going|what's up|whats up)", t):
        return Command("how_are_you")
    if _m(r"(?:who are you|what are you|what is your name|what's your name|introduce yourself)", t):
        return Command("who_are_you")
    if _has(r"^(?:what can you do|help|what are your (?:skills|features|commands)|list (?:your )?commands|show (?:me )?commands)", t):
        return Command("help")

    # Memory.
    if m := _m(r"remember (?:that )?(.+?) (?:is|are|equals|means|lives at|is at|is in) (.+)", t):
        a, b = m.group(1), m.group(2)
        if a.startswith(("my ", "the ")):
            return Command("remember", key=a, value=b)
        return Command("remember", key=b, value=a)
    if m := _m(r"(?:remember|note|note down|save a note|take a note)(?: that)? (.+)", t):
        return Command("note", text=m.group(1))
    if _m(r"(?:what do you remember|what have you remembered|what do you know about me|list (?:my )?memories|"
          r"show (?:my )?memories|what are my notes|read my notes|show my notes)", t):
        return Command("list_memory")
    if m := _m(r"(?:forget|delete memory|remove memory)(?: about)? (.+)", t):
        return Command("forget", key=m.group(1))

    # Voice.
    if _has(r"^(?:speak|talk) (?:a bit |a little |little )?(?:faster|quicker)", t):
        return Command("voice", speed="up")
    if _has(r"^(?:speak|talk) (?:a bit |a little |little )?(?:slower|slowly)", t):
        return Command("voice", speed="down")
    if (m := _m(r"(?:switch to |use |change (?:to |your voice to )?|set voice (?:to )?)?(classic|jarvis|robot|robotic|calm|professional|normal|human)(?: voice| mode)?", t)) \
            and _has("voice|mode|switch|use|change", t):
        return Command("voice", mode=m.group(1))
    if _has(r"^(?:change|switch) (?:your )?voice", t):
        return Command("voice", mode="next")

    # Phone-only things.
    if _has(r"^(?:call|phone|ring|dial|message|msg|text|sms|whatsapp|tell|send (?:a )?(?:message|text|whatsapp))\b", t) \
            and not _has(r"\b(?:call it|tell me)\b", t):
        return Command("phone_only", text=t)

    # Power.
    if _has(r"^(?:shut ?down|power off|turn off)(?: the| my)?(?: laptop| computer| pc| system)?$", t):
        return Command("power", action="shutdown")
    if _has(r"^(?:restart|reboot)(?: the| my)?(?: laptop| computer| pc| system)?$", t):
        return Command("power", action="restart")
    if _has(r"^(?:sleep|hibernate|put (?:the |my )?(?:laptop|computer|pc) to sleep)(?: the| my)?(?: laptop| computer| pc)?$", t):
        return Command("power", action="sleep")
    if _has(r"^(?:lock|lock the|lock my)(?: laptop| computer| pc| screen| system)?$", t):
        return Command("power", action="lock")
    if _has(r"^(?:sign out|log ?out|log off)", t):
        return Command("power", action="logoff")

    # Settings.
    if _has(r"brightness|brighter|dimmer|dim the screen|dim screen", t):
        return _level("brightness", t, 20)
    if _has(r"volume|louder|quieter|softer|^mute|^unmute|sound (?:up|down)", t):
        if _has(r"unmute", t):
            return Command("volume", mute="off")
        if _has(r"\bmute\b", t):
            return Command("volume", mute="on")
        return _level("volume", t, 10)
    if _has(r"\bwifi\b|\bwireless\b|\binternet\b", t) and not _has(r"^(?:open|search|google)|settings", t):
        return Command("toggle", device="wifi", state=_state(t))
    if _has(r"\bbluetooth\b", t) and "settings" not in t:
        return Command("toggle", device="bluetooth", state=_state(t))
    if _has(r"night light|blue light", t):
        return Command("open_settings", which="night light")
    if _has(r"airplane mode|aeroplane mode|flight mode", t):
        return Command("open_settings", which="airplane")

    # Windows and screen.
    if _has(r"^(?:take|capture|grab) (?:a )?screenshot|^screenshot|^(?:take|capture) (?:a )?(?:screen ?shot|picture of (?:the|my) screen)", t):
        return Command("screenshot")
    if _has(r"^(?:show|go to)(?: the)? desktop|^minimi[sz]e (?:all|everything)|^hide (?:all|everything)(?: windows)?", t):
        return Command("window", action="desktop")
    if _has(r"^minimi[sz]e(?: this| the)?(?: window)?$", t):
        return Command("window", action="minimize")
    if _has(r"^maximi[sz]e(?: this| the)?(?: window)?$", t):
        return Command("window", action="maximize")
    if _has(r"^(?:switch|change) (?:the )?window|^next window|^alt tab", t):
        return Command("window", action="switch")
    if _has(r"^(?:close (?:this|the) (?:window|tab|app)|close it)$", t):
        return Command("window", action="close")
    if _has(r"^(?:new tab|open (?:a )?new tab)$", t):
        return Command("keys", combo="ctrl+t")
    if _has(r"^(?:close (?:the )?tab)$", t):
        return Command("keys", combo="ctrl+w")
    if _has(r"^(?:undo)$", t):
        return Command("keys", combo="ctrl+z")
    if _has(r"^(?:copy(?: that| this)?)$", t):
        return Command("keys", combo="ctrl+c")
    if _has(r"^(?:paste(?: it| that)?)$", t):
        return Command("keys", combo="ctrl+v")
    if _has(r"^(?:save(?: it| this| the file)?)$", t):
        return Command("keys", combo="ctrl+s")
    if _has(r"^(?:select all)$", t):
        return Command("keys", combo="ctrl+a")
    if _has(r"^(?:scroll down)$", t):
        return Command("keys", combo="pagedown")
    if _has(r"^(?:scroll up)$", t):
        return Command("keys", combo="pageup")
    if m := _m(r"(?:type|write|dictate)(?: this| that)?:? (.+)", t):
        return Command("type", text=raw.split(" ", 1)[1] if raw.lower().startswith(("type", "write", "dictate")) else m.group(1))
    if _has(r"^(?:read|what's in|what is in)(?: my| the)? clipboard", t):
        return Command("clipboard")
    if _has(r"^(?:empty|clear)(?: the)? recycle bin", t):
        return Command("recycle_bin")

    # Media.
    if _m(r"(?:pause|pause (?:the )?(?:music|song|video|it)|stop (?:the )?(?:music|song|playing|video))", t):
        return Command("media", action="pause")
    if _m(r"(?:next|skip|next (?:song|track|video)|skip (?:this )?(?:song|track))", t):
        return Command("media", action="next")
    if _m(r"(?:previous|last|go back) (?:song|track|video)|previous", t):
        return Command("media", action="previous")
    if _m(r"(?:resume|continue|play|resume (?:the )?(?:music|song|video)|continue (?:the )?(?:music|song)|unpause|play music|play some music|play my music)", t):
        return Command("media", action="play")
    if m := _m(r"(?:play|search|find|watch|open|show me|search for|put on)(?: me)? (.+?) on youtube", t):
        return Command("youtube", query=m.group(1))
    if m := _m(r"(?:youtube|search youtube for|search on youtube for|search on youtube) (.+)", t):
        return Command("youtube", query=m.group(1))
    if m := _m(r"(?:play|put on|start playing)(?: me)?(?: some| the| my)? (.+?)(?: on spotify)?", t):
        return Command("play", query=m.group(1), spotify="spotify" in t)

    # Clock.
    if m := _m(r"(?:set|create|add|make|put)(?: an?)? alarm(?: for| at)? (.+)", t):
        return timed("alarm", m.group(1))
    if m := _m(r"(?:wake me up|wake me)(?: at| by| in)? (.+)", t):
        return timed("alarm", m.group(1))
    if m := _m(r"(?:set|start|create|put)(?: an?)?(?: timer)?(?: for)? (\d+) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: timer)?", t):
        return Command("timer", seconds=to_seconds(m.group(1), m.group(2)))
    if m := _m(r"(\d+) ?(seconds?|minutes?|mins?|hours?) timer", t):
        return Command("timer", seconds=to_seconds(m.group(1), m.group(2)))
    if m := _m(r"remind me (.+)", t):
        return reminder(m.group(1))
    if m := _m(r"(?:set|create|add) (?:a )?reminder (.+)", t):
        return reminder(re.sub(r"^(?:for|that) ", "", m.group(1)))
    if _has(r"^(?:cancel|stop|delete)(?: all)?(?: my| the)? (?:timers?|reminders?|alarms?)", t):
        return Command("cancel_reminders")
    if _has(r"^(?:what are|list|show|read)(?: my| the)? (?:reminders|timers)", t):
        return Command("list_reminders")

    # Questions.
    if _m(r"(?:what(?:'s| is) the time|what time is it|time|time now|tell me the time|current time|what's the time now)", t):
        return Command("time")
    if _has(r"^(?:what(?:'s| is) (?:the |today's )?(?:date|day)|what day is (?:it|today)|today's date|date today|which day is today|date)", t):
        return Command("date")
    if _has(r"battery|charge level|charging|how much charge", t):
        return Command("battery")
    if _has(r"\bcpu\b|processor", t):
        return Command("cpu")
    if _has(r"\bram\b|memory usage|how much memory", t):
        return Command("ram")
    if _has(r"storage|space left|free space|disk", t):
        return Command("storage")
    if _has(r"system status|status report|how is my (?:laptop|computer|pc|system)|diagnostics|system report|run diagnostics", t):
        return Command("status")
    if _has(r"\bip address\b|my ip", t):
        return Command("ip")
    if m := _m(r"(?:how (?:long|much time)|how much)(?: have| did)? i (?:used|use|spent|spend|been)(?: on)?(?: my)? (.+?)(?: today)?", t):
        return Command("screen_time", app=re.sub(r"(?:laptop|computer|screen|time)", "", m.group(1)).strip())
    if _has(r"screen time|usage today|laptop usage|app usage|screen usage", t):
        return Command("screen_time")

    if m := _m(r"(?:say|repeat after me|repeat) (.+)", t):
        return Command("say", text=m.group(1))

    # Web.
    if m := _m(r"(?:search|google|look up|search for|search google for|google search|search the web for|find)(?: for| about)? (.+)", t):
        return Command("search", query=m.group(1))
    if _m(r"(?:what is|what's|who is|who's|where is|how to|how do i|when is|why is|why do) (.+)", t):
        return Command("search", query=t)

    # Open / close.
    if m := _m(r"(?:close|quit|exit|kill|shut)(?: the| my)? (.+?)(?: app| application| window)?", t):
        return Command("close", target=m.group(1))
    if m := _m(r"(?:open|launch|start|run|show|go to|take me to|switch to|bring up)(?: the| my| up)? (.+?)(?: app| application| folder| project)?", t):
        what = m.group(1)
        if what.endswith(" settings") or what == "settings":
            return Command("open_settings", which=re.sub(r"\s*settings$", "", what))
        return Command("open", target=what)

    return Command("unknown", text=t)
